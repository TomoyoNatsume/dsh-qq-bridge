import type { MessageTargetId } from './types.js';
export declare const NAPCAT_SELF_KEEPALIVE_MESSAGE = "[dsh-qq-bridge] keepalive";
export interface NapcatSelfKeepAliveOptions {
    enabled: boolean;
    intervalMs: number;
    message: string;
    targetId: MessageTargetId;
    sendPrivate(targetId: MessageTargetId, message: string, uid: string): Promise<unknown>;
    createUid?: () => string;
}
/** 定期让 NapCat 登录号给自己发消息，降低长期无活动账号被服务端回收的概率。 */
export declare function startNapcatSelfKeepAlive(options: NapcatSelfKeepAliveOptions): () => void;
export declare function isNapcatSelfKeepAliveMessage(message: string, configuredMessage?: string): boolean;
