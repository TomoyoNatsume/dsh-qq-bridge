import { Handler, HandlerContext } from '../router.js';
import { QqControlDispatcher } from './control.js';
export declare const DEFAULT_QQ_REPLY_STYLE_SKILL_NAME = "qq-session-reply-style";
export interface QqReplyStyleSkillOptions {
    enabled?: boolean;
    skillName?: string;
}
export interface QqReplyStyleSkillInjection {
    invokeSkill: boolean;
    skillName: string;
}
export declare function sessionKeyOf(ctx: Pick<HandlerContext, 'scope' | 'userId' | 'groupId'>): string;
/**
 * 把文本按最大长度切分为多条,保证每条不超过 maxLen。
 * 优先在换行/标点附近切(保持可读),实在没有边界则硬切。
 */
export declare function splitText(text: string, maxLen: number): string[];
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
    run(sessionKey: string, payload: string, onChunk?: (text: string, kind: 'text' | 'reasoning') => void): Promise<string>;
}
/**
 * A 内置 handler:QQ 消息 → 遥控 DSH Agent → 回发。
 */
export declare class AgentRpcHandler implements Handler {
    private readonly executor;
    private readonly opts;
    name: string;
    private readonly qqStyleSkillTurnCounts;
    constructor(executor: AgentExecutor, opts?: {
        streamReasoning?: boolean;
        /** 是否边生成边回发 text 分段;默认 false,等待 agent 本轮完成后只发送最终回复。 */
        streamText?: boolean;
        /** 单条 QQ 消息最大长度;超长自动拆分为多条发送。 */
        maxMessageLength?: number;
        /** 收到有效指令后立即回发的确认消息;设为空字符串可关闭。 */
        ackMessage?: string;
        /** Agent 超时时间(ms);默认 120s。 */
        timeoutMs?: number;
        /** Agent 长时间无响应时回发的消息。 */
        timeoutMessage?: string;
        /** 仅 QQ 入站消息使用的回复风格 skill。 */
        qqReplyStyleSkill?: QqReplyStyleSkillOptions;
        /** 由桥接层自己处理、不应再进入 Agent 的命令前缀。 */
        reservedCommands?: readonly string[];
        /** Assistant 输出控制块的执行器。存在时会先解析最终文本再回发。 */
        controlDispatcher?: QqControlDispatcher;
    });
    test(payload: string): boolean;
    /** 把一段文本按 maxLen 切分后逐条回发。 */
    private respondChunk;
    run(ctx: HandlerContext): Promise<void>;
    private nextQqStyleSkillInjection;
    private respondAgentOutput;
}
export declare function formatQqReplyStyleSkillPrompt(payload: string, injection?: QqReplyStyleSkillInjection): string;
export declare class AgentTimeoutError extends Error {
    constructor(timeoutMs: number);
}
