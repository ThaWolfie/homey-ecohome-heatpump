# Installing the Eco-Home Heat Pump app on your Homey Pro

This app is not in the Homey App Store. You install it from your computer with the Homey command-line tool. It stays installed afterwards.

## One-time setup (about 10 minutes)

1. Install **Node.js LTS** from https://nodejs.org.
2. Install the Homey command-line tool:
   ```
   npm install -g homey
   ```
3. Log in with your Homey (Athom) account. A browser window opens:
   ```
   homey login
   ```

## Install or update the app

4. Download this repository (green **Code** button → **Download ZIP**, then unzip), or clone it:
   ```
   git clone <this repository URL>
   ```
5. In a terminal, go to the folder and install:
   ```
   cd <the folder you downloaded>
   homey app install
   ```
   Pick your Homey Pro when asked. Repeat steps 4–5 for every update.
   Don't use `homey app run`: that version stops when the terminal closes.

## Add the heat pump

6. In the Homey app: **Devices → + → Eco-Home Heat Pump → Heat pump**.
7. Log in with your **second** Eco-Home account (the one the heat pump is shared with), not the one on your phone. Select the heat pump and finish.

## Troubleshooting

- **A value stays empty:** device → **Settings → Values from the cloud** shows every address the heat pump reports. Correct the mapping under **Address mapping**.
- **A button doesn't work:** check **Switches found in the cloud** in the device settings, and set the switch address manually if needed.
- **The login stops working:** device → **Settings → Repair**, and make sure no phone uses the same Eco-Home account.
