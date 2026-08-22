import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const BRIDGE_ID = 'dsh-qq-bridge';
const PERMISSION_ID = 'permission';
const QQ_BRIDGE_PRESET_ID = 'dsh-qq-bridge';
export function buildBridgeInsertItem(cfg) {
    const selfLog = cfg.selfLogEnabled
        ? [
            '        selfLogInput:',
            '          enabled: true',
            `          logPath: ${cfg.selfLogPath ?? `/home/<你的Linux用户名>/Napcat/log/napcat_${cfg.adminQq}.log`}`,
            '          pollIntervalMs: 1000',
            '          replayOnStart: false',
        ]
        : [
            '        selfLogInput:',
            '          enabled: false',
        ];
    return [
        `    - id: ${BRIDGE_ID}`,
        `      name: ${cfg.pluginName}`,
        '      config:',
        '        enabled: true',
        '        platform: napcat',
        '        napcat:',
        `          wsUrl: ${cfg.wsUrl}`,
        `          token: ${yamlQuote(cfg.token)}`,
        '        access:',
        `          adminQq: ${cfg.adminQq}`,
        '          allowlist: []',
        `          commandPrefix: ${yamlQuote(cfg.commandPrefix)}`,
        '          mode: whitelist',
        '        agent:',
        `          provider: ${cfg.provider}`,
        `          model: ${cfg.model}`,
        `          cwd: ${yamlQuote(cfg.cwd)}`,
        `          preset: ${QQ_BRIDGE_PRESET_ID}`,
        '          streamReasoning: false',
        '          maxMessageLength: 4500',
        '          ackMessage: 收到，正在处理...',
        '          timeoutMs: 120000',
        '          timeoutMessage: agent 无响应，请稍后重试。',
        '          qqReplyStyleSkill:',
        '            enabled: true',
        '            skillName: qq-session-reply-style',
        '        shell:',
        '          enabled: false',
        ...selfLog,
    ].join('\n');
}
export function buildOfficialBridgeInsertItem(cfg) {
    return [
        `    - id: ${BRIDGE_ID}`,
        `      name: ${cfg.pluginName}`,
        '      config:',
        '        enabled: true',
        '        platform: official',
        '        official:',
        `          appId: ${yamlQuote(cfg.appId)}`,
        `          appSecret: ${yamlQuote(cfg.appSecret)}`,
        `          adminOpenId: ${yamlQuote(cfg.adminOpenId)}`,
        `          allowlistOpenIds: ${yamlStringArray(cfg.allowlistOpenIds)}`,
        `          sandbox: ${cfg.sandbox ? 'true' : 'false'}`,
        '        access:',
        '          adminQq: 0',
        '          allowlist: []',
        `          commandPrefix: ${yamlQuote(cfg.commandPrefix)}`,
        '          mode: whitelist',
        '        notifications:',
        '          agentReply:',
        '            enabled: false',
        '        agent:',
        `          provider: ${cfg.provider}`,
        `          model: ${cfg.model}`,
        `          cwd: ${yamlQuote(cfg.cwd)}`,
        `          preset: ${QQ_BRIDGE_PRESET_ID}`,
        '          streamReasoning: false',
        '          maxMessageLength: 4500',
        '          ackMessage: 收到，正在处理...',
        '          timeoutMs: 120000',
        '          timeoutMessage: agent 无响应，请稍后重试。',
        '          qqReplyStyleSkill:',
        '            enabled: true',
        '            skillName: qq-session-reply-style',
        '        shell:',
        '          enabled: false',
        '        selfLogInput:',
        '          enabled: false',
    ].join('\n');
}
export function updateSetupProfilePatch(content, bridgeItem) {
    const normalized = normalizeLineEndings(content);
    const withBridge = updateProfilePatch(normalized, bridgeItem, BRIDGE_ID);
    const cleaned = removeInsertItem(withBridge.content, PERMISSION_ID);
    const changed = cleaned.content !== normalized;
    return {
        changed,
        content: cleaned.content,
        preview: makePreview(normalized, cleaned.content),
        action: changed
            ? withBridge.action === 'replaced' || cleaned.action === 'replaced'
                ? 'replaced'
                : 'added'
            : 'unchanged',
    };
}
export function removeInsertItem(content, itemId) {
    const normalized = normalizeLineEndings(content);
    let lines = normalized.split('\n');
    let removed = false;
    while (true) {
        const insertRanges = findTopLevelInsertRanges(lines);
        let found = false;
        for (const range of insertRanges) {
            const existing = findInsertItem(lines, range.start + 1, range.end, itemId);
            if (!existing)
                continue;
            lines = [...lines.slice(0, existing.start), ...lines.slice(existing.end)];
            removed = true;
            found = true;
            break;
        }
        if (!found)
            break;
    }
    if (removed)
        lines = removeEmptyInsertBlocks(lines);
    const next = trimTrailingBlankLines(lines).join('\n') + '\n';
    return {
        changed: removed,
        content: next,
        preview: makePreview(normalized, next),
        action: removed ? 'replaced' : 'unchanged',
    };
}
function removeEmptyInsertBlocks(lines) {
    let next = [...lines];
    const ranges = findTopLevelInsertRanges(next);
    for (let i = ranges.length - 1; i >= 0; i--) {
        const range = ranges[i];
        const hasContent = next.slice(range.start + 1, range.end).some((line) => line.trim() !== '');
        if (hasContent)
            continue;
        next = [...next.slice(0, range.start), ...next.slice(range.end)];
    }
    return next;
}
export function updateProfilePatch(content, item, itemId = BRIDGE_ID) {
    const normalized = normalizeLineEndings(content);
    if (normalized.trim() === '[]' || normalized.trim() === '') {
        const next = ['- insert:', ...item.split('\n')].join('\n') + '\n';
        return {
            changed: next !== normalized,
            content: next,
            preview: makePreview(normalized, next),
            action: 'added',
        };
    }
    const lines = normalized.split('\n');
    const insertRanges = findTopLevelInsertRanges(lines);
    for (const range of insertRanges) {
        const existing = findInsertItem(lines, range.start + 1, range.end, itemId);
        if (!existing)
            continue;
        const replacement = item.split('\n');
        const nextLines = [
            ...lines.slice(0, existing.start),
            ...replacement,
            ...lines.slice(existing.end),
        ];
        const next = trimTrailingBlankLines(nextLines).join('\n') + '\n';
        return {
            changed: next !== normalized,
            content: next,
            preview: makePreview(normalized, next),
            action: next === normalized ? 'unchanged' : 'replaced',
        };
    }
    if (insertRanges.length > 0) {
        const range = insertRanges[insertRanges.length - 1];
        const insertAt = range.end;
        const nextLines = [
            ...lines.slice(0, insertAt),
            ...item.split('\n'),
            ...lines.slice(insertAt),
        ];
        const next = trimTrailingBlankLines(nextLines).join('\n') + '\n';
        return {
            changed: next !== normalized,
            content: next,
            preview: makePreview(normalized, next),
            action: 'added',
        };
    }
    const base = trimTrailingBlankLines(lines);
    if (base.length > 0 && base[base.length - 1] !== '')
        base.push('');
    base.push('- insert:', ...item.split('\n'));
    const next = base.join('\n') + '\n';
    return {
        changed: next !== normalized,
        content: next,
        preview: makePreview(normalized, next),
        action: 'added',
    };
}
export async function writeProfilePatchWithBackup(path, nextContent, backupPath) {
    const previous = await readFile(path, 'utf8').catch(() => '[]\n');
    await mkdir(dirname(path), { recursive: true });
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(path, nextContent, 'utf8');
    await writeFile(backupPath, previous, 'utf8');
    return backupPath;
}
function findTopLevelInsertRanges(lines) {
    const starts = [];
    for (let i = 0; i < lines.length; i++) {
        if (/^-\s+insert:\s*$/.test(lines[i]))
            starts.push(i);
    }
    return starts.map((start, idx) => ({
        start,
        end: idx + 1 < starts.length
            ? Math.min(starts[idx + 1], findNextTopLevelEntry(lines, start + 1))
            : findNextTopLevelEntry(lines, start + 1),
    }));
}
function findNextTopLevelEntry(lines, from) {
    for (let i = from; i < lines.length; i++) {
        if (/^-\s+\S/.test(lines[i]))
            return i;
    }
    return lines.length;
}
function findInsertItem(lines, from, to, itemId) {
    for (let i = from; i < to; i++) {
        const match = new RegExp(`^(\\s*)-\\s+id:\\s+${escapeRegExp(itemId)}\\s*$`).exec(lines[i]);
        if (!match)
            continue;
        const indent = match[1].length;
        if (indent === 0)
            continue;
        let end = i + 1;
        while (end < to) {
            const line = lines[end];
            if (line.trim() === '') {
                end += 1;
                continue;
            }
            const nextIndent = line.match(/^\s*/)?.[0].length ?? 0;
            if (nextIndent <= indent && line.trimStart().startsWith('- '))
                break;
            end += 1;
        }
        return { start: i, end };
    }
    return null;
}
function makePreview(before, after) {
    if (before === after)
        return '(no changes)';
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const prefix = commonPrefixLength(beforeLines, afterLines);
    const suffix = commonSuffixLength(beforeLines, afterLines, prefix);
    const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
    const added = afterLines.slice(prefix, afterLines.length - suffix);
    return [
        '--- cordis.patch.yml',
        '+++ cordis.patch.yml',
        ...removed.map((line) => `- ${line}`),
        ...added.map((line) => `+ ${line}`),
    ].join('\n');
}
function commonPrefixLength(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i])
        i += 1;
    return i;
}
function commonSuffixLength(a, b, prefix) {
    let i = 0;
    while (a.length - 1 - i >= prefix && b.length - 1 - i >= prefix && a[a.length - 1 - i] === b[b.length - 1 - i]) {
        i += 1;
    }
    return i;
}
function normalizeLineEndings(input) {
    return input.replace(/\r\n/g, '\n');
}
function trimTrailingBlankLines(lines) {
    const next = [...lines];
    while (next.length > 0 && next[next.length - 1] === '')
        next.pop();
    return next;
}
function yamlQuote(value) {
    return JSON.stringify(value);
}
function yamlStringArray(values) {
    return `[${values.map((value) => yamlQuote(value)).join(', ')}]`;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
