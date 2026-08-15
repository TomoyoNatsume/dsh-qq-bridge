import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OnebotClient, Transport } from '../src/onebot/client.js'
import { MessageRouter } from '../src/router.js'
import { AccessGate } from '../src/security.js'
import { AgentRpcHandler } from '../src/handlers/agent.js'
import { DshAgentExecutor, DshRenderedAgent } from '../src/handlers/dsh-executor.js'
import { OnebotMessageEvent } from '../src/onebot/types.js'

/**
 * M5 预演 —— 全链路本地回环集成测试。
 *
 * 用内存 transport 模拟「NapCat(onebot 正向 WS)」:
 *   - connect() 即建立虚拟连接
 *   - 从设备侧 pushFrame(...) 代表 NapCat 收到一条 QQ 消息并推给 Host
 *   - Host 回发的 action(send_private_msg / send_group_msg)被捕获到 outbound[],
 *     相当于已经投递给真实 QQ 小号。
 *
 * 从而在无需真实 NapCat/QQ 小号的情况下,验证:
 *   WS transport → OnebotClient → AccessGate → MessageRouter → AgentRpcHandler
 *   → DshAgentExecutor(多轮) → 回发 outbound —— 整条链路。
 */

/** 伪造 onebot 正向 WS 的 transport(相当于假 NapCat)。 */
class FakeNapCatTransport implements Transport {
  connected = false
  private listeners = new Set<(frame: Record<string, unknown>) => void>()
  outbound: Record<string, unknown>[] = []

  async connect(): Promise<void> {
    this.connected = true
  }

  async send(frame: Record<string, unknown>): Promise<void> {
    // Host → NapCat 的 action,如 send_private_msg
    this.outbound.push(frame)
  }

  onFrame(cb: (frame: Record<string, unknown>) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** 模拟 NapCat 把一条入站 QQ 消息推送给 Host。 */
  pushMessage(evt: OnebotMessageEvent): void {
    for (const cb of this.listeners) cb(evt as unknown as Record<string, unknown>)
  }

  async dispose(): Promise<void> {
    this.connected = false
    this.listeners.clear()
  }
}

/** 用真正的 OnebotClient+Router+Agent 组装一条可用的插件链路。 */
async function buildChain() {
  const transport = new FakeNapCatTransport()
  const client = new OnebotClient(transport)
  await client.connect()
  const outbound = await client.sendPrivate.bind(client) === undefined ? undefined : undefined

  const gate = new AccessGate({ adminQq: 10001, allowlist: [], commandPrefix: '/dsh', mode: 'whitelist' })
  // 真实 outbound:私聊目标 = user_id,群聊目标 = group_id
  const outboundSender = async (scope: 'private' | 'group', targetId: number, text: string) => {
    if (scope === 'private') await client.sendPrivate(targetId, text)
    else await client.sendGroup(targetId, text)
  }

  const router = new MessageRouter(gate, outboundSender)

  // DSH fallback executor(无真实 DSH):每轮 tail 出一条回复,记下收到的 prompt 以便断言多轮
  const gotPrompts: string[] = []
  const live = new Map<string, DshRenderedAgent>()
  const dsh = {
    async getOrCreate({ sessionKey, sessionId }: { sessionKey: string; sessionId: string }) {
      const agent: DshRenderedAgent = {
        followup: vi.fn(),
        async whenIdle() {},
        async dispose() {
          live.delete(sessionId)
        },
      }
      live.set(sessionId, agent)
      return agent
    },
    async deliver(_agent: DshRenderedAgent, prompt: string) {
      gotPrompts.push(prompt)
    },
    async readSurface(_sessionId: string) {
      const i = gotPrompts.length - 1
      return [
        { type: 'assistant/message', content: [{ type: 'text', text: `reply#${i}` }] },
      ]
    },
  }
  router.register(new AgentRpcHandler(new DshAgentExecutor(dsh)))

  const onMessage = client.onMessage((evt) => void router.route(evt))
  return { transport, client, router, gotPrompts, onMessage }
}

describe('dsh-qq-bridge — M5 本地回环全链路', () => {
  let chain: Awaited<ReturnType<typeof buildChain>>

  beforeEach(async () => {
    chain = await buildChain()
  })

  it('私聊:QQ 消息 → Agent → 回发 send_private_msg 到发送者', async () => {
    chain.transport.pushMessage({
      post_type: 'message',
      message_type: 'private',
      user_id: 10001,
      raw_message: '/dsh hello',
      message_id: 1,
    })
    // 让回发动作落地
    await new Promise((r) => setTimeout(r, 0))
    const sent = chain.transport.outbound
    expect(sent).toHaveLength(1)
    const frame = sent[0] as { action: string; params: { user_id: number; message: string } }
    expect(frame.action).toBe('send_private_msg')
    expect(frame.params.user_id).toBe(10001)
    expect(frame.params.message).toContain('reply#0')
  })

  it('多轮:同一会话第二次消息复用 agent,收到递增回复', async () => {
    const push = () =>
      chain.transport.pushMessage({
        post_type: 'message',
        message_type: 'private',
        user_id: 10001,
        raw_message: '/dsh hi',
        message_id: 2,
      })
    push()
    await new Promise((r) => setTimeout(r, 0))
    push()
    await new Promise((r) => setTimeout(r, 0))

    expect(chain.gotPrompts).toEqual(['hi', 'hi'])
    // 两次回发,第二次 reply#1(说明上下文/会话延续)
    const texts = chain.transport.outbound.map((f) => (f as { params: { message: string } }).params.message)
    expect(texts).toEqual(['reply#0', 'reply#1'])
  })

  it('群聊:回发 send_group_msg 到 group_id', async () => {
    chain.transport.pushMessage({
      post_type: 'message',
      message_type: 'group',
      user_id: 10001,
      group_id: 555,
      raw_message: '/dsh team status',
      message_id: 3,
    })
    await new Promise((r) => setTimeout(r, 0))
    const frame = chain.transport.outbound[0] as { action: string; params: { user_id?: number; group_id?: number } }
    expect(frame.action).toBe('send_group_msg')
    expect(frame.params.group_id).toBe(555)
  })

  it('白名单外的人被拒绝,无回发', async () => {
    chain.transport.pushMessage({
      post_type: 'message',
      message_type: 'private',
      user_id: 9999,
      raw_message: '/dsh whatever',
      message_id: 4,
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(chain.transport.outbound).toHaveLength(0)
    expect(chain.gotPrompts).toHaveLength(0)
  })

  it('不以指令前缀开头的消息不进入 Agent', async () => {
    chain.transport.pushMessage({
      post_type: 'message',
      message_type: 'private',
      user_id: 10001,
      raw_message: 'just chatting',
      message_id: 5,
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(chain.transport.outbound).toHaveLength(0)
  })
})
