import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export function updatePermissionDefaultPreset(content, preset = 'danger-full-access') {
    const normalized = normalizeLineEndings(content);
    const lines = normalized.trim() === '' ? [] : normalized.split('\n');
    const valueLine = `  defaultPreset: ${preset}`;
    const permissionStart = findTopLevelKey(lines, 'permission');
    let nextLines;
    if (permissionStart === -1) {
        nextLines = [...trimTrailingBlankLines(lines)];
        if (nextLines.length > 0)
            nextLines.push('');
        nextLines.push('permission:', valueLine);
    }
    else {
        const permissionEnd = findNextTopLevelKey(lines, permissionStart + 1);
        const existing = findIndentedKey(lines, permissionStart + 1, permissionEnd, 2, 'defaultPreset');
        if (existing === -1) {
            nextLines = [
                ...lines.slice(0, permissionStart + 1),
                valueLine,
                ...lines.slice(permissionStart + 1),
            ];
        }
        else {
            nextLines = [
                ...lines.slice(0, existing),
                valueLine,
                ...lines.slice(existing + 1),
            ];
        }
    }
    const next = trimTrailingBlankLines(nextLines).join('\n') + '\n';
    return {
        changed: next !== normalized,
        content: next,
        preview: makePreview(normalized, next),
    };
}
export async function writeSettingsWithBackup(path, nextContent, backupPath) {
    const previous = await readFile(path, 'utf8').catch(() => '');
    await mkdir(dirname(path), { recursive: true });
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(path, nextContent, 'utf8');
    await writeFile(backupPath, previous, 'utf8');
    return backupPath;
}
function findTopLevelKey(lines, key) {
    const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`);
    return lines.findIndex((line) => pattern.test(line));
}
function findNextTopLevelKey(lines, from) {
    for (let i = from; i < lines.length; i++) {
        if (/^[^\s#][^:]*:\s*.*$/.test(lines[i]))
            return i;
    }
    return lines.length;
}
function findIndentedKey(lines, from, to, indent, key) {
    const pattern = new RegExp(`^\\s{${indent}}${escapeRegExp(key)}:\\s*.*$`);
    for (let i = from; i < to; i++) {
        if (pattern.test(lines[i]))
            return i;
    }
    return -1;
}
function makePreview(before, after) {
    if (before === after)
        return '(no changes)';
    return [
        '--- settings.yaml',
        '+++ settings.yaml',
        after,
    ].join('\n');
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
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
