import { Handler, HandlerContext } from '../router.js';
export declare const DIR_COMMAND = "/dir";
export interface DirectorySwitcher {
    setCwd(sessionKey: string, cwd: string): Promise<void>;
    getCwd?(sessionKey: string): string | undefined;
}
/** Handles `/dir <path>` and starts the next QQ Agent turn in that directory. */
export declare class DirectoryHandler implements Handler {
    private readonly switcher;
    name: string;
    constructor(switcher: DirectorySwitcher);
    test(payload: string): boolean;
    run(ctx: HandlerContext): Promise<void>;
}
export declare function resolveUserPath(input: string, baseCwd?: string): string;
