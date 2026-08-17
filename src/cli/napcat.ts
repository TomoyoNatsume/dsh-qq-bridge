import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface OneBotServerSummary {
  enable: boolean
  host: string
  port: number
  token: string
  name?: string
}

export interface OneBotConfigUpdate {
  changed: boolean
  token: string
  server: OneBotServerSummary
  content: string
}

export type NapcatRuntimeState = 'running' | 'not-running' | 'unknown'
export type NapcatLoginState = 'logged-in' | 'not-logged-in' | 'unknown'
export type NapcatLogPathState = 'ready' | 'missing-account-log' | 'missing-log-dir' | 'missing-root'

export interface NapcatLogPathSnapshot {
  rootExists: boolean
  logDirExists: boolean
  accountLogExists: boolean
}

export function defaultNapcatRootPath(): string {
  return join(homedir(), 'Napcat')
}

export function defaultNapcatLogDir(rootPath = defaultNapcatRootPath()): string {
  return join(rootPath, 'log')
}

export function defaultNapcatLogPath(qq: number, rootPath = defaultNapcatRootPath()): string {
  return join(defaultNapcatLogDir(rootPath), `napcat_${qq}.log`)
}

export function defaultOnebotConfigPath(qq: number, rootPath = defaultNapcatRootPath()): string {
  return join(
    rootPath,
    'opt',
    'QQ',
    'resources',
    'app',
    'app_launcher',
    'napcat',
    'config',
    `onebot11_${qq}.json`,
  )
}

export async function tryReadOnebotToken(path: string): Promise<string | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const json = JSON.parse(raw) as unknown
    const server = firstWebSocketServer(json)
    return typeof server?.token === 'string' && server.token.trim() ? server.token : null
  } catch {
    return null
  }
}

export async function updateOnebotConfigFile(path: string): Promise<OneBotConfigUpdate> {
  const raw = await readFile(path, 'utf8')
  const update = updateOnebotConfig(raw)
  if (update.changed) await writeFile(path, update.content, 'utf8')
  return update
}

export function updateOnebotConfig(raw: string): OneBotConfigUpdate {
  const json = JSON.parse(raw) as unknown
  if (!isRecord(json)) throw new Error('OneBot config root is not an object')
  const network = ensureRecord(json, 'network')
  const servers = ensureArray(network, 'websocketServers')
  const server = ensureFirstRecord(servers)

  const before = JSON.stringify(json)
  const existingToken = typeof server.token === 'string' && server.token.trim() ? server.token.trim() : randomToken()
  server.enable = true
  server.name = typeof server.name === 'string' && server.name.trim() ? server.name : 'DSH-QQ-Bridge'
  server.host = '127.0.0.1'
  server.port = 3001
  server.token = existingToken

  const content = JSON.stringify(json, null, 2) + '\n'
  return {
    changed: JSON.stringify(json) !== before,
    token: existingToken,
    server: {
      enable: true,
      host: '127.0.0.1',
      port: 3001,
      token: existingToken,
      name: String(server.name),
    },
    content,
  }
}

export function napcatConfigExists(qq: number): boolean {
  return existsSync(defaultOnebotConfigPath(qq))
}

export function classifyNapcatRuntime(exitCode: number | null, output: string): NapcatRuntimeState {
  const text = output.toLowerCase()
  if (matchesAny(text, ['not running', 'stopped', 'inactive', '未启动', '未运行', '已停止', '没有运行'])) {
    return 'not-running'
  }
  if (matchesAny(text, ['running', 'active', 'started', 'pid', '运行中', '已启动', '正在运行'])) {
    return 'running'
  }
  if (exitCode === 0) return 'running'
  return 'not-running'
}

export function classifyNapcatLogin(output: string): NapcatLoginState {
  const text = output.toLowerCase()
  if (matchesAny(text, ['not logged', 'not login', 'login required', 'qrcode', 'qr code', '未登录', '未登陆', '扫码', '二维码'])) {
    return 'not-logged-in'
  }
  if (matchesAny(text, ['logged in', 'login success', 'online', '已登录', '已登陆', '登录成功', '登陆成功', '在线'])) {
    return 'logged-in'
  }
  return 'unknown'
}

export function classifyNapcatLogPaths(snapshot: NapcatLogPathSnapshot): NapcatLogPathState {
  if (!snapshot.rootExists) return 'missing-root'
  if (!snapshot.logDirExists) return 'missing-log-dir'
  if (!snapshot.accountLogExists) return 'missing-account-log'
  return 'ready'
}

export function canAcceptUserConfirmedLogin(params: {
  runtime: NapcatRuntimeState
  login: NapcatLoginState
  logState: NapcatLogPathState
}): boolean {
  if (params.runtime !== 'running') return false
  if (params.login === 'logged-in') return true
  if (params.login === 'not-logged-in') return false
  return params.logState === 'ready'
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key]
  if (value === undefined) {
    const next: Record<string, unknown> = {}
    parent[key] = next
    return next
  }
  if (!isRecord(value)) throw new Error(`OneBot config ${key} is not an object`)
  return value
}

function ensureArray(parent: Record<string, unknown>, key: string): unknown[] {
  const value = parent[key]
  if (value === undefined) {
    const next: unknown[] = []
    parent[key] = next
    return next
  }
  if (!Array.isArray(value)) throw new Error(`OneBot config ${key} is not an array`)
  return value
}

function ensureFirstRecord(values: unknown[]): Record<string, unknown> {
  if (values.length === 0) {
    const next: Record<string, unknown> = {}
    values.push(next)
    return next
  }
  if (!isRecord(values[0])) throw new Error('OneBot websocket server entry is not an object')
  return values[0]
}

function firstWebSocketServer(json: unknown): Record<string, unknown> | null {
  if (!isRecord(json)) return null
  const network = json.network
  if (!isRecord(network)) return null
  const servers = network.websocketServers
  if (!Array.isArray(servers) || servers.length === 0 || !isRecord(servers[0])) return null
  return servers[0]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function randomToken(): string {
  return randomBytes(12).toString('hex')
}

function matchesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}
