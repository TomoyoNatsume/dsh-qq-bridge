import { describe, expect, it, vi } from 'vitest'
import {
  formatApprovalRequest,
  formatAskUserRequest,
  QqInteractionBridge,
  resolveApproval,
  resolveAskUser,
} from '../src/interactions.js'
import { MessageRouter } from '../src/router.js'
import { AccessGate } from '../src/security.js'
import { AgentRpcHandler } from '../src/handlers/agent.js'
import { OnebotMessageEvent } from '../src/onebot/types.js'

function makeEvent(raw_message: string): OnebotMessageEvent {
  return {
    post_type: 'message',
    message_type: 'private',
    user_id: 10001,
    raw_message,
    message_id: 1,
  }
}

describe('QQ interaction bridge', () => {
  it('ask-user 编号回复会映射回原始选项 label', () => {
    const questions = [{
      id: 'mode',
      question: '选择模式?',
      options: [
        { label: '快速' },
        { label: '完整' },
      ],
    }]

    expect(resolveAskUser('2', questions, [
      { index: 1, questionId: 'mode', label: '快速' },
      { index: 2, questionId: 'mode', label: '完整' },
    ])).toEqual({ answers: [{ id: 'mode', selected: ['完整'] }] })
  })

  it('ask-user 自定义回复会作为 custom 传回 agent', () => {
    expect(resolveAskUser('我想自己指定', [{ id: 'idea', question: '说说你的想法' }], []))
      .toEqual({ answers: [{ id: 'idea', selected: [], custom: '我想自己指定' }] })
  })

  it('approval 只把 1 作为允许一次,其它回复按拒绝处理', () => {
    expect(resolveApproval('1')).toBe('allowed-once')
    expect(resolveApproval('2')).toBe('rejected')
    expect(resolveApproval('随便说点什么')).toBe('rejected')
  })

  it('格式化时给用户展示编号和回复提示', () => {
    expect(formatApprovalRequest({ agent: {}, toolName: 'bash', reason: 'needs file edit' }, [
      { index: 1, questionId: 'approval', label: '允许一次' },
      { index: 2, questionId: 'approval', label: '拒绝' },
    ], '/dsh')).toContain('/dsh 1')

    expect(formatAskUserRequest([{
      id: 'choice',
      question: '选哪个?',
      options: [{ label: 'A', description: 'alpha' }],
    }], [{ index: 1, questionId: 'choice', label: 'A' }])).toContain('1. A - alpha')
  })

  it('pending QQ 回复优先消费,不会进入 agent handler', async () => {
    const sent: string[] = []
    const bridge = new QqInteractionBridge(async (_scope, _targetId, text) => void sent.push(text))
    const agent = {}
    bridge.bindAgent('private:10001', agent)
    const userQuestions = { ask: vi.fn(async () => ({ answers: [] })) }
    const dispose = bridge.register({ userQuestions })
    const asking = userQuestions.ask({
      questions: [{ id: 'confirm', question: '继续?', options: [{ label: '继续' }] }],
      agent,
    })

    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const run = vi.fn(async () => 'agent should not run')
    const router = new MessageRouter(gate, async (_scope, _id, text) => void sent.push(text), bridge)
    router.register(new AgentRpcHandler({ run }, { ackMessage: '' }))

    await router.route(makeEvent('/dsh 1'))

    await expect(asking).resolves.toEqual({ answers: [{ id: 'confirm', selected: ['继续'] }] })
    expect(run).not.toHaveBeenCalled()
    expect(sent.at(-1)).toBe('已收到回复，Agent 会继续处理。')
    dispose()
  })

  it('通过 optional inject 接入 userQuestions,不在未注入上下文读取服务', async () => {
    const sent: string[] = []
    const bridge = new QqInteractionBridge(async (_scope, _targetId, text) => void sent.push(text))
    const agent = {}
    bridge.bindAgent('private:10001', agent)
    const userQuestions = { ask: vi.fn(async () => ({ answers: [] })) }
    const injected = vi.fn((services: readonly string[], cb: (ctx: { userQuestions: typeof userQuestions }) => void) => {
      expect(services).toEqual(['userQuestions'])
      cb({ userQuestions })
      return { dispose: vi.fn() }
    })
    const ctx = {
      inject: injected,
      get userQuestions(): typeof userQuestions {
        throw new Error('cannot get property "userQuestions" without inject')
      },
    }

    const dispose = bridge.register(ctx)
    const asking = userQuestions.ask({
      questions: [{ id: 'confirm', question: '继续?', options: [{ label: '继续' }] }],
      agent,
    })

    expect(injected).toHaveBeenCalled()
    expect(sent[0]).toContain('Agent 需要你的回复')
    const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
    const router = new MessageRouter(gate, async (_scope, _id, text) => void sent.push(text), bridge)

    await router.route(makeEvent('/dsh 1'))

    await expect(asking).resolves.toEqual({ answers: [{ id: 'confirm', selected: ['继续'] }] })
    dispose()
  })
})
