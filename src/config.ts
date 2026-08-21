import { z } from 'zod'
import { DEFAULT_QQ_REPLY_STYLE_SKILL_NAME } from './handlers/agent.js'

const DshQqBridgeConfig = z.object({
  platform: z.enum(['napcat', 'official']).default('napcat'),
  napcat: z.object({
    wsUrl: z.string().url().default('ws://127.0.0.1:3001'),
    token: z.string().optional(),
    /** 连接失败时提示用户查看的安装向导文档路径(给 Agent 的指引)。 */
    guideDoc: z.string().optional().default('docs/agent-napcat-guide.md'),
  }).default({}),
  official: z
    .object({
      /** 腾讯 QQ 机器人开放平台 AppID。 */
      appId: z.string().default(''),
      /** 腾讯 QQ 机器人开放平台 AppSecret。 */
      appSecret: z.string().default(''),
      /** 管理员在该机器人下的 openid;用户需先给机器人发消息才能获得。 */
      adminOpenId: z.string().default(''),
      /** 官方机器人模式下额外允许的用户 openid。 */
      allowlistOpenIds: z.array(z.string()).default([]),
      /** 是否使用官方沙箱 API。 */
      sandbox: z.boolean().default(false),
    })
    .default({}),
  access: z
    .object({
      adminQq: z.number(),
      allowlist: z.array(z.number()).default([]),
      commandPrefix: z.string().default(''),
      mode: z.enum(['whitelist', 'open']).default('whitelist'),
    })
    .default({ adminQq: 0 }),
  agent: z
    .object({
      /** DSH Web 的 agent preset;存在 agentPresets 服务时默认挂 QQ bridge 专用 preset。 */
      preset: z.string().optional().default('dsh-qq-bridge'),
      /** 驱动 agent 的 provider 路由(须有已注册适配器)。 */
      provider: z.string().default('deepseek-official'),
      /** 驱动 agent 的模型 id(provider 适配器解释)。 */
      model: z.string().default('deepseek-v4-flash'),
      /** 当 DSH llm 服务不可用时,bridge 侧 /models 的降级候选列表。 */
      models: z.array(z.string()).default([]),
      /** QQ Agent 默认工作目录;为空时使用 DSH web 启动目录。 */
      cwd: z.string().optional(),
      /** 是否边生成边回发 text 分段。默认 false:等待本轮完成后只回发最终回复。 */
      streamText: z.boolean().default(false),
      /** streamText=true 时,是否把思考过程(reasoning)也分段回发。默认 false。 */
      streamReasoning: z.boolean().default(false),
      /** 单条 QQ 消息最大长度(字符数);超长自动拆分为多条发送。QQ 官方单条约 5000 字,默认留余量。 */
      maxMessageLength: z.number().int().positive().default(4500),
      /** 收到有效 QQ 指令后立即回发的确认消息;设为空字符串可关闭。 */
      ackMessage: z.string().default('收到，正在处理...'),
      /** Agent 本轮最长等待时间(ms),超时后回复 timeoutMessage。 */
      timeoutMs: z.number().int().positive().default(120_000),
      /** Agent 长时间无响应时回发的消息。 */
      timeoutMessage: z.string().default('agent 无响应，请稍后重试。'),
      /** 仅 QQ 入站消息使用的回复风格 skill,不会影响其它 DSH 会话。 */
      qqReplyStyleSkill: z
        .object({
          enabled: z.boolean().default(true),
          skillName: z.string().default(DEFAULT_QQ_REPLY_STYLE_SKILL_NAME),
        })
        .default({}),
    })
    .default({}),
  shell: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({}),
  notifications: z
    .object({
      agentReply: z
        .object({
          /** Agent 完成后是否主动向管理员发送提醒。不设置时 NapCat 默认开,官方机器人默认关。 */
          enabled: z.boolean().optional(),
        })
        .default({}),
    })
    .default({}),
  selfLogInput: z
    .object({
      /** 实验性:tail NapCat 日志中的 self-sent 消息,用于自己给自己发消息的单号场景。 */
      enabled: z.boolean().default(false),
      /** NapCat 日志路径;缺省按 ~/Napcat/log/napcat_<adminQq>.log 推导。 */
      logPath: z.string().optional(),
      /** 轮询间隔(ms)。 */
      pollIntervalMs: z.number().int().positive().default(1000),
      /** 启动时是否回放已有日志;默认只处理启动后的新行,避免误触发历史消息。 */
      replayOnStart: z.boolean().default(false),
    })
    .default({}),
})

export type DshQqBridgeConfig = z.infer<typeof DshQqBridgeConfig>
export { DshQqBridgeConfig }
