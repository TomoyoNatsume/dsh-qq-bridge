/**
 * 独立的命令行/脚本入口 —— 便于本地验证与 M5 真机前的准备。
 *
 * 用法(在已 build 或经 tsx 运行时):
 *   DSH_QQ_WS_URL=ws://127.0.0.1:3001 \
 *   DSH_QQ_ADMIN=10001 \
 *   node dist/main.js
 *
 * 说明:
 *   - 依赖一个 onebot 正向 WS 端点(通常是本机 NapCat)。
 *   - 默认走「无真实 DSH」的 fallback executor:只把收到的 payload 原样回显,
 *     用于打通「QQ → AgentRpcHandler → 回发」链路,无需启动 DSH host。
 *     接入真实 DSH 时请改用 Cordis 插件入口(index.ts 的默认导出)。
 *   - 全部行为均可由环境变量覆盖,无需配置文件即可启动。
 */
import { OnebotClient, WsTransport } from './onebot/client.js'
import { MessageRouter } from './router.js'
import { AccessGate } from './security.js'
import { AgentRpcHandler } from './handlers/agent.js'
import { DshAgentExecutor } from './handlers/dsh-executor.js'
import { ShellHandler } from './handlers/shell.js'
import { DshQqBridgeConfig } from './config.js'
import { buildConnectGuidance } from './plugin.js'

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function main(): void {
  const cfg = DshQqBridgeConfig.parse({
    napcat: {
      wsUrl: process.env.DSH_QQ_WS_URL ?? 'ws://127.0.0.1:3001',
      token: process.env.DSH_QQ_TOKEN ?? undefined,
    },
    access: {
      adminQq: envInt('DSH_QQ_ADMIN', 0),
      allowlist: [],
      commandPrefix: process.env.DSH_QQ_PREFIX ?? '/dsh',
      mode: 'whitelist',
    },
  })

  const gate = new AccessGate({
    adminQq: cfg.access.adminQq,
    allowlist: cfg.access.allowlist,
    commandPrefix: cfg.access.commandPrefix,
    mode: cfg.access.mode,
  })

  const transport = new WsTransport(cfg.napcat.wsUrl, cfg.napcat.token)
  const client = new OnebotClient(transport)
  const router = new MessageRouter(gate, async (scope, targetId, text) => {
    if (scope === 'private') await client.sendPrivate(targetId, text)
    else await client.sendGroup(targetId, text)
  })

  // 本地验证用 fallback executor:无 DSH 也跑通,把最近一次 prompt 原样回显
  let lastPrompt = ''
  const fallback = {
    async getOrCreate() {
      return { followup() {}, async whenIdle() {}, async dispose() {} }
    },
    async deliver(_agent: unknown, prompt: string) {
      lastPrompt = prompt
    },
    async readSurface(): Promise<readonly unknown[]> {
      return [
        { type: 'assistant/message', content: [{ type: 'text', text: `echo: ${lastPrompt}` }] },
      ]
    },
  }
  const executor = new DshAgentExecutor(fallback as never)
  router.register(new AgentRpcHandler(executor))
  router.register(new ShellHandler(async (cmd: string) => ({ stdout: `(shell dev stub) ${cmd}`, code: 0 })))

  client
    .connect()
    .then(() => {
      console.log(`[dsh-qq-bridge] 已连接 ${cfg.napcat.wsUrl},prefix=${cfg.access.commandPrefix},admin=${cfg.access.adminQq}`)
      console.log('  发送「/dsh hello」到机器人小号即可看到回显(需真实 NapCat 登录)。')
    })
    .catch((err) => {
      console.error(buildConnectGuidance(cfg, err))
      process.exitCode = 1
      return
    })
  client.onMessage((evt) => void router.route(evt))

  const shutdown = () => {
    console.log('\n[dsh-qq-bridge] 关闭中…')
    void executor.disposeAll().finally(() => client.disconnect())
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
