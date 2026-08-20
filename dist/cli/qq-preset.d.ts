export declare const QQ_BRIDGE_PRESET_ID = "dsh-qq-bridge";
export interface InstallQqBridgePresetResult {
    sourceDir: string;
    targetDir: string;
}
export declare function installQqBridgePreset(dshHome: string): Promise<InstallQqBridgePresetResult>;
