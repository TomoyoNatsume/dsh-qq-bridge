import { HandlerContext } from '../router.js';
import { DirectorySwitcher } from './directory.js';
import type { ModelSelectionController, PermissionController } from './model-control.js';
export declare const QQ_CONTROL_BLOCK_TAG = "dsh-qq-bridge-control";
export interface QqControlAction {
    action: string;
    [key: string]: unknown;
}
export interface ParsedQqControls {
    visibleText: string;
    actions: QqControlAction[];
    errors: string[];
}
export interface QqControlContext {
    sessionKey: string;
    source: HandlerContext;
}
export interface QqControlActionHandler {
    action: string;
    run(action: QqControlAction, ctx: QqControlContext): Promise<string | undefined>;
}
export declare class QqControlDispatcher {
    private readonly handlers;
    register(handler: QqControlActionHandler): () => void;
    dispatch(action: QqControlAction, ctx: QqControlContext): Promise<string | undefined>;
}
export declare function parseQqControlBlocks(text: string): ParsedQqControls;
export declare function createSetCwdControlHandler(switcher: DirectorySwitcher): QqControlActionHandler;
export declare function createSetModelControlHandler(controller: ModelSelectionController): QqControlActionHandler;
export declare function createSetReasoningEffortControlHandler(controller: ModelSelectionController): QqControlActionHandler;
export declare function createSetPermissionControlHandler(controller: PermissionController): QqControlActionHandler;
