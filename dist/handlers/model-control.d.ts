import { Handler, HandlerContext } from '../router.js';
import { DirectorySwitcher } from './directory.js';
export declare const MODELS_COMMAND = "/models";
export declare const MODEL_COMMAND = "/model";
export declare const HELP_COMMAND = "/help";
export declare const REASONING_EFFORT_COMMAND = "/reasoningEff";
export declare const PERMISSION_COMMAND = "/permission";
export declare const PERMISSIONS_COMMAND = "/permissions";
export interface BridgeModelSelection {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
export interface BridgeModelSelectionRef {
    current: BridgeModelSelection;
    assembled?: BridgeModelSelection;
}
export interface BridgeModelInfo {
    provider: string;
    id: string;
    name?: string;
    reasoningEfforts?: readonly string[];
    defaultReasoningEffort?: string;
}
export interface ModelSelectionController {
    getModelSelection(sessionKey: string): BridgeModelSelection;
    selectModel(sessionKey: string, model: string): Promise<BridgeModelSelection>;
    selectReasoningEffort(sessionKey: string, effort: string): Promise<BridgeModelSelection>;
    listModels(sessionKey: string): Promise<BridgeModelInfo[]>;
}
export interface PermissionController {
    runPermissionCommand(sessionKey: string, preset?: string): Promise<string>;
}
/** Bridge-side QQ commands for model routing. These never enter the agent. */
export declare class BridgeControlHandler implements Handler {
    private readonly controller;
    private readonly directorySwitcher?;
    private readonly permissionController?;
    name: string;
    constructor(controller: ModelSelectionController, directorySwitcher?: DirectorySwitcher | undefined, permissionController?: PermissionController | undefined);
    test(payload: string): boolean;
    run(ctx: HandlerContext): Promise<void>;
    private runPermission;
    private runDir;
    private runModel;
    private runReasoningEffort;
}
export declare class ModelControlHandler extends BridgeControlHandler {
}
export declare function installBridgeModelSelection(agentCtx: unknown, selection: BridgeModelSelectionRef): () => void;
export declare function resolveConfiguredModels(defaultModel: string, configured?: readonly string[]): string[];
