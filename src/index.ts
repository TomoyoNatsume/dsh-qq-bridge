/**
 * 对外导出。
 */
export { OnebotClient, WsTransport } from './onebot/client.js'
export type { Transport } from './onebot/client.js'
export type { OnebotMessageEvent, OnebotMessageType } from './onebot/types.js'
export { MessageRouter } from './router.js'
export type { Handler, HandlerContext } from './router.js'
export { AccessGate } from './security.js'
export type { AccessOptions } from './security.js'
export { AgentRpcHandler } from './handlers/agent.js'
export type { AgentExecutor } from './handlers/agent.js'
export { DshAgentExecutor, extractLastAssistantText, hashKey } from './handlers/dsh-executor.js'
export type { DshRenderedAgent } from './handlers/dsh-executor.js'
export { ShellHandler } from './handlers/shell.js'
export { DshQqBridgeConfig } from './config.js'
export type * from './config.js'
