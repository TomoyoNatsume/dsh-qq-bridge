import { describe, expect, it } from 'vitest'
import { isPromptCancelledError, parseQq, resolveChoice, resolveConfirm, SetupCancelledError } from '../src/cli/prompt.js'

describe('setup prompt validators', () => {
  it('accepts valid QQ numbers and rejects invalid input', () => {
    expect(parseQq('10001')).toBe(10001)
    expect(() => parseQq('abc')).toThrow(/QQ/)
    expect(() => parseQq('1234')).toThrow(/QQ/)
  })

  it('parses yes/no answers and rejects invalid confirm input', () => {
    expect(resolveConfirm('', true)).toBe(true)
    expect(resolveConfirm('y', false)).toBe(true)
    expect(resolveConfirm('no', true)).toBe(false)
    expect(resolveConfirm('maybe', true)).toBeNull()
  })

  it('accepts choice index or exact text and rejects unknown choices', () => {
    const choices = ['是', '二维码过期']

    expect(resolveChoice('', choices, '是')).toBe('是')
    expect(resolveChoice('2', choices, '是')).toBe('二维码过期')
    expect(resolveChoice('二维码过期', choices, '是')).toBe('二维码过期')
    expect(resolveChoice('否', choices, '是')).toBeNull()
    expect(resolveChoice('3', choices, '是')).toBeNull()
  })

  it('recognizes Ctrl+C style prompt cancellation errors', () => {
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    const exit = new Error('User force closed the prompt with SIGINT')
    exit.name = 'ExitPromptError'

    expect(isPromptCancelledError(new SetupCancelledError())).toBe(true)
    expect(isPromptCancelledError(abort)).toBe(true)
    expect(isPromptCancelledError(exit)).toBe(true)
    expect(isPromptCancelledError(new Error('ordinary failure'))).toBe(false)
  })
})
