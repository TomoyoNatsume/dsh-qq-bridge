import { HandlerContext, OutboundSender, PendingReplyHandler } from './router.js'
import { MessageTargetId } from './onebot/types.js'

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface ApprovalRequestLike {
  agent: unknown
  toolName: string
  callId?: string
  reason?: string
  signal?: AbortSignal
}

export interface AskUserQuestionOptionLike {
  label: string
  description?: string
}

export interface AskUserQuestionItemLike {
  id: string
  question: string
  detail?: string
  header?: string
  options?: AskUserQuestionOptionLike[]
  multiSelect?: boolean
}

export interface AskUserQuestionRequestLike {
  questions: AskUserQuestionItemLike[]
  agent?: unknown
  signal?: AbortSignal
}

export interface AskUserQuestionAnswerLike {
  answers: Array<{
    id: string
    selected: string[]
    custom?: string
  }>
}

export interface UserQuestionsLike {
  ask(request: AskUserQuestionRequestLike): Promise<AskUserQuestionAnswerLike>
}

export interface InteractionCtxLike {
  // Cordis event argument tuples are keyed by event name; this plugin only needs
  // to install an approval answerer and leave every other event untouched.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on?(
    event: string,
    cb: (...args: any[]) => unknown,
    options?: { prepend?: boolean },
  ): () => void
  inject?(
    services: readonly string[],
    cb: (ctx: InteractionCtxLike) => void,
    label?: string,
  ): { dispose(): void } | void
  effect?(cb: () => void | (() => void), label?: string): unknown
  userQuestions?: UserQuestionsLike
}

interface QqTarget {
  scope: 'private' | 'group'
  targetId: MessageTargetId
}

export interface PendingChoice {
  index: number
  questionId: string
  label: string
}

type PendingInteraction =
  | {
      kind: 'approval'
      choices: PendingChoice[]
      resolve(outcome: ApprovalOutcome): void
      reject(error: unknown): void
      onAbort?: () => void
      signal?: AbortSignal
    }
  | {
      kind: 'ask-user'
      questions: AskUserQuestionItemLike[]
      choices: PendingChoice[]
      resolve(answer: AskUserQuestionAnswerLike): void
      reject(error: unknown): void
      onAbort?: () => void
      signal?: AbortSignal
    }

/** Routes DSH human-interaction requests through the QQ command channel. */
export class QqInteractionBridge implements PendingReplyHandler {
  private readonly agentTargets = new WeakMap<object, QqTarget>()
  private readonly pendingByTarget = new Map<string, PendingInteraction>()

  constructor(
    private readonly outbound: OutboundSender,
    private readonly commandPrefix = '',
  ) {}

  bindAgent(sessionKey: string, agent: unknown): void {
    if (typeof agent !== 'object' || agent === null) return
    const target = targetFromSessionKey(sessionKey)
    if (target) this.agentTargets.set(agent, target)
  }

  register(ctx: InteractionCtxLike): () => void {
    const disposers: Array<() => void> = []
    if (ctx.on) {
      disposers.push(ctx.on('approval/request', (request, next) => {
        if (!this.targetForAgent(request.agent)) return next()
        return this.askApproval(request)
      }, { prepend: true }))
    }

    if (ctx.inject) {
      const fiber = ctx.inject(['userQuestions'], (childCtx) => {
        this.registerUserQuestions(childCtx, disposers)
      }, 'dsh-qq-bridge.userQuestions')
      if (fiber && typeof fiber === 'object' && typeof fiber.dispose === 'function') {
        disposers.push(() => fiber.dispose())
      }
    } else {
      this.registerUserQuestions(ctx, disposers)
    }

    return () => {
      for (const dispose of disposers.splice(0)) dispose()
      for (const [key, pending] of this.pendingByTarget) {
        this.pendingByTarget.delete(key)
        pending.reject(new Error('QQ interaction bridge disposed'))
      }
    }
  }

  private registerUserQuestions(ctx: InteractionCtxLike, disposers: Array<() => void>): void {
    const userQuestions = ctx.userQuestions
    if (userQuestions) {
      const originalAsk = userQuestions.ask.bind(userQuestions)
      const wrappedAsk = (request: AskUserQuestionRequestLike) => {
        if (request.agent !== undefined && this.targetForAgent(request.agent)) {
          return this.askUser(request)
        }
        return originalAsk(request)
      }
      userQuestions.ask = wrappedAsk
      disposers.push(() => {
        if (userQuestions.ask === wrappedAsk) userQuestions.ask = originalAsk
      })
    }
  }

  async handle(ctx: HandlerContext): Promise<boolean> {
    const targetId = ctx.scope === 'private' ? ctx.userId : ctx.groupId
    if (targetId === undefined) return false
    const key = targetKey({ scope: ctx.scope, targetId })
    const pending = this.pendingByTarget.get(key)
    if (!pending) return false

    this.pendingByTarget.delete(key)
    cleanupPending(pending)
    if (pending.kind === 'approval') {
      pending.resolve(resolveApproval(ctx.payload))
      await ctx.respond('已收到确认，Agent 会继续处理。')
      return true
    }

    pending.resolve(resolveAskUser(ctx.payload, pending.questions, pending.choices))
    await ctx.respond('已收到回复，Agent 会继续处理。')
    return true
  }

  private async askApproval(request: ApprovalRequestLike): Promise<ApprovalOutcome> {
    const target = this.targetForAgent(request.agent)
    if (!target) return 'unavailable'
    const choices: PendingChoice[] = [
      { index: 1, questionId: 'approval', label: '允许一次' },
      { index: 2, questionId: 'approval', label: '拒绝' },
    ]
    const answer = this.wait(target, {
      kind: 'approval',
      choices,
      signal: request.signal,
    })
    await this.sendPrompt(target, formatApprovalRequest(request, choices, this.commandPrefix))
    return await answer
  }

  private async askUser(request: AskUserQuestionRequestLike): Promise<AskUserQuestionAnswerLike> {
    const target = this.targetForAgent(request.agent)
    if (!target) throw new Error('QQ interaction bridge has no target for this agent')
    const choices = enumerateChoices(request.questions)
    const answer = this.wait(target, {
      kind: 'ask-user',
      questions: request.questions,
      choices,
      signal: request.signal,
    })
    await this.sendPrompt(target, formatAskUserRequest(request.questions, choices, this.commandPrefix))
    return await answer
  }

  private async sendPrompt(target: QqTarget, text: string): Promise<void> {
    try {
      await this.outbound(target.scope, target.targetId, text)
    } catch (err) {
      const key = targetKey(target)
      const pending = this.pendingByTarget.get(key)
      if (pending) {
        this.pendingByTarget.delete(key)
        cleanupPending(pending)
        pending.reject(err)
      }
      throw err
    }
  }

  private wait(target: QqTarget, spec: Omit<PendingInteraction, 'resolve' | 'reject'>): Promise<never>
  private wait(target: QqTarget, spec: Omit<Extract<PendingInteraction, { kind: 'approval' }>, 'resolve' | 'reject'>): Promise<ApprovalOutcome>
  private wait(target: QqTarget, spec: Omit<Extract<PendingInteraction, { kind: 'ask-user' }>, 'resolve' | 'reject'>): Promise<AskUserQuestionAnswerLike>
  private wait(
    target: QqTarget,
    spec: Omit<PendingInteraction, 'resolve' | 'reject'>,
  ): Promise<ApprovalOutcome | AskUserQuestionAnswerLike> {
    const key = targetKey(target)
    const existing = this.pendingByTarget.get(key)
    if (existing) {
      cleanupPending(existing)
      existing.reject(new Error('a newer QQ interaction request replaced this pending request'))
    }
    return new Promise((resolve, reject) => {
      const pending = { ...spec, resolve, reject } as PendingInteraction
      const onAbort = () => {
        this.pendingByTarget.delete(key)
        cleanupPending(pending)
        if (pending.kind === 'approval') pending.resolve('cancelled')
        else pending.reject(new Error('ask_user_question was aborted before the user answered'))
      }
      pending.onAbort = onAbort
      pending.signal?.addEventListener('abort', onAbort, { once: true })
      this.pendingByTarget.set(key, pending)
    })
  }

  private targetForAgent(agent: unknown): QqTarget | undefined {
    if (typeof agent !== 'object' || agent === null) return undefined
    return this.agentTargets.get(agent)
  }
}

export function formatApprovalRequest(
  request: ApprovalRequestLike,
  choices: readonly PendingChoice[],
  commandPrefix = '',
): string {
  return [
    'Agent 需要确认:',
    `工具: ${request.toolName}`,
    ...request.reason ? [`原因: ${request.reason}`] : [],
    '',
    ...choices.map((choice) => `${choice.index}. ${choice.label}`),
    '',
    `请回复“指令前缀 + 编号”，例如 ${formatCommandExample(commandPrefix, '1')} 或 ${formatCommandExample(commandPrefix, '2')}。`,
  ].join('\n')
}

export function formatAskUserRequest(
  questions: readonly AskUserQuestionItemLike[],
  choices: readonly PendingChoice[],
  commandPrefix = '',
): string {
  const lines = ['Agent 需要你的回复:']
  for (const question of questions) {
    lines.push('', question.header ? `${question.header}: ${question.question}` : question.question)
    if (question.detail) lines.push(question.detail)
    const ownChoices = choices.filter((choice) => choice.questionId === question.id)
    for (const choice of ownChoices) {
      const option = question.options?.find((candidate) => candidate.label === choice.label)
      lines.push(`${choice.index}. ${choice.label}${option?.description ? ` - ${option.description}` : ''}`)
    }
  }
  lines.push('', `请回复“指令前缀 + 编号”，例如 ${formatCommandExample(commandPrefix, '1')}；也可以直接回复自定义内容。`)
  return lines.join('\n')
}

export function resolveAskUser(
  payload: string,
  questions: readonly AskUserQuestionItemLike[],
  choices: readonly PendingChoice[],
): AskUserQuestionAnswerLike {
  const selectedNumbers = parseSelectedNumbers(payload)
  if (selectedNumbers.length === 0) {
    const [first, ...rest] = questions
    return {
      answers: [
        ...(first ? [{ id: first.id, selected: [], custom: payload }] : []),
        ...rest.map((question) => ({ id: question.id, selected: [] })),
      ],
    }
  }

  return {
    answers: questions.map((question) => ({
      id: question.id,
      selected: choices
        .filter((choice) => choice.questionId === question.id && selectedNumbers.includes(choice.index))
        .map((choice) => choice.label),
    })),
  }
}

export function resolveApproval(payload: string): ApprovalOutcome {
  const [selected] = parseSelectedNumbers(payload)
  if (selected === 1) return 'allowed-once'
  return 'rejected'
}

function enumerateChoices(questions: readonly AskUserQuestionItemLike[]): PendingChoice[] {
  const choices: PendingChoice[] = []
  for (const question of questions) {
    for (const option of question.options ?? []) {
      choices.push({ index: choices.length + 1, questionId: question.id, label: option.label })
    }
  }
  return choices
}

function parseSelectedNumbers(payload: string): number[] {
  const trimmed = payload.trim()
  if (!/^\d+(?:[\s,，、]+\d+)*$/.test(trimmed)) return []
  return trimmed
    .split(/[\s,，、]+/)
    .map((part) => Number(part))
    .filter((value) => Number.isInteger(value) && value > 0)
}

function targetFromSessionKey(sessionKey: string): QqTarget | undefined {
  const sep = sessionKey.indexOf(':')
  if (sep <= 0) return undefined
  const scope = sessionKey.slice(0, sep)
  const id = sessionKey.slice(sep + 1)
  if ((scope !== 'private' && scope !== 'group') || !id) return undefined
  return { scope, targetId: numericId(id) }
}

function numericId(id: string): MessageTargetId {
  return /^\d+$/.test(id) ? Number(id) : id
}

function targetKey(target: QqTarget): string {
  return `${target.scope}:${target.targetId}`
}

function cleanupPending(pending: PendingInteraction): void {
  if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort)
}

function formatCommandExample(commandPrefix: string, payload: string): string {
  const prefix = commandPrefix.trim()
  return prefix ? `${prefix} ${payload}` : payload
}
