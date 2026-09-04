import { MessageTargetId, OnebotActionResponse, OnebotMessageEvent, PlatformReplyTarget } from './types.js'
import { WebSocket, RawData } from 'ws'

/**
 * 极简 WS 传输抽象,便于在测试中注入 mock(本地回环仿真),无需真实连接 NapCat。
 */
export interface Transport {
  readonly connected: boolean
  /** 建立后端连接 */
  connect(): Promise<void>
  /** 发一个 JSON 帧 */
  send(frame: Record<string, unknown>): Promise<void>
  /** 订阅收到的 JSON 帧 */
  onFrame(cb: (frame: Record<string, unknown>) => void): () => void
  dispose(): Promise<void>
}

function normalizeToken(token: string | undefined): string | undefined {
  const trimmed = token?.trim()
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return undefined
  return trimmed
}

/**
 * 基于 `ws` 库的默认传输实现(连接 NapCat 的 onebot 正向 WS)。
 * 内置断线自动重连:`connect()` 在首次连上时 resolve;首次失败则 reject(供上层打引导),
 * 此后后台仍按退避自动重连。已在运行的连接意外断开也会自动重连,无需上层干预。
 */
export class WsTransport implements Transport {
  private ws: import('ws').WebSocket | null = null
  private listeners = new Set<(frame: Record<string, unknown>) => void>()
  private disposed = false
  private retryTimer: NodeJS.Timeout | null = null
  private attempts = 0
  /** 首个连接尝试是否已经给出最终结论(open resolve / error reject)。 */
  private initialSettled = false
  private settleInitial: ((resolve: boolean) => void) | null = null
  private readonly authToken: string | undefined

  constructor(private readonly url: string, token?: string) {
    this.authToken = normalizeToken(token)
  }

  get connected(): boolean {
    return this.ws?.readyState === 1 // OPEN
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve()
    this.disposed = false
    return new Promise<void>((resolve, reject) => {
      this.settleInitial = (ok: boolean) => (ok ? resolve() : reject(new Error(`onebot ws connect failed: ${this.url}`)))
      this.openSocket(true)
    })
  }

  private openSocket(firstAttempt: boolean): void {
    if (this.disposed) return
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url, {
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : undefined,
      })
    } catch {
      this.handleError()
      return
    }
    this.ws = ws
    ws.on('open', () => {
      if (this.disposed) {
        try { ws.close() } catch { /* noop */ }
        return
      }
      this.attempts = 0 // 成功即重置退避
      console.info(`[dsh-qq-bridge] onebot ws connected: ${this.url}`)
      if (firstAttempt) this.resolveInitial(true)
    })
    ws.on('message', (data: RawData) => {
      try {
        const frame = JSON.parse(String(data)) as Record<string, unknown>
        for (const cb of this.listeners) cb(frame)
      } catch {
        // 忽略非 JSON 帧
      }
    })
    ws.on('error', () => this.handleError())
    ws.on('close', () => {
      this.handleClose()
    })
  }

  private resolveInitial(ok: boolean): void {
    if (this.initialSettled) return
    this.initialSettled = true
    const fn = this.settleInitial
    this.settleInitial = null
    fn?.(ok)
  }

  private handleError(): void {
    if (this.initialSettled === false) this.resolveInitial(false) // 首次连接失败 -> reject
    this.scheduleRetry()
  }

  private handleClose(): void {
    this.ws = null
    if (this.disposed) return
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer) return
    this.attempts += 1
    const delay = Math.min(500 * 2 ** this.attempts, 15000)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.openSocket(false)
    }, delay)
  }

  send(frame: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws) return reject(new Error('ws not connected'))
      this.ws.send(JSON.stringify(frame), (err) => (err ? reject(err) : resolve()))
    })
  }

  onFrame(cb: (frame: Record<string, unknown>) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  dispose(): Promise<void> {
    return new Promise((resolve) => {
      this.disposed = true
      this.initialSettled = false
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      }
      this.ws?.close()
      this.ws = null
      this.listeners.clear()
      this.settleInitial = null
      this.attempts = 0
      resolve()
    })
  }
}

/**
 * OneBot 客户端:负责收发消息事件、发送动作。
 * 运输层可注入,便于本地回环测试。
 */
export class OnebotClient {
  private unsub: (() => void) | null = null
  private readonly pendingActions = new Map<string, {
    resolve(response: OnebotActionResponse): void
    reject(error: Error): void
    timer: NodeJS.Timeout
  }>()

  constructor(
    private readonly transport: Transport,
    /** 动作回调路径;默认按协议拼 JSON。可用 in-memory 替换以测试回发。 */
    private readonly sendAction?: (frame: Record<string, unknown>) => Promise<void>,
  ) {}

  async connect(): Promise<void> {
    await this.transport.connect()
    this.unsub = this.transport.onFrame((frame) => this.handleFrame(frame))
  }

  onMessage(cb: (evt: OnebotMessageEvent) => void): () => void {
    return this.transport.onFrame((frame) => {
      if (frame.post_type === 'message') cb(frame as unknown as OnebotMessageEvent)
    })
  }

  private handleFrame(frame: Record<string, unknown>): void {
    if (typeof frame.echo !== 'string') return
    const pending = this.pendingActions.get(frame.echo)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingActions.delete(frame.echo)
    pending.resolve(frame as unknown as OnebotActionResponse)
  }

  /** 发送私聊并等待相同 echo 的 OneBot 动作响应，供保活健康探测使用。 */
  async sendPrivateAndWait(
    userId: MessageTargetId,
    message: string,
    timeoutMs: number,
    uid: string,
  ): Promise<OnebotActionResponse> {
    const echo = `keepalive_${uid}`
    const response = new Promise<OnebotActionResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingActions.delete(echo)
        reject(new OnebotActionTimeoutError(echo, timeoutMs))
      }, timeoutMs)
      timer.unref?.()
      this.pendingActions.set(echo, { resolve, reject, timer })
    })
    try {
      await this.flush({ action: 'send_private_msg', params: { user_id: userId, message }, echo })
    } catch (err) {
      const pending = this.pendingActions.get(echo)
      if (pending) clearTimeout(pending.timer)
      this.pendingActions.delete(echo)
      throw err
    }
    const result = await response
    if (result.status !== 'ok' || result.retcode !== 0) {
      throw new Error(`OneBot send failed: retcode=${result.retcode}`)
    }
    return result
  }

  async sendPrivate(
    userId: MessageTargetId,
    message: string,
    _replyTarget?: PlatformReplyTarget,
  ): Promise<OnebotActionResponse> {
    const frame = { action: 'send_private_msg', params: { user_id: userId, message }, echo: `p_${Date.now()}` }
    await this.flush(frame)
    return { status: 'ok', retcode: 0, data: null }
  }

  async sendGroup(
    groupId: MessageTargetId,
    message: string,
    _replyTarget?: PlatformReplyTarget,
  ): Promise<OnebotActionResponse> {
    const frame = { action: 'send_group_msg', params: { group_id: groupId, message }, echo: `g_${Date.now()}` }
    await this.flush(frame)
    return { status: 'ok', retcode: 0, data: null }
  }

  private async flush(frame: Record<string, unknown>): Promise<void> {
    if (this.sendAction) {
      await this.sendAction(frame)
    } else {
      await this.transport.send(frame)
    }
  }

  async disconnect(): Promise<void> {
    for (const pending of this.pendingActions.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('onebot client disconnected'))
    }
    this.pendingActions.clear()
    this.unsub?.()
    this.unsub = null
    await this.transport.dispose()
  }
}

export class OnebotActionTimeoutError extends Error {
  override readonly name = 'OnebotActionTimeoutError'

  constructor(readonly echo: string, readonly timeoutMs: number) {
    super(`OneBot action timeout after ${timeoutMs}ms: ${echo}`)
  }
}
