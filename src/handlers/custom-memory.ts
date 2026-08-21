import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MessageTargetId } from '../onebot/types.js'
import type { HandlerContext } from '../router.js'
import type { QqControlActionHandler } from './control.js'

export type CustomMemoryRecordStatus = 'pending' | 'fired' | 'failed'

export interface CustomMemoryTarget {
  scope: 'private' | 'group'
  targetId: MessageTargetId
}

export interface CustomMemoryTimerRecord {
  uuid: string
  type: 'timer'
  time: string
  content: string
  sessionKey: string
  scope: 'private' | 'group'
  targetId: MessageTargetId
  status: CustomMemoryRecordStatus
  createdAt: string
  updatedAt?: string
  firedAt?: string
  error?: string
}

export interface CustomMemoryMemoRecord {
  uuid: string
  type: 'memo'
  content: string
  sessionKey: string
  scope: 'private' | 'group'
  targetId: MessageTargetId
  createdAt: string
}

export interface CustomMemoryStore {
  saveTimer(record: CustomMemoryTimerRecord): Promise<void>
  listTimers(): Promise<CustomMemoryTimerRecord[]>
  updateTimer(record: CustomMemoryTimerRecord): Promise<void>
  saveMemo(record: CustomMemoryMemoRecord): Promise<void>
  listMemos(): Promise<CustomMemoryMemoRecord[]>
  close?(): Promise<void>
}

export interface DshStorageDomainRuntime {
  open(spec: unknown): Promise<DshStorageDomain>
}

export interface DshStorageDomain {
  table(name: string): DshKvTable<unknown>
  close(): Promise<void>
}

export interface DshKvTable<V> {
  get(key: string): V | undefined
  entries(): IterableIterator<[string, V]>
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<boolean>
  update(key: string, fn: (current: V) => V): Promise<V>
}

const targetIdSchema = z.union([z.string(), z.number()])

export const customMemoryTimerSchema = z.object({
  uuid: z.string().min(1),
  type: z.literal('timer'),
  time: z.string().min(1),
  content: z.string().min(1),
  sessionKey: z.string().min(1),
  scope: z.union([z.literal('private'), z.literal('group')]),
  targetId: targetIdSchema,
  status: z.union([z.literal('pending'), z.literal('fired'), z.literal('failed')]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1).optional(),
  firedAt: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
}) satisfies z.ZodType<CustomMemoryTimerRecord>

export const customMemoryMemoSchema = z.object({
  uuid: z.string().min(1),
  type: z.literal('memo'),
  content: z.string().min(1),
  sessionKey: z.string().min(1),
  scope: z.union([z.literal('private'), z.literal('group')]),
  targetId: targetIdSchema,
  createdAt: z.string().min(1),
}) satisfies z.ZodType<CustomMemoryMemoRecord>

export const customMemoryDomainSpec = {
  name: 'dsh_qq_bridge',
  version: 0,
  tables: {
    timers: { valueSchema: customMemoryTimerSchema },
    memos: { valueSchema: customMemoryMemoSchema },
  },
}

export class InMemoryCustomMemoryStore implements CustomMemoryStore {
  private readonly timers = new Map<string, CustomMemoryTimerRecord>()
  private readonly memos = new Map<string, CustomMemoryMemoRecord>()

  async saveTimer(record: CustomMemoryTimerRecord): Promise<void> {
    this.timers.set(record.uuid, freezeTimer(record))
  }

  async listTimers(): Promise<CustomMemoryTimerRecord[]> {
    return [...this.timers.values()]
  }

  async updateTimer(record: CustomMemoryTimerRecord): Promise<void> {
    this.timers.set(record.uuid, freezeTimer(record))
  }

  async saveMemo(record: CustomMemoryMemoRecord): Promise<void> {
    this.memos.set(record.uuid, freezeMemo(record))
  }

  async listMemos(): Promise<CustomMemoryMemoRecord[]> {
    return [...this.memos.values()]
  }
}

export class StorageDomainCustomMemoryStore implements CustomMemoryStore {
  private constructor(
    private readonly domain: DshStorageDomain,
    private readonly timers: DshKvTable<unknown>,
    private readonly memos: DshKvTable<unknown>,
  ) {}

  static async open(storageDomain: DshStorageDomainRuntime): Promise<StorageDomainCustomMemoryStore> {
    const domain = await storageDomain.open(customMemoryDomainSpec)
    return new StorageDomainCustomMemoryStore(domain, domain.table('timers'), domain.table('memos'))
  }

  async saveTimer(record: CustomMemoryTimerRecord): Promise<void> {
    await this.timers.put(record.uuid, freezeTimer(record))
  }

  async listTimers(): Promise<CustomMemoryTimerRecord[]> {
    return [...this.timers.entries()].map(([, value]) => customMemoryTimerSchema.parse(value))
  }

  async updateTimer(record: CustomMemoryTimerRecord): Promise<void> {
    await this.timers.put(record.uuid, freezeTimer(record))
  }

  async saveMemo(record: CustomMemoryMemoRecord): Promise<void> {
    await this.memos.put(record.uuid, freezeMemo(record))
  }

  async listMemos(): Promise<CustomMemoryMemoRecord[]> {
    return [...this.memos.entries()].map(([, value]) => customMemoryMemoSchema.parse(value))
  }

  async close(): Promise<void> {
    await this.domain.close()
  }
}

export class LazyCustomMemoryStore implements CustomMemoryStore {
  private readonly memory = new InMemoryCustomMemoryStore()
  private persistent?: StorageDomainCustomMemoryStore
  private opening?: Promise<StorageDomainCustomMemoryStore | undefined>
  private warned = false

  constructor(private readonly storageDomain?: () => DshStorageDomainRuntime | undefined) {}

  async saveTimer(record: CustomMemoryTimerRecord): Promise<void> {
    await (await this.active()).saveTimer(record)
  }

  async listTimers(): Promise<CustomMemoryTimerRecord[]> {
    return await (await this.active()).listTimers()
  }

  async updateTimer(record: CustomMemoryTimerRecord): Promise<void> {
    await (await this.active()).updateTimer(record)
  }

  async saveMemo(record: CustomMemoryMemoRecord): Promise<void> {
    await (await this.active()).saveMemo(record)
  }

  async listMemos(): Promise<CustomMemoryMemoRecord[]> {
    return await (await this.active()).listMemos()
  }

  async close(): Promise<void> {
    await this.persistent?.close?.()
  }

  private async active(): Promise<CustomMemoryStore> {
    if (this.persistent) return this.persistent
    const runtime = this.storageDomain?.()
    if (!runtime) return this.memory
    this.opening ??= this.openPersistent(runtime)
    const opened = await this.opening
    return opened ?? this.memory
  }

  private async openPersistent(runtime: DshStorageDomainRuntime): Promise<StorageDomainCustomMemoryStore | undefined> {
    try {
      const persistent = await StorageDomainCustomMemoryStore.open(runtime)
      await migrateStore(this.memory, persistent)
      this.persistent = persistent
      return persistent
    } catch (err) {
      if (!this.warned) {
        this.warned = true
        console.warn(`[dsh-qq-bridge] storageDomain custom memory unavailable, using in-memory store: ${err instanceof Error ? err.message : String(err)}`)
      }
      return undefined
    }
  }
}

export function createSaveMemoControlHandler(store: CustomMemoryStore): QqControlActionHandler {
  return {
    action: 'save_memo',
    async run(action, ctx) {
      if (typeof action.content !== 'string' || action.content.trim() === '') {
        return 'QQ 控制块 save_memo 缺少 content。'
      }
      const record = createMemoRecord({
        source: ctx.source,
        sessionKey: ctx.sessionKey,
        content: action.content.trim(),
      })
      await store.saveMemo(record)
      return `已记录 memo: ${record.content}`
    },
  }
}

export function createTimerRecord(input: {
  source: HandlerContext
  sessionKey: string
  time: string
  content: string
  now?: () => number
}): CustomMemoryTimerRecord {
  const createdAt = new Date(input.now?.() ?? Date.now()).toISOString()
  const target = targetFromSource(input.source)
  return {
    uuid: randomUUID(),
    type: 'timer',
    time: input.time,
    content: input.content,
    sessionKey: input.sessionKey,
    scope: target.scope,
    targetId: target.targetId,
    status: 'pending',
    createdAt,
  }
}

export function createMemoRecord(input: {
  source: HandlerContext
  sessionKey: string
  content: string
  now?: () => number
}): CustomMemoryMemoRecord {
  const createdAt = new Date(input.now?.() ?? Date.now()).toISOString()
  const target = targetFromSource(input.source)
  return {
    uuid: randomUUID(),
    type: 'memo',
    content: input.content,
    sessionKey: input.sessionKey,
    scope: target.scope,
    targetId: target.targetId,
    createdAt,
  }
}

export function targetFromSource(source: HandlerContext): CustomMemoryTarget {
  if (source.scope === 'private') return { scope: 'private', targetId: source.userId }
  if (source.groupId === undefined) throw new Error('群聊记录缺少 groupId。')
  return { scope: 'group', targetId: source.groupId }
}

async function migrateStore(source: CustomMemoryStore, target: CustomMemoryStore): Promise<void> {
  for (const timer of await source.listTimers()) await target.saveTimer(timer)
  for (const memo of await source.listMemos()) await target.saveMemo(memo)
}

function freezeTimer(record: CustomMemoryTimerRecord): CustomMemoryTimerRecord {
  return { ...record }
}

function freezeMemo(record: CustomMemoryMemoRecord): CustomMemoryMemoRecord {
  return { ...record }
}
