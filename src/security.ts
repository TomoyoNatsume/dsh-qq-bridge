import { OnebotMessageEvent, OnebotMessageType } from './onebot/types.js'

export interface AccessOptions {
  /** 拥有者 QQ(总是放行) */
  adminQq: number
  /** 额外允许的 user_id */
  allowlist: number[]
  /** 指令前缀,如 '/dsh' */
  commandPrefix: string
  /** whitelist: 只允许 admin+allowlist;open: 任何人都能触发(仅测试用) */
  mode: 'whitelist' | 'open'
}

/**
 * 安全门:白名单 + 指令前缀过滤。
 */
export class AccessGate {
  constructor(private readonly opts: AccessOptions) {}

  /**
   * 是否允许这条消息进入 router。
   * whitelist 模式仅放行 admin + allowlist;open 模式放行任何人。
   * 群聊默认也受白名单约束(避免陌生人在群里触发)。
   */
  allow(evt: Pick<OnebotMessageEvent, 'user_id'>): boolean {
    if (this.opts.mode === 'open') return true
    return evt.user_id === this.opts.adminQq || this.opts.allowlist.includes(evt.user_id)
  }

  /**
   * 剥离指令前缀,返回剩余有效载荷;若不以前缀开头返回 null。
   * 这样消息必须显式以 '/dsh' 开头才被处理(避免打扰其他 QQ 用法)。
   */
  stripPrefix(text: string): string | null {
    const trimmed = text.trim()
    if (!trimmed.startsWith(this.opts.commandPrefix)) return null
    return trimmed.slice(this.opts.commandPrefix.length).trim()
  }
}

export type { OnebotMessageType }
