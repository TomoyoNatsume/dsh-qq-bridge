import { stat, readFile } from 'node:fs/promises';
/**
 * Experimental input source for the "single QQ account + My Computer" flow.
 *
 * NapCat may log self-sent messages such as:
 *   08-16 11:07:50 [info] Tomoyo | 发送 -> 私聊 (10001) /dsh hello
 *   08-16 11:10:40 [info] Tomoyo | 发送 -> 移动设备 /dsh hello
 *
 * In some setups these messages are not pushed as OneBot message events even
 * when reportSelfMessage=true. This tailer turns matching log lines into the
 * same internal private-message shape consumed by MessageRouter.
 */
export class NapcatSelfLogInput {
    opts;
    timer = null;
    offset = 0;
    rest = '';
    seq = 0;
    constructor(opts) {
        this.opts = opts;
    }
    async start(onMessage) {
        if (this.timer)
            return;
        if (!this.opts.replayOnStart) {
            try {
                this.offset = (await stat(this.opts.logPath)).size;
            }
            catch {
                this.offset = 0;
            }
        }
        await this.poll(onMessage);
        const interval = this.opts.pollIntervalMs ?? 1000;
        this.timer = setInterval(() => {
            void this.poll(onMessage);
        }, interval);
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    async poll(onMessage) {
        let size;
        try {
            size = (await stat(this.opts.logPath)).size;
        }
        catch {
            return;
        }
        // Log rotated or truncated.
        if (size < this.offset) {
            this.offset = 0;
            this.rest = '';
        }
        if (size === this.offset)
            return;
        const buf = await readFile(this.opts.logPath);
        const chunk = buf.subarray(this.offset, size).toString('utf8');
        this.offset = size;
        const lines = (this.rest + chunk).split(/\r?\n/);
        this.rest = lines.pop() ?? '';
        for (const line of lines) {
            const parsed = parseNapcatSelfLogLine(line, {
                selfQq: this.opts.selfQq,
                commandPrefix: this.opts.commandPrefix,
            });
            if (!parsed)
                continue;
            onMessage({
                post_type: 'message',
                message_type: 'private',
                user_id: parsed.userId,
                raw_message: parsed.rawMessage,
                message_id: Date.now() + this.seq++,
                sub_type: 'friend',
            });
        }
    }
}
export function parseNapcatSelfLogLine(line, opts) {
    const clean = stripAnsi(line);
    const marker = '发送 -> ';
    const idx = clean.indexOf(marker);
    if (idx < 0)
        return null;
    const body = clean.slice(idx + marker.length);
    const privateMatch = /^私聊 \((\d+)\) (.*)$/.exec(body);
    if (privateMatch) {
        const userId = Number(privateMatch[1]);
        const rawMessage = privateMatch[2].trim();
        if (!Number.isFinite(userId) || userId !== opts.selfQq)
            return null;
        if (!rawMessage.startsWith(opts.commandPrefix))
            return null;
        return { userId, rawMessage };
    }
    const deviceMatch = /^移动设备\s+(.*)$/.exec(body);
    if (deviceMatch) {
        const rawMessage = deviceMatch[1].trim();
        if (!rawMessage.startsWith(opts.commandPrefix))
            return null;
        return { userId: opts.selfQq, rawMessage };
    }
    return null;
}
function stripAnsi(input) {
    return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}
