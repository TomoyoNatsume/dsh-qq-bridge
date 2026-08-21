import { stat } from 'node:fs/promises'
import { HandlerContext } from '../router.js'
import { DirectorySwitcher, resolveUserPath } from './directory.js'
import type { ModelSelectionController, PermissionController } from './model-control.js'

export const QQ_CONTROL_BLOCK_TAG = 'dsh-qq-bridge-control'

export interface QqControlAction {
  action: string
  [key: string]: unknown
}

export interface ParsedQqControls {
  visibleText: string
  actions: QqControlAction[]
  errors: string[]
}

export interface QqControlContext {
  sessionKey: string
  source: HandlerContext
}

export interface QqControlActionHandler {
  action: string
  run(action: QqControlAction, ctx: QqControlContext): Promise<string | undefined>
}

export class QqControlDispatcher {
  private readonly handlers = new Map<string, QqControlActionHandler>()

  register(handler: QqControlActionHandler): () => void {
    this.handlers.set(handler.action, handler)
    return () => this.handlers.delete(handler.action)
  }

  async dispatch(action: QqControlAction, ctx: QqControlContext): Promise<string | undefined> {
    const handler = this.handlers.get(action.action)
    if (!handler) return `不支持的 QQ 控制动作: ${action.action}`
    return await handler.run(action, ctx)
  }
}

export function parseQqControlBlocks(text: string): ParsedQqControls {
  const errors: string[] = []
  const actions: QqControlAction[] = []
  const pattern = new RegExp(`<${QQ_CONTROL_BLOCK_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${QQ_CONTROL_BLOCK_TAG}>`, 'g')
  const visibleText = text.replace(pattern, (_block, rawJson: string) => {
    try {
      const parsed = JSON.parse(rawJson) as unknown
      if (!isQqControlAction(parsed)) {
        errors.push('QQ 控制块格式无效: 需要包含字符串 action 字段。')
      } else {
        actions.push(parsed)
      }
    } catch (err) {
      errors.push(`QQ 控制块 JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`)
    }
    return ''
  }).trim()

  return { visibleText, actions, errors }
}

export function createSetCwdControlHandler(switcher: DirectorySwitcher): QqControlActionHandler {
  return {
    action: 'set_cwd',
    async run(action, ctx) {
      if (typeof action.path !== 'string' || action.path.trim() === '') {
        return 'QQ 控制块 set_cwd 缺少 path。'
      }
      const baseCwd = switcher.getCwd?.(ctx.sessionKey)
      const cwd = resolveUserPath(action.path.trim(), baseCwd)
      const info = await stat(cwd).catch(() => null)
      if (!info?.isDirectory()) {
        return `目录不存在或不是目录: ${cwd}`
      }
      await switcher.setCwd(ctx.sessionKey, cwd)
      return `已切换当前 QQ 会话工作区: ${cwd}\n下一条消息会使用新的 Agent session。`
    },
  }
}

export function createSetModelControlHandler(controller: ModelSelectionController): QqControlActionHandler {
  return {
    action: 'set_model',
    async run(action, ctx) {
      if (typeof action.model !== 'string' || action.model.trim() === '') {
        return 'QQ 控制块 set_model 缺少 model。'
      }
      const model = action.model.trim()
      const available = await controller.listModels(ctx.sessionKey)
      const matches = available.filter(entry => entry.id === model)
      if (matches.length === 0) {
        return `未找到模型: ${model}\n${formatModelIds(available)}`
      }
      if (new Set(matches.map(entry => entry.provider)).size > 1) {
        return `模型名 ${model} 在多个 provider 中重复；当前 QQ 控制动作只接受唯一模型名。`
      }

      const selected = await controller.selectModel(ctx.sessionKey, model)
      return formatSelection('已切换模型', selected)
    },
  }
}

export function createSetReasoningEffortControlHandler(controller: ModelSelectionController): QqControlActionHandler {
  return {
    action: 'set_reasoning_effort',
    async run(action, ctx) {
      if (typeof action.reasoningEffort !== 'string' || action.reasoningEffort.trim() === '') {
        return 'QQ 控制块 set_reasoning_effort 缺少 reasoningEffort。'
      }
      const effort = action.reasoningEffort.trim()
      const current = controller.getModelSelection(ctx.sessionKey)
      const info = (await controller.listModels(ctx.sessionKey)).find(entry =>
        entry.provider === current.provider && entry.id === current.model)
      const choices = info?.reasoningEfforts?.length
        ? info.reasoningEfforts
        : ['off', 'low', 'medium', 'high', 'max']
      if (!choices.includes(effort)) {
        return `未找到推理等级: ${effort}\n可选: ${choices.join(', ')}`
      }

      const selected = await controller.selectReasoningEffort(ctx.sessionKey, effort)
      return formatSelection('已切换推理等级', selected)
    },
  }
}

export function createSetPermissionControlHandler(controller: PermissionController): QqControlActionHandler {
  return {
    action: 'set_permission',
    async run(action, ctx) {
      if (typeof action.preset !== 'string' || action.preset.trim() === '') {
        return 'QQ 控制块 set_permission 缺少 preset。'
      }
      return await controller.runPermissionCommand(ctx.sessionKey, action.preset.trim())
    },
  }
}

function isQqControlAction(value: unknown): value is QqControlAction {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { action?: unknown }).action === 'string'
    && (value as { action: string }).action.trim() !== ''
}

function formatSelection(
  prefix: string,
  selected: { provider: string; model: string; reasoningEffort?: string },
): string {
  return [
    `${prefix}: ${selected.model}`,
    `provider: ${selected.provider}`,
    `reasoningEffort: ${selected.reasoningEffort ?? '(provider default)'}`,
    '下一次模型请求生效；正在运行的请求不受影响。',
  ].join('\n')
}

function formatModelIds(models: ReadonlyArray<{ id: string }>): string {
  if (models.length === 0) return '可选模型列表为空。'
  return `可选模型: ${models.map(model => model.id).join(', ')}`
}
