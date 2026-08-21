import { AgentExecutor, splitText } from './agent.js'
import { parseQqControlBlocks, QqControlActionHandler } from './control.js'
import { HandlerContext } from '../router.js'
import type { MessageTargetId } from '../onebot/types.js'
import {
  createTimerRecord,
  CustomMemoryStore,
  CustomMemoryTimerRecord,
} from './custom-memory.js'

const MAX_TIMEOUT_MS = 2_147_483_647
const DEFAULT_SCAN_WINDOW_MS = 2 * 60 * 60 * 1000

export interface ScheduledTaskTarget {
  scope: 'private' | 'group'
  targetId: MessageTargetId
}

export interface ScheduledTask {
  id: string
  sessionKey: string
  target: ScheduledTaskTarget
  runAt: Date
  runAtText: string
  message: string
}

export interface ScheduledTaskReceipt {
  id: string
  runAtText: string
}

export interface ScheduledTaskController {
  scheduleTask(input: {
    sessionKey: string
    source: HandlerContext
    runAt: string
    message: string
  }): Promise<ScheduledTaskReceipt>
}

export interface InMemoryTaskSchedulerOptions {
  executor: AgentExecutor
  store?: CustomMemoryStore
  send(target: ScheduledTaskTarget, text: string): Promise<void>
  now?: () => number
  maxMessageLength?: number
  scanWindowMs?: number
  scanIntervalMs?: number
}

interface ScheduledTaskEntry {
  task: ScheduledTask
  timer?: ReturnType<typeof setTimeout>
  disposed: boolean
}

export class InMemoryTaskScheduler implements ScheduledTaskController {
  private readonly tasks = new Map<string, ScheduledTaskEntry>()
  private scanTimer?: ReturnType<typeof setInterval>

  constructor(private readonly opts: InMemoryTaskSchedulerOptions) {}

  async scheduleTask(input: {
    sessionKey: string
    source: HandlerContext
    runAt: string
    message: string
  }): Promise<ScheduledTaskReceipt> {
    const runAtText = input.runAt.trim()
    const message = input.message.trim()
    if (!runAtText) throw new Error('缺少 runAt。')
    if (!message) throw new Error('缺少 message。')

    const runAt = new Date(runAtText)
    const time = runAt.getTime()
    if (!Number.isFinite(time)) throw new Error(`无法解析定时任务时间: ${runAtText}`)
    if (time <= this.now()) throw new Error(`定时任务时间必须晚于当前时间: ${runAtText}`)

    const record = createTimerRecord({
      source: input.source,
      sessionKey: input.sessionKey,
      time: runAtText,
      content: message,
      now: this.opts.now,
    })
    await this.store().saveTimer(record)
    this.armIfWithinWindow(record)
    return { id: record.uuid, runAtText }
  }

  startScanning(): void {
    if (this.scanTimer) return
    void this.scanDueTasks()
    this.scanTimer = setInterval(() => {
      void this.scanDueTasks()
    }, this.opts.scanIntervalMs ?? DEFAULT_SCAN_WINDOW_MS)
  }

  async scanDueTasks(): Promise<void> {
    const timers = await this.store().listTimers()
    for (const timer of timers) {
      if (timer.status !== 'pending') continue
      this.armIfWithinWindow(timer)
    }
  }

  dispose(): void {
    if (this.scanTimer) clearInterval(this.scanTimer)
    this.scanTimer = undefined
    for (const entry of this.tasks.values()) {
      entry.disposed = true
      if (entry.timer) clearTimeout(entry.timer)
    }
    this.tasks.clear()
  }

  get size(): number {
    return this.tasks.size
  }

  private armIfWithinWindow(record: CustomMemoryTimerRecord): void {
    const runAt = new Date(record.time)
    const time = runAt.getTime()
    if (!Number.isFinite(time)) return
    if (time - this.now() > this.scanWindowMs()) return
    const task = taskFromRecord(record, runAt)
    if (this.tasks.has(task.id)) return
    const entry: ScheduledTaskEntry = { task, disposed: false }
    this.tasks.set(task.id, entry)
    this.arm(entry)
  }

  private arm(entry: ScheduledTaskEntry): void {
    if (entry.disposed) return
    const delay = entry.task.runAt.getTime() - this.now()
    if (delay <= 0) {
      void this.fire(entry)
      return
    }
    entry.timer = setTimeout(() => this.arm(entry), Math.min(delay, MAX_TIMEOUT_MS))
  }

  private async fire(entry: ScheduledTaskEntry): Promise<void> {
    if (entry.disposed) return
    entry.disposed = true
    this.tasks.delete(entry.task.id)
    try {
      const result = await this.opts.executor.run(entry.task.sessionKey, formatScheduledTaskPrompt(entry.task))
      await this.sendAgentResult(entry.task.target, result || '(no output)')
      await this.markTask(entry.task.id, 'fired')
    } catch (err) {
      await this.markTask(entry.task.id, 'failed', err instanceof Error ? err.message : String(err))
      await this.sendChunks(
        entry.task.target,
        `定时任务执行失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async sendAgentResult(target: ScheduledTaskTarget, result: string): Promise<void> {
    const parsed = parseQqControlBlocks(result)
    for (const error of parsed.errors) await this.sendChunks(target, error)
    if (parsed.actions.length > 0) {
      await this.sendChunks(target, '定时任务回复中包含 QQ 控制动作，已忽略。')
    }
    await this.sendChunks(target, parsed.visibleText || '(no output)')
  }

  private async sendChunks(target: ScheduledTaskTarget, text: string): Promise<void> {
    const maxLen = this.opts.maxMessageLength ?? 4500
    for (const part of splitText(text, maxLen)) {
      await this.opts.send(target, part)
    }
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now()
  }

  private scanWindowMs(): number {
    return this.opts.scanWindowMs ?? DEFAULT_SCAN_WINDOW_MS
  }

  private store(): CustomMemoryStore {
    return this.opts.store ?? fallbackStore
  }

  private async markTask(id: string, status: 'fired' | 'failed', error?: string): Promise<void> {
    const store = this.store()
    const current = (await store.listTimers()).find(timer => timer.uuid === id)
    if (!current) return
    await store.updateTimer({
      ...current,
      status,
      updatedAt: new Date(this.now()).toISOString(),
      ...(status === 'fired' ? { firedAt: new Date(this.now()).toISOString() } : {}),
      ...(error ? { error } : {}),
    })
  }
}

export function createScheduleTaskControlHandler(controller: ScheduledTaskController): QqControlActionHandler {
  return {
    action: 'schedule_task',
    async run(action, ctx) {
      if (typeof action.runAt !== 'string' || action.runAt.trim() === '') {
        return 'QQ 控制块 schedule_task 缺少 runAt。'
      }
      if (typeof action.message !== 'string' || action.message.trim() === '') {
        return 'QQ 控制块 schedule_task 缺少 message。'
      }
      try {
        const task = await controller.scheduleTask({
          sessionKey: ctx.sessionKey,
          source: ctx.source,
          runAt: action.runAt,
          message: action.message,
        })
        return `已创建定时任务: ${task.runAtText}\n到点后会在当前 QQ 会话触发 Agent。`
      } catch (err) {
        return `定时任务创建失败: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}

function formatScheduledTaskPrompt(task: ScheduledTask): string {
  return [
    '本条消息由 dsh-qq-bridge 插件内定时任务触发。',
    '请根据任务内容生成要发给 QQ 用户的提醒或回复。',
    '不要输出 dsh-qq-bridge-control 控制块，除非用户的定时任务内容本身明确要求修改会话控制项。',
    '',
    `计划触发时间: ${task.runAtText}`,
    '',
    '定时任务内容:',
    task.message,
  ].join('\n')
}

function taskFromRecord(record: CustomMemoryTimerRecord, runAt: Date): ScheduledTask {
  return {
    id: record.uuid,
    sessionKey: record.sessionKey,
    target: { scope: record.scope, targetId: record.targetId },
    runAt,
    runAtText: record.time,
    message: record.content,
  }
}

const fallbackStore: CustomMemoryStore = {
  async saveTimer() {},
  async listTimers() { return [] },
  async updateTimer() {},
  async saveMemo() {},
  async listMemos() { return [] },
}
