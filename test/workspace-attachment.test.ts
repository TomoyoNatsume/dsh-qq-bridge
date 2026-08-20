import { describe, expect, it, vi } from 'vitest'
import { attachSessionToWorkspace, DshWorkspaceRegistry } from '../src/plugin.js'

describe('workspace attachment', () => {
  it('creates or resolves the cwd workspace and attaches the session', async () => {
    const attachSession = vi.fn(async () => {})
    const create = vi.fn(async () => ({ id: 'workspace-1', attachSession }))
    const registry: DshWorkspaceRegistry = { create }

    await attachSessionToWorkspace(registry, 'qq-session-1', '/home/me/work')

    expect(create).toHaveBeenCalledWith('/home/me/work')
    expect(attachSession).toHaveBeenCalledWith('qq-session-1')
  })

  it('logs and continues when workspace attachment fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const registry: DshWorkspaceRegistry = {
      async create() {
        throw new Error('workspace unavailable')
      },
    }

    await expect(attachSessionToWorkspace(registry, 'qq-session-1', '/missing')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('workspace unavailable'))
    warn.mockRestore()
  })
})
