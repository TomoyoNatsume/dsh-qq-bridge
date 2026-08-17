import { describe, expect, it } from 'vitest'
import { parseQq, resolveChoice, resolveConfirm } from '../src/cli/prompt.js'

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
})
