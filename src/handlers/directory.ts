import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { Handler, HandlerContext } from '../router.js'
import { sessionKeyOf } from './agent.js'

export const DIR_COMMAND = '/dir'

export interface DirectorySwitcher {
  setCwd(sessionKey: string, cwd: string): Promise<void>
  getCwd?(sessionKey: string): string | undefined
}

/** Handles `/dir <path>` and starts the next QQ Agent turn in that directory. */
export class DirectoryHandler implements Handler {
  name = 'directory'

  constructor(private readonly switcher: DirectorySwitcher) {}

  test(payload: string): boolean {
    return payload === DIR_COMMAND || payload.startsWith(`${DIR_COMMAND} `)
  }

  async run(ctx: HandlerContext): Promise<void> {
    const rawPath = ctx.payload.slice(DIR_COMMAND.length).trim()
    if (!rawPath) {
      await ctx.respond('请发送 /dir <目录路径>，例如 /dir /home/xxx/project')
      return
    }
    const cwd = resolveUserPath(rawPath, this.switcher.getCwd?.(sessionKeyOf(ctx)))
    const info = await stat(cwd).catch(() => null)
    if (!info?.isDirectory()) {
      await ctx.respond(`目录不存在或不是目录: ${cwd}`)
      return
    }

    await this.switcher.setCwd(sessionKeyOf(ctx), cwd)
    await ctx.respond(`已切换当前 QQ 会话工作区: ${cwd}\n下一条消息会使用新的 Agent session。`)
  }
}

export function resolveUserPath(input: string, baseCwd = process.cwd()): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return isAbsolute(input) ? resolve(input) : resolve(baseCwd, input)
}
