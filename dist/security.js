/**
 * 安全门:白名单 + 指令前缀过滤。
 */
export class AccessGate {
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    /**
     * 是否允许这条消息进入 router。
     * whitelist 模式仅放行 admin + allowlist;open 模式放行任何人。
     * 群聊默认也受白名单约束(避免陌生人在群里触发)。
     */
    allow(evt) {
        if (this.opts.mode === 'open')
            return true;
        const adminId = this.opts.adminId ?? this.opts.adminQq;
        return evt.user_id === adminId || this.opts.allowlist.includes(evt.user_id);
    }
    /**
     * 剥离指令前缀,返回剩余有效载荷;若不以前缀开头返回 null。
     * 这样消息必须显式以 '/dsh' 开头才被处理(避免打扰其他 QQ 用法)。
     */
    stripPrefix(text) {
        const trimmed = text.trim();
        if (!trimmed.startsWith(this.opts.commandPrefix))
            return null;
        return trimmed.slice(this.opts.commandPrefix.length).trim();
    }
}
