import { describe, expect, it } from 'vitest'
import { napcatCliInstallGuide } from '../src/cli/setup.js'

describe('setup NapCat preflight', () => {
  it('prints a self-service NapCat CLI installation guide', () => {
    const guide = napcatCliInstallGuide()

    expect(guide).toContain('未检测到 NapCat CLI')
    expect(guide).toContain('curl -o napcat.sh https://raw.githubusercontent.com/NapNeko/NapCat-Installer/main/script/install.sh')
    expect(guide).toContain('bash napcat.sh --docker n --cli y')
    expect(guide).toContain('napcat help')
    expect(guide).toContain('pnpm exec dsh-qq-bridge setup')
    expect(guide).toContain('腾讯官方 QQ Bot')
  })
})
