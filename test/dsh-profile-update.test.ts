import { describe, expect, it } from 'vitest'
import { buildBridgeInsertItem, updateProfilePatch } from '../src/cli/dsh-profile.js'

const item = buildBridgeInsertItem({
  pluginName: '/tmp/dsh-qq-bridge/dist/index.js',
  wsUrl: 'ws://127.0.0.1:3001',
  adminQq: 10001,
  commandPrefix: '/dsh',
  provider: 'deepseek-official',
  model: 'deepseek-v4-pro',
  selfLogEnabled: true,
  selfLogPath: '/home/me/Napcat/log/napcat_10001.log',
})

describe('setup profile patch updater', () => {
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
})
