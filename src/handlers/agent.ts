import { Handler, HandlerContext } from '../router.js'

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
    private readonly opts: { streamReasoning?: boolean } = {},
  ) {}

  test(payload: string): boolean {
    // 默认所有有效载荷都交给 Agent(可扩展:保留特定子命令给其它 handler)。
    // 若不希望 Agent 吞掉所有指令,可改成匹配某前缀,例如 payload 以 `ask ` 开头。
    return true
  }

  async run(ctx: HandlerContext): Promise<void> {
    const sessionKey = `${ctx.scope}:${ctx.scope === 'private' ? ctx.userId : ctx.groupId}`
    try {
      // 分段返回:agent 边产出边回发,用户不必等整轮结束。
      // 默认只回发「思考结果」(kind='text');思考过程(reasoning)默认忽略,
      // 避免逐 token 的思考增量在聊天框刷屏。可用 streamReasoning 开启。
      const result = await this.executor.run(sessionKey, ctx.payload, (chunk, kind) => {
        if (kind === 'reasoning' && !this.opts.streamReasoning) return
        void ctx.respond(chunk)
      })
      // 最终结果(若与已分段内容不同,回发最终完整版作为收尾)。
      await ctx.respond(result || '(no output)')
    } catch (err) {
      await ctx.respond(`agent error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
