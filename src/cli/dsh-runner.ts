import { closeSync, openSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'

export interface DshStartOptions {
  cwd: string
  token: string
  logPath?: string
  port?: number
}

export interface DshStartResult {
  pid: number | undefined
  logPath: string
  alreadyRunning: boolean
  url: string
}

export async function startDshWebBackground(options: DshStartOptions): Promise<DshStartResult> {
  const logPath = options.logPath ?? '/tmp/dsh-qq-bridge-dsh-web.log'
  const port = options.port ?? 3080
  const url = `http://127.0.0.1:${port}`
  const cwdStat = await stat(options.cwd).catch(() => null)
  if (!cwdStat?.isDirectory()) throw new Error(`DSH directory does not exist: ${options.cwd}`)
  if (await isHttpReachable(url)) {
    return { pid: undefined, logPath, alreadyRunning: true, url }
  }
  await mkdir(dirname(logPath), { recursive: true })
  const logFd = openSync(logPath, 'a')
  const child = (() => {
    try {
      return spawnDshWeb(options, logFd)
    } finally {
      closeSync(logFd)
    }
  })()
  child.unref()
  return { pid: child.pid, logPath, alreadyRunning: false, url }
}

function spawnDshWeb(options: DshStartOptions, logFd: number) {
  return spawn('pnpm', ['dsh', 'web'], {
    cwd: options.cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      DSH_QQ_TOKEN: options.token,
      DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? 'danger-full-access',
    },
  })
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
