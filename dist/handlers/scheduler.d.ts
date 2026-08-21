import { AgentExecutor } from './agent.js';
import { QqControlActionHandler } from './control.js';
import { HandlerContext } from '../router.js';
import type { MessageTargetId } from '../onebot/types.js';
import { CustomMemoryStore } from './custom-memory.js';
export interface ScheduledTaskTarget {
    scope: 'private' | 'group';
    targetId: MessageTargetId;
}
export interface ScheduledTask {
    id: string;
    sessionKey: string;
    target: ScheduledTaskTarget;
    runAt: Date;
    runAtText: string;
    message: string;
}
export interface ScheduledTaskReceipt {
    id: string;
    runAtText: string;
}
export interface ScheduledTaskController {
    scheduleTask(input: {
        sessionKey: string;
        source: HandlerContext;
        runAt: string;
        message: string;
    }): Promise<ScheduledTaskReceipt>;
}
export interface InMemoryTaskSchedulerOptions {
    executor: AgentExecutor;
    store?: CustomMemoryStore;
    send(target: ScheduledTaskTarget, text: string): Promise<void>;
    now?: () => number;
    maxMessageLength?: number;
    scanWindowMs?: number;
    scanIntervalMs?: number;
}
export declare class InMemoryTaskScheduler implements ScheduledTaskController {
    private readonly opts;
    private readonly tasks;
    private scanTimer?;
    constructor(opts: InMemoryTaskSchedulerOptions);
    scheduleTask(input: {
        sessionKey: string;
        source: HandlerContext;
        runAt: string;
        message: string;
    }): Promise<ScheduledTaskReceipt>;
    startScanning(): void;
    scanDueTasks(): Promise<void>;
    dispose(): void;
    get size(): number;
    private armIfWithinWindow;
    private arm;
    private fire;
    private sendAgentResult;
    private sendChunks;
    private now;
    private scanWindowMs;
    private store;
    private markTask;
}
export declare function createScheduleTaskControlHandler(controller: ScheduledTaskController): QqControlActionHandler;
