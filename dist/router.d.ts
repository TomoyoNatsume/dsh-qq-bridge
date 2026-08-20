import { MessageTargetId, OnebotMessageEvent, PlatformReplyTarget } from './onebot/types.js';
import { AccessGate } from './security.js';
/**
 * handler 上下文:暴露来源信息与便捷回发能力。
 */
export interface HandlerContext {
    userId: MessageTargetId;
    scope: 'private' | 'group';
    groupId?: MessageTargetId;
    /** 已经剥离指令前缀后的有效载荷 */
    payload: string;
    /** 回发到来源会话 */
    respond(text: string): Promise<void>;
}
export interface Handler {
    name: string;
    /** 是否愿意处理这条 message(如按 payload 命令名匹配) */
    test(payload: string): boolean;
    /** 命中后是否继续尝试后续 handler。默认 false,命令 handler 会独占消费。 */
    continueAfterRun?: boolean;
    run(ctx: HandlerContext): Promise<void>;
}
export interface PendingReplyHandler {
    handle(ctx: HandlerContext): Promise<boolean>;
}
export type OutboundSender = (scope: 'private' | 'group', targetId: MessageTargetId, text: string, replyTarget?: PlatformReplyTarget) => Promise<void>;
/**
 * C 骨架:消息分发器。注册 handler,按前缀 + 匹配路由。
 */
export declare class MessageRouter {
    private readonly gate;
    private readonly outbound;
    private readonly pendingReply?;
    private handlers;
    constructor(gate: AccessGate, outbound: OutboundSender, pendingReply?: PendingReplyHandler | undefined);
    register(handler: Handler): () => void;
    /**
     * 处理一条入站消息:
     * 1. 白名单过滤
     * 2. 前缀剥离
     * 3. 按注册顺序匹配 handler。
     * 返回是否被消费(被 router 处理且至少一个 handler 匹配)。
     */
    route(evt: OnebotMessageEvent): Promise<boolean>;
}
