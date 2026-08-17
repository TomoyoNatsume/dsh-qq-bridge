import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface BridgeProfileConfig {
  pluginName: string
  wsUrl: string
  token: string
  adminQq: number
  commandPrefix: string
  provider: string
  model: string
  selfLogEnabled: boolean
  selfLogPath?: string
}

export interface ProfileUpdateResult {
  changed: boolean
  content: string
  preview: string
  action: 'added' | 'replaced' | 'unchanged'
}

const BRIDGE_ID = 'dsh-qq-bridge'
const PERMISSION_ID = 'permission'

export function buildBridgeInsertItem(cfg: BridgeProfileConfig): string {
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
      ]

  return [
    `    - id: ${BRIDGE_ID}`,
    `      name: ${cfg.pluginName}`,
    '      config:',
    '        napcat:',
    `          wsUrl: ${cfg.wsUrl}`,
    `          token: ${yamlQuote(cfg.token)}`,
    '        access:',
    `          adminQq: ${cfg.adminQq}`,
    '          allowlist: []',
    `          commandPrefix: ${cfg.commandPrefix}`,
    '          mode: whitelist',
    '        agent:',
    `          provider: ${cfg.provider}`,
    `          model: ${cfg.model}`,
    '          preset: standard',
    '          streamReasoning: false',
    '          maxMessageLength: 4500',
    '          ackMessage: 收到，正在处理...',
    '          timeoutMs: 120000',
    '          timeoutMessage: agent 无响应，请稍后重试。',
    '        shell:',
    '          enabled: false',
    ...selfLog,
  ].join('\n')
}

export function updateSetupProfilePatch(content: string, bridgeItem: string): ProfileUpdateResult {
  const normalized = normalizeLineEndings(content)
  const withBridge = updateProfilePatch(normalized, bridgeItem, BRIDGE_ID)
  const cleaned = removeInsertItem(withBridge.content, PERMISSION_ID)
  const changed = cleaned.content !== normalized
  return {
    changed,
    content: cleaned.content,
    preview: makePreview(normalized, cleaned.content),
    action: changed
      ? withBridge.action === 'replaced' || cleaned.action === 'replaced'
        ? 'replaced'
        : 'added'
      : 'unchanged',
  }
}

export function removeInsertItem(content: string, itemId: string): ProfileUpdateResult {
  const normalized = normalizeLineEndings(content)
  let lines = normalized.split('\n')
  let removed = false

  while (true) {
    const insertRanges = findTopLevelInsertRanges(lines)
    let found = false
    for (const range of insertRanges) {
      const existing = findInsertItem(lines, range.start + 1, range.end, itemId)
      if (!existing) continue
      lines = [...lines.slice(0, existing.start), ...lines.slice(existing.end)]
      removed = true
      found = true
      break
    }
    if (!found) break
  }

  const next = trimTrailingBlankLines(lines).join('\n') + '\n'
  return {
    changed: removed,
    content: next,
    preview: makePreview(normalized, next),
    action: removed ? 'replaced' : 'unchanged',
  }
}

export function updateProfilePatch(content: string, item: string, itemId = BRIDGE_ID): ProfileUpdateResult {
  const normalized = normalizeLineEndings(content)
  if (normalized.trim() === '[]' || normalized.trim() === '') {
    const next = ['- insert:', ...item.split('\n')].join('\n') + '\n'
    return {
      changed: next !== normalized,
      content: next,
      preview: makePreview(normalized, next),
      action: 'added',
    }
  }
  const lines = normalized.split('\n')
  const insertRanges = findTopLevelInsertRanges(lines)

  for (const range of insertRanges) {
    const existing = findInsertItem(lines, range.start + 1, range.end, itemId)
    if (!existing) continue

    const replacement = item.split('\n')
    const nextLines = [
      ...lines.slice(0, existing.start),
      ...replacement,
      ...lines.slice(existing.end),
    ]
    const next = trimTrailingBlankLines(nextLines).join('\n') + '\n'
    return {
      changed: next !== normalized,
      content: next,
      preview: makePreview(normalized, next),
      action: next === normalized ? 'unchanged' : 'replaced',
    }
  }

  if (insertRanges.length > 0) {
    const range = insertRanges[insertRanges.length - 1]
    const insertAt = range.end
    const nextLines = [
      ...lines.slice(0, insertAt),
      ...item.split('\n'),
      ...lines.slice(insertAt),
    ]
    const next = trimTrailingBlankLines(nextLines).join('\n') + '\n'
    return {
      changed: next !== normalized,
      content: next,
      preview: makePreview(normalized, next),
      action: 'added',
    }
  }

  const base = trimTrailingBlankLines(lines)
  if (base.length > 0 && base[base.length - 1] !== '') base.push('')
  base.push('- insert:', ...item.split('\n'))
  const next = base.join('\n') + '\n'
  return {
    changed: next !== normalized,
    content: next,
    preview: makePreview(normalized, next),
    action: 'added',
  }
}

export async function writeProfilePatchWithBackup(path: string, nextContent: string): Promise<string> {
  const previous = await readFile(path, 'utf8').catch(() => '[]\n')
  await mkdir(dirname(path), { recursive: true })
  const backup = `${path}.bak.${timestamp()}`
  await writeFile(backup, previous, 'utf8')
  await writeFile(path, nextContent, 'utf8')
  return backup
}

function findTopLevelInsertRanges(lines: string[]): Array<{ start: number; end: number }> {
  const starts: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/^-\s+insert:\s*$/.test(lines[i])) starts.push(i)
  }
  return starts.map((start, idx) => ({
    start,
    end: idx + 1 < starts.length
      ? Math.min(starts[idx + 1], findNextTopLevelEntry(lines, start + 1))
      : findNextTopLevelEntry(lines, start + 1),
  }))
}

function findNextTopLevelEntry(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (/^-\s+\S/.test(lines[i])) return i
  }
  return lines.length
}

function findInsertItem(lines: string[], from: number, to: number, itemId: string): { start: number; end: number } | null {
  for (let i = from; i < to; i++) {
    const match = new RegExp(`^(\\s*)-\\s+id:\\s+${escapeRegExp(itemId)}\\s*$`).exec(lines[i])
    if (!match) continue
    const indent = match[1].length
    if (indent === 0) continue
    let end = i + 1
    while (end < to) {
      const line = lines[end]
      if (line.trim() === '') {
        end += 1
        continue
      }
      const nextIndent = line.match(/^\s*/)?.[0].length ?? 0
      if (nextIndent <= indent && line.trimStart().startsWith('- ')) break
      end += 1
    }
    return { start: i, end }
  }
  return null
}

function makePreview(before: string, after: string): string {
  if (before === after) return '(no changes)'
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const prefix = commonPrefixLength(beforeLines, afterLines)
  const suffix = commonSuffixLength(beforeLines, afterLines, prefix)
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix)
  const added = afterLines.slice(prefix, afterLines.length - suffix)
  return [
    '--- cordis.patch.yml',
    '+++ cordis.patch.yml',
    ...removed.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
  ].join('\n')
}

function commonPrefixLength(a: string[], b: string[]): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  return i
}

function commonSuffixLength(a: string[], b: string[], prefix: number): number {
  let i = 0
  while (a.length - 1 - i >= prefix && b.length - 1 - i >= prefix && a[a.length - 1 - i] === b[b.length - 1 - i]) {
    i += 1
  }
  return i
}

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, '\n')
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines]
  while (next.length > 0 && next[next.length - 1] === '') next.pop()
  return next
}

function timestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    randomBytes(2).toString('hex'),
  ].join('')
}

function yamlQuote(value: string): string {
  return JSON.stringify(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
