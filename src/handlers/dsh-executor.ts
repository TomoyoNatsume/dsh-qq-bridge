import { AgentExecutor } from './agent.js'
import {
  BridgeModelInfo,
  BridgeModelSelection,
  BridgeModelSelectionRef,
  ModelSelectionController,
  PermissionController,
  resolveConfiguredModels,
} from './model-control.js'

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
  /** 原始 DSH agent 对象;需要调用 host 原生命令服务时使用。 */
  _commandAgent?: unknown
}

export type DshCommandExecutor = (agent: unknown, line: string) => Promise<string | undefined>

/**
 * DSH 服务句柄 —— 由插件注入,mock 可注入。
 * getOrCreate 必须返回带 dispose 的 live agent,便于 executor 统一释放。
 */
export interface DshServiceHandles {
  /** 按 sessionKey 获取(已有)或创建(miss)一个 live agent。 */
  getOrCreate(options: {
    sessionKey: string
    sessionId: string
    cwd?: string
    modelSelection: BridgeModelSelectionRef
  }): Promise<DshRenderedAgent>
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
export class DshAgentExecutor implements AgentExecutor, PermissionController {
  private agents = new Map<string, DshRenderedAgent>()
  private sessions = new Map<string, string>() // sessionKey -> sessionId
  private sessionCwds = new Map<string, string>()
  private sessionVersions = new Map<string, number>()
  private sessionSelections = new Map<string, BridgeModelSelection>()
  private selectionRefs = new Map<string, BridgeModelSelectionRef>()
  private queues = new Map<string, Promise<void>>()
  /**
   * 本 executor 实例(即一次插件挂载/一次 host boot)唯一的后缀。
   * 避免跨 host 重启复用固定 sessionId 时,与磁盘上残留的旧会话发生 id collision。
   * 同一 boot 内多轮上下文仍通过 sessionKey→sessionId 映射保持。
   */
  private readonly bootSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  constructor(
    private readonly dsh: DshServiceHandles,
    private readonly opts: {
      defaultCwd?: string
      defaultProvider?: string
      defaultModel?: string
      models?: readonly string[]
      resolveModelSelection?: (selection: BridgeModelSelection) => Promise<BridgeModelSelection>
      listModels?: (provider: string) => Promise<BridgeModelInfo[]>
      executeCommand?: DshCommandExecutor
    } = {},
  ) {}

  async run(
    sessionKey: string,
    payload: string,
    onChunk?: (text: string, kind: 'text' | 'reasoning') => void,
  ): Promise<string> {
    return await this.enqueue(sessionKey, () => this.runNow(sessionKey, payload, onChunk))
  }

  private async runNow(
    sessionKey: string,
    payload: string,
    onChunk?: (text: string, kind: 'text' | 'reasoning') => void,
  ): Promise<string> {
    const { agent, sessionId } = await this.getOrCreateSessionAgent(sessionKey)

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

  async runPermissionCommand(sessionKey: string, preset?: string): Promise<string> {
    return await this.enqueue(sessionKey, async () => {
      if (!this.opts.executeCommand) return '当前 host 不支持权限切换。'
      const { agent } = await this.getOrCreateSessionAgent(sessionKey)
      const line = preset?.trim() ? `/permission ${preset.trim()}` : '/permission'
      const text = await this.opts.executeCommand(agent._commandAgent ?? agent, line)
      return text ?? '当前 host 不支持权限切换。'
    })
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

  getModelSelection(sessionKey: string): BridgeModelSelection {
    return this.selectionRef(sessionKey).current
  }

  async selectModel(sessionKey: string, model: string): Promise<BridgeModelSelection> {
    const current = this.getModelSelection(sessionKey)
    const selected = await this.resolveSelection({
      provider: current.provider,
      model,
    })
    this.setSelection(sessionKey, selected)
    return selected
  }

  async selectReasoningEffort(sessionKey: string, effort: string): Promise<BridgeModelSelection> {
    const current = this.getModelSelection(sessionKey)
    const selected = await this.resolveSelection({
      provider: current.provider,
      model: current.model,
      reasoningEffort: effort,
    })
    this.setSelection(sessionKey, selected)
    return selected
  }

  async listModels(sessionKey: string): Promise<BridgeModelInfo[]> {
    const provider = this.getModelSelection(sessionKey).provider
    if (this.opts.listModels) {
      const models = await this.opts.listModels(provider)
      if (models.length > 0) return models
    }
    return resolveConfiguredModels(this.opts.defaultModel ?? 'deepseek-v4-flash', this.opts.models)
      .map(id => ({ provider, id, name: id }))
  }

  /** 切换某个 QQ 来源的工作目录;下一轮会创建新的 DSH session。 */
  async setCwd(sessionKey: string, cwd: string): Promise<void> {
    this.sessionCwds.set(sessionKey, cwd)
    this.sessionVersions.set(sessionKey, (this.sessionVersions.get(sessionKey) ?? 0) + 1)
    await this.disposeSession(sessionKey)
  }

  /** 当前 QQ 来源的工作目录;未切换时返回配置默认目录或 host cwd。 */
  getCwd(sessionKey: string): string {
    return this.sessionCwds.get(sessionKey) ?? this.opts.defaultCwd ?? process.cwd()
  }

  /** 释放全部 live agent(插件 teardown 时调用)。 */
  async disposeAll(): Promise<void> {
    const agents = [...this.agents.values()]
    this.agents.clear()
    this.sessions.clear()
    this.sessionCwds.clear()
    this.sessionVersions.clear()
    this.sessionSelections.clear()
    this.selectionRefs.clear()
    this.queues.clear()
    await Promise.all(agents.map((a) => a.dispose()))
  }

  get liveSessionCount(): number {
    return this.agents.size
  }

  private async enqueue<T>(sessionKey: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(sessionKey) ?? Promise.resolve()
    const next = prev.then(task)
    // 吞掉队列尾部错误,避免串行链断掉后续消息
    this.queues.set(sessionKey, next.then(() => undefined, () => undefined))
    return await next
  }

  private async getOrCreateSessionAgent(sessionKey: string): Promise<{ agent: DshRenderedAgent; sessionId: string }> {
    const sessionIdExists = this.sessions.get(sessionKey)
    const sessionId = sessionIdExists ?? this.createSessionId(sessionKey)
    this.sessions.set(sessionKey, sessionId)

    let agent = this.agents.get(sessionKey)
    if (!agent) {
      agent = await this.dsh.getOrCreate({
        sessionKey,
        sessionId,
        cwd: this.sessionCwds.get(sessionKey) ?? this.opts.defaultCwd,
        modelSelection: this.selectionRef(sessionKey),
      })
      this.agents.set(sessionKey, agent)
    }
    return { agent, sessionId }
  }

  private createSessionId(sessionKey: string): string {
    const version = this.sessionVersions.get(sessionKey) ?? 0
    return `qq-${hashKey(sessionKey)}-${this.bootSuffix}-${version}`
  }

  private selectionRef(sessionKey: string): BridgeModelSelectionRef {
    const existing = this.selectionRefs.get(sessionKey)
    if (existing) return existing
    const ref: BridgeModelSelectionRef = {
      current: this.sessionSelections.get(sessionKey) ?? this.defaultSelection(),
    }
    this.selectionRefs.set(sessionKey, ref)
    return ref
  }

  private setSelection(sessionKey: string, selection: BridgeModelSelection): void {
    this.sessionSelections.set(sessionKey, selection)
    this.selectionRef(sessionKey).current = selection
  }

  private async resolveSelection(selection: BridgeModelSelection): Promise<BridgeModelSelection> {
    if (this.opts.resolveModelSelection) return await this.opts.resolveModelSelection(selection)
    return selection
  }

  private defaultSelection(): BridgeModelSelection {
    return {
      provider: this.opts.defaultProvider ?? 'deepseek-official',
      model: this.opts.defaultModel ?? 'deepseek-v4-flash',
    }
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
