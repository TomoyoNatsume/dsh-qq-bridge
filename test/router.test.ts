import { describe, it, expect, vi } from 'vitest'
import { MessageRouter } from '../src/router.js'
import { AccessGate } from '../src/security.js'
import { AgentRpcHandler, formatQqReplyStyleSkillPrompt, splitText } from '../src/handlers/agent.js'
import {
  createSetCwdControlHandler,
  createSetModelControlHandler,
  createSetPermissionControlHandler,
  createSetReasoningEffortControlHandler,
  QqControlDispatcher,
} from '../src/handlers/control.js'
import { createScheduleTaskControlHandler } from '../src/handlers/scheduler.js'
import { BridgeControlHandler } from '../src/handlers/model-control.js'
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
    expect(sent).toEqual(['收到，正在处理...', 'echo:hello world'])
  })

  it('QQ style skill 只在显式启用时包装 agent payload', async () => {
    expect(formatQqReplyStyleSkillPrompt('hello')).toBe('hello')

    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const executor = { run: vi.fn(async () => 'ok') }
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new AgentRpcHandler(executor, {
      qqReplyStyleSkill: { enabled: true },
    }))

    await router.route(makeEvent({ user_id: 10001, raw_message: '/dsh hello' }))

    expect(executor.run).toHaveBeenCalledWith(
      'private:10001',
      expect.stringContaining('/qq-session-reply-style'),
    )
    expect(executor.run).toHaveBeenCalledWith(
      'private:10001',
      expect.stringContaining('本条用户消息来自 dsh-qq-bridge QQ 会话。'),
    )
    expect(executor.run).toHaveBeenCalledWith(
      'private:10001',
      expect.stringContaining('User QQ Message:\nhello'),
    )
    expect(sent).toEqual(['收到，正在处理...', 'ok'])
  })

  it('默认 QQ 回复风格 skill 按会话回合主动调用', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const executor = { run: vi.fn(async () => 'ok') }
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new AgentRpcHandler(executor, {
      ackMessage: '',
      qqReplyStyleSkill: { enabled: true },
    }))

    for (let i = 1; i <= 30; i++) {
      await router.route(makeEvent({ user_id: 10001, raw_message: `/dsh q${i}` }))
    }

    const firstPayload = executor.run.mock.calls[0]?.[1]
    const secondPayload = executor.run.mock.calls[1]?.[1]
    const thirtiethPayload = executor.run.mock.calls[29]?.[1]
    expect(firstPayload).toContain('/qq-session-reply-style')
    expect(firstPayload).toContain('本次回复使用 QQ Session Temporary Reply Style')
    expect(secondPayload).toContain('本次回复使用 QQ Session Temporary Reply Style')
    expect(secondPayload).not.toContain('/qq-session-reply-style')
    expect(thirtiethPayload).toContain('/qq-session-reply-style')

    await router.route(makeEvent({ user_id: 10001, raw_message: '/dsh style 请用别的风格' }))
    expect(executor.run.mock.calls.at(-1)?.[1]).toContain('User QQ Message:\nstyle 请用别的风格')
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

  it('commandPrefix 为空时白名单用户普通消息直接进入 agent', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '', mode: 'whitelist' })
    const run = vi.fn(async (_k: string, p: string) => `r:${p}`)
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new AgentRpcHandler({ run } as never, { ackMessage: '' }))

    const consumed = await router.route(makeEvent({ user_id: 10001, raw_message: '当前目录是什么' }))

    expect(consumed).toBe(true)
    expect(run).toHaveBeenCalledWith('private:10001', '当前目录是什么')
    expect(sent).toEqual(['r:当前目录是什么'])
  })

  it('/dir 切换工作区后不会再进入 agent handler', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '', mode: 'whitelist' })
    const setCwd = vi.fn(async () => {})
    const run = vi.fn(async () => 'agent should not run')
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new BridgeControlHandler({
      getModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
      listModels: async () => [],
      selectModel: async (_sessionKey, model) => ({ provider: 'deepseek-official', model }),
      selectReasoningEffort: async (_sessionKey, reasoningEffort) => ({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort,
      }),
    }, { setCwd }))
    router.register(new AgentRpcHandler({ run } as never, { ackMessage: '' }))

    await router.route(makeEvent({ user_id: 10001, raw_message: '/dir /tmp' }))

    expect(setCwd).toHaveBeenCalledWith('private:10001', '/tmp')
    expect(run).not.toHaveBeenCalled()
    expect(sent).toEqual(['已切换当前 QQ 会话工作区: /tmp\n下一条消息会使用新的 Agent session。'])
  })

  it('bridge 模型控制命令直接处理,不会进入 agent handler', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '', mode: 'whitelist' })
    const run = vi.fn(async () => 'agent should not run')
    const sent: string[] = []
    const controller = {
      getModelSelection: vi.fn(() => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })),
      listModels: vi.fn(async () => [
        { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'Flash' },
        { provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'Pro', reasoningEfforts: ['off', 'low', 'high'] },
      ]),
      selectModel: vi.fn(async () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' })),
      selectReasoningEffort: vi.fn(async () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' })),
    }
    const permission = {
      runPermissionCommand: vi.fn(async (_sessionKey: string, preset?: string) => (
        preset ? `权限命令执行成功: preset ${preset}` : '权限命令执行成功: current preset workspace-write'
      )),
    }
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new BridgeControlHandler(controller, { setCwd: vi.fn(async () => {}) }, permission))
    router.register(new AgentRpcHandler({ run } as never, { ackMessage: '' }))

    await router.route(makeEvent({ user_id: 10001, raw_message: '/models' }))
    await router.route(makeEvent({ user_id: 10001, raw_message: '/model deepseek-v4-pro' }))
    await router.route(makeEvent({ user_id: 10001, raw_message: '/reasoningEff low' }))
    await router.route(makeEvent({ user_id: 10001, raw_message: '/permission workspace-write' }))
    await router.route(makeEvent({ user_id: 10001, raw_message: '/permissions' }))
    await router.route(makeEvent({ user_id: 10001, raw_message: '/help' }))

    expect(run).not.toHaveBeenCalled()
    expect(controller.selectModel).toHaveBeenCalledWith('private:10001', 'deepseek-v4-pro')
    expect(controller.selectReasoningEffort).toHaveBeenCalledWith('private:10001', 'low')
    expect(permission.runPermissionCommand).toHaveBeenCalledWith('private:10001', 'workspace-write')
    expect(permission.runPermissionCommand).toHaveBeenCalledWith('private:10001', undefined)
    expect(sent.join('\n')).toContain('deepseek-v4-pro')
    expect(sent.join('\n')).toContain('/reasoningEff <等级>')
    expect(sent.join('\n')).toContain('/permission [preset]')
  })

  it('agent 输出 set_cwd 控制块时执行切目录且不回发原始控制块', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '', mode: 'whitelist' })
    const setCwd = vi.fn(async () => {})
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createSetCwdControlHandler({ setCwd }))
    const run = vi.fn(async () => (
      '<dsh-qq-bridge-control>{"action":"set_cwd","path":"/tmp"}</dsh-qq-bridge-control>'
    ))
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new AgentRpcHandler({ run } as never, { ackMessage: '', controlDispatcher: dispatcher }))

    await router.route(makeEvent({ user_id: 10001, raw_message: '帮我把工作目录改到 /tmp' }))

    expect(setCwd).toHaveBeenCalledWith('private:10001', '/tmp')
    expect(sent).toEqual(['已切换当前 QQ 会话工作区: /tmp\n下一条消息会使用新的 Agent session。'])
    expect(sent.join('\n')).not.toContain('dsh-qq-bridge-control')
  })

  it('agent 输出模型控制块时执行同一套 bridge 控制逻辑且不回发原始控制块', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '', mode: 'whitelist' })
    const controller = {
      getModelSelection: vi.fn(() => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })),
      listModels: vi.fn(async () => [
        {
          provider: 'deepseek-official',
          id: 'deepseek-v4-pro',
          reasoningEfforts: ['off', 'low', 'high', 'max'],
        },
      ]),
      selectModel: vi.fn(async (_sessionKey: string, model: string) => ({
        provider: 'deepseek-official',
        model,
        reasoningEffort: 'high',
      })),
      selectReasoningEffort: vi.fn(async (_sessionKey: string, reasoningEffort: string) => ({
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        reasoningEffort,
      })),
    }
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createSetModelControlHandler(controller))
    dispatcher.register(createSetReasoningEffortControlHandler(controller))
    const run = vi.fn(async () => [
      '<dsh-qq-bridge-control>{"action":"set_model","model":"deepseek-v4-pro"}</dsh-qq-bridge-control>',
      '<dsh-qq-bridge-control>{"action":"set_reasoning_effort","reasoningEffort":"low"}</dsh-qq-bridge-control>',
    ].join('\n'))
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new AgentRpcHandler({ run } as never, { ackMessage: '', controlDispatcher: dispatcher }))

    await router.route(makeEvent({ user_id: 10001, raw_message: '把模型改成 deepseek-v4-pro，推理等级改 low' }))

    expect(controller.selectModel).toHaveBeenCalledWith('private:10001', 'deepseek-v4-pro')
    expect(controller.selectReasoningEffort).toHaveBeenCalledWith('private:10001', 'low')
    expect(sent.join('\n')).toContain('已切换模型: deepseek-v4-pro')
    expect(sent.join('\n')).toContain('reasoningEffort: low')
    expect(sent.join('\n')).not.toContain('dsh-qq-bridge-control')
  })

  it('agent 输出权限控制块时执行同一套 bridge 控制逻辑且不回发原始控制块', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '', mode: 'whitelist' })
    const permission = {
      runPermissionCommand: vi.fn(async (_sessionKey: string, preset?: string) => (
        `权限命令执行成功: preset ${preset}`
      )),
    }
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createSetPermissionControlHandler(permission))
    const run = vi.fn(async () => (
      '<dsh-qq-bridge-control>{"action":"set_permission","preset":"workspace-write"}</dsh-qq-bridge-control>'
    ))
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new AgentRpcHandler({ run } as never, { ackMessage: '', controlDispatcher: dispatcher }))

    await router.route(makeEvent({ user_id: 10001, raw_message: '把权限改成 workspace-write' }))

    expect(permission.runPermissionCommand).toHaveBeenCalledWith('private:10001', 'workspace-write')
    expect(sent).toEqual(['权限命令执行成功: preset workspace-write'])
    expect(sent.join('\n')).not.toContain('dsh-qq-bridge-control')
  })

  it('agent 输出定时任务控制块时创建插件内任务且不回发原始控制块', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '', mode: 'whitelist' })
    const scheduler = {
      scheduleTask: vi.fn(async () => ({
        id: 'task-1',
        runAtText: '2026-09-01T12:00:00+08:00',
      })),
    }
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createScheduleTaskControlHandler(scheduler))
    const run = vi.fn(async () => (
      '<dsh-qq-bridge-control>{"action":"schedule_task","runAt":"2026-09-01T12:00:00+08:00","message":"提醒我提交报告"}</dsh-qq-bridge-control>'
    ))
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    router.register(new AgentRpcHandler({ run } as never, { ackMessage: '', controlDispatcher: dispatcher }))

    await router.route(makeEvent({ user_id: 10001, raw_message: '请在 2026 年 9 月 1 号中午 12 点提醒我提交报告' }))

    expect(scheduler.scheduleTask).toHaveBeenCalledWith({
      sessionKey: 'private:10001',
      source: expect.objectContaining({ userId: 10001, scope: 'private' }),
      runAt: '2026-09-01T12:00:00+08:00',
      message: '提醒我提交报告',
    })
    expect(sent).toEqual(['已创建定时任务: 2026-09-01T12:00:00+08:00\n到点后会在当前 QQ 会话触发 Agent。'])
    expect(sent.join('\n')).not.toContain('dsh-qq-bridge-control')
  })

  it('group 消息同样受白名单与前缀约束', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const run = vi.fn(async (_k: string, p: string) => `r:${p}`)
    const sent: string[] = []
    const router = new MessageRouter(gate, async (scope, id, text) => void sent.push(`${scope}#${id}#${text}`))
    router.register(new AgentRpcHandler({ run } as never))
    await router.route(makeEvent({ message_type: 'group', group_id: 555, user_id: 10001, raw_message: '/dsh task' }))
    expect(run).toHaveBeenCalledWith('group:555', 'task')
    expect(sent).toEqual(['group#555#收到，正在处理...', 'group#555#r:task'])
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
    expect(sent).toEqual(['收到，正在处理...', '最终完整结果'])
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
    expect(sent).toEqual(['收到，正在处理...', '这是结果', '最终完整结果'])

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
    expect(sent2).toEqual(['收到，正在处理...', '开始思考', '这是结果', '最终完整结果'])
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
    expect(sent).toEqual(['收到，正在处理...', '最终', '结果'])
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
    expect(sent[0]).toBe('收到，正在处理...')
    expect(sent.length).toBeGreaterThanOrEqual(4)
    for (const s of sent) expect(s.length).toBeLessThanOrEqual(2000)
    expect(sent.slice(1).join('')).toBe(longResult)
  })

  it('agent 超时后回发无响应消息,不等待永久 pending 的 executor', async () => {
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const sent: string[] = []
    const router = new MessageRouter(gate, async (_, __, text) => void sent.push(text))
    let resolveLate: ((value: string) => void) | undefined
    const exec = { run: vi.fn(() => new Promise<string>((resolve) => { resolveLate = resolve })) }
    router.register(new AgentRpcHandler(exec as never, { timeoutMs: 5 }))

    await router.route(makeEvent({ user_id: 10001, raw_message: '/dsh q' }))
    resolveLate?.('late result')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent).toEqual(['收到，正在处理...', 'agent 无响应，请稍后重试。'])
  })
})
