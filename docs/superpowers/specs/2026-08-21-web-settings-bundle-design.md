# dsh-qq-bridge Web settings bundle design

## Goal

Turn `dsh-qq-bridge` into an installable DSH bundle that exposes a `QQ bridge` page in DSH Web settings. Installing the package should make the settings surface visible, while an unconfigured install stays inert and does not attempt to connect to QQ.

## Scope

The first version moves the durable configuration surface into DSH Web. It does not replace every interactive CLI setup step. NapCat login, QR scanning, official QQ Bot creation, and official pairing remain external or CLI-guided flows.

## Bundle Shape

The package declares `dsh.bundle.patch` in `package.json` and ships a top-level `cordis.patch.yml`.

The bundle patch inserts one host plugin row:

- `id: dsh-qq-bridge`
- `name: dsh-qq-bridge`
- conservative default config with `enabled: false`

The same package also ships a browser half through `exports["./client"]` and `dsh.client`, so DSH Web discovers the settings page after the bundle is mounted.

## Host Settings

The host plugin registers a `dsh-qq-bridge` settings namespace when `ctx.settings` is available. The namespace stores the same information collected by the CLI setup:

- enabled flag
- platform: `napcat` or `official`
- NapCat OneBot endpoint, token, admin QQ, command prefix, self-log mode
- official QQ Bot AppID, AppSecret, admin openid, allowlist, sandbox mode
- agent provider, model, cwd, QQ preset, reply style skill, timeout and message limits
- permission default preference for future DSH Web sessions

Secret fields are marked secret in the settings schema so DSH Web never receives stored secret values from `settings.describe`.

The runtime plugin reads the resolved settings section over the bundle config. If `enabled` is false, or the selected platform is missing required configuration, the plugin does not connect to QQ.

## Web UI

The browser half registers one `settings.section` entry with label `QQ bridge`.

The page contains:

- an enable switch
- a platform selector
- NapCat and official Bot form sections
- agent defaults
- permission default selector
- self-log controls for NapCat mode
- a save button
- compact status and restart guidance

The save button writes the `dsh-qq-bridge` settings namespace through `ctx.settingsScope`. It also triggers any safe local side effects exposed by the host half, such as refreshing the bundled QQ agent preset. It does not start NapCat, scan QR codes, or perform official Bot pairing in this version.

## Existing CLI

`dsh-qq-bridge setup` remains supported. It can keep writing the profile patch for compatibility, but the preferred path after bundle adoption is to write the same settings namespace and refresh the QQ preset.

## Testing

Tests cover:

- bundle manifest and patch presence
- unconfigured bundle is inert
- settings schema accepts NapCat and official configurations
- save/update flow preserves secret redaction assumptions
- runtime config resolves settings over bundle defaults
- existing profile writer tests continue to pass
