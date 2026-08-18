import { DshQqBridgeConfig } from './config.js';
/** DSH live agent 最小画面。 */
interface DshAgent {
    followup(message: {
        id: string;
        role: string;
        content: unknown;
        source: unknown;
    }): void;
    whenIdle(): Promise<void>;
}
/** 结构性描述 DSH 服务;不硬依赖 DSH 内部类型。 */
interface DshCtx {
    agentLoop?: {
        createAgent(ownerCtx: unknown, options: {
            sessionId: string;
            agentOptions?: Record<string, unknown>;
            meta?: {
                cwd?: string;
                agentPreset?: string;
            };
            setup?: (agentCtx: unknown) => void | Promise<void>;
        }): Promise<{
            agent: DshAgent;
            dispose(): Promise<void>;
        }>;
    };
    agentPresets?: {
        mount(agentCtx: unknown, preset?: string): Promise<void>;
    };
    sessionQuery?: {
        readSurface(sessionId: string): Promise<{
            events: readonly unknown[];
        }>;
    };
    /** cordis 事件订阅(session/event 广播)。 */
    on?(event: string, cb: (subject: {
        id?: string;
    }, event: unknown) => void): () => void;
}
/**
 * Cordis 插件入口(Host 侧)。
 * M3:每个 QQ 会话持有常驻 DSH live agent,实现多轮上下文。
 * 依赖:agentLoop / agentPresets / sessionQuery。
 */
export declare const name = "dsh-qq-bridge";
export declare const inject: string[];
export declare function apply(ctx: DshCtx, options: DshQqBridgeConfig): Promise<() => Promise<void>>;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
/** 构建连接失败时的引导文案,指向「给 Agent 的 NapCat 安装向导」。 */
export declare function buildConnectGuidance(cfg: DshQqBridgeConfig, err: unknown): string;
