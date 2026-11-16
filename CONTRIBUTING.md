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
- Run `npm test` and `homey app validate` before opening a pull request. CI runs both, plus a syntax and version check, on every push and pull request, and the Release workflow will not release while a test fails.
- The tests (`test/`) use a fake Eco-Home cloud and a fake Homey, so they need no account or heat pump. When you add a model or a value, add it to the fake cloud in `test/helpers.js` and assert it in `test/device.test.js`.

## Releasing (maintainers)

1. Go to **Actions → Release → Run workflow**.
2. Enter the new version (`patch`, `minor`, `major` or e.g. `0.2.0`) and a one-line changelog in English.
3. The workflow validates the app, bumps the version in all files, updates `CHANGELOG.md` and `.homeychangelog.json`, tags the commit, and creates a GitHub release with an installable zip.
4. Tick **Also publish to the Homey App Store** only when the `HOMEY_PAT` secret is set (your Personal Access Token from https://tools.developer.homey.app/me).

## Workflows

| Workflow | When | What |
| --- | --- | --- |
| **CI** | Every push to master and every pull request | Syntax, JSON and version checks, the tests, and `homey app validate` (publish level), as three parallel jobs. |
| **Dependabot updates** | After CI passes on a Dependabot pull request | Squash-merges it when every update is a patch or minor version. Major updates get a comment and wait for you. |
| **Release** | By hand, on master | Runs CI first, then releases exactly the commit CI tested. |

Dependabot itself opens a pull request every Monday when a GitHub Action used in the workflows has a new version (configured in `.github/dependabot.yml`; GitHub lists those runs as its built-in "Dependabot Updates").

## Never commit

- Passwords, tokens, cookies or `env.json`
- Your Eco-Home e-mail address or heat pump serial number
- Homey device IDs from your own installation
