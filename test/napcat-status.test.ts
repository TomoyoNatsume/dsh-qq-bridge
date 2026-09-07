import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectNapcatSettings, setupNapcatForSettings } from '../src/napcat-status.js'

describe('NapCat settings status probe', () => {
  it('defines login status as OneBot server connectivity rather than a self-message action', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'napcat-status.ts'), 'utf8')

    expect(source).toContain("ws.once('open', () => finish('logged-in'))")
    expect(source).toContain("setTimeout(() => finish('not-logged-in'), 2500)")
    expect(source).not.toContain("action: 'send_private_msg'")
  })

  it('reports install guidance when napcat cli is absent', async () => {
    const status = await inspectNapcatSettings({
      spawn: fakeSpawn({ missing: true }),
    })

    expect(status.state).toBe('not-installed')
    expect(status.installed).toBe(false)
    expect(status.commands.join('\n')).toContain('bash napcat.sh --docker n --cli y')
  })

  it('asks for admin QQ before checking account runtime', async () => {
    const status = await inspectNapcatSettings({
      spawn: fakeSpawn({ statusOutput: 'running online' }),
    })

    expect(status.state).toBe('needs-admin')
    expect(status.installed).toBe(true)
  })

  it('reports a start command when napcat is not running', async () => {
    const status = await inspectNapcatSettings({
      adminQq: '10001',
      spawn: fakeSpawn({ statusOutput: 'not running' }),
    })

    expect(status.state).toBe('not-running')
    expect(status.commands).toContain('napcat start 10001')
  })

  it('returns readonly OneBot websocket data when napcat is ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-napcat-ready-'))
    await mkdir(join(root, 'log'), { recursive: true })
    await writeFile(join(root, 'log', 'napcat_10001.log'), 'login ok\n', 'utf8')
    const configDir = join(root, 'opt', 'QQ', 'resources', 'app', 'app_launcher', 'napcat', 'config')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'onebot11_10001.json'), JSON.stringify({
      network: {
        websocketServers: [{
          enable: true,
          host: '127.0.0.1',
          port: 3301,
          token: 'abcdef123456',
        }],
      },
    }), 'utf8')

    const status = await inspectNapcatSettings({
      adminQq: '10001',
      rootPath: root,
      spawn: fakeSpawn({ statusOutput: 'running online' }),
      serverConnectivityProbe: async () => 'logged-in',
    })

    expect(status.state).toBe('ready')
    expect(status.onebot?.wsUrl).toBe('ws://127.0.0.1:3301')
    expect(status.onebot?.token).toBe('abcdef123456')
    expect(status.onebot?.tokenPreview).toBe('abcd...3456')
    expect(status.login).toBe('logged-in')
  })

  it('refreshes login health through a server-connectivity probe for the configured QQ', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-napcat-login-refresh-'))
    const configDir = join(root, 'opt', 'QQ', 'resources', 'app', 'app_launcher', 'napcat', 'config')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'onebot11_10001.json'), JSON.stringify({
      network: {
        websocketServers: [{ enable: true, host: '127.0.0.1', port: 3001, token: 'secret' }],
      },
    }), 'utf8')
    let probedQq = 0

    const status = await inspectNapcatSettings({
      adminQq: '10001',
      rootPath: root,
      spawn: fakeSpawn({ statusOutput: 'running' }),
      serverConnectivityProbe: async (_onebot, expectedQq) => {
        probedQq = expectedQq
        return 'not-logged-in'
      },
    })

    expect(probedQq).toBe(10001)
    expect(status.runtime).toBe('running')
    expect(status.login).toBe('not-logged-in')
  })

  it('sets up OneBot config when saving settings without checking login', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-napcat-setup-'))
    await mkdir(join(root, 'log'), { recursive: true })
    const configDir = join(root, 'opt', 'QQ', 'resources', 'app', 'app_launcher', 'napcat', 'config')
    await mkdir(configDir, { recursive: true })
    const configPath = join(configDir, 'onebot11_10001.json')
    await writeFile(configPath, JSON.stringify({
      network: {
        websocketServers: [{
          enable: false,
          host: '0.0.0.0',
          port: 8080,
          token: '',
        }],
      },
    }), 'utf8')

    const status = await setupNapcatForSettings({
      adminQq: '10001',
      rootPath: root,
      spawn: fakeSpawn({ statusOutput: 'running qrcode required' }),
    })
    const written = JSON.parse(await readFile(configPath, 'utf8'))
    const server = written.network.websocketServers[0]

    expect(status.state).toBe('ready')
    expect(status.login).toBe('not-logged-in')
    expect(status.message.split('\n')).toEqual(expect.arrayContaining([
      '已启动 NapCat 进程，请打开 NapCat 日志文件',
      join(root, 'log', 'napcat_10001.log'),
      '或执行',
      'napcat log 10001',
      '查看日志，确保已经扫码登陆。',
    ]))
    expect(status.message).toContain('已启动 NapCat 进程')
    expect(status.message).toContain('打开 NapCat 日志文件')
    expect(status.message).toContain('napcat log 10001')
    expect(status.message).toContain('确保已经扫码登陆')
    expect(server.enable).toBe(true)
    expect(server.host).toBe('127.0.0.1')
    expect(server.port).toBe(3001)
    expect(typeof server.token).toBe('string')
    expect(server.token.length).toBeGreaterThan(8)
    expect(status.onebot?.token).toBe(server.token)
  })

  it('stops existing NapCat instances before starting a new QQ', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-napcat-autostart-'))
    await mkdir(join(root, 'log'), { recursive: true })
    const stopArgs: string[] = []
    let started = false
    let restarted = false
    const configDir = join(root, 'opt', 'QQ', 'resources', 'app', 'app_launcher', 'napcat', 'config')
    const configPath = join(configDir, 'onebot11_10001.json')

    const status = await setupNapcatForSettings({
      adminQq: '10001',
      rootPath: root,
      spawn: fakeSpawn({
        statusOutput: () => started
          ? '检测到 1 个正在运行的 Napcat 实例:\n\n- 运行中: QQ 10001 (PID: 2048)'
          : '检测到 1 个正在运行的 Napcat 实例:\n\n- 运行中: QQ 554616801 (PID: 1028)',
        onStop: (qq) => {
          stopArgs.push(qq)
        },
        onStart: () => {
          started = true
          mkdirSync(configDir, { recursive: true })
          writeFileSync(configPath, JSON.stringify({}), 'utf8')
        },
        onRestart: () => {
          restarted = true
        },
      }),
      onebotConfigWaitMs: 10,
      onebotConfigRetryIntervalMs: 1,
    })
    const written = JSON.parse(await readFile(configPath, 'utf8'))
    const server = written.network.websocketServers[0]

    expect(stopArgs).toEqual(['554616801'])
    expect(started).toBe(true)
    expect(restarted).toBe(true)
    expect(status.state).toBe('ready')
    expect(status.napcatStoppedQqs).toEqual([554616801])
    expect(status.napcatStarted).toBe(true)
    expect(status.message).toContain('已执行 napcat stop 554616801，并执行 napcat start 10001')
    expect(server.enable).toBe(true)
    expect(server.host).toBe('127.0.0.1')
    expect(server.port).toBe(3001)
  })

  it('retries start after direct stop when the first start reports another QQ', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-napcat-start-retry-'))
    await mkdir(join(root, 'log'), { recursive: true })
    const stopArgs: string[] = []
    let startCount = 0
    const configDir = join(root, 'opt', 'QQ', 'resources', 'app', 'app_launcher', 'napcat', 'config')
    const configPath = join(configDir, 'onebot11_43214123.json')

    const status = await setupNapcatForSettings({
      adminQq: '43214123',
      rootPath: root,
      spawn: fakeSpawn({
        statusOutput: '没有 Napcat 服务正在运行。',
        startStatus: () => startCount === 1 ? 1 : 0,
        startOutput: () => startCount === 1
          ? [
              '\u001b[0;1;31;91m错误：检测到正在运行的 Napcat 实例。禁止多开。\u001b[0m',
              '\u001b[0;1;33;93m - PID: 1028, QQ: 554616801\u001b[0m',
              "\u001b[0;1;33;93m请先使用 'napcat stop' 停止所有实例。\u001b[0m",
            ].join('')
          : 'started',
        onStop: (qq) => {
          stopArgs.push(qq)
        },
        onStart: () => {
          startCount += 1
          if (startCount === 2) {
            mkdirSync(configDir, { recursive: true })
            writeFileSync(configPath, JSON.stringify({}), 'utf8')
          }
        },
      }),
      onebotConfigWaitMs: 10,
      onebotConfigRetryIntervalMs: 1,
    })

    expect(startCount).toBe(2)
    expect(stopArgs).toEqual(['554616801'])
    expect(status.napcatStoppedQqs).toEqual([554616801])
    expect(status.napcatStarted).toBe(true)
  })

  it('stops all NapCat instances and retries when a failed start omits the blocking QQ', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-napcat-start-retry-all-'))
    await mkdir(join(root, 'log'), { recursive: true })
    const stopArgs: string[] = []
    let startCount = 0
    const configDir = join(root, 'opt', 'QQ', 'resources', 'app', 'app_launcher', 'napcat', 'config')
    const configPath = join(configDir, 'onebot11_32412341.json')

    const status = await setupNapcatForSettings({
      adminQq: '32412341',
      rootPath: root,
      spawn: fakeSpawn({
        statusOutput: '没有 Napcat 服务正在运行。',
        startStatus: () => startCount === 1 ? 1 : 0,
        startOutput: () => startCount === 1
          ? '错误：检测到正在运行的 Napcat 实例。禁止多开。'
          : 'started',
        onStop: (qq) => {
          stopArgs.push(qq)
        },
        onStart: () => {
          startCount += 1
          if (startCount === 2) {
            mkdirSync(configDir, { recursive: true })
            writeFileSync(configPath, JSON.stringify({}), 'utf8')
          }
        },
      }),
      onebotConfigWaitMs: 10,
      onebotConfigRetryIntervalMs: 1,
    })

    expect(startCount).toBe(2)
    expect(stopArgs).toEqual([''])
    expect(status.napcatStarted).toBe(true)
  })

  it('restarts the target QQ when that same NapCat service is already running', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-napcat-restart-current-'))
    const configDir = join(root, 'opt', 'QQ', 'resources', 'app', 'app_launcher', 'napcat', 'config')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'onebot11_10001.json'), JSON.stringify({
      network: { websocketServers: [{ enable: true, host: '127.0.0.1', port: 3001, token: 'secret' }] },
    }), 'utf8')
    let restartCount = 0

    const status = await setupNapcatForSettings({
      adminQq: '10001',
      rootPath: root,
      spawn: fakeSpawn({
        statusOutput: '检测到 1 个正在运行的 Napcat 实例:\n- 运行中: QQ 10001 (PID: 2048)\n二维码等待扫码',
        onRestart: () => { restartCount += 1 },
      }),
    })

    expect(restartCount).toBe(1)
    expect(status.napcatStarted).toBe(false)
    expect(status.napcatRestarted).toBe(true)
    expect(status.login).toBe('not-logged-in')
  })

  it('restarts an existing background QQ even when targeted status says stopped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'napcat-background-'))
    const configDir = join(root, 'opt', 'QQ', 'resources', 'app', 'app_launcher', 'napcat', 'config')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'onebot11_10001.json'), JSON.stringify({ network: { websocketServers: [{ enable: true, host: '127.0.0.1', port: 3001, token: 'secret' }] } }))
    const actions: string[] = []
    const status = await setupNapcatForSettings({ adminQq: '10001', rootPath: root,
      spawn: ((command: string, args: string[]) => {
        if (args[0] === 'start' || args[0] === 'restart') actions.push(args[0])
        return { status: 0, stdout: args[0] === 'status' ? (args.length === 1 ? '运行中: QQ 10001 (PID: 2048)' : 'not running') : 'ok', stderr: '' }
      }) as any,
    })
    expect(actions).toEqual(['restart'])
    expect(status.napcatStarted).toBe(false)
  })

  it('reports a friendly message when the QQ onebot config file is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-napcat-missing-config-'))
    await mkdir(join(root, 'log'), { recursive: true })

    try {
      await setupNapcatForSettings({
        adminQq: '432141235',
        rootPath: root,
        spawn: fakeSpawn({ statusOutput: 'running online' }),
      })
      throw new Error('expected setup to fail')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message.split('\n')).toEqual([
        '已启动 NapCat 进程，请打开 NapCat 日志文件',
        join(root, 'log', 'napcat_432141235.log'),
        '或执行',
        'napcat log 432141235',
        '查看日志，扫码登陆。',
      ])
      expect(message).toContain('已启动 NapCat 进程')
      expect(message).toContain('打开 NapCat 日志文件')
      expect(message).toContain('扫码登陆')
      expect(message).toContain('napcat log 432141235')
      expect(message).not.toContain('尚未找到该 QQ 的 NapCat OneBot 配置文件')
      expect(message).not.toContain('路径:')
      expect(message).not.toContain('排查命令')
      expect(message).not.toContain('napcat status 432141235')
      expect(message).not.toContain('ENOENT')
      expect(message).not.toContain('open ')
    }
  })
})

function fakeSpawn(options: {
  missing?: boolean
  statusOutput?: string | (() => string)
  startStatus?: number | (() => number)
  startOutput?: string | (() => string)
  onStop?: (qq: string) => void
  onStart?: (qq: string) => void
  onRestart?: () => void
}): typeof import('node:child_process').spawnSync {
  return ((command: string, args?: readonly string[]) => {
    if (options.missing) return { error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }
    if (command === 'napcat' && args?.[0] === 'status') {
      const output = typeof options.statusOutput === 'function' ? options.statusOutput() : options.statusOutput
      return { status: 0, stdout: output ?? '', stderr: '' }
    }
    if (command === 'napcat' && args?.[0] === 'start') {
      options.onStart?.(String(args[1] ?? ''))
      const status = typeof options.startStatus === 'function' ? options.startStatus() : options.startStatus
      const output = typeof options.startOutput === 'function' ? options.startOutput() : options.startOutput
      return { status: status ?? 0, stdout: status === undefined || status === 0 ? output ?? 'started' : '', stderr: status !== undefined && status !== 0 ? output ?? '' : '' }
    }
    if (command === 'napcat' && args?.[0] === 'stop') {
      options.onStop?.(String(args[1] ?? ''))
      return { status: 0, stdout: 'stopped', stderr: '' }
    }
    if (command === 'napcat' && args?.[0] === 'restart') {
      options.onRestart?.()
      return { status: 0, stdout: 'restarted', stderr: '' }
    }
    return { status: 0, stdout: 'napcat help', stderr: '' }
  }) as typeof import('node:child_process').spawnSync
}
