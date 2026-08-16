import { AgentExecutor } from './agent.js'

/**
 * 提取 session surface 中最后一条 assistant 消息的纯文本。
 *
 * 兼容两种事件形状:
 * - **DSH 真实形状**: `{ type, seq, data: { message: { content: [...] } }, ... }`
 *   (assistant 消息体挂在 `data.message.content`)。
 * - 简易形状(用于本地测试): `{ type: 'assistant/message', content: [...] }`。
 */
export function extractLastAssistantText(events: readonly unknown[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i] as
      | {
          type?: string
          content?: readonly unknown[]
          data?: { message?: { content?: readonly unknown[] } }
        }
      | null
      | undefined
    if (!evt || evt.type !== 'assistant/message') continue
    const blocks = evt.data?.message?.content ?? evt.content
    if (!Array.isArray(blocks)) continue
    const text = blocks
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
 * DSH 工具调用没有被运行时识别时,模型可能把 DSML 协议文本当普通 text 输出。
 * 这类内容不是有效回复,也不应透传给 QQ 用户。
 */
export function isUnexecutedDsmlToolCall(text: string): boolean {
  return text.includes('<｜｜DSML｜｜tool_calls>')
    || text.includes('<||DSML||tool_calls>')
    || /<tool_calls>\s*(?:<tool_calls>\s*)?<invoke\s+name=/i.test(text)
}

/** 一个可投料、等待、可释放销毁的 DSH agent 会话。 */
export interface DshRenderedAgent {
  followup(message: { id: string; role: string; content: unknown; source: unknown }): void
  whenIdle(): Promise<void>
  /**
   * 读取该 live agent 会话的**实时**事件(即会话已提交的日志)。
   * 若实现提供,executor 优先用它提取回复,避免走持久化 corpus 的滞后;
   * 未提供则回退到 `DshServiceHandles.readSurface(sessionId)`。
   */
  readSurface?(): Promise<readonly unknown[]>
  /** 销毁该会话底层的 DSH agent(释放资源)。 */
  dispose(): Promise<void>
}

/**
 * DSH 服务句柄 —— 由插件注入,mock 可注入。
 * getOrCreate 必须返回带 dispose 的 live agent,便于 executor 统一释放。
 */
export interface DshServiceHandles {
  /** 按 sessionKey 获取(已有)或创建(miss)一个 live agent。 */
  getOrCreate(options: { sessionKey: string; sessionId: string }): Promise<DshRenderedAgent>
  /**
   * 投递用户消息并等待本轮完成。
   * @param onChunk 可选分段回调:agent 产出过程中的文本增量,便于流式回发。
   */
  deliver(
    agent: DshRenderedAgent,
    prompt: string,
    onChunk?: (text: string, kind: 'text' | 'reasoning') => void,
  ): Promise<void>
  /** 读取会话 surface(events)以提取本轮回复。 */
  readSurface(sessionId: string): Promise<readonly unknown[]>
}

/**
 * A 内置 handler 的 DSH 实现 —— 多轮上下文版本。
 *
 * - 每个 QQ sessionKey 持有一个常驻 live agent:首次创建、之后复用 → 保留多轮上下文。
 * - 同一 sessionKey 的并发消息串行排队,避免并发驱动同一会话。
 * - disposeAll() 在插件 teardown 时释放全部 live agent。
 * - disposeSession() 可主动丢弃某个会话(如错误恢复、会话上限)。
 */
export class DshAgentExecutor implements AgentExecutor {
  private agents = new Map<string, DshRenderedAgent>()
  private sessions = new Map<string, string>() // sessionKey -> sessionId
  private queues = new Map<string, Promise<void>>()
  /**
   * 本 executor 实例(即一次插件挂载/一次 host boot)唯一的后缀。
   * 避免跨 host 重启复用固定 sessionId 时,与磁盘上残留的旧会话发生 id collision。
   * 同一 boot 内多轮上下文仍通过 sessionKey→sessionId 映射保持。
   */
  private readonly bootSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  constructor(private readonly dsh: DshServiceHandles) {}

  async run(
    sessionKey: string,
    payload: string,
    onChunk?: (text: string, kind: 'text' | 'reasoning') => void,
  ): Promise<string> {
    const prev = this.queues.get(sessionKey) ?? Promise.resolve()
    const next = prev.then(() => this.runNow(sessionKey, payload, onChunk))
    // 吞掉队列尾部错误,避免串行链断掉后续消息
    this.queues.set(sessionKey, next.then(() => undefined, () => undefined))
    return next
  }

  private async runNow(
    sessionKey: string,
    payload: string,
    onChunk?: (text: string, kind: 'text' | 'reasoning') => void,
  ): Promise<string> {
    const sessionIdExists = this.sessions.get(sessionKey)
    const sessionId = sessionIdExists ?? `qq-${hashKey(sessionKey)}-${this.bootSuffix}`
    this.sessions.set(sessionKey, sessionId)

    let agent = this.agents.get(sessionKey)
    if (!agent) {
      agent = await this.dsh.getOrCreate({ sessionKey, sessionId })
      this.agents.set(sessionKey, agent)
    }

    await this.dsh.deliver(agent, payload, onChunk)
    const events = await this.readEvents(agent, sessionId)
    const text = extractLastAssistantText(events)
    if (text !== null && isUnexecutedDsmlToolCall(text)) {
      return [
        'agent 生成了一个未被 DSH 执行的工具调用,已拦截原始协议文本。',
        '这通常是当前模型/工具调用模式不匹配导致的。请换用支持 native tool calling 的模型,或调整 DSH_TOOLS_MODE 后重试。',
      ].join('\n')
    }
    if (text === null) {
      // 调试图:提取不到文本时无条件落盘(写到 workspace 内,host 与开发侧都能访问)。
      try {
        const fs = await import('node:fs')
        const dir = '/home/liangyihao/temp/dsh-qq-bridge'
        fs.writeFileSync(`${dir}/.debug-surface.json`, JSON.stringify(events, null, 2))
        try {
          const persisted = await this.dsh.readSurface(sessionId)
          fs.writeFileSync(`${dir}/.debug-persisted.json`, JSON.stringify(persisted, null, 2))
        } catch { /* noop */ }
      } catch { /* noop */ }
    }
    return text ?? '(agent produced no text)'
  }

  /** 优先读 live agent 的实时会话日志,缺省则退回持久化 surface。 */
  private async readEvents(agent: DshRenderedAgent, sessionId: string): Promise<readonly unknown[]> {
    if (typeof agent.readSurface === 'function') {
      const live = await agent.readSurface()
      if (live && live.length) return live
    }
    return this.dsh.readSurface(sessionId)
  }

  /** 主动丢弃某个会话的 live agent。 */
  async disposeSession(sessionKey: string): Promise<void> {
    const agent = this.agents.get(sessionKey)
    if (agent) {
      this.agents.delete(sessionKey)
      await agent.dispose()
    }
    this.sessions.delete(sessionKey)
    this.queues.delete(sessionKey)
  }

  /** 释放全部 live agent(插件 teardown 时调用)。 */
  async disposeAll(): Promise<void> {
    const agents = [...this.agents.values()]
    this.agents.clear()
    this.sessions.clear()
    this.queues.clear()
    await Promise.all(agents.map((a) => a.dispose()))
  }

  get liveSessionCount(): number {
    return this.agents.size
  }
}

/** 确定性哈希,把任意 sessionKey 映射到固定长度可用的 session id。 */
export function hashKey(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
