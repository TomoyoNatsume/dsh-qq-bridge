import { WebSocket } from 'ws';
function normalizeToken(token) {
    const trimmed = token?.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null')
        return undefined;
    return trimmed;
}
/**
 * 基于 `ws` 库的默认传输实现(连接 NapCat 的 onebot 正向 WS)。
 * 内置断线自动重连:`connect()` 在首次连上时 resolve;首次失败则 reject(供上层打引导),
 * 此后后台仍按退避自动重连。已在运行的连接意外断开也会自动重连,无需上层干预。
 */
export class WsTransport {
    url;
    ws = null;
    listeners = new Set();
    disposed = false;
    retryTimer = null;
    attempts = 0;
    /** 首个连接尝试是否已经给出最终结论(open resolve / error reject)。 */
    initialSettled = false;
    settleInitial = null;
    authToken;
    constructor(url, token) {
        this.url = url;
        this.authToken = normalizeToken(token);
    }
    get connected() {
        return this.ws?.readyState === 1; // OPEN
    }
    connect() {
        if (this.connected)
            return Promise.resolve();
        this.disposed = false;
        return new Promise((resolve, reject) => {
            this.settleInitial = (ok) => (ok ? resolve() : reject(new Error(`onebot ws connect failed: ${this.url}`)));
            this.openSocket(true);
        });
    }
    openSocket(firstAttempt) {
        if (this.disposed)
            return;
        let ws;
        try {
            ws = new WebSocket(this.url, {
                headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : undefined,
            });
        }
        catch {
            this.handleError();
            return;
        }
        this.ws = ws;
        ws.on('open', () => {
            if (this.disposed) {
                try {
                    ws.close();
                }
                catch { /* noop */ }
                return;
            }
            this.attempts = 0; // 成功即重置退避
            console.info(`[dsh-qq-bridge] onebot ws connected: ${this.url}`);
            if (firstAttempt)
                this.resolveInitial(true);
        });
        ws.on('message', (data) => {
            try {
                const frame = JSON.parse(String(data));
                for (const cb of this.listeners)
                    cb(frame);
            }
            catch {
                // 忽略非 JSON 帧
            }
        });
        ws.on('error', () => this.handleError());
        ws.on('close', () => {
            this.handleClose();
        });
    }
    resolveInitial(ok) {
        if (this.initialSettled)
            return;
        this.initialSettled = true;
        const fn = this.settleInitial;
        this.settleInitial = null;
        fn?.(ok);
    }
    handleError() {
        if (this.initialSettled === false)
            this.resolveInitial(false); // 首次连接失败 -> reject
        this.scheduleRetry();
    }
    handleClose() {
        this.ws = null;
        if (this.disposed)
            return;
        this.scheduleRetry();
    }
    scheduleRetry() {
        if (this.disposed || this.retryTimer)
            return;
        this.attempts += 1;
        const delay = Math.min(500 * 2 ** this.attempts, 15000);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.openSocket(false);
        }, delay);
    }
    send(frame) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.ws)
                return reject(new Error('ws not connected'));
            this.ws.send(JSON.stringify(frame), (err) => (err ? reject(err) : resolve()));
        });
    }
    onFrame(cb) {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }
    dispose() {
        return new Promise((resolve) => {
            this.disposed = true;
            this.initialSettled = false;
            if (this.retryTimer) {
                clearTimeout(this.retryTimer);
                this.retryTimer = null;
            }
            this.ws?.close();
            this.ws = null;
            this.listeners.clear();
            this.settleInitial = null;
            this.attempts = 0;
            resolve();
        });
    }
}
/**
 * OneBot 客户端:负责收发消息事件、发送动作。
 * 运输层可注入,便于本地回环测试。
 */
export class OnebotClient {
    transport;
    sendAction;
    unsub = null;
    pendingActions = new Map();
    constructor(transport, 
    /** 动作回调路径;默认按协议拼 JSON。可用 in-memory 替换以测试回发。 */
    sendAction) {
        this.transport = transport;
        this.sendAction = sendAction;
    }
    async connect() {
        await this.transport.connect();
        this.unsub = this.transport.onFrame((frame) => this.handleFrame(frame));
    }
    onMessage(cb) {
        return this.transport.onFrame((frame) => {
            if (frame.post_type === 'message')
                cb(frame);
        });
    }
    handleFrame(frame) {
        if (typeof frame.echo !== 'string')
            return;
        const pending = this.pendingActions.get(frame.echo);
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pendingActions.delete(frame.echo);
        pending.resolve(frame);
    }
    /** 发送私聊并等待相同 echo 的 OneBot 动作响应，供保活健康探测使用。 */
    async sendPrivateAndWait(userId, message, timeoutMs, uid) {
        const echo = `keepalive_${uid}`;
        const response = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingActions.delete(echo);
                reject(new OnebotActionTimeoutError(echo, timeoutMs));
            }, timeoutMs);
            timer.unref?.();
            this.pendingActions.set(echo, { resolve, reject, timer });
        });
        try {
            await this.flush({ action: 'send_private_msg', params: { user_id: userId, message }, echo });
        }
        catch (err) {
            const pending = this.pendingActions.get(echo);
            if (pending)
                clearTimeout(pending.timer);
            this.pendingActions.delete(echo);
            throw err;
        }
        const result = await response;
        if (result.status !== 'ok' || result.retcode !== 0) {
            throw new Error(`OneBot send failed: retcode=${result.retcode}`);
        }
        return result;
    }
    async sendPrivate(userId, message, _replyTarget) {
        const frame = { action: 'send_private_msg', params: { user_id: userId, message }, echo: `p_${Date.now()}` };
        await this.flush(frame);
        return { status: 'ok', retcode: 0, data: null };
    }
    async sendGroup(groupId, message, _replyTarget) {
        const frame = { action: 'send_group_msg', params: { group_id: groupId, message }, echo: `g_${Date.now()}` };
        await this.flush(frame);
        return { status: 'ok', retcode: 0, data: null };
    }
    async flush(frame) {
        if (this.sendAction) {
            await this.sendAction(frame);
        }
        else {
            await this.transport.send(frame);
        }
    }
    async disconnect() {
        for (const pending of this.pendingActions.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('onebot client disconnected'));
        }
        this.pendingActions.clear();
        this.unsub?.();
        this.unsub = null;
        await this.transport.dispose();
    }
}
export class OnebotActionTimeoutError extends Error {
    echo;
    timeoutMs;
    name = 'OnebotActionTimeoutError';
    constructor(echo, timeoutMs) {
        super(`OneBot action timeout after ${timeoutMs}ms: ${echo}`);
        this.echo = echo;
        this.timeoutMs = timeoutMs;
    }
}
