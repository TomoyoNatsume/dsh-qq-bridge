import { describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import {
  canAcceptUserConfirmedLogin,
  classifyNapcatLogin,
  classifyNapcatLogPaths,
  classifyNapcatRuntime,
  defaultNapcatLogDir,
  defaultNapcatLogPath,
  defaultOnebotConfigPath,
  extractRunningNapcatQqs,
  updateOnebotConfig,
  waitForOnebotWsEndpoint,
} from '../src/cli/napcat.js'

describe('setup NapCat OneBot config updater', () => {
  it('preserves an existing token while enabling localhost websocket', () => {
    const raw = JSON.stringify({
      network: {
        websocketServers: [{
          enable: false,
          name: 'old',
          host: '0.0.0.0',
          port: 6000,
          token: 'keep-me',
        }],
      },
    })

    const result = updateOnebotConfig(raw)
    const json = JSON.parse(result.content)
    const server = json.network.websocketServers[0]

    expect(result.token).toBe('keep-me')
    expect(server.enable).toBe(true)
    expect(server.host).toBe('127.0.0.1')
    expect(server.port).toBe(3001)
    expect(server.token).toBe('keep-me')
  })

  it('creates a websocket server and token when absent', () => {
    const result = updateOnebotConfig('{}')
    const json = JSON.parse(result.content)
    const server = json.network.websocketServers[0]

    expect(server.enable).toBe(true)
    expect(server.host).toBe('127.0.0.1')
    expect(server.port).toBe(3001)
    expect(typeof server.token).toBe('string')
    expect(server.token.length).toBeGreaterThanOrEqual(16)
  })

  it('fails cleanly for unsupported websocket server shape', () => {
    expect(() => updateOnebotConfig(JSON.stringify({
      network: { websocketServers: ['bad'] },
    }))).toThrow(/server entry/)
  })

  it('checks a local OneBot websocket endpoint with bearer token', async () => {
    let authorization: string | undefined
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    server.on('connection', (socket, req) => {
      authorization = req.headers.authorization
      socket.close()
    })
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (typeof address === 'string' || address === null) throw new Error('expected tcp address')

    const result = await waitForOnebotWsEndpoint({
      wsUrl: `ws://127.0.0.1:${address.port}`,
      token: 'secret-token',
      timeoutMs: 1000,
      retryIntervalMs: 50,
    })

    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve())
    })
    expect(result.ok).toBe(true)
    expect(authorization).toBe('Bearer secret-token')
  })
})

describe('setup NapCat environment classifier', () => {
  it('builds NapCat paths from a custom root directory', () => {
    expect(defaultNapcatLogDir('/opt/Napcat')).toBe('/opt/Napcat/log')
    expect(defaultNapcatLogPath(10001, '/opt/Napcat')).toBe('/opt/Napcat/log/napcat_10001.log')
    expect(defaultOnebotConfigPath(10001, '/opt/Napcat')).toBe(
      '/opt/Napcat/opt/QQ/resources/app/app_launcher/napcat/config/onebot11_10001.json',
    )
  })

  it('detects running status from common status output', () => {
    expect(classifyNapcatRuntime(0, 'NapCat is running, pid=1234')).toBe('running')
    expect(classifyNapcatRuntime(0, 'NapCat 运行中')).toBe('running')
  })

  it('only treats the requested QQ as running when status lists running accounts', () => {
    const output = [
      '检测到 1 个正在运行的 Napcat 实例:',
      '',
      '- 运行中: QQ 554616801 (PID: 1028)',
    ].join('\n')

    expect(extractRunningNapcatQqs(output)).toEqual(['554616801'])
    expect(classifyNapcatRuntime(0, output, 554616801)).toBe('running')
    expect(classifyNapcatRuntime(0, output, 4124124)).toBe('not-running')
  })

  it('extracts running QQ from NapCat multi-instance start errors', () => {
    const output = [
      '\u001b[0;1;31;91m错误：检测到正在运行的 Napcat 实例。禁止多开。\u001b[0m',
      '\u001b[0;1;33;93m - PID: 1028, QQ: 554616801\u001b[0m',
      "\u001b[0;1;33;93m请先使用 'napcat stop' 停止所有实例。\u001b[0m",
    ].join('')

    expect(extractRunningNapcatQqs(output)).toEqual(['554616801'])
    expect(classifyNapcatRuntime(1, output, 43214123)).toBe('not-running')
  })

  it('treats a NapCat instance listing without the requested QQ as not running even when parsing is sparse', () => {
    const output = [
      '检测到 1 个正在运行的 Napcat 实例:',
      '',
      '- 运行中: 当前账号暂不可见 (PID: 1028)',
    ].join('\n')

    expect(extractRunningNapcatQqs(output)).toEqual([])
    expect(classifyNapcatRuntime(0, output, 4124124)).toBe('not-running')
  })

  it('detects not-running status and non-zero fallback', () => {
    expect(classifyNapcatRuntime(0, 'NapCat not running')).toBe('not-running')
    expect(classifyNapcatRuntime(0, '\u001b[0;1;31;91m没有 Napcat 服务正在运行。\u001b[0m', 4124124)).toBe('not-running')
    expect(classifyNapcatRuntime(1, '')).toBe('not-running')
  })

  it('detects login hints from status output without reading logs', () => {
    expect(classifyNapcatLogin('需要扫码登录, qrcode generated')).toBe('not-logged-in')
    expect(classifyNapcatLogin('login success, online')).toBe('logged-in')
    expect(classifyNapcatLogin('running')).toBe('unknown')
  })

  it('classifies NapCat log path states', () => {
    expect(classifyNapcatLogPaths({
      rootExists: false,
      logDirExists: false,
      accountLogExists: false,
    })).toBe('missing-root')
    expect(classifyNapcatLogPaths({
      rootExists: true,
      logDirExists: false,
      accountLogExists: false,
    })).toBe('missing-log-dir')
    expect(classifyNapcatLogPaths({
      rootExists: true,
      logDirExists: true,
      accountLogExists: false,
    })).toBe('missing-account-log')
    expect(classifyNapcatLogPaths({
      rootExists: true,
      logDirExists: true,
      accountLogExists: true,
    })).toBe('ready')
  })

  it('accepts user-confirmed login when status is running but login output is ambiguous', () => {
    expect(canAcceptUserConfirmedLogin({
      runtime: 'running',
      login: 'unknown',
      logState: 'ready',
    })).toBe(true)
  })

  it('does not accept confirmation when status explicitly says not logged in', () => {
    expect(canAcceptUserConfirmedLogin({
      runtime: 'running',
      login: 'not-logged-in',
      logState: 'ready',
    })).toBe(false)
  })

  it('does not accept confirmation when NapCat is not running or account log is missing', () => {
    expect(canAcceptUserConfirmedLogin({
      runtime: 'not-running',
      login: 'unknown',
      logState: 'ready',
    })).toBe(false)
    expect(canAcceptUserConfirmedLogin({
      runtime: 'running',
      login: 'unknown',
      logState: 'missing-account-log',
    })).toBe(false)
  })
})
