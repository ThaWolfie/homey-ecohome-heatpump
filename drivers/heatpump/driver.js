'use strict';

const Homey = require('homey');
const { EcoHomeClient } = require('../../lib/EcoHomeClient');

const ON = 'on';

module.exports = class HeatPumpDriver extends Homey.Driver {

  async onInit() {
    const flow = this.homey.flow;

    // Actions
    flow.getActionCard('set_heating').registerRunListener(({ device, state }) => device.setHeating(state === ON));
    flow.getActionCard('set_hot_water').registerRunListener(({ device, state }) => device.setHotWater(state === ON));
    flow.getActionCard('set_silent').registerRunListener(({ device, state }) => device.setSilent(state === ON));
    flow.getActionCard('set_hot_water_setpoint').registerRunListener(({ device, temperature }) => device.setHotWaterSetpoint(temperature));
    flow.getActionCard('set_heating_setpoint').registerRunListener(({ device, temperature }) => device.setWaterSetpoint(temperature));
    flow.getActionCard('set_mode').registerRunListener(({ device, mode }) => device.setMode(mode));
    flow.getActionCard('refresh').registerRunListener(({ device }) => device.poll());

    // Conditions
    flow.getConditionCard('heating_is_on').registerRunListener(({ device }) => device.getCapabilityValue('onoff.heating') === true);
    flow.getConditionCard('hot_water_is_on').registerRunListener(({ device }) => device.getCapabilityValue('onoff.hot_water') === true);
    flow.getConditionCard('silent_is_on').registerRunListener(({ device }) => device.getCapabilityValue('onoff.silent') === true);
    flow.getConditionCard('compressor_running').registerRunListener(({ device }) => (device.getCapabilityValue('compressor_speed') || 0) > 0);
    flow.getConditionCard('mode_is').registerRunListener(({ device, mode }) => device.getCapabilityValue('heatpump_mode') === mode);

    this.log('Heat pump driver ready');
  }

  async onPair(session) {
    let client = null;
    let creds = null;

    session.setHandler('login', async ({ username, password }) => {
      const user = String(username || '').trim();
      creds = { username: user, passwordHash: EcoHomeClient.hashPassword(password), loginType: 2 };
      client = new EcoHomeClient({ ...creds, log: (...a) => this.log('[pair]', ...a) });
      try {
        await client.login();
      } catch (err) {
        this.error('Login failed:', err.message);
        throw new Error(`Eco-Home login failed: ${err.message}`);
      }
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!client) throw new Error('Log in first');
      const devices = await client.getDevices();
      return devices.map(d => ({
        name: d.device_nick_name || d.device_name || `Heat pump ${d.device_code}`,
        data: { id: d.device_code },
        store: { ...creds },
        settings: { device_code: d.device_code, account: creds.username },
      }));
    });
  }

  async onRepair(session, device) {
    session.setHandler('login', async ({ username, password }) => {
      const user = String(username || '').trim();
      const loginType = Number(device.getSetting('login_type') || 2);
      const creds = { username: user, passwordHash: EcoHomeClient.hashPassword(password), loginType };
      const client = new EcoHomeClient({ ...creds });
      await client.login();
      const devices = await client.getDevices();
      if (!devices.some(d => d.device_code === device.getData().id)) {
        throw new Error('This account cannot see this heat pump. Share it to this account in the Eco-Home app first.');
      }
      await device.updateCredentials(creds);
      return true;
    });
  }

};
