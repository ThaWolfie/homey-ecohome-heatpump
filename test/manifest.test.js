'use strict';

// Checks that the code and the app manifest still agree with each other.
// `homey app validate` checks the manifest on its own, not against the code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// Source without comments, so commented-out code does not count as "used".
const code = f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const app = JSON.parse(read('app.json'));
const driver = app.drivers.find(d => d.id === 'heatpump');
const deviceSrc = code('drivers/heatpump/device.js');
const driverSrc = code('drivers/heatpump/driver.js');

test('app.json is up to date with .homeycompose and the driver compose files', () => {
  const compose = JSON.parse(read('.homeycompose/app.json'));
  for (const key of ['id', 'version', 'sdk', 'compatibility']) {
    assert.deepEqual(app[key], compose[key], `app.json "${key}" differs from .homeycompose/app.json: run homey app build`);
  }
  const driverCompose = JSON.parse(read('drivers/heatpump/driver.compose.json'));
  assert.deepEqual(driver.capabilities, driverCompose.capabilities, 'driver capabilities differ: run homey app build');

  const flowCompose = JSON.parse(read('drivers/heatpump/driver.flow.compose.json'));
  for (const kind of ['triggers', 'conditions', 'actions']) {
    const ids = (app.flow[kind] || []).map(c => c.id).sort();
    assert.deepEqual(ids, flowCompose[kind].map(c => c.id).sort(), `${kind} differ: run homey app build`);
  }
  for (const f of fs.readdirSync(path.join(ROOT, '.homeycompose/capabilities'))) {
    const id = path.basename(f, '.json');
    assert.ok(app.capabilities && app.capabilities[id], `custom capability ${id} missing from app.json: run homey app build`);
  }
});

test('every capability the code uses is declared on the driver', () => {
  const used = new Set();
  for (const re of [/registerCapabilityListener\('([^']+)'/g, /this\._set\('([^']+)'/g, /^\s+'?([a-z_]+(?:\.[a-z_]+)?)'?: '[a-zA-Z]+',$/gm]) {
    for (const m of deviceSrc.matchAll(re)) used.add(m[1]);
  }
  // The regex for OPTIONAL entries also matches other maps; keep capability-shaped ids only.
  const caps = [...used].filter(c => /^(onoff|measure_|target_|heatpump_mode|compressor_speed|water_flow)/.test(c));
  assert.ok(caps.length >= 13, `expected to find the capabilities in device.js, found: ${caps.join(', ')}`);
  for (const cap of caps) assert.ok(driver.capabilities.includes(cap), `device.js uses ${cap}, which is not in driver.compose.json`);
});

test('every flow card in the manifest has a handler, and the other way round', () => {
  const registered = new Set([...driverSrc.matchAll(/get(Action|Condition)Card\('([^']+)'\)/g)].map(m => m[2]));
  const triggered = new Set([...deviceSrc.matchAll(/getDeviceTriggerCard\(([^)]+)\)/g)]
    .flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])));

  for (const card of [...app.flow.actions, ...app.flow.conditions]) {
    assert.ok(registered.has(card.id), `flow card ${card.id} has no run listener in driver.js`);
  }
  for (const id of registered) {
    assert.ok([...app.flow.actions, ...app.flow.conditions].some(c => c.id === id), `driver.js registers ${id}, which is not in the manifest`);
  }
  for (const card of app.flow.triggers) assert.ok(triggered.has(card.id), `trigger ${card.id} is never fired by device.js`);
  for (const id of triggered) assert.ok(app.flow.triggers.some(c => c.id === id), `device.js fires ${id}, which is not in the manifest`);
});

test('the driver and the device modules load', () => {
  require('./helpers').installHomeyStub();
  assert.equal(typeof require(path.join(ROOT, 'drivers/heatpump/driver.js')), 'function');
  assert.equal(typeof require(path.join(ROOT, 'drivers/heatpump/device.js')), 'function');
  assert.equal(typeof require(path.join(ROOT, 'app.js')), 'function');
});
