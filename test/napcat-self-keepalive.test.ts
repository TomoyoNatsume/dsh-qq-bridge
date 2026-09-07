import { describe, expect, it } from 'vitest'
import { isNapcatSelfKeepAliveMessage, NAPCAT_SELF_KEEPALIVE_MESSAGE } from '../src/onebot/self-keepalive.js'
import { DshQqBridgeConfig } from '../src/config.js'

describe('legacy keepalive compatibility', () => {
  it('filters legacy internal traffic without enabling a sender', () => {
    expect(isNapcatSelfKeepAliveMessage(NAPCAT_SELF_KEEPALIVE_MESSAGE)).toBe(true)
    expect(isNapcatSelfKeepAliveMessage(`${NAPCAT_SELF_KEEPALIVE_MESSAGE} uid=old`)).toBe(true)
    expect(isNapcatSelfKeepAliveMessage('hello')).toBe(false)
  })
  it('ignores saved keepalive settings, including previously enabled timers', () => {
    const cfg = DshQqBridgeConfig.parse({ napcat: { selfKeepAlive: { enabled: true, intervalSeconds: 1 } } })
    expect(cfg.napcat).not.toHaveProperty('selfKeepAlive')
  })
})
