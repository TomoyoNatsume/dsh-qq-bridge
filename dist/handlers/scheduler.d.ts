import { AgentExecutor } from './agent.js';
import { QqControlActionHandler } from './control.js';
import { HandlerContext } from '../router.js';
import type { MessageTargetId } from '../onebot/types.js';
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
    send(target: ScheduledTaskTarget, text: string): Promise<void>;
    now?: () => number;
    maxMessageLength?: number;
}
export declare class InMemoryTaskScheduler implements ScheduledTaskController {
    private readonly opts;
    private readonly tasks;
    constructor(opts: InMemoryTaskSchedulerOptions);
    scheduleTask(input: {
        sessionKey: string;
        source: HandlerContext;
        runAt: string;
        message: string;
    }): Promise<ScheduledTaskReceipt>;
    dispose(): void;
    get size(): number;
    private arm;
    private fire;
    private sendAgentResult;
    private sendChunks;
    private now;
}
export declare function createScheduleTaskControlHandler(controller: ScheduledTaskController): QqControlActionHandler;
