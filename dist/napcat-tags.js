import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { defaultOnebotConfigPath, extractRunningNapcatQqs, tryReadOnebotServer } from './cli/napcat.js';
function command(file, args) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: 3000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error)
                reject(error);
            else
                resolve(`${stdout}\n${stderr}`);
        });
    });
}
export async function napcatExecutableExists(searchPath = process.env.PATH ?? '') {
    for (const directory of searchPath.split(delimiter)) {
        const executable = resolve(directory || '.', 'napcat');
        try {
            await access(executable, constants.X_OK);
            if ((await stat(executable)).isFile())
                return true;
        }
        catch (error) {
            const code = error.code;
            if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(code ?? ''))
                throw error;
        }
    }
    return false;
}
export async function inspectNapcatTag(stage, payload) {
    if (stage === 'installed') {
        return { installed: await napcatExecutableExists() };
    }
    if (stage === 'runtime') {
        const output = await command('napcat', ['status']);
        const runningQqs = extractRunningNapcatQqs(output).map(Number);
        return { running: runningQqs.length > 0, runningQqs };
    }
    if (stage === 'login') {
        const qq = Number(payload.qq);
        if (!Number.isSafeInteger(qq) || qq <= 0)
            throw new Error('无效的 NapCat QQ');
        const onebot = await tryReadOnebotServer(defaultOnebotConfigPath(qq));
        const loggedIn = onebot !== null && await probeNapcatLogin(`ws://${onebot.host}:${onebot.port}`, onebot.token, qq);
        return { loggedIn, qq };
    }
    throw new Error('未知的 NapCat 检测阶段');
}
export function probeNapcatLogin(wsUrl, token, qq) {
    return new Promise((resolve) => {
        const uid = randomUUID();
        let ws;
        let finished = false;
        let checkingStatus = false;
        const finish = (ok) => {
            if (finished)
                return;
            finished = true;
            clearTimeout(timer);
            ws?.terminate();
            resolve(ok);
        };
        const timer = setTimeout(() => finish(false), 5000);
        try {
            ws = new WebSocket(wsUrl, {
                headers: token.trim() ? { Authorization: `Bearer ${token.trim()}` } : undefined,
            });
            ws.once('open', () => ws?.send(JSON.stringify({
                action: 'get_login_info', params: {}, echo: `account_${uid}`,
            })));
            ws.on('message', (raw) => {
                try {
                    const response = JSON.parse(raw.toString());
                    if (response.echo !== (checkingStatus ? `status_${uid}` : `account_${uid}`))
                        return;
                    if (response.status !== 'ok' || response.retcode !== 0)
                        return finish(false);
                    if (!checkingStatus) {
                        if (Number(response.data?.user_id) !== qq)
                            return finish(false);
                        checkingStatus = true;
                        ws?.send(JSON.stringify({ action: 'get_status', params: {}, echo: `status_${uid}` }));
                    }
                    else {
                        finish(response.data?.online === true);
                    }
                }
                catch { /* Ignore unrelated or malformed OneBot events. */ }
            });
            ws.once('error', () => finish(false));
            ws.once('close', () => finish(false));
            ws.once('unexpected-response', () => finish(false));
        }
        catch {
            finish(false);
        }
    });
}
