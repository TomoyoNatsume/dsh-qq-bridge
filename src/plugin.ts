import { OnebotClient, WsTransport, Transport } from './onebot/client.js'
import { MessageRouter, OutboundSender } from './router.js'
import { AccessGate } from './security.js'
import { AgentRpcHandler, AgentExecutor } from './handlers/agent.js'
import { ShellHandler } from './handlers/shell.js'
import { DshQqBridgeConfig } from './config.js'
import { OnebotMessageEvent } from './onebot/types.js'

/**
 * Cordis 插件入口(Host 侧)。独立开源工程的插件定义。
 *
 * M1 说明:核心模块(OnebotClient/router/security/handlers)均已独立可测;
 * 这里给出完整接线。DSH services(agents/agentLoop)的注入在 M2 真正接通,
 * M1 用占位 AgentExecutor 保证可启动、可做连通测试。
 */
export default function (options: DshQqBridgeConfig) {
  const cfg = DshQqBridgeConfig.parse(options)

  return {
    name: 'dsh-qq-bridge',
    async apply(ctx: Record<string, unknown>): Promise<() => void> {
      const gate = new AccessGate({
        adminQq: cfg.access.adminQq,
        allowlist: cfg.access.allowlist,
        commandPrefix: cfg.access.commandPrefix,
        mode: cfg.access.mode,
      })

      // 回复发送器
      const outbound: OutboundSender = async (scope, targetId, text) => {
        if (scope === 'private') await client.sendPrivate(targetId, text)
        else await client.sendGroup(targetId, text)
      }

      const router = new MessageRouter(gate, outbound)

      // DSH Agent 执行器(占位;M2 接入 agents/agentLoop)
      const executor: AgentExecutor = makeAgentExecutor(ctx)
      const unregisterAgent = router.register(new AgentRpcHandler(executor))
      const unregisterShell = cfg.shell.enabled
        ? router.register(new ShellHandler(async (cmd: string) => ({ stdout: `(shell disabled in M1) ${cmd}` })))
        : () => {}

      // onebot 连接
      const transport: Transport = new WsTransport(cfg.napcat.wsUrl, cfg.napcat.token)
      const client = new OnebotClient(transport)
      await client.connect()

      // 订阅消息 → router.route
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

function makeAgentExecutor(_ctx: Record<string, unknown>): AgentExecutor {
  // TODO(M2): 接入 DSH services.agents.create/resume + agentLoop。
  return {
    async run(_sessionKey: string, payload: string): Promise<string> {
      return `[agent placeholder] received: ${payload}`
    },
  }
}
