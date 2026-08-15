import { describe, it, expect } from 'vitest'
import { extractLastAssistantText } from '../src/handlers/dsh-executor.js'

/** DSH session surface 中 assistant/message 的真实形态:`data.message.content`。 */
function dshAssistantEvent(blocks: unknown[]) {
  return {
    type: 'assistant/message',
    seq: 8,
    time: 1700000000000,
    data: { message: { role: 'assistant', source: { kind: 'model' }, content: blocks } },
    surfaceOp: 'append',
  }
}

describe('dsh-qq-bridge — DSH 真实消息形态兼容', () => {
  it('extractLastAssistantText 能从 data.message.content 提取最后一条 assistant 文本', () => {
    const events = [
      { type: 'turn/start', seq: 6, time: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 7, time: 1, data: {} },
      dshAssistantEvent([{ type: 'text', text: '回复一' }]),
      dshAssistantEvent([{ type: 'think', text: 'thinking…' }, { type: 'text', text: '回复二' }]),
    ]
    expect(extractLastAssistantText(events)).toBe('回复二')
  })

  it('deliver 投递给 agent 的是 identified user message(id/role/source.kind)', async () => {
    const { DshAgentExecutor, hashKey } = await import('../src/handlers/dsh-executor.js')
    const sid = `qq-${hashKey('private:10001')}`
    const captured: unknown[] = []
    const dsh = {
      async getOrCreate() {
        return {
          followup: (m: unknown) => captured.push(m),
          async whenIdle() {},
          async dispose() {},
        }
      },
      // 与 plugin 的 wireDsh.deliver 一致:构造 identified message 再 followup
      async deliver(agent: { followup: (m: unknown) => void }, prompt: string) {
        agent.followup({
          id: 'fixed-id',
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'user' },
        })
      },
      async readSurface() {
        return [dshAssistantEvent([{ type: 'text', text: '回复' }])]
      },
    }
    const exec = new DshAgentExecutor(dsh as never)
    const out = await exec.run('private:10001', '你好')
    expect(out).toBe('回复')
    const msg = captured[0] as { id: string; role: string; content: unknown[]; source: { kind: string } }
    expect(msg.id.length).toBeGreaterThan(0)
    expect(msg.role).toBe('user')
    expect(msg.source.kind).toBe('user')
    expect((msg.content[0] as { type: string; text: string }).text).toBe('你好')
    void sid
  })

  it('identified message 校验语义:source 必须是 { kind } 而非 { type }', () => {
    const good = { id: 'x', role: 'user', content: [{ type: 'text', text: 'y' }], source: { kind: 'user' } }
    expect(good.id.length).toBeGreaterThan(0)
    expect(good.role).toBe('user')
    expect(typeof good.source.kind === 'string' && good.source.kind.length > 0).toBe(true)
    expect(Array.isArray(good.content)).toBe(true)
    // 旧错误形态(source 用 type 而非 kind)不满足 kind 校验
    const bad = { id: 'x', role: 'user', content: [], source: { type: 'user' } }
    expect(typeof (bad.source as { kind?: string }).kind).not.toBe('string')
  })
})
