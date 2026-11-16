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
- Don't bump the version in a pull request; the Release workflow does that.
- Run `homey app validate` before opening a pull request. CI runs the same check, plus a syntax and version check, on every push and pull request.

## Releasing (maintainers)

1. Go to **Actions → Release → Run workflow**.
2. Enter the new version (`patch`, `minor`, `major` or e.g. `0.2.0`) and a one-line changelog in English.
3. The workflow validates the app, bumps the version in all files, updates `CHANGELOG.md` and `.homeychangelog.json`, tags the commit, and creates a GitHub release with an installable zip.
4. Tick **Also publish to the Homey App Store** only when the `HOMEY_PAT` secret is set (your Personal Access Token from https://tools.developer.homey.app/me).

Dependabot opens a pull request every Monday when a GitHub Action used in the workflows has a new version.

## Never commit

- Passwords, tokens, cookies or `env.json`
- Your Eco-Home e-mail address or heat pump serial number
- Homey device IDs from your own installation
