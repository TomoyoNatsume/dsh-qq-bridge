import { Handler, HandlerContext } from '../router.js'
import { parseQqControlBlocks, QqControlDispatcher } from './control.js'

export const DEFAULT_QQ_REPLY_STYLE_SKILL_NAME = 'qq-session-reply-style'

export interface QqReplyStyleSkillOptions {
  enabled?: boolean
  skillName?: string
}

const QQ_REPLY_STYLE_SKILL_REPEAT_INTERVAL = 30

export interface QqReplyStyleSkillInjection {
  invokeSkill: boolean
  skillName: string
}

export function sessionKeyOf(ctx: Pick<HandlerContext, 'scope' | 'userId' | 'groupId'>): string {
  return `${ctx.scope}:${ctx.scope === 'private' ? ctx.userId : ctx.groupId}`
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
  private readonly qqStyleSkillTurnCounts = new Map<string, number>()

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
      /** 仅 QQ 入站消息使用的回复风格 skill。 */
      qqReplyStyleSkill?: QqReplyStyleSkillOptions
      /** 由桥接层自己处理、不应再进入 Agent 的命令前缀。 */
      reservedCommands?: readonly string[]
      /** Assistant 输出控制块的执行器。存在时会先解析最终文本再回发。 */
      controlDispatcher?: QqControlDispatcher
    } = {},
  ) {}

  test(payload: string): boolean {
    if (this.opts.reservedCommands?.some((command) => payload === command || payload.startsWith(`${command} `))) {
      return false
    }
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
    const sessionKey = sessionKeyOf(ctx)
    const styleSkill = this.nextQqStyleSkillInjection(sessionKey)
    const payload = formatQqReplyStyleSkillPrompt(ctx.payload, styleSkill)
    const ackMessage = this.opts.ackMessage ?? '收到，正在处理...'
    const timeoutMs = this.opts.timeoutMs ?? 120_000
    const timeoutMessage = this.opts.timeoutMessage ?? 'agent 无响应，请稍后重试。'
    let active = true
    try {
      if (ackMessage) await this.respondChunk(ctx, ackMessage)
      const canStreamText = this.opts.streamText && !this.opts.controlDispatcher
      if (!canStreamText) {
        // AgentExecutor.run resolve 即本轮完成标志:DSH executor 在内部等待 agent.whenIdle()。
        const result = await withTimeout(this.executor.run(sessionKey, payload), timeoutMs)
        active = false
        await this.respondAgentOutput(ctx, sessionKey, result || '(no output)')
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
      await this.respondAgentOutput(ctx, sessionKey, final)
    } catch (err) {
      active = false
      const message = err instanceof AgentTimeoutError
        ? timeoutMessage
        : `agent error: ${err instanceof Error ? err.message : String(err)}`
      await this.respondChunk(ctx, message)
    }
  }

  private nextQqStyleSkillInjection(sessionKey: string): QqReplyStyleSkillInjection | undefined {
    if (!this.opts.qqReplyStyleSkill || this.opts.qqReplyStyleSkill.enabled === false) return undefined
    const nextTurn = (this.qqStyleSkillTurnCounts.get(sessionKey) ?? 0) + 1
    this.qqStyleSkillTurnCounts.set(sessionKey, nextTurn)
    const repeat = nextTurn === 1 || nextTurn % QQ_REPLY_STYLE_SKILL_REPEAT_INTERVAL === 0
    return {
      invokeSkill: repeat,
      skillName: this.opts.qqReplyStyleSkill.skillName ?? DEFAULT_QQ_REPLY_STYLE_SKILL_NAME,
    }
  }

  private async respondAgentOutput(ctx: HandlerContext, sessionKey: string, result: string): Promise<void> {
    const dispatcher = this.opts.controlDispatcher
    if (!dispatcher) {
      await this.respondChunk(ctx, result)
      return
    }

    const parsed = parseQqControlBlocks(result)
    let responded = false
    for (const error of parsed.errors) {
      responded = true
      await this.respondChunk(ctx, error)
    }
    for (const action of parsed.actions) {
      const message = await dispatcher.dispatch(action, { sessionKey, source: ctx })
      if (!message) continue
      responded = true
      await this.respondChunk(ctx, message)
    }
    if (parsed.visibleText) {
      responded = true
      await this.respondChunk(ctx, parsed.visibleText)
    }
    if (!responded) await this.respondChunk(ctx, '(no output)')
  }
}

export function formatQqReplyStyleSkillPrompt(
  payload: string,
  injection?: QqReplyStyleSkillInjection,
): string {
  if (!injection) return payload
  const sections = [
    '本条用户消息来自 dsh-qq-bridge QQ 会话。',
    '本次回复使用 QQ Session Temporary Reply Style；这是本次 QQ 会话的临时约束，不要把这条风格约束写入记忆，也不要应用到其它 DSH 会话。',
  ]
  if (injection.invokeSkill) {
    sections.unshift(`/${injection.skillName}`)
  }
  return [
    ...sections,
    '',
    'User QQ Message:',
    payload,
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
