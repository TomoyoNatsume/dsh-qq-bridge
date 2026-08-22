import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectNapcatSettings, setupNapcatForSettings } from '../src/napcat-status.js'

describe('NapCat settings status probe', () => {
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
    })

    expect(status.state).toBe('ready')
    expect(status.onebot?.wsUrl).toBe('ws://127.0.0.1:3301')
    expect(status.onebot?.token).toBe('abcdef123456')
    expect(status.onebot?.tokenPreview).toBe('abcd...3456')
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
    expect(status.message).toContain('如果发送 "ping" 后没反应')
    expect(status.message).toContain('napcat log 10001')
    expect(server.enable).toBe(true)
    expect(server.host).toBe('127.0.0.1')
    expect(server.port).toBe(3001)
    expect(typeof server.token).toBe('string')
    expect(server.token.length).toBeGreaterThan(8)
    expect(status.onebot?.token).toBe(server.token)
  })
})

function fakeSpawn(options: {
  missing?: boolean
  statusOutput?: string
}): typeof import('node:child_process').spawnSync {
  return ((command: string, args?: readonly string[]) => {
    if (options.missing) return { error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }
    if (command === 'napcat' && args?.[0] === 'status') {
      return { status: 0, stdout: options.statusOutput ?? '', stderr: '' }
    }
    return { status: 0, stdout: 'napcat help', stderr: '' }
  }) as typeof import('node:child_process').spawnSync
}
