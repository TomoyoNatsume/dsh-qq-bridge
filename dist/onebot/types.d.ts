/**
 * OneBot v11 协议常用类型(仅定义我们用到的子集)。
 */
/** onebot 推送上来的消息事件(私聊/群聊的公共形状) */
export type OnebotMessageType = 'private' | 'group';
/** 当前桥接层使用的会话/用户目标标识。NapCat 是 QQ 号,官方机器人是 openid。 */
export type MessageTargetId = number | string;
/** 平台原生回复目标。官方机器人用它把回复关联到当前入站消息。 */
export interface PlatformReplyTarget {
    platform: 'official';
    scope: 'c2c' | 'group';
    targetId: string;
    msgId?: string;
}
export interface OnebotMessageEvent {
    /** 事件类型,如 'message' */
    post_type: string;
    /** 'private' | 'group' */
    message_type: OnebotMessageType;
    /** 发送者标识:NapCat 为 QQ 号,官方机器人为 openid。 */
    user_id: MessageTargetId;
    /** 群聊才有 */
    group_id?: MessageTargetId;
    /** 解析后的消息内容(简化为纯文本,后续可扩展富文本段) */
    raw_message: string;
    /** 消息 id(可用于防重复处理) */
    message_id: MessageTargetId;
    /** 私聊时 sub_type: 'friend' | 'group' | 'other' */
    sub_type?: string;
    /** 平台原生回复目标;NapCat 模式为空。 */
    reply_target?: PlatformReplyTarget;
}
/** 发送动作的响应 */
export interface OnebotActionResponse<T = unknown> {
    status: 'ok' | 'failed';
    retcode: number;
    data: T;
}
/** WS 收到的通用包裹(事件 or 后端动作响应) */
export type IncomingFrame = {
    echo?: string;
} | {
    post_type: string;
};
