import { AgentExecutor } from './agent.js'

/**
 * 从 DSH 的 session surface 中提取最后一条 assistant 消息的纯文本。
 * 允许的 ContentBlock 文本形状:{ type: 'text', text: string }。
 */
export function extractLastAssistantText(events: readonly unknown[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i] as { type?: string; content?: readonly unknown[] } | null | undefined
    if (!evt || evt.type !== 'assistant/message' || !Array.isArray(evt.content)) continue
    const text = evt.content
      .filter((b): b is { type: string; text: string } => {
        const blk = b as { type?: string; text?: string }
        return !!blk && blk.type === 'text' && typeof blk.text === 'string'
      })
      .map((b) => b.text)
      .join('\n')
    if (text) return text
  }
  return null
}

/**
 * DSH 服务句柄 —— 由插件从真实 DSH 注入,测试时可注入 mock。
 * createAgent 返回 live agent 本体,deliver 在其上投料并等待。
 */
export interface DshServiceHandles {
  /** 新建一个 Agent 会话,返回 live agent 与 teardown。 */
  createAgent(options: { sessionId: string }): Promise<DshRenderedAgent>
  /** 投递一条用户消息到该 agent,并等待其到达空闲。 */
  deliver(agent: DshRenderedAgent, prompt: string): Promise<void>
  /** 读取会话 surface(events)以提取回复。 */
  readSurface(sessionId: string): Promise<readonly unknown[]>
}

/** 一个已创建的、可投料等待的 DSH agent 渲染。 */
export interface DshRenderedAgent {
  /** 驱动接口:投料 + 等待空闲。 */
  followup(message: { content: unknown; source: unknown }): void
  whenIdle(): Promise<void>
  /** 分解钩子(dispose agent)。 */
  done(): Promise<void>
}

/**
 * A 内置 handler 的 DSH 真实实现:
 * 每个 sessionKey 派发一个独立 Agent 会话 → 投喂 payload → 等待空闲 → 读取回复 → 销毁。
 *
 * M2 以「每次请求新建会话」实现(最简单、无持久化依赖);
 * M3 再把相同 sessionKey 复用持久化会话以获得多轮上下文。
 */
export class DshAgentExecutor implements AgentExecutor {
  constructor(private readonly dsh: DshServiceHandles) {}

  async run(sessionKey: string, payload: string): Promise<string> {
    const sessionId = `qq-${hashKey(sessionKey)}`
    const agent = await this.dsh.createAgent({ sessionId })
    try {
      await this.dsh.deliver(agent, payload)
      const events = await this.dsh.readSurface(sessionId)
      const text = extractLastAssistantText(events)
      return text ?? '(agent produced no text)'
    } finally {
      await agent.done()
    }
  }
}

/** 简单确定性哈希,把任意 sessionKey 映射到固定长度可用的 session id。 */
export function hashKey(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
