import { afterEach, describe, expect, it, vi } from 'vitest'
import { QqControlDispatcher } from '../src/handlers/control.js'
import { createSaveMemoControlHandler, LazyCustomMemoryStore } from '../src/handlers/custom-memory.js'
import { createScheduleTaskControlHandler, InMemoryTaskScheduler } from '../src/handlers/scheduler.js'

describe('dsh-qq-bridge — scheduled tasks', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates an in-memory timer and triggers the source agent session at runAt', async () => {
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
      time: '2026-08-21T13:00:00+08:00',
      content: '提醒我提交报告',
      sourceSessionKey: 'private:10001',
      scope: 'private',
      targetId: 10001,
      status: 'pending',
    })
    expect(domain.tableValues('timers')[0]).not.toHaveProperty('sessionKey')
    expect(domain.tableValues('timers')[0]).not.toHaveProperty('type')

    vi.setSystemTime(new Date('2026-08-21T11:00:00+08:00'))
    await scheduler.scanDueTasks()
    expect(scheduler.size).toBe(1)

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)

    expect(run).toHaveBeenCalledWith('private:10001', expect.stringContaining('提醒我提交报告'))
    expect(sent).toEqual(['该提交报告了'])
    expect(domain.tableValues('timers')).toEqual([])
    await store.close()
    scheduler.dispose()
  })

  it('persists memo control blocks through the custom memory store', async () => {
    const domain = new FakeStorageDomain()
    const store = new LazyCustomMemoryStore(() => domain)
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createSaveMemoControlHandler(store))

    const message = await dispatcher.dispatch(
      { action: 'save_memo', key: '2026/07/08 日收入', content: '2026/07/08 日收入 350 元' },
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
      key: '2026/07/08 日收入',
      content: '2026/07/08 日收入 350 元',
      sourceSessionKey: 'private:10001',
      scope: 'private',
      targetId: 10001,
    })
    expect(domain.tableValues('memos')[0]).not.toHaveProperty('sessionKey')
    expect(domain.tableValues('memos')[0]).not.toHaveProperty('type')
    await store.close()
  })

  it('updates the same memo item by target and key', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T10:00:00+08:00'))
    const domain = new FakeStorageDomain()
    const store = new LazyCustomMemoryStore(() => domain)
    const dispatcher = new QqControlDispatcher()
    dispatcher.register(createSaveMemoControlHandler(store))
    const ctx = {
      sessionKey: 'private:10001',
      source: {
        userId: 10001,
        scope: 'private' as const,
        payload: '',
        async respond() {},
      },
    }

    await dispatcher.dispatch(
      { action: 'save_memo', key: 'TCL电视价格', content: 'TCL电视价格为3200' },
      ctx,
    )
    vi.setSystemTime(new Date('2026-08-21T10:05:00+08:00'))
    await dispatcher.dispatch(
      { action: 'save_memo', key: 'TCL电视价格', content: 'TCL电视价格为4000' },
      ctx,
    )

    expect(domain.tableValues('memos')).toHaveLength(1)
    expect(domain.tableValues('memos')[0]).toMatchObject({
      key: 'TCL电视价格',
      content: 'TCL电视价格为4000',
      sourceSessionKey: 'private:10001',
      scope: 'private',
      targetId: 10001,
      updatedAt: '2026-08-21T02:05:00.000Z',
    })
    await store.close()
  })

  it('normalizes legacy sessionKey records to sourceSessionKey', async () => {
    const domain = new FakeStorageDomain()
    const store = new LazyCustomMemoryStore(() => domain)
    await domain.open({
      tables: {
        timers: {},
        memos: {},
      },
    })
    await domain.table('memos').put('legacy-memo', {
      uuid: 'legacy-memo',
      type: 'memo',
      content: '旧 memo',
      sessionKey: 'private:10001',
      scope: 'private',
      targetId: 10001,
      createdAt: '2026-08-21T10:00:00.000Z',
    })

    expect(await store.listMemos()).toEqual([
      expect.objectContaining({
        uuid: 'legacy-memo',
        key: '旧 memo',
        content: '旧 memo',
        sourceSessionKey: 'private:10001',
        scope: 'private',
        targetId: 10001,
      }),
    ])
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

  table(name: string): FakeTable {
    const table = this.tables.get(name) ?? new FakeTable()
    this.tables.set(name, table)
    return table
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
