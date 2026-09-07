import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
const statuses = new Map();
// Keep rate limits across settings reloads within this DSH process.
const attempts = new Map();
export function getNapcatRecoveryStatus(qq) {
    return statuses.get(qq);
}
/** Exclude all password fallback credentials, including those inherited by DSH. */
export function napcatScanEnv() {
    const env = { ...process.env };
    delete env.NAPCAT_QUICK_PASSWORD;
    delete env.NAPCAT_QUICK_PASSWORD_MD5;
    return env;
}
export function restartNapcatForScan(qq, signal) {
    if (!Number.isSafeInteger(qq) || qq <= 0) {
        return Promise.reject(new Error('NapCat 登录 QQ 无效'));
    }
    return new Promise((resolve, reject) => {
        const child = spawn('napcat', ['restart', String(qq)], {
            env: napcatScanEnv(), stdio: 'ignore', timeout: 30_000, signal,
        });
        child.once('error', () => reject(new Error('NapCat 重启命令执行失败')));
        child.once('exit', code => code === 0 ? resolve() : reject(new Error('NapCat 重启命令未成功完成')));
    });
}
/** Only accept NapCat log headers, not received/sent QQ message bodies. */
export function napcatLoginSignal(line) {
    const clean = line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    const match = /^(?:\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? \[(?:error|warn|info)\]\s+(?:[^|\r\n]*\|\s*)?(.*)$/.exec(clean);
    if (!match)
        return;
    const body = match[1];
    if (/^\[KickedOffLine\]/.test(body))
        return 'kicked';
    if (/^(?:\[NapCat\]\s*\[WebUi\]\s*)?(?:请扫描下面的二维码)/.test(body))
        return 'qrcode';
}
/** Watches new log bytes independently of the single-account message input. */
export class NapcatRecovery {
    options;
    stopped = false;
    polling = false;
    timer;
    restartTimer;
    abort = new AbortController();
    offset = 0;
    identity = '';
    decoder = new StringDecoder('utf8');
    rest = '';
    state = 'watching';
    deadline = 0;
    nextProbe = 0;
    probing = false;
    lastStatus;
    constructor(options) {
        this.options = options;
    }
    async start() {
        if (!this.options.enabled || this.options.qq <= 0 || this.timer || this.stopped)
            return;
        try {
            const file = await open(this.options.logPath, 'r');
            try {
                const stat = await file.stat();
                this.offset = stat.size; // Never replay historical kicks when enabling/reloading settings.
                this.identity = `${stat.dev}:${stat.ino}`;
            }
            finally {
                await file.close();
            }
        }
        catch { /* A log created after startup is read from its beginning. */ }
        if (this.stopped)
            return;
        this.setStatus('watching', '已启用掉线后重启并提示扫码');
        this.timer = setInterval(() => { void this.poll(); }, 1000);
        this.timer.unref?.();
    }
    stop() {
        this.stopped = true;
        clearInterval(this.timer);
        clearTimeout(this.restartTimer);
        this.abort.abort();
        if (statuses.get(this.options.qq) === this.lastStatus)
            statuses.delete(this.options.qq);
    }
    isRecovering() {
        return !['watching', 'online'].includes(this.state);
    }
    observeOnline() {
        if (this.state === 'waiting-scan' || this.state === 'verifying' || this.state === 'needs-attention' || this.state === 'limited') {
            this.setStatus('online', '已收到 QQ 消息，登录已恢复');
        }
    }
    setStatus(state, message) {
        if (this.stopped)
            return;
        this.state = state;
        this.lastStatus = { state, message };
        statuses.set(this.options.qq, this.lastStatus);
        console.info(`[dsh-qq-bridge] NapCat ${this.options.qq}: ${message}`);
    }
    onLine(line) {
        const signal = napcatLoginSignal(line);
        if (signal === 'qrcode' && this.isRecovering() && this.state !== 'limited') {
            this.setStatus('waiting-scan', '请打开 NapCat WebUI 或 napcat log 查看二维码并扫码登录；等待期间不会再次重启');
        }
        if (signal === 'kicked' && (this.state === 'restarting' || this.state === 'verifying')) {
            this.setStatus('needs-attention', '重启后再次被踢下线，已停止自动重试，请检查 NapCat');
            return;
        }
        if (signal !== 'kicked' || this.isRecovering())
            return;
        const now = Date.now();
        const history = (attempts.get(this.options.qq) ?? []).filter(time => now - time < 3_600_000);
        attempts.set(this.options.qq, history);
        if (history.length >= 3 || (history.length > 0 && now - history[history.length - 1] < 600_000)) {
            this.setStatus('limited', '掉线过于频繁，自动重启已暂停（10 分钟最多一次、每小时最多三次）');
            return;
        }
        this.setStatus('scheduled', '检测到 QQ 登录失效，10 秒后重启，请准备扫码登录');
        this.restartTimer = setTimeout(() => { void this.recover(); }, 10_000);
        this.restartTimer.unref?.();
    }
    async recover() {
        if (this.stopped || this.state !== 'scheduled')
            return;
        const now = Date.now();
        const history = (attempts.get(this.options.qq) ?? []).filter(time => now - time < 3_600_000);
        // Another runtime may have reserved a restart while this timer was pending.
        if (history.length >= 3 || (history.length && now - history[history.length - 1] < 600_000)) {
            this.setStatus('limited', '已达到自动重启频率限制，请检查 NapCat');
            return;
        }
        attempts.set(this.options.qq, [...history, now]);
        this.setStatus('restarting', '正在重启 NapCat，请准备扫码登录');
        try {
            await (this.options.restart ?? restartNapcatForScan)(this.options.qq, this.abort.signal);
            if (this.stopped || this.lastStatus?.state !== 'restarting')
                return;
            this.deadline = Date.now() + 120_000;
            this.nextProbe = Date.now() + 10_000;
            this.setStatus('verifying', 'NapCat 已重启，请打开 NapCat WebUI 或 napcat log 扫码登录');
        }
        catch {
            this.setStatus('needs-attention', 'NapCat 自动重启失败，请检查本机 CLI；已停止自动重试');
        }
    }
    async verify() {
        if (this.stopped || this.state !== 'verifying' || this.probing)
            return;
        if (Date.now() >= this.deadline) {
            this.setStatus('waiting-scan', '等待扫码登录，请打开 NapCat WebUI 或 napcat log；等待期间不会再次重启');
            return;
        }
        if (Date.now() < this.nextProbe)
            return;
        this.nextProbe = Date.now() + 10_000;
        this.probing = true;
        try {
            await this.options.probe();
            if (this.state === 'verifying')
                this.setStatus('online', '登录成功，NapCat 已报告当前账号在线');
        }
        catch { /* Allow QQ startup/OneBot reconnect to finish before the next probe. */ }
        finally {
            this.probing = false;
        }
    }
    async poll() {
        if (this.stopped || this.polling)
            return;
        this.polling = true;
        try {
            const file = await open(this.options.logPath, 'r');
            try {
                const stat = await file.stat();
                const identity = `${stat.dev}:${stat.ino}`;
                if (identity !== this.identity || stat.size < this.offset) {
                    this.offset = 0;
                    this.rest = '';
                    this.decoder = new StringDecoder('utf8');
                }
                this.identity = identity;
                const size = Math.min(256 * 1024, Math.max(0, stat.size - this.offset));
                if (size > 0) {
                    const buffer = Buffer.alloc(size);
                    const { bytesRead } = await file.read(buffer, 0, size, this.offset);
                    this.offset += bytesRead;
                    const lines = (this.rest + this.decoder.write(buffer.subarray(0, bytesRead))).split(/\r?\n/);
                    this.rest = (lines.pop() ?? '').slice(-65536);
                    if (!this.stopped)
                        for (const line of lines)
                            this.onLine(line);
                }
            }
            finally {
                await file.close();
            }
        }
        catch { /* Missing/rotating logs must not crash DSH or trigger a restart. */ }
        finally {
            this.polling = false;
        }
        await this.verify();
    }
}
