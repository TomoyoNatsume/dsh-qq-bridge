/**
 * C 骨架:消息分发器。注册 handler,按前缀 + 匹配路由。
 */
export class MessageRouter {
    gate;
    outbound;
    pendingReply;
    handlers = new Map();
    constructor(gate, outbound, pendingReply) {
        this.gate = gate;
        this.outbound = outbound;
        this.pendingReply = pendingReply;
    }
    register(handler) {
        this.handlers.set(handler.name, handler);
        return () => this.handlers.delete(handler.name);
    }
    /**
     * 处理一条入站消息:
     * 1. 白名单过滤
     * 2. 前缀剥离
     * 3. 按注册顺序匹配 handler。
     * 返回是否被消费(被 router 处理且至少一个 handler 匹配)。
     */
    async route(evt) {
        if (!this.gate.allow(evt))
            return false;
        const scope = evt.message_type === 'private' ? 'private' : 'group';
        const payload = this.gate.stripPrefix(evt.raw_message);
        if (payload === null)
            return false;
        const targetId = scope === 'private' ? evt.user_id : evt.group_id;
        const respond = async (text) => {
            try {
                await this.outbound(scope, targetId, text, evt.reply_target);
            }
            catch (err) {
                console.warn(`[dsh-qq-bridge] failed to send ${scope} message to ${targetId}: ${err instanceof Error ? err.message : String(err)}`);
            }
        };
        const ctx = {
            userId: evt.user_id,
            scope,
            groupId: evt.group_id,
            payload,
            respond,
        };
        if (await this.pendingReply?.handle(ctx))
            return true;
        let consumed = false;
        for (const handler of this.handlers.values()) {
            if (handler.test(payload)) {
                consumed = true;
                await handler.run(ctx);
                if (!handler.continueAfterRun)
                    return true;
            }
        }
        return consumed;
    }
}
