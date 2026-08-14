import { describe, it, expect, vi } from 'vitest'
import { DshAgentExecutor, extractLastAssistantText, hashKey } from '../src/handlers/dsh-executor.js'
import { DshServiceHandles } from '../src/handlers/dsh-executor.js'

function surfaceEvent(type: string, content: unknown[]) {
  return { type, content }
}

describe('dsh-qq-bridge — DshAgentExecutor', () => {
  it('extractLastAssistantText 提取最后一条 assistant 文本', () => {
    const events = [
      surfaceEvent('user/message', [{ type: 'text', text: 'hi' }]),
      surfaceEvent('assistant/message', [{ type: 'text', text: 'hello' }]),
      surfaceEvent('tool/result', [{ type: 'text', text: 'ignored' }]),
      surfaceEvent('assistant/message', [{ type: 'text', text: 'final answer' }]),
    ]
    expect(extractLastAssistantText(events)).toBe('final answer')
  })

  it('忽略非纯文本 block(如 tool 结果/其它类型)', () => {
    const events = [
      surfaceEvent('user/message', [{ type: 'text', text: 'q' }]),
      surfaceEvent('assistant/message', [
        { type: 'thinking', text: 'zzz' },
        { type: 'text', text: '正文' },
      ]),
    ]
    expect(extractLastAssistantText(events)).toBe('正文')
  })

  it('无 assistant 消息时返回 null', () => {
    expect(extractLastAssistantText([surfaceEvent('user/message', [{ type: 'text', text: 'x' }])])).toBeNull()
  })

  it('run() 按 sessionKey 创建会话、投料、读取回复、销毁', async () => {
    const created: string[] = []
    const disposed: string[] = []
    const mocks: DshServiceHandles = {
      async createAgent({ sessionId }) {
        created.push(sessionId)
        return {
          followup: vi.fn(),
          whenIdle: vi.fn(async () => {}),
          async done() {
            disposed.push(sessionId)
          },
        }
      },
      async deliver(agent, prompt) {
        expect(prompt).toBe('帮我看看内存')
        agent.followup({ content: [{ type: 'text', text: prompt }], source: { type: 'user' } })
        await agent.whenIdle()
      },
      async readSurface(sessionId) {
        return [surfaceEvent('assistant/message', [{ type: 'text', text: `reply-${sessionId}` }])]
      },
    }
    const exec = new DshAgentExecutor(mocks)
    const out = await exec.run('private:10001', '帮我看看内存')

    expect(created).toEqual([`qq-${hashKey('private:10001')}`])
    expect(disposed).toEqual([`qq-${hashKey('private:10001')}`])
    expect(out).toContain('reply-qq-')
  })

  it('hashKey 对相同输入稳定,对不同输入不同', () => {
    expect(hashKey('private:10001')).toBe(hashKey('private:10001'))
    expect(hashKey('private:10001')).not.toBe(hashKey('private:10002'))
  })
})
