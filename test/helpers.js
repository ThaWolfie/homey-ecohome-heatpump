'use strict';

// Test helpers: a fake Eco-Home cloud and a fake Homey runtime, so the app can be
// exercised end to end without a heat pump, an account or the Homey SDK.
// Node built-ins only, like the app itself.

const http = require('http');
const Module = require('module');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── fake Homey SDK ──────────────────────────────────────────────────────────

class FakeDevice {

  constructor({ capabilities, settings = {}, store = {} }) {
    this.caps = Object.fromEntries(capabilities.map(c => [c, null]));
    this.settings = { ...settings };
    this.store = { username: 'test@example.com', passwordHash: 'x', ...store };
    this.listeners = {};
    this.available = true;
    this.unavailableReason = null;
    this.errors = [];
  }

  hasCapability(c) { return c in this.caps; }

  async addCapability(c) { if (!(c in this.caps)) this.caps[c] = null; }

  async removeCapability(c) { delete this.caps[c]; }

  getCapabilityValue(c) { return this.caps[c]; }

  async setCapabilityValue(c, v) {
    if (!(c in this.caps)) throw new Error(`Capability ${c} is not on this device`);
    this.caps[c] = v;
  }

  registerCapabilityListener(c, fn) { this.listeners[c] = fn; }

  getSetting(k) { return this.settings[k]; }

  async setSettings(s) { Object.assign(this.settings, s); }

  getStoreValue(k) { return this.store[k]; }

  async setStoreValue(k, v) { this.store[k] = v; }

  getData() { return { id: 'DEV-1' }; }

  getAvailable() { return this.available; }

  async setAvailable() { this.available = true; this.unavailableReason = null; }

  async setUnavailable(reason) { this.available = false; this.unavailableReason = reason; }

  log() {}

  error(...a) { this.errors.push(a.join(' ')); }

}

class FakeDriver {}
class FakeApp {}

let installed = false;
function installHomeyStub() {
  if (installed) return;
  installed = true;
  const orig = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'homey') return { Device: FakeDevice, Driver: FakeDriver, App: FakeApp };
    return orig.call(this, request, ...rest);
  };
}

// ── fake Eco-Home cloud ─────────────────────────────────────────────────────

/** A paramListV3 item in the shape the cloud uses. */
function param(address, addressName, addressValue, unit = '') {
  return {
    address, addressName, addressValue, unit,
  };
}

/** The BataviaHeat address layout (what the app expects by default). */
function knownModel() {
  return {
    params: {
      0: [{
        moduleName: 'Sensors',
        moduleContent: [
          param(2072, 'Compressor speed', '3200', 'rpm'),
          param(2097, 'Room temperature', '20.5', '°C'),
          param(2099, 'Outdoor temperature', '7.5℃'),
          param(2100, 'Hot water tank', '48.0', '°C'),
          param(2187, 'Plate HX water inlet', '30.5', '°C'),
          param(2189, 'Total water outlet', '35.0 °C'),
          param(2192, 'Pump flow rate', '900', 'L/h'),
        ],
      }],
      1: [param(2099, 'Outdoor temperature', 'N/A')], // duplicate without a value
      2: [
        param(1004, 'Silent mode', '0'),
        param(1022, 'Cooling setpoint', '18', '°C'),
        param(1023, 'Heating setpoint', '40', '°C'),
        param(1024, 'Hot water setpoint', '50', '°C'),
        param(1046, 'Cooling curve', '0'),
        param(1047, 'Heating curve', '0'),
      ],
    },
    detail: {
      switchAddress: 1017,
      curSwitch: true,
      cardList: [
        {
          cardName: 'Verwarming',
          switchAddress: 1100,
          curSwitch: 'true',
          curMode: 2,
          modeList: [
            { modeAddress: 1021, modeValue: 1, modeName: 'Koelen' },
            { modeAddress: 1021, modeValue: 2, modeName: 'Verwarmen' },
            { modeAddress: 1021, modeValue: 3, modeName: 'Auto' },
          ],
        },
        { cardName: 'Warm water', switchAddress: 1101, curSwitch: '0' },
      ],
    },
  };
}

/**
 * Newntide layout (Silver line 20): none of the BataviaHeat addresses, names
 * in Portuguese under `pointName`.
 */
function newntideModel() {
  const pt = (address, pointName, addressValue, unit = '') => ({
    address, pointName, addressValue, unit,
  });
  return {
    params: {
      0: [{
        moduleContent: [
          pt(2057, 'Temp. Ambiente Exterior', '13.7', '°C'),
          pt(2058, 'Temp. AQS', '52.0', '°C'),
          pt(2063, 'Temp. Total de Saída de Água', '34.5', '°C'),
          pt(2138, 'Temp. de Entrada de Água do Permutador', '30.0', '°C'),
          pt(2142, 'Velocidade alvo da bomba', '2800', 'rpm'),
          pt(2143, 'Caudal da bomba', '850', 'L/h'),
        ],
      }],
      1: [],
      2: [
        pt(1002, 'Set point arrefecimento', '14', '°C'),
        pt(1003, 'Set point aquecimento', '36', '°C'),
        pt(1004, 'Set point AQS', '60', '°C'),
      ],
    },
    detail: {
      switchAddress: 1000,
      curSwitch: 1,
      cardList: [
        {
          cardName: 'Aquecimento',
          switchAddress: 1010,
          curSwitch: true,
          curMode: 2,
          modeList: [{ modeAddress: 1001, modeValue: 1, modeName: 'Cool' }, { modeAddress: 1001, modeValue: 2, modeName: 'Heat' }],
        },
        { cardName: 'AQS', switchAddress: 1011, curSwitch: false },
      ],
    },
  };
}

/** A model that uses other addresses: everything must be found by name. */
function otherModel() {
  return {
    params: {
      0: [{
        moduleContent: [
          param(3010, 'Compressor frequentie', '48', 'Hz'),
          param(3011, 'Compressor temperatuur', '60', '°C'),
          param(3020, 'Waterdebiet', '1.2', 'm³/h'),
          param(3030, 'Buitentemperatuur', '6℃'),
          param(3031, 'Wateruitlaat temperatuur', '33.5℃'),
          param(3032, 'Boiler temperatuur', '48', '°C'),
        ],
      }],
      1: [],
      2: [
        param(5001, 'Stille modus', 'ON'),
        param(5002, 'Stille modus starttijd', '22'),
        param(5003, 'Verwarmen setpoint', '38', '°C'),
      ],
    },
    detail: { switchAddress: 1017, curSwitch: '0', cardList: [] },
  };
}

/**
 * Start a fake cloud. `state.model` decides what it returns; tweak `state.fail`
 * ({ [paramType]: true }), `state.expireNext` (answer the next call with
 * sub_code -100) or `state.loginRefused` to simulate trouble.
 * Every request is recorded in `state.calls`, writes in `state.writes`.
 */
async function startCloud(model = knownModel()) {
  const state = {
    model, fail: {}, expireNext: false, loginRefused: false, calls: [], writes: [], logins: 0,
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      const route = new URL(req.url, 'http://x').pathname;
      state.calls.push({ route, json, token: req.headers['x-token'] });
      let out;
      if (route.endsWith('/user/login.json')) {
        state.logins++;
        out = state.loginRefused
          ? { error_code: '1', error_msg: 'wrong password' }
          : { error_code: '0', object_result: { 'x-token': `tok${state.logins}`, user_id: 7 } };
      } else if (state.expireNext) {
        state.expireNext = false;
        out = { sub_code: '-100', sub_msg: 'session expired' };
      } else if (route.endsWith('/deviceInfo/paramListV3')) {
        out = state.fail[json.type]
          ? { errorCode: 500, errorMsg: 'boom' }
          : { errorCode: 200, objectResult: state.model.params[json.type] || [] };
      } else if (route.endsWith('/deviceInfo/getDeviceDetailV3')) {
        out = { errorCode: 200, objectResult: state.model.detail };
      } else if (route.endsWith('/deviceInfo/controlOfValue.json') || route.endsWith('/deviceInfo/updateSwitchSate.json')) {
        state.writes.push({ route: route.split('/').pop(), ...json });
        out = { error_code: '0' };
      } else if (route.endsWith('/device/deviceList.json')) {
        out = { error_code: '0', object_result: [{ device_code: 'DEV-1', device_nick_name: 'Warmtepomp' }] };
      } else if (route.endsWith('/device/getMyAcceptDeviceShareDataList.json')) {
        out = { error_code: '0', object_result: [{ device_code: 'DEV-2', device_name: 'Shared' }, { device_code: 'DEV-1' }] };
      } else {
        res.statusCode = 404;
        out = {};
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(out));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const host = `http://127.0.0.1:${server.address().port}`;
  return { state, host, close: () => new Promise(resolve => server.close(resolve)) };
}

// ── device under test ───────────────────────────────────────────────────────

/**
 * Create a heat pump device wired to the fake cloud, run onInit and wait for
 * its first poll. Timers are captured instead of run, so nothing polls behind
 * the test's back.
 */
async function createDevice(cloud, { capabilities, settings } = {}) {
  installHomeyStub();
  const { EcoHomeClient } = require(path.join(ROOT, 'lib/EcoHomeClient'));
  const HeatPumpDevice = require(path.join(ROOT, 'drivers/heatpump/device'));
  const manifest = require(path.join(ROOT, 'app.json')).drivers.find(d => d.id === 'heatpump');

  const triggers = [];
  const device = new HeatPumpDevice({ capabilities: capabilities || manifest.capabilities, settings });
  device.driver = { manifest };
  device.homey = {
    app: null,
    setTimeout: () => 1,
    clearTimeout: () => {},
    flow: {
      getDeviceTriggerCard: id => ({
        trigger: async (dev, tokens) => { triggers.push({ id, tokens }); },
      }),
    },
  };
  device.triggers = triggers;
  // Point the client at the fake cloud instead of ehome.ne01.com.
  device._buildClient = function buildClient() {
    this._client = new EcoHomeClient({
      username: 'test@example.com', passwordHash: 'x', host: cloud.host,
    });
  };
  // onInit starts the first poll without awaiting it; wait for it here.
  const firstPoll = new Promise(resolve => {
    const orig = device.poll.bind(device);
    let first = true;
    device.poll = async (...a) => {
      try {
        return await orig(...a);
      } finally {
        if (first) { first = false; resolve(); }
      }
    };
  });
  await device.onInit();
  await firstPoll;
  return device;
}

module.exports = {
  ROOT, param, knownModel, newntideModel, otherModel, startCloud, createDevice, installHomeyStub,
};
