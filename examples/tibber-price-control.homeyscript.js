// Tibber price control for the Eco-Home Heat Pump app — HomeyScript example
// https://github.com/ThaWolfie/homey-ecohome-heatpump
//
// Setup:
//  1. HomeyScript → New script → paste this file.
//  2. Fill in heatPumpId (Homey Developer Tools → Devices → your heat pump → ID)
//     and the exact name of your room thermometer in sensorName.
//  3. Click Test: with dryRun true it only logs what it would do.
//  4. Create a Flow: WHEN Date & time › Every 5 minutes, THEN HomeyScript › Run this script.
//  5. When the log looks right, set dryRun to false (heating and hot water separately).
//
// Requires the Tibber app (price level) and a room temperature sensor.
// Controls two switches on the heat pump, based on the Tibber price level:
//  1. HEATING zone (onoff.heating): room temperature sensor + price.
//  2. HOT WATER (onoff.hot_water): only in cheap hours, unless the tank gets too cold.
// Run it from a flow every 5 minutes (see bottom of this file).

const CONFIG = {
  heatPumpId: 'PUT-YOUR-HEAT-PUMP-DEVICE-ID-HERE', // Eco-Home Heat Pump device ID
  autoVariable: 'Verwarming automatisch', // optional Logic Yes/No variable; No = script does nothing

  heating: {
    enabled: true,
    cap: 'onoff.heating',                  // "Verwarming" toggle
    sensorName: 'Living room thermometer', // exact Homey name of your room temperature sensor
    maxTemp: 21.5,      // never heat at or above this (°C)
    startBelow: {       // start heating below this temperature, per Tibber level
      VERY_CHEAP: 20.8, // top up while power is cheap
      CHEAP: 20.8,
      NORMAL: 20.5,
    },
    blockLevels: ['EXPENSIVE', 'VERY_EXPENSIVE'], // no heating at these levels…
    minTemp: 20.3,      // …unless the room drops below this (comfort floor)
    floorBand: 0.5,     // in floor mode, heat until minTemp + floorBand (0.2 = stop at 20.5)
    minOnMinutes: 30,   // after switching on, keep running at least this long
    minOffMinutes: 20,  // after switching off, wait at least this long
    sensorStaleMinutes: 180, // ignore the sensor if it hasn't reported for this long
    dryRun: true,        // true = only log. Set to false once you're happy.
  },

  hotWater: {
    enabled: true,
    cap: 'onoff.hot_water',                // "Warm water" toggle
    tankCap: 'measure_temperature.tank',   // tank temperature (Temp. AQS)
    allowLevels: ['VERY_CHEAP', 'CHEAP'],  // heat the tank only at these price levels…
    safetyBelow: 50,    // …unless the tank drops below this (°C): then heat anyway…
    safetyUntil: 54,    // …until it reaches this (°C). Must be BELOW the heat pump's own setpoint (Temp. AQS 55).
    minOnMinutes: 30,   // don't cut a tank heat-up short because the price changed
    // Weekly disinfection (G01/G02) needs hot water ON at its scheduled time.
    // Match this to the schedule on the controller. day: 0 = Sunday … 6 = Saturday.
    alwaysOn: [{ day: 0, from: '10:00', to: '12:00' }],
    tankStaleMinutes: 240, // treat the tank as unknown if Homey hasn't updated it for this long (it only updates on change)
    dryRun: true,        // true = only log. Set to false once you're happy.
  },
};

const LEVELS = ['VERY_CHEAP', 'CHEAP', 'NORMAL', 'EXPENSIVE', 'VERY_EXPENSIVE'];
const now = Date.now();
const lines = [];
const out = (s) => { log(s); lines.push(s); };

// ── shared state ──────────────────────────────────────────────────────────
const devices = Object.values(await Homey.devices.getDevices());
const hp = devices.find(d => d.id === CONFIG.heatPumpId);
if (!hp) throw new Error('Heat pump not found: check CONFIG.heatPumpId');
const caps = hp.capabilitiesObj || {};

let auto = true;
try {
  const vars = Object.values(await Homey.logic.getVariables());
  const v = vars.find(x => x.name === CONFIG.autoVariable);
  if (v) auto = v.value !== false;
} catch (e) { /* no Logic access: stay enabled */ }
if (!auto) return `Paused (${CONFIG.autoVariable} = No). Heat pump left as it is.`;

const levelOf = d => Object.values(d.capabilitiesObj || {})
  .find(c => typeof c.value === 'string' && LEVELS.includes(c.value.toUpperCase()));
const tibber = devices.find(d => /tibber/i.test(d.driverId || d.driverUri || '') && levelOf(d));
let level = 'NORMAL';
if (tibber) level = levelOf(tibber).value.toUpperCase();
else log('⚠️ Tibber price level not found, treating price as NORMAL');

// Local time in Amsterdam (Homey may run in UTC)
function localNow() {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Amsterdam', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    return { day, minutes: Number(p.hour) * 60 + Number(p.minute) };
  } catch (e) {
    const d = new Date(now);
    return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }
}
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Switch helper: applies the min on/off times and dry run. key = 'vt' (heating) or 'dhw'.
async function switchTo(key, cap, isOn, want, opts, label, reason, hardStop) {
  if (want === isOn) return `${label} ${isOn ? 'on' : 'off'} → no change (${reason})`;
  const onFor = (now - (global.get(`${key}_last_on`) || 0)) / 60000;
  const offFor = (now - (global.get(`${key}_last_off`) || 0)) / 60000;
  if (!want && !hardStop && opts.minOnMinutes && onFor < opts.minOnMinutes) {
    return `${label} on → wait, on for only ${Math.round(onFor)} of ${opts.minOnMinutes} min (${reason})`;
  }
  if (want && opts.minOffMinutes && offFor < opts.minOffMinutes) {
    return `${label} off → wait, off for only ${Math.round(offFor)} of ${opts.minOffMinutes} min (${reason})`;
  }
  if (!opts.dryRun) {
    await Homey.devices.setCapabilityValue({ deviceId: hp.id, capabilityId: cap, value: want });
    global.set(want ? `${key}_last_on` : `${key}_last_off`, now);
  }
  return `${opts.dryRun ? '[DRY RUN] ' : ''}${label} ${isOn ? 'on' : 'off'} → ${want ? 'ON' : 'OFF'} (${reason})`;
}

out(`Price ${level}`);

// ── 1. heating ────────────────────────────────────────────────────────────
const H = CONFIG.heating;
if (H.enabled && caps[H.cap]) {
  const isOn = caps[H.cap].value === true;
  const sensor = devices.find(d => d.name === H.sensorName);
  const tCap = sensor && sensor.capabilitiesObj && sensor.capabilitiesObj.measure_temperature;
  let temp = tCap && typeof tCap.value === 'number' ? tCap.value : null;
  const ageMin = tCap && tCap.lastUpdated ? (now - new Date(tCap.lastUpdated).getTime()) / 60000 : Infinity;
  if (!sensor) out(`⚠️ Sensor "${H.sensorName}" not found`);
  else if (sensor.available === false || ageMin > H.sensorStaleMinutes) {
    out(`⚠️ Room sensor unavailable or silent for ${Math.round(ageMin)} min, ignoring it`);
    temp = null;
  }

  const expensive = H.blockLevels.includes(level);
  const lastMode = global.get('vt_mode');
  let want; let mode; let reason;
  if (temp === null) {
    want = !expensive; mode = want ? 'normal' : 'off';
    reason = `no room temperature, price ${level}`;
  } else if (temp >= H.maxTemp) {
    want = false; mode = 'off';
    reason = `${temp} °C ≥ max ${H.maxTemp} °C`;
  } else if (expensive) {
    const keepFloor = isOn && lastMode === 'floor' && temp < H.minTemp + H.floorBand;
    want = temp < H.minTemp || keepFloor; mode = want ? 'floor' : 'off';
    reason = want ? `price ${level} but ${temp} °C below comfort floor` : `price ${level}, ${temp} °C`;
  } else {
    const start = H.startBelow[level] != null ? H.startBelow[level] : H.startBelow.NORMAL;
    want = isOn || temp < start; mode = want ? 'normal' : 'off';
    reason = want ? `${temp} °C < ${isOn ? H.maxTemp : start} °C` : `${temp} °C, waiting until < ${start} °C`;
  }
  const atMax = temp !== null && temp >= H.maxTemp;
  out(await switchTo('vt', H.cap, isOn, want, H, 'Heating', reason, atMax));
  if (!H.dryRun) global.set('vt_mode', mode);
} else if (H.enabled) out(`⚠️ Heat pump has no ${H.cap} capability`);

// ── 2. hot water ──────────────────────────────────────────────────────────
const W = CONFIG.hotWater;
if (W.enabled && caps[W.cap]) {
  const isOn = caps[W.cap].value === true;
  const tank = caps[W.tankCap];
  let tankTemp = tank && typeof tank.value === 'number' ? tank.value : null;
  const tankAge = tank && tank.lastUpdated ? (now - new Date(tank.lastUpdated).getTime()) / 60000 : Infinity;
  if (tankTemp !== null && tankAge > W.tankStaleMinutes) {
    out(`⚠️ Tank temperature not updated for ${Math.round(tankAge)} min, ignoring it`);
    tankTemp = null;
  }

  const t = localNow();
  const inWindow = (W.alwaysOn || []).some(w => w.day === t.day && t.minutes >= toMin(w.from) && t.minutes < toMin(w.to));
  const cheap = W.allowLevels.includes(level);
  const safetyActive = global.get('dhw_safety') === true;

  let want; let reason; let safety = false;
  if (inWindow) {
    want = true; reason = 'disinfection window';
  } else if (tankTemp === null) {
    want = true; reason = 'tank temperature unknown, keeping hot water on';
  } else if (tankTemp < W.safetyBelow || (safetyActive && isOn && tankTemp < W.safetyUntil)) {
    want = true; safety = true;
    reason = `tank ${tankTemp} °C, safety reheat to ${W.safetyUntil} °C`;
  } else if (cheap) {
    want = true; reason = `price ${level}, tank ${tankTemp} °C`;
  } else {
    want = false; reason = `price ${level}, tank ${tankTemp} °C ≥ ${W.safetyBelow} °C`;
  }
  // Safety reheats and the disinfection window must not be cut short
  const hardStop = false;
  const msg = await switchTo('dhw', W.cap, isOn, want, W, 'Hot water', reason, hardStop);
  out(msg);
  if (!W.dryRun) global.set('dhw_safety', safety);
} else if (W.enabled) out(`⚠️ Heat pump has no ${W.cap} capability`);

return lines.join(' | ');

/* ── Flow to run it ─────────────────────────────────────────────────────────
  WHEN  Date & time › Every 5 minutes
  THEN  HomeyScript › Run "verwarming-tibber"

  Optional pause switch: Logic › add a Yes/No variable "Verwarming automatisch".
  Set it to No to take manual control; the script then leaves the heat pump alone.

  Hot water notes:
  - The heat pump heats the tank to ITS OWN setpoint (Temp. AQS) whenever this
    script allows hot water. Set that to 55 °C on the controller or in the app.
  - Match hotWater.alwaysOn to the disinfection schedule (G01) on the controller,
    otherwise the weekly cycle may be blocked by an expensive hour.
*/
