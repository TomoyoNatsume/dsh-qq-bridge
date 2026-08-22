import { homedir } from 'node:os';
import { OnebotClient, WsTransport } from '../onebot/client.js';
import { MessageRouter } from '../router.js';
import { AccessGate } from '../security.js';
import { AgentRpcHandler } from '../handlers/agent.js';
import { DshAgentExecutor } from '../handlers/dsh-executor.js';
import { ShellHandler } from '../handlers/shell.js';
import { DshQqBridgeConfig } from '../config.js';
import { buildConnectGuidance } from '../plugin.js';
import { NapcatSelfLogInput } from '../inputs/napcat-log.js';
function envInt(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}
export function runEcho() {
    const cfg = DshQqBridgeConfig.parse({
        napcat: {
            wsUrl: process.env.DSH_QQ_WS_URL ?? 'ws://127.0.0.1:3001',
            token: process.env.DSH_QQ_TOKEN ?? undefined,
        },
        access: {
            adminQq: envInt('DSH_QQ_ADMIN', 0),
            allowlist: [],
            commandPrefix: process.env.DSH_QQ_PREFIX ?? '',
            mode: 'whitelist',
        },
        selfLogInput: {
            enabled: process.env.DSH_QQ_SELF_LOG === '1' || process.env.DSH_QQ_SELF_LOG === 'true',
            logPath: process.env.DSH_QQ_SELF_LOG_PATH ?? undefined,
            pollIntervalMs: envInt('DSH_QQ_SELF_LOG_INTERVAL_MS', 1000),
            replayOnStart: process.env.DSH_QQ_SELF_LOG_REPLAY === '1' || process.env.DSH_QQ_SELF_LOG_REPLAY === 'true',
        },
    });
    const gate = new AccessGate({
        adminQq: cfg.access.adminQq,
        allowlist: cfg.access.allowlist,
        commandPrefix: cfg.access.commandPrefix,
        mode: cfg.access.mode,
    });
    const transport = new WsTransport(cfg.napcat.wsUrl, cfg.napcat.token);
    const client = new OnebotClient(transport);
    const router = new MessageRouter(gate, async (scope, targetId, text) => {
        if (scope === 'private')
            await client.sendPrivate(targetId, text);
        else
            await client.sendGroup(targetId, text);
    });
    let lastPrompt = '';
    const fallback = {
        async getOrCreate() {
            return { followup() { }, async whenIdle() { }, async dispose() { } };
        },
        async deliver(_agent, prompt) {
            lastPrompt = prompt;
        },
        async readSurface() {
            return [
                { type: 'assistant/message', content: [{ type: 'text', text: `echo: ${lastPrompt}` }] },
            ];
        },
    };
    const executor = new DshAgentExecutor(fallback);
    router.register(new AgentRpcHandler(executor));
    router.register(new ShellHandler(async (cmd) => ({ stdout: `(shell dev stub) ${cmd}`, code: 0 })));
    client
        .connect()
        .then(() => {
        console.log(`[dsh-qq-bridge] 已连接 ${cfg.napcat.wsUrl},prefix=${cfg.access.commandPrefix},admin=${cfg.access.adminQq}`);
        console.log(`  发送「${formatCommandExample(cfg.access.commandPrefix, 'hello')}」到 QQ 即可看到回显。`);
    })
        .catch((err) => {
        console.error(buildConnectGuidance(cfg, err));
        process.exitCode = 1;
        return;
    });
    client.onMessage((evt) => void router.route(evt));
    let selfLogInput;
    if (cfg.selfLogInput.enabled) {
        const logPath = cfg.selfLogInput.logPath?.trim() || `${homedir()}/Napcat/log/napcat_${cfg.access.adminQq}.log`;
        selfLogInput = new NapcatSelfLogInput({
            logPath,
            selfQq: cfg.access.adminQq,
            commandPrefix: cfg.access.commandPrefix,
            pollIntervalMs: cfg.selfLogInput.pollIntervalMs,
            replayOnStart: cfg.selfLogInput.replayOnStart,
        });
        void selfLogInput.start((evt) => void router.route(evt)).then(() => {
            console.log(`[dsh-qq-bridge] self log input enabled: ${logPath}`);
        });
    }
    const shutdown = () => {
        console.log('\n[dsh-qq-bridge] 关闭中...');
        selfLogInput?.stop();
        void executor.disposeAll().finally(() => client.disconnect());
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
function formatCommandExample(commandPrefix, payload) {
    const prefix = commandPrefix.trim();
    return prefix ? `${prefix} ${payload}` : payload;
}
