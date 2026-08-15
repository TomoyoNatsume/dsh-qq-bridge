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
      preset: z.string().optional(),
      /** 驱动 agent 的 provider 路由(须有已注册适配器)。 */
      provider: z.string().default('deepseek-official'),
      /** 驱动 agent 的模型 id(provider 适配器解释)。 */
      model: z.string().default('deepseek-v4-flash'),
    })
    .default({}),
  shell: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({}),
})

export type DshQqBridgeConfig = z.infer<typeof DshQqBridgeConfig>
export { DshQqBridgeConfig }
