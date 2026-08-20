import { describe, expect, it, vi } from 'vitest'
import { pairOfficialAdmin } from '../src/cli/official-pairing.js'
import type { QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs'

describe('official QQ Bot setup pairing', () => {
  it('resolves the sender openid from the first matching pair command', async () => {
    const handlers = new Map<string, (...args: never[]) => unknown>()
    const stop = vi.fn()
    const sendText = vi.fn(async () => ({}))
    const bot = {
      on(event: string, handler: (...args: never[]) => unknown) {
        handlers.set(event, handler)
        return this
      },
      async start() {
        handlers.get('ready')?.(undefined as never)
      },
      stop,
      sendText,
    }
    const onReady = vi.fn()
    const pairing = pairOfficialAdmin({
      appId: 'app',
      appSecret: 'secret',
      sandbox: false,
      pairCommand: '/dsh pair ABC123',
      timeoutMs: 1000,
      onReady,
    }, bot)

    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    handlers.get('message')?.(undefined as never, inbound('/dsh ping', 'other-openid') as never)
    handlers.get('message')?.(undefined as never, inbound('  /dsh   pair   ABC123  ', 'admin-openid') as never)

    await expect(pairing).resolves.toBe('admin-openid')
    expect(sendText).toHaveBeenCalledWith(
      { scope: 'c2c', targetId: 'admin-openid', msgId: 'msg-1' },
      '配对成功',
    )
    expect(stop).toHaveBeenCalledTimes(1)
  })
})

function inbound(content: string, senderId: string): QQBotInboundMessage {
  return {
    rawEventType: 'C2C_MESSAGE_CREATE',
    kind: 'c2c',
    senderId,
    content,
    messageId: 'msg-1',
    timestamp: '2026-08-20T10:00:00+08:00',
    replyTarget: { scope: 'c2c', targetId: senderId, msgId: 'msg-1' },
    raw: {} as never,
  }
}
