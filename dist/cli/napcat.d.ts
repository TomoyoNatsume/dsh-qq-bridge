export interface OneBotServerSummary {
    enable: boolean;
    host: string;
    port: number;
    token: string;
    name?: string;
}
export interface OneBotConfigUpdate {
    changed: boolean;
    token: string;
    server: OneBotServerSummary;
    content: string;
}
export interface OnebotWsEndpointCheckOptions {
    wsUrl: string;
    token?: string;
    timeoutMs?: number;
    retryIntervalMs?: number;
}
export interface OnebotWsEndpointCheckResult {
    ok: boolean;
    reason?: string;
}
export type NapcatRuntimeState = 'running' | 'not-running' | 'unknown';
export type NapcatLoginState = 'logged-in' | 'not-logged-in' | 'unknown';
export type NapcatLogPathState = 'ready' | 'missing-account-log' | 'missing-log-dir' | 'missing-root';
export interface NapcatLogPathSnapshot {
    rootExists: boolean;
    logDirExists: boolean;
    accountLogExists: boolean;
}
export declare function defaultNapcatRootPath(): string;
export declare function defaultNapcatLogDir(rootPath?: string): string;
export declare function defaultNapcatLogPath(qq: number, rootPath?: string): string;
export declare function defaultOnebotConfigPath(qq: number, rootPath?: string): string;
export declare function tryReadOnebotToken(path: string): Promise<string | null>;
export declare function tryReadOnebotServer(path: string): Promise<OneBotServerSummary | null>;
export declare function updateOnebotConfigFile(path: string): Promise<OneBotConfigUpdate>;
export declare function waitForOnebotWsEndpoint(options: OnebotWsEndpointCheckOptions): Promise<OnebotWsEndpointCheckResult>;
export declare function updateOnebotConfig(raw: string): OneBotConfigUpdate;
export declare function napcatConfigExists(qq: number): boolean;
export declare function classifyNapcatRuntime(exitCode: number | null, output: string): NapcatRuntimeState;
export declare function classifyNapcatLogin(output: string): NapcatLoginState;
export declare function classifyNapcatLogPaths(snapshot: NapcatLogPathSnapshot): NapcatLogPathState;
export declare function canAcceptUserConfirmedLogin(params: {
    runtime: NapcatRuntimeState;
    login: NapcatLoginState;
    logState: NapcatLogPathState;
}): boolean;
