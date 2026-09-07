import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { describe, expect, it } from 'vitest'
import { probeNapcatLogin } from '../src/napcat-tags.js'

describe('NapCat login detection without sending QQ messages', () => {
  it.each([
    { online: true, account: 10001, expected: true },
    { online: false, account: 10001, expected: false },
    { online: undefined, account: 10001, expected: false },
    { online: true, account: 20002, expected: false },
  ])('checks account and status: %j', async ({ online, account, expected }) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    const actions: string[] = []
    server.on('connection', ws => {
      ws.on('message', raw => {
        const request = JSON.parse(raw.toString())
        actions.push(request.action)
        ws.send(JSON.stringify({ echo: request.echo, status: 'ok', retcode: 0,
          data: request.action === 'get_login_info' ? { user_id: account } : { online },
        }))
      })
    })
    try {
      const address = server.address() as { port: number }
      expect(await probeNapcatLogin(`ws://127.0.0.1:${address.port}`, '', 10001)).toBe(expected)
      expect(actions).toEqual(account === 10001 ? ['get_login_info', 'get_status'] : ['get_login_info'])
    } finally {
      server.close()
      for (const ws of server.clients) ws.terminate()
    }
  })
})
