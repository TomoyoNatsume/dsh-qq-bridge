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
   */
  run(sessionKey: string, payload: string): Promise<string>
}

/**
 * A 内置 handler:QQ 消息 → 遥控 DSH Agent → 回发。
 */
export class AgentRpcHandler implements Handler {
  name = 'agent'

  constructor(private readonly executor: AgentExecutor) {}

  test(payload: string): boolean {
    // 默认所有有效载荷都交给 Agent(可扩展:保留特定子命令给其它 handler)。
    // 若不希望 Agent 吞掉所有指令,可改成匹配某前缀,例如 payload 以 `ask ` 开头。
    return true
  }

  async run(ctx: HandlerContext): Promise<void> {
    const sessionKey = `${ctx.scope}:${ctx.scope === 'private' ? ctx.userId : ctx.groupId}`
    try {
      const result = await this.executor.run(sessionKey, ctx.payload)
      await ctx.respond(result || '(no output)')
    } catch (err) {
      await ctx.respond(`agent error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
