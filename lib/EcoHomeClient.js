'use strict';

/**
 * Minimal client for the Eco-Home cloud (Newntide heat pumps).
 *
 * Ported from the Home Assistant integration "BataviaHeat Heat Pump"
 * (cloud_client.py, MIT licence, (c) 2026 Ruben Sloot):
 * https://github.com/RSloot2000/BataviaHeat-Heat-Pump
 *
 * Uses only Node's built-in https module, so the app has no npm dependencies.
 * The backend allows ONE session per account: use a dedicated Eco-Home account.
 */

const https = require('https');
const crypto = require('crypto');

const DEFAULT_HOST = 'https://ehome.ne01.com';
const NA_VALUES = new Set(['N/A', 'null', 'NULL', '']);
const ON_WORDS = /^(on|open|opened|true|yes|aan|开|开启|打开|运行)$/i;
const OFF_WORDS = /^(off|close|closed|false|no|uit|关|关闭|停止)$/i;

/**
 * The cloud sends most values as strings, sometimes with a unit or as a word
 * ("45.5", "45.5℃", "38 °C", "ON", "关"). Turn them into numbers; return
 * undefined when the value has no numeric meaning.
 */
function toNumber(raw) {
  if (raw == null) return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  const s = String(raw).trim();
  if (NA_VALUES.has(s)) return undefined;
  if (ON_WORDS.test(s)) return 1;
  if (OFF_WORDS.test(s)) return 0;
  const m = s.replace(',', '.').match(/^[-+]?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : undefined;
}

/** curSwitch can arrive as true/false, 1/0 or "1"/"0"/"true"/"false"; "0" must be off. */
function isOn(raw) {
  return (toNumber(raw) || 0) > 0;
}

const BASE_HEADERS = {
  'Content-Type': 'application/json;charset=UTF-8',
  Accept: '*/*',
  'app-id-type': '0',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.193 Mobile Safari/537.36 uni-app',
  'time-zone': 'Europe/Amsterdam',
  'Accept-Language': 'nl-NL,nl;q=0.9',
};

class EcoHomeSessionError extends Error {}
class EcoHomeAuthError extends Error {}

class EcoHomeClient {

  /**
   * @param {object} opts
   * @param {string} opts.username
   * @param {string} opts.passwordHash MD5 hex digest of the password
   * @param {number} [opts.loginType=2]
   * @param {string} [opts.host] override for tests
   * @param {function} [opts.log]
   */
  constructor({
    username, passwordHash, loginType = 2, host = DEFAULT_HOST, log = () => {},
  }) {
    this.username = username;
    this.passwordHash = passwordHash;
    this.loginType = loginType;
    this.host = host;
    this.log = log;
    this.token = null;
    this.cookie = '';
    this.userId = null;
    this._loginPromise = null;
    this._queue = Promise.resolve();
  }

  static hashPassword(plain) {
    return crypto.createHash('md5').update(String(plain), 'utf8').digest('hex');
  }

  // ── low level ──────────────────────────────────────────────────────────────

  _request(path, payload, { auth = true, method = 'POST' } = {}) {
    const url = new URL(`${this.host}${path}`);
    url.searchParams.set('lang', 'nl_NL');
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers = { ...BASE_HEADERS };
    if (auth) {
      if (!this.token) return Promise.reject(new EcoHomeSessionError('Not logged in'));
      headers['x-token'] = this.token;
      if (this.cookie) headers.Cookie = this.cookie;
    }
    if (body) headers['Content-Length'] = Buffer.byteLength(body);

    const lib = url.protocol === 'http:' ? require('http') : https;
    return new Promise((resolve, reject) => {
      const req = lib.request(url, { method, headers, timeout: 20000 }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode} on ${path}`));
          }
          let json;
          try {
            json = JSON.parse(text);
          } catch (e) {
            return reject(new Error(`Non-JSON response on ${path}: ${text.slice(0, 120)}`));
          }
          return resolve({ json, setCookie: res.headers['set-cookie'] || [] });
        });
      });
      req.on('timeout', () => req.destroy(new Error(`Timeout on ${path}`)));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  static _check(body, ctx) {
    if (!body || typeof body !== 'object') throw new Error(`${ctx}: empty response`);
    if ('sub_code' in body) {
      if (String(body.sub_code) === '-100') throw new EcoHomeSessionError(`${ctx}: session expired`);
      throw new Error(`${ctx}: ${body.sub_msg || 'gateway error'} (sub_code ${body.sub_code})`);
    }
    if ('error_code' in body && String(body.error_code) !== '0') {
      throw new Error(`${ctx}: ${body.error_msg || 'error'} (error_code ${body.error_code})`);
    }
    if ('errorCode' in body && Number(body.errorCode) !== 200) {
      throw new Error(`${ctx}: ${body.errorMsg || 'error'} (errorCode ${body.errorCode})`);
    }
  }

  // Serialise calls so a poll and a write never race on re-login.
  _enqueue(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }

  async _call(path, payload, ctx) {
    if (!this.token) await this.login();
    try {
      const { json } = await this._request(path, payload);
      EcoHomeClient._check(json, ctx);
      return json;
    } catch (err) {
      if (!(err instanceof EcoHomeSessionError)) throw err;
      this.log(`${ctx}: session expired, logging in again`);
      this.token = null;
      await this.login();
      const { json } = await this._request(path, payload);
      EcoHomeClient._check(json, ctx);
      return json;
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────

  async login() {
    if (this._loginPromise) return this._loginPromise;
    this._loginPromise = (async () => {
      const { json, setCookie } = await this._request('/cloudservice/api/app/user/login.json', {
        user_name: this.username,
        password: this.passwordHash,
        type: this.loginType,
      }, { auth: false });
      try {
        EcoHomeClient._check(json, 'login');
      } catch (err) {
        throw new EcoHomeAuthError(err.message);
      }
      const result = json.object_result || {};
      if (!result['x-token']) throw new EcoHomeAuthError('login: no token returned');
      this.token = result['x-token'];
      this.userId = result.user_id != null ? String(result.user_id) : null;
      this.cookie = setCookie.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
      this.log(`Logged in as ${this.username}`);
    })();
    try {
      return await this._loginPromise;
    } finally {
      this._loginPromise = null;
    }
  }

  /** All devices on the account, owned and shared. */
  getDevices() {
    return this._enqueue(async () => {
      const owned = (await this._call('/cloudservice/api/app/device/deviceList.json',
        { page_index: '1', page_size: '1000' }, 'deviceList')).object_result || [];
      const list = [...owned];
      if (this.userId) {
        try {
          const shared = (await this._call('/cloudservice/api/app/device/getMyAcceptDeviceShareDataList.json',
            { to_user: this.userId }, 'sharedDeviceList')).object_result || [];
          for (const d of shared) {
            if (d.device_code && !list.some(o => o.device_code === d.device_code)) list.push(d);
          }
        } catch (err) {
          this.log('Shared device list failed:', err.message);
        }
      }
      return list;
    });
  }

  /**
   * Read everything for one device.
   * @returns {{values: Object<number, number>, detail: object, info: object, errors: string[]}}
   */
  getState(deviceCode) {
    return this._enqueue(async () => {
      const values = {};
      const info = {}; // address -> { name, unit, raw } for diagnostics and name matching
      const errors = [];
      for (const type of [0, 1, 2]) {
        let raw;
        try {
          raw = (await this._call('/crmservice/api/app/deviceInfo/paramListV3',
            { deviceCode, type, isAutoRefresh: false }, `paramListV3(${type})`)).objectResult || [];
        } catch (err) {
          if (err instanceof EcoHomeAuthError) throw err;
          this.log(`paramListV3 type ${type} failed: ${err.message}`);
          errors.push(`paramListV3 type ${type}: ${err.message}`);
          continue;
        }
        for (const item of raw) {
          const items = item.moduleContent && item.moduleContent.length ? item.moduleContent : [item];
          for (const it of items) {
            if (it.address == null) continue;
            const addr = Number(it.address);
            const rawValue = it.addressValue;
            const n = toNumber(rawValue);
            // The same address can appear in several lists: never let an empty
            // ("N/A") copy replace one that had a real value.
            if (n === undefined && values[addr] !== undefined) continue;
            info[addr] = {
              name: String(it.pointName || it.addressName || it.name || it.paramName || it.title || '').trim(),
              unit: String(it.unit || '').trim(),
              raw: rawValue,
              type,
            };
            if (n !== undefined) values[addr] = n;
          }
        }
      }

      const detail = (await this._call('/crmservice/api/app/deviceInfo/getDeviceDetailV3',
        { deviceCode }, 'getDeviceDetailV3')).objectResult || {};
      if (detail.switchAddress != null) values[Number(detail.switchAddress)] = isOn(detail.curSwitch) ? 1 : 0;
      for (const card of detail.cardList || []) {
        if (card.switchAddress != null) values[Number(card.switchAddress)] = isOn(card.curSwitch) ? 1 : 0;
        if (card.modeList && card.modeList.length && card.curMode != null) {
          const addr = card.modeList[0].modeAddress;
          if (addr != null) values[Number(addr)] = Number(card.curMode);
        }
      }
      return {
        values, detail, info, errors,
      };
    });
  }

  /** Write a numeric value (setpoints, mode, silent mode…). */
  setValue(deviceCode, address, value) {
    return this._enqueue(() => this._call('/cloudservice/api/app/deviceInfo/controlOfValue.json',
      { device_code: deviceCode, address: String(address), value }, `setValue ${address}=${value}`));
  }

  /** Switch an on/off address (device power, zone, hot water). Endpoint name typo is the API's own. */
  setSwitch(deviceCode, address, on) {
    return this._enqueue(() => this._call('/cloudservice/api/app/deviceInfo/updateSwitchSate.json',
      { device_code: deviceCode, address: String(address), value: !!on }, `setSwitch ${address}=${on}`));
  }

}

module.exports = {
  EcoHomeClient, EcoHomeAuthError, EcoHomeSessionError, toNumber, isOn,
};
