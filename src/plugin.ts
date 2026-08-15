import { OnebotClient, WsTransport, Transport } from './onebot/client.js'
import { MessageRouter, OutboundSender } from './router.js'
import { AccessGate } from './security.js'
import { AgentRpcHandler } from './handlers/agent.js'
import { DshAgentExecutor, DshRenderedAgent } from './handlers/dsh-executor.js'
import { ShellHandler } from './handlers/shell.js'
import { DshQqBridgeConfig } from './config.js'
import { OnebotMessageEvent } from './onebot/types.js'

/** DSH live agent 最小画面。 */
interface DshAgent {
  followup(message: { content: unknown; source: unknown }): void
  whenIdle(): Promise<void>
}

/** 结构性描述 DSH 服务;不硬依赖 DSH 内部类型。 */
interface DshCtx {
  agentLoop?: {
    createAgent(
      ownerCtx: unknown,
      options: { sessionId: string; agentOptions?: Record<string, unknown>; meta?: { cwd?: string } },
    ): Promise<{ agent: DshAgent; dispose(): Promise<void> }>
  }
  sessionQuery?: {
    readSurface(sessionId: string): Promise<{ events: readonly unknown[] }>
  }
}

/**
 * Cordis 插件入口(Host 侧)。
 * M3:每个 QQ 会话持有常驻 DSH live agent,实现多轮上下文。
 * 依赖:agentLoop(注入,硬依赖);sessionQuery(可选)。
 */
export default function (options: DshQqBridgeConfig) {
  const cfg = DshQqBridgeConfig.parse(options)

  return {
    name: 'dsh-qq-bridge',
    inject: ['agentLoop'],
    async apply(ctx: DshCtx): Promise<() => void> {
      const gate = new AccessGate({
        adminQq: cfg.access.adminQq,
        allowlist: cfg.access.allowlist,
        commandPrefix: cfg.access.commandPrefix,
        mode: cfg.access.mode,
      })

      const transport: Transport = new WsTransport(cfg.napcat.wsUrl, cfg.napcat.token)
      const client = new OnebotClient(transport)

      const outbound: OutboundSender = async (scope, targetId, text) => {
        if (scope === 'private') await client.sendPrivate(targetId, text)
        else await client.sendGroup(targetId, text)
      }
      const router = new MessageRouter(gate, outbound)

      const executor = makeDshExecutor(ctx)
      const unregisterAgent = router.register(new AgentRpcHandler(executor))

      let unregisterShell: () => void = () => {}
      if (cfg.shell.enabled) {
        unregisterShell = router.register(
          new ShellHandler(async (cmd: string) => ({ stdout: `(shell exec disabled) ${cmd}`, code: 1 })),
        )
      }

      // 连接健康检查失败不应拖垮整个 DSH Host 的插件挂载:先登录警告,
      // 依旧保持插件挂载(WS 端点在时才真正收发),避免瞬时断连导致整棵 tree 回滚。
      const unsubMessages = client.onMessage((evt: OnebotMessageEvent) => {
        void router.route(evt)
      })
      client.connect().catch((err) => {
        console.warn('[dsh-qq-bridge] ' + buildConnectGuidance(cfg, err))
      })

      return async () => {
        unregisterAgent()
        unregisterShell()
        unsubMessages()
        await executor.disposeAll() // 释放全部常驻 agent
        await client.disconnect()
      }
    },
  }
}

function makeDshExecutor(ctx: DshCtx) {
  const handles = wireDsh(ctx)
  if (handles) return new DshAgentExecutor(handles)
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
  return new DshAgentExecutor(fallback)
}

/** 把真实 DSH 服务包装成 executor 所需的句柄。 */
function wireDsh(ctx: DshCtx) {
  const loop = ctx.agentLoop
  if (!loop) return undefined
  const query = ctx.sessionQuery

  return {
    async getOrCreate(options: { sessionKey: string; sessionId: string }): Promise<DshRenderedAgent> {
      void options.sessionKey
      const handle = await loop.createAgent(ctx, {
        sessionId: options.sessionId,
        agentOptions: {},
        meta: { cwd: workdir() },
      })
      return {
        followup(message) {
          handle.agent.followup(message)
        },
        async whenIdle() {
          await handle.agent.whenIdle()
        },
        async dispose() {
          await handle.dispose()
        },
      }
    },

    async deliver(agent: DshRenderedAgent, prompt: string) {
      agent.followup({ content: [{ type: 'text', text: prompt }], source: { type: 'user' } })
      await agent.whenIdle()
    },

    async readSurface(sessionId: string) {
      if (!query) return []
      const snap = await query.readSurface(sessionId)
      return snap.events
    },
  }
}

function workdir(): string {
  try {
    return process.cwd()
  } catch {
    return '.'
  }
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
    `4. 连接成功后,从主号向机器人小号发送「/dsh ping」验证双向通信。`,
  ].join('\n')
}
