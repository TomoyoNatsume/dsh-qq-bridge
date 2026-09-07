import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installQqBridgeSettings } from '../src/settings.js'
import { DshQqBridgeConfig } from '../src/config.js'

describe('QQ bridge settings runtime wiring', () => {
  const previousDshHome = process.env.DSH_HOME

  afterEach(() => {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  })

  it('applies the saved settings snapshot as soon as the settings service attaches', async () => {
    process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-settings-runtime-'))
    const entry = DshQqBridgeConfig.parse({})
    const saved = DshQqBridgeConfig.parse({
      enabled: true,
      platform: 'napcat',
      napcat: {
        loginQq: 554616801,
        wsUrl: 'ws://127.0.0.1:3001',
        token: 'token-from-settings',
      },
      access: {
        adminQq: 3678586949,
        mode: 'whitelist',
        allowlist: [],
        commandPrefix: '',
      },
    })
    const applied: DshQqBridgeConfig[] = []
    const ctx = {
      inject(services: readonly string[], cb: (child: unknown) => void) {
        if (services.includes('settings')) {
          cb({
            settings: {
              register() {
                return {
                  get: () => saved,
                  watch: () => () => {},
                }
              },
            },
            effect: () => {},
          })
        }
        return { dispose() {} }
      },
    }

    await installQqBridgeSettings(ctx, entry, (next) => {
      applied.push(next)
    })

    expect(applied).toHaveLength(1)
    expect(applied[0].enabled).toBe(true)
    expect(applied[0].napcat.token).toBe('token-from-settings')
    expect(applied[0].napcat).not.toHaveProperty('selfKeepAlive')
  })
})
