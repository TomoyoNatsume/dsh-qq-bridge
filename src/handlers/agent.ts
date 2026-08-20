import { Handler, HandlerContext } from '../router.js'

export const DEFAULT_QQ_MESSAGE_STYLE_PROMPT = [
  '仅本次 QQ 对话适用:不要写入记忆系统,不要作为全局偏好,不要影响其它 DSH 对话。',
  '通过 QQ 回复时:',
  '1. 先给结论。',
  '2. 回复尽量简明扼要。',
  '3. 不使用 Markdown 风格,用纯文本回复；可以多用 emoji。',
].join('\n')

export interface QqMessageStyleOptions {
  enabled?: boolean
  prompt?: string
}

const QQ_SESSION_STYLE_REPEAT_INTERVAL = 30

export interface QqSessionStyleInjection {
  includeFull: boolean
}

/**
 * 把文本按最大长度切分为多条,保证每条不超过 maxLen。
 * 优先在换行/标点附近切(保持可读),实在没有边界则硬切。
 */
export function splitText(text: string, maxLen: number): string[] {
  if (maxLen <= 0 || text.length <= maxLen) return text === '' ? [] : [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > maxLen) {
    // 在 maxLen-1 往前找最近的换行或标点作为切点(留一位容纳标点)
    const searchTo = maxLen - 1
    let cut = rest.lastIndexOf('\n', searchTo)
    if (cut <= 0) cut = Math.max(
      rest.lastIndexOf('。', searchTo),
      rest.lastIndexOf('！', searchTo),
      rest.lastIndexOf('？', searchTo),
      rest.lastIndexOf('.', searchTo),
      rest.lastIndexOf('，', searchTo),
      rest.lastIndexOf(',', searchTo),
    )
    if (cut <= 0) cut = searchTo // 无边界,硬切(maxLen-1,保证 <= maxLen)
    parts.push(rest.slice(0, cut + 1).trimStart())
    rest = rest.slice(cut + 1)
  }
  if (rest.trim()) parts.push(rest.trimStart())
  return parts.filter((p) => p.length > 0)
}

/**
 * 可注入的“遥控 DSH Agent”执行器。
 * 生产环境由 Cordis 插件接入 DSH 的 agents/agentLoop 服务注入;
 * 测试时可注入一个假执行器,无需真实 DSH。
 */
export interface AgentExecutor {
  /**
   * 把 payload 交给一个 DSH Agent 会话处理,返回最终文本。
   * @param sessionKey 用于把同一 QQ 会话映射到固定 AgentId(多轮上下文)
   * @param payload 用户消息
   * @param onChunk 可选:agent 产出过程中的分段回调(流式返回)。
   *        kind='text' 为最终回复文本增量;kind='reasoning' 为思考过程增量。
   */
  run(
    sessionKey: string,
    payload: string,
    onChunk?: (text: string, kind: 'text' | 'reasoning') => void,
  ): Promise<string>
}

/**
 * A 内置 handler:QQ 消息 → 遥控 DSH Agent → 回发。
 */
export class AgentRpcHandler implements Handler {
  name = 'agent'
  private readonly qqStyleTurnCounts = new Map<string, number>()

  constructor(
    private readonly executor: AgentExecutor,
    private readonly opts: {
      streamReasoning?: boolean
      /** 是否边生成边回发 text 分段;默认 false,等待 agent 本轮完成后只发送最终回复。 */
      streamText?: boolean
      /** 单条 QQ 消息最大长度;超长自动拆分为多条发送。 */
      maxMessageLength?: number
      /** 收到有效指令后立即回发的确认消息;设为空字符串可关闭。 */
      ackMessage?: string
      /** Agent 超时时间(ms);默认 120s。 */
      timeoutMs?: number
      /** Agent 长时间无响应时回发的消息。 */
      timeoutMessage?: string
      /** 仅 QQ 入站消息使用的回复风格提示。 */
      qqMessageStyle?: QqMessageStyleOptions
    } = {},
  ) {}

  test(payload: string): boolean {
    // 默认所有有效载荷都交给 Agent(可扩展:保留特定子命令给其它 handler)。
    // 若不希望 Agent 吞掉所有指令,可改成匹配某前缀,例如 payload 以 `ask ` 开头。
    return true
  }

  /** 把一段文本按 maxLen 切分后逐条回发。 */
  private async respondChunk(ctx: HandlerContext, chunk: string): Promise<void> {
    const maxLen = this.opts.maxMessageLength ?? 4500
    const parts = splitText(chunk, maxLen)
    for (const part of parts) await ctx.respond(part)
  }

  async run(ctx: HandlerContext): Promise<void> {
    const sessionKey = `${ctx.scope}:${ctx.scope === 'private' ? ctx.userId : ctx.groupId}`
    const sessionStyle = this.nextQqStyleInjection(sessionKey)
    const payload = formatQqMessageStylePrompt(ctx.payload, this.opts.qqMessageStyle, sessionStyle)
    const ackMessage = this.opts.ackMessage ?? '收到，正在处理...'
    const timeoutMs = this.opts.timeoutMs ?? 120_000
    const timeoutMessage = this.opts.timeoutMessage ?? 'agent 无响应，请稍后重试。'
    let active = true
    try {
      if (ackMessage) await this.respondChunk(ctx, ackMessage)
      if (!this.opts.streamText) {
        // AgentExecutor.run resolve 即本轮完成标志:DSH executor 在内部等待 agent.whenIdle()。
        const result = await withTimeout(this.executor.run(sessionKey, payload), timeoutMs)
        active = false
        await this.respondChunk(ctx, result || '(no output)')
        return
      }

      const streamedText: string[] = []
      // 分段返回:agent 边产出边回发,用户不必等整轮结束。
      // 默认只回发「思考结果」(kind='text');思考过程(reasoning)默认忽略,
      // 避免逐 token 的思考增量在聊天框刷屏。可用 streamReasoning 开启。
      const result = await withTimeout(this.executor.run(sessionKey, payload, (chunk, kind) => {
        if (!active) return
        if (kind === 'reasoning' && !this.opts.streamReasoning) return
        if (kind === 'text') streamedText.push(chunk)
        void this.respondChunk(ctx, chunk)
      }), timeoutMs)
      active = false
      const final = result || '(no output)'
      // 若流式 text 分段已经覆盖最终结果,不再重复发送最终完整版。
      if (streamedText.join('').trim() === final.trim()) return
      // 最终结果(若与已分段内容不同,回发最终完整版作为收尾;超长自动拆分)。
      await this.respondChunk(ctx, final)
    } catch (err) {
      active = false
      const message = err instanceof AgentTimeoutError
        ? timeoutMessage
        : `agent error: ${err instanceof Error ? err.message : String(err)}`
      await this.respondChunk(ctx, message)
    }
  }

  private nextQqStyleInjection(sessionKey: string): QqSessionStyleInjection | undefined {
    if (!this.opts.qqMessageStyle || this.opts.qqMessageStyle.enabled === false) return undefined
    const nextTurn = (this.qqStyleTurnCounts.get(sessionKey) ?? 0) + 1
    this.qqStyleTurnCounts.set(sessionKey, nextTurn)
    return {
      includeFull: nextTurn === 1 || nextTurn % QQ_SESSION_STYLE_REPEAT_INTERVAL === 0,
    }
  }
}

export function formatQqMessageStylePrompt(
  payload: string,
  style?: QqMessageStyleOptions,
  sessionStyle?: QqSessionStyleInjection,
): string {
  const sections: string[] = []
  if (style && style.enabled !== false) {
    const prompt = (style.prompt ?? DEFAULT_QQ_MESSAGE_STYLE_PROMPT).trim()
    if (prompt) sections.push(formatQqSessionStyleInjection(sessionStyle ?? { includeFull: true }, prompt))
  }
  if (sections.length === 0) return payload
  return [
    ...sections,
    '',
    'User QQ Message:',
    payload,
  ].join('\n')
}

function formatQqSessionStyleInjection(
  sessionStyle: QqSessionStyleInjection | undefined,
  prompt: string,
): string {
  if (!sessionStyle?.includeFull) {
    return [
      'QQ Session Temporary Reply Style Reminder:',
      '本次回复使用QQ Session Temporary Reply Style。',
    ].join('\n')
  }
  return [
    'QQ Session Temporary Reply Style:',
    '本次回复使用QQ Session Temporary Reply Style。',
    '以下内容只是本 QQ 会话的临时回复风格约束,不是用户事实、长期偏好或项目知识。',
    '不要把这条风格约束写入任何记忆,也不要把它应用到其它会话。',
    '不得改变系统原本对本次对话内容的记录策略。',
    '',
    '固定回复风格规则:',
    prompt,
  ].join('\n')
}

export class AgentTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`agent timed out after ${timeoutMs}ms`)
    this.name = 'AgentTimeoutError'
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AgentTimeoutError(timeoutMs)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
