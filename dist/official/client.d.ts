import { type QQBotInboundMessage, type ReplyTarget } from '@tencent-connect/qqbot-nodejs';
import type { OnebotMessageEvent, MessageTargetId, PlatformReplyTarget } from '../onebot/types.js';
export interface TencentOfficialBotOptions {
    appId: string;
    appSecret: string;
    sandbox?: boolean;
}
interface OfficialBotLike {
    on(event: 'ready', handler: (data: unknown) => void): this;
    on(event: 'resumed', handler: (data: unknown) => void): this;
    on(event: 'error', handler: (err: Error) => void): this;
    on(event: 'message', handler: (ctx: unknown, msg: QQBotInboundMessage) => void | Promise<void>): this;
    start(signal?: AbortSignal): Promise<void>;
    stop(): void;
    sendText(target: ReplyTarget, content: string): Promise<unknown>;
    sendWakeup?(target: ReplyTarget, content: string): Promise<unknown>;
}
/** 腾讯官方 QQ 机器人 SDK 适配器:把官方事件转成桥接层内部消息事件。 */
export declare class TencentOfficialBotClient {
    private readonly bot;
    private readonly listeners;
    private abort?;
    private started?;
    constructor(options: TencentOfficialBotOptions, bot?: OfficialBotLike);
    connect(): Promise<void>;
    onMessage(cb: (evt: OnebotMessageEvent) => void): () => void;
    sendPrivate(userId: MessageTargetId, message: string, replyTarget?: PlatformReplyTarget): Promise<void>;
    sendGroup(groupId: MessageTargetId, message: string, replyTarget?: PlatformReplyTarget): Promise<void>;
    disconnect(): Promise<void>;
    private handleMessage;
}
export declare function toBridgeMessageEvent(msg: QQBotInboundMessage): OnebotMessageEvent | null;
export {};
