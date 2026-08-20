import { randomBytes } from 'node:crypto';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
const ERROR_ONLY_LOGGER = {
    info() { },
    warn() { },
    debug() { },
    error(msg) {
        console.error(msg);
    },
};
export function createOfficialPairCode() {
    return randomBytes(3).toString('hex').toUpperCase();
}
export async function pairOfficialAdmin(options, bot) {
    const client = bot ?? new QQBot({
        appId: options.appId,
        appSecret: options.appSecret,
        ...(options.sandbox ? { baseUrl: 'https://sandbox.api.sgroup.qq.com' } : {}),
        logger: ERROR_ONLY_LOGGER,
    });
    const timeoutMs = options.timeoutMs ?? 120_000;
    const successMessage = options.successMessage ?? '配对成功';
    const abort = new AbortController();
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            settle(() => reject(new Error(`等待配对消息超时，请确认已给机器人发送: ${options.pairCommand}`)));
        }, timeoutMs);
        const settle = (finish) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            abort.abort();
            try {
                client.stop();
            }
            catch {
                // stop best effort:setup 即将退出临时配对监听。
            }
            finish();
        };
        client
            .on('ready', () => {
            options.onReady?.();
        })
            .on('resumed', () => {
            options.onReady?.();
        })
            .on('error', (err) => {
            settle(() => reject(err));
        })
            .on('message', (_ctx, msg) => {
            if (normalizePairingText(msg.content) !== normalizePairingText(options.pairCommand))
                return;
            void replyAndResolvePairing(client, msg, successMessage, (finish) => settle(finish), resolve);
        });
        client.start(abort.signal).catch((err) => {
            settle(() => reject(err instanceof Error ? err : new Error(String(err))));
        });
    });
}
async function replyAndResolvePairing(client, msg, successMessage, settle, resolve) {
    try {
        await client.sendText(msg.replyTarget, successMessage);
    }
    catch (err) {
        console.warn(`配对成功，但回复 QQ 配对确认失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    settle(() => resolve(msg.senderId));
}
function normalizePairingText(text) {
    return text.trim().replace(/\s+/g, ' ');
}
