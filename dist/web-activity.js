const UNKNOWN_TURN_KEY = '__unknown_turn__';
export class DshWebActivityGate {
    activeTurns = new Map();
    waiters = [];
    tail = Promise.resolve();
    static register(ctx) {
        const gate = new DshWebActivityGate();
        const dispose = ctx.on?.('session/event', (subject, event) => {
            gate.observe(subject, event);
        }) ?? (() => { });
        return { gate, dispose };
    }
    observe(subject, event) {
        const sessionId = trackedWebSessionId(subject);
        if (!sessionId)
            return;
        if (isTurnStart(event)) {
            const turns = this.activeTurns.get(sessionId) ?? new Set();
            turns.add(turnKeyOf(event) ?? UNKNOWN_TURN_KEY);
            this.activeTurns.set(sessionId, turns);
            return;
        }
        if (!isTurnEnd(event))
            return;
        const turns = this.activeTurns.get(sessionId);
        if (!turns)
            return;
        const turnKey = turnKeyOf(event);
        if (turnKey === undefined)
            turns.clear();
        else
            turns.delete(turnKey);
        if (turns.size === 0)
            this.activeTurns.delete(sessionId);
        this.flushIfIdle();
    }
    isBusy() {
        return this.activeTurns.size > 0;
    }
    async enqueueWhenIdle(task) {
        const run = async () => {
            await this.waitForIdle();
            return await task();
        };
        const result = this.tail.then(run, run);
        this.tail = result.then(() => undefined, () => undefined);
        return await result;
    }
    waitForIdle() {
        if (!this.isBusy())
            return Promise.resolve();
        return new Promise((resolve) => {
            this.waiters.push(resolve);
        });
    }
    flushIfIdle() {
        if (this.isBusy())
            return;
        const waiters = this.waiters.splice(0);
        for (const resolve of waiters)
            resolve();
    }
}
export function trackedWebSessionId(subject) {
    const sessionId = typeof subject.id === 'string' ? subject.id : '';
    if (!sessionId || sessionId.startsWith('qq-'))
        return undefined;
    if (subject.header?.origin === 'subagent')
        return undefined;
    return sessionId;
}
function isTurnStart(event) {
    return event?.type === 'turn/start';
}
function isTurnEnd(event) {
    return event?.type === 'turn/end';
}
function turnKeyOf(event) {
    const turn = event.data?.turn;
    return typeof turn === 'number' || typeof turn === 'string' ? turn : undefined;
}
