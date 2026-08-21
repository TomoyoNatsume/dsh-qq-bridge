# Web Session Global Blocking For QQ Agent Runs

## Goal

When a QQ user sends an agent message while any non-QQ Web session is actively running, the bridge should acknowledge that the Web session is busy and delay the QQ agent run until Web activity becomes idle. The QQ message must not be dropped.

## Scope

This applies only to QQ messages that would enter `AgentRpcHandler`. Bridge-side control commands such as `/dir`, `/models`, `/model`, `/reasoningEff`, `/permission`, `/permissions`, and `/help` should continue to run immediately because they do not drive a DSH agent turn.

The blocking decision is global: any active non-QQ, non-subagent DSH session blocks all QQ agent runs, regardless of workspace or QQ conversation.

## Busy Definition

Add a small DSH activity tracker that listens to `session/event`.

A session counts as Web-busy when:

- Its session id does not start with `qq-`.
- Its `session.header.origin` is not `subagent`.
- It has started a turn that has not reached a completed turn-end event.

QQ-backed sessions are excluded so QQ does not block itself. Subagents are excluded to match the existing reply notification filtering behavior.

## Queue Behavior

`AgentRpcHandler` should optionally receive a blocker/waiter dependency. Before it calls the `AgentExecutor`, it asks whether Web activity is busy.

If Web activity is busy:

1. Reply to QQ immediately with `当前 Web 会话正在运行，请稍后...`.
2. Enqueue the QQ run in a global FIFO queue owned by the blocker.
3. Resume queued QQ runs after all tracked Web sessions become idle.

The existing per-QQ-session queue inside `DshAgentExecutor` stays in place. The new queue only controls cross-source blocking against Web sessions; it should not replace per-session serialization.

## Failure And Timeout

If Web activity never becomes idle, queued QQ runs remain queued. Once a queued QQ run starts, existing `AgentRpcHandler` timeout and error handling still apply.

The initial busy message is separate from the normal agent acknowledgement. When the queued run begins, the current `ackMessage` behavior should remain unchanged unless the user configured it as an empty string.

## Tests

Add focused unit tests for:

- A Web-busy event causes a QQ agent message to reply with the busy message and not call the executor immediately.
- When the Web session completes, the queued QQ message proceeds.
- QQ sessions with ids starting `qq-` do not trigger Web-busy blocking.
- Multiple queued QQ messages resume in FIFO order.

