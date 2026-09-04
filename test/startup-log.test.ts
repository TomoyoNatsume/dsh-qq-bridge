import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('dsh-qq-bridge startup log', () => {
  it('prints only the concise Web UI configuration guidance on the normal startup path', async () => {
    const plugin = await readFile(join(process.cwd(), 'src', 'plugin.ts'), 'utf8')
    const settings = await readFile(join(process.cwd(), 'src', 'settings.ts'), 'utf8')

    expect(plugin).toContain("console.info('请到Web UI的设置中配置<QQ bridge>')")
    expect(plugin).not.toContain('QQ bridge is not enabled or is missing required settings')
    expect(plugin).not.toContain('QQ bridge started from saved settings')
    expect(plugin).not.toContain('official QQ agent reply notifications are disabled by default')
    expect(plugin).not.toContain("officialMode ? buildOfficialConnectGuidance(cfg, err) : buildConnectGuidance(cfg, err)")
    expect(settings).not.toContain('removed legacy profile insert from')
  })

  it('does not repeatedly print OneBot connection failures while retrying', async () => {
    const client = await readFile(join(process.cwd(), 'src', 'onebot', 'client.ts'), 'utf8')

    expect(client).not.toContain('onebot ws-error')
    expect(client).not.toContain('onebot ws closed')
    expect(client).not.toContain("handleError('ws-error'")
  })
})
