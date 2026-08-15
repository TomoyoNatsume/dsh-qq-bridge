import { OnebotActionResponse, OnebotMessageEvent } from './types.js'

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

  constructor(private readonly url: string, private readonly token?: string) {}

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
    void import('ws').then(({ WebSocket }) => {
      if (this.disposed) return
      let ws: import('ws').WebSocket
      try {
        ws = new WebSocket(this.url, {
          headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
        })
      } catch (err) {
        this.handleError('ws-new-failed', err)
        return
      }
      this.ws = ws
      ws.on('open', () => {
        if (this.disposed) {
          try { ws.close() } catch { /* noop */ }
          return
        }
        this.attempts = 0 // 成功即重置退避
        if (firstAttempt) this.resolveInitial(true)
      })
      ws.on('message', (data: import('ws').RawData) => {
        try {
          const frame = JSON.parse(String(data)) as Record<string, unknown>
          for (const cb of this.listeners) cb(frame)
        } catch {
          // 忽略非 JSON 帧
        }
      })
      ws.on('error', (err) => this.handleError('ws-error', err))
      ws.on('close', () => this.handleClose())
    })
  }

  private resolveInitial(ok: boolean): void {
    if (this.initialSettled) return
    this.initialSettled = true
    const fn = this.settleInitial
    this.settleInitial = null
    fn?.(ok)
  }

  private handleError(reason: string, err: unknown): void {
    void reason
    void err
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
    // 目前事件透传由 onMessage 完成;这里保留扩展点(处理 echo/action 响应等)
    if (frame.echo !== undefined) return
  }

  async sendPrivate(userId: number, message: string): Promise<OnebotActionResponse> {
    const frame = { action: 'send_private_msg', params: { user_id: userId, message }, echo: `p_${Date.now()}` }
    await this.flush(frame)
    return { status: 'ok', retcode: 0, data: null }
  }

  async sendGroup(groupId: number, message: string): Promise<OnebotActionResponse> {
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
    this.unsub?.()
    this.unsub = null
    await this.transport.dispose()
  }
}
