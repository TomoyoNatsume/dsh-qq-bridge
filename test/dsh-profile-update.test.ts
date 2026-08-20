import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildBridgeInsertItem,
  buildOfficialBridgeInsertItem,
  updateProfilePatch,
  updateSetupProfilePatch,
  writeProfilePatchWithBackup,
} from '../src/cli/dsh-profile.js'
import { updatePermissionDefaultPreset, writeSettingsWithBackup } from '../src/cli/dsh-settings.js'

const item = buildBridgeInsertItem(itemConfig())

describe('setup profile patch updater', () => {
  it('writes the onebot token as a quoted yaml string', () => {
    const quoted = buildBridgeInsertItem({
      ...itemConfig(),
      token: 'abc:def"ghi',
    })

    expect(quoted).toContain('token: "abc:def\\"ghi"')
    expect(quoted).not.toContain('process.env.DSH_QQ_TOKEN')
  })

  it('writes sender qq as adminQq when self log mode is disabled', () => {
    const dualAccount = buildBridgeInsertItem({
      ...itemConfig(),
      adminQq: 20002,
      selfLogEnabled: false,
      selfLogPath: '/home/me/Napcat/log/napcat_10001.log',
    })

    expect(dualAccount).toContain('adminQq: 20002')
    expect(dualAccount).toContain('selfLogInput:\n          enabled: false')
    expect(dualAccount).toContain('qqMessageStyle:\n            enabled: true')
    expect(dualAccount).toContain('不要写入记忆系统')
    expect(dualAccount).not.toContain('napcat_10001.log')
  })

  it('writes official QQ Bot config with the paired admin openid', () => {
    const official = buildOfficialBridgeInsertItem({
      pluginName: '/tmp/dsh-qq-bridge/dist/index.js',
      appId: 'app:id',
      appSecret: 'secret"value',
      adminOpenId: 'admin-openid',
      allowlistOpenIds: [],
      sandbox: true,
      commandPrefix: '/dsh',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })

    expect(official).toContain('platform: official')
    expect(official).toContain('appId: "app:id"')
    expect(official).toContain('appSecret: "secret\\"value"')
    expect(official).toContain('adminOpenId: "admin-openid"')
    expect(official).toContain('sandbox: true')
    expect(official).toContain('notifications:\n          agentReply:\n            enabled: false')
    expect(official).toContain('adminQq: 0')
    expect(official).toContain('qqMessageStyle:\n            enabled: true')
    expect(official).toContain('不要影响其它 DSH 对话')
  })

  it('replaces only existing dsh-qq-bridge insert item', () => {
    const before = [
      '- id: hmr',
      '  disabled: false',
      '',
      '- insert:',
      '    - id: other-plugin',
      '      name: other',
      '      config:',
      '        keep: true',
      '    - id: dsh-qq-bridge',
      '      name: old',
      '      config:',
      '        old: true',
      '    - id: after-plugin',
      '      name: after',
      '',
      '- id: tail',
      '  config:',
      '    untouched: true',
      '',
    ].join('\n')

    const result = updateProfilePatch(before, item)

    expect(result.action).toBe('replaced')
    expect(result.content).toContain('    - id: other-plugin\n      name: other')
    expect(result.content).toContain('    - id: after-plugin\n      name: after')
    expect(result.content).toContain('- id: tail\n  config:\n    untouched: true')
    expect(result.content).toContain('model: deepseek-v4-pro')
    expect(result.content).toContain('token: "keep-token"')
    expect(result.content).not.toContain('DSH_QQ_TOKEN')
    expect(result.content).not.toContain('old: true')
  })

  it('adds bridge item under existing insert without touching siblings', () => {
    const before = [
      '- insert:',
      '    - id: other-plugin',
      '      name: other',
      '- id: tail',
      '  disabled: false',
      '',
    ].join('\n')

    const result = updateProfilePatch(before, item)

    expect(result.action).toBe('added')
    expect(result.content).toContain('    - id: other-plugin')
    expect(result.content.indexOf('    - id: dsh-qq-bridge')).toBeGreaterThan(result.content.indexOf('    - id: other-plugin'))
    expect(result.content).toContain('- id: tail\n  disabled: false')
  })

  it('does not replace a top-level dsh-qq-bridge entry outside insert', () => {
    const before = [
      '- id: dsh-qq-bridge',
      '  name: top-level-entry',
      '',
      '- insert:',
      '    - id: other-plugin',
      '      name: other',
      '',
    ].join('\n')

    const result = updateProfilePatch(before, item)

    expect(result.action).toBe('added')
    expect(result.content).toContain('- id: dsh-qq-bridge\n  name: top-level-entry')
    expect(result.content).toContain('    - id: other-plugin\n      name: other')
    expect(result.content).toContain('    - id: dsh-qq-bridge\n      name: /tmp/dsh-qq-bridge/dist/index.js')
  })

  it('appends a new insert block when no insert exists', () => {
    const before = [
      '- id: existing-top-level',
      '  config:',
      '    keep: true',
      '',
    ].join('\n')

    const result = updateProfilePatch(before, item)

    expect(result.action).toBe('added')
    expect(result.content).toContain('- id: existing-top-level\n  config:\n    keep: true')
    expect(result.content).toContain('- insert:\n    - id: dsh-qq-bridge')
  })

  it('replaces [] with a valid insert patch', () => {
    const result = updateProfilePatch('[]\n', item)

    expect(result.content.startsWith('- insert:\n    - id: dsh-qq-bridge')).toBe(true)
    expect(result.content.startsWith('[]')).toBe(false)
  })

  it('writes a single fixed profile backup that is replaced by the next setup write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-profile-'))
    const profilePath = join(dir, 'profile', 'cordis.patch.yml')
    const backupPath = join(dir, 'tool', 'backups', 'cordis.patch.yml.bak')
    await mkdir(join(dir, 'profile'), { recursive: true })
    await writeFile(profilePath, 'first\n', 'utf8')

    await expect(writeProfilePatchWithBackup(profilePath, 'second\n', backupPath)).resolves.toBe(backupPath)
    expect(await readFile(profilePath, 'utf8')).toBe('second\n')
    expect(await readFile(backupPath, 'utf8')).toBe('first\n')

    await expect(writeProfilePatchWithBackup(profilePath, 'third\n', backupPath)).resolves.toBe(backupPath)
    expect(await readFile(profilePath, 'utf8')).toBe('third\n')
    expect(await readFile(backupPath, 'utf8')).toBe('second\n')
    expect(await readdir(join(dir, 'tool', 'backups'))).toEqual(['cordis.patch.yml.bak'])
  })

  it('does not add a duplicate permission loader entry', () => {
    const result = updateSetupProfilePatch('[]\n', item)

    expect(result.content).toContain('    - id: dsh-qq-bridge')
    expect(result.content).not.toContain('    - id: permission')
  })

  it('removes the duplicate permission loader entry written by older setup versions', () => {
    const before = [
      '- insert:',
      '    - id: permission',
      "      name: '@deepseek-ai/dsh-permission-presets'",
      '      config:',
      '        defaultPreset: danger-full-access',
      '    - id: other-plugin',
      '      name: other',
      '',
    ].join('\n')

    const result = updateSetupProfilePatch(before, item)

    expect(result.action).toBe('replaced')
    expect(result.content).toContain('    - id: dsh-qq-bridge')
    expect(result.content).toContain('    - id: other-plugin\n      name: other')
    expect(result.content).not.toContain('    - id: permission')
  })

  it('writes permission defaultPreset into settings.yaml', () => {
    const result = updatePermissionDefaultPreset('')

    expect(result.content).toBe('permission:\n  defaultPreset: danger-full-access\n')
  })

  it('writes the selected permission defaultPreset into settings.yaml', () => {
    const result = updatePermissionDefaultPreset('', 'workspace-write')

    expect(result.content).toBe('permission:\n  defaultPreset: workspace-write\n')
  })

  it('updates only permission defaultPreset in settings.yaml', () => {
    const before = [
      'models:',
      '  keep: true',
      '',
      'permission:',
      '  defaultPreset: workspace-write',
      '  other: keep-me',
      '',
    ].join('\n')

    const result = updatePermissionDefaultPreset(before)

    expect(result.content).toContain('models:\n  keep: true')
    expect(result.content).toContain('permission:\n  defaultPreset: danger-full-access\n  other: keep-me')
    expect(result.content).not.toContain('defaultPreset: workspace-write')
  })

  it('writes a single fixed settings backup that is replaced by the next setup write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-qq-bridge-settings-'))
    const settingsPath = join(dir, 'home', 'settings.yaml')
    const backupPath = join(dir, 'tool', 'backups', 'settings.yaml.bak')
    await mkdir(join(dir, 'home'), { recursive: true })
    await writeFile(settingsPath, 'permission:\n  defaultPreset: old\n', 'utf8')

    await expect(writeSettingsWithBackup(settingsPath, 'permission:\n  defaultPreset: new\n', backupPath)).resolves.toBe(backupPath)
    expect(await readFile(settingsPath, 'utf8')).toBe('permission:\n  defaultPreset: new\n')
    expect(await readFile(backupPath, 'utf8')).toBe('permission:\n  defaultPreset: old\n')

    await expect(writeSettingsWithBackup(settingsPath, 'permission:\n  defaultPreset: next\n', backupPath)).resolves.toBe(backupPath)
    expect(await readFile(settingsPath, 'utf8')).toBe('permission:\n  defaultPreset: next\n')
    expect(await readFile(backupPath, 'utf8')).toBe('permission:\n  defaultPreset: new\n')
    expect(await readdir(join(dir, 'tool', 'backups'))).toEqual(['settings.yaml.bak'])
  })
})

function itemConfig() {
  return {
    pluginName: '/tmp/dsh-qq-bridge/dist/index.js',
    wsUrl: 'ws://127.0.0.1:3001',
    token: 'keep-token',
    adminQq: 10001,
    commandPrefix: '/dsh',
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    selfLogEnabled: true,
    selfLogPath: '/home/me/Napcat/log/napcat_10001.log',
  }
}
