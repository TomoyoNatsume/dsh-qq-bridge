import { spawnSync } from 'node:child_process';
import { type OneBotServerSummary, type NapcatLogPathState, type NapcatLoginState, type NapcatRuntimeState } from './cli/napcat.js';
export type NapcatSettingsStatusState = 'not-installed' | 'needs-admin' | 'not-running' | 'ready';
export interface NapcatSettingsStatus {
    state: NapcatSettingsStatusState;
    installed: boolean;
    adminQq?: number;
    runtime?: NapcatRuntimeState;
    runningQqs?: number[];
    login?: NapcatLoginState;
    logState?: NapcatLogPathState;
    rootPath: string;
    logPath?: string;
    onebotConfigPath?: string;
    onebot?: {
        wsUrl: string;
        token: string;
        tokenPreview: string;
        enabled: boolean;
    };
    onebotChanged?: boolean;
    napcatStoppedQqs?: number[];
    napcatStarted?: boolean;
    napcatRestarted?: boolean;
    commands: string[];
    message: string;
    statusOutput?: string;
    restartOutput?: string;
}
export interface InspectNapcatSettingsOptions {
    adminQq?: unknown;
    rootPath?: unknown;
    spawn?: typeof spawnSync;
    onebotConfigWaitMs?: number;
    onebotConfigRetryIntervalMs?: number;
    serverConnectivityProbe?: (onebot: OneBotServerSummary, expectedQq: number) => Promise<NapcatLoginState>;
}
export declare function inspectNapcatSettings(options?: InspectNapcatSettingsOptions): Promise<NapcatSettingsStatus>;
export declare function setupNapcatForSettings(options?: InspectNapcatSettingsOptions): Promise<NapcatSettingsStatus>;
