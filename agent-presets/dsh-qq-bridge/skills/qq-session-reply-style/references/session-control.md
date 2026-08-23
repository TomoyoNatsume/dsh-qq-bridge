# Session Control

Use this module only for the current QQ session forwarded by dsh-qq-bridge.

When the QQ user clearly asks to change this QQ session's working directory, model, reasoning effort, permission preset, start a fresh Agent session, create a one-shot scheduled task/reminder for this QQ target, or save a memo for this QQ target, output a bridge control block instead of telling the user to send `/dir`, `/model`, `/reasoningEff`, `/permission`, or `/new-session`.

Use exactly one of these formats:

```text
<dsh-qq-bridge-control>{"action":"set_cwd","path":"/absolute/or/relative/path"}</dsh-qq-bridge-control>
<dsh-qq-bridge-control>{"action":"set_model","model":"exact-model-id"}</dsh-qq-bridge-control>
<dsh-qq-bridge-control>{"action":"set_reasoning_effort","reasoningEffort":"high"}</dsh-qq-bridge-control>
<dsh-qq-bridge-control>{"action":"set_permission","preset":"workspace-write"}</dsh-qq-bridge-control>
<dsh-qq-bridge-control>{"action":"new_session"}</dsh-qq-bridge-control>
<dsh-qq-bridge-control>{"action":"schedule_task","runAt":"2026-09-01T12:00:00+08:00","message":"提醒我提交报告"}</dsh-qq-bridge-control>
<dsh-qq-bridge-control>{"action":"save_memo","key":"TCL电视价格","content":"TCL电视价格为4000"}</dsh-qq-bridge-control>
```

Rules:

1. Use `set_cwd` only when the user explicitly asks to change, switch, set, or move the working directory for this QQ Agent session.
2. Put the requested directory in `path` as a JSON string. Preserve the user's path spelling when possible, including `~` or relative paths.
3. Use `set_model` only when the user explicitly asks to change, switch, or set this QQ Agent session's model. Put the exact requested model id in `model`; do not translate or approximate it.
4. Use `set_reasoning_effort` only when the user explicitly asks to change, switch, or set this QQ Agent session's reasoning effort. Put the exact requested effort id in `reasoningEffort`, such as `off`, `low`, `high`, or `max`.
5. Use `set_permission` only when the user explicitly asks to change, switch, or set this QQ Agent session's permission preset. Put the exact preset id in `preset`, such as `read-only`, `workspace-write`, or `danger-full-access`.
6. For natural-language permission requests, map cautiously to exact preset ids only when the intent is clear: read-only/no writes -> `read-only`; workspace writes/project write access -> `workspace-write`; full access/skip approvals/danger mode -> `danger-full-access`.
7. Use `new_session` only when the user explicitly asks to open a new session, start a fresh conversation/context, clear current Agent context, or avoid continuing the current Agent session. It affects the current QQ target's Agent context, not memo/timer storage.
8. Use `schedule_task` only when the user explicitly asks to remind, notify, continue, or run something at a future time. Read `custom_memory.md` for timer format and runtime behavior.
9. Use `save_memo` only when the user explicitly asks to remember, record, save, or note a fact. Read `custom_memory.md` for memo format and rules.
10. For `schedule_task`, put an absolute ISO 8601 timestamp with timezone offset in `runAt`, for example `2026-09-01T12:00:00+08:00`. Resolve relative dates only when the current date/time context makes them unambiguous; otherwise ask a normal clarifying question and do not emit a control block.
11. For `schedule_task`, put the task/reminder content in `message`. For `save_memo`, put a short stable item identifier in `key` and the fact in `content`. Reuse the same `key` when the user updates the same remembered item. Preserve the user's intent; do not include the control protocol or unrelated chat.
12. Do not emit a control block when merely mentioning `/dir`, `/model`, `/reasoningEff`, `/permission`, `/new-session`, explaining commands, quoting code, or discussing paths/models/reasoning levels/permissions/schedules/memos/session switching without a clear request to switch, schedule, save, or start a new session.
13. Do not include Markdown around the control block.
14. Do not expose implementation details unless the user asks. The bridge will validate the value and send the confirmation or error.

Future bridge-side actions should use the same `<dsh-qq-bridge-control>...</dsh-qq-bridge-control>` wrapper with a distinct `action` value.
