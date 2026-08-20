import { randomBytes } from 'node:crypto'
import { QQBot, type Logger, type QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs'

export interface OfficialPairingOptions {
  appId: string
  appSecret: string
  sandbox: boolean
  pairCommand: string
  successMessage?: string
  timeoutMs?: number
  onReady?: () => void
}

interface OfficialPairingBotLike {
  on(event: 'ready', handler: (data: unknown) => void): this
  on(event: 'resumed', handler: (data: unknown) => void): this
  on(event: 'error', handler: (err: Error) => void): this
  on(event: 'message', handler: (ctx: unknown, msg: QQBotInboundMessage) => void | Promise<void>): this
  start(signal?: AbortSignal): Promise<void>
  stop(): void
  sendText(target: QQBotInboundMessage['replyTarget'], content: string): Promise<unknown>
}

const ERROR_ONLY_LOGGER: Logger = {
  info() {},
  warn() {},
  debug() {},
  error(msg) {
    console.error(msg)
  },
}

export function createOfficialPairCode(): string {
  return randomBytes(3).toString('hex').toUpperCase()
}

export async function pairOfficialAdmin(
  options: OfficialPairingOptions,
  bot?: OfficialPairingBotLike,
): Promise<string> {
  const client = bot ?? new QQBot({
    appId: options.appId,
    appSecret: options.appSecret,
    ...(options.sandbox ? { baseUrl: 'https://sandbox.api.sgroup.qq.com' } : {}),
    logger: ERROR_ONLY_LOGGER,
  })
  const timeoutMs = options.timeoutMs ?? 120_000
  const successMessage = options.successMessage ?? '配对成功'
  const abort = new AbortController()

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      settle(() => reject(new Error(`等待配对消息超时，请确认已给机器人发送: ${options.pairCommand}`)))
    }, timeoutMs)

    const settle = (finish: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      abort.abort()
      try {
        client.stop()
      } catch {
        // stop best effort:setup 即将退出临时配对监听。
      }
      finish()
    }

    client
      .on('ready', () => {
        options.onReady?.()
      })
      .on('resumed', () => {
        options.onReady?.()
      })
      .on('error', (err) => {
        settle(() => reject(err))
      })
      .on('message', (_ctx, msg) => {
        if (normalizePairingText(msg.content) !== normalizePairingText(options.pairCommand)) return
        void replyAndResolvePairing(client, msg, successMessage, (finish) => settle(finish), resolve)
      })

    client.start(abort.signal).catch((err: unknown) => {
      settle(() => reject(err instanceof Error ? err : new Error(String(err))))
    })
  })
}

async function replyAndResolvePairing(
  client: OfficialPairingBotLike,
  msg: QQBotInboundMessage,
  successMessage: string,
  settle: (finish: () => void) => void,
  resolve: (openid: string) => void,
): Promise<void> {
  try {
    await client.sendText(msg.replyTarget, successMessage)
  } catch (err) {
    console.warn(`配对成功，但回复 QQ 配对确认失败: ${err instanceof Error ? err.message : String(err)}`)
  }
  settle(() => resolve(msg.senderId))
}

function normalizePairingText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}
