import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
export class Prompter {
    rl;
    async text(label, fallback) {
        if (useInquirer()) {
            const prompts = await loadInquirer();
            if (prompts) {
                const answer = await prompts.input({
                    message: label,
                    default: fallback,
                });
                return answer.trim() || fallback || '';
            }
        }
        const suffix = fallback ? ` (${fallback})` : '';
        const answer = (await this.readline().question(`${label}${suffix}: `)).trim();
        return answer || fallback || '';
    }
    async confirm(label, fallback = true) {
        if (useInquirer()) {
            const prompts = await loadInquirer();
            if (prompts) {
                return prompts.select({
                    message: label,
                    choices: [
                        { name: '是', value: true },
                        { name: '否', value: false },
                    ],
                    default: fallback,
                });
            }
        }
        while (true) {
            const hint = fallback ? 'Y/n' : 'y/N';
            const answer = (await this.readline().question(`${label} [${hint}]: `)).trim();
            const parsed = resolveConfirm(answer, fallback);
            if (parsed !== null)
                return parsed;
            output.write('请输入 y 或 n。\n');
        }
    }
    async choice(label, choices, fallback) {
        if (useInquirer()) {
            const prompts = await loadInquirer();
            if (prompts) {
                return prompts.select({
                    message: label,
                    choices: choices.map((choice) => ({ name: choice, value: choice })),
                    default: fallback,
                });
            }
        }
        while (true) {
            output.write(`${label}\n`);
            choices.forEach((choice, index) => output.write(`  ${index + 1}. ${choice}\n`));
            const answer = (await this.readline().question(`选择 (${fallback}): `)).trim();
            const parsed = resolveChoice(answer, choices, fallback);
            if (parsed !== null)
                return parsed;
            output.write(`请输入 1-${choices.length} 的序号，或输入选项文本。\n`);
        }
    }
    close() {
        this.rl?.close();
    }
    readline() {
        this.rl ??= createInterface({ input, output });
        return this.rl;
    }
}
export function parseQq(value) {
    if (!/^\d{5,}$/.test(value.trim()))
        throw new Error('QQ 号格式不正确');
    const qq = Number(value);
    if (!Number.isSafeInteger(qq))
        throw new Error('QQ 号超出安全整数范围');
    return qq;
}
export function resolveConfirm(answer, fallback) {
    const normalized = answer.trim().toLowerCase();
    if (!normalized)
        return fallback;
    if (normalized === 'y' || normalized === 'yes')
        return true;
    if (normalized === 'n' || normalized === 'no')
        return false;
    return null;
}
export function resolveChoice(answer, choices, fallback) {
    const trimmed = answer.trim();
    if (!trimmed)
        return fallback;
    const index = Number(trimmed);
    if (Number.isInteger(index) && index >= 1 && index <= choices.length)
        return choices[index - 1];
    return choices.includes(trimmed) ? trimmed : null;
}
function useInquirer() {
    return Boolean(input.isTTY && output.isTTY);
}
let inquirer;
let warnedInquirerFallback = false;
async function loadInquirer() {
    inquirer ??= import('@inquirer/prompts');
    try {
        return await inquirer;
    }
    catch (err) {
        if (!warnedInquirerFallback) {
            warnedInquirerFallback = true;
            output.write(`交互式选择器不可用，已退回普通输入模式。原因: ${err instanceof Error ? err.message : String(err)}\n`);
        }
        return null;
    }
}
