# Custom Memory

Use this reference only for explicit QQ-target requests to save a memo or schedule a one-shot timer.

The bridge persists these records in the DSH storage-domain unit `dsh_qq_bridge`. In the default DSH Web JSON backend this is stored under:

```text
~/.dsh/storages/dsh_qq_bridge.json
```

This file is the schema and behavior reference, not the runtime data file.

## Scope

Custom memory is scoped by QQ target, not by Agent session.

- Private chat target: `scope: private` and `targetId: <userId>`.
- Group chat target: `scope: group` and `targetId: <groupId>`.

Memos and timers for one `scope + targetId` are available across that target's Agent sessions. They must not be shared with another private user or another group.

`sourceSessionKey` records which Agent session created the memo or timer. It is provenance and, for timers, the current execution context used to trigger the scheduled Agent run. It is not the memory access boundary.

## Record Format

Timer records:

```yaml
- uuid: f2c33537-6dfb-4ed7-b7fe-6c97f204726c
  time: "2026-09-01T12:00:00+08:00"
  content: "提醒我提交报告"
  sourceSessionKey: "private:10001:session-a"
  scope: private
  targetId: 10001
  status: pending
  createdAt: "2026-08-21T12:00:00+08:00"
```

Memo records:

```yaml
- uuid: 7ea4b4fd-e42c-4f60-8d6b-4f32bb69699a
  key: "TCL电视价格"
  content: "TCL电视价格为4000"
  sourceSessionKey: "private:10001:session-a"
  scope: private
  targetId: 10001
  createdAt: "2026-08-21T12:03:00+08:00"
  updatedAt: "2026-08-21T12:08:00+08:00"
```

Legacy records may still contain `type` or omit `key`; the bridge accepts them while new records omit `type` and include `key`.

The bridge fills `uuid`, `sourceSessionKey`, `scope`, `targetId`, `status`, and timestamps. The agent provides the memo `key`, memo `content`, or timer fields through control blocks.

## Memo Keys

Memo keys identify the same item within one QQ target. Use a short stable noun phrase for the item being remembered.

Examples:

```yaml
- key: "TCL电视价格"
  content: "TCL电视价格为3200"
- key: "TCL电视价格"
  content: "TCL电视价格为4000"
```

These two writes update one memo record because they use the same `scope + targetId + key`.

Choose the key for the thing being tracked, not for the full sentence. For example:

```yaml
- key: "2026/07/08 日收入"
  content: "2026/07/08 日收入 350 元"
```

If the user asks to modify a remembered item, reuse the same key and put the updated fact in `content`. If the user asks to remember a different item, choose a different key.

## Control Blocks

Use `schedule_task` for explicit future reminders or delayed actions:

```text
<dsh-qq-bridge-control>{"action":"schedule_task","runAt":"2026-09-01T12:00:00+08:00","message":"提醒我提交报告"}</dsh-qq-bridge-control>
```

Use `save_memo` for explicit requests to remember or record a fact for this QQ bridge:

```text
<dsh-qq-bridge-control>{"action":"save_memo","key":"TCL电视价格","content":"TCL电视价格为4000"}</dsh-qq-bridge-control>
```

## Rules

1. Use `schedule_task` only when the user explicitly asks to remind, notify, continue, or run something at a future time.
2. Put an absolute ISO 8601 timestamp with timezone offset in `runAt`, for example `2026-09-01T12:00:00+08:00`.
3. Resolve relative dates only when the current date/time context makes them unambiguous. Otherwise ask a normal clarifying question.
4. Use `save_memo` only when the user explicitly asks to remember, record, save, or note a fact.
5. Put a short stable item identifier in `key`, such as `TCL电视价格`.
6. Put the memo fact in `content`; do not include the control protocol, unrelated chat, or extra explanation.
7. To update an existing memo, reuse its `key` with the new `content`.
8. Do not emit either control block when merely discussing reminders, schedules, memory, notes, or examples.

## Timer Runtime

The bridge writes pending timers to durable storage, then scans timers on plugin startup and every 2 hours. The scan does not go through the agent.

Only timers due within the next 2 hours are armed with `setTimeout`. Longer timers remain stored and are armed by a later scan.

When a timer fires, the bridge triggers the source Agent session recorded on the timer and proactively sends the result to the original QQ private or group target.

After a timer finishes, the bridge deletes that timer item from storage instead of keeping a fired mission record.
