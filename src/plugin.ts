import { OnebotClient, WsTransport, Transport } from './onebot/client.js'
import { MessageRouter, OutboundSender } from './router.js'
import { AccessGate } from './security.js'
import { AgentRpcHandler } from './handlers/agent.js'
import { DshAgentExecutor, DshRenderedAgent, DshServiceHandles } from './handlers/dsh-executor.js'
import { ShellHandler } from './handlers/shell.js'
import { DshQqBridgeConfig } from './config.js'
import { OnebotMessageEvent } from './onebot/types.js'

/**
 * 结构性描述 DSH 服务的宿主接口。
 * 本仓库作独立工程,不把 DSH 内部类型作为硬依赖安装;
 * apply 时从 context 读真实服务并按本接口使用。
 */
interface DshAgent {
  followup(message: { content: unknown; source: unknown }): void
  whenIdle(): Promise<void>
}
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
 * M2:接通真实 DSH services —— agentLoop 驱动 Agent,sessionQuery 读回复。
 *
 * 依赖:
 * - agentLoop:硬依赖(注入),未加载 agent-loop 时 Cordis 等待。
 * - sessionQuery:可选;缺失时 reply 读不到,回退占位。
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

      await client.connect()
      const unsubMessages = client.onMessage((evt: OnebotMessageEvent) => {
        void router.route(evt)
      })

      return () => {
        unregisterAgent()
        unregisterShell()
        unsubMessages()
        void client.disconnect()
      }
    },
  }
}

function makeDshExecutor(ctx: DshCtx) {
  const handle = wireDsh(ctx)
  if (handle) return new DshAgentExecutor(handle)
  // 无 DSH 服务时占位,便于纯 CLI/测试环境启动
  const fallback: DshServiceHandles = {
    async createAgent({ sessionId }) {
      void sessionId
      return {
        followup() {},
        async whenIdle() {},
        async done() {},
      }
    },
    async deliver() {},
    async readSurface() {
      return []
    },
  }
  return new DshAgentExecutor(fallback)
}

/** 把真实 DSH 服务包装成 DshServiceHandles。 */
function wireDsh(ctx: DshCtx): DshServiceHandles | undefined {
  const loop = ctx.agentLoop
  if (!loop) return undefined
  const query = ctx.sessionQuery

  return {
    async createAgent(options: { sessionId: string }): Promise<DshRenderedAgent> {
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
        async done() {
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
