export declare const DSH_WEB_LOG_PATH = "/tmp/dsh-qq-bridge-dsh-web.log";
export declare const DSH_WEB_PID_PATH = "/tmp/dsh-qq-bridge-dsh-web.pid";
export interface DshStartOptions {
    cwd: string;
    logPath?: string;
    port?: number;
    startupTimeoutMs?: number;
}
export interface DshStartResult {
    pid: number | null;
    pidFile: string;
    logPath: string;
    alreadyRunning: boolean;
    ready: boolean;
    url: string;
    command: string;
}
export declare function startDshWebBackground(options: DshStartOptions): Promise<DshStartResult>;
export declare function getDshWebStatus(port?: number): Promise<{
    pid: number | null;
    pidFile: string;
    logPath: string;
    processAlive: boolean;
    reachable: boolean;
    url: string;
}>;
export declare function stopDshWeb(): Promise<{
    pid: number | null;
    stopped: boolean;
    message: string;
}>;
export declare function tailDshWebLog(): number | null;
