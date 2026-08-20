/**
 * 对外导出。
 */
export { OnebotClient, WsTransport } from './onebot/client.js';
export type { Transport } from './onebot/client.js';
export type { OnebotMessageEvent, OnebotMessageType } from './onebot/types.js';
export { TencentOfficialBotClient, toBridgeMessageEvent } from './official/client.js';
export type { TencentOfficialBotOptions } from './official/client.js';
export { MessageRouter } from './router.js';
export type { Handler, HandlerContext } from './router.js';
export { AccessGate } from './security.js';
export type { AccessOptions } from './security.js';
export { AgentRpcHandler } from './handlers/agent.js';
export type { AgentExecutor } from './handlers/agent.js';
export { DshAgentExecutor, extractLastAssistantText, hashKey } from './handlers/dsh-executor.js';
export type { DshRenderedAgent } from './handlers/dsh-executor.js';
export { DIR_COMMAND, DirectoryHandler, resolveUserPath } from './handlers/directory.js';
export type { DirectorySwitcher } from './handlers/directory.js';
export { QQ_CONTROL_BLOCK_TAG, QqControlDispatcher, createSetCwdControlHandler, parseQqControlBlocks, } from './handlers/control.js';
export type { ParsedQqControls, QqControlAction, QqControlActionHandler, QqControlContext, } from './handlers/control.js';
export { ShellHandler } from './handlers/shell.js';
export { NapcatSelfLogInput, parseNapcatSelfLogLine } from './inputs/napcat-log.js';
export { DshQqBridgeConfig } from './config.js';
export type * from './config.js';
export { buildConnectGuidance } from './plugin.js';
export { agentReplyNotificationsEnabled, buildOfficialConnectGuidance, createAgentReplyNotifier, findSessionTitle, registerAgentReplyNotifier, } from './plugin.js';
export { default } from './plugin.js';
