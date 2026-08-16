import { describe, it, expect } from 'vitest'
import { parseNapcatSelfLogLine } from '../src/inputs/napcat-log.js'

describe('dsh-qq-bridge — NapCat self log input', () => {
  const opts = { selfQq: 554616801, commandPrefix: '/dsh' }

  it('parses self private send lines', () => {
    const line = '08-16 11:07:50 [info] Tomoyo | 发送 -> 私聊 (554616801) /dsh hello'
    expect(parseNapcatSelfLogLine(line, opts)).toEqual({
      userId: 554616801,
      rawMessage: '/dsh hello',
    })
  })

  it('parses mobile device send lines as self private messages', () => {
    const line = '08-16 11:10:40 [info] Tomoyo | 发送 -> 移动设备 /dsh  hello'
    expect(parseNapcatSelfLogLine(line, opts)).toEqual({
      userId: 554616801,
      rawMessage: '/dsh  hello',
    })
  })

  it('ignores non-command and non-self lines', () => {
    expect(parseNapcatSelfLogLine('08-16 11:00:00 [info] Tomoyo | 发送 -> 私聊 (554616801) hello', opts)).toBeNull()
    expect(parseNapcatSelfLogLine('08-16 11:00:00 [info] Tomoyo | 发送 -> 私聊 (10001) /dsh hello', opts)).toBeNull()
    expect(parseNapcatSelfLogLine('08-16 11:00:00 [info] Tomoyo | 接收 <- 私聊 (554616801) /dsh hello', opts)).toBeNull()
  })

  it('strips ansi color sequences before parsing', () => {
    const line = '08-16 11:07:50 [\u001b[32minfo\u001b[39m] Tomoyo | 发送 -> 私聊 (554616801) /dsh hello'
    expect(parseNapcatSelfLogLine(line, opts)?.rawMessage).toBe('/dsh hello')
  })
})
