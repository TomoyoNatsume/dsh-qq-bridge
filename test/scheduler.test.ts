import { afterEach, describe, expect, it, vi } from 'vitest'
import { QqControlDispatcher } from '../src/handlers/control.js'
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
})
