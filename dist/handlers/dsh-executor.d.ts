import { AgentExecutor } from './agent.js';
/**
 * 提取 session surface 中最后一条 assistant 消息的纯文本。
 *
 * 兼容两种事件形状:
 * - **DSH 真实形状**: `{ type, seq, data: { message: { content: [...] } }, ... }`
 *   (assistant 消息体挂在 `data.message.content`)。
 * - 简易形状(用于本地测试): `{ type: 'assistant/message', content: [...] }`。
 */
export declare function extractLastAssistantText(events: readonly unknown[]): string | null;
/**
 * DSH 工具调用没有被运行时识别时,模型可能把 DSML 协议文本当普通 text 输出。
 * 这类内容不是有效回复,也不应透传给 QQ 用户。
 */
export declare function isUnexecutedDsmlToolCall(text: string): boolean;
/** 一个可投料、等待、可释放销毁的 DSH agent 会话。 */
export interface DshRenderedAgent {
    followup(message: {
        id: string;
        role: string;
        content: unknown;
        source: unknown;
    }): void;
    whenIdle(): Promise<void>;
    /**
     * 读取该 live agent 会话的**实时**事件(即会话已提交的日志)。
     * 若实现提供,executor 优先用它提取回复,避免走持久化 corpus 的滞后;
     * 未提供则回退到 `DshServiceHandles.readSurface(sessionId)`。
     */
    readSurface?(): Promise<readonly unknown[]>;
    /** 销毁该会话底层的 DSH agent(释放资源)。 */
    dispose(): Promise<void>;
}
/**
 * DSH 服务句柄 —— 由插件注入,mock 可注入。
 * getOrCreate 必须返回带 dispose 的 live agent,便于 executor 统一释放。
 */
export interface DshServiceHandles {
    /** 按 sessionKey 获取(已有)或创建(miss)一个 live agent。 */
    getOrCreate(options: {
        sessionKey: string;
        sessionId: string;
        cwd?: string;
    }): Promise<DshRenderedAgent>;
    /**
     * 投递用户消息并等待本轮完成。
     * @param onChunk 可选分段回调:agent 产出过程中的文本增量,便于流式回发。
     */
    deliver(agent: DshRenderedAgent, prompt: string, onChunk?: (text: string, kind: 'text' | 'reasoning') => void): Promise<void>;
    /** 读取会话 surface(events)以提取本轮回复。 */
    readSurface(sessionId: string): Promise<readonly unknown[]>;
}
/**
 * A 内置 handler 的 DSH 实现 —— 多轮上下文版本。
 *
 * - 每个 QQ sessionKey 持有一个常驻 live agent:首次创建、之后复用 → 保留多轮上下文。
 * - 同一 sessionKey 的并发消息串行排队,避免并发驱动同一会话。
 * - disposeAll() 在插件 teardown 时释放全部 live agent。
 * - disposeSession() 可主动丢弃某个会话(如错误恢复、会话上限)。
 */
export declare class DshAgentExecutor implements AgentExecutor {
    private readonly dsh;
    private readonly opts;
    private agents;
    private sessions;
    private sessionCwds;
    private sessionVersions;
    private queues;
    /**
     * 本 executor 实例(即一次插件挂载/一次 host boot)唯一的后缀。
     * 避免跨 host 重启复用固定 sessionId 时,与磁盘上残留的旧会话发生 id collision。
     * 同一 boot 内多轮上下文仍通过 sessionKey→sessionId 映射保持。
     */
    private readonly bootSuffix;
    constructor(dsh: DshServiceHandles, opts?: {
        defaultCwd?: string;
    });
    run(sessionKey: string, payload: string, onChunk?: (text: string, kind: 'text' | 'reasoning') => void): Promise<string>;
    private runNow;
    /** 优先读 live agent 的实时会话日志,缺省则退回持久化 surface。 */
    private readEvents;
    /** 主动丢弃某个会话的 live agent。 */
    disposeSession(sessionKey: string): Promise<void>;
    /** 切换某个 QQ 来源的工作目录;下一轮会创建新的 DSH session。 */
    setCwd(sessionKey: string, cwd: string): Promise<void>;
    /** 当前 QQ 来源的工作目录;未切换时返回配置默认目录或 host cwd。 */
    getCwd(sessionKey: string): string;
    /** 释放全部 live agent(插件 teardown 时调用)。 */
    disposeAll(): Promise<void>;
    get liveSessionCount(): number;
    private createSessionId;
}
/** 确定性哈希,把任意 sessionKey 映射到固定长度可用的 session id。 */
export declare function hashKey(input: string): string;
