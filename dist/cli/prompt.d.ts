export declare class Prompter {
    private rl;
    text(label: string, fallback?: string): Promise<string>;
    confirm(label: string, fallback?: boolean): Promise<boolean>;
    choice(label: string, choices: readonly string[], fallback: string): Promise<string>;
    close(): void;
    private readline;
}
export declare function parseQq(value: string): number;
export declare function resolveConfirm(answer: string, fallback: boolean): boolean | null;
export declare function resolveChoice(answer: string, choices: readonly string[], fallback: string): string | null;
