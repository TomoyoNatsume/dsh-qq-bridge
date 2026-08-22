import { DshQqBridgeConfig } from './config.js';
export declare const QQ_BRIDGE_SETTINGS_NAMESPACE = "dsh-qq-bridge";
export declare const QQ_BRIDGE_NAPCAT_RPC_CHANNEL = "/dsh-qq-bridge-napcat";
interface SettingsScope<T> {
    get(): T;
    watch(callback: (next: T, prev: T) => void | Promise<void>): () => void;
}
interface SettingsProvider {
    register<T>(ns: string, schema: unknown, options?: {
        base?: Partial<T>;
        applies?: 'live' | 'restart';
    }): SettingsScope<T>;
}
interface RpcConnection {
    rpc?: {
        handle(channel: string, handler: (endpoint: string, payload: unknown) => unknown | Promise<unknown>, options?: {
            authority?: 'loopback' | 'trusted-host';
        }): {
            dispose(): void;
        } | (() => void) | void;
    };
}
export interface QqBridgeSettingsCtx {
    inject?(services: readonly string[], cb: (ctx: QqBridgeSettingsCtx & {
        settings?: SettingsProvider;
    }) => void, label?: string): {
        dispose(): void;
    } | void;
    settings?: SettingsProvider;
    connection?: RpcConnection;
    effect?(cb: () => void | (() => void), label?: string): void;
}
export interface InstalledQqBridgeSettings {
    current(): DshQqBridgeConfig;
    dispose(): void;
}
export declare function installQqBridgeSettings(ctx: QqBridgeSettingsCtx, entry: DshQqBridgeConfig, onChange?: (next: DshQqBridgeConfig) => void | Promise<void>): Promise<InstalledQqBridgeSettings | undefined>;
export declare function cleanupLegacyProfileInsert(dshHome?: string): Promise<boolean>;
export {};
