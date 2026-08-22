import { OnebotClient, WsTransport, Transport } from './onebot/client.js'
import { randomUUID } from 'node:crypto'
import { MessageRouter, OutboundSender } from './router.js'
import { AccessGate } from './security.js'
import { AgentRpcHandler } from './handlers/agent.js'
import { DshAgentExecutor, DshRenderedAgent } from './handlers/dsh-executor.js'
import { DIR_COMMAND, resolveUserPath } from './handlers/directory.js'
import {
  createSetCwdControlHandler,
  createSetModelControlHandler,
  createSetPermissionControlHandler,
  createSetReasoningEffortControlHandler,
  QqControlDispatcher,
} from './handlers/control.js'
import { createSaveMemoControlHandler, LazyCustomMemoryStore } from './handlers/custom-memory.js'
import type { DshStorageDomainRuntime } from './handlers/custom-memory.js'
import { createScheduleTaskControlHandler, InMemoryTaskScheduler } from './handlers/scheduler.js'
import {
  BridgeControlHandler,
  BridgeModelInfo,
  BridgeModelSelection,
  BridgeModelSelectionRef,
  installBridgeModelSelection,
  HELP_COMMAND,
  MODEL_COMMAND,
  MODELS_COMMAND,
  PERMISSION_COMMAND,
  PERMISSIONS_COMMAND,
  REASONING_EFFORT_COMMAND,
} from './handlers/model-control.js'
import { ShellHandler } from './handlers/shell.js'
import { DshQqBridgeConfig } from './config.js'
import { OnebotMessageEvent, PlatformReplyTarget } from './onebot/types.js'
import { NapcatSelfLogInput } from './inputs/napcat-log.js'
import { homedir } from 'node:os'
import { TencentOfficialBotClient } from './official/client.js'
import type { MessageTargetId } from './onebot/types.js'
import { InteractionCtxLike, QqInteractionBridge } from './interactions.js'
import { DshWebActivityGate } from './web-activity.js'
import { installQqBridgeSettings } from './settings.js'

/** DSH live agent 最小画面。 */
interface DshAgent {
  followup(message: { id: string; role: string; content: unknown; source: unknown }): void
  whenIdle(): Promise<void>
}

/** 结构性描述 DSH 服务;不硬依赖 DSH 内部类型。 */
interface DshCtx extends InteractionCtxLike {
  agentLoop?: {
    createAgent(
      ownerCtx: unknown,
      options: {
        sessionId: string
        agentOptions?: Record<string, unknown>
        meta?: { cwd?: string; agentPreset?: string }
        setup?: (agentCtx: unknown) => void | Promise<void>
      },
    ): Promise<{ agent: DshAgent; dispose(): Promise<void> }>
  }
  agentPresets?: {
    mount(agentCtx: unknown, preset?: string): Promise<void>
  }
  sessionQuery?: {
    readSurface(sessionId: string): Promise<{ events: readonly unknown[] }>
  }
  workspaceRegistry?: DshWorkspaceRegistry
  llm?: DshLlmRuntime
  commands?: DshCommandRuntime
  storageDomain?: DshStorageDomainRuntime
  on?(
    event: 'session/event',
    cb: (subject: DshSessionSubject, event: unknown) => void,
    options?: { prepend?: boolean },
  ): () => void
  on?(
    event: 'approval/request',
    cb: (...args: never[]) => unknown,
    options?: { prepend?: boolean },
  ): () => void
  on?(event: string, cb: (...args: never[]) => unknown, options?: { prepend?: boolean }): () => void
}

interface DshLlmRuntime {
  listProviders?(): Array<{ id: string; name?: string }>
  listModels?(provider: string): Promise<Array<{
    provider?: string
    id: string
    name?: string
  }>>
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<{
    provider?: string
    id?: string
    name?: string
    reasoning?: {
      efforts: ReadonlyArray<{ id: string; name?: string; description?: string }>
      defaultEffort?: string
    }
  }>
  resolveCallConfig?(config: BridgeModelSelection, signal?: AbortSignal): Promise<BridgeModelSelection>
}

interface DshCommandRuntime {
  execute(
    agent: unknown,
    line: string,
    images: readonly unknown[],
    signal: AbortSignal,
  ): Promise<undefined | {
    result?: {
      kind?: string
      text?: string
    }
  }>
}

export interface DshWorkspace {
  id?: string
  attachSession(sessionId: string): Promise<void>
}

export interface DshWorkspaceRegistry {
  create(path: string): Promise<DshWorkspace>
}

interface DshSessionSubject {
  id?: string
  header?: { origin?: string }
  events?: readonly unknown[]
}

interface BridgeChatClient {
  connect(): Promise<void>
  onMessage(cb: (evt: OnebotMessageEvent) => void): () => void
  sendPrivate(userId: MessageTargetId, message: string, replyTarget?: PlatformReplyTarget): Promise<unknown>
  sendGroup(groupId: MessageTargetId, message: string, replyTarget?: PlatformReplyTarget): Promise<unknown>
  disconnect(): Promise<void>
}

/**
 * Cordis 插件入口(Host 侧)。
 * M3:每个 QQ 会话持有常驻 DSH live agent,实现多轮上下文。
 * 依赖:agentLoop / agentPresets / sessionQuery。
 */
export const name = 'dsh-qq-bridge'
export const inject = ['agentLoop', 'agentPresets', 'sessionQuery']

export async function apply(ctx: DshCtx, options: DshQqBridgeConfig): Promise<() => Promise<void>> {
  const entry = DshQqBridgeConfig.parse(options)
  const runtime = createBridgeRuntime(ctx)
  const settings = await installQqBridgeSettings(ctx, entry, (next) => runtime.reconcile(next))
  await runtime.reconcile(DshQqBridgeConfig.parse(settings?.current() ?? entry))
  return async () => {
    settings?.dispose()
    await runtime.dispose()
  }
}

function createBridgeRuntime(ctx: DshCtx): { reconcile(cfg: DshQqBridgeConfig): Promise<void>; dispose(): Promise<void> } {
  let stop: (() => Promise<void>) | undefined
  let activeKey = ''
  let revision = 0

  return {
    async reconcile(cfg) {
      const nextRevision = ++revision
      const nextKey = JSON.stringify(cfg)
      if (!isBridgeConfigured(cfg)) {
        if (stop) {
          const previous = stop
          stop = undefined
          activeKey = ''
          await previous()
        } else if (activeKey === '') {
          console.info('[dsh-qq-bridge] QQ bridge is not enabled or is missing required settings; configure it from DSH Web settings.')
        }
        return
      }
      if (stop && activeKey === nextKey) return
      if (stop) {
        const previous = stop
        stop = undefined
        activeKey = ''
        await previous()
      }
      try {
        const nextStop = await startQqBridge(ctx, cfg)
        if (nextRevision !== revision) {
          await nextStop()
          return
        }
        stop = nextStop
        activeKey = nextKey
        console.info('[dsh-qq-bridge] QQ bridge started from saved settings.')
      } catch (err) {
        activeKey = ''
        console.warn(`[dsh-qq-bridge] failed to start QQ bridge from saved settings: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    async dispose() {
      revision += 1
      if (!stop) return
      const previous = stop
      stop = undefined
      activeKey = ''
      await previous()
    },
  }
}

async function startQqBridge(ctx: DshCtx, cfg: DshQqBridgeConfig): Promise<() => Promise<void>> {
  assertPlatformConfig(cfg)
  const officialMode = cfg.platform === 'official'
  const adminTarget: MessageTargetId = officialMode ? cfg.official.adminOpenId : cfg.access.adminQq

  const gate = new AccessGate({
    adminQq: cfg.access.adminQq,
    adminId: adminTarget,
    allowlist: officialMode ? cfg.official.allowlistOpenIds : cfg.access.allowlist,
    commandPrefix: cfg.access.commandPrefix,
    mode: cfg.access.mode,
  })

  const client = createBridgeClient(cfg)
  const notifyAgentReply = agentReplyNotificationsEnabled(cfg)
  if (officialMode && cfg.notifications.agentReply.enabled === undefined) {
    console.info('[dsh-qq-bridge] official QQ agent reply notifications are disabled by default; set notifications.agentReply.enabled=true to use wakeup messages')
  }
  const replyNotifier = notifyAgentReply
    ? createAgentReplyNotifier(ctx, client, adminTarget)
    : () => {}

  const outbound: OutboundSender = async (scope, targetId, text, replyTarget) => {
    if (scope === 'private') await client.sendPrivate(targetId, text, replyTarget)
    else await client.sendGroup(targetId, text, replyTarget)
  }
  const interactions = new QqInteractionBridge(outbound, cfg.access.commandPrefix)
  const unregisterInteractions = interactions.register(ctx)
  const webActivity = DshWebActivityGate.register(ctx)
  const router = new MessageRouter(gate, outbound, interactions)
  const workspaceAttachment = createWorkspaceAttachment(ctx)
  const llmAccess = createDshLlmAccess(ctx)
  const commandsAccess = createDshCommandsAccess(ctx)
  const storageDomainAccess = createDshStorageDomainAccess(ctx)
  const customMemoryStore = new LazyCustomMemoryStore(storageDomainAccess.current)

  const executor = makeDshExecutor(ctx, cfg.agent, interactions, workspaceAttachment.attach, llmAccess.current, commandsAccess.current)
  const taskScheduler = new InMemoryTaskScheduler({
    executor,
    store: customMemoryStore,
    maxMessageLength: cfg.agent.maxMessageLength,
    send: async (target, text) => {
      await outbound(target.scope, target.targetId, text)
    },
  })
  taskScheduler.startScanning()
  const controlDispatcher = new QqControlDispatcher()
  controlDispatcher.register(createSetCwdControlHandler(executor))
  controlDispatcher.register(createSetModelControlHandler(executor))
  controlDispatcher.register(createSetReasoningEffortControlHandler(executor))
  controlDispatcher.register(createSetPermissionControlHandler(executor))
  controlDispatcher.register(createSaveMemoControlHandler(customMemoryStore))
  controlDispatcher.register(createScheduleTaskControlHandler(taskScheduler))
  const unregisterBridgeControl = router.register(new BridgeControlHandler(executor, executor, executor))

  let unregisterShell: () => void = () => {}
  if (cfg.shell.enabled) {
    unregisterShell = router.register(
      new ShellHandler(async (cmd: string) => ({ stdout: `(shell exec disabled) ${cmd}`, code: 1 })),
    )
  }

  const unregisterAgent = router.register(new AgentRpcHandler(executor, {
    streamText: cfg.agent.streamText,
    streamReasoning: cfg.agent.streamReasoning,
    maxMessageLength: cfg.agent.maxMessageLength,
    ackMessage: cfg.agent.ackMessage,
    timeoutMs: cfg.agent.timeoutMs,
    timeoutMessage: cfg.agent.timeoutMessage,
    qqReplyStyleSkill: cfg.agent.qqReplyStyleSkill,
    webActivityGate: webActivity.gate,
    reservedCommands: [
      DIR_COMMAND,
      HELP_COMMAND,
      MODELS_COMMAND,
      MODEL_COMMAND,
      REASONING_EFFORT_COMMAND,
      PERMISSION_COMMAND,
      PERMISSIONS_COMMAND,
    ],
    controlDispatcher,
  }))

  // 连接健康检查失败不应拖垮整个 DSH Host 的插件挂载:先登录警告,
  // 依旧保持插件挂载(WS 端点在时才真正收发),避免瞬时断连导致整棵 tree 回滚。
  const unsubMessages = client.onMessage((evt: OnebotMessageEvent) => {
    void router.route(evt)
  })
  client.connect().catch((err) => {
    console.warn('[dsh-qq-bridge] ' + (
      officialMode ? buildOfficialConnectGuidance(cfg, err) : buildConnectGuidance(cfg, err)
    ))
  })

  let selfLogInput: NapcatSelfLogInput | undefined
  if (!officialMode && cfg.selfLogInput.enabled) {
    const logPath = cfg.selfLogInput.logPath?.trim() || `${homedir()}/Napcat/log/napcat_${cfg.access.adminQq}.log`
    selfLogInput = new NapcatSelfLogInput({
      logPath,
      selfQq: cfg.access.adminQq,
      commandPrefix: cfg.access.commandPrefix,
      pollIntervalMs: cfg.selfLogInput.pollIntervalMs,
      replayOnStart: cfg.selfLogInput.replayOnStart,
    })
    selfLogInput.start((evt) => void router.route(evt)).catch((err) => {
      console.warn(`[dsh-qq-bridge] self log input failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  return async () => {
    unregisterAgent()
    unregisterBridgeControl()
    unregisterShell()
    unregisterInteractions()
    webActivity.dispose()
    llmAccess.dispose()
    commandsAccess.dispose()
    storageDomainAccess.dispose()
    workspaceAttachment.dispose()
    taskScheduler.dispose()
    await customMemoryStore.close()
    unsubMessages()
    replyNotifier()
    selfLogInput?.stop()
    await executor.disposeAll() // 释放全部常驻 agent
    await client.disconnect()
  }
}

export default { name, inject, apply }

/** 判断是否启用 agent 完成后的管理员主动提醒。 */
export function agentReplyNotificationsEnabled(cfg: DshQqBridgeConfig): boolean {
  return cfg.notifications.agentReply.enabled ?? cfg.platform !== 'official'
}

function makeDshExecutor(
  ctx: DshCtx,
  agentCfg?: { preset?: string; provider?: string; model?: string; models?: readonly string[]; cwd?: string },
  interactions?: QqInteractionBridge,
  attachWorkspace?: (sessionId: string, cwd: string) => Promise<void>,
  llm?: () => DshLlmRuntime | undefined,
  commands?: () => DshCommandRuntime | undefined,
) {
  const handles = wireDsh(ctx, agentCfg, interactions, attachWorkspace)
  const modelOptions = {
    defaultCwd: agentCfg?.cwd ? resolveUserPath(agentCfg.cwd) : undefined,
    defaultProvider: agentCfg?.provider,
    defaultModel: agentCfg?.model,
    models: agentCfg?.models,
    resolveModelSelection: createModelSelectionResolver(llm),
    listModels: createModelLister(llm),
    executeCommand: createDshCommandExecutor(commands),
  }
  if (handles) return new DshAgentExecutor(handles, modelOptions)
  // 无 DSH 服务时占位,便于纯 CLI / 测试
  const fallback = {
    async getOrCreate(): Promise<DshRenderedAgent> {
      return { followup() {}, async whenIdle() {}, async dispose() {} }
    },
    async deliver() {},
    async readSurface(): Promise<readonly unknown[]> {
      return []
    },
  }
  return new DshAgentExecutor(fallback, modelOptions)
}

/** 把真实 DSH 服务包装成 executor 所需的句柄。 */
function wireDsh(
  ctx: DshCtx,
  agentCfg?: { preset?: string; provider?: string; model?: string; models?: readonly string[]; cwd?: string },
  interactions?: QqInteractionBridge,
  attachWorkspace?: (sessionId: string, cwd: string) => Promise<void>,
) {
  const loop = ctx.agentLoop
  if (!loop) return undefined
  const query = ctx.sessionQuery

  return {
    async getOrCreate(options: {
      sessionKey: string
      sessionId: string
      cwd?: string
      modelSelection: BridgeModelSelectionRef
    }): Promise<DshRenderedAgent> {
      void options.sessionKey
      if (ctx.agentPresets && agentCfg?.preset) {
        console.info(`[dsh-qq-bridge] mounting agent preset "${agentCfg.preset}" for ${options.sessionId}`)
      } else if (agentCfg?.preset) {
        console.warn(`[dsh-qq-bridge] agent preset "${agentCfg.preset}" requested but agentPresets service is unavailable`)
      }
      const cwd = options.cwd ?? workdir()
      const handle = await loop.createAgent(ctx, {
        sessionId: options.sessionId,
        // agent 的 model 路由必须显式给出,否则 prompt 组装时 `{{model}}` 无值。
        agentOptions: {
          provider: options.modelSelection.current.provider,
          model: options.modelSelection.current.model,
          ...(options.modelSelection.current.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: options.modelSelection.current.reasoningEffort }),
        },
        meta: { cwd, ...(agentCfg?.preset ? { agentPreset: agentCfg.preset } : {}) },
        ...(ctx.agentPresets && agentCfg?.preset
          ? {
              setup: async (agentCtx: unknown) => {
                installBridgeModelSelection(agentCtx, options.modelSelection)
                await ctx.agentPresets!.mount(agentCtx, agentCfg.preset)
              },
            }
          : { setup: (agentCtx: unknown) => void installBridgeModelSelection(agentCtx, options.modelSelection) }),
      })
      await attachWorkspace?.(options.sessionId, cwd)
      interactions?.bindAgent(options.sessionKey, handle.agent)
      // 捕获 live session 对象:用于 session/event 过滤(流式分段)。
      const session = (handle.agent as { session?: { id?: string } }).session
      return {
        followup(message) {
          handle.agent.followup(message)
        },
        async whenIdle() {
          await handle.agent.whenIdle()
        },
        async readSurface() {
          // 读 live agent 会话的实时已提交日志(session.events)。
          // 比走持久化 corpus 的 sessionQuery.readSurface 更及时(避免 whenIdle 后未 flush 的滞后)。
          const events = (handle.agent as { session?: { events?: readonly unknown[] } }).session?.events
          return events ?? []
        },
        async dispose() {
          await handle.dispose()
        },
        _session: session,
        _commandAgent: handle.agent,
      } as DshRenderedAgent
    },

    async deliver(
      agent: DshRenderedAgent,
      prompt: string,
      onChunk?: (text: string, kind: 'text' | 'reasoning') => void,
    ) {
      // DSH 要求 user message 是「identified」的:必须带 id、role、source.kind。
      // 缺失 id 或 source 用 type 而非 kind,会在 session 校验时抛 「lacks an identified message」。
      const msg = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      }

      // 流式分段:订阅该会话的 session/event,按「句子边界 + 最大长度」聚合后回发。
      // 注意:text-delta 是逐 token 到达,若按时间窗批量会在 QQ 刷出单个词;
      // 改为累积到完整句子/段落再回发,兼顾及时性与可读性。
      let unsubscribe: (() => void) | undefined
      const textBuf: string[] = []
      const reasoningBuf: string[] = []
      const sessionId = (agent as unknown as { _session?: { id?: string } })._session?.id
      const MIN_FLUSH = 8 // 最少多少字符才值得单独发一条
      const MAX_FLUSH = 200 // 无标点时最多攒多少字符强制发
      const sentenceBoundary = /[。！？!?；;\n]$/
      const flushText = () => {
        if (textBuf.length === 0) return
        const text = textBuf.splice(0).join('')
        if (text && onChunk) onChunk(text, 'text')
      }
      const flushReasoning = () => {
        if (reasoningBuf.length === 0) return
        const text = reasoningBuf.splice(0).join('')
        if (text && onChunk) onChunk(text, 'reasoning')
      }
      if (onChunk && ctx.on) {
        unsubscribe = ctx.on('session/event', (subject, evt) => {
          if (sessionId === undefined || subject?.id !== sessionId) return
          const chunk = (evt as { type?: string; data?: { chunk?: { type?: string; text?: string } } }).data?.chunk
          if (!chunk) return
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            textBuf.push(chunk.text)
            const joined = textBuf.join('')
            // 句子边界或超长时回发一条完整段落
            if ((joined.length >= MIN_FLUSH && sentenceBoundary.test(joined)) || joined.length >= MAX_FLUSH) {
              flushText()
            }
          } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
            reasoningBuf.push(chunk.text)
            const joined = reasoningBuf.join('')
            if ((joined.length >= MIN_FLUSH && sentenceBoundary.test(joined)) || joined.length >= MAX_FLUSH) {
              flushReasoning()
            }
          }
        })
      }

      agent.followup(msg)
      try {
        await agent.whenIdle()
      } catch (err) {
        // 调试图:turn 失败时落盘完整会话日志 + 错误详情。
        try {
          const fs = await import('node:fs')
          const dir = '/home/liangyihao/temp/dsh-qq-bridge'
          fs.writeFileSync(`${dir}/.debug-turn-error.json`, JSON.stringify({
            error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
            delivered: msg,
          }, null, 2))
          const events = (agent as unknown as { readSurface?: () => Promise<readonly unknown[]> }).readSurface
          if (typeof events === 'function') {
            const evts = await events()
            fs.writeFileSync(`${dir}/.debug-turn-log.json`, JSON.stringify(evts, null, 2))
          }
        } catch { /* noop */ }
        flushReasoning()
        flushText() // 先把已收集的分段发出去,再抛错
        unsubscribe?.()
        throw err
      }
      flushReasoning()
      flushText() // 收尾冲刷剩余内容
      unsubscribe?.()
    },

    async readSurface(sessionId: string) {
      if (!query) return []
      const snap = await query.readSurface(sessionId)
      return snap.events
    },
  }
}

function createModelSelectionResolver(
  llm?: () => DshLlmRuntime | undefined,
): ((selection: BridgeModelSelection) => Promise<BridgeModelSelection>) | undefined {
  return async (selection) => {
    const runtime = llm?.()
    if (!runtime?.resolveCallConfig) return selection
    const resolved = await runtime.resolveCallConfig(selection)
    return {
      provider: resolved.provider,
      model: resolved.model,
      ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }),
    }
  }
}

function createModelLister(
  llm?: () => DshLlmRuntime | undefined,
): ((provider: string) => Promise<BridgeModelInfo[]>) | undefined {
  return async (provider) => {
    const runtime = llm?.()
    if (!runtime?.listModels) return []
    const models = await runtime.listModels(provider).catch(() => [])
    return await Promise.all(models.map(async (model) => {
      const base: BridgeModelInfo = {
        provider: model.provider ?? provider,
        id: model.id,
        name: model.name,
      }
      if (!runtime.resolveModelInfo) return base
      try {
        const resolved = await runtime.resolveModelInfo(provider, model.id)
        const reasoning = resolved.reasoning
        if (!reasoning) return base
        return {
          ...base,
          reasoningEfforts: reasoning.efforts.map(effort => effort.id),
          ...(reasoning.defaultEffort === undefined ? {} : { defaultReasoningEffort: reasoning.defaultEffort }),
        }
      } catch {
        return base
      }
    }))
  }
}

function createDshCommandExecutor(
  commands?: () => DshCommandRuntime | undefined,
): ((agent: unknown, line: string) => Promise<string | undefined>) | undefined {
  return async (agent, line) => {
    const runtime = commands?.()
    if (!runtime?.execute) return undefined
    const execution = await runtime.execute(agent, line, [], new AbortController().signal)
    const result = execution?.result
    if (!result) return undefined
    const text = result.text?.trim()
    if (result.kind === 'error') return `权限命令执行失败: ${text || 'unknown error'}`
    if (text) return `权限命令执行成功: ${text}`
    return '权限命令执行成功。'
  }
}

function createDshLlmAccess(ctx: DshCtx): { current(): DshLlmRuntime | undefined; dispose(): void } {
  let llm: DshLlmRuntime | undefined
  const disposers: Array<() => void> = []

  if (ctx.inject) {
    const fiber = ctx.inject(['llm'], (childCtx) => {
      const scoped = childCtx as DshCtx
      const current = scoped.llm
      llm = current
      scoped.effect?.(() => () => {
        if (llm === current) llm = undefined
      }, 'dsh-qq-bridge.llm')
    }, 'dsh-qq-bridge.llm')
    if (fiber && typeof fiber === 'object' && typeof fiber.dispose === 'function') {
      disposers.push(() => fiber.dispose())
    }
  } else {
    llm = ctx.llm
  }

  return {
    current() {
      return llm
    },
    dispose() {
      llm = undefined
      for (const dispose of disposers.splice(0)) dispose()
    },
  }
}

function createDshCommandsAccess(ctx: DshCtx): { current(): DshCommandRuntime | undefined; dispose(): void } {
  let commands: DshCommandRuntime | undefined
  const disposers: Array<() => void> = []

  if (ctx.inject) {
    const fiber = ctx.inject(['commands'], (childCtx) => {
      const scoped = childCtx as DshCtx
      const current = scoped.commands
      commands = current
      scoped.effect?.(() => () => {
        if (commands === current) commands = undefined
      }, 'dsh-qq-bridge.commands')
    }, 'dsh-qq-bridge.commands')
    if (fiber && typeof fiber === 'object' && typeof fiber.dispose === 'function') {
      disposers.push(() => fiber.dispose())
    }
  } else {
    commands = ctx.commands
  }

  return {
    current() {
      return commands
    },
    dispose() {
      commands = undefined
      for (const dispose of disposers.splice(0)) dispose()
    },
  }
}

function createDshStorageDomainAccess(ctx: DshCtx): { current(): DshStorageDomainRuntime | undefined; dispose(): void } {
  let storageDomain: DshStorageDomainRuntime | undefined
  const disposers: Array<() => void> = []

  if (ctx.inject) {
    const fiber = ctx.inject(['storageDomain'], (childCtx) => {
      const scoped = childCtx as DshCtx
      const current = scoped.storageDomain
      storageDomain = current
      scoped.effect?.(() => () => {
        if (storageDomain === current) storageDomain = undefined
      }, 'dsh-qq-bridge.storageDomain')
    }, 'dsh-qq-bridge.storageDomain')
    if (fiber && typeof fiber === 'object' && typeof fiber.dispose === 'function') {
      disposers.push(() => fiber.dispose())
    }
  } else {
    storageDomain = ctx.storageDomain
  }

  return {
    current() {
      return storageDomain
    },
    dispose() {
      storageDomain = undefined
      for (const dispose of disposers.splice(0)) dispose()
    },
  }
}

function createWorkspaceAttachment(ctx: DshCtx): { attach(sessionId: string, cwd: string): Promise<void>; dispose(): void } {
  let registry: DshWorkspaceRegistry | undefined
  const disposers: Array<() => void> = []

  if (ctx.inject) {
    const fiber = ctx.inject(['workspaceRegistry'], (childCtx) => {
      const scoped = childCtx as DshCtx
      const current = scoped.workspaceRegistry
      registry = current
      scoped.effect?.(() => () => {
        if (registry === current) registry = undefined
      }, 'dsh-qq-bridge.workspaceRegistry')
    }, 'dsh-qq-bridge.workspaceRegistry')
    if (fiber && typeof fiber === 'object' && typeof fiber.dispose === 'function') {
      disposers.push(() => fiber.dispose())
    }
  } else {
    registry = ctx.workspaceRegistry
  }

  return {
    async attach(sessionId: string, cwd: string): Promise<void> {
      const active = registry
      if (!active) return
      await attachSessionToWorkspace(active, sessionId, cwd)
    },
    dispose(): void {
      for (const dispose of disposers.splice(0)) dispose()
      registry = undefined
    },
  }
}

export async function attachSessionToWorkspace(
  registry: DshWorkspaceRegistry,
  sessionId: string,
  cwd: string,
): Promise<void> {
  try {
    const workspace = await registry.create(cwd)
    await workspace.attachSession(sessionId)
  } catch (err) {
    console.warn(`[dsh-qq-bridge] failed to attach session ${sessionId} to workspace ${cwd}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function workdir(): string {
  try {
    return process.cwd()
  } catch {
    return '.'
  }
}

function createBridgeClient(cfg: DshQqBridgeConfig): BridgeChatClient {
  if (cfg.platform === 'official') {
    return new TencentOfficialBotClient({
      appId: cfg.official.appId,
      appSecret: cfg.official.appSecret,
      sandbox: cfg.official.sandbox,
    })
  }
  const transport: Transport = new WsTransport(cfg.napcat.wsUrl, cfg.napcat.token)
  return new OnebotClient(transport)
}

function assertPlatformConfig(cfg: DshQqBridgeConfig): void {
  if (cfg.platform !== 'official') return
  if (!cfg.official.appId.trim()) throw new Error('dsh-qq-bridge: official.appId is required when platform=official')
  if (!cfg.official.appSecret.trim()) throw new Error('dsh-qq-bridge: official.appSecret is required when platform=official')
  if (cfg.access.mode === 'whitelist' && !cfg.official.adminOpenId.trim()) {
    throw new Error('dsh-qq-bridge: official.adminOpenId is required in whitelist mode')
  }
}

function isBridgeConfigured(cfg: DshQqBridgeConfig): boolean {
  if (!cfg.enabled) return false
  if (cfg.platform === 'official') {
    if (!cfg.official.appId.trim()) return false
    if (!cfg.official.appSecret.trim()) return false
    return cfg.access.mode !== 'whitelist' || cfg.official.adminOpenId.trim() !== ''
  }
  return cfg.access.adminQq > 0
}

export function createAgentReplyNotifier(
  ctx: Pick<DshCtx, 'on'>,
  client: Pick<BridgeChatClient, 'sendPrivate'>,
  adminTarget: MessageTargetId,
): () => void {
  if (!ctx.on || adminTarget === '' || adminTarget === 0) return () => {}
  const sent = new Set<string>()
  return ctx.on('session/event', (session, event) => {
    if (!isCompletedTurnEnd(event)) return
    if (session.header?.origin === 'subagent') return
    const sessionId = String(session.id ?? '')
    if (isQqAgentSessionId(sessionId)) return
    const key = `${sessionId}:${event.data.turn}`
    if (sent.has(key)) return
    const title = findSessionTitle(session.events ?? [])
    sendAgentReplyNotification(client, adminTarget, sent, key, `主人，您收到一条Agent回复，来自[${title}]`)
  })
}

/** 监听 DSH 会话完成事件,向管理员 QQ 发送一条轻量提醒。 */
export function registerAgentReplyNotifier(
  ctx: Pick<DshCtx, 'on'>,
  client: Pick<BridgeChatClient, 'sendPrivate'>,
  adminTarget: MessageTargetId,
): () => void {
  return createAgentReplyNotifier(ctx, client, adminTarget)
}

function sendAgentReplyNotification(
  client: Pick<BridgeChatClient, 'sendPrivate'>,
  adminTarget: MessageTargetId,
  sent: Set<string>,
  key: string,
  message: string,
): void {
  if (sent.has(key)) return
  sent.add(key)
  void client.sendPrivate(adminTarget, message).catch((err: unknown) => {
    console.warn(`[dsh-qq-bridge] agent reply notification failed: ${err instanceof Error ? err.message : String(err)}`)
  })
}

function isQqAgentSessionId(sessionId: string): boolean {
  return sessionId.startsWith('qq-')
}

function isCompletedTurnEnd(event: unknown): event is { type: 'turn/end'; data: { turn: number; reason: { kind: 'completed' } } } {
  const evt = event as { type?: unknown; data?: { turn?: unknown; reason?: { kind?: unknown } } } | null
  return evt?.type === 'turn/end'
    && typeof evt.data?.turn === 'number'
    && evt.data.reason?.kind === 'completed'
}

export function findSessionTitle(events: readonly unknown[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as { type?: unknown; data?: { title?: unknown } } | null
    if (event?.type === 'session/title' && typeof event.data?.title === 'string') return event.data.title
  }
  return ''
}

/** 构建官方机器人连接失败时的引导文案。 */
export function buildOfficialConnectGuidance(cfg: DshQqBridgeConfig, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err)
  return [
    `[dsh-qq-bridge] 无法连接腾讯官方 QQ 机器人 WebSocket: appId=${cfg.official.appId || '(empty)'}`,
    `原因: ${reason}`,
    ``,
    `请检查:`,
    `1. QQ 开放平台机器人 AppID/AppSecret 是否正确。`,
    `2. 机器人是否已加入沙箱成员,或已上线到当前会话场景。`,
    `3. 当前服务器出口 IP 是否满足开放平台白名单要求。`,
    `4. whitelist 模式下 official.adminOpenId 是否来自该机器人收到的真实消息事件。`,
  ].join('\n')
}

/** 构建连接失败时的引导文案,指向「给 Agent 的 NapCat 安装向导」。 */
export function buildConnectGuidance(cfg: DshQqBridgeConfig, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err)
  return [
    `[dsh-qq-bridge] 无法连接 onebot WS 端点: ${cfg.napcat.wsUrl}`,
    `原因: ${reason}`,
    ``,
    `请按以下步骤让 QQ 接入(NapCat 是一侧部署,插件只负责连接):`,
    `1. 阅读给 Agent 的安装向导:${cfg.napcat.guideDoc ?? 'docs/agent-napcat-guide.md'}`,
    `2. 若尚未安装 NapCat,引导用户在官方 GitHub (NapNeko/NapCatQQ) 下载并扫码登录专属小号。`,
    `3. 启用正向 WebSocket,核对端口与 wsUrl(${cfg.napcat.wsUrl})一致。`,
    `4. 连接成功后,从主号向机器人小号发送「${formatCommandExample(cfg.access.commandPrefix, 'ping')}」验证双向通信。`,
  ].join('\n')
}

function formatCommandExample(commandPrefix: string, payload: string): string {
  const prefix = commandPrefix.trim()
  return prefix ? `${prefix} ${payload}` : payload
}
