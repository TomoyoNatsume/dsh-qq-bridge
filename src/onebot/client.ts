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
 */
export class WsTransport implements Transport {
  private ws: import('ws').WebSocket | null = null
  private listeners = new Set<(frame: Record<string, unknown>) => void>()

  constructor(private readonly url: string, private readonly token?: string) {}

  get connected(): boolean {
    return this.ws?.readyState === 1 // OPEN
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 动态 import,设备依赖保留可选;测试走 mock transport
      void import('ws').then(({ WebSocket }) => {
        const ws = new WebSocket(this.url, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined })
        this.ws = ws
        ws.on('open', () => resolve())
        ws.on('message', (data: import('ws').RawData) => {
          try {
            const frame = JSON.parse(String(data)) as Record<string, unknown>
            for (const cb of this.listeners) cb(frame)
          } catch {
            // 忽略非 JSON 帧
          }
        })
        ws.on('error', (err) => reject(err))
        ws.on('close', () => {
          this.ws = null
        })
      })
    })
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
      this.ws?.close()
      this.ws = null
      this.listeners.clear()
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
