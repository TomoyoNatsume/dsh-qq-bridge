import { MessageTargetId, OnebotActionResponse, OnebotMessageEvent, PlatformReplyTarget } from './types.js';
/**
 * 极简 WS 传输抽象,便于在测试中注入 mock(本地回环仿真),无需真实连接 NapCat。
 */
export interface Transport {
    readonly connected: boolean;
    /** 建立后端连接 */
    connect(): Promise<void>;
    /** 发一个 JSON 帧 */
    send(frame: Record<string, unknown>): Promise<void>;
    /** 订阅收到的 JSON 帧 */
    onFrame(cb: (frame: Record<string, unknown>) => void): () => void;
    dispose(): Promise<void>;
}
/**
 * 基于 `ws` 库的默认传输实现(连接 NapCat 的 onebot 正向 WS)。
 * 内置断线自动重连:`connect()` 在首次连上时 resolve;首次失败则 reject(供上层打引导),
 * 此后后台仍按退避自动重连。已在运行的连接意外断开也会自动重连,无需上层干预。
 */
export declare class WsTransport implements Transport {
    private readonly url;
    private ws;
    private listeners;
    private disposed;
    private retryTimer;
    private attempts;
    /** 首个连接尝试是否已经给出最终结论(open resolve / error reject)。 */
    private initialSettled;
    private settleInitial;
    private readonly authToken;
    constructor(url: string, token?: string);
    get connected(): boolean;
    connect(): Promise<void>;
    private openSocket;
    private resolveInitial;
    private handleError;
    private handleClose;
    private scheduleRetry;
    send(frame: Record<string, unknown>): Promise<void>;
    onFrame(cb: (frame: Record<string, unknown>) => void): () => void;
    dispose(): Promise<void>;
}
/**
 * OneBot 客户端:负责收发消息事件、发送动作。
 * 运输层可注入,便于本地回环测试。
 */
export declare class OnebotClient {
    private readonly transport;
    /** 动作回调路径;默认按协议拼 JSON。可用 in-memory 替换以测试回发。 */
    private readonly sendAction?;
    private unsub;
    constructor(transport: Transport, 
    /** 动作回调路径;默认按协议拼 JSON。可用 in-memory 替换以测试回发。 */
    sendAction?: ((frame: Record<string, unknown>) => Promise<void>) | undefined);
    connect(): Promise<void>;
    onMessage(cb: (evt: OnebotMessageEvent) => void): () => void;
    private handleFrame;
    sendPrivate(userId: MessageTargetId, message: string, _replyTarget?: PlatformReplyTarget): Promise<OnebotActionResponse>;
    sendGroup(groupId: MessageTargetId, message: string, _replyTarget?: PlatformReplyTarget): Promise<OnebotActionResponse>;
    private flush;
    disconnect(): Promise<void>;
}
