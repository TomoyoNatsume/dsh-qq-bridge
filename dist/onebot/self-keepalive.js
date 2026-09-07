// Only filters legacy internal messages; this module never sends or schedules probes.
export const NAPCAT_SELF_KEEPALIVE_MESSAGE = '[dsh-qq-bridge] keepalive';
export function isNapcatSelfKeepAliveMessage(message, configuredMessage = NAPCAT_SELF_KEEPALIVE_MESSAGE) {
    const value = message.trim();
    const prefix = configuredMessage.trim();
    return value === prefix || value.startsWith(`${prefix} uid=`);
}
