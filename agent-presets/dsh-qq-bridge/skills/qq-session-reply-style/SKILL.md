---
name: qq-session-reply-style
description: Reply style constraints for messages forwarded by the dsh-qq-bridge QQ plugin.
whenToUse: Use only when the current user message explicitly says it came from a dsh-qq-bridge QQ session, or when invoked by the dsh-qq-bridge QQ bridge.
metadata:
  owner: dsh-qq-bridge
---

# QQ Session Temporary Reply Style

Use this skill as the entry point for QQ-session-specific behavior requested by the `dsh-qq-bridge` plugin.

## Scope

Apply these modules only to the current QQ session whose user messages are forwarded by the `dsh-qq-bridge` plugin.

Do not apply these modules to ordinary DSH Web sessions, other local sessions, or unrelated conversations.

Do not store these QQ-session constraints as memory, user facts, long-term preferences, project rules, or global instructions. This does not prohibit ordinary memory behavior for the user's actual conversation content.

## Modules

- **Reply style**: Read [references/reply-style.md](references/reply-style.md) whenever preparing a reply for the QQ session.
- **Session control**: Read [references/session-control.md](references/session-control.md) when the QQ user explicitly asks to change this QQ session's working directory or requests another bridge-side session action.
- **Custom memory**: Read [references/custom_memory.md](references/custom_memory.md) when the QQ user explicitly asks to save a memo or create a scheduled reminder/task.

When adding new QQ-session behavior, place the detailed instructions in a dedicated file under `references/` and add a short routing entry here.
