import { MessageTargetId, OnebotMessageEvent, PlatformReplyTarget } from './onebot/types.js'
import { AccessGate } from './security.js'

/**
 * handler 上下文:暴露来源信息与便捷回发能力。
 */
export interface HandlerContext {
  userId: MessageTargetId
  scope: 'private' | 'group'
  groupId?: MessageTargetId
  /** 已经剥离指令前缀后的有效载荷 */
  payload: string
  /** 回发到来源会话 */
  respond(text: string): Promise<void>
}

export interface Handler {
  name: string
  /** 是否愿意处理这条 message(如按 payload 命令名匹配) */
  test(payload: string): boolean
  run(ctx: HandlerContext): Promise<void>
}

export interface PendingReplyHandler {
  handle(ctx: HandlerContext): Promise<boolean>
}

export type OutboundSender = (
  scope: 'private' | 'group',
  targetId: MessageTargetId,
  text: string,
  replyTarget?: PlatformReplyTarget,
) => Promise<void>

/**
 * C 骨架:消息分发器。注册 handler,按前缀 + 匹配路由。
 */
export class MessageRouter {
  private handlers = new Map<string, Handler>()

  constructor(
    private readonly gate: AccessGate,
    private readonly outbound: OutboundSender,
    private readonly pendingReply?: PendingReplyHandler,
  ) {}

  register(handler: Handler): () => void {
    this.handlers.set(handler.name, handler)
    return () => this.handlers.delete(handler.name)
  }

  /**
   * 处理一条入站消息:
   * 1. 白名单过滤
   * 2. 前缀剥离
   * 3. 匹配 handler 并执行
   * 返回是否被消费(被 router 处理且至少一个 handler 匹配)。
   */
  async route(evt: OnebotMessageEvent): Promise<boolean> {
    if (!this.gate.allow(evt)) return false

    const scope: 'private' | 'group' = evt.message_type === 'private' ? 'private' : 'group'
    const payload = this.gate.stripPrefix(evt.raw_message)
    if (payload === null) return false

    const targetId = scope === 'private' ? evt.user_id : evt.group_id!
    const respond = async (text: string): Promise<void> => {
      try {
        await this.outbound(scope, targetId, text, evt.reply_target)
      } catch (err) {
        console.warn(
          `[dsh-qq-bridge] failed to send ${scope} message to ${targetId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }

    const ctx: HandlerContext = {
      userId: evt.user_id,
      scope,
      groupId: evt.group_id,
      payload,
      respond,
    }

    if (await this.pendingReply?.handle(ctx)) return true

    let consumed = false
    for (const handler of this.handlers.values()) {
      if (handler.test(payload)) {
        consumed = true
        await handler.run(ctx)
      }
    }
    return consumed
  }
}
