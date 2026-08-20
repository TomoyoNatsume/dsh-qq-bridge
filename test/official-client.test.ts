import { describe, expect, it, vi } from 'vitest'
import { TencentOfficialBotClient, toBridgeMessageEvent } from '../src/official/client.js'
import type { QQBotInboundMessage, ReplyTarget } from '@tencent-connect/qqbot-nodejs'

function inbound(overrides: Partial<QQBotInboundMessage> & { replyTarget: ReplyTarget }): QQBotInboundMessage {
  return {
    rawEventType: 'C2C_MESSAGE_CREATE',
    kind: overrides.replyTarget.scope === 'group' ? 'group' : 'c2c',
    senderId: 'user-openid',
    content: '/dsh hello',
    messageId: 'msg-1',
    timestamp: '2026-08-19T10:00:00+08:00',
    raw: {} as never,
    ...overrides,
  }
}

describe('dsh-qq-bridge — Tencent official bot adapter', () => {
  it('maps C2C and group messages into router-compatible events', () => {
    expect(toBridgeMessageEvent(inbound({
      replyTarget: { scope: 'c2c', targetId: 'user-openid', msgId: 'msg-1' },
    }))).toMatchObject({
      post_type: 'message',
      message_type: 'private',
      user_id: 'user-openid',
      raw_message: '/dsh hello',
      message_id: 'msg-1',
      reply_target: {
        platform: 'official',
        scope: 'c2c',
        targetId: 'user-openid',
        msgId: 'msg-1',
      },
    })

    expect(toBridgeMessageEvent(inbound({
      replyTarget: { scope: 'group', targetId: 'group-openid', msgId: 'msg-2' },
      messageId: 'msg-2',
    }))).toMatchObject({
      post_type: 'message',
      message_type: 'group',
      user_id: 'user-openid',
      group_id: 'group-openid',
      raw_message: '/dsh hello',
      message_id: 'msg-2',
      reply_target: {
        platform: 'official',
        scope: 'group',
        targetId: 'group-openid',
        msgId: 'msg-2',
      },
    })
  })

  it('uses the current inbound reply target when sending replies', async () => {
    const handlers = new Map<string, (...args: never[]) => unknown>()
    const sendText = vi.fn(async () => ({}))
    const bot = {
      on(event: string, handler: (...args: never[]) => unknown) {
        handlers.set(event, handler)
        return this
      },
      async start() {
        handlers.get('ready')?.()
      },
      stop() {},
      sendText,
    }
    const client = new TencentOfficialBotClient({ appId: 'app', appSecret: 'secret' }, bot)
    await client.connect()

    const seen: string[] = []
    client.onMessage((event) => {
      seen.push(`${event.message_type}:${event.user_id}`)
      void client.sendPrivate(event.user_id, 'reply', event.reply_target)
    })
    handlers.get('message')?.(undefined as never, inbound({
      replyTarget: { scope: 'c2c', targetId: 'user-openid', msgId: 'msg-1' },
    }) as never)

    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1))

    expect(seen).toEqual(['private:user-openid'])
    expect(sendText).toHaveBeenCalledWith(
      { scope: 'c2c', targetId: 'user-openid', msgId: 'msg-1' },
      'reply',
    )
  })

  it('sends private background notifications without reusing an inbound msgId', async () => {
    const sendText = vi.fn(async () => ({}))
    const sendWakeup = vi.fn(async () => ({}))
    const bot = {
      on() {
        return this
      },
      async start() {},
      stop() {},
      sendText,
      sendWakeup,
    }
    const client = new TencentOfficialBotClient({ appId: 'app', appSecret: 'secret' }, bot)

    await client.sendPrivate('admin-openid', 'notice')

    expect(sendText).not.toHaveBeenCalled()
    expect(sendWakeup).toHaveBeenCalledWith(
      { scope: 'c2c', targetId: 'admin-openid' },
      'notice',
    )
  })
})
