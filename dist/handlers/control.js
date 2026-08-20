import { stat } from 'node:fs/promises';
import { resolveUserPath } from './directory.js';
export const QQ_CONTROL_BLOCK_TAG = 'dsh-qq-bridge-control';
export class QqControlDispatcher {
    handlers = new Map();
    register(handler) {
        this.handlers.set(handler.action, handler);
        return () => this.handlers.delete(handler.action);
    }
    async dispatch(action, ctx) {
        const handler = this.handlers.get(action.action);
        if (!handler)
            return `不支持的 QQ 控制动作: ${action.action}`;
        return await handler.run(action, ctx);
    }
}
export function parseQqControlBlocks(text) {
    const errors = [];
    const actions = [];
    const pattern = new RegExp(`<${QQ_CONTROL_BLOCK_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${QQ_CONTROL_BLOCK_TAG}>`, 'g');
    const visibleText = text.replace(pattern, (_block, rawJson) => {
        try {
            const parsed = JSON.parse(rawJson);
            if (!isQqControlAction(parsed)) {
                errors.push('QQ 控制块格式无效: 需要包含字符串 action 字段。');
            }
            else {
                actions.push(parsed);
            }
        }
        catch (err) {
            errors.push(`QQ 控制块 JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        return '';
    }).trim();
    return { visibleText, actions, errors };
}
export function createSetCwdControlHandler(switcher) {
    return {
        action: 'set_cwd',
        async run(action, ctx) {
            if (typeof action.path !== 'string' || action.path.trim() === '') {
                return 'QQ 控制块 set_cwd 缺少 path。';
            }
            const baseCwd = switcher.getCwd?.(ctx.sessionKey);
            const cwd = resolveUserPath(action.path.trim(), baseCwd);
            const info = await stat(cwd).catch(() => null);
            if (!info?.isDirectory()) {
                return `目录不存在或不是目录: ${cwd}`;
            }
            await switcher.setCwd(ctx.sessionKey, cwd);
            return `已切换当前 QQ 会话工作区: ${cwd}\n下一条消息会使用新的 Agent session。`;
        },
    };
}
function isQqControlAction(value) {
    return typeof value === 'object'
        && value !== null
        && typeof value.action === 'string'
        && value.action.trim() !== '';
}
