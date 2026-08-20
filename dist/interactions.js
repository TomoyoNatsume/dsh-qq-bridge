/** Routes DSH human-interaction requests through the QQ command channel. */
export class QqInteractionBridge {
    outbound;
    commandPrefix;
    agentTargets = new WeakMap();
    pendingByTarget = new Map();
    constructor(outbound, commandPrefix = '') {
        this.outbound = outbound;
        this.commandPrefix = commandPrefix;
    }
    bindAgent(sessionKey, agent) {
        if (typeof agent !== 'object' || agent === null)
            return;
        const target = targetFromSessionKey(sessionKey);
        if (target)
            this.agentTargets.set(agent, target);
    }
    register(ctx) {
        const disposers = [];
        if (ctx.on) {
            disposers.push(ctx.on('approval/request', (request, next) => {
                if (!this.targetForAgent(request.agent))
                    return next();
                return this.askApproval(request);
            }, { prepend: true }));
        }
        if (ctx.inject) {
            const fiber = ctx.inject(['userQuestions'], (childCtx) => {
                this.registerUserQuestions(childCtx, disposers);
            }, 'dsh-qq-bridge.userQuestions');
            if (fiber && typeof fiber === 'object' && typeof fiber.dispose === 'function') {
                disposers.push(() => fiber.dispose());
            }
        }
        else {
            this.registerUserQuestions(ctx, disposers);
        }
        return () => {
            for (const dispose of disposers.splice(0))
                dispose();
            for (const [key, pending] of this.pendingByTarget) {
                this.pendingByTarget.delete(key);
                pending.reject(new Error('QQ interaction bridge disposed'));
            }
        };
    }
    registerUserQuestions(ctx, disposers) {
        const userQuestions = ctx.userQuestions;
        if (userQuestions) {
            const originalAsk = userQuestions.ask.bind(userQuestions);
            const wrappedAsk = (request) => {
                if (request.agent !== undefined && this.targetForAgent(request.agent)) {
                    return this.askUser(request);
                }
                return originalAsk(request);
            };
            userQuestions.ask = wrappedAsk;
            disposers.push(() => {
                if (userQuestions.ask === wrappedAsk)
                    userQuestions.ask = originalAsk;
            });
        }
    }
    async handle(ctx) {
        const targetId = ctx.scope === 'private' ? ctx.userId : ctx.groupId;
        if (targetId === undefined)
            return false;
        const key = targetKey({ scope: ctx.scope, targetId });
        const pending = this.pendingByTarget.get(key);
        if (!pending)
            return false;
        this.pendingByTarget.delete(key);
        cleanupPending(pending);
        if (pending.kind === 'approval') {
            pending.resolve(resolveApproval(ctx.payload));
            await ctx.respond('已收到确认，Agent 会继续处理。');
            return true;
        }
        pending.resolve(resolveAskUser(ctx.payload, pending.questions, pending.choices));
        await ctx.respond('已收到回复，Agent 会继续处理。');
        return true;
    }
    async askApproval(request) {
        const target = this.targetForAgent(request.agent);
        if (!target)
            return 'unavailable';
        const choices = [
            { index: 1, questionId: 'approval', label: '允许一次' },
            { index: 2, questionId: 'approval', label: '拒绝' },
        ];
        const answer = this.wait(target, {
            kind: 'approval',
            choices,
            signal: request.signal,
        });
        await this.sendPrompt(target, formatApprovalRequest(request, choices, this.commandPrefix));
        return await answer;
    }
    async askUser(request) {
        const target = this.targetForAgent(request.agent);
        if (!target)
            throw new Error('QQ interaction bridge has no target for this agent');
        const choices = enumerateChoices(request.questions);
        const answer = this.wait(target, {
            kind: 'ask-user',
            questions: request.questions,
            choices,
            signal: request.signal,
        });
        await this.sendPrompt(target, formatAskUserRequest(request.questions, choices, this.commandPrefix));
        return await answer;
    }
    async sendPrompt(target, text) {
        try {
            await this.outbound(target.scope, target.targetId, text);
        }
        catch (err) {
            const key = targetKey(target);
            const pending = this.pendingByTarget.get(key);
            if (pending) {
                this.pendingByTarget.delete(key);
                cleanupPending(pending);
                pending.reject(err);
            }
            throw err;
        }
    }
    wait(target, spec) {
        const key = targetKey(target);
        const existing = this.pendingByTarget.get(key);
        if (existing) {
            cleanupPending(existing);
            existing.reject(new Error('a newer QQ interaction request replaced this pending request'));
        }
        return new Promise((resolve, reject) => {
            const pending = { ...spec, resolve, reject };
            const onAbort = () => {
                this.pendingByTarget.delete(key);
                cleanupPending(pending);
                if (pending.kind === 'approval')
                    pending.resolve('cancelled');
                else
                    pending.reject(new Error('ask_user_question was aborted before the user answered'));
            };
            pending.onAbort = onAbort;
            pending.signal?.addEventListener('abort', onAbort, { once: true });
            this.pendingByTarget.set(key, pending);
        });
    }
    targetForAgent(agent) {
        if (typeof agent !== 'object' || agent === null)
            return undefined;
        return this.agentTargets.get(agent);
    }
}
export function formatApprovalRequest(request, choices, commandPrefix = '') {
    return [
        'Agent 需要确认:',
        `工具: ${request.toolName}`,
        ...request.reason ? [`原因: ${request.reason}`] : [],
        '',
        ...choices.map((choice) => `${choice.index}. ${choice.label}`),
        '',
        `请回复“指令前缀 + 编号”，例如 ${formatCommandExample(commandPrefix, '1')} 或 ${formatCommandExample(commandPrefix, '2')}。`,
    ].join('\n');
}
export function formatAskUserRequest(questions, choices, commandPrefix = '') {
    const lines = ['Agent 需要你的回复:'];
    for (const question of questions) {
        lines.push('', question.header ? `${question.header}: ${question.question}` : question.question);
        if (question.detail)
            lines.push(question.detail);
        const ownChoices = choices.filter((choice) => choice.questionId === question.id);
        for (const choice of ownChoices) {
            const option = question.options?.find((candidate) => candidate.label === choice.label);
            lines.push(`${choice.index}. ${choice.label}${option?.description ? ` - ${option.description}` : ''}`);
        }
    }
    lines.push('', `请回复“指令前缀 + 编号”，例如 ${formatCommandExample(commandPrefix, '1')}；也可以直接回复自定义内容。`);
    return lines.join('\n');
}
export function resolveAskUser(payload, questions, choices) {
    const selectedNumbers = parseSelectedNumbers(payload);
    if (selectedNumbers.length === 0) {
        const [first, ...rest] = questions;
        return {
            answers: [
                ...(first ? [{ id: first.id, selected: [], custom: payload }] : []),
                ...rest.map((question) => ({ id: question.id, selected: [] })),
            ],
        };
    }
    return {
        answers: questions.map((question) => ({
            id: question.id,
            selected: choices
                .filter((choice) => choice.questionId === question.id && selectedNumbers.includes(choice.index))
                .map((choice) => choice.label),
        })),
    };
}
export function resolveApproval(payload) {
    const [selected] = parseSelectedNumbers(payload);
    if (selected === 1)
        return 'allowed-once';
    return 'rejected';
}
function enumerateChoices(questions) {
    const choices = [];
    for (const question of questions) {
        for (const option of question.options ?? []) {
            choices.push({ index: choices.length + 1, questionId: question.id, label: option.label });
        }
    }
    return choices;
}
function parseSelectedNumbers(payload) {
    const trimmed = payload.trim();
    if (!/^\d+(?:[\s,，、]+\d+)*$/.test(trimmed))
        return [];
    return trimmed
        .split(/[\s,，、]+/)
        .map((part) => Number(part))
        .filter((value) => Number.isInteger(value) && value > 0);
}
function targetFromSessionKey(sessionKey) {
    const sep = sessionKey.indexOf(':');
    if (sep <= 0)
        return undefined;
    const scope = sessionKey.slice(0, sep);
    const id = sessionKey.slice(sep + 1);
    if ((scope !== 'private' && scope !== 'group') || !id)
        return undefined;
    return { scope, targetId: numericId(id) };
}
function numericId(id) {
    return /^\d+$/.test(id) ? Number(id) : id;
}
function targetKey(target) {
    return `${target.scope}:${target.targetId}`;
}
function cleanupPending(pending) {
    if (pending.signal && pending.onAbort)
        pending.signal.removeEventListener('abort', pending.onAbort);
}
function formatCommandExample(commandPrefix, payload) {
    const prefix = commandPrefix.trim();
    return prefix ? `${prefix} ${payload}` : payload;
}
