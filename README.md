# Eco-Home Heat Pump for Homey (Newntide)

[![CI](https://github.com/ThaWolfie/homey-ecohome-heatpump/actions/workflows/ci.yml/badge.svg)](https://github.com/ThaWolfie/homey-ecohome-heatpump/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/ThaWolfie/homey-ecohome-heatpump)](https://github.com/ThaWolfie/homey-ecohome-heatpump/releases/latest)
[![License: MIT](https://img.shields.io/github/license/ThaWolfie/homey-ecohome-heatpump)](LICENSE)
[![Version](https://img.shields.io/github/package-json/v/ThaWolfie/homey-ecohome-heatpump)](CHANGELOG.md)
![Homey SDK 3](https://img.shields.io/badge/Homey-SDK%203-1F6F8B)
![Platform: Homey Pro](https://img.shields.io/badge/platform-Homey%20Pro-1F6F8B)

![Eco-Home Heat Pump for Homey](docs/social-preview.png)

**Control and monitor a Newntide air-to-water heat pump from Homey Pro.** This is an unofficial Homey app for heat pumps that you operate with the **Eco-Home** phone app (Android `com.nnt.ehome`), such as the **Newntide Silver line 20** (R290 monoblock). It connects through the Eco-Home cloud, so you don't need extra hardware, Modbus or an electrician.

*Nederlands: koppel je Newntide / Eco-Home lucht-water warmtepomp aan Homey. Zie [Nederlandse samenvatting](#nederlandse-samenvatting).*

> **Disclaimer.** Not affiliated with, endorsed by or supported by Newntide, the Eco-Home app, Athom (Homey) or BataviaHeat. This app uses the same unofficial cloud API as the Eco-Home phone app, which can change or stop working without notice. The app can switch your heat pump and change setpoints. Use it at your own risk.

## Contents

- [Features](#features)
- [Supported heat pumps](#supported-heat-pumps)
- [How it works](#how-it-works)
- [Installation](#installation)
- [Setup: use a second Eco-Home account](#setup-use-a-second-eco-home-account)
- [Device settings](#device-settings)
- [Address maps](#address-maps)
- [Example automations](#example-automations)
- [Efficiency tips](#efficiency-tips)
- [Troubleshooting](#troubleshooting)
- [Privacy and security](#privacy-and-security)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [Credits, licence and trademarks](#credits-licence-and-trademarks)
- [Nederlandse samenvatting](#nederlandse-samenvatting)

## Features

### Controls and readings

| Homey capability | What it shows or does |
|---|---|
| Heat pump (on/off) | Main power switch of the unit |
| Heating (on/off) | Heating zone A switch |
| Hot water (on/off) | Domestic hot water (DHW) switch |
| Mode | Heat, cool or auto |
| Water temperature setpoint | Heating setpoint (cooling setpoint in cooling mode) |
| Hot water setpoint | DHW tank target temperature |
| Water outlet | Water temperature leaving the heat pump |
| Water return | Water temperature coming back from the floor or radiators |
| Hot water tank | DHW tank temperature |
| Outdoor | Outdoor (ambient) temperature measured by the unit |
| Water flow | Pump flow in L/h |
| Room, Silent mode, Compressor speed | Only on models that report them (see [Address maps](#address-maps)) |

Fields the heat pump never reports are removed from the device automatically after the first complete poll, so you won't see empty tiles.

### Flow cards

| Type | Cards |
|---|---|
| Actions | Turn heating on/off · Turn hot water on/off · Set heating setpoint · Set hot water setpoint · Set mode · Refresh now · Silent mode on/off* |
| Conditions | Heating is on · Hot water is on · Mode is … · Silent mode is on* · Compressor is running* |
| Triggers | Tank temperature changed · Outdoor temperature changed · Mode changed · Compressor started/stopped* |

\* Only on models that report silent mode or compressor speed (BataviaHeat address set).

### Insights

Every reading is logged in Homey Insights. Useful charts for tuning: **Water outlet** and **Water return** together (the difference shows how much heat goes into the house), **Water flow** (each block is one run), and **Hot water tank**.

## Supported heat pumps

| Heat pump | Status |
|---|---|
| Newntide Silver line 20 (R290, 3-phase) | Tested, all readings confirmed |
| BataviaHeat R290 3–8 kW | Address map from the [BataviaHeat Home Assistant integration](https://github.com/RSloot2000/BataviaHeat-Heat-Pump); not tested with this Homey app |
| Other Newntide units and rebrands that use the Eco-Home app | Probably work; you may need to adjust addresses with the [Address mapping](#address-mapping) setting |

Tested a model that isn't listed? Please [open an issue](../../issues/new/choose) with the "Values from the cloud" text from the device settings, so the address map can be added.

## How it works

```
Homey Pro  ──HTTPS──>  Eco-Home cloud (ehome.ne01.com)  <──>  heat pump (Wi-Fi module)
   │
   ├─ every 30–600 s: read all parameters + switch states
   └─ on a button or Flow: write a switch or setpoint, then re-read after 8 s
```

- **Reading:** the app polls the cloud (default every 60 s), and the heat pump answers with a list of numbered addresses, values, units and names.
- **Address sets:** the app maps those addresses to Homey fields with one of two address sets, BataviaHeat or Newntide. It picks the one that matches what your unit reports.
- **Writing:** a change from Homey is sent to the cloud and shown straight away. The app keeps showing your new value for up to 90 s while the cloud catches up, so the tile doesn't jump back.
- **Connection problems:** after 3 failed polls in a row the device shows as unavailable with the reason. A refused login asks you to use **Repair**.

The app has no npm dependencies; it uses only Node's built-in `https` and `crypto` modules.

## Installation

This app is not in the Homey App Store (yet). You install it with the Homey command-line tool; it stays installed afterwards. Download the zip from the [latest release](https://github.com/ThaWolfie/homey-ecohome-heatpump/releases/latest), or clone the repository. Full steps are in [INSTALL.md](INSTALL.md). In short:

```bash
npm install -g homey
homey login
git clone https://github.com/ThaWolfie/homey-ecohome-heatpump.git
cd homey-ecohome-heatpump
homey app install
```

You need a **Homey Pro** with firmware 12.0.0 or newer, and Node.js LTS on your computer.

## Setup: use a second Eco-Home account

The Eco-Home cloud allows **one active login per account**. If Homey and your phone use the same account, they keep logging each other out.

1. Create a second Eco-Home account (another e-mail address).
2. In the Eco-Home app on your phone, share the heat pump with that account.
3. In Homey: **Devices → + → Eco-Home Heat Pump → Heat pump**, and log in with the **second** account.

## Device settings

Open the device → **Settings**.

| Setting | What it does |
|---|---|
| Refresh every (seconds) | Poll interval, 30–600 s (default 60) |
| Login type | Leave on 2 unless the login fails |
| Heating switch address / Hot water switch address | 0 = detect automatically. Set manually only if the Heating or Hot water button does nothing |
| Address mapping | Override any address, see below |
| Switches found in the cloud | Read-only: the switches the cloud reports and what the app uses them for |
| Values from the cloud | Read-only: every address, its name and value, and what the app uses it for (→) |

### Address mapping

One override per line, `key=address`; `0` switches a field off. Example:

```
water_outlet=2063
hot_water_tank=2058
silent_mode=0
```

Keys: `heating_setpoint`, `cooling_setpoint`, `hot_water_setpoint`, `water_outlet`, `water_inlet`, `hot_water_tank`, `outdoor`, `room`, `compressor_speed`, `water_flow`, `silent_mode`. Invalid lines are rejected when you save.

## Address maps

### Newntide (Silver line 20)

Confirmed via the parameter names the cloud returns (shown in Portuguese by the Eco-Home app).

| Address | Eco-Home name | Used for |
|---|---|---|
| 1001 | (mode card) | Mode: 1 cool, 2 heat, 3 auto |
| 1002 | Temp. de Arrefecimento | Cooling setpoint |
| 1003 | Temp. de Aquecimento | Heating setpoint (zone A) |
| 1004 | Temp. AQS | Hot water setpoint |
| 1007 | Temp. Alvo de Aquecimento da Zona B | Zone B heating setpoint (not used yet) |
| 1574 | (switch card) | Heating zone A on/off |
| 1576 | (switch card) | Hot water on/off |
| 1577 | (device switch) | Heat pump on/off |
| 2057 | Temp. Ambiente | Outdoor temperature (spikes during defrost) |
| 2058 | Temp. AQS | Hot water tank |
| 2063 | Temp. Total de Saída de Água | Water outlet |
| 2138 | Temp. de Entrada de Água do Permutador | Water return (plate heat exchanger inlet) |
| 2139 | Temp. de Saída de Água do Permutador | Plate heat exchanger outlet (not used) |
| 2142 | Velocidade Alvo do W.P. | Water pump target speed, rpm (not used) |
| 2143 | Taxa de Fluxo do W.P. | Water flow, L/h |
| 2144 / 2145 | Sinal de Controlo / Feedback do W.P. | Water pump control and feedback signal, % (not used) |
| 2146 | Informação de Falha do W.P. | Water pump status: 0 running, 5 stopped (not used) |

Not reported by this model: compressor speed, room temperature, silent mode.

### BataviaHeat

| Address | Used for |
|---|---|
| 1017 | Heat pump on/off |
| 1021 | Mode (1 cool, 2 heat, 3 auto) |
| 1022 / 1023 / 1024 | Cooling / heating / hot water setpoint |
| 1004 | Silent mode |
| 1046 / 1047 | Cooling / heating curve active (setpoints can't be changed while a curve is active) |
| 2072 | Compressor speed |
| 2097 | Room temperature |
| 2099 | Outdoor temperature |
| 2100 | Hot water tank |
| 2189, 2106, 2102 | Water outlet (first one found) |
| 2187 | Water return |
| 2192 | Water flow |

## Example automations

### Heat on cheap electricity (Tibber)

[`examples/tibber-price-control.homeyscript.js`](examples/tibber-price-control.homeyscript.js) is a HomeyScript that switches the **Heating** and **Hot water** buttons based on the Tibber price level and a room thermometer:

- **Heating:** on below a start temperature (higher when power is cheap), off at a maximum; blocked at EXPENSIVE prices unless the room drops below a comfort floor.
- **Hot water:** only heats the tank at CHEAP prices, with a safety reheat when the tank gets too cold and an always-on window for the weekly disinfection.
- **Guards:** minimum run time and minimum off time against short cycling, a dry-run mode, and a pause switch (a Logic Yes/No variable).

Run it from a Flow every 5 minutes. Fill in your device ID and sensor name at the top.

### Simple Flow ideas

- **When** outdoor temperature changed **and** it is below 0 °C **then** send a notification to check the outdoor unit for ice.
- **When** tank temperature changed **and** it is below 45 °C **then** turn hot water on.
- **When** you leave home (presence) **then** set the heating setpoint 2 °C lower.

## Efficiency tips

Lessons from running a Silver line 20 with underfloor heating:

- **Use the heating curve on the heat pump's controller** instead of a fixed water temperature. Lower water temperatures make a heat pump much more efficient. The curve settings (M10–M21) are described in Newntide's *Installation & Operation Manual – Hydraulic & Control Module*.
- **Keep the hot water setpoint around 50–55 °C** and use the weekly disinfection program for hygiene. Heating a tank to 70+ °C can cost up to about 2.5× the electricity, because the heat pump works less efficiently at high temperatures and an electric element usually does the last part.
- **Check the tank's electric element.** If the tank keeps rising above the setpoint while the heat pump's water flow is 0, an electric element (often with its own thermostat) is doing the heating, at the most expensive rate.
- **Look at Water outlet minus Water return** while heating. A difference of about 3–5 °C is typical for underfloor heating. A much smaller difference means the pump runs faster than needed.
- **Defrost dips are normal.** Short drops in water temperature with a spike in outdoor temperature every 40–75 minutes, at 0–4 °C outside, are defrost cycles.

## Troubleshooting

| Problem | What to do |
|---|---|
| A value stays empty | Check **Values from the cloud** in the device settings and correct the address under **Address mapping** |
| A button does nothing | Check **Switches found in the cloud** and set the switch address manually |
| The device keeps going unavailable, or the phone app logs out | Homey and the phone share an Eco-Home account. Use a second account (see [Setup](#setup-use-a-second-eco-home-account)) |
| "Eco-Home login refused" | Device → **Repair**, log in again |
| A value looks wrong | Compare it with the Eco-Home app's *Status query* screen and open an issue with both values |
| Setpoint change is refused | A heating or cooling curve is active on the controller (BataviaHeat units); the heat pump sets the water temperature itself |

## Privacy and security

- **Your Eco-Home password** is stored on your Homey only as an MD5 hash, which is the form the Eco-Home app itself sends to the cloud. It is never written to logs or settings.
- **The app talks only to the Eco-Home cloud** (`ehome.ne01.com`). There is no telemetry and no other server.
- **Use the dedicated second account** for Homey, so you can revoke its access from the phone app at any time.

## Contributing

Contributions are welcome, especially address maps for other models. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- Local control via Modbus RS-485 / Modbus TCP (no cloud), as supported by the BataviaHeat integration
- Zone B support
- Water pump readings (speed, status) as optional fields
- Publication in the Homey App Store

## Credits, licence and trademarks

- **Original work:** the cloud API client and the BataviaHeat address map are ported from the Home Assistant integration [BataviaHeat Heat Pump](https://github.com/RSloot2000/BataviaHeat-Heat-Pump) by Ruben Sloot, used under the MIT licence (see [LICENSE-BataviaHeat](LICENSE-BataviaHeat)).
- **Licence:** this project is released under the MIT licence, see [LICENSE](LICENSE).
- **Trademarks:** Homey and Athom are trademarks of Athom B.V. Newntide, Eco-Home and BataviaHeat are trademarks of their respective owners. They are used here only to describe compatibility. The icons in this repository are original drawings.

## Nederlandse samenvatting

**Eco-Home Warmtepomp voor Homey** is een onofficiële Homey Pro-app voor Newntide lucht-water warmtepompen die je met de Eco-Home-app bedient (getest met de Newntide Silver line 20). Je ziet in Homey de wateruitlaat, waterretour, boilertemperatuur, buitentemperatuur en het waterdebiet. Je kunt verwarming en warm water aan/uit zetten, de modus kiezen en de ingestelde temperaturen aanpassen, ook vanuit Flows.

- **Installeren:** met de Homey CLI (`homey app install`), zie [INSTALL.md](INSTALL.md).
- **Tweede account:** gebruik een **tweede Eco-Home-account** waarmee je de warmtepomp deelt; de cloud staat maar één login per account toe.
- **Voorbeeld:** in [`examples/`](examples/) staat een HomeyScript dat verwarming en warm water aanstuurt op de Tibber-prijs.

Niet gelieerd aan Newntide, Eco-Home, Athom of BataviaHeat. Gebruik op eigen risico.
