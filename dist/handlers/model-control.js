import { stat } from 'node:fs/promises';
import { sessionKeyOf } from './agent.js';
import { DIR_COMMAND, resolveUserPath } from './directory.js';
export const MODELS_COMMAND = '/models';
export const MODEL_COMMAND = '/model';
export const HELP_COMMAND = '/help';
export const REASONING_EFFORT_COMMAND = '/reasoningEff';
export const PERMISSION_COMMAND = '/permission';
export const PERMISSIONS_COMMAND = '/permissions';
const FALLBACK_REASONING_EFFORTS = ['off', 'low', 'medium', 'high', 'max'];
/** Bridge-side QQ commands for model routing. These never enter the agent. */
export class BridgeControlHandler {
    controller;
    directorySwitcher;
    permissionController;
    name = 'bridge-control';
    constructor(controller, directorySwitcher, permissionController) {
        this.controller = controller;
        this.directorySwitcher = directorySwitcher;
        this.permissionController = permissionController;
    }
    test(payload) {
        return payload === DIR_COMMAND
            || payload.startsWith(`${DIR_COMMAND} `)
            || payload === MODELS_COMMAND
            || payload === HELP_COMMAND
            || payload === PERMISSIONS_COMMAND
            || payload === PERMISSION_COMMAND
            || payload.startsWith(`${PERMISSION_COMMAND} `)
            || payload === MODEL_COMMAND
            || payload.startsWith(`${MODEL_COMMAND} `)
            || payload === REASONING_EFFORT_COMMAND
            || payload.startsWith(`${REASONING_EFFORT_COMMAND} `);
    }
    async run(ctx) {
        const sessionKey = sessionKeyOf(ctx);
        if (ctx.payload === DIR_COMMAND || ctx.payload.startsWith(`${DIR_COMMAND} `)) {
            await this.runDir(ctx, sessionKey);
            return;
        }
        if (ctx.payload === HELP_COMMAND) {
            await ctx.respond(formatHelp());
            return;
        }
        if (ctx.payload === PERMISSIONS_COMMAND || ctx.payload === PERMISSION_COMMAND || ctx.payload.startsWith(`${PERMISSION_COMMAND} `)) {
            await this.runPermission(ctx, sessionKey);
            return;
        }
        if (ctx.payload === MODELS_COMMAND) {
            await ctx.respond(formatModels(await this.controller.listModels(sessionKey), this.controller.getModelSelection(sessionKey)));
            return;
        }
        if (ctx.payload === MODEL_COMMAND || ctx.payload.startsWith(`${MODEL_COMMAND} `)) {
            await this.runModel(ctx, sessionKey);
            return;
        }
        await this.runReasoningEffort(ctx, sessionKey);
    }
    async runPermission(ctx, sessionKey) {
        if (!this.permissionController) {
            await ctx.respond('当前 host 不支持权限切换。');
            return;
        }
        const preset = ctx.payload === PERMISSIONS_COMMAND
            ? undefined
            : ctx.payload.slice(PERMISSION_COMMAND.length).trim() || undefined;
        try {
            await ctx.respond(await this.permissionController.runPermissionCommand(sessionKey, preset));
        }
        catch (err) {
            await ctx.respond(`权限切换失败: ${errorMessage(err)}`);
        }
    }
    async runDir(ctx, sessionKey) {
        if (!this.directorySwitcher) {
            await ctx.respond('当前 bridge 未启用工作目录切换。');
            return;
        }
        const rawPath = ctx.payload.slice(DIR_COMMAND.length).trim();
        if (!rawPath) {
            await ctx.respond('请发送 /dir <目录路径>，例如 /dir /home/xxx/project');
            return;
        }
        const cwd = resolveUserPath(rawPath, this.directorySwitcher.getCwd?.(sessionKey));
        const info = await stat(cwd).catch(() => null);
        if (!info?.isDirectory()) {
            await ctx.respond(`目录不存在或不是目录: ${cwd}`);
            return;
        }
        await this.directorySwitcher.setCwd(sessionKey, cwd);
        await ctx.respond(`已切换当前 QQ 会话工作区: ${cwd}\n下一条消息会使用新的 Agent session。`);
    }
    async runModel(ctx, sessionKey) {
        const model = ctx.payload.slice(MODEL_COMMAND.length).trim();
        if (!model) {
            await ctx.respond('请发送 /model <模型名>。模型名必须和 /models 列出的 id 完全一致。');
            return;
        }
        const available = await this.controller.listModels(sessionKey);
        const matches = available.filter(entry => entry.id === model);
        if (matches.length === 0) {
            await ctx.respond(`未找到模型: ${model}\n${formatModelIds(available)}`);
            return;
        }
        if (new Set(matches.map(entry => entry.provider)).size > 1) {
            await ctx.respond(`模型名 ${model} 在多个 provider 中重复；当前 QQ 命令只接受唯一模型名。`);
            return;
        }
        try {
            const selected = await this.controller.selectModel(sessionKey, model);
            await ctx.respond(formatSelection('已切换模型', selected));
        }
        catch (err) {
            await ctx.respond(`模型不可用: ${errorMessage(err)}`);
        }
    }
    async runReasoningEffort(ctx, sessionKey) {
        const effort = ctx.payload.slice(REASONING_EFFORT_COMMAND.length).trim();
        if (!effort) {
            const current = this.controller.getModelSelection(sessionKey);
            const info = (await this.controller.listModels(sessionKey)).find(entry => entry.provider === current.provider && entry.id === current.model);
            const choices = info?.reasoningEfforts?.length ? info.reasoningEfforts : FALLBACK_REASONING_EFFORTS;
            await ctx.respond(`请发送 /reasoningEff <等级>。可选: ${choices.join(', ')}`);
            return;
        }
        try {
            const current = this.controller.getModelSelection(sessionKey);
            const info = (await this.controller.listModels(sessionKey)).find(entry => entry.provider === current.provider && entry.id === current.model);
            const choices = info?.reasoningEfforts?.length ? info.reasoningEfforts : FALLBACK_REASONING_EFFORTS;
            if (!choices.includes(effort)) {
                await ctx.respond(`未找到推理等级: ${effort}\n可选: ${choices.join(', ')}`);
                return;
            }
            const selected = await this.controller.selectReasoningEffort(sessionKey, effort);
            await ctx.respond(formatSelection('已切换推理等级', selected));
        }
        catch (err) {
            await ctx.respond(`推理等级不可用: ${errorMessage(err)}`);
        }
    }
}
export class ModelControlHandler extends BridgeControlHandler {
}
export function installBridgeModelSelection(agentCtx, selection) {
    const scoped = agentCtx;
    if (typeof scoped.on !== 'function')
        return () => { };
    const disposeAssembly = scoped.on('system-prompt/assemble', async (...args) => {
        const next = args[2];
        if (typeof next !== 'function')
            return undefined;
        const selected = selection.current;
        const assembled = await next();
        selection.assembled = selected;
        return {
            ...assembled,
            variables: {
                ...assembled.variables,
                provider: selected.provider,
                model: selected.model,
            },
        };
    });
    const disposeRequest = scoped.on('agent/request', async (...args) => {
        const next = args[1];
        if (typeof next !== 'function')
            return undefined;
        const resolved = await next();
        const selected = selection.assembled ?? selection.current;
        const { reasoningEffort: _previousReasoningEffort, ...withoutPreviousReasoningEffort } = resolved;
        return {
            ...withoutPreviousReasoningEffort,
            provider: selected.provider,
            model: selected.model,
            ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
        };
    });
    return () => {
        disposeAssembly();
        disposeRequest();
    };
}
export function resolveConfiguredModels(defaultModel, configured = []) {
    const models = [defaultModel, ...configured, 'deepseek-v4-flash', 'deepseek-v4-pro'];
    return [...new Set(models.filter(model => model.trim() !== ''))];
}
function formatHelp() {
    return [
        'Bridge 控制命令:',
        '/help - 查看这段说明',
        '/models - 列出当前 provider 可用模型',
        '/model <模型名> - 切换当前 QQ 会话模型，模型名必须完全匹配',
        '/reasoningEff <等级> - 切换当前 QQ 会话推理等级',
        '/permission [preset] - 查看或切换当前 QQ 会话权限 preset',
        '/permissions - 查看当前权限 preset 和可用 preset',
        '/dir <目录> - 切换当前 QQ 会话工作目录',
    ].join('\n');
}
function formatModels(models, current) {
    if (models.length === 0)
        return '当前没有可列出的模型。';
    const lines = [
        `当前模型: ${current.model}${current.reasoningEffort ? ` (${current.reasoningEffort})` : ''}`,
        '可用模型:',
    ];
    for (const model of models) {
        const reasoning = model.reasoningEfforts?.length
            ? `；reasoning: ${model.reasoningEfforts.join(', ')}`
            : '';
        lines.push(`- ${model.id}${model.name && model.name !== model.id ? ` (${model.name})` : ''}${reasoning}`);
    }
    return lines.join('\n');
}
function formatModelIds(models) {
    if (models.length === 0)
        return '可选模型列表为空。';
    return `可选模型: ${models.map(model => model.id).join(', ')}`;
}
function formatSelection(prefix, selected) {
    return [
        `${prefix}: ${selected.model}`,
        `provider: ${selected.provider}`,
        `reasoningEffort: ${selected.reasoningEffort ?? '(provider default)'}`,
        '下一次模型请求生效；正在运行的请求不受影响。',
    ].join('\n');
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
