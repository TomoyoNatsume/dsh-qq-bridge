import { describe, it, expect } from 'vitest'
import { WsTransport } from '../src/onebot/client.js'
import { WebSocketServer, WebSocket } from 'ws'

/** 启动一个本地 onebot 风格 WS server,收集连接与收到的帧。 */
async function startServer() {
  const wss = new WebSocketServer({ port: 0 })
  await new Promise<void>((r) => wss.on('listening', () => r()))
  const port = (wss.address() as { port: number }).port
  const clients = new Set<WebSocket>()
  const seen: Record<string, unknown>[] = []
  wss.on('connection', (ws) => {
    clients.add(ws)
    ws.on('message', (data) => {
      try {
        seen.push(JSON.parse(String(data)))
      } catch { /* ignore */ }
    })
    ws.on('close', () => clients.delete(ws))
  })
  return {
    url: `ws://127.0.0.1:${port}`,
    clients,
    seen,
    get clientCount() {
      return clients.size
    },
    close() {
      return new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}

describe('dsh-qq-bridge — WsTransport 断线自动重连', () => {
  it('首次连接成功后,对端断开会自动重连并继续收发', async () => {
    const server = await startServer()
    const t = new WsTransport(server.url)
    try {
      await t.connect()
      expect(t.connected).toBe(true)

      // 发一个帧,服务端能收到
      await t.send({ action: 'get_login_info', echo: '1' })
      await new Promise((r) => setTimeout(r, 100))
      expect(server.seen).toHaveLength(1)

      // 断开所有客户端(模拟 NapCat/服务端重启)
      for (const c of [...server.clients]) c.terminate()
      await new Promise((r) => setTimeout(r, 100))
      expect(t.connected).toBe(false)

      // 等待自动重连成功(退避间隔内)
      const deadline = Date.now() + 5000
      while (!t.connected && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
      expect(t.connected).toBe(true)

      // 重连后新客户端能收到帧
      await t.send({ action: 'send_private_msg', params: { user_id: 1, message: 'hi' }, echo: '2' })
      await new Promise((r) => setTimeout(r, 100))
      const msgs = server.seen.map((f) => (f as { action?: string }).action)
      expect(msgs).toEqual(['get_login_info', 'send_private_msg'])
    } finally {
      await t.dispose()
      await server.close()
    }
  })

  it('dispose 后不再重连', async () => {
    const server = await startServer()
    const t = new WsTransport(server.url)
    await t.connect()
    expect(t.connected).toBe(true)
    await t.dispose()
    expect(t.connected).toBe(false)
    const countBefore = server.clientCount
    // 模拟对端断开,确认 dispose 后不自动重连
    for (const c of [...server.clients]) c.terminate()
    await new Promise((r) => setTimeout(r, 300))
    expect(server.clientCount).toBeLessThan(countBefore + 1)
    expect(t.connected).toBe(false)
    await server.close()
  })
})
