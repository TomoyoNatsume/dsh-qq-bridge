import { describe, it, expect, vi } from 'vitest'
import { MessageRouter } from '../src/router.js'
import { AccessGate } from '../src/security.js'
import { AgentRpcHandler, splitText } from '../src/handlers/agent.js'
import { ShellHandler } from '../src/handlers/shell.js'
import { OnebotMessageEvent } from '../src/onebot/types.js'

function makeEvent(partial: Partial<OnebotMessageEvent> & { user_id: number; raw_message: string }): OnebotMessageEvent {
  return {
    post_type: 'message',
    message_type: 'private',
    user_id: partial.user_id,
    raw_message: partial.raw_message,
    message_id: 1,
    ...partial,
  } as OnebotMessageEvent
}

describe('dsh-qq-bridge — MessageRouter + AccessGate', () => {
  it('whitelist 模式:白名单外的人被拒绝', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [10002], commandPrefix: '/dsh', mode: 'whitelist' })
    const sent: string[] = []
    const router = new MessageRouter(gate, async (scope, id, text) => void sent.push(`${scope}:${id}:${text}`))
    router.register(new AgentRpcHandler({ run: async () => 'handled' }))

    const consumed = await router.route(makeEvent({ user_id: 9999, raw_message: '/dsh hello' }))
    expect(consumed).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('whitelist 模式:admin 放行且去掉前缀', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const executor = { run: vi.fn(async (_key: string, payload: string) => `echo:${payload}`) }
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new AgentRpcHandler(executor))

    const consumed = await router.route(makeEvent({ user_id: 10001, raw_message: '/dsh hello world' }))
    expect(consumed).toBe(true)
    expect(executor.run).toHaveBeenCalledWith('private:10001', 'hello world')
    expect(sent).toEqual(['echo:hello world'])
  })

  it('回发失败只记录警告,不让 route 抛错拖垮 host', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = new MessageRouter(gate, async () => {
      throw new Error('ws not connected')
    })
    router.register({
      name: 'agent',
      test: () => true,
      run: async (c) => c.respond('reply'),
    })

    await expect(router.route(makeEvent({ user_id: 10001, raw_message: '/dsh hello' }))).resolves.toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ws not connected'))
    warn.mockRestore()
  })

  it('不以指令前缀开头的消息不进入 router', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const router = new MessageRouter(gate, async () => {})
    const run = vi.fn()
    router.register(new AgentRpcHandler({ run } as never))
    const consumed = await router.route(makeEvent({ user_id: 10001, raw_message: 'some normal chat' }))
    expect(consumed).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('group 消息同样受白名单与前缀约束', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const run = vi.fn(async (_k: string, p: string) => `r:${p}`)
    const sent: string[] = []
    const router = new MessageRouter(gate, async (scope, id, text) => void sent.push(`${scope}#${id}#${text}`))
    router.register(new AgentRpcHandler({ run } as never))
    await router.route(makeEvent({ message_type: 'group', group_id: 555, user_id: 10001, raw_message: '/dsh task' }))
    expect(run).toHaveBeenCalledWith('group:555', 'task')
    expect(sent).toEqual(['group#555#r:task'])
  })

  it('多个 handler 可按命令名路由(shell vs agent)', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const agentRun = vi.fn(async (_k: string, p: string) => `agent:${p}`)
    const shellRun = vi.fn(async (cmd: string) => ({ stdout: `out:${cmd}`, code: 0 }))
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    // 先注册 shell 处理 /dsh shell xxx
    router.register(new ShellHandler(shellRun as never))
    // agent 负责兜底其它内容(测试时让它不拦截 shell)
    router.register({
      name: 'agent',
      test: (p: string) => !p.startsWith('shell '),
      run: async (c) => c.respond(await agentRun(String(c.userId), c.payload)),
    })

    await router.route(makeEvent({ user_id: 10001, raw_message: '/dsh shell uptime' }))
    expect(shellRun).toHaveBeenCalledWith('uptime')
    expect(agentRun).not.toHaveBeenCalled()
    expect(sent).toEqual(['out:uptime'])

    await router.route(makeEvent({ user_id: 10001, raw_message: '/dsh what is dsh?' }))
    expect(agentRun).toHaveBeenCalledWith('10001', 'what is dsh?')
  })

  it('默认等待 agent 完成后只回发最终结果,忽略流式 chunk', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })

    const sent: string[] = []
    const execDefault = {
      run: vi.fn(async (_k: string, _p: string, onChunk?: (t: string, k: 'text' | 'reasoning') => void) => {
        onChunk?.('开始思考', 'reasoning')
        onChunk?.('这是结果', 'text')
        return '最终完整结果'
      }),
    }
    const routerDefault = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    routerDefault.register(new AgentRpcHandler(execDefault as never))
    await routerDefault.route(makeEvent({ user_id: 10001, raw_message: '/dsh q' }))
    expect(execDefault.run).toHaveBeenCalledWith('private:10001', 'q')
    expect(sent).toEqual(['最终完整结果'])
  })

  it('streamText=true 时分段回发,且 streamReasoning 控制思考过程', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })

    const sent: string[] = []
    const execDefault = {
      run: vi.fn(async (_k: string, _p: string, onChunk?: (t: string, k: 'text' | 'reasoning') => void) => {
        onChunk?.('开始思考', 'reasoning')
        onChunk?.('这是结果', 'text')
        return '最终完整结果'
      }),
    }
    const routerDefault = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    routerDefault.register(new AgentRpcHandler(execDefault as never, { streamText: true }))
    await routerDefault.route(makeEvent({ user_id: 10001, raw_message: '/dsh q' }))
    expect(sent).toEqual(['这是结果', '最终完整结果'])

    // streamReasoning=true:reasoning 分段也回发
    const sent2: string[] = []
    const execOpen = {
      run: vi.fn(async (_k: string, _p: string, onChunk?: (t: string, k: 'text' | 'reasoning') => void) => {
        onChunk?.('开始思考', 'reasoning')
        onChunk?.('这是结果', 'text')
        return '最终完整结果'
      }),
    }
    const routerOpen = new MessageRouter(gate, async (_, __, text) => void sent2.push(text))
    routerOpen.register(new AgentRpcHandler(execOpen as never, { streamText: true, streamReasoning: true }))
    await routerOpen.route(makeEvent({ user_id: 10001, raw_message: '/dsh q' }))
    expect(sent2).toEqual(['开始思考', '这是结果', '最终完整结果'])
  })

  it('流式 text 已等于最终结果时不重复回发最终完整版', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const sent: string[] = []
    const exec = {
      run: vi.fn(async (_k: string, _p: string, onChunk?: (t: string, k: 'text' | 'reasoning') => void) => {
        onChunk?.('最终', 'text')
        onChunk?.('结果', 'text')
        return '最终结果'
      }),
    }
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new AgentRpcHandler(exec as never, { streamText: true }))
    await router.route(makeEvent({ user_id: 10001, raw_message: '/dsh q' }))
    expect(sent).toEqual(['最终', '结果'])
  })

  it('splitText:超长文本按 maxLen 拆分,且每条不超过限制', () => {
    const long = 'A'.repeat(100) + '。' + 'B'.repeat(100) + '。' + 'C'.repeat(100)
    const parts = splitText(long, 50)
    // 至少 3 条,且每条 <= 50
    expect(parts.length).toBeGreaterThanOrEqual(3)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(50)
    // 去掉标点后内容完整保留(A*100 + B*100 + C*100)
    expect(parts.join('').replace(/。/g, '')).toBe('A'.repeat(100) + 'B'.repeat(100) + 'C'.repeat(100))
  })

  it('splitText:短文本原样返回,空文本返回空数组', () => {
    expect(splitText('你好', 4500)).toEqual(['你好'])
    expect(splitText('', 4500)).toEqual([])
  })

  it('超长最终回复会自动拆分多条发送', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    const longResult = 'x'.repeat(6000)
    const exec = { run: vi.fn(async () => longResult) }
    router.register(new AgentRpcHandler(exec as never, { maxMessageLength: 2000 }))
    await router.route(makeEvent({ user_id: 10001, raw_message: '/dsh q' }))
    expect(sent.length).toBeGreaterThanOrEqual(3)
    for (const s of sent) expect(s.length).toBeLessThanOrEqual(2000)
    expect(sent.join('')).toBe(longResult)
  })
})
