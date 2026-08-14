import { describe, it, expect, vi } from 'vitest'
import { DshAgentExecutor, extractLastAssistantText, hashKey, DshRenderedAgent } from '../src/handlers/dsh-executor.js'

function surfaceEvent(type: string, content: unknown[]) {
  return { type, content }
}

interface MockState {
  createCalls: string[]
  drops: string[]
}

/** 内存 mock:按 sessionId 记录创建/释放,readSurface 返回固定 surface 序列。 */
function makeMock(repliesBySession: Record<string, unknown[]>) {
  const live = new Map<string, DshRenderedAgent>()
  const state: MockState = { createCalls: [], drops: [] }
  const dsh = {
    async getOrCreate({ sessionKey, sessionId }: { sessionKey: string; sessionId: string }): Promise<DshRenderedAgent> {
      state.createCalls.push(sessionKey)
      const agent: DshRenderedAgent = {
        followup: vi.fn(),
        async whenIdle() {},
        async dispose() {
          live.delete(sessionId)
          state.drops.push(sessionId)
        },
      }
      live.set(sessionId, agent)
      return agent
    },
    async deliver(_agent: DshRenderedAgent, _prompt: string) {},
    async readSurface(sessionId: string) {
      return (repliesBySession[sessionId] ?? []) as never
    },
  }
  return { dsh, state }
}

describe('dsh-qq-bridge — DshAgentExecutor(多轮上下文)', () => {
  it('同一 sessionKey 复用同一 live agent,不重复创建', async () => {
    const { dsh, state } = makeMock({})
    const exec = new DshAgentExecutor(dsh as never)
    await exec.run('private:10001', '第一句')
    expect(state.createCalls).toEqual(['private:10001'])
    await exec.run('private:10001', '第二句')
    // 复用,不再创建
    expect(state.createCalls).toEqual(['private:10001'])
    expect(exec.liveSessionCount).toBe(1)
  })

  it('多轮:每轮返回该会话的回复内容', async () => {
    const sid = `qq-${hashKey('private:10001')}`
    const { dsh } = makeMock({
      [sid]: [surfaceEvent('assistant/message', [{ type: 'text', text: 'reply for this turn' }])],
    })
    const exec = new DshAgentExecutor(dsh as never)
    const out = await exec.run('private:10001', 'q1')
    expect(out).toBe('reply for this turn')
    // 第二次复用同一 agent,仍能取到回复
    const out2 = await exec.run('private:10001', 'q2')
    expect(out2).toBe('reply for this turn')
  })

  it('不同 sessionKey 拥有独立 live agent', async () => {
    const { dsh } = makeMock({})
    const exec = new DshAgentExecutor(dsh as never)
    await exec.run('private:10001', 'hi')
    await exec.run('private:10002', 'hi')
    expect(exec.liveSessionCount).toBe(2)
  })

  it('disposeAll 释放全部常驻 agent', async () => {
    const { dsh, state } = makeMock({})
    const exec = new DshAgentExecutor(dsh as never)
    await exec.run('private:10001', 'x')
    await exec.run('group:555', 'y')
    expect(exec.liveSessionCount).toBe(2)
    await exec.disposeAll()
    expect(exec.liveSessionCount).toBe(0)
    expect(new Set(state.drops).size).toBe(2)
  })

  it('disposeSession 释放单个会话', async () => {
    const sid = `qq-${hashKey('private:10001')}`
    const { dsh, state } = makeMock({})
    const exec = new DshAgentExecutor(dsh as never)
    await exec.run('private:10001', 'x')
    await exec.run('private:10002', 'y')
    expect(exec.liveSessionCount).toBe(2)
    await exec.disposeSession('private:10001')
    expect(exec.liveSessionCount).toBe(1)
    expect(state.drops).toContain(sid)
  })

  it('并发消息按 sessionKey 串行,不并驱同一会话', async () => {
    const { dsh } = makeMock({})
    const exec = new DshAgentExecutor(dsh as never)
    const results = await Promise.all([
      exec.run('private:10001', 'q1'),
      exec.run('private:10001', 'q2'),
    ])
    expect(results).toHaveLength(2)
    expect(exec.liveSessionCount).toBe(1) // 只建一个 live agent
  })

  it('extractLastAssistantText 提取最后一条 assistant 文本', () => {
    const events = [
      surfaceEvent('user/message', [{ type: 'text', text: 'hi' }]),
      surfaceEvent('assistant/message', [{ type: 'text', text: 'hello' }]),
      surfaceEvent('assistant/message', [{ type: 'text', text: 'final' }]),
    ]
    expect(extractLastAssistantText(events)).toBe('final')
  })

  it('hashKey 稳定且区分', () => {
    expect(hashKey('a')).toBe(hashKey('a'))
    expect(hashKey('a')).not.toBe(hashKey('b'))
  })
})
