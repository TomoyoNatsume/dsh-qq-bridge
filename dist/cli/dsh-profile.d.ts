export interface BridgeProfileConfig {
    pluginName: string;
    wsUrl: string;
    token: string;
    adminQq: number;
    commandPrefix: string;
    provider: string;
    model: string;
    cwd: string;
    selfLogEnabled: boolean;
    selfLogPath?: string;
}
export interface OfficialBridgeProfileConfig {
    pluginName: string;
    appId: string;
    appSecret: string;
    adminOpenId: string;
    allowlistOpenIds: readonly string[];
    sandbox: boolean;
    commandPrefix: string;
    provider: string;
    model: string;
    cwd: string;
}
export interface ProfileUpdateResult {
    changed: boolean;
    content: string;
    preview: string;
    action: 'added' | 'replaced' | 'unchanged';
}
export declare function buildBridgeInsertItem(cfg: BridgeProfileConfig): string;
export declare function buildOfficialBridgeInsertItem(cfg: OfficialBridgeProfileConfig): string;
export declare function updateSetupProfilePatch(content: string, bridgeItem: string): ProfileUpdateResult;
export declare function removeInsertItem(content: string, itemId: string): ProfileUpdateResult;
export declare function updateProfilePatch(content: string, item: string, itemId?: string): ProfileUpdateResult;
export declare function writeProfilePatchWithBackup(path: string, nextContent: string, backupPath: string): Promise<string>;
