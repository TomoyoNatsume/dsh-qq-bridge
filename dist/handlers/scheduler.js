import { randomUUID } from 'node:crypto';
import { splitText } from './agent.js';
import { parseQqControlBlocks } from './control.js';
const MAX_TIMEOUT_MS = 2_147_483_647;
export class InMemoryTaskScheduler {
    opts;
    tasks = new Map();
    constructor(opts) {
        this.opts = opts;
    }
    async scheduleTask(input) {
        const runAtText = input.runAt.trim();
        const message = input.message.trim();
        if (!runAtText)
            throw new Error('缺少 runAt。');
        if (!message)
            throw new Error('缺少 message。');
        const runAt = new Date(runAtText);
        const time = runAt.getTime();
        if (!Number.isFinite(time))
            throw new Error(`无法解析定时任务时间: ${runAtText}`);
        if (time <= this.now())
            throw new Error(`定时任务时间必须晚于当前时间: ${runAtText}`);
        const target = targetFromSource(input.source);
        const task = {
            id: randomUUID(),
            sessionKey: input.sessionKey,
            target,
            runAt,
            runAtText,
            message,
        };
        const entry = { task, disposed: false };
        this.tasks.set(task.id, entry);
        this.arm(entry);
        return { id: task.id, runAtText };
    }
    dispose() {
        for (const entry of this.tasks.values()) {
            entry.disposed = true;
            if (entry.timer)
                clearTimeout(entry.timer);
        }
        this.tasks.clear();
    }
    get size() {
        return this.tasks.size;
    }
    arm(entry) {
        if (entry.disposed)
            return;
        const delay = entry.task.runAt.getTime() - this.now();
        if (delay <= 0) {
            void this.fire(entry);
            return;
        }
        entry.timer = setTimeout(() => this.arm(entry), Math.min(delay, MAX_TIMEOUT_MS));
    }
    async fire(entry) {
        if (entry.disposed)
            return;
        entry.disposed = true;
        this.tasks.delete(entry.task.id);
        try {
            const result = await this.opts.executor.run(entry.task.sessionKey, formatScheduledTaskPrompt(entry.task));
            await this.sendAgentResult(entry.task.target, result || '(no output)');
        }
        catch (err) {
            await this.sendChunks(entry.task.target, `定时任务执行失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async sendAgentResult(target, result) {
        const parsed = parseQqControlBlocks(result);
        for (const error of parsed.errors)
            await this.sendChunks(target, error);
        if (parsed.actions.length > 0) {
            await this.sendChunks(target, '定时任务回复中包含 QQ 控制动作，已忽略。');
        }
        await this.sendChunks(target, parsed.visibleText || '(no output)');
    }
    async sendChunks(target, text) {
        const maxLen = this.opts.maxMessageLength ?? 4500;
        for (const part of splitText(text, maxLen)) {
            await this.opts.send(target, part);
        }
    }
    now() {
        return this.opts.now?.() ?? Date.now();
    }
}
export function createScheduleTaskControlHandler(controller) {
    return {
        action: 'schedule_task',
        async run(action, ctx) {
            if (typeof action.runAt !== 'string' || action.runAt.trim() === '') {
                return 'QQ 控制块 schedule_task 缺少 runAt。';
            }
            if (typeof action.message !== 'string' || action.message.trim() === '') {
                return 'QQ 控制块 schedule_task 缺少 message。';
            }
            try {
                const task = await controller.scheduleTask({
                    sessionKey: ctx.sessionKey,
                    source: ctx.source,
                    runAt: action.runAt,
                    message: action.message,
                });
                return `已创建定时任务: ${task.runAtText}\n到点后会在当前 QQ 会话触发 Agent。`;
            }
            catch (err) {
                return `定时任务创建失败: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    };
}
function targetFromSource(source) {
    if (source.scope === 'private')
        return { scope: 'private', targetId: source.userId };
    if (source.groupId === undefined)
        throw new Error('群聊定时任务缺少 groupId。');
    return { scope: 'group', targetId: source.groupId };
}
function formatScheduledTaskPrompt(task) {
    return [
        '本条消息由 dsh-qq-bridge 插件内定时任务触发。',
        '请根据任务内容生成要发给 QQ 用户的提醒或回复。',
        '不要输出 dsh-qq-bridge-control 控制块，除非用户的定时任务内容本身明确要求修改会话控制项。',
        '',
        `计划触发时间: ${task.runAtText}`,
        '',
        '定时任务内容:',
        task.message,
    ].join('\n');
}
