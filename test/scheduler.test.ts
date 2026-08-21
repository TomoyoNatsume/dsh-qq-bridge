import { afterEach, describe, expect, it, vi } from 'vitest'
import { QqControlDispatcher } from '../src/handlers/control.js'
import { createSaveMemoControlHandler, LazyCustomMemoryStore } from '../src/handlers/custom-memory.js'
import { createScheduleTaskControlHandler, InMemoryTaskScheduler } from '../src/handlers/scheduler.js'

describe('dsh-qq-bridge — scheduled tasks', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates an in-memory timer and triggers the same QQ session agent at runAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T10:00:00+08:00'))
    const run = vi.fn(async () => '该提交报告了')
    const sent: string[] = []
    const scheduler = new InMemoryTaskScheduler({
      executor: { run },
      send: async (_target, text) => void sent.push(text),
    })
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createScheduleTaskControlHandler(scheduler))

    const message = await dispatcher.dispatch(
      {
        action: 'schedule_task',
        runAt: '2026-08-21T10:00:01+08:00',
        message: '提醒我提交报告',
      },
      {
        sessionKey: 'private:10001',
        source: {
          userId: 10001,
          scope: 'private',
          payload: '',
          async respond() {},
        },
      },
    )

    expect(message).toContain('已创建定时任务: 2026-08-21T10:00:01+08:00')
    expect(scheduler.size).toBe(1)

    await vi.advanceTimersByTimeAsync(1000)

    expect(run).toHaveBeenCalledWith(
      'private:10001',
      expect.stringContaining('提醒我提交报告'),
    )
    expect(sent).toEqual(['该提交报告了'])
    expect(scheduler.size).toBe(0)
    scheduler.dispose()
  })

  it('rejects past scheduled task times', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T10:00:00+08:00'))
    const scheduler = new InMemoryTaskScheduler({
      executor: { run: vi.fn(async () => 'unused') },
      send: vi.fn(async () => {}),
    })
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createScheduleTaskControlHandler(scheduler))

    const message = await dispatcher.dispatch(
      {
        action: 'schedule_task',
        runAt: '2026-08-21T09:59:59+08:00',
        message: '过去的提醒',
      },
      {
        sessionKey: 'private:10001',
        source: {
          userId: 10001,
          scope: 'private',
          payload: '',
          async respond() {},
        },
      },
    )

    expect(message).toContain('定时任务创建失败')
    expect(message).toContain('必须晚于当前时间')
    expect(scheduler.size).toBe(0)
    scheduler.dispose()
  })

  it('persists timers and only arms long timers after a scan brings them into the window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T10:00:00+08:00'))
    const domain = new FakeStorageDomain()
    const store = new LazyCustomMemoryStore(() => domain)
    const run = vi.fn(async () => '该提交报告了')
    const sent: string[] = []
    const scheduler = new InMemoryTaskScheduler({
      executor: { run },
      store,
      scanWindowMs: 2 * 60 * 60 * 1000,
      send: async (_target, text) => void sent.push(text),
    })
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createScheduleTaskControlHandler(scheduler))

    const message = await dispatcher.dispatch(
      {
        action: 'schedule_task',
        runAt: '2026-08-21T13:00:00+08:00',
        message: '提醒我提交报告',
      },
      {
        sessionKey: 'private:10001',
        source: {
          userId: 10001,
          scope: 'private',
          payload: '',
          async respond() {},
        },
      },
    )

    expect(message).toContain('已创建定时任务')
    expect(scheduler.size).toBe(0)
    expect(domain.tableValues('timers')[0]).toMatchObject({
      type: 'timer',
      time: '2026-08-21T13:00:00+08:00',
      content: '提醒我提交报告',
      status: 'pending',
    })

    vi.setSystemTime(new Date('2026-08-21T11:00:00+08:00'))
    await scheduler.scanDueTasks()
    expect(scheduler.size).toBe(1)

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)

    expect(run).toHaveBeenCalledWith('private:10001', expect.stringContaining('提醒我提交报告'))
    expect(sent).toEqual(['该提交报告了'])
    expect(domain.tableValues('timers')[0]).toMatchObject({ status: 'fired' })
    await store.close()
    scheduler.dispose()
  })

  it('persists memo control blocks through the custom memory store', async () => {
    const domain = new FakeStorageDomain()
    const store = new LazyCustomMemoryStore(() => domain)
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createSaveMemoControlHandler(store))

    const message = await dispatcher.dispatch(
      { action: 'save_memo', content: '2026/07/08 日收入 350 元' },
      {
        sessionKey: 'private:10001',
        source: {
          userId: 10001,
          scope: 'private',
          payload: '',
          async respond() {},
        },
      },
    )

    expect(message).toContain('已记录 memo')
    expect(domain.tableValues('memos')[0]).toMatchObject({
      type: 'memo',
      content: '2026/07/08 日收入 350 元',
      sessionKey: 'private:10001',
      scope: 'private',
      targetId: 10001,
    })
    await store.close()
  })
})

class FakeStorageDomain {
  readonly tables = new Map<string, FakeTable>()

  async open(spec: unknown): Promise<{ table(name: string): FakeTable; close(): Promise<void> }> {
    const tableNames = Object.keys((spec as { tables: Record<string, unknown> }).tables)
    for (const name of tableNames) {
      if (!this.tables.has(name)) this.tables.set(name, new FakeTable())
    }
    return {
      table: (name: string) => this.tables.get(name) ?? new FakeTable(),
      async close() {},
    }
  }

  tableValues(name: string): unknown[] {
    return [...(this.tables.get(name)?.entries() ?? [])].map(([, value]) => value)
  }
}

class FakeTable {
  private readonly records = new Map<string, unknown>()

  get(key: string): unknown {
    return this.records.get(key)
  }

  entries(): IterableIterator<[string, unknown]> {
    return this.records.entries()
  }

  keys(): IterableIterator<string> {
    return this.records.keys()
  }

  get size(): number {
    return this.records.size
  }

  async put(key: string, value: unknown): Promise<void> {
    this.records.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.records.delete(key)
  }

  async update(key: string, fn: (current: unknown) => unknown): Promise<unknown> {
    const next = fn(this.records.get(key))
    this.records.set(key, next)
    return next
  }
}
