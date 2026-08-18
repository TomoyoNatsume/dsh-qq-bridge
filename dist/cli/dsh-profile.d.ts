export interface BridgeProfileConfig {
    pluginName: string;
    wsUrl: string;
    token: string;
    adminQq: number;
    commandPrefix: string;
    provider: string;
    model: string;
    selfLogEnabled: boolean;
    selfLogPath?: string;
}
export interface ProfileUpdateResult {
    changed: boolean;
    content: string;
    preview: string;
    action: 'added' | 'replaced' | 'unchanged';
}
export declare function buildBridgeInsertItem(cfg: BridgeProfileConfig): string;
export declare function updateSetupProfilePatch(content: string, bridgeItem: string): ProfileUpdateResult;
export declare function removeInsertItem(content: string, itemId: string): ProfileUpdateResult;
export declare function updateProfilePatch(content: string, item: string, itemId?: string): ProfileUpdateResult;
export declare function writeProfilePatchWithBackup(path: string, nextContent: string): Promise<string>;
