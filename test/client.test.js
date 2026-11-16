'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT, startCloud, knownModel } = require('./helpers');

const {
  EcoHomeClient, EcoHomeAuthError, toNumber, isOn,
} = require(path.join(ROOT, 'lib/EcoHomeClient'));

const client = cloud => new EcoHomeClient({ username: 'test@example.com', passwordHash: 'x', host: cloud.host });

test('toNumber reads the formats the cloud sends', () => {
  const cases = [
    ['45.5', 45.5], ['45.5℃', 45.5], ['38 °C', 38], ['1,5', 1.5], ['-3.2', -3.2], ['0', 0],
    [12, 12], [true, 1], [false, 0], ['ON', 1], ['off', 0], ['开', 1], ['关', 0],
    ['N/A', undefined], ['null', undefined], ['', undefined], [null, undefined], [undefined, undefined],
    ['abc', undefined], [NaN, undefined],
  ];
  for (const [input, expected] of cases) assert.equal(toNumber(input), expected, `toNumber(${JSON.stringify(input)})`);
});

test('isOn treats "0" and "false" as off', () => {
  for (const v of [true, 1, '1', 'true', 'ON']) assert.equal(isOn(v), true, `isOn(${JSON.stringify(v)})`);
  for (const v of [false, 0, '0', 'false', 'off', null, undefined, '']) assert.equal(isOn(v), false, `isOn(${JSON.stringify(v)})`);
});

test('hashPassword is the MD5 hex digest the cloud expects', () => {
  assert.equal(EcoHomeClient.hashPassword('password'), '5f4dcc3b5aa765d61d8327deb882cf99');
});

test('getState reads all three parameter lists and the device detail', async t => {
  const cloud = await startCloud();
  t.after(cloud.close);
  const { values, info, errors } = await client(cloud).getState('DEV-1');

  assert.deepEqual(errors, []);
  const routes = cloud.state.calls.map(c => c.route.split('/').pop());
  assert.deepEqual(routes, ['login.json', 'paramListV3', 'paramListV3', 'paramListV3', 'getDeviceDetailV3']);
  assert.deepEqual(cloud.state.calls.filter(c => c.route.endsWith('paramListV3')).map(c => c.json),
    [0, 1, 2].map(type => ({ deviceCode: 'DEV-1', type, isAutoRefresh: false })));

  // Values nested in moduleContent, values with units, and top-level items.
  assert.equal(values[2072], 3200);
  assert.equal(values[2099], 7.5);
  assert.equal(values[2189], 35);
  assert.equal(values[1023], 40);
  // An "N/A" duplicate in a later list must not wipe the real value or its diagnostics.
  assert.equal(info[2099].raw, '7.5℃');
  assert.equal(info[2099].type, 0);
  // Switches and mode from getDeviceDetailV3, with string booleans handled.
  assert.equal(values[1017], 1);
  assert.equal(values[1100], 1);
  assert.equal(values[1101], 0, 'curSwitch "0" must read as off');
  assert.equal(values[1021], 2);
});

test('getState keeps going when one parameter list fails', async t => {
  const cloud = await startCloud();
  t.after(cloud.close);
  cloud.state.fail[0] = true;
  const { values, errors } = await client(cloud).getState('DEV-1');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /type 0/);
  assert.equal(values[2072], undefined);
  assert.equal(values[1023], 40, 'the other lists are still read');
});

test('an expired session logs in again and retries once', async t => {
  const cloud = await startCloud();
  t.after(cloud.close);
  const c = client(cloud);
  await c.login();
  cloud.state.expireNext = true;
  const { values } = await c.getState('DEV-1');
  assert.equal(cloud.state.logins, 2);
  assert.equal(values[2072], 3200);
  assert.equal(cloud.state.calls.at(-1).token, 'tok2', 'later calls use the new token');
});

test('a refused login is reported as an auth error', async t => {
  const cloud = await startCloud();
  t.after(cloud.close);
  cloud.state.loginRefused = true;
  await assert.rejects(client(cloud).getState('DEV-1'), EcoHomeAuthError);
});

test('getDevices merges owned and shared devices without duplicates', async t => {
  const cloud = await startCloud();
  t.after(cloud.close);
  const devices = await client(cloud).getDevices();
  assert.deepEqual(devices.map(d => d.device_code), ['DEV-1', 'DEV-2']);
});

test('writes use the endpoints and payloads the cloud expects', async t => {
  const cloud = await startCloud(knownModel());
  t.after(cloud.close);
  const c = client(cloud);
  await c.setValue('DEV-1', 1023, 42);
  await c.setSwitch('DEV-1', 1017, false);
  assert.deepEqual(cloud.state.writes, [
    {
      route: 'controlOfValue.json', device_code: 'DEV-1', address: '1023', value: 42,
    },
    {
      route: 'updateSwitchSate.json', device_code: 'DEV-1', address: '1017', value: false,
    },
  ]);
});
