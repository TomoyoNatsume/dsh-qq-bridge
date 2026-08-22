import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  classifyNapcatLogin,
  classifyNapcatLogPaths,
  classifyNapcatRuntime,
  defaultNapcatLogDir,
  defaultNapcatLogPath,
  defaultNapcatRootPath,
  defaultOnebotConfigPath,
  tryReadOnebotServer,
  updateOnebotConfigFile,
  type OneBotServerSummary,
  type NapcatLogPathState,
  type NapcatLoginState,
  type NapcatRuntimeState,
} from './cli/napcat.js'
import { napcatCliInstallGuide } from './cli/setup.js'

const DEFAULT_ONEBOT_WS_URL = 'ws://127.0.0.1:3001'

export type NapcatSettingsStatusState =
  | 'not-installed'
  | 'needs-admin'
  | 'not-running'
  | 'ready'

export interface NapcatSettingsStatus {
  state: NapcatSettingsStatusState
  installed: boolean
  adminQq?: number
  runtime?: NapcatRuntimeState
  login?: NapcatLoginState
  logState?: NapcatLogPathState
  rootPath: string
  logPath?: string
  onebotConfigPath?: string
  onebot?: {
    wsUrl: string
    token: string
    tokenPreview: string
    enabled: boolean
  }
  onebotChanged?: boolean
  napcatRestarted?: boolean
  commands: string[]
  message: string
  statusOutput?: string
  restartOutput?: string
}

export interface InspectNapcatSettingsOptions {
  adminQq?: unknown
  rootPath?: unknown
  spawn?: typeof spawnSync
}

export async function inspectNapcatSettings(options: InspectNapcatSettingsOptions = {}): Promise<NapcatSettingsStatus> {
  const base = inspectNapcatRuntimeForSettings(options)
  if (base !== undefined) return base

  const spawn = options.spawn ?? spawnSync
  const rootPath = typeof options.rootPath === 'string' && options.rootPath.trim()
    ? options.rootPath.trim()
    : defaultNapcatRootPath()
  const adminQq = normalizeAdminQq(options.adminQq)
  if (adminQq === undefined) throw new Error('internal NapCat status error: missing QQ after validation')
  const status = inspectNapcat(adminQq, rootPath, spawn)
  const commands = napcatCommands(adminQq)
  const onebotConfigPath = defaultOnebotConfigPath(adminQq, rootPath)
  const onebot = await tryReadOnebotServer(onebotConfigPath)

  return {
    state: 'ready',
    installed: true,
    adminQq,
    runtime: status.runtime,
    login: status.login,
    logState: status.logState,
    rootPath,
    logPath: defaultNapcatLogPath(adminQq, rootPath),
    onebotConfigPath,
    onebot: onebot === null ? undefined : onebotStatus(onebot),
    commands,
    message: onebot === null
      ? 'NapCat 已启动。保存配置时会自动配置 OneBot；若发送 "ping" 后没反应，请查看日志确认是否已登录。'
      : 'NapCat 已启动，OneBot 配置已检测到。保存配置会刷新本机 OneBot 配置。',
    statusOutput: status.output,
  }
}

export async function setupNapcatForSettings(options: InspectNapcatSettingsOptions = {}): Promise<NapcatSettingsStatus> {
  const base = inspectNapcatRuntimeForSettings(options)
  if (base !== undefined) {
    if (base.state === 'not-installed') throw new Error(`${base.message}\n${base.commands.join('\n')}`)
    if (base.state === 'needs-admin') throw new Error(base.message)
    if (base.state === 'not-running') throw new Error(`${base.message}\n${base.commands.join('\n')}`)
    return base
  }

  const spawn = options.spawn ?? spawnSync
  const rootPath = typeof options.rootPath === 'string' && options.rootPath.trim()
    ? options.rootPath.trim()
    : defaultNapcatRootPath()
  const adminQq = normalizeAdminQq(options.adminQq)
  if (adminQq === undefined) throw new Error('请输入 NapCat 登录 QQ。')
  const status = inspectNapcat(adminQq, rootPath, spawn)
  const onebotConfigPath = defaultOnebotConfigPath(adminQq, rootPath)
  const update = await updateOnebotConfigFile(onebotConfigPath).catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`无法写入 OneBot 配置 ${onebotConfigPath}: ${message}`)
  })
  const restart = update.changed ? restartNapcat(adminQq, spawn) : { ok: true, output: '' }
  if (!restart.ok) {
    throw new Error(`OneBot 配置已写入，但执行 napcat restart ${adminQq} 失败: ${restart.output || 'unknown error'}`)
  }
  const nextStatus = update.changed ? inspectNapcat(adminQq, rootPath, spawn) : status
  const commands = napcatCommands(adminQq)

  return {
    state: 'ready',
    installed: true,
    adminQq,
    runtime: nextStatus.runtime,
    login: nextStatus.login,
    logState: nextStatus.logState,
    rootPath,
    logPath: defaultNapcatLogPath(adminQq, rootPath),
    onebotConfigPath,
    onebot: onebotStatus(update.server),
    onebotChanged: update.changed,
    napcatRestarted: update.changed,
    commands,
    message: `已完成 NapCat/OneBot 配置。${update.changed ? `已执行 napcat restart ${adminQq} 让 OneBot 配置生效。` : ''}如果发送 "ping" 后没反应，请运行 napcat log ${adminQq} 或查看 ${defaultNapcatLogPath(adminQq, rootPath)} 确认是否已登录。`,
    statusOutput: nextStatus.output,
    restartOutput: restart.output,
  }
}

function inspectNapcatRuntimeForSettings(options: InspectNapcatSettingsOptions): NapcatSettingsStatus | undefined {
  const spawn = options.spawn ?? spawnSync
  const rootPath = typeof options.rootPath === 'string' && options.rootPath.trim()
    ? options.rootPath.trim()
    : defaultNapcatRootPath()

  if (!napcatCommandExists(spawn)) {
    return {
      state: 'not-installed',
      installed: false,
      rootPath,
      commands: napcatCliInstallGuide().split('\n').filter(Boolean),
      message: '未检测到 NapCat CLI。请先安装 NapCat，再回到这里刷新状态。',
    }
  }

  const adminQq = normalizeAdminQq(options.adminQq)
  if (adminQq === undefined) {
    return {
      state: 'needs-admin',
      installed: true,
      rootPath,
      commands: ['napcat help'],
      message: '请输入 NapCat 登录 QQ 后检测 NapCat 运行状态。',
    }
  }

  const status = inspectNapcat(adminQq, rootPath, spawn)
  const commands = napcatCommands(adminQq)
  if (status.runtime !== 'running') {
    return {
      state: 'not-running',
      installed: true,
      adminQq,
      runtime: status.runtime,
      login: status.login,
      logState: status.logState,
      rootPath,
      logPath: defaultNapcatLogPath(adminQq, rootPath),
      commands,
      message: `NapCat 未启动。请在终端执行 napcat start ${adminQq}，启动后回到这里保存配置。`,
      statusOutput: status.output,
    }
  }
  return undefined
}

function napcatCommandExists(spawn: typeof spawnSync): boolean {
  const result = spawn('napcat', ['help'], { encoding: 'utf8', timeout: 3000 })
  const err = result.error as NodeJS.ErrnoException | undefined
  return err?.code !== 'ENOENT'
}

function normalizeAdminQq(value: unknown): number | undefined {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return undefined
  const number = Number(text)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

function inspectNapcat(qq: number, napcatRoot: string, spawn: typeof spawnSync): {
  runtime: NapcatRuntimeState
  login: NapcatLoginState
  logState: NapcatLogPathState
  output: string
} {
  const status = spawn('napcat', ['status', String(qq)], { encoding: 'utf8', timeout: 3000 })
  const output = [status.stdout, status.stderr].filter(Boolean).join('\n').trim()
  return {
    runtime: classifyNapcatRuntime(status.status, output),
    login: classifyNapcatLogin(output),
    logState: classifyNapcatLogPaths({
      rootExists: existsSync(napcatRoot),
      logDirExists: existsSync(defaultNapcatLogDir(napcatRoot)),
      accountLogExists: existsSync(defaultNapcatLogPath(qq, napcatRoot)),
    }),
    output,
  }
}

function napcatCommands(qq: number): string[] {
  return [
    `napcat status ${qq}`,
    `napcat start ${qq}`,
    `napcat log ${qq}`,
  ]
}

function restartNapcat(qq: number, spawn: typeof spawnSync): { ok: boolean; output: string } {
  const result = spawn('napcat', ['restart', String(qq)], { encoding: 'utf8', timeout: 15000 })
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  return {
    ok: result.status === 0,
    output,
  }
}

function onebotStatus(server: OneBotServerSummary): NonNullable<NapcatSettingsStatus['onebot']> {
  const wsUrl = `ws://${server.host}:${server.port}`
  return {
    wsUrl: wsUrl || DEFAULT_ONEBOT_WS_URL,
    token: server.token,
    tokenPreview: previewSecret(server.token),
    enabled: server.enable,
  }
}

function previewSecret(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 8) return trimmed ? '********' : ''
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}
