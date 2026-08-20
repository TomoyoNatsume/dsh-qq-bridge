# QQ Agent Control Block Design

## Goal

Allow the QQ-facing Agent to request bridge-side actions without requiring the user to send slash commands. The first action is changing the current QQ session cwd when the user says things like "帮我把工作目录改到 xxx".

## Protocol

The Agent must emit a private control block, not a visible `/dir` reply:

```text
<dsh-qq-bridge-control>{"action":"set_cwd","path":"/home/me/project"}</dsh-qq-bridge-control>
```

The bridge removes control blocks from the QQ-visible text, parses JSON actions, and dispatches them through an extensible registry. Unknown or invalid actions return a diagnostic instead of being ignored silently.

## set_cwd

`set_cwd` accepts a string `path`.

- `~` and `~/...` resolve to the OS home directory.
- Absolute paths resolve normally.
- Relative paths resolve against the current QQ session cwd when available, otherwise against the process cwd.
- The path must exist and be a directory.
- On success, the handler calls the same session cwd switcher used by `/dir`; the next user message creates a new DSH session under that cwd and then uses workspaceRegistry classification.

## Safety

Control blocks are parsed only from assistant output generated inside QQ-backed sessions. They are not routed through the public message router and are never executed from ordinary user input. Control execution is best treated as bridge protocol: do not display the raw block to QQ.

When control blocks are enabled, text streaming is suppressed for that Agent turn so the raw protocol cannot leak before the final assistant output is parsed.

## Extension Point

New actions register `QqControlActionHandler` instances with `QqControlDispatcher`. Each handler declares one action name and receives the parsed action plus session context. The dispatcher owns unknown-action handling and keeps parsing independent from action behavior.
