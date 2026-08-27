import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isNapcatSelfKeepAliveMessage,
  NAPCAT_SELF_KEEPALIVE_MESSAGE,
  startNapcatSelfKeepAlive,
} from '../src/onebot/self-keepalive.js'
import { DshQqBridgeConfig } from '../src/config.js'

describe('dsh-qq-bridge — NapCat self keepalive', () => {
  afterEach(() => vi.useRealTimers())

  it('sends to the login account every configured interval and stops cleanly', async () => {
    vi.useFakeTimers()
    const sendPrivate = vi.fn(async () => undefined)
    const stop = startNapcatSelfKeepAlive({
      enabled: true,
      intervalMs: 600_000,
      message: NAPCAT_SELF_KEEPALIVE_MESSAGE,
      targetId: 10001,
      sendPrivate,
      createUid: () => 'uid-1',
    })

    await vi.advanceTimersByTimeAsync(600_000)
    expect(sendPrivate).toHaveBeenCalledWith(10001, `${NAPCAT_SELF_KEEPALIVE_MESSAGE} uid=uid-1`, 'uid-1')

    stop()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sendPrivate).toHaveBeenCalledTimes(1)
  })

  it('recognizes only the configured internal message', () => {
    expect(isNapcatSelfKeepAliveMessage(` ${NAPCAT_SELF_KEEPALIVE_MESSAGE} `)).toBe(true)
    expect(isNapcatSelfKeepAliveMessage(`${NAPCAT_SELF_KEEPALIVE_MESSAGE} uid=unique-1`)).toBe(true)
    expect(isNapcatSelfKeepAliveMessage('hello')).toBe(false)
  })

  it('marks logged-out after three timeouts and recovers on any success', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    let attempt = 0
    const sendPrivate = vi.fn(async () => {
      attempt += 1
      if (attempt <= 3) {
        const err = new Error('timeout')
        err.name = 'OnebotActionTimeoutError'
        throw err
      }
    })
    const stop = startNapcatSelfKeepAlive({
      enabled: true,
      intervalMs: 5_000,
      message: NAPCAT_SELF_KEEPALIVE_MESSAGE,
      targetId: 10001,
      sendPrivate,
      createUid: () => `uid-${attempt + 1}`,
    })

    await vi.advanceTimersByTimeAsync(15_000)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('logged-out'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(info).toHaveBeenCalledWith(expect.stringContaining('logged-in'))
    stop()
    warn.mockRestore()
    info.mockRestore()
  })

  it('defaults to 600 seconds and migrates the old millisecond setting', () => {
    expect(DshQqBridgeConfig.parse({}).napcat.selfKeepAlive.intervalSeconds).toBe(600)
    expect(DshQqBridgeConfig.parse({
      napcat: { selfKeepAlive: { intervalMs: 120_000 } },
    }).napcat.selfKeepAlive.intervalSeconds).toBe(120)
  })
})
