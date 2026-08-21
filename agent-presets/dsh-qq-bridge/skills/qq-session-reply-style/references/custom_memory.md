# Custom Memory

Use this reference only for explicit QQ-session requests to save a memo or schedule a one-shot timer.

The bridge persists these records in the DSH storage-domain unit `dsh_qq_bridge`. In the default DSH Web JSON backend this is stored under:

```text
~/.dsh/storages/dsh_qq_bridge.json
```

This file is the schema and behavior reference, not the runtime data file.

## Record Format

Timer records:

```yaml
- uuid: f2c33537-6dfb-4ed7-b7fe-6c97f204726c
  type: timer
  time: "2026-09-01T12:00:00+08:00"
  content: "提醒我提交报告"
  sessionKey: "private:10001"
  scope: private
  targetId: 10001
  status: pending
  createdAt: "2026-08-21T12:00:00+08:00"
```

Memo records:

```yaml
- uuid: 7ea4b4fd-e42c-4f60-8d6b-4f32bb69699a
  type: memo
  content: "2026/07/08 日收入 350 元"
  sessionKey: "private:10001"
  scope: private
  targetId: 10001
  createdAt: "2026-08-21T12:03:00+08:00"
```

The bridge fills `uuid`, `sessionKey`, `scope`, `targetId`, `status`, and timestamps. The agent only provides the meaningful fields through control blocks.

## Control Blocks

Use `schedule_task` for explicit future reminders or delayed actions:

```text
<dsh-qq-bridge-control>{"action":"schedule_task","runAt":"2026-09-01T12:00:00+08:00","message":"提醒我提交报告"}</dsh-qq-bridge-control>
```

Use `save_memo` for explicit requests to remember or record a fact for this QQ bridge:

```text
<dsh-qq-bridge-control>{"action":"save_memo","content":"2026/07/08 日收入 350 元"}</dsh-qq-bridge-control>
```

## Rules

1. Use `schedule_task` only when the user explicitly asks to remind, notify, continue, or run something at a future time.
2. Put an absolute ISO 8601 timestamp with timezone offset in `runAt`, for example `2026-09-01T12:00:00+08:00`.
3. Resolve relative dates only when the current date/time context makes them unambiguous. Otherwise ask a normal clarifying question.
4. Use `save_memo` only when the user explicitly asks to remember, record, save, or note a fact.
5. Put the memo fact in `content`; do not include the control protocol, unrelated chat, or extra explanation.
6. Do not emit either control block when merely discussing reminders, schedules, memory, notes, or examples.

## Timer Runtime

The bridge writes pending timers to durable storage, then scans timers on plugin startup and every 2 hours. The scan does not go through the agent.

Only timers due within the next 2 hours are armed with `setTimeout`. Longer timers remain stored and are armed by a later scan.

When a timer fires, the bridge triggers the same QQ session's Agent and proactively sends the result to the original QQ private or group target.
