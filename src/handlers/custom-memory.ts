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
  time: string
  content: string
  sourceSessionKey: string
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
  key: string
  content: string
  sourceSessionKey: string
  scope: 'private' | 'group'
  targetId: MessageTargetId
  createdAt: string
  updatedAt?: string
}

export interface CustomMemoryStore {
  saveTimer(record: CustomMemoryTimerRecord): Promise<void>
  listTimers(): Promise<CustomMemoryTimerRecord[]>
  updateTimer(record: CustomMemoryTimerRecord): Promise<void>
  deleteTimer(uuid: string): Promise<boolean>
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

export const customMemoryTimerSchema: z.ZodType<CustomMemoryTimerRecord, z.ZodTypeDef, unknown> = z.object({
  uuid: z.string().min(1),
  type: z.literal('timer').optional(),
  time: z.string().min(1),
  content: z.string().min(1),
  sourceSessionKey: z.string().min(1).optional(),
  sessionKey: z.string().min(1).optional(),
  scope: z.union([z.literal('private'), z.literal('group')]),
  targetId: targetIdSchema,
  status: z.union([z.literal('pending'), z.literal('fired'), z.literal('failed')]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1).optional(),
  firedAt: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
}).refine(record => record.sourceSessionKey || record.sessionKey, {
  message: 'Timer record requires sourceSessionKey.',
}).transform(record => ({
  uuid: record.uuid,
  time: record.time,
  content: record.content,
  sourceSessionKey: record.sourceSessionKey ?? record.sessionKey ?? '',
  scope: record.scope,
  targetId: record.targetId,
  status: record.status,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  firedAt: record.firedAt,
  error: record.error,
}))

export const customMemoryMemoSchema: z.ZodType<CustomMemoryMemoRecord, z.ZodTypeDef, unknown> = z.object({
  uuid: z.string().min(1),
  type: z.literal('memo').optional(),
  key: z.string().min(1).optional(),
  content: z.string().min(1),
  sourceSessionKey: z.string().min(1).optional(),
  sessionKey: z.string().min(1).optional(),
  scope: z.union([z.literal('private'), z.literal('group')]),
  targetId: targetIdSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1).optional(),
}).refine(record => record.sourceSessionKey || record.sessionKey, {
  message: 'Memo record requires sourceSessionKey.',
}).transform(record => ({
  uuid: record.uuid,
  key: record.key ?? record.content,
  content: record.content,
  sourceSessionKey: record.sourceSessionKey ?? record.sessionKey ?? '',
  scope: record.scope,
  targetId: record.targetId,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
}))

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

  async deleteTimer(uuid: string): Promise<boolean> {
    return this.timers.delete(uuid)
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

  async deleteTimer(uuid: string): Promise<boolean> {
    return await this.timers.delete(uuid)
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

  async deleteTimer(uuid: string): Promise<boolean> {
    return await (await this.active()).deleteTimer(uuid)
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
      if (typeof action.key !== 'string' || action.key.trim() === '') {
        return 'QQ 控制块 save_memo 缺少 key。'
      }
      if (typeof action.content !== 'string' || action.content.trim() === '') {
        return 'QQ 控制块 save_memo 缺少 content。'
      }
      const key = action.key.trim()
      const content = action.content.trim()
      const record = await upsertMemoRecord(store, createMemoRecord({
        source: ctx.source,
        sourceSessionKey: ctx.sessionKey,
        key,
        content,
      }))
      await store.saveMemo(record)
      return `已记录 memo: ${record.key}: ${record.content}`
    },
  }
}

export function createTimerRecord(input: {
  source: HandlerContext
  sourceSessionKey: string
  time: string
  content: string
  now?: () => number
}): CustomMemoryTimerRecord {
  const createdAt = new Date(input.now?.() ?? Date.now()).toISOString()
  const target = targetFromSource(input.source)
  return {
    uuid: randomUUID(),
    time: input.time,
    content: input.content,
    sourceSessionKey: input.sourceSessionKey,
    scope: target.scope,
    targetId: target.targetId,
    status: 'pending',
    createdAt,
  }
}

export function createMemoRecord(input: {
  source: HandlerContext
  sourceSessionKey: string
  key: string
  content: string
  now?: () => number
}): CustomMemoryMemoRecord {
  const createdAt = new Date(input.now?.() ?? Date.now()).toISOString()
  const target = targetFromSource(input.source)
  return {
    uuid: randomUUID(),
    key: input.key,
    content: input.content,
    sourceSessionKey: input.sourceSessionKey,
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

async function upsertMemoRecord(store: CustomMemoryStore, next: CustomMemoryMemoRecord): Promise<CustomMemoryMemoRecord> {
  const existing = (await store.listMemos()).find(memo =>
    memo.scope === next.scope
    && memo.targetId === next.targetId
    && memo.key === next.key)
  if (!existing) return next
  return {
    ...existing,
    content: next.content,
    sourceSessionKey: next.sourceSessionKey,
    updatedAt: next.createdAt,
  }
}

function freezeTimer(record: CustomMemoryTimerRecord): CustomMemoryTimerRecord {
  return { ...record }
}

function freezeMemo(record: CustomMemoryMemoRecord): CustomMemoryMemoRecord {
  return { ...record }
}
