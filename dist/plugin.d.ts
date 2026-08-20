import { DshQqBridgeConfig } from './config.js';
import { OnebotMessageEvent, PlatformReplyTarget } from './onebot/types.js';
import type { MessageTargetId } from './onebot/types.js';
import { InteractionCtxLike } from './interactions.js';
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
interface DshCtx extends InteractionCtxLike {
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
    on?(event: 'session/event', cb: (subject: DshSessionSubject, event: unknown) => void, options?: {
        prepend?: boolean;
    }): () => void;
    on?(event: 'approval/request', cb: (...args: never[]) => unknown, options?: {
        prepend?: boolean;
    }): () => void;
    on?(event: string, cb: (...args: never[]) => unknown, options?: {
        prepend?: boolean;
    }): () => void;
}
interface DshSessionSubject {
    id?: string;
    header?: {
        origin?: string;
    };
    events?: readonly unknown[];
}
interface BridgeChatClient {
    connect(): Promise<void>;
    onMessage(cb: (evt: OnebotMessageEvent) => void): () => void;
    sendPrivate(userId: MessageTargetId, message: string, replyTarget?: PlatformReplyTarget): Promise<unknown>;
    sendGroup(groupId: MessageTargetId, message: string, replyTarget?: PlatformReplyTarget): Promise<unknown>;
    disconnect(): Promise<void>;
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
/** 判断是否启用 agent 完成后的管理员主动提醒。 */
export declare function agentReplyNotificationsEnabled(cfg: DshQqBridgeConfig): boolean;
export declare function createAgentReplyNotifier(ctx: Pick<DshCtx, 'on'>, client: Pick<BridgeChatClient, 'sendPrivate'>, adminTarget: MessageTargetId): () => void;
/** 监听 DSH 会话完成事件,向管理员 QQ 发送一条轻量提醒。 */
export declare function registerAgentReplyNotifier(ctx: Pick<DshCtx, 'on'>, client: Pick<BridgeChatClient, 'sendPrivate'>, adminTarget: MessageTargetId): () => void;
export declare function findSessionTitle(events: readonly unknown[]): string;
/** 构建官方机器人连接失败时的引导文案。 */
export declare function buildOfficialConnectGuidance(cfg: DshQqBridgeConfig, err: unknown): string;
/** 构建连接失败时的引导文案,指向「给 Agent 的 NapCat 安装向导」。 */
export declare function buildConnectGuidance(cfg: DshQqBridgeConfig, err: unknown): string;
