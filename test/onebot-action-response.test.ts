import { describe, expect, it, vi } from 'vitest'
import { OnebotActionTimeoutError, OnebotClient, type Transport } from '../src/onebot/client.js'

class ResponseTransport implements Transport {
  connected = true
  sent: Record<string, unknown>[] = []
  private listeners = new Set<(frame: Record<string, unknown>) => void>()
  async connect() {}
  async send(frame: Record<string, unknown>) { this.sent.push(frame) }
  onFrame(cb: (frame: Record<string, unknown>) => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  push(frame: Record<string, unknown>) { for (const cb of this.listeners) cb(frame) }
  async dispose() { this.connected = false }
}

describe('OnebotClient action responses', () => {
  it('resolves only the response with the matching keepalive echo', async () => {
    const transport = new ResponseTransport()
    const client = new OnebotClient(transport)
    await client.connect()
    const result = client.sendPrivateAndWait(10001, 'keepalive uid=u1', 2_000, 'u1')
    await Promise.resolve()
    expect(transport.sent[0].echo).toBe('keepalive_u1')
    transport.push({ status: 'ok', retcode: 0, data: { message_id: 1 }, echo: 'keepalive_u1' })
    await expect(result).resolves.toMatchObject({ status: 'ok', retcode: 0 })
  })

  it('rejects after two seconds without an action response', async () => {
    vi.useFakeTimers()
    const transport = new ResponseTransport()
    const client = new OnebotClient(transport)
    await client.connect()
    const result = client.sendPrivateAndWait(10001, 'keepalive uid=u2', 2_000, 'u2')
    const assertion = expect(result).rejects.toBeInstanceOf(OnebotActionTimeoutError)
    await vi.advanceTimersByTimeAsync(2_000)
    await assertion
    vi.useRealTimers()
  })
})
