import { OnebotClient, WsTransport } from './onebot/client.js';
import { randomUUID } from 'node:crypto';
import { MessageRouter } from './router.js';
import { AccessGate } from './security.js';
import { AgentRpcHandler } from './handlers/agent.js';
import { DshAgentExecutor } from './handlers/dsh-executor.js';
import { ShellHandler } from './handlers/shell.js';
import { DshQqBridgeConfig } from './config.js';
import { NapcatSelfLogInput } from './inputs/napcat-log.js';
import { homedir } from 'node:os';
/**
 * Cordis 插件入口(Host 侧)。
 * M3:每个 QQ 会话持有常驻 DSH live agent,实现多轮上下文。
 * 依赖:agentLoop / agentPresets / sessionQuery。
 */
export const name = 'dsh-qq-bridge';
export const inject = ['agentLoop', 'agentPresets', 'sessionQuery'];
export async function apply(ctx, options) {
    const cfg = DshQqBridgeConfig.parse(options);
    const gate = new AccessGate({
        adminQq: cfg.access.adminQq,
        allowlist: cfg.access.allowlist,
        commandPrefix: cfg.access.commandPrefix,
        mode: cfg.access.mode,
    });
    const transport = new WsTransport(cfg.napcat.wsUrl, cfg.napcat.token);
    const client = new OnebotClient(transport);
    const outbound = async (scope, targetId, text) => {
        if (scope === 'private')
            await client.sendPrivate(targetId, text);
        else
            await client.sendGroup(targetId, text);
    };
    const router = new MessageRouter(gate, outbound);
    const executor = makeDshExecutor(ctx, cfg.agent);
    const unregisterAgent = router.register(new AgentRpcHandler(executor, {
        streamText: cfg.agent.streamText,
        streamReasoning: cfg.agent.streamReasoning,
        maxMessageLength: cfg.agent.maxMessageLength,
        ackMessage: cfg.agent.ackMessage,
        timeoutMs: cfg.agent.timeoutMs,
        timeoutMessage: cfg.agent.timeoutMessage,
    }));
    let unregisterShell = () => { };
    if (cfg.shell.enabled) {
        unregisterShell = router.register(new ShellHandler(async (cmd) => ({ stdout: `(shell exec disabled) ${cmd}`, code: 1 })));
    }
    // 连接健康检查失败不应拖垮整个 DSH Host 的插件挂载:先登录警告,
    // 依旧保持插件挂载(WS 端点在时才真正收发),避免瞬时断连导致整棵 tree 回滚。
    const unsubMessages = client.onMessage((evt) => {
        void router.route(evt);
    });
    client.connect().catch((err) => {
        console.warn('[dsh-qq-bridge] ' + buildConnectGuidance(cfg, err));
    });
    let selfLogInput;
    if (cfg.selfLogInput.enabled) {
        const logPath = cfg.selfLogInput.logPath ?? `${homedir()}/Napcat/log/napcat_${cfg.access.adminQq}.log`;
        selfLogInput = new NapcatSelfLogInput({
            logPath,
            selfQq: cfg.access.adminQq,
            commandPrefix: cfg.access.commandPrefix,
            pollIntervalMs: cfg.selfLogInput.pollIntervalMs,
            replayOnStart: cfg.selfLogInput.replayOnStart,
        });
        selfLogInput.start((evt) => void router.route(evt)).catch((err) => {
            console.warn(`[dsh-qq-bridge] self log input failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
    return async () => {
        unregisterAgent();
        unregisterShell();
        unsubMessages();
        selfLogInput?.stop();
        await executor.disposeAll(); // 释放全部常驻 agent
        await client.disconnect();
    };
}
export default { name, inject, apply };
function makeDshExecutor(ctx, agentCfg) {
    const handles = wireDsh(ctx, agentCfg);
    if (handles)
        return new DshAgentExecutor(handles);
    // 无 DSH 服务时占位,便于纯 CLI / 测试
    const fallback = {
        async getOrCreate() {
            return { followup() { }, async whenIdle() { }, async dispose() { } };
        },
        async deliver() { },
        async readSurface() {
            return [];
        },
    };
    return new DshAgentExecutor(fallback);
}
/** 把真实 DSH 服务包装成 executor 所需的句柄。 */
function wireDsh(ctx, agentCfg) {
    const loop = ctx.agentLoop;
    if (!loop)
        return undefined;
    const query = ctx.sessionQuery;
    return {
        async getOrCreate(options) {
            void options.sessionKey;
            if (ctx.agentPresets && agentCfg?.preset) {
                console.info(`[dsh-qq-bridge] mounting agent preset "${agentCfg.preset}" for ${options.sessionId}`);
            }
            else if (agentCfg?.preset) {
                console.warn(`[dsh-qq-bridge] agent preset "${agentCfg.preset}" requested but agentPresets service is unavailable`);
            }
            const handle = await loop.createAgent(ctx, {
                sessionId: options.sessionId,
                // agent 的 model 路由必须显式给出,否则 prompt 组装时 `{{model}}` 无值。
                agentOptions: {
                    ...(agentCfg?.provider ? { provider: agentCfg.provider } : {}),
                    ...(agentCfg?.model ? { model: agentCfg.model } : {}),
                },
                meta: { cwd: workdir(), ...(agentCfg?.preset ? { agentPreset: agentCfg.preset } : {}) },
                ...(ctx.agentPresets && agentCfg?.preset
                    ? { setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, agentCfg.preset) }
                    : {}),
            });
            // 捕获 live session 对象:用于 session/event 过滤(流式分段)。
            const session = handle.agent.session;
            return {
                followup(message) {
                    handle.agent.followup(message);
                },
                async whenIdle() {
                    await handle.agent.whenIdle();
                },
                async readSurface() {
                    // 读 live agent 会话的实时已提交日志(session.events)。
                    // 比走持久化 corpus 的 sessionQuery.readSurface 更及时(避免 whenIdle 后未 flush 的滞后)。
                    const events = handle.agent.session?.events;
                    return events ?? [];
                },
                async dispose() {
                    await handle.dispose();
                },
                _session: session,
            };
        },
        async deliver(agent, prompt, onChunk) {
            // DSH 要求 user message 是「identified」的:必须带 id、role、source.kind。
            // 缺失 id 或 source 用 type 而非 kind,会在 session 校验时抛 「lacks an identified message」。
            const msg = {
                id: randomUUID(),
                role: 'user',
                content: [{ type: 'text', text: prompt }],
                source: { kind: 'user' },
            };
            // 流式分段:订阅该会话的 session/event,按「句子边界 + 最大长度」聚合后回发。
            // 注意:text-delta 是逐 token 到达,若按时间窗批量会在 QQ 刷出单个词;
            // 改为累积到完整句子/段落再回发,兼顾及时性与可读性。
            let unsubscribe;
            const textBuf = [];
            const reasoningBuf = [];
            const sessionId = agent._session?.id;
            const MIN_FLUSH = 8; // 最少多少字符才值得单独发一条
            const MAX_FLUSH = 200; // 无标点时最多攒多少字符强制发
            const sentenceBoundary = /[。！？!?；;\n]$/;
            const flushText = () => {
                if (textBuf.length === 0)
                    return;
                const text = textBuf.splice(0).join('');
                if (text && onChunk)
                    onChunk(text, 'text');
            };
            const flushReasoning = () => {
                if (reasoningBuf.length === 0)
                    return;
                const text = reasoningBuf.splice(0).join('');
                if (text && onChunk)
                    onChunk(text, 'reasoning');
            };
            if (onChunk && ctx.on) {
                unsubscribe = ctx.on('session/event', (subject, evt) => {
                    if (sessionId === undefined || subject?.id !== sessionId)
                        return;
                    const chunk = evt.data?.chunk;
                    if (!chunk)
                        return;
                    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
                        textBuf.push(chunk.text);
                        const joined = textBuf.join('');
                        // 句子边界或超长时回发一条完整段落
                        if ((joined.length >= MIN_FLUSH && sentenceBoundary.test(joined)) || joined.length >= MAX_FLUSH) {
                            flushText();
                        }
                    }
                    else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
                        reasoningBuf.push(chunk.text);
                        const joined = reasoningBuf.join('');
                        if ((joined.length >= MIN_FLUSH && sentenceBoundary.test(joined)) || joined.length >= MAX_FLUSH) {
                            flushReasoning();
                        }
                    }
                });
            }
            agent.followup(msg);
            try {
                await agent.whenIdle();
            }
            catch (err) {
                // 调试图:turn 失败时落盘完整会话日志 + 错误详情。
                try {
                    const fs = await import('node:fs');
                    const dir = '/home/liangyihao/temp/dsh-qq-bridge';
                    fs.writeFileSync(`${dir}/.debug-turn-error.json`, JSON.stringify({
                        error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
                        delivered: msg,
                    }, null, 2));
                    const events = agent.readSurface;
                    if (typeof events === 'function') {
                        const evts = await events();
                        fs.writeFileSync(`${dir}/.debug-turn-log.json`, JSON.stringify(evts, null, 2));
                    }
                }
                catch { /* noop */ }
                flushReasoning();
                flushText(); // 先把已收集的分段发出去,再抛错
                unsubscribe?.();
                throw err;
            }
            flushReasoning();
            flushText(); // 收尾冲刷剩余内容
            unsubscribe?.();
        },
        async readSurface(sessionId) {
            if (!query)
                return [];
            const snap = await query.readSurface(sessionId);
            return snap.events;
        },
    };
}
function workdir() {
    try {
        return process.cwd();
    }
    catch {
        return '.';
    }
}
/** 构建连接失败时的引导文案,指向「给 Agent 的 NapCat 安装向导」。 */
export function buildConnectGuidance(cfg, err) {
    const reason = err instanceof Error ? err.message : String(err);
    return [
        `[dsh-qq-bridge] 无法连接 onebot WS 端点: ${cfg.napcat.wsUrl}`,
        `原因: ${reason}`,
        ``,
        `请按以下步骤让 QQ 接入(NapCat 是一侧部署,插件只负责连接):`,
        `1. 阅读给 Agent 的安装向导:${cfg.napcat.guideDoc ?? 'docs/agent-napcat-guide.md'}`,
        `2. 若尚未安装 NapCat,引导用户在官方 GitHub (NapNeko/NapCatQQ) 下载并扫码登录专属小号。`,
        `3. 启用正向 WebSocket,核对端口与 wsUrl(${cfg.napcat.wsUrl})一致。`,
        `4. 连接成功后,从主号向机器人小号发送「/dsh ping」验证双向通信。`,
    ].join('\n');
}
