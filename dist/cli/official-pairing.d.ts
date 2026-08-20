import { type QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs';
export interface OfficialPairingOptions {
    appId: string;
    appSecret: string;
    sandbox: boolean;
    pairCommand: string;
    successMessage?: string;
    timeoutMs?: number;
    onReady?: () => void;
}
interface OfficialPairingBotLike {
    on(event: 'ready', handler: (data: unknown) => void): this;
    on(event: 'resumed', handler: (data: unknown) => void): this;
    on(event: 'error', handler: (err: Error) => void): this;
    on(event: 'message', handler: (ctx: unknown, msg: QQBotInboundMessage) => void | Promise<void>): this;
    start(signal?: AbortSignal): Promise<void>;
    stop(): void;
    sendText(target: QQBotInboundMessage['replyTarget'], content: string): Promise<unknown>;
}
export declare function createOfficialPairCode(): string;
export declare function pairOfficialAdmin(options: OfficialPairingOptions, bot?: OfficialPairingBotLike): Promise<string>;
export {};
