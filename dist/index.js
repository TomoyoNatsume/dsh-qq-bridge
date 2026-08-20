/**
 * 对外导出。
 */
export { OnebotClient, WsTransport } from './onebot/client.js';
export { TencentOfficialBotClient, toBridgeMessageEvent } from './official/client.js';
export { MessageRouter } from './router.js';
export { AccessGate } from './security.js';
export { AgentRpcHandler } from './handlers/agent.js';
export { DshAgentExecutor, extractLastAssistantText, hashKey } from './handlers/dsh-executor.js';
export { ShellHandler } from './handlers/shell.js';
export { NapcatSelfLogInput, parseNapcatSelfLogLine } from './inputs/napcat-log.js';
export { DshQqBridgeConfig } from './config.js';
export { buildConnectGuidance } from './plugin.js';
export { agentReplyNotificationsEnabled, buildOfficialConnectGuidance, createAgentReplyNotifier, findSessionTitle, registerAgentReplyNotifier, } from './plugin.js';
// 包入口默认导出即为 Cordis 插件本体:让 Loader `unwrapExports` 能取到 default。
export { default } from './plugin.js';
