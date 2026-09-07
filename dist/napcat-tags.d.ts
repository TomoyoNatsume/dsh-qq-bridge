export declare function napcatExecutableExists(searchPath?: string): Promise<boolean>;
export declare function inspectNapcatTag(stage: string, payload: Record<string, unknown>): Promise<{
    installed: boolean;
    running?: undefined;
    runningQqs?: undefined;
    loggedIn?: undefined;
    qq?: undefined;
} | {
    running: boolean;
    runningQqs: number[];
    installed?: undefined;
    loggedIn?: undefined;
    qq?: undefined;
} | {
    loggedIn: boolean;
    qq: number;
    installed?: undefined;
    running?: undefined;
    runningQqs?: undefined;
}>;
export declare function probeNapcatLogin(wsUrl: string, token: string, qq: number): Promise<boolean>;
