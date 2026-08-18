import { describe, expect, it } from 'vitest'
import { buildBridgeInsertItem, updateProfilePatch, updateSetupProfilePatch } from '../src/cli/dsh-profile.js'
import { updatePermissionDefaultPreset } from '../src/cli/dsh-settings.js'

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
    expect(dualAccount).not.toContain('napcat_10001.log')
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
