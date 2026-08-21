import { describe, expect, it, vi } from 'vitest'
import { DshWebActivityGate, trackedWebSessionId } from '../src/web-activity.js'

describe('dsh-qq-bridge — Web activity gate', () => {
  it('tracks non-QQ top-level Web turns until turn/end', () => {
    const gate = new DshWebActivityGate()

    gate.observe({ id: 'web-1' }, { type: 'turn/start', data: { turn: 1 } })
    expect(gate.isBusy()).toBe(true)

    gate.observe({ id: 'web-1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    expect(gate.isBusy()).toBe(false)
  })

  it('ignores QQ-backed sessions and subagents', () => {
    const gate = new DshWebActivityGate()

    gate.observe({ id: 'qq-session-1' }, { type: 'turn/start', data: { turn: 1 } })
    gate.observe({ id: 'child', header: { origin: 'subagent' } }, { type: 'turn/start', data: { turn: 1 } })

    expect(gate.isBusy()).toBe(false)
    expect(trackedWebSessionId({ id: 'qq-session-1' })).toBeUndefined()
    expect(trackedWebSessionId({ id: 'child', header: { origin: 'subagent' } })).toBeUndefined()
  })

  it('runs queued tasks in FIFO order once Web activity is idle', async () => {
    const gate = new DshWebActivityGate()
    gate.observe({ id: 'web-1' }, { type: 'turn/start', data: { turn: 1 } })

    const order: string[] = []
    const first = gate.enqueueWhenIdle(async () => void order.push('first'))
    const second = gate.enqueueWhenIdle(async () => void order.push('second'))
    await Promise.resolve()

    expect(order).toEqual([])

    gate.observe({ id: 'web-1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await Promise.all([first, second])

    expect(order).toEqual(['first', 'second'])
  })

  it('registers and disposes a session/event listener', () => {
    const unsubscribe = vi.fn()
    const ctx = {
      on: vi.fn((_event: 'session/event', _cb: (subject: unknown, event: unknown) => void) => unsubscribe),
    }

    const registered = DshWebActivityGate.register(ctx)
    expect(ctx.on).toHaveBeenCalledWith('session/event', expect.any(Function))

    registered.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
