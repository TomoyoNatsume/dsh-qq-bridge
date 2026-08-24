import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('dsh-qq-bridge — client bundle registration', () => {
  it('registers the scoped npm package id expected by DSH plugin loading', async () => {
    const source = await readFile(join(process.cwd(), 'src/client.js'), 'utf8')
    const bundle = await readFile(join(process.cwd(), 'dist/client.js'), 'utf8')

    expect(bundle).toBe(source)
    expect(bundle).toContain('id: "@yachangchang/dsh-qq-bridge"')
    expect(bundle).toContain('const NS = "dsh-qq-bridge"')
  })
})
