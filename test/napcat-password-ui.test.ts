import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

async function helpers() {
  const source = (await readFile('src/client.js', 'utf8')).replace(
    'exports.inject =',
    'exports.testHelpers = { draftFrom, opsFromDraft, NapcatFields }; exports.inject =',
  )
  let api: any
  runInNewContext(source, {
    window: { __ModuleLoader__: { load({ factory }: any) {
      api = factory(() => ({
        createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
        useState: () => [false, () => {}],
      })).testHelpers
    } } },
  })
  return api
}
const config = { napcat: { loginQq: 10001, loginPassword: 'saved-secret' }, access: { adminQq: 20002 } }
const passwordOps = (ops: any[]) => ops.filter(op => JSON.stringify(op.path) === JSON.stringify(['napcat', 'loginPassword']))

describe('NapCat scan settings UI', () => {
  it('ignores old saved passwords and never sends them in settings mutations', async () => {
    const { draftFrom, opsFromDraft } = await helpers()
    const draft = draftFrom(config)
    expect(draft.napcat.loginPassword).toBeUndefined()
    expect(passwordOps(opsFromDraft(draft, undefined, true))).toEqual([])
    expect(JSON.stringify(draft)).not.toContain('saved-secret')
  })

  it('renders restart-and-scan instructions without a password field', async () => {
    const { draftFrom, NapcatFields } = await helpers()
    const tree = NapcatFields({ draft: draftFrom(config), disabled: false, update: () => {}, status: {
      state: 'ready', recovery: { state: 'waiting-scan', message: '等待扫码登录' },
    } })
    const json = JSON.stringify(tree)
    expect(json).not.toContain('"type":"password"')
    expect(json).toContain('等待扫码登录')
    expect(json).toContain('掉线后自动重启并提示扫码')
    expect(json).not.toContain('saved-secret')
  })
})
