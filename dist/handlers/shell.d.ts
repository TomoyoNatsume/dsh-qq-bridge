import { Handler, HandlerContext } from '../router.js';
/**
 * 可选 shell handler:仅在显式配置启用时注册(默认不开放任意命令)。
 */
export declare class ShellHandler implements Handler {
    private readonly runner;
    name: string;
    /** /dsh shell <cmd> */
    constructor(runner: (cmd: string) => Promise<{
        stdout: string;
        code?: number;
    }>);
    test(payload: string): boolean;
    run(ctx: HandlerContext): Promise<void>;
}
