import { z } from 'zod'

const DshQqBridgeConfig = z.object({
  napcat: z.object({
    wsUrl: z.string().url(),
    token: z.string().optional(),
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
      model: z.string().optional(),
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
