/**
 * 可选 shell handler:仅在显式配置启用时注册(默认不开放任意命令)。
 */
export class ShellHandler {
    runner;
    name = 'shell';
    /** /dsh shell <cmd> */
    constructor(runner) {
        this.runner = runner;
    }
    test(payload) {
        return payload.startsWith('shell ');
    }
    async run(ctx) {
        const cmd = payloadBody(ctx.payload);
        try {
            const { stdout, code } = await this.runner(cmd);
            const head = stdout.slice(0, 2000);
            await ctx.respond(code === 0 ? head : `[exit:${code}]\n${head}`);
        }
        catch (err) {
            await ctx.respond(`shell error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
function payloadBody(payload) {
    return payload.slice('shell '.length).trim();
}
