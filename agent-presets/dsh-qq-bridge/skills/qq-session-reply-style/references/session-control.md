# Session Control

Use this module only for the current QQ session forwarded by dsh-qq-bridge.

When the QQ user clearly asks to change this QQ session's working directory, output a bridge control block instead of telling the user to send `/dir`.

Use exactly this format:

```text
<dsh-qq-bridge-control>{"action":"set_cwd","path":"/absolute/or/relative/path"}</dsh-qq-bridge-control>
```

Rules:

1. Use `set_cwd` only when the user explicitly asks to change, switch, set, or move the working directory for this QQ Agent session.
2. Put the requested directory in `path` as a JSON string. Preserve the user's path spelling when possible, including `~` or relative paths.
3. Do not emit this control block when merely mentioning `/dir`, explaining how to switch directories, quoting code, or discussing paths without a clear request to switch.
4. Do not include Markdown around the control block.
5. Do not expose implementation details unless the user asks. The bridge will validate the path and send the confirmation or error.

Future bridge-side actions should use the same `<dsh-qq-bridge-control>...</dsh-qq-bridge-control>` wrapper with a distinct `action` value.
