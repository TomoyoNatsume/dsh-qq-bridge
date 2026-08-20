import { QQBot, type Logger, type QQBotInboundMessage, type ReplyTarget } from '@tencent-connect/qqbot-nodejs'
import type { OnebotMessageEvent, OnebotMessageType, MessageTargetId, PlatformReplyTarget } from '../onebot/types.js'

export interface TencentOfficialBotOptions {
  appId: string
  appSecret: string
  sandbox?: boolean
}

interface OfficialBotLike {
  on(event: 'ready', handler: (data: unknown) => void): this
  on(event: 'resumed', handler: (data: unknown) => void): this
  on(event: 'error', handler: (err: Error) => void): this
  on(event: 'message', handler: (ctx: unknown, msg: QQBotInboundMessage) => void | Promise<void>): this
  start(signal?: AbortSignal): Promise<void>
  stop(): void
  sendText(target: ReplyTarget, content: string): Promise<unknown>
  sendWakeup?(target: ReplyTarget, content: string): Promise<unknown>
}

const SDK_ERROR_ONLY_LOGGER: Logger = {
  info() {},
  warn() {},
  debug() {},
  error(msg) {
    console.error(msg)
  },
}

/** 腾讯官方 QQ 机器人 SDK 适配器:把官方事件转成桥接层内部消息事件。 */
export class TencentOfficialBotClient {
  private readonly bot: OfficialBotLike
  private readonly listeners = new Set<(evt: OnebotMessageEvent) => void>()
  private abort?: AbortController
  private started?: Promise<void>

  constructor(options: TencentOfficialBotOptions, bot?: OfficialBotLike) {
    this.bot = bot ?? new QQBot({
      appId: options.appId,
      appSecret: options.appSecret,
      ...(options.sandbox ? { baseUrl: 'https://sandbox.api.sgroup.qq.com' } : {}),
      logger: SDK_ERROR_ONLY_LOGGER,
    })
  }

  connect(): Promise<void> {
    if (this.started !== undefined) return this.started
    this.abort = new AbortController()
    this.started = new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }
      this.bot
        .on('ready', () => {
          console.info('[dsh-qq-bridge] official QQ bot connected')
          settle(resolve)
        })
        .on('resumed', () => {
          console.info('[dsh-qq-bridge] official QQ bot resumed')
          settle(resolve)
        })
        .on('error', (err) => {
          console.warn(`[dsh-qq-bridge] official QQ bot error: ${err.message}`)
          settle(() => reject(err))
        })
        .on('message', (_ctx, msg) => this.handleMessage(msg))

      this.bot.start(this.abort?.signal).catch((err: unknown) => {
        settle(() => reject(err instanceof Error ? err : new Error(String(err))))
      })
    })
    return this.started
  }

  onMessage(cb: (evt: OnebotMessageEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async sendPrivate(
    userId: MessageTargetId,
    message: string,
    replyTarget?: PlatformReplyTarget,
  ): Promise<void> {
    const key = String(userId)
    const target = officialReplyTarget(replyTarget, 'c2c') ?? { scope: 'c2c', targetId: key }
    if (target.msgId === undefined && this.bot.sendWakeup) {
      await this.bot.sendWakeup(target, message)
      return
    }
    await this.bot.sendText(target, message)
  }

  async sendGroup(
    groupId: MessageTargetId,
    message: string,
    replyTarget?: PlatformReplyTarget,
  ): Promise<void> {
    const key = String(groupId)
    const target = officialReplyTarget(replyTarget, 'group') ?? { scope: 'group', targetId: key }
    await this.bot.sendText(target, message)
  }

  async disconnect(): Promise<void> {
    this.listeners.clear()
    this.abort?.abort()
    this.abort = undefined
    this.started = undefined
    this.bot.stop()
  }

  private handleMessage(msg: QQBotInboundMessage): void {
    const event = toBridgeMessageEvent(msg)
    if (event === null) return
    console.info(`[dsh-qq-bridge] official QQ message from ${event.user_id} (${event.message_type})`)
    for (const cb of this.listeners) cb(event)
  }
}

export function toBridgeMessageEvent(msg: QQBotInboundMessage): OnebotMessageEvent | null {
  const scope = officialScopeToBridgeScope(msg.replyTarget.scope)
  if (scope === null) return null
  const groupId = scope === 'group' ? msg.replyTarget.targetId : undefined
  return {
    post_type: 'message',
    message_type: scope,
    user_id: msg.senderId,
    ...(groupId === undefined ? {} : { group_id: groupId }),
    raw_message: msg.content,
    message_id: msg.messageId,
    reply_target: {
      platform: 'official',
      scope: msg.replyTarget.scope,
      targetId: msg.replyTarget.targetId,
      ...(msg.replyTarget.msgId === undefined ? {} : { msgId: msg.replyTarget.msgId }),
    },
  }
}

function officialScopeToBridgeScope(scope: string): OnebotMessageType | null {
  if (scope === 'c2c') return 'private'
  if (scope === 'group') return 'group'
  return null
}

function officialReplyTarget(
  target: PlatformReplyTarget | undefined,
  scope: ReplyTarget['scope'],
): ReplyTarget | undefined {
  if (target?.platform !== 'official' || target.scope !== scope) return undefined
  return {
    scope,
    targetId: target.targetId,
    ...(target.msgId === undefined ? {} : { msgId: target.msgId }),
  }
}
