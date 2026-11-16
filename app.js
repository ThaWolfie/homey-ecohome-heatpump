'use strict';

const Homey = require('homey');
const { EcoHomeClient } = require('./lib/EcoHomeClient');

module.exports = class EcoHomeApp extends Homey.App {

  async onInit() {
    // One client per Eco-Home account: the cloud allows only one session per
    // account, so every device on the same account must share it.
    this._clients = new Map();
    this.log('Eco-Home Heat Pump app started');
  }

  getClient({ username, passwordHash, loginType = 2 }) {
    const key = `${username}|${passwordHash}|${loginType}`;
    if (!this._clients.has(key)) {
      this._clients.set(key, new EcoHomeClient({
        username, passwordHash, loginType, log: (...a) => this.log('[cloud]', ...a),
      }));
    }
    return this._clients.get(key);
  }

  dropClient({ username, passwordHash, loginType = 2 }) {
    this._clients.delete(`${username}|${passwordHash}|${loginType}`);
  }

};
