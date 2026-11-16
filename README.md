# Eco-Home Heat Pump for Homey

Unofficial [Homey Pro](https://homey.app) app for **Newntide** air-to-water heat pumps that are controlled with the **Eco-Home** phone app. Tested on a Newntide **Silver line 20** (R290). It talks to the Eco-Home cloud, so no extra hardware is needed.

> Not affiliated with Newntide, Eco-Home or Athom. The app can switch your heat pump and change setpoints. Use it at your own risk.

## What you get

| In Homey | Source (Eco-Home cloud address) |
|---|---|
| Heat pump on/off | 1577 |
| Heating on/off, Hot water on/off | 1574, 1576 (auto-detected) |
| Mode (heat / cool / auto) | 1001 |
| Water temperature setpoint | 1003 (heating) / 1002 (cooling) |
| Hot water setpoint | 1004 |
| Water outlet, Water return | 2063, 2138 |
| Hot water tank, Outdoor | 2058, 2057 |
| Water flow (L/h) | 2143 |

Flow cards:

- **Actions:** switch heating or hot water, set the heating or hot water setpoint, set the mode, refresh now.
- **Conditions:** heating on, hot water on, mode is.
- **Triggers:** tank temperature changed, outdoor temperature changed, mode changed.
- **BataviaHeat units only:** silent mode (action and condition) and compressor started/stopped/running.

**Not available on the Silver line 20 via the cloud:** compressor speed, room temperature and silent mode. The app removes those fields when the heat pump doesn't report them.

### Other models

The app has two address sets:

- **Newntide** (Silver line 20 and similar), used automatically when the BataviaHeat addresses are missing.
- **BataviaHeat** (R290 3–8 kW), from the Home Assistant integration.

If a value stays empty or looks wrong, open the device → **Settings**. **Values from the cloud** lists every address with its name, and **Address mapping** lets you override any address, one per line:

```
water_outlet=2063
hot_water_tank=2058
```

Keys: `heating_setpoint`, `cooling_setpoint`, `hot_water_setpoint`, `water_outlet`, `water_inlet`, `hot_water_tank`, `outdoor`, `room`, `compressor_speed`, `water_flow`, `silent_mode`. Use `0` to switch one off.

Issues and pull requests with address maps for other models are welcome.

## Important: use a second Eco-Home account

The Eco-Home cloud allows **one login per account**. If Homey uses the same account as your phone, they keep logging each other out.

1. Create a second Eco-Home account.
2. In the Eco-Home app on your phone, share the heat pump with that account.
3. Use the second account when adding the device in Homey.

The password is stored in Homey only as an MD5 hash, which is what the Eco-Home app itself sends.

## Install

See [INSTALL.md](INSTALL.md). In short: install the Homey CLI, clone this repository, run `homey app install`.

## Credits

Cloud API and the BataviaHeat address map are ported from the Home Assistant integration [BataviaHeat Heat Pump](https://github.com/RSloot2000/BataviaHeat-Heat-Pump) by Ruben Sloot (MIT, see [LICENSE-BataviaHeat](LICENSE-BataviaHeat)).

## Licence

MIT, see [LICENSE](LICENSE).
