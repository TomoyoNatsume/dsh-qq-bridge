import type { MessageTargetId } from './types.js'
import { randomUUID } from 'node:crypto'

export const NAPCAT_SELF_KEEPALIVE_MESSAGE = '[dsh-qq-bridge] keepalive'

export interface NapcatSelfKeepAliveOptions {
  enabled: boolean
  intervalMs: number
  message: string
  targetId: MessageTargetId
  sendPrivate(targetId: MessageTargetId, message: string, uid: string): Promise<unknown>
  createUid?: () => string
}

/** 定期让 NapCat 登录号给自己发消息，降低长期无活动账号被服务端回收的概率。 */
export function startNapcatSelfKeepAlive(options: NapcatSelfKeepAliveOptions): () => void {
  if (!options.enabled || options.targetId === 0 || options.targetId === '') return () => {}

  let consecutiveTimeouts = 0
  let loginState: 'unknown' | 'logged-in' | 'logged-out' = 'unknown'
  let inFlight = false

  const timer = setInterval(() => {
    if (inFlight) return
    inFlight = true
    const uid = (options.createUid ?? randomUUID)()
    const message = `${options.message} uid=${uid}`
    void options.sendPrivate(options.targetId, message, uid).then(() => {
      consecutiveTimeouts = 0
      if (loginState !== 'logged-in') {
        loginState = 'logged-in'
        console.info(`[dsh-qq-bridge] NapCat login status: logged-in (keepalive uid=${uid})`)
      }
    }).catch((err: unknown) => {
      if (isOnebotActionTimeout(err)) {
        consecutiveTimeouts += 1
        console.warn(`[dsh-qq-bridge] NapCat keepalive timeout ${consecutiveTimeouts}/3 (uid=${uid})`)
        if (consecutiveTimeouts >= 3 && loginState !== 'logged-out') {
          loginState = 'logged-out'
          console.warn('[dsh-qq-bridge] NapCat login status: logged-out (3 consecutive keepalive timeouts)')
        }
        return
      }
      consecutiveTimeouts = 0
      console.warn(`[dsh-qq-bridge] NapCat self keepalive failed: ${err instanceof Error ? err.message : String(err)}`)
    }).finally(() => {
      inFlight = false
    })
  }, options.intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

export function isNapcatSelfKeepAliveMessage(message: string, configuredMessage = NAPCAT_SELF_KEEPALIVE_MESSAGE): boolean {
  const value = message.trim()
  const prefix = configuredMessage.trim()
  return value === prefix || value.startsWith(`${prefix} uid=`)
}

function isOnebotActionTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === 'OnebotActionTimeoutError'
}
