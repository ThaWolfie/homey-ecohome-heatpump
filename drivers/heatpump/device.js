'use strict';

const Homey = require('homey');
const { EcoHomeClient, EcoHomeAuthError, isOn } = require('../../lib/EcoHomeClient');

// Eco-Home cloud addresses (from the BataviaHeat HA integration, confirmed on
// the Silver line 20 with the HomeyScript test).
const A = {
  POWER: 1017, // on/off switch (updateSwitchSate)
  MODE: 1021, // 1 = cool, 2 = heat, 3 = auto
  COOL_SP: 1022,
  HEAT_SP: 1023,
  DHW_SP: 1024,
  SILENT: 1004, // 0 / 1
  COOL_CURVE: 1046, // > 0 = cooling curve active
  HEAT_CURVE: 1047, // > 0 = heating curve active
  COMPRESSOR: 2072,
  ROOM: 2097,
  OUTDOOR: 2099,
  TANK: 2100,
  OUTLET_TOTAL: 2189,
  OUTLET_HP: 2106,
  OUTLET_SYSTEM: 2102,
  FLOW: 2192,
};

// Newntide models (e.g. Silver line 20) use different addresses than the
// BataviaHeat units. Confirmed on a Silver line 20 (Nov 2026) via the parameter
// names the cloud returns (pointName, in Portuguese). Other models may differ:
// correct them with the "Address mapping" device setting.
const A_NEWNTIDE = {
  heatSp: 1003, // 36 °C
  coolSp: 1002, // 14 °C (check)
  dhwSp: 1004, // 60 °C (BataviaHeat uses 1004 for silent mode)
  outlet: 2063, // "Temp. Total de Saída de Água" (confirmed by name)
  tank: 2058, // "Temp. AQS" (confirmed by name)
  outdoor: 2057, // 13.7 °C, matches the airco outdoor sensors
  // compressor: not reported by this model (2142 is the WATER PUMP target speed, not the compressor)
  flow: 2143, // water pump flow, L/h
  inlet: 2138, // "Temp. de Entrada de Água do Permutador": water coming back from the floor
};

// Keys for the "Address mapping" setting: one `key=address` per line, 0 = off.
const MAP_KEYS = {
  heating_setpoint: 'heatSp',
  cooling_setpoint: 'coolSp',
  hot_water_setpoint: 'dhwSp',
  water_outlet: 'outlet',
  hot_water_tank: 'tank',
  outdoor: 'outdoor',
  room: 'room',
  compressor_speed: 'compressor',
  water_flow: 'flow',
  water_inlet: 'inlet',
  silent_mode: 'silent',
};

function parseAddressMap(text) {
  const map = {};
  const errors = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-z_]+)\s*[=:]\s*(\d+)$/i);
    if (!m) {
      errors.push(`Cannot read "${line}" (use key=address)`);
    } else if (!MAP_KEYS[m[1].toLowerCase()]) {
      errors.push(`Unknown key "${m[1]}". Valid: ${Object.keys(MAP_KEYS).join(', ')}`);
    } else {
      map[MAP_KEYS[m[1].toLowerCase()]] = Number(m[2]);
    }
  }
  return { map, errors };
}

const MODE_TO_ID = { 1: 'cool', 2: 'heat', 3: 'auto' };
const ID_TO_MODE = { cool: 1, heat: 2, auto: 3 };

// Optional capabilities: removed when the heat pump never reports them.
// Maps capability -> key in the resolved values (see _resolve).
const OPTIONAL = {
  'measure_temperature.room': 'room',
  'measure_temperature.outdoor': 'outdoor',
  'measure_temperature.tank': 'tank',
  'target_temperature.hot_water': 'dhwSp',
  compressor_speed: 'compressor',
  water_flow: 'flow',
  'onoff.silent': 'silent',
  'measure_temperature.inlet': 'inlet',
};

// Fallback when a model does not use the BataviaHeat addresses: find the
// parameter by the name the cloud gives it (Dutch, English or Chinese).
const SETPOINT_RE = /ingesteld|instelling|setpoint|set\s*point|target|doel|gewenst|设定|目标/i;
// unit: accepted units (an empty unit is always accepted); range: plausible values;
// setpoint: true/false = name must / must not look like a setpoint, null = either;
// preferType: the paramListV3 list (0 sensors, 1 operational, 2 settings) to prefer.
const TEMP = { unit: /°|℃|c$/i, range: [-40, 100] };
const NAME_MATCH = {
  outlet: { ...TEMP, re: /uitlaat|outlet|uitgaand|aanvoer|出水|leaving/i, not: /inlaat|inlet|进水|retour|return|plate|plaat|warmtewisselaar|hx/i, setpoint: false },
  heatSp: { ...TEMP, re: /verwarm|heat|制热|采暖/i, not: /koel|cool|制冷|curve|curv|曲线|zone\s*b|tank|boiler|warm\s*water|tapwater|hot\s*water|热水/i, setpoint: true },
  coolSp: { ...TEMP, re: /koel|cool|制冷/i, not: /curve|curv|曲线|zone\s*b/i, setpoint: true },
  dhwSp: { ...TEMP, re: /warm\s*water|tapwater|hot\s*water|dhw|boiler|tank|sanit|热水|水箱/i, not: /curve|curv|曲线/i, setpoint: true },
  tank: { ...TEMP, re: /warm\s*water|tapwater|hot\s*water|dhw|boiler|tank|sanit|热水|水箱/i, not: /curve|curv|曲线/i, setpoint: false },
  outdoor: { ...TEMP, re: /buiten|outdoor|ambient|omgeving|室外|环境/i, not: /coil|spoel|fin/i, setpoint: false },
  room: { ...TEMP, re: /kamer|ruimte|room|indoor|binnen|室内|房间/i, not: null, setpoint: false },
  compressor: {
    re: /compressor|压缩机/i,
    // ("press" alone would match "comPRESSor" itself, so only the full word "pressure")
    not: /temp|温度|discharge|suction|persgas|zuig|druk|pressure|压力|current|stroom|电流|power|vermogen|功率|time|tijd|uren|hours|count|aantal|fault|storing|error|limit|max|min/i,
    unit: /rpm|r\/min|hz|rps|toeren|转/i, range: [0, 20000], setpoint: false, preferType: 0,
  },
  flow: {
    re: /flow|debiet|doorstroming|stroming|流量/i,
    not: /temp|温度|switch|schakel|fault|storing|error|signal|signaal|speed|snelheid|pump\s*target/i,
    unit: /l\/h|l\/min|m3\/h|m³\/h|lph/i, range: [0, 100000], setpoint: false, preferType: 0,
    // The water_flow capability is in L/h.
    convert: (val, unit) => (/m3|m³/i.test(unit) ? val * 1000 : /min/i.test(unit) ? val * 60 : val),
  },
  silent: {
    re: /silent|stil|quiet|geluidsarm|low\s*noise|静音/i,
    not: /time|tijd|start|end|eind|begin|timer|level|niveau/i,
    unit: null, range: [0, 1], setpoint: null, preferType: 2,
  },
};

const MODE_NAME_RE = { cool: /koel|cool|制冷/i, heat: /verwarm|heat|制热|采暖/i, auto: /auto|自动/i };

function modeEntry(e) {
  const value = e.modeValue ?? e.value ?? e.mode ?? e.code ?? e.modeCode ?? e.id;
  const name = String(e.modeName ?? e.name ?? e.title ?? e.label ?? '').trim();
  return { value: value != null ? Number(value) : undefined, name };
}

const PENDING_MS = 90 * 1000; // keep an optimistic value while the cloud catches up
const MAX_FAILURES = 3;

const HOT_WATER_RE = /warm\s*water|hot\s*water|tap|dhw|boiler|sanit|douche|wws|domestic|热水|生活/i;
const HEATING_RE = /verwarm|heat|zone|ruimte|room|vloer|floor|radiat|klimaat|climate|空调|采暖|地暖/i;

function cardName(card) {
  return card.cardName || card.name || card.title || card.cardTitle || card.modelName || card.functionName || '';
}

module.exports = class HeatPumpDevice extends Homey.Device {

  async onInit() {
    this._values = {};
    this._pending = new Map();
    this._failures = 0;
    this._capsChecked = false;
    this._timer = null;
    this._switches = { power: null, heating: null, hotWater: null };
    this._mode = { address: null, toId: null };
    this._resolved = {};
    this._sources = {};

    await this._migrateCapabilities();
    this._buildClient();

    this.registerCapabilityListener('onoff', v => this.setPower(v));
    this.registerCapabilityListener('onoff.heating', v => this.setHeating(v));
    this.registerCapabilityListener('onoff.hot_water', v => this.setHotWater(v));
    this.registerCapabilityListener('onoff.silent', v => this.setSilent(v));
    this.registerCapabilityListener('heatpump_mode', v => this.setMode(v));
    this.registerCapabilityListener('target_temperature', v => this.setWaterSetpoint(v));
    this.registerCapabilityListener('target_temperature.hot_water', v => this.setHotWaterSetpoint(v));

    await this.setSettings({
      device_code: this.getData().id,
      account: this.getStoreValue('username') || '',
    }).catch(err => this.error('setSettings', err.message));

    this.poll().catch(() => {});
  }

  // Add capabilities that were introduced after this device was paired.
  async _migrateCapabilities() {
    const wanted = this.driver.manifest.capabilities || [];
    for (const cap of wanted) {
      if (!this.hasCapability(cap) && !(cap in OPTIONAL) && cap !== 'onoff.heating' && cap !== 'onoff.hot_water') {
        await this.addCapability(cap).catch(err => this.error('addCapability', cap, err.message));
      }
    }
  }

  _buildClient() {
    const creds = {
      username: this.getStoreValue('username'),
      passwordHash: this.getStoreValue('passwordHash'),
      loginType: Number(this.getSetting('login_type') || this.getStoreValue('loginType') || 2),
    };
    this._creds = creds;
    this._client = this.homey.app && this.homey.app.getClient
      ? this.homey.app.getClient(creds)
      : new EcoHomeClient({ ...creds, log: (...a) => this.log(...a) });
  }

  get code() {
    return this.getData().id;
  }

  // ── polling ──────────────────────────────────────────────────────────────

  _schedule() {
    this.homey.clearTimeout(this._timer);
    const secs = Math.max(30, Number(this.getSetting('poll_interval')) || 60);
    this._timer = this.homey.setTimeout(() => this.poll().catch(() => {}), secs * 1000);
  }

  async poll() {
    this.homey.clearTimeout(this._timer);
    try {
      const {
        values, detail, info = {}, errors = [],
      } = await this._client.getState(this.code);
      this._failures = 0;
      this._detectSwitches(detail);
      await this._apply(values, info, errors);
      this._reportValues(info, errors);
      if (!this.getAvailable()) await this.setAvailable();
      return true;
    } catch (err) {
      this._failures++;
      this.error(`Poll failed (${this._failures}):`, err.message);
      if (err instanceof EcoHomeAuthError) {
        await this.setUnavailable(`Eco-Home login refused (${err.message}). Use "Repair" on this device to log in again.`).catch(() => {});
      } else if (this._failures >= MAX_FAILURES) {
        await this.setUnavailable(`No connection to the Eco-Home cloud: ${err.message}`).catch(() => {});
      }
      throw err;
    } finally {
      this._schedule();
    }
  }

  _detectSwitches(detail) {
    const cards = (detail && detail.cardList) || [];
    const withSwitch = cards.filter(c => c.switchAddress != null);
    let heating = null;
    let hotWater = null;

    for (const c of withSwitch) {
      const name = cardName(c);
      const hasMode = Array.isArray(c.modeList) && c.modeList.length > 0;
      if (!hotWater && !hasMode && HOT_WATER_RE.test(name)) hotWater = c;
      else if (!heating && (hasMode || HEATING_RE.test(name))) heating = c;
    }
    // Two switch cards and one has the mode list: the other one is hot water.
    if (heating && !hotWater && withSwitch.length === 2) hotWater = withSwitch.find(c => c !== heating);

    const manualHeat = Number(this.getSetting('heating_switch_address')) || 0;
    const manualDhw = Number(this.getSetting('hot_water_switch_address')) || 0;
    this._switches = {
      power: detail && detail.switchAddress != null ? Number(detail.switchAddress) : null,
      heating: manualHeat || (heating ? Number(heating.switchAddress) : null),
      hotWater: manualDhw || (hotWater ? Number(hotWater.switchAddress) : null),
    };

    // Operating mode: the card with a mode list tells us the address and what each value means.
    const modeCard = cards.find(c => Array.isArray(c.modeList) && c.modeList.length);
    if (modeCard) {
      const toId = {};
      for (const e of modeCard.modeList.map(modeEntry)) {
        if (e.value === undefined || Number.isNaN(e.value)) continue;
        const id = Object.keys(MODE_NAME_RE).find(k => MODE_NAME_RE[k].test(e.name));
        if (id) toId[e.value] = id;
      }
      const address = modeCard.modeList[0].modeAddress;
      this._mode = {
        address: address != null ? Number(address) : null,
        toId: Object.keys(toId).length ? toId : null,
        list: modeCard.modeList.map(modeEntry).map(e => `${e.value}=${e.name || '?'}`).join(', '),
      };
    }

    const lines = [];
    if (detail && detail.switchAddress != null) lines.push(`Device power: address ${detail.switchAddress} (${isOn(detail.curSwitch) ? 'on' : 'off'})`);
    for (const c of withSwitch) {
      const role = Number(c.switchAddress) === this._switches.heating ? ' → Heating'
        : Number(c.switchAddress) === this._switches.hotWater ? ' → Hot water' : '';
      lines.push(`"${cardName(c) || '(no name)'}": address ${c.switchAddress} (${isOn(c.curSwitch) ? 'on' : 'off'})${c.modeList ? ', has modes' : ''}${role}`);
    }
    if (!withSwitch.length) lines.push('No zone/hot water switches reported by the cloud.');
    if (this._mode.address != null) lines.push(`Mode: address ${this._mode.address} (${this._mode.list || 'no list'})`);
    const text = lines.join('\n');
    if (text !== this._lastSwitchText) {
      this._lastSwitchText = text;
      this.log('Switches:', text.replace(/\n/g, ' | '));
      this.setSettings({ detected_switches: text }).catch(() => {});
    }
  }

  _fresh(address, value) {
    const p = this._pending.get(address);
    if (!p) return value;
    if (Date.now() > p.until || value === p.value) {
      this._pending.delete(address);
      return value;
    }
    return p.value; // cloud has not caught up yet
  }

  async _set(cap, value) {
    if (!this.hasCapability(cap) || value == null || Number.isNaN(value)) return;
    if (this.getCapabilityValue(cap) === value) return;
    await this.setCapabilityValue(cap, value).catch(err => this.error('set', cap, err.message));
  }

  // Find a value by parameter name when the known address is missing.
  _byName(key, v, info) {
    const m = NAME_MATCH[key];
    if (!m) return undefined; // no name rule for this value
    const candidates = [];
    for (const [addrStr, meta] of Object.entries(info)) {
      const addr = Number(addrStr);
      if (v[addr] === undefined || !meta.name) continue;
      const val = m.convert ? m.convert(v[addr], meta.unit) : v[addr];
      if (!m.re.test(meta.name) || (m.not && m.not.test(meta.name))) continue;
      if (m.setpoint !== null && SETPOINT_RE.test(meta.name) !== m.setpoint) continue;
      if (meta.unit && m.unit && !m.unit.test(meta.unit)) continue;
      if (val < m.range[0] || val > m.range[1]) continue;
      // Sensors live in type 0, settings in type 2: prefer the matching list.
      const preferType = m.preferType != null ? m.preferType : (m.setpoint ? 2 : 0);
      const score = meta.type === preferType ? 0 : 1;
      candidates.push({ addr, val, score });
    }
    candidates.sort((a, b) => a.score - b.score || a.addr - b.addr);
    return candidates[0];
  }

  // Turn raw address values into named values, with name-based fallbacks.
  _resolve(v, info) {
    const src = {};
    const manual = parseAddressMap(this.getSetting('address_map')).map;
    // No BataviaHeat addresses in the data → Newntide address set.
    const newntide = v[A.POWER] === undefined && v[A.HEAT_SP] === undefined && v[A.OUTDOOR] === undefined;
    this._profile = newntide ? 'newntide' : 'bataviaheat';
    const pick = (key, defaults) => {
      if (key in manual) {
        const a = manual[key];
        if (a && v[a] !== undefined) {
          src[key] = a;
          return v[a];
        }
        return undefined; // 0 = switched off; no name guessing for manual entries
      }
      const addrs = newntide ? (A_NEWNTIDE[key] ? [A_NEWNTIDE[key]] : []) : defaults;
      for (const a of addrs) {
        if (v[a] !== undefined) {
          src[key] = a;
          return v[a];
        }
      }
      const hit = this._byName(key, v, info);
      if (hit) {
        src[key] = hit.addr;
        return hit.val;
      }
      return undefined;
    };

    const r = {};
    // Power: the device's own switch (getDeviceDetailV3) is what the Eco-Home app uses.
    const powerAddr = this._switches.power != null && v[this._switches.power] !== undefined ? this._switches.power : A.POWER;
    r.power = v[powerAddr];
    src.power = powerAddr;

    const modeAddr = v[A.MODE] !== undefined ? A.MODE : this._mode.address;
    const toId = modeAddr === this._mode.address && this._mode.toId ? this._mode.toId : MODE_TO_ID;
    r.modeRaw = modeAddr != null ? v[modeAddr] : undefined;
    r.mode = r.modeRaw !== undefined ? toId[r.modeRaw] : undefined;
    src.mode = modeAddr;

    r.heatSp = pick('heatSp', [A.HEAT_SP]);
    r.coolSp = pick('coolSp', [A.COOL_SP]);
    r.dhwSp = pick('dhwSp', [A.DHW_SP]);
    r.outlet = pick('outlet', [A.OUTLET_TOTAL, A.OUTLET_HP, A.OUTLET_SYSTEM]);
    r.tank = pick('tank', [A.TANK]);
    r.outdoor = pick('outdoor', [A.OUTDOOR]);
    r.room = pick('room', [A.ROOM]);
    r.compressor = pick('compressor', [A.COMPRESSOR]);
    r.flow = pick('flow', [A.FLOW]);
    r.inlet = pick('inlet', [2187]); // BataviaHeat: plate HX water inlet
    r.silent = pick('silent', [A.SILENT]);
    r.heatCurve = v[A.HEAT_CURVE];
    r.coolCurve = v[A.COOL_CURVE];
    this._sources = src;
    return r;
  }

  async _apply(raw, info = {}, errors = []) {
    const v = {};
    for (const [k, val] of Object.entries(raw)) v[k] = this._fresh(Number(k), val);
    this._values = v;
    const prev = this._resolved;
    const r = this._resolve(v, info);
    this._resolved = r;

    // Optional capabilities: add when present, remove when absent from the first
    // COMPLETE poll. A poll where a parameter list failed proves nothing, and
    // removing a capability throws away its Insights history.
    const mayRemove = !this._capsChecked && errors.length === 0;
    for (const [cap, key] of Object.entries(OPTIONAL)) {
      const present = r[key] !== undefined;
      if (present && !this.hasCapability(cap)) await this.addCapability(cap).catch(err => this.error('addCapability', cap, err.message));
      if (!present && mayRemove && this.hasCapability(cap)) await this.removeCapability(cap).catch(err => this.error('removeCapability', cap, err.message));
    }
    const sw = this._switches;
    if (sw.hotWater && !this.hasCapability('onoff.hot_water')) await this.addCapability('onoff.hot_water').catch(() => {});
    if (!sw.hotWater && mayRemove && this.hasCapability('onoff.hot_water')) await this.removeCapability('onoff.hot_water').catch(() => {});
    if (sw.heating && !this.hasCapability('onoff.heating')) await this.addCapability('onoff.heating').catch(() => {});
    if (!sw.heating && mayRemove && this.hasCapability('onoff.heating')) await this.removeCapability('onoff.heating').catch(() => {});
    if (errors.length === 0) this._capsChecked = true;

    const { mode } = r;
    await this._set('onoff', r.power !== undefined ? r.power === 1 : undefined);
    await this._set('heatpump_mode', mode);
    await this._set('target_temperature', mode === 'cool' ? r.coolSp : r.heatSp);
    await this._set('measure_temperature', r.outlet);
    if (sw.heating && v[sw.heating] !== undefined) await this._set('onoff.heating', v[sw.heating] === 1);
    if (sw.hotWater && v[sw.hotWater] !== undefined) await this._set('onoff.hot_water', v[sw.hotWater] === 1);
    await this._set('onoff.silent', r.silent !== undefined ? r.silent === 1 : undefined);
    await this._set('target_temperature.hot_water', r.dhwSp);
    await this._set('measure_temperature.tank', r.tank);
    await this._set('measure_temperature.room', r.room);
    await this._set('measure_temperature.outdoor', r.outdoor);
    await this._set('compressor_speed', r.compressor);
    await this._set('water_flow', r.flow);
    await this._set('measure_temperature.inlet', r.inlet);

    // Flow triggers (not on the very first poll)
    if (Object.keys(prev).length) {
      const flow = this.homey.flow;
      if (r.tank !== undefined && r.tank !== prev.tank) {
        flow.getDeviceTriggerCard('tank_temperature_changed').trigger(this, { temperature: r.tank }).catch(err => this.error(err));
      }
      if (r.outdoor !== undefined && r.outdoor !== prev.outdoor) {
        flow.getDeviceTriggerCard('outdoor_temperature_changed').trigger(this, { temperature: r.outdoor }).catch(err => this.error(err));
      }
      const wasRunning = (prev.compressor || 0) > 0;
      const running = (r.compressor || 0) > 0;
      if (r.compressor !== undefined && running !== wasRunning) {
        flow.getDeviceTriggerCard(running ? 'compressor_started' : 'compressor_stopped').trigger(this).catch(err => this.error(err));
      }
      if (mode && prev.mode && mode !== prev.mode) {
        flow.getDeviceTriggerCard('mode_changed').trigger(this, { mode }).catch(err => this.error(err));
      }
    }
  }

  // Write every value the cloud returned to the read-only "Values from the cloud" setting.
  _reportValues(info, errors) {
    const used = {};
    const labels = {
      power: 'Heat pump on/off', mode: 'Mode', heatSp: 'Heating setpoint', coolSp: 'Cooling setpoint',
      dhwSp: 'Hot water setpoint', outlet: 'Water outlet', tank: 'Hot water tank', outdoor: 'Outdoor', room: 'Room',
      compressor: 'Compressor speed', flow: 'Water flow', inlet: 'Water return', silent: 'Silent mode',
    };
    for (const [key, addr] of Object.entries(this._sources || {})) {
      if (addr != null && labels[key]) used[addr] = labels[key];
    }
    const lines = [];
    const missing = Object.keys(labels).filter(k => !this._sources || this._sources[k] == null || this._values[this._sources[k]] === undefined);
    if (missing.length) lines.push(`Not found: ${missing.map(k => labels[k]).join(', ')}`);
    for (const e of errors) lines.push(`Error: ${e}`);
    const addrs = Object.keys(info).map(Number).sort((a, b) => a - b);
    if (!addrs.length) lines.push('The cloud returned no parameters.');
    for (const a of addrs) {
      const m = info[a];
      const raw = m.raw == null ? '—' : String(m.raw);
      lines.push(`${a} ${m.name || '(no name)'} = ${raw}${m.unit ? ` ${m.unit}` : ''}${used[a] ? `  → ${used[a]}` : ''}`);
    }
    const text = lines.join('\n');
    if (text === this._lastValuesText) return;
    this._lastValuesText = text;
    if (missing.length) this.log('Values not found:', missing.join(', '));
    this.setSettings({ detected_values: text }).catch(err => this.error('detected_values', err.message));
  }

  // ── writes ───────────────────────────────────────────────────────────────

  _remember(address, value) {
    this._pending.set(address, { value, until: Date.now() + PENDING_MS });
    this._values[address] = value;
  }

  _refreshSoon() {
    this.homey.clearTimeout(this._timer);
    this._timer = this.homey.setTimeout(() => this.poll().catch(() => {}), 8000);
  }

  async setPower(on) {
    const addr = this._switches.power != null ? this._switches.power : A.POWER;
    await this._client.setSwitch(this.code, addr, on);
    this._remember(addr, on ? 1 : 0);
    await this._set('onoff', !!on);
    this._refreshSoon();
  }

  async setHeating(on) {
    const addr = this._switches.heating;
    if (!addr) throw new Error('No heating switch found for this heat pump. See the device settings ("Switches found in the cloud").');
    await this._client.setSwitch(this.code, addr, on);
    this._remember(addr, on ? 1 : 0);
    await this._set('onoff.heating', !!on);
    this._refreshSoon();
  }

  async setHotWater(on) {
    const addr = this._switches.hotWater;
    if (!addr) throw new Error('No hot water switch found for this heat pump. See the device settings ("Switches found in the cloud").');
    await this._client.setSwitch(this.code, addr, on);
    this._remember(addr, on ? 1 : 0);
    await this._set('onoff.hot_water', !!on);
    this._refreshSoon();
  }

  async setSilent(on) {
    const addr = this._sources && this._sources.silent;
    if (!addr) throw new Error('Silent mode address unknown for this heat pump. Add silent_mode=<address> under "Address mapping" in the device settings.');
    await this._client.setValue(this.code, addr, on ? 1 : 0);
    this._remember(addr, on ? 1 : 0);
    await this._set('onoff.silent', !!on);
    this._refreshSoon();
  }

  async setMode(mode) {
    const useCard = this._mode.address != null && (this._mode.address === A.MODE || this._sources.mode === this._mode.address);
    const addr = useCard ? this._mode.address : A.MODE;
    let n = ID_TO_MODE[mode];
    if (useCard && this._mode.toId) {
      const hit = Object.entries(this._mode.toId).find(([, id]) => id === mode);
      if (!hit) throw new Error(`This heat pump does not offer the mode "${mode}" (${this._mode.list}).`);
      n = Number(hit[0]);
    }
    if (!n) throw new Error(`Unknown mode ${mode}`);
    await this._client.setValue(this.code, addr, n);
    this._remember(addr, n);
    await this._set('heatpump_mode', mode);
    this._refreshSoon();
  }

  async setWaterSetpoint(temp) {
    const t = Math.round(Number(temp));
    const mode = this._resolved.mode || this.getCapabilityValue('heatpump_mode') || 'heat';
    const cooling = mode === 'cool';
    const curve = cooling ? this._resolved.coolCurve : this._resolved.heatCurve;
    if (curve > 0) {
      throw new Error(`A ${cooling ? 'cooling' : 'heating'} curve is active, so the heat pump sets the water temperature itself. Turn the curve off in the Eco-Home app to use a fixed temperature.`);
    }
    const [min, max] = cooling ? [10, 35] : [20, 80];
    if (t < min || t > max) throw new Error(`${cooling ? 'Cooling' : 'Heating'} setpoint must be between ${min} and ${max} °C`);
    const src = this._sources || {};
    const addr = (cooling ? src.coolSp : src.heatSp) || (cooling ? A.COOL_SP : A.HEAT_SP);
    await this._client.setValue(this.code, addr, t);
    this._remember(addr, t);
    await this._set('target_temperature', t);
    this._refreshSoon();
  }

  async setHotWaterSetpoint(temp) {
    const t = Math.round(Number(temp));
    if (t < 18 || t > 75) throw new Error('Hot water setpoint must be between 18 and 75 °C');
    const addr = (this._sources && this._sources.dhwSp) || A.DHW_SP;
    await this._client.setValue(this.code, addr, t);
    this._remember(addr, t);
    await this._set('target_temperature.hot_water', t);
    this._refreshSoon();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async updateCredentials(creds) {
    await this.setStoreValue('username', creds.username);
    await this.setStoreValue('passwordHash', creds.passwordHash);
    await this.setStoreValue('loginType', creds.loginType);
    await this.setSettings({ account: creds.username }).catch(() => {});
    this._buildClient();
    this.poll().catch(() => {});
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('address_map')) {
      const { errors } = parseAddressMap(newSettings.address_map);
      if (errors.length) throw new Error(errors.join('\n'));
    }
    if (changedKeys.includes('login_type')) {
      this.homey.setTimeout(() => {
        this._buildClient();
        this.poll().catch(() => {});
      }, 500);
    }
    if (changedKeys.some(k => k === 'heating_switch_address' || k === 'hot_water_switch_address' || k === 'poll_interval' || k === 'address_map')) {
      this.homey.setTimeout(() => this.poll().catch(() => {}), 500);
    }
  }

  async onUninit() {
    this.homey.clearTimeout(this._timer);
  }

  async onDeleted() {
    this.homey.clearTimeout(this._timer);
  }

};
