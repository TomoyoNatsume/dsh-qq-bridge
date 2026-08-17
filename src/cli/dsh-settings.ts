import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SettingsUpdateResult {
  changed: boolean
  content: string
  preview: string
}

export function updatePermissionDefaultPreset(content: string, preset = 'danger-full-access'): SettingsUpdateResult {
  const normalized = normalizeLineEndings(content)
  const lines = normalized.trim() === '' ? [] : normalized.split('\n')
  const valueLine = `  defaultPreset: ${preset}`
  const permissionStart = findTopLevelKey(lines, 'permission')

  let nextLines: string[]
  if (permissionStart === -1) {
    nextLines = [...trimTrailingBlankLines(lines)]
    if (nextLines.length > 0) nextLines.push('')
    nextLines.push('permission:', valueLine)
  } else {
    const permissionEnd = findNextTopLevelKey(lines, permissionStart + 1)
    const existing = findIndentedKey(lines, permissionStart + 1, permissionEnd, 2, 'defaultPreset')
    if (existing === -1) {
      nextLines = [
        ...lines.slice(0, permissionStart + 1),
        valueLine,
        ...lines.slice(permissionStart + 1),
      ]
    } else {
      nextLines = [
        ...lines.slice(0, existing),
        valueLine,
        ...lines.slice(existing + 1),
      ]
    }
  }

  const next = trimTrailingBlankLines(nextLines).join('\n') + '\n'
  return {
    changed: next !== normalized,
    content: next,
    preview: makePreview(normalized, next),
  }
}

export async function writeSettingsWithBackup(path: string, nextContent: string): Promise<string> {
  const previous = await readFile(path, 'utf8').catch(() => '')
  await mkdir(dirname(path), { recursive: true })
  const backup = `${path}.bak.${timestamp()}`
  await writeFile(backup, previous, 'utf8')
  await writeFile(path, nextContent, 'utf8')
  return backup
}

function findTopLevelKey(lines: string[], key: string): number {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`)
  return lines.findIndex((line) => pattern.test(line))
}

function findNextTopLevelKey(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (/^[^\s#][^:]*:\s*.*$/.test(lines[i])) return i
  }
  return lines.length
}

function findIndentedKey(lines: string[], from: number, to: number, indent: number, key: string): number {
  const pattern = new RegExp(`^\\s{${indent}}${escapeRegExp(key)}:\\s*.*$`)
  for (let i = from; i < to; i++) {
    if (pattern.test(lines[i])) return i
  }
  return -1
}

function makePreview(before: string, after: string): string {
  if (before === after) return '(no changes)'
  return [
    '--- settings.yaml',
    '+++ settings.yaml',
    after,
  ].join('\n')
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
