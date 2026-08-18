/**
 * 把文本按最大长度切分为多条,保证每条不超过 maxLen。
 * 优先在换行/标点附近切(保持可读),实在没有边界则硬切。
 */
export function splitText(text, maxLen) {
    if (maxLen <= 0 || text.length <= maxLen)
        return text === '' ? [] : [text];
    const parts = [];
    let rest = text;
    while (rest.length > maxLen) {
        // 在 maxLen-1 往前找最近的换行或标点作为切点(留一位容纳标点)
        const searchTo = maxLen - 1;
        let cut = rest.lastIndexOf('\n', searchTo);
        if (cut <= 0)
            cut = Math.max(rest.lastIndexOf('。', searchTo), rest.lastIndexOf('！', searchTo), rest.lastIndexOf('？', searchTo), rest.lastIndexOf('.', searchTo), rest.lastIndexOf('，', searchTo), rest.lastIndexOf(',', searchTo));
        if (cut <= 0)
            cut = searchTo; // 无边界,硬切(maxLen-1,保证 <= maxLen)
        parts.push(rest.slice(0, cut + 1).trimStart());
        rest = rest.slice(cut + 1);
    }
    if (rest.trim())
        parts.push(rest.trimStart());
    return parts.filter((p) => p.length > 0);
}
/**
 * A 内置 handler:QQ 消息 → 遥控 DSH Agent → 回发。
 */
export class AgentRpcHandler {
    executor;
    opts;
    name = 'agent';
    constructor(executor, opts = {}) {
        this.executor = executor;
        this.opts = opts;
    }
    test(payload) {
        // 默认所有有效载荷都交给 Agent(可扩展:保留特定子命令给其它 handler)。
        // 若不希望 Agent 吞掉所有指令,可改成匹配某前缀,例如 payload 以 `ask ` 开头。
        return true;
    }
    /** 把一段文本按 maxLen 切分后逐条回发。 */
    async respondChunk(ctx, chunk) {
        const maxLen = this.opts.maxMessageLength ?? 4500;
        const parts = splitText(chunk, maxLen);
        for (const part of parts)
            await ctx.respond(part);
    }
    async run(ctx) {
        const sessionKey = `${ctx.scope}:${ctx.scope === 'private' ? ctx.userId : ctx.groupId}`;
        const ackMessage = this.opts.ackMessage ?? '收到，正在处理...';
        const timeoutMs = this.opts.timeoutMs ?? 120_000;
        const timeoutMessage = this.opts.timeoutMessage ?? 'agent 无响应，请稍后重试。';
        let active = true;
        try {
            if (ackMessage)
                await this.respondChunk(ctx, ackMessage);
            if (!this.opts.streamText) {
                // AgentExecutor.run resolve 即本轮完成标志:DSH executor 在内部等待 agent.whenIdle()。
                const result = await withTimeout(this.executor.run(sessionKey, ctx.payload), timeoutMs);
                active = false;
                await this.respondChunk(ctx, result || '(no output)');
                return;
            }
            const streamedText = [];
            // 分段返回:agent 边产出边回发,用户不必等整轮结束。
            // 默认只回发「思考结果」(kind='text');思考过程(reasoning)默认忽略,
            // 避免逐 token 的思考增量在聊天框刷屏。可用 streamReasoning 开启。
            const result = await withTimeout(this.executor.run(sessionKey, ctx.payload, (chunk, kind) => {
                if (!active)
                    return;
                if (kind === 'reasoning' && !this.opts.streamReasoning)
                    return;
                if (kind === 'text')
                    streamedText.push(chunk);
                void this.respondChunk(ctx, chunk);
            }), timeoutMs);
            active = false;
            const final = result || '(no output)';
            // 若流式 text 分段已经覆盖最终结果,不再重复发送最终完整版。
            if (streamedText.join('').trim() === final.trim())
                return;
            // 最终结果(若与已分段内容不同,回发最终完整版作为收尾;超长自动拆分)。
            await this.respondChunk(ctx, final);
        }
        catch (err) {
            active = false;
            const message = err instanceof AgentTimeoutError
                ? timeoutMessage
                : `agent error: ${err instanceof Error ? err.message : String(err)}`;
            await this.respondChunk(ctx, message);
        }
    }
}
export class AgentTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`agent timed out after ${timeoutMs}ms`);
        this.name = 'AgentTimeoutError';
    }
}
function withTimeout(promise, timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        return promise;
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new AgentTimeoutError(timeoutMs)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer)
            clearTimeout(timer);
    });
}
