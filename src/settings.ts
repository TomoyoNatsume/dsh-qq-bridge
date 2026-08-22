import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DshQqBridgeConfig } from './config.js'
import { removeInsertItem, writeProfilePatchWithBackup } from './cli/dsh-profile.js'
import { installQqBridgePreset } from './cli/qq-preset.js'
import { inspectNapcatSettings, setupNapcatForSettings } from './napcat-status.js'

export const QQ_BRIDGE_SETTINGS_NAMESPACE = 'dsh-qq-bridge'
export const QQ_BRIDGE_NAPCAT_RPC_CHANNEL = '/dsh-qq-bridge-napcat'

interface SettingsScope<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
}

interface SettingsProvider {
  register<T>(
    ns: string,
    schema: unknown,
    options?: { base?: Partial<T>; applies?: 'live' | 'restart' },
  ): SettingsScope<T>
}

interface RpcConnection {
  rpc?: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown) => unknown | Promise<unknown>,
      options?: { authority?: 'loopback' | 'trusted-host' },
    ): { dispose(): void } | (() => void) | void
  }
}

export interface QqBridgeSettingsCtx {
  inject?(
    services: readonly string[],
    cb: (ctx: QqBridgeSettingsCtx & { settings?: SettingsProvider }) => void,
    label?: string,
  ): { dispose(): void } | void
  settings?: SettingsProvider
  connection?: RpcConnection
  effect?(cb: () => void | (() => void), label?: string): void
}

export interface InstalledQqBridgeSettings {
  current(): DshQqBridgeConfig
  dispose(): void
}

type SchemasteryFactory = {
  object(shape: Record<string, unknown>): unknown
  string(): SchemaBuilder
  number(): SchemaBuilder
  boolean(): SchemaBuilder
  array(inner: unknown): SchemaBuilder
  union(values: readonly unknown[]): SchemaBuilder
}

type SchemaBuilder = {
  default(value: unknown): SchemaBuilder
  role?(name: string): SchemaBuilder
  min?(value: number): SchemaBuilder
  max?(value: number): SchemaBuilder
  step?(value: number): SchemaBuilder
}

export async function installQqBridgeSettings(
  ctx: QqBridgeSettingsCtx,
  entry: DshQqBridgeConfig,
  onChange?: (next: DshQqBridgeConfig) => void | Promise<void>,
): Promise<InstalledQqBridgeSettings | undefined> {
  await cleanupLegacyProfileInsert(resolveDshHome()).catch((err) => {
    console.warn(`[dsh-qq-bridge] failed to clean legacy profile insert: ${err instanceof Error ? err.message : String(err)}`)
  })
  const schema = await buildQqBridgeSettingsSchema()
  if (schema === undefined || ctx.inject === undefined) return undefined

  let current = entry
  const disposers: Array<() => void> = []
  const rpcFiber = ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection
    if (connection === undefined) return
    const disposable = registerNapcatStatusRpc(connection)
    if (disposable !== undefined) connectionCtx.effect?.(() => disposable, 'dsh-qq-bridge.napcat-rpc')
  }, 'dsh-qq-bridge.napcat-rpc')
  if (rpcFiber && typeof rpcFiber === 'object' && typeof rpcFiber.dispose === 'function') {
    disposers.push(() => rpcFiber.dispose())
  }
  const fiber = ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    if (settings === undefined) return
    const scope = settings.register<DshQqBridgeConfig>(QQ_BRIDGE_SETTINGS_NAMESPACE, schema, {
      base: entry,
      applies: 'restart',
    })
    current = DshQqBridgeConfig.parse(scope.get())
    const unwatch = scope.watch((next) => {
      current = DshQqBridgeConfig.parse(next)
      Promise.resolve(onChange?.(current)).catch((err) => {
        console.warn(`[dsh-qq-bridge] failed to apply settings update: ${err instanceof Error ? err.message : String(err)}`)
      })
      installBundledPreset().catch((err) => {
        console.warn(`[dsh-qq-bridge] failed to refresh QQ agent preset: ${err instanceof Error ? err.message : String(err)}`)
      })
    })
    settingsCtx.effect?.(() => unwatch, 'dsh-qq-bridge.settings.watch')
    installBundledPreset().catch((err) => {
      console.warn(`[dsh-qq-bridge] failed to refresh QQ agent preset: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, 'dsh-qq-bridge.settings')
  if (fiber && typeof fiber === 'object' && typeof fiber.dispose === 'function') {
    disposers.push(() => fiber.dispose())
  }

  return {
    current() {
      return current
    },
    dispose() {
      for (const dispose of disposers.splice(0)) dispose()
    },
  }
}

function registerNapcatStatusRpc(connection: RpcConnection): (() => void) | undefined {
  if (connection.rpc?.handle === undefined) return undefined
  const disposable = connection.rpc.handle(QQ_BRIDGE_NAPCAT_RPC_CHANNEL, createNapcatStatusHandler(), { authority: 'loopback' })
  if (typeof disposable === 'function') return disposable
  if (disposable && typeof disposable === 'object' && typeof disposable.dispose === 'function') return () => disposable.dispose()
  return undefined
}

function createNapcatStatusHandler(): (endpoint: string, payload: unknown) => Promise<unknown> {
  return async (endpoint, payload) => {
    try {
      if (endpoint === 'status') return success(await inspectNapcatSettings(object(payload)))
      if (endpoint === 'setup') return success(await setupNapcatForSettings(object(payload)))
      if (endpoint === 'host-info') return success({ homeDir: homedir() })
      return badRequest(`unknown NapCat endpoint: ${endpoint}`)
    } catch (err) {
      return failure(err)
    }
  }
}

function success(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value }
}

function failure(error: unknown): { ok: false; error: { code: string; message: string; details: Record<string, never> } } {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

function badRequest(message: string): { ok: false; error: { code: string; message: string; details: { issues: unknown[] } } } {
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message,
      details: { issues: [] },
    },
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

async function buildQqBridgeSettingsSchema(): Promise<unknown | undefined> {
  const z = await loadSchemastery()
  if (z === undefined) return undefined
  const secret = (field: SchemaBuilder): SchemaBuilder => field.role ? field.role('secret') : field
  return z.object({
    enabled: z.boolean().default(false),
    platform: z.union(['napcat', 'official']).default('napcat'),
    napcat: z.object({
      loginQq: z.number().step?.(1).default(0) ?? z.number().default(0),
      wsUrl: z.string().default('ws://127.0.0.1:3001'),
      token: secret(z.string().default('')),
      guideDoc: z.string().default('docs/agent-napcat-guide.md'),
    }),
    official: z.object({
      appId: z.string().default(''),
      appSecret: secret(z.string().default('')),
      adminOpenId: z.string().default(''),
      allowlistOpenIds: z.array(z.string()).default([]),
      sandbox: z.boolean().default(false),
    }),
    access: z.object({
      adminQq: z.number().step?.(1).default(0) ?? z.number().default(0),
      allowlist: z.array(z.number()).default([]),
      commandPrefix: z.string().default(''),
      mode: z.union(['whitelist', 'open']).default('whitelist'),
    }),
    agent: z.object({
      preset: z.string().default('dsh-qq-bridge'),
      provider: z.string().default('deepseek-official'),
      model: z.string().default('deepseek-v4-flash'),
      models: z.array(z.string()).default([]),
      cwd: z.string().default('~'),
      streamText: z.boolean().default(false),
      streamReasoning: z.boolean().default(false),
      maxMessageLength: z.number().step?.(1).min?.(1).default(4500) ?? z.number().default(4500),
      ackMessage: z.string().default('收到，正在处理...'),
      timeoutMs: z.number().step?.(1).min?.(1).default(120000) ?? z.number().default(120000),
      timeoutMessage: z.string().default('agent 无响应，请稍后重试。'),
      qqReplyStyleSkill: z.object({
        enabled: z.boolean().default(true),
        skillName: z.string().default('qq-session-reply-style'),
      }),
    }),
    shell: z.object({
      enabled: z.boolean().default(false),
    }),
    notifications: z.object({
      agentReply: z.object({
        enabled: z.boolean().default(true),
      }),
    }),
    selfLogInput: z.object({
      enabled: z.boolean().default(false),
      logPath: z.string().default(''),
      pollIntervalMs: z.number().step?.(1).min?.(1).default(1000) ?? z.number().default(1000),
      replayOnStart: z.boolean().default(false),
    }),
  })
}

async function loadSchemastery(): Promise<SchemasteryFactory | undefined> {
  for (const specifier of ['@deepseek-ai/schemastery', 'schemastery']) {
    try {
      const mod = await import(specifier)
      return (mod.default ?? mod) as SchemasteryFactory
    } catch {
      // Keep the plugin usable outside DSH, where the settings UI packages are absent.
    }
  }
  return undefined
}

async function installBundledPreset(): Promise<void> {
  await installQqBridgePreset(resolveDshHome())
}

export async function cleanupLegacyProfileInsert(dshHome = resolveDshHome()): Promise<boolean> {
  const profilePath = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  const previous = await readFile(profilePath, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return undefined
    throw err
  })
  if (previous === undefined) return false

  const update = removeInsertItem(previous, QQ_BRIDGE_SETTINGS_NAMESPACE)
  if (!update.changed) return false

  const backupPath = join(dshHome, 'profiles', 'web', 'cordis.patch.yml.dsh-qq-bridge.bak')
  await writeProfilePatchWithBackup(profilePath, update.content, backupPath)
  console.info(`[dsh-qq-bridge] removed legacy profile insert from ${profilePath}; backup: ${backupPath}`)
  return true
}

function resolveDshHome(): string {
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : `${homedir()}/.dsh`
}
