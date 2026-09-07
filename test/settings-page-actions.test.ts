import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

async function page(overrides: Record<string, unknown> = {}, rejectSave = false, buttonLabel = '启动Napcat') {
  const source = (await readFile('src/client.js', 'utf8')).replace('exports.inject =',
    'exports.testHelpers = { QqBridgeSettingsSection, configurationError, draftFrom, generalOpsFromDraft, generalConfigurationError, platformOpsFromDraft, detectNapcatTags }; exports.inject =')
  const states: unknown[] = []
  let helpers: any
  runInNewContext(source, { window: { __ModuleLoader__: { load({ factory }: any) {
    helpers = factory(() => ({
      createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
      useRef: () => ({ current: undefined }),
      useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, (value: unknown) => states.push(value)],
      useEffect: () => {},
    })).testHelpers
  } } } })
  const value = { napcat: { loginQq: 10001 }, access: { adminQq: 20002 }, ...overrides }
  const order: string[] = []
  let revision = 7
  const mutate = vi.fn(async (_request: any) => {
    order.push('save')
    return { result: rejectSave ? { ok: false, error: { message: 'write failed' } } : { ok: true, value: { revision: ++revision } } }
  })
  const call = vi.fn(async (_channel: string, endpoint: string) => {
    if (endpoint === 'tag') return { ok: true, value: { installed: true } }
    order.push('setup')
    return { ok: true, value: { state: 'ready', onebot: { wsUrl: 'ws://127.0.0.1:3001', token: 'generated' } } }
  })
  // The subscription deliberately lags behind writes: the next mutation must use the response revision.
  const tree = helpers.QqBridgeSettingsSection({
    scope: { getSnapshot: () => ({ status: 'ready', writable: true, revision: 7, value }) },
    api: { settings: { mutate } }, rpc: { call },
  })
  function find(node: any): any {
    if (node?.type === 'button' && node.children.includes(buttonLabel)) return node
    for (const child of node?.children ?? []) { const found = find(child); if (found) return found }
  }
  return { tree, button: find(tree), mutate, call, states, order, helpers, value }
}

describe('settings page actions', () => {
  it('validates the entire draft before any save or NapCat side effect', async () => {
    const view = await page({ agent: { provider: '' } })
    await view.button.props.onClick()
    expect(view.mutate).not.toHaveBeenCalled()
    expect(view.call).toHaveBeenCalledTimes(1)
    expect(view.states).toContain('请选择 Agent Provider。')
  })

  it('saves before setup and enables the bridge with the latest write revision', async () => {
    const view = await page()
    await view.button.props.onClick()
    expect(view.order).toEqual(['save', 'setup', 'save'])
    expect(view.mutate.mock.calls[1][0].expectedRevision).toBe(8)
    expect(view.mutate.mock.calls[1][0].ops).toContainEqual({ op: 'set', path: ['enabled'], value: true })
  })

  it('does not start NapCat when saving fails', async () => {
    const view = await page({}, true)
    await view.button.props.onClick()
    expect(view.call).toHaveBeenCalledTimes(1)
    expect(view.states).toContain('write failed')
  })

  it.each(['official'])('submits the %s form once and enables the bridge without starting NapCat', async (platform) => {
    const view = await page({ platform, official: { appId: 'app', appSecret: 'secret', adminOpenId: 'admin' } }, false, '保存并启动')
    expect(view.mutate).not.toHaveBeenCalled()
    await view.button.props.onClick()
    expect(view.mutate).toHaveBeenCalledTimes(1)
    expect(view.call).not.toHaveBeenCalled()
    expect(view.mutate.mock.calls[0][0].ops).toContainEqual({ op: 'set', path: ['enabled'], value: true })
  })

  it('keeps platform-specific cards and actions separate', async () => {
    const napcat = await page()
    expect(JSON.stringify(napcat.tree)).not.toContain('保存并启动')
    const official = await page({ platform: 'official' }, false, '保存并启动')
    const cards = official.tree.children.filter((node: any) => node?.type === 'section')
    expect(cards).toHaveLength(2)
    expect(JSON.stringify(cards[0])).toContain('通用配置')
    expect(JSON.stringify(cards[0])).not.toContain('保存并启动')
    expect(JSON.stringify(cards[1])).toContain('保存并启动')
    expect(JSON.stringify(cards[1])).toContain('官方 QQ Bot 配置')
    expect(JSON.stringify(official.tree)).not.toContain('napcat登录配置')
  })

  it('autosaves only general fields even when platform credentials are incomplete or edited', async () => {
    const { helpers } = await page()
    const draft = helpers.draftFrom({})
    draft.platform = 'official'
    draft.napcat.loginPassword = 'unsaved-napcat-secret'
    draft.official.appSecret = 'unsaved-official-secret'
    expect(helpers.generalConfigurationError(draft)).toBe('')
    expect(helpers.configurationError(draft)).toContain('AppID')
    const ops = helpers.generalOpsFromDraft(draft)
    expect(ops.map((op: any) => op.path.join('.'))).toEqual([
      'agent.provider', 'agent.model', 'agent.cwd', 'agent.streamText',
      'access.mode', 'permissionDefault', 'notifications.agentReply.enabled',
    ])
    expect(JSON.stringify(ops)).not.toContain('unsaved')
    expect(helpers.platformOpsFromDraft(draft, undefined, true).some((op: any) => op.path[0] === 'napcat')).toBe(false)
    draft.platform = 'napcat'
    expect(helpers.platformOpsFromDraft(draft, undefined, true).some((op: any) => op.path[0] === 'official')).toBe(false)
  })

  it('checks installation, runtime and login sequentially with intermediate checking tags', async () => {
    const { helpers } = await page()
    const updates: any[] = []
    const calls: string[] = []
    const rpc = { call: async (_channel: string, _endpoint: string, payload: any) => {
      calls.push(payload.stage)
      if (payload.stage === 'runtime') expect(updates.at(-1)).toEqual({ installed: 'yes', runtime: 'checking', login: 'checking' })
      if (payload.stage === 'login') expect(updates.at(-1)).toEqual({ installed: 'yes', runtime: 'yes', login: 'checking' })
      return { ok: true, value: payload.stage === 'installed' ? { installed: true } : payload.stage === 'runtime' ? { running: true, runningQqs: [10001] } : { loggedIn: true } }
    } }
    await helpers.detectNapcatTags(rpc, (next: any) => updates.push(next))
    expect(calls).toEqual(['installed', 'runtime', 'login'])
    expect(updates[0]).toEqual({ installed: 'checking', runtime: 'checking', login: 'checking' })
    expect(updates.at(-1)).toEqual({ installed: 'yes', runtime: 'yes', login: 'yes' })
  })

  it('skips dependent checks when NapCat is missing', async () => {
    const { helpers } = await page()
    const rpc = { call: vi.fn(async () => ({ ok: true, value: { installed: false } })) }
    const updates: any[] = []
    await helpers.detectNapcatTags(rpc, (next: any) => updates.push(next))
    expect(rpc.call).toHaveBeenCalledTimes(1)
    expect(updates.at(-1)).toEqual({ installed: 'no', runtime: 'no', login: 'no' })
  })

  it('explains an outdated backend and leaves dependent checks untested', async () => {
    const { helpers } = await page()
    const updates: any[] = []
    const rpc = { call: vi.fn(async () => ({ ok: false, error: { message: 'unknown NapCat endpoint: tag' } })) }
    await helpers.detectNapcatTags(rpc, (next: any) => updates.push(next))
    expect(updates.at(-1)).toMatchObject({ installed: 'error', runtime: 'blocked', login: 'blocked' })
    expect(updates.at(-1).error).toContain('重启 dsh web')
    expect(rpc.call).toHaveBeenCalledTimes(1)
  })

  it('rejects an incomplete official form without saving', async () => {
    const view = await page({ platform: 'official' }, false, '保存并启动')
    await view.button.props.onClick()
    expect(view.mutate).not.toHaveBeenCalled()
    expect(view.states).toContain('AppID 不能为空。')
  })

  it('warns about missing NapCat before validating or saving the form', async () => {
    const view = await page({ agent: { provider: '' } })
    view.call.mockResolvedValueOnce({ ok: true, value: { installed: false } })
    await view.button.props.onClick()
    expect(view.mutate).not.toHaveBeenCalled()
    expect(view.call).toHaveBeenCalledTimes(1)
    expect(view.states).toContain('NapCat 未安装，请先安装 NapCat 后再启动。')
  })

  it('rejects zero or unsafe QQ numbers', async () => {
    const { helpers, value } = await page()
    for (const qq of ['0', '9007199254740992']) {
      const draft = helpers.draftFrom(value)
      draft.napcat.loginQqText = qq
      expect(helpers.configurationError(draft)).toContain('NapCat 登录 QQ')
    }
  })
})
