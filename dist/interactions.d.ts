import { HandlerContext, OutboundSender, PendingReplyHandler } from './router.js';
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
export interface ApprovalRequestLike {
    agent: unknown;
    toolName: string;
    callId?: string;
    reason?: string;
    signal?: AbortSignal;
}
export interface AskUserQuestionOptionLike {
    label: string;
    description?: string;
}
export interface AskUserQuestionItemLike {
    id: string;
    question: string;
    detail?: string;
    header?: string;
    options?: AskUserQuestionOptionLike[];
    multiSelect?: boolean;
}
export interface AskUserQuestionRequestLike {
    questions: AskUserQuestionItemLike[];
    agent?: unknown;
    signal?: AbortSignal;
}
export interface AskUserQuestionAnswerLike {
    answers: Array<{
        id: string;
        selected: string[];
        custom?: string;
    }>;
}
export interface UserQuestionsLike {
    ask(request: AskUserQuestionRequestLike): Promise<AskUserQuestionAnswerLike>;
}
export interface InteractionCtxLike {
    on?(event: string, cb: (...args: any[]) => unknown, options?: {
        prepend?: boolean;
    }): () => void;
    inject?(services: readonly string[], cb: (ctx: InteractionCtxLike) => void, label?: string): {
        dispose(): void;
    } | void;
    effect?(cb: () => void | (() => void), label?: string): unknown;
    userQuestions?: UserQuestionsLike;
}
export interface PendingChoice {
    index: number;
    questionId: string;
    label: string;
}
/** Routes DSH human-interaction requests through the QQ command channel. */
export declare class QqInteractionBridge implements PendingReplyHandler {
    private readonly outbound;
    private readonly commandPrefix;
    private readonly agentTargets;
    private readonly pendingByTarget;
    constructor(outbound: OutboundSender, commandPrefix?: string);
    bindAgent(sessionKey: string, agent: unknown): void;
    register(ctx: InteractionCtxLike): () => void;
    private registerUserQuestions;
    handle(ctx: HandlerContext): Promise<boolean>;
    private askApproval;
    private askUser;
    private sendPrompt;
    private wait;
    private targetForAgent;
}
export declare function formatApprovalRequest(request: ApprovalRequestLike, choices: readonly PendingChoice[], commandPrefix?: string): string;
export declare function formatAskUserRequest(questions: readonly AskUserQuestionItemLike[], choices: readonly PendingChoice[], commandPrefix?: string): string;
export declare function resolveAskUser(payload: string, questions: readonly AskUserQuestionItemLike[], choices: readonly PendingChoice[]): AskUserQuestionAnswerLike;
export declare function resolveApproval(payload: string): ApprovalOutcome;
