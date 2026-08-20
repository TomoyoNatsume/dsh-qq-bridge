import { describe, it, expect, vi } from 'vitest'
import { DshQqBridgeConfig } from '../src/config.js'
import {
  agentReplyNotificationsEnabled,
  createAgentReplyNotifier,
  findSessionTitle,
  registerAgentReplyNotifier,
} from '../src/plugin.js'

type SessionSubject = {
  id?: string
  header?: { origin?: string }
  events?: readonly unknown[]
}

describe('dsh-qq-bridge — agent reply notifier', () => {
  it('extracts the latest session/title, or an empty title when none exists', () => {
    expect(findSessionTitle([
      { type: 'session/title', data: { title: '旧标题' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'session/title', data: { title: '新标题' } },
    ])).toBe('新标题')
    expect(findSessionTitle([{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }])).toBe('')
  })

  it('sends one private admin notification for each completed top-level turn', async () => {
    let listener: ((session: SessionSubject, event: unknown) => void) | undefined
    const unsubscribe = vi.fn()
    const ctx = {
      on: vi.fn((_event: string, cb: (session: SessionSubject, event: unknown) => void) => {
        listener = cb
        return unsubscribe
      }),
    }
    const client = { sendPrivate: vi.fn(async () => undefined) }

    const dispose = registerAgentReplyNotifier(ctx, client as never, 10001)
    expect(ctx.on).toHaveBeenCalledWith('session/event', expect.any(Function))

    const session = {
      id: 's1',
      events: [{ type: 'session/title', data: { title: 'Web 会话' } }],
    }
    listener?.(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    listener?.(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    listener?.(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'error' } } })
    listener?.({ id: 'child', header: { origin: 'subagent' }, events: [] }, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    })

    expect(client.sendPrivate).toHaveBeenCalledTimes(1)
    expect(client.sendPrivate).toHaveBeenCalledWith(10001, '主人，您收到一条Agent回复，来自[Web 会话]')
    dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not notify for QQ-backed sessions', async () => {
    let listener: ((session: SessionSubject, event: unknown) => void) | undefined
    const ctx = {
      on: vi.fn((_event: string, cb: (session: SessionSubject, event: unknown) => void) => {
        listener = cb
        return () => {}
      }),
    }
    const client = { sendPrivate: vi.fn(async () => undefined) }

    const dispose = createAgentReplyNotifier(ctx, client as never, 10001)
    const session = {
      id: 'qq-session-1',
      events: [{ type: 'session/title', data: { title: 'QQ 会话' } }],
    }
    listener?.(session, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } })

    expect(client.sendPrivate).not.toHaveBeenCalled()
    dispose()
  })

  it('keeps agent reply notifications opt-in for official QQ mode', () => {
    expect(agentReplyNotificationsEnabled(DshQqBridgeConfig.parse({}))).toBe(true)
    expect(agentReplyNotificationsEnabled(DshQqBridgeConfig.parse({
      platform: 'official',
      official: { appId: 'app', appSecret: 'secret' },
    }))).toBe(false)
    expect(agentReplyNotificationsEnabled(DshQqBridgeConfig.parse({
      platform: 'official',
      official: { appId: 'app', appSecret: 'secret' },
      notifications: { agentReply: { enabled: true } },
    }))).toBe(true)
  })
})
