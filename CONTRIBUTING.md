# Contributing

Thanks for helping! The most useful contribution is an **address map for a heat pump model that isn't listed yet**.

## Report a new model

1. Install the app and add your heat pump.
2. Open the device → **Settings** and copy the text of **Values from the cloud** and **Switches found in the cloud**.
3. Open the Eco-Home app → your heat pump → **Status query**, and note what it shows for the same moment (outlet, return, tank, outdoor temperature, flow).
4. [Open a "New heat pump model" issue](../../issues/new/choose) and paste both. Remove your serial number (the code starting with letters on the sticker) if you prefer.

## Code changes

- Keep the app free of npm dependencies (Node built-ins only).
- Add new address sets next to `A` and `A_NEWNTIDE` in `drivers/heatpump/device.js`, with a comment saying which model they were confirmed on.
- Bump the version in `.homeycompose/app.json` and `package.json`, and add an entry to `CHANGELOG.md` and `.homeychangelog.json`.
- Run `homey app validate` before opening a pull request.

## Never commit

- Passwords, tokens, cookies or `env.json`
- Your Eco-Home e-mail address or heat pump serial number
- Homey device IDs from your own installation
