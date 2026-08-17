# dsh-qq-bridge interactive setup CLI design

## Goal

Provide a guided first-run setup command for Linux/WSL2 users running NapCat
through the NapCat CLI. The command should turn the current manual setup flow
into an interactive installer while keeping security-sensitive actions explicit:
the user still scans the QQ login QR code, confirms profile changes before they
are written, and decides whether to start DSH in the background.

The first version targets the documented and tested path only:

- Linux or WSL2 host
- NapCat CLI installed and available as `napcat`
- DSH web profile (`~/.dsh/profiles/web`)
- local OneBot forward WebSocket at `127.0.0.1:3001`

Windows, macOS, Docker NapCat, and remote NapCat setups are out of scope for the
first version. The CLI should detect unsupported cases and print a clear manual
fallback instead of attempting a partial automation.

## Commands

The package keeps one installed binary:

```bash
dsh-qq-bridge
```

The binary dispatches subcommands:

```bash
dsh-qq-bridge setup
dsh-qq-bridge echo
dsh-qq-bridge --help
```

`setup` runs the interactive setup wizard. `echo` preserves the existing local
echo-mode link test. Running the command without a subcommand prints concise
help and points new users to `dsh-qq-bridge setup`.

## User Flow

The setup wizard runs these steps in order:

1. Preflight checks
   - Confirm Linux/WSL2.
   - Check `node`, `npm`, `pnpm`, and `napcat`.
   - Locate the DSH web profile directory, defaulting to `~/.dsh/profiles/web`.
   - Confirm `dist/index.js` exists. If this is a source checkout and `dist` is
     missing, offer to run `npm install` and `npm run build`.

2. Collect configuration
   - Ask for QQ number.
   - Ask for command prefix, default `/dsh`.
   - Ask for model, with choices such as `deepseek-v4-flash` and
     `deepseek-v4-pro`, plus free-form input.
   - Ask whether this is single-account mode. The default is yes, using
     `selfLogInput`.
   - Confirm shell handler remains disabled.

3. Start or inspect NapCat
   - Run `napcat status <QQ>` when available.
   - If not running, offer to run `napcat start <QQ>`.
   - Tail `~/Napcat/log/napcat_<QQ>.log` and display relevant login output.
   - The CLI never asks for QQ credentials. It only shows the QR/log output and
     waits for the user to scan with mobile QQ.
   - Continue when the log indicates login success or when the user confirms
     that NapCat is logged in.

4. Configure OneBot forward WebSocket
   - Prefer automatic configuration of NapCat's
     `onebot11_<QQ>.json` under the NapCat install config directory.
   - Ensure one WebSocket server entry is enabled at host `127.0.0.1`, port
     `3001`.
   - Preserve an existing token when present. Generate a random token if none
     exists.
   - If the config path is missing or the JSON shape is unknown, fall back to a
     WebUI checklist: open WebUI, enable Forward WebSocket, set host
     `127.0.0.1`, port `3001`, and copy the OneBot access token.
   - Restart or prompt the user to restart NapCat when a file edit requires it.

5. Prepare DSH profile patch
   - Build the plugin config for `id: dsh-qq-bridge`.
   - Use `name` pointing to the installed package entry when installed through
     npm/DSH, or to the local checkout's `dist/index.js` when running from a
     checkout.
   - Use `token: !!js process.env.DSH_QQ_TOKEN` in the profile. The token value
     itself is exported for the launched DSH process, not hard-coded into the
     profile patch.
   - Include access, agent, shell, and self-log settings.

6. Preview and write DSH profile
   - Read `~/.dsh/profiles/web/cordis.patch.yml`.
   - Modify only the `insert` list item whose `id` is `dsh-qq-bridge`.
   - If no such item exists, append a new item under an existing top-level
     `insert` entry, or add a new top-level `insert` entry.
   - Do not delete, reorder, or rewrite unrelated entries.
   - Create a timestamped backup before writing.
   - Show a diff-like preview and ask for explicit confirmation.
   - Write only after confirmation.

7. Optional background DSH start
   - Ask whether to start DSH web in the background.
   - Start from the DSH checkout/profile context using `pnpm dsh web` when
     available.
   - Provide the environment values needed by this plugin:
     `DSH_QQ_TOKEN` and `DSH_PERMISSION_MODE=danger-full-access`.
   - Log to `/tmp/dsh-qq-bridge-dsh-web.log` by default.
   - Print PID, log path, and the QQ command to test, e.g. `/dsh ping`.

## Profile Editing Contract

The DSH profile writer is intentionally narrow. It must not be a general YAML
rewriter.

Allowed changes:

- Add `id: dsh-qq-bridge` under a top-level `insert` list.
- Replace the existing `id: dsh-qq-bridge` item under a top-level `insert` list.

Forbidden changes:

- Removing any unrelated entry.
- Reordering unrelated entries.
- Editing any unrelated `config`.
- Reformatting the whole file when not necessary.
- Writing without a backup and explicit confirmation.

If the file cannot be parsed or updated without touching unrelated content, the
CLI should stop and print a manual patch block for the user to copy.

## Security Constraints

- Never ask for QQ account passwords.
- Do not commit or write credentials into repository files.
- Keep NapCat OneBot bound to `127.0.0.1`.
- Keep `access.mode: whitelist`.
- Keep `shell.enabled: false` by default.
- Keep `selfLogInput.replayOnStart: false`.
- Treat OneBot token, WebUI token, DeepSeek API key, and QQ credentials as
  sensitive.
- Explain that `DSH_PERMISSION_MODE=danger-full-access` is intended only for a
  private, whitelisted local setup.

## Modules

```text
src/cli/index.ts
```

Binary entry and subcommand dispatcher. It owns command-line help and delegates
to setup or echo mode.

```text
src/cli/setup.ts
```

Interactive orchestration. It owns prompts, step ordering, summary output, and
final success/failure messages.

```text
src/cli/napcat.ts
```

NapCat-specific operations: command detection, status/start/log tailing,
OneBot config discovery, safe JSON update, token generation, and WebUI fallback
instructions.

```text
src/cli/dsh-profile.ts
```

DSH profile patch construction, narrow `cordis.patch.yml` editing, backup, and
preview generation.

```text
src/cli/dsh-runner.ts
```

Background DSH launch, process detection, log path handling, and startup
diagnostics.

```text
src/cli/echo.ts
```

Optional extraction of the current local echo-mode behavior from `src/main.ts`
so that `dsh-qq-bridge echo` remains cleanly separated from setup.

## Error Handling

The setup command should prefer recoverable stops over partial silent changes.

- Missing `napcat`: print installation guidance and stop before profile edits.
- NapCat login not confirmed: allow retry, view log again, or skip with a clear
  warning.
- OneBot config auto-edit fails: fall back to WebUI checklist.
- DSH profile patch cannot be safely updated: print manual patch and stop before
  writing.
- DSH background start fails: keep written config, print log path and manual
  command.

Every file-writing step should report what path was changed and where its
backup lives.

## Testing

Add focused tests around pure logic and keep process-spawning behavior behind
small interfaces.

- Profile patch updater:
  - appends a new `dsh-qq-bridge` insert item
  - replaces only an existing `dsh-qq-bridge` item
  - preserves unrelated entries
  - refuses malformed or unsupported YAML

- NapCat config updater:
  - preserves existing token
  - generates a token when absent
  - enables/updates `127.0.0.1:3001`
  - fails cleanly on unknown JSON shape

- CLI flow:
  - can run through a mocked happy path
  - stops before writing when confirmation is declined
  - prints WebUI fallback when automatic OneBot config fails

Manual validation should cover one real Linux/WSL2 path:

1. `npm run build`
2. `dsh-qq-bridge setup`
3. scan NapCat QR code
4. accept profile preview
5. start DSH in the background
6. send `/dsh ping` from QQ and receive a reply

## Out of Scope

- Installing NapCat itself.
- Supporting Windows/macOS native NapCat in v1.
- Supporting Docker NapCat in v1.
- Managing long-term process supervision for DSH or NapCat.
- Editing arbitrary user profile settings outside `id: dsh-qq-bridge`.
- Replacing DSH's official `dsh plugin --profile web add ...` mechanism.

