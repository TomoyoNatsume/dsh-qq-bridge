import { Handler, HandlerContext } from '../router.js'

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

  constructor(
    private readonly executor: AgentExecutor,
    private readonly opts: {
      streamReasoning?: boolean
      /** 是否边生成边回发 text 分段;默认 false,等待 agent 本轮完成后只发送最终回复。 */
      streamText?: boolean
      /** 单条 QQ 消息最大长度;超长自动拆分为多条发送。 */
      maxMessageLength?: number
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
    try {
      if (!this.opts.streamText) {
        // AgentExecutor.run resolve 即本轮完成标志:DSH executor 在内部等待 agent.whenIdle()。
        const result = await this.executor.run(sessionKey, ctx.payload)
        await this.respondChunk(ctx, result || '(no output)')
        return
      }

      const streamedText: string[] = []
      // 分段返回:agent 边产出边回发,用户不必等整轮结束。
      // 默认只回发「思考结果」(kind='text');思考过程(reasoning)默认忽略,
      // 避免逐 token 的思考增量在聊天框刷屏。可用 streamReasoning 开启。
      const result = await this.executor.run(sessionKey, ctx.payload, (chunk, kind) => {
        if (kind === 'reasoning' && !this.opts.streamReasoning) return
        if (kind === 'text') streamedText.push(chunk)
        void this.respondChunk(ctx, chunk)
      })
      const final = result || '(no output)'
      // 若流式 text 分段已经覆盖最终结果,不再重复发送最终完整版。
      if (streamedText.join('').trim() === final.trim()) return
      // 最终结果(若与已分段内容不同,回发最终完整版作为收尾;超长自动拆分)。
      await this.respondChunk(ctx, final)
    } catch (err) {
      await this.respondChunk(ctx, `agent error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
