# QQ Session Workspace Classification Design

## Goal

QQ-backed DSH sessions should appear under the matching DSH Web workspace as soon as they are created. Setup should ask for a default QQ Agent working directory, defaulting to the user's home directory. The `/dir <path>` command should keep changing the current QQ session cwd, and the next created DSH session should be classified under that new workspace.

## Design

- Store the setup-selected default cwd in the bridge profile as `agent.cwd`.
- Keep `DshAgentExecutor` as the owner of per-QQ-session cwd state. Its first session creation uses `agent.cwd`; after `/dir`, the next session creation uses the switched cwd.
- When wrapping real DSH services, create the live agent with `meta.cwd` set to the resolved cwd.
- If DSH exposes `workspaceRegistry`, call `workspaceRegistry.create(cwd)` and then `workspace.attachSession(sessionId)` after the agent has been created. This uses DSH's official workspace accounting instead of moving or writing session log files directly.
- Workspace attach failures should log a warning and not fail the QQ request. Agent operation must continue even if a DSH version lacks workspaceRegistry or a workspace attach validation fails.

## Validation

- Profile generation tests verify `agent.cwd` is written for NapCat and official setup items.
- Executor/plugin wiring tests verify session creation receives cwd and workspace attach is best-effort.
- Build output must be regenerated because DSH loads `dist/index.js`.
