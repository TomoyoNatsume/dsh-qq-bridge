interface DshSessionSubjectLike {
    id?: unknown;
    header?: {
        origin?: unknown;
    };
}
interface DshSessionEventSource {
    on?(event: 'session/event', cb: (subject: DshSessionSubjectLike, event: unknown) => void): () => void;
}
export interface AgentRunGate {
    isBusy(): boolean;
    enqueueWhenIdle<T>(task: () => Promise<T>): Promise<T>;
}
export declare class DshWebActivityGate implements AgentRunGate {
    private readonly activeTurns;
    private readonly waiters;
    private tail;
    static register(ctx: DshSessionEventSource): {
        gate: DshWebActivityGate;
        dispose(): void;
    };
    observe(subject: DshSessionSubjectLike, event: unknown): void;
    isBusy(): boolean;
    enqueueWhenIdle<T>(task: () => Promise<T>): Promise<T>;
    private waitForIdle;
    private flushIfIdle;
}
export declare function trackedWebSessionId(subject: DshSessionSubjectLike): string | undefined;
export {};
