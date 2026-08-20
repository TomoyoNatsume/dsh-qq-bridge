import { describe, it, expect } from 'vitest'
import { buildConnectGuidance } from '../src/plugin.js'
import { DshQqBridgeConfig } from '../src/config.js'

describe('dsh-qq-bridge — 连接健康检查/引导', () => {
  const cfg = DshQqBridgeConfig.parse({
    napcat: { wsUrl: 'ws://127.0.0.1:3001', guideDoc: 'docs/agent-napcat-guide.md' },
    access: { adminQq: 10001 },
  })

  it('连接失败包含 wsUrl、原因与向导路径', () => {
    const msg = buildConnectGuidance(cfg, new Error('ECONNREFUSED'))
    expect(msg).toContain('ws://127.0.0.1:3001')
    expect(msg).toContain('ECONNREFUSED')
    expect(msg).toContain('docs/agent-napcat-guide.md')
    expect(msg).toContain('dsh-qq-bridge')
  })

  it('无 guideDoc 配置时回退默认路径', () => {
    const cfg2 = DshQqBridgeConfig.parse({
      napcat: { wsUrl: 'ws://127.0.0.1:6000' },
      access: { adminQq: 1 },
    })
    const msg = buildConnectGuidance(cfg2, new Error('timeout'))
    expect(msg).toContain('docs/agent-napcat-guide.md')
  })

  it('非 Error 异常也会被字符串化', () => {
    const msg = buildConnectGuidance(cfg, 'boom')
    expect(msg).toContain('boom')
  })

  it('agent preset 默认使用 QQ bridge 专用 preset', () => {
    const parsed = DshQqBridgeConfig.parse({
      napcat: { wsUrl: 'ws://127.0.0.1:3001' },
      access: { adminQq: 1 },
    })
    expect(parsed.agent.preset).toBe('dsh-qq-bridge')
  })
})
