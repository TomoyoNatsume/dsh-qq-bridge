import { z } from 'zod';
declare const DshQqBridgeConfig: z.ZodObject<{
    platform: z.ZodDefault<z.ZodEnum<["napcat", "official"]>>;
    napcat: z.ZodDefault<z.ZodObject<{
        wsUrl: z.ZodDefault<z.ZodString>;
        token: z.ZodOptional<z.ZodString>;
        /** 连接失败时提示用户查看的安装向导文档路径(给 Agent 的指引)。 */
        guideDoc: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        wsUrl: string;
        guideDoc: string;
        token?: string | undefined;
    }, {
        wsUrl?: string | undefined;
        token?: string | undefined;
        guideDoc?: string | undefined;
    }>>;
    official: z.ZodDefault<z.ZodObject<{
        /** 腾讯 QQ 机器人开放平台 AppID。 */
        appId: z.ZodDefault<z.ZodString>;
        /** 腾讯 QQ 机器人开放平台 AppSecret。 */
        appSecret: z.ZodDefault<z.ZodString>;
        /** 管理员在该机器人下的 openid;用户需先给机器人发消息才能获得。 */
        adminOpenId: z.ZodDefault<z.ZodString>;
        /** 官方机器人模式下额外允许的用户 openid。 */
        allowlistOpenIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** 是否使用官方沙箱 API。 */
        sandbox: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        appId: string;
        appSecret: string;
        adminOpenId: string;
        allowlistOpenIds: string[];
        sandbox: boolean;
    }, {
        appId?: string | undefined;
        appSecret?: string | undefined;
        adminOpenId?: string | undefined;
        allowlistOpenIds?: string[] | undefined;
        sandbox?: boolean | undefined;
    }>>;
    access: z.ZodDefault<z.ZodObject<{
        adminQq: z.ZodNumber;
        allowlist: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
        commandPrefix: z.ZodDefault<z.ZodString>;
        mode: z.ZodDefault<z.ZodEnum<["whitelist", "open"]>>;
    }, "strip", z.ZodTypeAny, {
        adminQq: number;
        allowlist: number[];
        commandPrefix: string;
        mode: "whitelist" | "open";
    }, {
        adminQq: number;
        allowlist?: number[] | undefined;
        commandPrefix?: string | undefined;
        mode?: "whitelist" | "open" | undefined;
    }>>;
    agent: z.ZodDefault<z.ZodObject<{
        /** DSH Web 的 agent preset;存在 agentPresets 服务时默认挂 standard。 */
        preset: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        /** 驱动 agent 的 provider 路由(须有已注册适配器)。 */
        provider: z.ZodDefault<z.ZodString>;
        /** 驱动 agent 的模型 id(provider 适配器解释)。 */
        model: z.ZodDefault<z.ZodString>;
        /** 是否边生成边回发 text 分段。默认 false:等待本轮完成后只回发最终回复。 */
        streamText: z.ZodDefault<z.ZodBoolean>;
        /** streamText=true 时,是否把思考过程(reasoning)也分段回发。默认 false。 */
        streamReasoning: z.ZodDefault<z.ZodBoolean>;
        /** 单条 QQ 消息最大长度(字符数);超长自动拆分为多条发送。QQ 官方单条约 5000 字,默认留余量。 */
        maxMessageLength: z.ZodDefault<z.ZodNumber>;
        /** 收到有效 QQ 指令后立即回发的确认消息;设为空字符串可关闭。 */
        ackMessage: z.ZodDefault<z.ZodString>;
        /** Agent 本轮最长等待时间(ms),超时后回复 timeoutMessage。 */
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        /** Agent 长时间无响应时回发的消息。 */
        timeoutMessage: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        preset: string;
        provider: string;
        model: string;
        streamText: boolean;
        streamReasoning: boolean;
        maxMessageLength: number;
        ackMessage: string;
        timeoutMs: number;
        timeoutMessage: string;
    }, {
        preset?: string | undefined;
        provider?: string | undefined;
        model?: string | undefined;
        streamText?: boolean | undefined;
        streamReasoning?: boolean | undefined;
        maxMessageLength?: number | undefined;
        ackMessage?: string | undefined;
        timeoutMs?: number | undefined;
        timeoutMessage?: string | undefined;
    }>>;
    shell: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
    }, {
        enabled?: boolean | undefined;
    }>>;
    notifications: z.ZodDefault<z.ZodObject<{
        agentReply: z.ZodDefault<z.ZodObject<{
            /** Agent 完成后是否主动向管理员发送提醒。不设置时 NapCat 默认开,官方机器人默认关。 */
            enabled: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            enabled?: boolean | undefined;
        }, {
            enabled?: boolean | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        agentReply: {
            enabled?: boolean | undefined;
        };
    }, {
        agentReply?: {
            enabled?: boolean | undefined;
        } | undefined;
    }>>;
    selfLogInput: z.ZodDefault<z.ZodObject<{
        /** 实验性:tail NapCat 日志中的 self-sent 消息,用于自己给自己发消息的单号场景。 */
        enabled: z.ZodDefault<z.ZodBoolean>;
        /** NapCat 日志路径;缺省按 ~/Napcat/log/napcat_<adminQq>.log 推导。 */
        logPath: z.ZodOptional<z.ZodString>;
        /** 轮询间隔(ms)。 */
        pollIntervalMs: z.ZodDefault<z.ZodNumber>;
        /** 启动时是否回放已有日志;默认只处理启动后的新行,避免误触发历史消息。 */
        replayOnStart: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        pollIntervalMs: number;
        replayOnStart: boolean;
        logPath?: string | undefined;
    }, {
        enabled?: boolean | undefined;
        logPath?: string | undefined;
        pollIntervalMs?: number | undefined;
        replayOnStart?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    napcat: {
        wsUrl: string;
        guideDoc: string;
        token?: string | undefined;
    };
    official: {
        appId: string;
        appSecret: string;
        adminOpenId: string;
        allowlistOpenIds: string[];
        sandbox: boolean;
    };
    platform: "napcat" | "official";
    access: {
        adminQq: number;
        allowlist: number[];
        commandPrefix: string;
        mode: "whitelist" | "open";
    };
    agent: {
        preset: string;
        provider: string;
        model: string;
        streamText: boolean;
        streamReasoning: boolean;
        maxMessageLength: number;
        ackMessage: string;
        timeoutMs: number;
        timeoutMessage: string;
    };
    shell: {
        enabled: boolean;
    };
    notifications: {
        agentReply: {
            enabled?: boolean | undefined;
        };
    };
    selfLogInput: {
        enabled: boolean;
        pollIntervalMs: number;
        replayOnStart: boolean;
        logPath?: string | undefined;
    };
}, {
    napcat?: {
        wsUrl?: string | undefined;
        token?: string | undefined;
        guideDoc?: string | undefined;
    } | undefined;
    official?: {
        appId?: string | undefined;
        appSecret?: string | undefined;
        adminOpenId?: string | undefined;
        allowlistOpenIds?: string[] | undefined;
        sandbox?: boolean | undefined;
    } | undefined;
    platform?: "napcat" | "official" | undefined;
    access?: {
        adminQq: number;
        allowlist?: number[] | undefined;
        commandPrefix?: string | undefined;
        mode?: "whitelist" | "open" | undefined;
    } | undefined;
    agent?: {
        preset?: string | undefined;
        provider?: string | undefined;
        model?: string | undefined;
        streamText?: boolean | undefined;
        streamReasoning?: boolean | undefined;
        maxMessageLength?: number | undefined;
        ackMessage?: string | undefined;
        timeoutMs?: number | undefined;
        timeoutMessage?: string | undefined;
    } | undefined;
    shell?: {
        enabled?: boolean | undefined;
    } | undefined;
    notifications?: {
        agentReply?: {
            enabled?: boolean | undefined;
        } | undefined;
    } | undefined;
    selfLogInput?: {
        enabled?: boolean | undefined;
        logPath?: string | undefined;
        pollIntervalMs?: number | undefined;
        replayOnStart?: boolean | undefined;
    } | undefined;
}>;
export type DshQqBridgeConfig = z.infer<typeof DshQqBridgeConfig>;
export { DshQqBridgeConfig };
