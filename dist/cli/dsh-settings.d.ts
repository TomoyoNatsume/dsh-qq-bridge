export interface SettingsUpdateResult {
    changed: boolean;
    content: string;
    preview: string;
}
export declare function updatePermissionDefaultPreset(content: string, preset?: string): SettingsUpdateResult;
export declare function writeSettingsWithBackup(path: string, nextContent: string): Promise<string>;
