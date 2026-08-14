import { Handler, HandlerContext } from '../router.js'

/**
 * 可选 shell handler:仅在显式配置启用时注册(默认不开放任意命令)。
 */
export class ShellHandler implements Handler {
  name = 'shell'
  /** /dsh shell <cmd> */
  constructor(private readonly runner: (cmd: string) => Promise<{ stdout: string; code?: number }>) {}

  test(payload: string): boolean {
    return payload.startsWith('shell ')
  }

  async run(ctx: HandlerContext): Promise<void> {
    const cmd = payloadBody(ctx.payload)
    try {
      const { stdout, code } = await this.runner(cmd)
      const head = stdout.slice(0, 2000)
      await ctx.respond(code === 0 ? head : `[exit:${code}]\n${head}`)
    } catch (err) {
      await ctx.respond(`shell error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

function payloadBody(payload: string): string {
  return payload.slice('shell '.length).trim()
}
