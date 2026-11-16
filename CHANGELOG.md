# Changelog

## 0.1.5
- New **Water return** reading (Newntide address 2138), for checking the temperature difference between outlet and return.
- Address mapping key `water_inlet`.

## 0.1.4
- Parameter names are read from the cloud's `pointName` field, so **Values from the cloud** now shows the real names.

## 0.1.3
- Removed the compressor speed mapping on Newntide units: address 2142 is the water pump speed, not the compressor.

## 0.1.2
- **Newntide address set** (Silver line 20), used automatically when the BataviaHeat addresses are missing.
- New **Address mapping** setting to override any address.
- Silent mode no longer falls back to address 1004, which is the hot water setpoint on Newntide units.

## 0.1.1
- Internal test build.

## 0.1.0
- First version: Eco-Home cloud client, BataviaHeat address map, heating / hot water / silent switches, setpoints, mode, Flow cards and diagnostics.
