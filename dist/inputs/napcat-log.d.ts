import { OnebotMessageEvent } from '../onebot/types.js';
export interface NapcatSelfLogInputOptions {
    logPath: string;
    selfQq: number;
    commandPrefix: string;
    pollIntervalMs?: number;
    replayOnStart?: boolean;
}
export type NapcatSelfLogHandler = (evt: OnebotMessageEvent) => void;
/**
 * Experimental input source for the "single QQ account + My Computer" flow.
 *
 * NapCat may log self-sent messages such as:
 *   08-16 11:07:50 [info] Tomoyo | 发送 -> 私聊 (10001) /dsh hello
 *   08-16 11:10:40 [info] Tomoyo | 发送 -> 移动设备 /dsh hello
 *
 * In some setups these messages are not pushed as OneBot message events even
 * when reportSelfMessage=true. This tailer turns matching log lines into the
 * same internal private-message shape consumed by MessageRouter.
 */
export declare class NapcatSelfLogInput {
    private readonly opts;
    private timer;
    private offset;
    private rest;
    private seq;
    constructor(opts: NapcatSelfLogInputOptions);
    start(onMessage: NapcatSelfLogHandler): Promise<void>;
    stop(): void;
    private poll;
}
export declare function parseNapcatSelfLogLine(line: string, opts: {
    selfQq: number;
    commandPrefix: string;
}): {
    userId: number;
    rawMessage: string;
} | null;
