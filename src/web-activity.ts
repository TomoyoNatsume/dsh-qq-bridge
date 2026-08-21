interface DshSessionSubjectLike {
  id?: unknown
  header?: { origin?: unknown }
}

interface DshSessionEventSource {
  on?(
    event: 'session/event',
    cb: (subject: DshSessionSubjectLike, event: unknown) => void,
  ): () => void
}

type TurnKey = number | string
const UNKNOWN_TURN_KEY = '__unknown_turn__'

export interface AgentRunGate {
  isBusy(): boolean
  enqueueWhenIdle<T>(task: () => Promise<T>): Promise<T>
}

export class DshWebActivityGate implements AgentRunGate {
  private readonly activeTurns = new Map<string, Set<TurnKey>>()
  private readonly waiters: Array<() => void> = []
  private tail: Promise<void> = Promise.resolve()

  static register(ctx: DshSessionEventSource): { gate: DshWebActivityGate; dispose(): void } {
    const gate = new DshWebActivityGate()
    const dispose = ctx.on?.('session/event', (subject, event) => {
      gate.observe(subject, event)
    }) ?? (() => {})
    return { gate, dispose }
  }

  observe(subject: DshSessionSubjectLike, event: unknown): void {
    const sessionId = trackedWebSessionId(subject)
    if (!sessionId) return

    if (isTurnStart(event)) {
      const turns = this.activeTurns.get(sessionId) ?? new Set<TurnKey>()
      turns.add(turnKeyOf(event) ?? UNKNOWN_TURN_KEY)
      this.activeTurns.set(sessionId, turns)
      return
    }

    if (!isTurnEnd(event)) return
    const turns = this.activeTurns.get(sessionId)
    if (!turns) return
    const turnKey = turnKeyOf(event)
    if (turnKey === undefined) turns.clear()
    else turns.delete(turnKey)
    if (turns.size === 0) this.activeTurns.delete(sessionId)
    this.flushIfIdle()
  }

  isBusy(): boolean {
    return this.activeTurns.size > 0
  }

  async enqueueWhenIdle<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      await this.waitForIdle()
      return await task()
    }
    const result = this.tail.then(run, run)
    this.tail = result.then(() => undefined, () => undefined)
    return await result
  }

  private waitForIdle(): Promise<void> {
    if (!this.isBusy()) return Promise.resolve()
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }

  private flushIfIdle(): void {
    if (this.isBusy()) return
    const waiters = this.waiters.splice(0)
    for (const resolve of waiters) resolve()
  }
}

export function trackedWebSessionId(subject: DshSessionSubjectLike): string | undefined {
  const sessionId = typeof subject.id === 'string' ? subject.id : ''
  if (!sessionId || sessionId.startsWith('qq-')) return undefined
  if (subject.header?.origin === 'subagent') return undefined
  return sessionId
}

function isTurnStart(event: unknown): event is { type: 'turn/start'; data?: { turn?: TurnKey } } {
  return (event as { type?: unknown } | null)?.type === 'turn/start'
}

function isTurnEnd(event: unknown): event is { type: 'turn/end'; data?: { turn?: TurnKey } } {
  return (event as { type?: unknown } | null)?.type === 'turn/end'
}

function turnKeyOf(event: { data?: { turn?: TurnKey } }): TurnKey | undefined {
  const turn = event.data?.turn
  return typeof turn === 'number' || typeof turn === 'string' ? turn : undefined
}
