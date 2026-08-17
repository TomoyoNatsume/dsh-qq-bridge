import { closeSync, openSync } from 'node:fs'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

export const DSH_WEB_LOG_PATH = '/tmp/dsh-qq-bridge-dsh-web.log'
export const DSH_WEB_PID_PATH = '/tmp/dsh-qq-bridge-dsh-web.pid'

export interface DshStartOptions {
  cwd: string
  logPath?: string
  port?: number
  startupTimeoutMs?: number
}

export interface DshStartResult {
  pid: number | null
  pidFile: string
  logPath: string
  alreadyRunning: boolean
  ready: boolean
  url: string
  command: string
}

export async function startDshWebBackground(options: DshStartOptions): Promise<DshStartResult> {
  const logPath = options.logPath ?? DSH_WEB_LOG_PATH
  const port = options.port ?? 3080
  const url = `http://127.0.0.1:${port}`
  const cwdStat = await stat(options.cwd).catch(() => null)
  if (!cwdStat?.isDirectory()) throw new Error(`DSH directory does not exist: ${options.cwd}`)
  const command = await resolveDshCommand(options.cwd)
  const existingPid = await readLivePidFile()
  if (await isHttpReachable(url)) {
    return { pid: existingPid, pidFile: DSH_WEB_PID_PATH, logPath, alreadyRunning: true, ready: true, url, command: command.display }
  }
  if (existingPid !== null && isProcessAlive(existingPid)) {
    const ready = await waitForHttpReachable(url, options.startupTimeoutMs ?? 30_000)
    return { pid: existingPid, pidFile: DSH_WEB_PID_PATH, logPath, alreadyRunning: true, ready, url, command: command.display }
  }
  await mkdir(dirname(logPath), { recursive: true })
  await mkdir(dirname(DSH_WEB_PID_PATH), { recursive: true })
  const logFd = openSync(logPath, 'a')
  const child = (() => {
    try {
      return spawnDshWeb(options.cwd, command, logFd)
    } finally {
      closeSync(logFd)
    }
  })()
  if (child.pid !== undefined) {
    await writeFile(DSH_WEB_PID_PATH, `${child.pid}\n`, 'utf8')
  }
  child.unref()
  const ready = await waitForHttpReachable(url, options.startupTimeoutMs ?? 30_000)
  return { pid: child.pid ?? null, pidFile: DSH_WEB_PID_PATH, logPath, alreadyRunning: false, ready, url, command: command.display }
}

export async function getDshWebStatus(port = 3080): Promise<{
  pid: number | null
  pidFile: string
  logPath: string
  processAlive: boolean
  reachable: boolean
  url: string
}> {
  const url = `http://127.0.0.1:${port}`
  const pid = await readPidFile()
  const processAlive = pid !== null && isProcessAlive(pid)
  return {
    pid,
    pidFile: DSH_WEB_PID_PATH,
    logPath: DSH_WEB_LOG_PATH,
    processAlive,
    reachable: await isHttpReachable(url),
    url,
  }
}

export async function stopDshWeb(): Promise<{ pid: number | null; stopped: boolean; message: string }> {
  const pid = await readPidFile()
  if (pid === null) return { pid, stopped: false, message: `未找到 pid 文件: ${DSH_WEB_PID_PATH}` }
  if (!isProcessAlive(pid)) {
    await unlink(DSH_WEB_PID_PATH).catch(() => undefined)
    return { pid, stopped: true, message: `pid ${pid} 已不存在，已清理 pid 文件。` }
  }
  process.kill(pid, 'SIGTERM')
  const stopped = await waitForProcessExit(pid, 5_000)
  if (stopped) {
    await unlink(DSH_WEB_PID_PATH).catch(() => undefined)
    return { pid, stopped: true, message: `已停止 DSH web: ${pid}` }
  }
  return { pid, stopped: false, message: `已发送 SIGTERM，但 pid ${pid} 仍在运行；可检查日志后手动 kill。` }
}

export function tailDshWebLog(): number | null {
  const result = spawnSync('tail', ['-n', '120', '-f', DSH_WEB_LOG_PATH], { stdio: 'inherit' })
  return result.status
}

interface DshCommand {
  cmd: string
  args: string[]
  display: string
}

async function resolveDshCommand(cwd: string): Promise<DshCommand> {
  const sourceEntry = join(cwd, 'apps', 'cli', 'src', 'bin.ts')
  if (await isFile(sourceEntry)) {
    return {
      cmd: process.execPath,
      args: ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web'],
      display: 'node --import tsx/esm apps/cli/src/bin.ts web',
    }
  }
  const builtEntry = join(cwd, 'apps', 'cli', 'lib', 'bin.js')
  if (await isFile(builtEntry)) {
    return {
      cmd: process.execPath,
      args: ['apps/cli/lib/bin.js', 'web'],
      display: 'node apps/cli/lib/bin.js web',
    }
  }
  return {
    cmd: 'pnpm',
    args: ['dsh', 'web'],
    display: 'pnpm dsh web',
  }
}

function spawnDshWeb(cwd: string, command: DshCommand, logFd: number) {
  return spawn(command.cmd, command.args, {
    cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
    },
  })
}

async function isFile(path: string): Promise<boolean> {
  const s = await stat(path).catch(() => null)
  return s?.isFile() ?? false
}

async function readPidFile(): Promise<number | null> {
  const text = await readFile(DSH_WEB_PID_PATH, 'utf8').catch(() => '')
  const pid = Number.parseInt(text.trim(), 10)
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

async function readLivePidFile(): Promise<number | null> {
  const pid = await readPidFile()
  return pid !== null && isProcessAlive(pid) ? pid : null
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function isHttpReachable(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 600)
  try {
    await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForHttpReachable(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isHttpReachable(url)) return true
    await sleep(500)
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await sleep(200)
  }
  return !isProcessAlive(pid)
}
