export type NapcatRecoveryState = 'watching' | 'scheduled' | 'restarting' | 'verifying' | 'waiting-scan' | 'online' | 'needs-attention' | 'limited';
export interface NapcatRecoveryStatus {
    state: NapcatRecoveryState;
    message: string;
}
export declare function getNapcatRecoveryStatus(qq: number): NapcatRecoveryStatus | undefined;
/** Exclude all password fallback credentials, including those inherited by DSH. */
export declare function napcatScanEnv(): NodeJS.ProcessEnv;
export declare function restartNapcatForScan(qq: number, signal: AbortSignal): Promise<void>;
/** Only accept NapCat log headers, not received/sent QQ message bodies. */
export declare function napcatLoginSignal(line: string): 'kicked' | 'qrcode' | undefined;
export interface NapcatRecoveryOptions {
    qq: number;
    logPath: string;
    enabled: boolean;
    probe(): Promise<unknown>;
    restart?: typeof restartNapcatForScan;
}
/** Watches new log bytes independently of the single-account message input. */
export declare class NapcatRecovery {
    private readonly options;
    private stopped;
    private polling;
    private timer?;
    private restartTimer?;
    private abort;
    private offset;
    private identity;
    private decoder;
    private rest;
    private state;
    private deadline;
    private nextProbe;
    private probing;
    private lastStatus?;
    constructor(options: NapcatRecoveryOptions);
    start(): Promise<void>;
    stop(): void;
    isRecovering(): boolean;
    observeOnline(): void;
    private setStatus;
    private onLine;
    private recover;
    private verify;
    private poll;
}
