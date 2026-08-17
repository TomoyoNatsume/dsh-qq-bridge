import { z } from 'zod'

const DshQqBridgeConfig = z.object({
  napcat: z.object({
    wsUrl: z.string().url(),
    token: z.string().optional(),
    /** 连接失败时提示用户查看的安装向导文档路径(给 Agent 的指引)。 */
    guideDoc: z.string().optional().default('docs/agent-napcat-guide.md'),
  }),
  access: z
    .object({
      adminQq: z.number(),
      allowlist: z.array(z.number()).default([]),
      commandPrefix: z.string().default('/dsh'),
      mode: z.enum(['whitelist', 'open']).default('whitelist'),
    })
    .default({ adminQq: 0 }),
  agent: z
    .object({
      /** DSH Web 的 agent preset;存在 agentPresets 服务时默认挂 standard。 */
      preset: z.string().optional().default('standard'),
      /** 驱动 agent 的 provider 路由(须有已注册适配器)。 */
      provider: z.string().default('deepseek-official'),
      /** 驱动 agent 的模型 id(provider 适配器解释)。 */
      model: z.string().default('deepseek-v4-flash'),
      /** 是否边生成边回发 text 分段。默认 false:等待本轮完成后只回发最终回复。 */
      streamText: z.boolean().default(false),
      /** streamText=true 时,是否把思考过程(reasoning)也分段回发。默认 false。 */
      streamReasoning: z.boolean().default(false),
      /** 单条 QQ 消息最大长度(字符数);超长自动拆分为多条发送。QQ 官方单条约 5000 字,默认留余量。 */
      maxMessageLength: z.number().int().positive().default(4500),
    })
    .default({}),
  shell: z
    .object({
      enabled: z.boolean().default(false),
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
