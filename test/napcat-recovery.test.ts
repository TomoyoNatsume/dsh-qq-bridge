import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, appendFile, rename, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NapcatRecovery, getNapcatRecoveryStatus, napcatLoginSignal, napcatScanEnv, restartNapcatForScan } from '../src/napcat-recovery.js'

const kick = '09-05 12:00:00 [error] Bot | [KickedOffLine] [下线通知] 你的账号当前登录已失效，请重新登录。\n'
let account = 80000
let dir: string
const monitors: NapcatRecovery[] = []
async function setup(initial = '', enabled = true) {
  const qq = ++account
  const logPath = join(dir, `${qq}.log`)
  await writeFile(logPath, initial)
  const restart = vi.fn(async () => {})
  const probe = vi.fn(async () => {})
  const monitor = new NapcatRecovery({ qq, logPath, enabled, restart, probe })
  monitors.push(monitor)
  await monitor.start()
  // Drive file polling explicitly; keep delayed restarts on the fake clock.
  const internal = monitor as unknown as { timer: NodeJS.Timeout; poll(): Promise<void> }
  clearInterval(internal.timer)
  return { qq, logPath, restart, probe, monitor, poll: () => internal.poll(), state: () => getNapcatRecoveryStatus(qq)?.state }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'napcat-recovery-test-'))
  vi.useFakeTimers()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(async () => {
  for (const monitor of monitors.splice(0)) monitor.stop()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

describe('NapCat restart and scan recovery', () => {
  it('ignores historical kicks and chat text; combines partial lines and deduplicates fresh kicks', async () => {
    const m = await setup(kick)
    await m.poll()
    expect(m.state()).toBe('watching')
    await appendFile(m.logPath, `09-05 12:00:01 [info] Bot | 接收 <- 私聊 (123) ${kick}`)
    await m.poll()
    expect(m.state()).toBe('watching')
    await appendFile(m.logPath, kick.slice(0, 40))
    await m.poll()
    expect(m.state()).toBe('watching')
    await appendFile(m.logPath, kick.slice(40) + kick)
    await m.poll()
    expect(m.state()).toBe('scheduled')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(m.restart).toHaveBeenCalledTimes(1)
    expect(m.restart).toHaveBeenCalledWith(m.qq, expect.any(AbortSignal))
    expect(m.state()).toBe('verifying')
    await vi.advanceTimersByTimeAsync(10_000)
    await m.poll()
    expect(m.probe).toHaveBeenCalledTimes(1)
    expect(m.state()).toBe('online')
  })

  it('does not start when disabled', async () => {
    for (const m of [await setup('', false)]) {
      await appendFile(m.logPath, kick)
      expect(m.state()).toBeUndefined()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(m.restart).not.toHaveBeenCalled()
    }
  })

  it('detects replacement even when the rotated file is larger, and truncation', async () => {
    const m = await setup('old\n')
    await rename(m.logPath, `${m.logPath}.old`)
    await writeFile(m.logPath, 'new larger file\n' + kick)
    await m.poll()
    expect(m.state()).toBe('scheduled')
    const n = await setup('old data'.repeat(100))
    await writeFile(n.logPath, kick)
    await n.poll()
    expect(n.state()).toBe('scheduled')
  })

  it('cancels scheduled restart on disposal and removes status', async () => {
    const m = await setup()
    await appendFile(m.logPath, kick)
    await m.poll()
    m.monitor.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(m.restart).not.toHaveBeenCalled()
    expect(m.state()).toBeUndefined()
  })

  it('waits for scanning without probes or repeated restarts and resumes on a QQ message', async () => {
    const m = await setup()
    await appendFile(m.logPath, kick)
    await m.poll()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(m.state()).toBe('verifying')
    await appendFile(m.logPath, '09-05 12:00:20 [warn] 请扫描下面的二维码，然后在手Q上授权登录：\n')
    await m.poll()
    expect(m.state()).toBe('waiting-scan')
    await appendFile(m.logPath, kick)
    await m.poll()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(m.restart).toHaveBeenCalledTimes(1)
    expect(m.probe).not.toHaveBeenCalled()
    m.monitor.observeOnline()
    expect(m.state()).toBe('online')
  })

  it('limits repeated kicks even after successful recovery', async () => {
    const m = await setup()
    await appendFile(m.logPath, kick)
    await m.poll()
    await vi.advanceTimersByTimeAsync(20_000)
    await m.poll()
    expect(m.state()).toBe('online')
    await appendFile(m.logPath, kick)
    await m.poll()
    expect(m.state()).toBe('limited')
    await vi.advanceTimersByTimeAsync(600_000)
    expect(m.restart).toHaveBeenCalledTimes(1)
  })

  it('stops after restart failure or unsuccessful verification without exposing errors', async () => {
    const m = await setup()
    m.restart.mockRejectedValueOnce(new Error('secret-test-password'))
    await appendFile(m.logPath, kick)
    await m.poll()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(m.state()).toBe('needs-attention')
    expect(JSON.stringify(getNapcatRecoveryStatus(m.qq))).not.toContain('secret-test-password')
    const n = await setup()
    n.probe.mockRejectedValue(new Error('timeout'))
    await appendFile(n.logPath, kick)
    await n.poll()
    await vi.advanceTimersByTimeAsync(20_000)
    await n.poll()
    expect(n.state()).toBe('verifying')
    await vi.advanceTimersByTimeAsync(120_000)
    await n.poll()
    expect(n.state()).toBe('waiting-scan')
    expect(n.restart).toHaveBeenCalledTimes(1)
  })

  it('enforces the hourly cap independently of the ten-minute cooldown', async () => {
    const m = await setup()
    for (let i = 0; i < 3; i++) {
      await appendFile(m.logPath, kick)
      await m.poll()
      await vi.advanceTimersByTimeAsync(20_000)
      await m.poll()
      expect(m.state()).toBe('online')
      await vi.advanceTimersByTimeAsync(600_000)
    }
    await appendFile(m.logPath, kick)
    await m.poll()
    expect(m.state()).toBe('limited')
    expect(m.restart).toHaveBeenCalledTimes(3)
  })

  it('retains the cooldown when settings recreate the monitor', async () => {
    const m = await setup()
    await appendFile(m.logPath, kick)
    await m.poll()
    await vi.advanceTimersByTimeAsync(10_000)
    m.monitor.stop()
    const next = new NapcatRecovery({ qq: m.qq, logPath: m.logPath, enabled: true, restart: m.restart, probe: m.probe })
    monitors.push(next)
    await next.start()
    const internal = next as unknown as { timer: NodeJS.Timeout; poll(): Promise<void> }
    clearInterval(internal.timer)
    await appendFile(m.logPath, kick)
    await internal.poll()
    expect(m.state()).toBe('limited')
    expect(m.restart).toHaveBeenCalledTimes(1)
  })

  it('does not overlap probes or accept a late success after a fresh kick', async () => {
    const m = await setup()
    let resolveProbe!: () => void
    m.probe.mockImplementation(() => new Promise<void>(resolve => { resolveProbe = resolve }))
    await appendFile(m.logPath, kick)
    await m.poll()
    await vi.advanceTimersByTimeAsync(20_000)
    const polling = m.poll()
    await vi.waitFor(() => expect(m.probe).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(10_000)
    await appendFile(m.logPath, kick)
    await m.poll()
    expect(m.state()).toBe('needs-attention')
    resolveProbe()
    await polling
    expect(m.probe).toHaveBeenCalledTimes(1)
    expect(m.state()).toBe('needs-attention')
  })

  it('recognizes ANSI headers but not embedded error keywords', () => {
    expect(napcatLoginSignal('\x1b[31m' + kick.trimEnd() + '\x1b[0m')).toBe('kicked')
    expect(napcatLoginSignal('09-05 12:00:01 [info] Bot | 发送 -> 私聊 (123) [KickedOffLine]')).toBeUndefined()
    expect(napcatLoginSignal('09-05 12:00:01 [warn] Bot | onebot timeout')).toBeUndefined()
  })

  it('removes inherited passwords from the restart process', async () => {
    vi.useRealTimers()
    vi.stubEnv('NAPCAT_QUICK_PASSWORD', 'legacy-secret')
    vi.stubEnv('NAPCAT_QUICK_PASSWORD_MD5', 'legacy-hash')
    const env = napcatScanEnv()
    expect(env.NAPCAT_QUICK_PASSWORD).toBeUndefined()
    expect(env.NAPCAT_QUICK_PASSWORD_MD5).toBeUndefined()
    expect(process.env.NAPCAT_QUICK_PASSWORD).toBe('legacy-secret')
    const output = join(dir, 'child.json')
    await writeFile(join(dir, 'napcat'), `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({argv:process.argv.slice(2), password:process.env.NAPCAT_QUICK_PASSWORD, md5:process.env.NAPCAT_QUICK_PASSWORD_MD5}));\n`, { mode: 0o700 })
    vi.stubEnv('PATH', `${dir}:${process.env.PATH}`)
    await restartNapcatForScan(12345, new AbortController().signal)
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ argv: ['restart', '12345'] })
  })
})
