export declare class SetupCancelledError extends Error {
    constructor();
}
export declare class Prompter {
    private rl;
    private readonly abortController;
    private readonly sigintHandler;
    constructor();
    text(label: string, fallback?: string): Promise<string>;
    confirm(label: string, fallback?: boolean): Promise<boolean>;
    choice(label: string, choices: readonly string[], fallback: string): Promise<string>;
    close(): void;
    cancel(): void;
    private readline;
    private ask;
}
export declare function parseQq(value: string): number;
export declare function resolveConfirm(answer: string, fallback: boolean): boolean | null;
export declare function resolveChoice(answer: string, choices: readonly string[], fallback: string): string | null;
export declare function isPromptCancelledError(err: unknown): boolean;
