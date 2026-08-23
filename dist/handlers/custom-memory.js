import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const targetIdSchema = z.union([z.string(), z.number()]);
export const customMemoryTimerSchema = z.object({
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
}));
export const customMemoryMemoSchema = z.object({
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
}));
export const customMemoryDomainSpec = {
    name: 'dsh_qq_bridge',
    version: 0,
    tables: {
        timers: { valueSchema: customMemoryTimerSchema },
        memos: { valueSchema: customMemoryMemoSchema },
    },
};
export class InMemoryCustomMemoryStore {
    timers = new Map();
    memos = new Map();
    async saveTimer(record) {
        this.timers.set(record.uuid, freezeTimer(record));
    }
    async listTimers() {
        return [...this.timers.values()];
    }
    async updateTimer(record) {
        this.timers.set(record.uuid, freezeTimer(record));
    }
    async deleteTimer(uuid) {
        return this.timers.delete(uuid);
    }
    async saveMemo(record) {
        this.memos.set(record.uuid, freezeMemo(record));
    }
    async listMemos() {
        return [...this.memos.values()];
    }
}
export class StorageDomainCustomMemoryStore {
    domain;
    timers;
    memos;
    constructor(domain, timers, memos) {
        this.domain = domain;
        this.timers = timers;
        this.memos = memos;
    }
    static async open(storageDomain) {
        const domain = await storageDomain.open(customMemoryDomainSpec);
        return new StorageDomainCustomMemoryStore(domain, domain.table('timers'), domain.table('memos'));
    }
    async saveTimer(record) {
        await this.timers.put(record.uuid, freezeTimer(record));
    }
    async listTimers() {
        return [...this.timers.entries()].map(([, value]) => customMemoryTimerSchema.parse(value));
    }
    async updateTimer(record) {
        await this.timers.put(record.uuid, freezeTimer(record));
    }
    async deleteTimer(uuid) {
        return await this.timers.delete(uuid);
    }
    async saveMemo(record) {
        await this.memos.put(record.uuid, freezeMemo(record));
    }
    async listMemos() {
        return [...this.memos.entries()].map(([, value]) => customMemoryMemoSchema.parse(value));
    }
    async close() {
        await this.domain.close();
    }
}
export class LazyCustomMemoryStore {
    storageDomain;
    memory = new InMemoryCustomMemoryStore();
    persistent;
    opening;
    warned = false;
    constructor(storageDomain) {
        this.storageDomain = storageDomain;
    }
    async saveTimer(record) {
        await (await this.active()).saveTimer(record);
    }
    async listTimers() {
        return await (await this.active()).listTimers();
    }
    async updateTimer(record) {
        await (await this.active()).updateTimer(record);
    }
    async deleteTimer(uuid) {
        return await (await this.active()).deleteTimer(uuid);
    }
    async saveMemo(record) {
        await (await this.active()).saveMemo(record);
    }
    async listMemos() {
        return await (await this.active()).listMemos();
    }
    async close() {
        await this.persistent?.close?.();
    }
    async active() {
        if (this.persistent)
            return this.persistent;
        const runtime = this.storageDomain?.();
        if (!runtime)
            return this.memory;
        this.opening ??= this.openPersistent(runtime);
        const opened = await this.opening;
        return opened ?? this.memory;
    }
    async openPersistent(runtime) {
        try {
            const persistent = await StorageDomainCustomMemoryStore.open(runtime);
            await migrateStore(this.memory, persistent);
            this.persistent = persistent;
            return persistent;
        }
        catch (err) {
            if (!this.warned) {
                this.warned = true;
                console.warn(`[dsh-qq-bridge] storageDomain custom memory unavailable, using in-memory store: ${err instanceof Error ? err.message : String(err)}`);
            }
            return undefined;
        }
    }
}
export function createSaveMemoControlHandler(store) {
    return {
        action: 'save_memo',
        async run(action, ctx) {
            if (typeof action.key !== 'string' || action.key.trim() === '') {
                return 'QQ 控制块 save_memo 缺少 key。';
            }
            if (typeof action.content !== 'string' || action.content.trim() === '') {
                return 'QQ 控制块 save_memo 缺少 content。';
            }
            const key = action.key.trim();
            const content = action.content.trim();
            const record = await upsertMemoRecord(store, createMemoRecord({
                source: ctx.source,
                sourceSessionKey: ctx.sessionKey,
                key,
                content,
            }));
            await store.saveMemo(record);
            return `已记录 memo: ${record.key}: ${record.content}`;
        },
    };
}
export function createTimerRecord(input) {
    const createdAt = new Date(input.now?.() ?? Date.now()).toISOString();
    const target = targetFromSource(input.source);
    return {
        uuid: randomUUID(),
        time: input.time,
        content: input.content,
        sourceSessionKey: input.sourceSessionKey,
        scope: target.scope,
        targetId: target.targetId,
        status: 'pending',
        createdAt,
    };
}
export function createMemoRecord(input) {
    const createdAt = new Date(input.now?.() ?? Date.now()).toISOString();
    const target = targetFromSource(input.source);
    return {
        uuid: randomUUID(),
        key: input.key,
        content: input.content,
        sourceSessionKey: input.sourceSessionKey,
        scope: target.scope,
        targetId: target.targetId,
        createdAt,
    };
}
export function targetFromSource(source) {
    if (source.scope === 'private')
        return { scope: 'private', targetId: source.userId };
    if (source.groupId === undefined)
        throw new Error('群聊记录缺少 groupId。');
    return { scope: 'group', targetId: source.groupId };
}
async function migrateStore(source, target) {
    for (const timer of await source.listTimers())
        await target.saveTimer(timer);
    for (const memo of await source.listMemos())
        await target.saveMemo(memo);
}
async function upsertMemoRecord(store, next) {
    const existing = (await store.listMemos()).find(memo => memo.scope === next.scope
        && memo.targetId === next.targetId
        && memo.key === next.key);
    if (!existing)
        return next;
    return {
        ...existing,
        content: next.content,
        sourceSessionKey: next.sourceSessionKey,
        updatedAt: next.createdAt,
    };
}
function freezeTimer(record) {
    return { ...record };
}
function freezeMemo(record) {
    return { ...record };
}
