import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { napcatExecutableExists } from '../src/napcat-tags.js'

describe('NapCat PATH detection', () => {
  it('detects an executable without launching it and rejects missing/non-executable files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'napcat-path-'))
    try {
      expect(await napcatExecutableExists(dir)).toBe(false)
      await writeFile(join(dir, 'napcat'), 'not a runnable program', { mode: 0o644 })
      expect(await napcatExecutableExists(dir)).toBe(false)
      await rm(join(dir, 'napcat'))
      await writeFile(join(dir, 'napcat'), 'not a runnable program', { mode: 0o755 })
      expect(await napcatExecutableExists(dir)).toBe(true)
      await rm(join(dir, 'napcat'))
      await mkdir(join(dir, 'napcat'))
      expect(await napcatExecutableExists(dir)).toBe(false)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
