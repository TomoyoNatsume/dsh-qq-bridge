import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createSetCwdControlHandler,
  createSetModelControlHandler,
  createSetPermissionControlHandler,
  createSetReasoningEffortControlHandler,
  parseQqControlBlocks,
  QqControlDispatcher,
} from '../src/handlers/control.js'

describe('QQ control blocks', () => {
  it('extracts JSON actions and hides control text from the visible reply', () => {
    const parsed = parseQqControlBlocks([
      '稍等',
      '<dsh-qq-bridge-control>{"action":"set_cwd","path":"~/project"}</dsh-qq-bridge-control>',
      '已处理',
    ].join('\n'))

    expect(parsed.visibleText).toBe('稍等\n\n已处理')
    expect(parsed.actions).toEqual([{ action: 'set_cwd', path: '~/project' }])
    expect(parsed.errors).toEqual([])
  })

  it('reports malformed blocks without throwing', () => {
    const parsed = parseQqControlBlocks('<dsh-qq-bridge-control>{bad</dsh-qq-bridge-control>')

    expect(parsed.visibleText).toBe('')
    expect(parsed.actions).toEqual([])
    expect(parsed.errors[0]).toContain('JSON 解析失败')
  })

  it('dispatches set_cwd through the shared directory switcher', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-qq-control-'))
    await mkdir(join(root, 'next'))
    const setCwd = vi.fn(async () => {})
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createSetCwdControlHandler({
      getCwd: () => root,
      setCwd,
    }))

    const message = await dispatcher.dispatch(
      { action: 'set_cwd', path: 'next' },
      {
        sessionKey: 'private:10001',
        source: {
          userId: 10001,
          scope: 'private',
          payload: '',
          async respond() {},
        },
      },
    )

    expect(setCwd).toHaveBeenCalledWith('private:10001', join(root, 'next'))
    expect(message).toContain(`已切换当前 QQ 会话工作区: ${join(root, 'next')}`)
  })

  it('dispatches model controls through the shared selection controller', async () => {
    const controller = {
      getModelSelection: vi.fn(() => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })),
      listModels: vi.fn(async () => [
        {
          provider: 'deepseek-official',
          id: 'deepseek-v4-pro',
          reasoningEfforts: ['off', 'low', 'high', 'max'],
        },
      ]),
      selectModel: vi.fn(async (_sessionKey: string, model: string) => ({
        provider: 'deepseek-official',
        model,
        reasoningEffort: 'high',
      })),
      selectReasoningEffort: vi.fn(async (_sessionKey: string, reasoningEffort: string) => ({
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        reasoningEffort,
      })),
    }
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createSetModelControlHandler(controller))
    dispatcher.register(createSetReasoningEffortControlHandler(controller))
    const ctx = {
      sessionKey: 'private:10001',
      source: {
        userId: 10001,
        scope: 'private' as const,
        payload: '',
        async respond() {},
      },
    }

    const modelMessage = await dispatcher.dispatch({ action: 'set_model', model: 'deepseek-v4-pro' }, ctx)
    const effortMessage = await dispatcher.dispatch({
      action: 'set_reasoning_effort',
      reasoningEffort: 'low',
    }, ctx)

    expect(controller.selectModel).toHaveBeenCalledWith('private:10001', 'deepseek-v4-pro')
    expect(controller.selectReasoningEffort).toHaveBeenCalledWith('private:10001', 'low')
    expect(modelMessage).toContain('已切换模型: deepseek-v4-pro')
    expect(effortMessage).toContain('已切换推理等级: deepseek-v4-pro')
    expect(effortMessage).toContain('reasoningEffort: low')
  })

  it('dispatches permission controls through the shared permission controller', async () => {
    const permission = {
      runPermissionCommand: vi.fn(async (_sessionKey: string, preset?: string) => (
        `权限命令执行成功: preset ${preset}`
      )),
    }
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createSetPermissionControlHandler(permission))

    const message = await dispatcher.dispatch(
      { action: 'set_permission', preset: 'workspace-write' },
      {
        sessionKey: 'private:10001',
        source: {
          userId: 10001,
          scope: 'private',
          payload: '',
          async respond() {},
        },
      },
    )

    expect(permission.runPermissionCommand).toHaveBeenCalledWith('private:10001', 'workspace-write')
    expect(message).toContain('preset workspace-write')
  })

  it('returns diagnostics for unknown actions', async () => {
    const dispatcher = new QqControlDispatcher()

    const message = await dispatcher.dispatch(
      { action: 'future_action' },
      {
        sessionKey: 'private:10001',
        source: {
          userId: 10001,
          scope: 'private',
          payload: '',
          async respond() {},
        },
      },
    )

    expect(message).toBe('不支持的 QQ 控制动作: future_action')
  })
})
