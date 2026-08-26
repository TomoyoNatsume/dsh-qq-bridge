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
    expect(bundle).toContain('如何安装和配置Napcat')
    expect(bundle).toContain('NapCat 安装配置教程')
    expect(bundle).toContain('bash napcat.sh --docker n --cli y')
    expect(bundle).toContain('function commandBlock(lines)')
    expect(bundle).toContain('styles.codeLine')
    expect(bundle).toContain('function warnMessage(message)')
    expect(bundle).toContain('function statusMessage(message, error)')
    expect(bundle).toContain('function messageLineNode(line, index, emphasized)')
    expect(bundle).toContain('function isCodeMessageLine(line)')
    expect(bundle).toContain('styles.messageLine')
    expect(bundle).toContain('styles.messageCodeLine')
    expect(bundle).toContain('styles.titleRow')
    expect(bundle).toContain('确保已经扫码登陆')
    expect(bundle).toContain('warnTitle: { fontSize: 15')
    expect(bundle).toContain('messageLine: { display: "block", minWidth: 0, maxWidth: "100%", fontSize: 14')
    expect(bundle).toContain('boxSizing: "border-box"')
    expect(bundle).toContain('gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))"')
    expect(bundle).toContain('overflowWrap: "anywhere"')
    expect(bundle).toContain('无响应|未找到')
  })
})
