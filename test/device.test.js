'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startCloud, createDevice, knownModel, newntideModel, otherModel, param,
} = require('./helpers');

test('a Newntide heat pump (Silver line 20 layout) uses the Newntide addresses', async t => {
  const cloud = await startCloud(newntideModel());
  t.after(cloud.close);
  const d = await createDevice(cloud);

  assert.equal(d._profile, 'newntide');
  assert.equal(d.caps.onoff, true);
  assert.equal(d.caps.heatpump_mode, 'heat');
  assert.equal(d.caps.target_temperature, 36);
  assert.equal(d.caps['target_temperature.hot_water'], 60, '1004 is the hot water setpoint here, not silent mode');
  assert.equal(d.caps.measure_temperature, 34.5);
  assert.equal(d.caps['measure_temperature.inlet'], 30);
  assert.equal(d.caps['measure_temperature.tank'], 52);
  assert.equal(d.caps['measure_temperature.outdoor'], 13.7);
  assert.equal(d.caps.water_flow, 850);
  assert.equal(d.caps['onoff.heating'], true);
  assert.equal(d.caps['onoff.hot_water'], false);
  // The water pump speed (2142) must not show up as compressor speed.
  assert.equal(d.hasCapability('compressor_speed'), false);
  assert.equal(d.hasCapability('onoff.silent'), false);

  await d.listeners['target_temperature'](38);
  assert.deepEqual(cloud.state.writes.at(-1), {
    route: 'controlOfValue.json', device_code: 'DEV-1', address: '1003', value: 38,
  });
  await d.listeners['target_temperature.hot_water'](55);
  assert.equal(cloud.state.writes.at(-1).address, '1004');
  await d.listeners.heatpump_mode('cool');
  assert.deepEqual([cloud.state.writes.at(-1).address, cloud.state.writes.at(-1).value], ['1001', 1]);
  await d.listeners.onoff(false);
  assert.deepEqual([cloud.state.writes.at(-1).route, cloud.state.writes.at(-1).address], ['updateSwitchSate.json', '1000']);
});

test('the "Address mapping" setting overrides the built-in addresses', async t => {
  const cloud = await startCloud(newntideModel());
  t.after(cloud.close);
  const d = await createDevice(cloud, { settings: { address_map: '# my unit\nwater_outlet=2138\nwater_inlet = 0\ncompressor_speed=2142' } });
  assert.equal(d.caps.measure_temperature, 30, 'water_outlet moved to 2138');
  assert.equal(d.hasCapability('measure_temperature.inlet'), false, '0 switches a value off');
  assert.equal(d.caps.compressor_speed, 2800);

  await assert.rejects(
    d.onSettings({ newSettings: { address_map: 'outlet 12\nbogus=1' }, changedKeys: ['address_map'] }),
    /Cannot read "outlet 12"[\s\S]*Unknown key "bogus"/,
  );
});

test('a heat pump with the known addresses fills every capability', async t => {
  const cloud = await startCloud(knownModel());
  t.after(cloud.close);
  const d = await createDevice(cloud);

  assert.equal(d.available, true);
  assert.deepEqual(d.errors, []);
  assert.deepEqual(d.caps, {
    onoff: true,
    heatpump_mode: 'heat',
    target_temperature: 40,
    measure_temperature: 35,
    'measure_temperature.inlet': 30.5,
    'onoff.heating': true,
    'onoff.hot_water': false,
    'target_temperature.hot_water': 50,
    'measure_temperature.tank': 48,
    'onoff.silent': false,
    'measure_temperature.room': 20.5,
    'measure_temperature.outdoor': 7.5,
    compressor_speed: 3200,
    water_flow: 900,
  });
  assert.doesNotMatch(d.settings.detected_values, /Not found/);
  assert.match(d.settings.detected_switches, /Device power: address 1017 \(on\)/);
});

test('a heat pump with other addresses is matched by parameter name', async t => {
  const cloud = await startCloud(otherModel());
  t.after(cloud.close);
  const d = await createDevice(cloud);

  assert.equal(d.caps.measure_temperature, 33.5);
  assert.equal(d.caps['measure_temperature.outdoor'], 6);
  assert.equal(d.caps['measure_temperature.tank'], 48);
  assert.equal(d.caps.target_temperature, 38);
  assert.equal(d.caps.compressor_speed, 48, 'compressor frequency, not compressor temperature');
  assert.equal(d.caps.water_flow, 1200, 'm³/h is converted to L/h');
  assert.equal(d.caps['onoff.silent'], true, 'silent mode, not its start time');
  assert.equal(d.caps.onoff, false, 'curSwitch "0" is off');
  // Absent values: capability removed, and listed as not found.
  assert.equal(d.hasCapability('measure_temperature.room'), false);
  assert.match(d.settings.detected_values, /^Not found: .*Room/);

  await d.setSilent(false);
  assert.deepEqual(cloud.state.writes.at(-1), {
    route: 'controlOfValue.json', device_code: 'DEV-1', address: '5001', value: 0,
  }, 'silent mode is written to the address it was read from');
});

test('a partly failed first poll does not remove capabilities', async t => {
  const cloud = await startCloud(knownModel());
  t.after(cloud.close);
  cloud.state.fail[0] = true;
  const d = await createDevice(cloud);

  for (const cap of ['measure_temperature.room', 'measure_temperature.outdoor', 'measure_temperature.tank', 'compressor_speed', 'water_flow']) {
    assert.equal(d.hasCapability(cap), true, `${cap} kept after a failed sensor list`);
  }
  assert.match(d.settings.detected_values, /Error: paramListV3 type 0/);

  cloud.state.fail[0] = false;
  await d.poll();
  assert.equal(d.caps.compressor_speed, 3200);
  assert.equal(d.caps['measure_temperature.outdoor'], 7.5);
});

test('the device goes unavailable after repeated failures and recovers', async t => {
  const cloud = await startCloud(knownModel());
  t.after(cloud.close);
  const d = await createDevice(cloud);
  const detail = cloud.state.model.detail;
  cloud.state.model.detail = undefined; // getDeviceDetailV3 now returns nothing useful…
  const origCall = d._client._call.bind(d._client);
  d._client._call = async (p, ...rest) => {
    if (p.endsWith('getDeviceDetailV3')) throw new Error('HTTP 502');
    return origCall(p, ...rest);
  };
  for (let i = 0; i < 3; i++) await assert.rejects(d.poll());
  assert.equal(d.available, false);

  d._client._call = origCall;
  cloud.state.model.detail = detail;
  await d.poll();
  assert.equal(d.available, true);
});

test('a refused login makes the device unavailable with a repair hint', async t => {
  const cloud = await startCloud(knownModel());
  t.after(cloud.close);
  cloud.state.loginRefused = true;
  const d = await createDevice(cloud);
  assert.equal(d.available, false);
  assert.match(d.unavailableReason, /Repair/);
});

test('controls write to the right addresses', async t => {
  const cloud = await startCloud(knownModel());
  t.after(cloud.close);
  const d = await createDevice(cloud);
  const last = () => {
    const { route, address, value } = cloud.state.writes.at(-1);
    return [route, address, value];
  };

  await d.listeners.onoff(false);
  assert.deepEqual(last(), ['updateSwitchSate.json', '1017', false]);
  assert.equal(d.caps.onoff, false);

  await d.listeners['onoff.heating'](false);
  assert.deepEqual(last(), ['updateSwitchSate.json', '1100', false]);

  await d.listeners['onoff.hot_water'](true);
  assert.deepEqual(last(), ['updateSwitchSate.json', '1101', true]);

  await d.listeners['target_temperature'](42.4);
  assert.deepEqual(last(), ['controlOfValue.json', '1023', 42]);

  await d.listeners['target_temperature.hot_water'](55);
  assert.deepEqual(last(), ['controlOfValue.json', '1024', 55]);

  await d.listeners.heatpump_mode('cool');
  assert.deepEqual(last(), ['controlOfValue.json', '1021', 1]);
  assert.equal(d.caps.heatpump_mode, 'cool');

  // In cooling mode the setpoint goes to the cooling address.
  await d.poll(); // the optimistic mode value is kept while the cloud catches up
  await d.listeners['target_temperature'](20);
  assert.deepEqual(last(), ['controlOfValue.json', '1022', 20]);

  // An optimistic value survives a poll where the cloud still has the old value.
  await d.listeners.onoff(true);
  cloud.state.model.detail = { ...cloud.state.model.detail, curSwitch: false };
  await d.poll();
  assert.equal(d.caps.onoff, true);
});

test('setpoints are range-checked and blocked while a curve is active', async t => {
  const model = knownModel();
  model.params[2] = model.params[2].map(p => (p.address === 1047 ? param(1047, 'Heating curve', '5') : p));
  const cloud = await startCloud(model);
  t.after(cloud.close);
  const d = await createDevice(cloud);
  const writes = cloud.state.writes.length;

  await assert.rejects(d.listeners['target_temperature'](45), /curve is active/);
  await assert.rejects(d.listeners['target_temperature.hot_water'](90), /between 18 and 75/);
  assert.equal(cloud.state.writes.length, writes, 'nothing was written');
});

test('flow cards trigger on changes after the first poll', async t => {
  const cloud = await startCloud(knownModel());
  t.after(cloud.close);
  const d = await createDevice(cloud);
  assert.deepEqual(d.triggers, [], 'no triggers on the first poll');

  const sensors = cloud.state.model.params[0][0].moduleContent;
  sensors.find(p => p.address === 2072).addressValue = '0';
  sensors.find(p => p.address === 2099).addressValue = '3.0';
  sensors.find(p => p.address === 2100).addressValue = '51.5';
  await d.poll();

  assert.deepEqual(d.triggers.map(x => x.id).sort(), ['compressor_stopped', 'outdoor_temperature_changed', 'tank_temperature_changed']);
  assert.deepEqual(d.triggers.find(x => x.id === 'outdoor_temperature_changed').tokens, { temperature: 3 });
});
