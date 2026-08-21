import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const targetIdSchema = z.union([z.string(), z.number()]);
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
});
export const customMemoryMemoSchema = z.object({
    uuid: z.string().min(1),
    type: z.literal('memo'),
    content: z.string().min(1),
    sessionKey: z.string().min(1),
    scope: z.union([z.literal('private'), z.literal('group')]),
    targetId: targetIdSchema,
    createdAt: z.string().min(1),
});
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
            if (typeof action.content !== 'string' || action.content.trim() === '') {
                return 'QQ 控制块 save_memo 缺少 content。';
            }
            const record = createMemoRecord({
                source: ctx.source,
                sessionKey: ctx.sessionKey,
                content: action.content.trim(),
            });
            await store.saveMemo(record);
            return `已记录 memo: ${record.content}`;
        },
    };
}
export function createTimerRecord(input) {
    const createdAt = new Date(input.now?.() ?? Date.now()).toISOString();
    const target = targetFromSource(input.source);
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
    };
}
export function createMemoRecord(input) {
    const createdAt = new Date(input.now?.() ?? Date.now()).toISOString();
    const target = targetFromSource(input.source);
    return {
        uuid: randomUUID(),
        type: 'memo',
        content: input.content,
        sessionKey: input.sessionKey,
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
function freezeTimer(record) {
    return { ...record };
}
function freezeMemo(record) {
    return { ...record };
}
