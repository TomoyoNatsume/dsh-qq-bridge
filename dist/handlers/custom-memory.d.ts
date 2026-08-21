import { z } from 'zod';
import type { MessageTargetId } from '../onebot/types.js';
import type { HandlerContext } from '../router.js';
import type { QqControlActionHandler } from './control.js';
export type CustomMemoryRecordStatus = 'pending' | 'fired' | 'failed';
export interface CustomMemoryTarget {
    scope: 'private' | 'group';
    targetId: MessageTargetId;
}
export interface CustomMemoryTimerRecord {
    uuid: string;
    type: 'timer';
    time: string;
    content: string;
    sessionKey: string;
    scope: 'private' | 'group';
    targetId: MessageTargetId;
    status: CustomMemoryRecordStatus;
    createdAt: string;
    updatedAt?: string;
    firedAt?: string;
    error?: string;
}
export interface CustomMemoryMemoRecord {
    uuid: string;
    type: 'memo';
    content: string;
    sessionKey: string;
    scope: 'private' | 'group';
    targetId: MessageTargetId;
    createdAt: string;
}
export interface CustomMemoryStore {
    saveTimer(record: CustomMemoryTimerRecord): Promise<void>;
    listTimers(): Promise<CustomMemoryTimerRecord[]>;
    updateTimer(record: CustomMemoryTimerRecord): Promise<void>;
    saveMemo(record: CustomMemoryMemoRecord): Promise<void>;
    listMemos(): Promise<CustomMemoryMemoRecord[]>;
    close?(): Promise<void>;
}
export interface DshStorageDomainRuntime {
    open(spec: unknown): Promise<DshStorageDomain>;
}
export interface DshStorageDomain {
    table(name: string): DshKvTable<unknown>;
    close(): Promise<void>;
}
export interface DshKvTable<V> {
    get(key: string): V | undefined;
    entries(): IterableIterator<[string, V]>;
    put(key: string, value: V): Promise<void>;
    delete(key: string): Promise<boolean>;
    update(key: string, fn: (current: V) => V): Promise<V>;
}
export declare const customMemoryTimerSchema: z.ZodObject<{
    uuid: z.ZodString;
    type: z.ZodLiteral<"timer">;
    time: z.ZodString;
    content: z.ZodString;
    sessionKey: z.ZodString;
    scope: z.ZodUnion<[z.ZodLiteral<"private">, z.ZodLiteral<"group">]>;
    targetId: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    status: z.ZodUnion<[z.ZodLiteral<"pending">, z.ZodLiteral<"fired">, z.ZodLiteral<"failed">]>;
    createdAt: z.ZodString;
    updatedAt: z.ZodOptional<z.ZodString>;
    firedAt: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    scope: "private" | "group";
    type: "timer";
    status: "failed" | "pending" | "fired";
    targetId: string | number;
    uuid: string;
    time: string;
    content: string;
    sessionKey: string;
    createdAt: string;
    error?: string | undefined;
    updatedAt?: string | undefined;
    firedAt?: string | undefined;
}, {
    scope: "private" | "group";
    type: "timer";
    status: "failed" | "pending" | "fired";
    targetId: string | number;
    uuid: string;
    time: string;
    content: string;
    sessionKey: string;
    createdAt: string;
    error?: string | undefined;
    updatedAt?: string | undefined;
    firedAt?: string | undefined;
}>;
export declare const customMemoryMemoSchema: z.ZodObject<{
    uuid: z.ZodString;
    type: z.ZodLiteral<"memo">;
    content: z.ZodString;
    sessionKey: z.ZodString;
    scope: z.ZodUnion<[z.ZodLiteral<"private">, z.ZodLiteral<"group">]>;
    targetId: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    scope: "private" | "group";
    type: "memo";
    targetId: string | number;
    uuid: string;
    content: string;
    sessionKey: string;
    createdAt: string;
}, {
    scope: "private" | "group";
    type: "memo";
    targetId: string | number;
    uuid: string;
    content: string;
    sessionKey: string;
    createdAt: string;
}>;
export declare const customMemoryDomainSpec: {
    name: string;
    version: number;
    tables: {
        timers: {
            valueSchema: z.ZodObject<{
                uuid: z.ZodString;
                type: z.ZodLiteral<"timer">;
                time: z.ZodString;
                content: z.ZodString;
                sessionKey: z.ZodString;
                scope: z.ZodUnion<[z.ZodLiteral<"private">, z.ZodLiteral<"group">]>;
                targetId: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
                status: z.ZodUnion<[z.ZodLiteral<"pending">, z.ZodLiteral<"fired">, z.ZodLiteral<"failed">]>;
                createdAt: z.ZodString;
                updatedAt: z.ZodOptional<z.ZodString>;
                firedAt: z.ZodOptional<z.ZodString>;
                error: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                scope: "private" | "group";
                type: "timer";
                status: "failed" | "pending" | "fired";
                targetId: string | number;
                uuid: string;
                time: string;
                content: string;
                sessionKey: string;
                createdAt: string;
                error?: string | undefined;
                updatedAt?: string | undefined;
                firedAt?: string | undefined;
            }, {
                scope: "private" | "group";
                type: "timer";
                status: "failed" | "pending" | "fired";
                targetId: string | number;
                uuid: string;
                time: string;
                content: string;
                sessionKey: string;
                createdAt: string;
                error?: string | undefined;
                updatedAt?: string | undefined;
                firedAt?: string | undefined;
            }>;
        };
        memos: {
            valueSchema: z.ZodObject<{
                uuid: z.ZodString;
                type: z.ZodLiteral<"memo">;
                content: z.ZodString;
                sessionKey: z.ZodString;
                scope: z.ZodUnion<[z.ZodLiteral<"private">, z.ZodLiteral<"group">]>;
                targetId: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
                createdAt: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                scope: "private" | "group";
                type: "memo";
                targetId: string | number;
                uuid: string;
                content: string;
                sessionKey: string;
                createdAt: string;
            }, {
                scope: "private" | "group";
                type: "memo";
                targetId: string | number;
                uuid: string;
                content: string;
                sessionKey: string;
                createdAt: string;
            }>;
        };
    };
};
export declare class InMemoryCustomMemoryStore implements CustomMemoryStore {
    private readonly timers;
    private readonly memos;
    saveTimer(record: CustomMemoryTimerRecord): Promise<void>;
    listTimers(): Promise<CustomMemoryTimerRecord[]>;
    updateTimer(record: CustomMemoryTimerRecord): Promise<void>;
    saveMemo(record: CustomMemoryMemoRecord): Promise<void>;
    listMemos(): Promise<CustomMemoryMemoRecord[]>;
}
export declare class StorageDomainCustomMemoryStore implements CustomMemoryStore {
    private readonly domain;
    private readonly timers;
    private readonly memos;
    private constructor();
    static open(storageDomain: DshStorageDomainRuntime): Promise<StorageDomainCustomMemoryStore>;
    saveTimer(record: CustomMemoryTimerRecord): Promise<void>;
    listTimers(): Promise<CustomMemoryTimerRecord[]>;
    updateTimer(record: CustomMemoryTimerRecord): Promise<void>;
    saveMemo(record: CustomMemoryMemoRecord): Promise<void>;
    listMemos(): Promise<CustomMemoryMemoRecord[]>;
    close(): Promise<void>;
}
export declare class LazyCustomMemoryStore implements CustomMemoryStore {
    private readonly storageDomain?;
    private readonly memory;
    private persistent?;
    private opening?;
    private warned;
    constructor(storageDomain?: (() => DshStorageDomainRuntime | undefined) | undefined);
    saveTimer(record: CustomMemoryTimerRecord): Promise<void>;
    listTimers(): Promise<CustomMemoryTimerRecord[]>;
    updateTimer(record: CustomMemoryTimerRecord): Promise<void>;
    saveMemo(record: CustomMemoryMemoRecord): Promise<void>;
    listMemos(): Promise<CustomMemoryMemoRecord[]>;
    close(): Promise<void>;
    private active;
    private openPersistent;
}
export declare function createSaveMemoControlHandler(store: CustomMemoryStore): QqControlActionHandler;
export declare function createTimerRecord(input: {
    source: HandlerContext;
    sessionKey: string;
    time: string;
    content: string;
    now?: () => number;
}): CustomMemoryTimerRecord;
export declare function createMemoRecord(input: {
    source: HandlerContext;
    sessionKey: string;
    content: string;
    now?: () => number;
}): CustomMemoryMemoRecord;
export declare function targetFromSource(source: HandlerContext): CustomMemoryTarget;
