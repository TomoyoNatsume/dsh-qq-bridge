import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildBridgeInsertItem,
  buildOfficialBridgeInsertItem,
  updateSetupProfilePatch,
  writeProfilePatchWithBackup,
} from './dsh-profile.js'
import { updatePermissionDefaultPreset, writeSettingsWithBackup } from './dsh-settings.js'
import { createOfficialPairCode, pairOfficialAdmin } from './official-pairing.js'
import {
  canAcceptUserConfirmedLogin,
  classifyNapcatLogin,
  classifyNapcatLogPaths,
  classifyNapcatRuntime,
  defaultNapcatLogDir,
  defaultNapcatLogPath,
  defaultNapcatRootPath,
  defaultOnebotConfigPath,
  type NapcatLoginState,
  type NapcatLogPathState,
  type NapcatRuntimeState,
  tryReadOnebotToken,
  updateOnebotConfigFile,
} from './napcat.js'
import { isPromptCancelledError, parseQq, Prompter } from './prompt.js'
import { startDshWebBackground } from './dsh-runner.js'

type SetupPlatformChoice = 'NapCat / OneBot' | '腾讯官方 QQ Bot'
type PermissionDefaultChoice = 'workspace-write' | 'danger-full-access' | '保持现有 settings.yaml'

interface CommonSetupAnswers {
  commandPrefix: string
  model: string
  dshCheckout: string
  permissionDefault: PermissionDefaultChoice
}

interface SetupAnswers extends CommonSetupAnswers {
  napcatQq: number
  senderQq: number
  selfLogEnabled: boolean
  napcatRoot: string
}

interface OfficialSetupAnswers extends CommonSetupAnswers {
  appId: string
  appSecret: string
  sandbox: boolean
}

export async function runSetup(): Promise<void> {
  const prompt = new Prompter()
  try {
    console.log('dsh-qq-bridge setup')
    console.log('目标: Linux/WSL2 + QQ 接入 + DSH web profile\n')

    await preflightBase(prompt)
    const platform = await prompt.choice(
      '选择 QQ 接入方式',
      ['NapCat / OneBot', '腾讯官方 QQ Bot'],
      'NapCat / OneBot',
    ) as SetupPlatformChoice
    if (platform === '腾讯官方 QQ Bot') {
      await runOfficialSetup(prompt)
    } else {
      await runNapcatSetup(prompt)
    }
  } catch (err) {
    if (isPromptCancelledError(err)) {
      console.log('\nsetup 已取消。')
      process.exitCode = 130
      return
    }
    console.error(`setup failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  } finally {
    prompt.close()
  }
}

async function preflightBase(prompt: Prompter): Promise<void> {
  if (platform() !== 'linux') {
    throw new Error('第一版 setup 只支持 Linux/WSL2。其它平台请按 README 手动配置。')
  }
  const missing = ['node', 'npm', 'pnpm'].filter((cmd) => !commandExists(cmd))
  if (missing.length > 0) {
    throw new Error(`缺少命令: ${missing.join(', ')}。请先安装后再运行 setup。`)
  }
  if (!existsSync(fileURLToPath(new URL('../index.js', import.meta.url)))) {
    if (!await prompt.confirm('未找到 dist/index.js，是否运行 npm install && npm run build', true)) {
      throw new Error('缺少 dist/index.js，无法写入 DSH 插件入口。')
    }
    runChecked('npm', ['install'])
    runChecked('npm', ['run', 'build'])
  }
}

function preflightNapcat(): boolean {
  if (!commandExists('napcat')) {
    console.log(napcatCliInstallGuide())
    process.exitCode = 1
    return false
  }
  return true
}

async function runNapcatSetup(prompt: Prompter): Promise<void> {
  if (!preflightNapcat()) return
  const answers = await collectAnswers(prompt)
  const logPath = defaultNapcatLogPath(answers.napcatQq, answers.napcatRoot)

  const token = await configureNapcatEnvironment(prompt, answers.napcatQq, answers.napcatRoot)
  if (!token) {
    console.log('\n未能取得 OneBot token。请在 NapCat WebUI 配好正向 WebSocket 后重新运行 setup。')
    process.exitCode = 1
    return
  }
  await configureDshProfile(answers, logPath, token)
  await configureDshSettings(answers.permissionDefault)
  await maybeStartDshWeb(
    prompt,
    answers.dshCheckout,
    () => printVerifyGuidance(answers),
    () => printVerifyGuidance(answers, '启动后'),
    `如果发送 ${answers.commandPrefix} ping 后没有响应，请查看 NapCat 日志确认 QQ 是否登录成功。`,
    '如果没有响应，请查看 NapCat 日志确认 QQ 是否登录成功。',
  )
}

export function napcatCliInstallGuide(): string {
  return [
    '',
    '未检测到 NapCat CLI: 当前系统没有可用的 napcat 命令。',
    '如果你要使用 NapCat / OneBot 路径，请先在 Linux / WSL2 终端执行:',
    '',
    '  cd ~',
    '  curl -o napcat.sh https://raw.githubusercontent.com/NapNeko/NapCat-Installer/main/script/install.sh',
    '  bash napcat.sh --docker n --cli y',
    '',
    '安装完成后确认命令可用:',
    '',
    '  napcat help',
    '',
    '确认可用后重新运行:',
    '',
    '  pnpm exec dsh-qq-bridge setup',
    '',
    '如果你不想安装 NapCat，请重新运行 setup 并选择“腾讯官方 QQ Bot”。',
  ].join('\n')
}

async function runOfficialSetup(prompt: Prompter): Promise<void> {
  console.log('\n请先到这里配置你的 QQ 机器人:')
  console.log('https://q.qq.com/qqbot/dashboard/')
  console.log('确认机器人应用已创建，并准备好 AppID / AppSecret 后继续。\n')
  const answers = await collectOfficialAnswers(prompt)
  const pairCode = createOfficialPairCode()
  const pairCommand = `${answers.commandPrefix} pair ${pairCode}`

  console.log('\n开始配对腾讯官方 QQ Bot。')
  console.log('setup 会临时连接 QQBot 网关，收到一次性配对口令后自动读取你的 openid。')
  const adminOpenId = await pairOfficialAdmin({
    appId: answers.appId,
    appSecret: answers.appSecret,
    sandbox: answers.sandbox,
    pairCommand,
    onReady: () => {
      console.log(green(`请用管理员 QQ 给机器人发送: ${pairCommand}`))
    },
  })
  console.log(`已收到配对消息，adminOpenId: ${adminOpenId}`)

  await configureOfficialDshProfile(answers, adminOpenId)
  await configureDshSettings(answers.permissionDefault)
  await maybeStartDshWeb(
    prompt,
    answers.dshCheckout,
    () => printOfficialVerifyGuidance(answers),
    () => printOfficialVerifyGuidance(answers, '启动后'),
    `如果发送 ${answers.commandPrefix} ping 后没有响应，请查看 DSH web 日志和 QQ 开放平台机器人状态。`,
    '如果没有响应，请查看 DSH web 日志和 QQ 开放平台机器人状态。',
  )
}

async function collectAnswers(prompt: Prompter): Promise<SetupAnswers> {
  const napcatQq = await promptQq(prompt, '请输入DSH用于登陆后台的QQ号')
  const common = await collectCommonAnswers(prompt)
  const selfLogEnabled = await prompt.confirm('是否使用单号模式（自己给自己发消息）', true)
  const senderQq = selfLogEnabled ? napcatQq : await promptQq(prompt, '请输入发送指令的QQ号')
  const napcatRoot = await resolveNapcatRoot(prompt)
  return { ...common, napcatQq, senderQq, selfLogEnabled, napcatRoot }
}

async function collectOfficialAnswers(prompt: Prompter): Promise<OfficialSetupAnswers> {
  const common = await collectCommonAnswers(prompt)
  const appId = await promptRequiredText(prompt, 'QQ 开放平台 AppID')
  const appSecret = await promptRequiredText(prompt, 'QQ 开放平台 AppSecret')
  const sandbox = await prompt.confirm('是否使用 QQ 开放平台沙箱环境', false)
  return { ...common, appId, appSecret, sandbox }
}

async function collectCommonAnswers(prompt: Prompter): Promise<CommonSetupAnswers> {
  const commandPrefix = await prompt.text('设置发送指令时的前缀', '/dsh')
  const model = await prompt.choice('选择模型', ['deepseek-v4-flash', 'deepseek-v4-pro'], 'deepseek-v4-flash')
  const dshCheckout = await promptExistingDirectory(
    prompt,
    'DSH / deepseek-harness 目录',
    process.env.DSH_CHECKOUT ?? join(homedir(), 'deepseek-harness'),
  )
  const permissionDefault = await promptPermissionDefault(prompt)
  return { commandPrefix, model, dshCheckout, permissionDefault }
}

async function promptRequiredText(prompt: Prompter, label: string): Promise<string> {
  while (true) {
    const value = await prompt.text(label)
    if (value.trim()) return value.trim()
    console.log(`${label} 不能为空。`)
  }
}

async function promptPermissionDefault(prompt: Prompter): Promise<PermissionDefaultChoice> {
  console.log('\n选择后续新建 DSH Web 会话的默认权限:')
  console.log('- workspace-write: 较安全。Agent 只能写工作区和允许的临时目录；越权操作需要审批，QQ 远程使用时可能因为等待审批而卡住。')
  console.log('- danger-full-access: 最省心但风险最高。Agent 可直接访问本机进程权限能访问的路径，且不会弹出审批；只建议在本机可信环境使用。')
  console.log('- 保持现有 settings.yaml: setup 不修改 DSH 全局默认权限；继续使用你当前的 DSH 设置。')
  return await prompt.choice(
    '设置 permission.defaultPreset',
    ['workspace-write', 'danger-full-access', '保持现有 settings.yaml'],
    'workspace-write',
  ) as PermissionDefaultChoice
}

async function promptQq(prompt: Prompter, label: string): Promise<number> {
  while (true) {
    try {
      return parseQq(await prompt.text(label))
    } catch (err) {
      if (isPromptCancelledError(err)) throw err
      console.log(err instanceof Error ? err.message : String(err))
      console.log('请重新输入 QQ 号。')
    }
  }
}

async function promptExistingDirectory(prompt: Prompter, label: string, fallback: string): Promise<string> {
  while (true) {
    const path = resolveUserPath(await prompt.text(label, fallback))
    if (directoryExists(path)) return path
    console.log(`目录不存在: ${path}`)
    console.log('请重新输入。')
  }
}

async function resolveNapcatRoot(prompt: Prompter): Promise<string> {
  const defaultRoot = defaultNapcatRootPath()
  if (directoryExists(defaultRoot)) return defaultRoot

  console.log(`未找到默认 NapCat 目录: ${defaultRoot}`)
  return promptExistingDirectory(prompt, 'NapCat 根目录', defaultRoot)
}

async function configureDshProfile(answers: SetupAnswers, logPath: string, token: string): Promise<void> {
  const profilePath = join(resolveDshHome(), 'profiles', 'web', 'cordis.patch.yml')
  const pluginName = fileURLToPath(new URL('../index.js', import.meta.url))
  const item = buildBridgeInsertItem({
    pluginName,
    wsUrl: 'ws://127.0.0.1:3001',
    token,
    adminQq: answers.senderQq,
    commandPrefix: answers.commandPrefix,
    provider: 'deepseek-official',
    model: answers.model,
    selfLogEnabled: answers.selfLogEnabled,
    selfLogPath: answers.selfLogEnabled ? logPath : undefined,
  })
  const previous = await readFile(profilePath, 'utf8').catch(() => '[]\n')
  const update = updateSetupProfilePatch(previous, item)

  console.log(`\n最后一步: 写入 DSH profile: ${profilePath}`)
  const backup = await writeProfilePatchWithBackup(profilePath, update.content, profileBackupPath())
  console.log(`已写入 profile。备份: ${backup}`)
  console.log(`如需调整模型、前缀或 QQ 白名单，可修改: ${profilePath}`)
}

async function configureOfficialDshProfile(answers: OfficialSetupAnswers, adminOpenId: string): Promise<void> {
  const profilePath = join(resolveDshHome(), 'profiles', 'web', 'cordis.patch.yml')
  const pluginName = fileURLToPath(new URL('../index.js', import.meta.url))
  const item = buildOfficialBridgeInsertItem({
    pluginName,
    appId: answers.appId,
    appSecret: answers.appSecret,
    adminOpenId,
    allowlistOpenIds: [],
    sandbox: answers.sandbox,
    commandPrefix: answers.commandPrefix,
    provider: 'deepseek-official',
    model: answers.model,
  })
  const previous = await readFile(profilePath, 'utf8').catch(() => '[]\n')
  const update = updateSetupProfilePatch(previous, item)

  console.log(`\n最后一步: 写入 DSH profile: ${profilePath}`)
  const backup = await writeProfilePatchWithBackup(profilePath, update.content, profileBackupPath())
  console.log(`已写入 profile。备份: ${backup}`)
  console.log(`如需调整模型、前缀或官方 Bot 配置，可修改: ${profilePath}`)
}

async function configureDshSettings(permissionDefault: PermissionDefaultChoice): Promise<void> {
  if (permissionDefault === '保持现有 settings.yaml') {
    console.log('\n已选择保持现有 DSH 默认权限设置，跳过写入 ~/.dsh/settings.yaml。')
    return
  }
  const settingsPath = join(resolveDshHome(), 'settings.yaml')
  const previous = await readFile(settingsPath, 'utf8').catch(() => '')
  const update = updatePermissionDefaultPreset(previous, permissionDefault)

  console.log(`\n写入 DSH 默认权限设置: ${settingsPath}`)
  const backup = await writeSettingsWithBackup(settingsPath, update.content, settingsBackupPath())
  console.log(`已写入 settings。备份: ${backup}`)
}

async function maybeStartDshWeb(
  prompt: Prompter,
  dshCheckout: string,
  printStartedVerify: () => void,
  printManualVerify: () => void,
  startedNoResponseHint: string,
  manualNoResponseHint: string,
): Promise<void> {
  if (await prompt.confirm('是否后台启动 DSH web', true)) {
    const result = await startDshWebBackground({
      cwd: dshCheckout,
    })
    if (result.alreadyRunning && result.ready) {
      console.log(`检测到 DSH web 已在运行: ${result.url}`)
      if (result.pid !== null) console.log(`管理 PID: ${result.pid}`)
      console.log('已跳过后台启动，避免重复启动多个 DSH web。')
      console.log('setup 已写入新的 QQ bridge 配置；首次 setup 或更改配置后，请重启 DSH web 再验证 QQ 消息。')
    } else if (result.alreadyRunning) {
      console.log('检测到 DSH web 管理进程正在运行，但服务暂不可访问。')
      if (result.pid !== null) console.log(`管理 PID: ${result.pid}`)
      console.log(`地址: ${result.url}`)
      console.log(`日志: ${result.logPath}`)
      console.log('请查看日志确认启动状态。')
      console.log('setup 已写入新的 QQ bridge 配置；如果这是旧的 DSH web 进程，请重启后再验证 QQ 消息。')
    } else if (result.ready) {
      console.log('DSH web 后台启动成功。')
      if (result.pid !== null) console.log(`管理 PID: ${result.pid}`)
      console.log(`地址: ${result.url}`)
      console.log(`日志: ${result.logPath}`)
      console.log(`启动命令: ${result.command}`)
    } else {
      console.log('已尝试后台启动 DSH web。')
      if (result.pid !== null) console.log(`管理 PID: ${result.pid}`)
      console.log(`地址: ${result.url}`)
      console.log(`日志: ${result.logPath}`)
      console.log(`启动命令: ${result.command}`)
      console.log('但 30 秒内未确认服务可访问，请查看日志确认启动状态。')
    }
    console.log('管理命令: dsh-qq-bridge web status | dsh-qq-bridge web logs | dsh-qq-bridge web stop')
    printStartedVerify()
    console.log(startedNoResponseHint)
    printSetupRefreshGuidance()
  } else {
    console.log('\n之后可手动启动 DSH web。')
    printManualVerify()
    console.log(manualNoResponseHint)
    printSetupRefreshGuidance()
  }
}

async function configureNapcatEnvironment(prompt: Prompter, qq: number, napcatRoot: string): Promise<string | null> {
  const onebotPath = defaultOnebotConfigPath(qq, napcatRoot)

  console.log('\n第一步: 配置 NapCat 环境')
  let status = inspectNapcat(qq, napcatRoot)
  printNapcatStatus(status)

  if (status.runtime === 'not-running') {
    console.log(`NapCat 未启动，将执行: napcat start ${qq}`)
    spawnSync('napcat', ['start', String(qq)], { stdio: 'inherit' })
    status = inspectNapcat(qq, napcatRoot)
    printNapcatStatus(status)
  }

  await waitForNapcatLogin(prompt, qq, napcatRoot, status)

  return prepareOnebot(prompt, onebotPath)
}

async function prepareOnebot(prompt: Prompter, configPath: string): Promise<string | null> {
  console.log(`\n配置 OneBot 正向 WebSocket: ${configPath}`)
  try {
    const update = await updateOnebotConfigFile(configPath)
    console.log(`OneBot WS: ${update.server.host}:${update.server.port}, token=${update.token ? 'set' : 'empty'}`)
    if (update.changed) {
      console.log('已更新 NapCat OneBot 配置。')
      if (await prompt.confirm('是否执行 napcat restart 让 OneBot 配置生效', true)) {
        const qq = /onebot11_(\d+)\.json$/.exec(configPath)?.[1]
        if (qq) spawnSync('napcat', ['restart', qq], { stdio: 'inherit' })
      }
    }
    return update.token
  } catch (err) {
    if (isPromptCancelledError(err)) throw err
    console.warn(`自动配置 OneBot 失败: ${err instanceof Error ? err.message : String(err)}`)
    console.log('\n请改用 NapCat WebUI 手动开启:')
    console.log('  正向 WebSocket / Forward WebSocket')
    console.log('  监听地址: 127.0.0.1')
    console.log('  端口: 3001')
    console.log('  access token: 设置一个随机 token；setup 会把它写入 DSH profile')
    if (await prompt.confirm('已经在 WebUI 中手动配置完成了吗', false)) {
      const token = await tryReadOnebotToken(configPath)
      if (token) return token
      const typed = await prompt.text('请输入 OneBot access token')
      return typed || null
    }
    return null
  }
}

interface NapcatInspection {
  runtime: NapcatRuntimeState
  login: NapcatLoginState
  logState: NapcatLogPathState
  output: string
}

function inspectNapcat(qq: number, napcatRoot: string): NapcatInspection {
  const status = spawnSync('napcat', ['status', String(qq)], { encoding: 'utf8' })
  const output = [status.stdout, status.stderr].filter(Boolean).join('\n').trim()
  return {
    runtime: classifyNapcatRuntime(status.status, output),
    login: classifyNapcatLogin(output),
    logState: classifyNapcatLogPaths({
      rootExists: existsSync(napcatRoot),
      logDirExists: existsSync(defaultNapcatLogDir(napcatRoot)),
      accountLogExists: existsSync(defaultNapcatLogPath(qq, napcatRoot)),
    }),
    output,
  }
}

async function waitForNapcatLogin(prompt: Prompter, qq: number, napcatRoot: string, initialStatus: NapcatInspection): Promise<void> {
  let status = initialStatus
  while (true) {
    printNapcatLogGuidance(qq, napcatRoot, status.logState)
    const action = await prompt.choice('是否已打开日志并完成扫码登录', ['是', '二维码过期'], '是')
    if (action === '二维码过期') {
      restartNapcatForQr(qq)
      status = inspectNapcat(qq, napcatRoot)
      printNapcatStatus(status)
      continue
    }
    if (action !== '是') {
      console.log('请选择 1 或 2。')
      continue
    }

    status = inspectNapcat(qq, napcatRoot)
    printNapcatStatus(status)
    if (canAcceptUserConfirmedLogin(status)) {
      console.log('已确认 NapCat 登录成功。')
      if (status.login === 'unknown') {
        console.log('napcat status 未明确输出登录状态；已根据“进程运行 + 当前 QQ 日志存在 + 你的确认”继续。')
      }
      return
    }
    if (status.runtime === 'not-running') {
      console.log(`NapCat 当前未启动，将执行: napcat start ${qq}`)
      spawnSync('napcat', ['start', String(qq)], { stdio: 'inherit' })
      status = inspectNapcat(qq, napcatRoot)
      printNapcatStatus(status)
    }
    console.log(green('尚未确认登录成功。请继续打开日志扫码；如果二维码过期，请选择“二维码过期”。'))
  }
}

function printNapcatStatus(status: NapcatInspection): void {
  if (status.output) {
    console.log('\n--- napcat status ---')
    console.log(status.output)
    console.log('--- end status ---')
  }
  if (status.runtime === 'running' && status.login === 'not-logged-in') {
    console.log('识别结果: NapCat 已启动，但看起来尚未登录。')
  } else if (status.runtime === 'running') {
    console.log('识别结果: NapCat 已启动。登录状态请以日志为准。')
  } else if (status.runtime === 'not-running') {
    console.log('识别结果: NapCat 未启动。')
  } else {
    console.log('识别结果: NapCat 状态不明确。')
  }
}

function printNapcatLogGuidance(qq: number, napcatRoot: string, state: NapcatLogPathState): void {
  const rootPath = napcatRoot
  const logDir = defaultNapcatLogDir(napcatRoot)
  const logPath = defaultNapcatLogPath(qq, napcatRoot)
  console.log('\n请打开 NapCat 登录日志，按日志里的二维码扫码登录。')
  console.log(green('提示: 日志中可能有多个二维码，请拉到最后一个二维码扫码。'))
  if (state === 'missing-root') {
    console.log(`未找到 NapCat 目录: ${rootPath}`)
    console.log('请确认 NapCat 已安装，或先执行 README 中的 NapCat 安装步骤。')
  } else if (state === 'missing-log-dir') {
    console.log(`未找到 NapCat log 目录: ${logDir}`)
    console.log('请确认 NapCat 已启动过，或重新执行 napcat start。')
  } else if (state === 'missing-account-log') {
    console.log(`未找到当前 QQ 的日志文件: ${logPath}`)
    console.log('这通常表示 QQ 号不匹配、NapCat 尚未为该账号启动，或日志还没生成。')
  } else {
    console.log(`日志文件: ${logPath}`)
  }
  console.log(`查看命令: napcat log ${qq}`)
  console.log(`持续查看: tail -f ${logPath}`)
}

function restartNapcatForQr(qq: number): void {
  console.log(`二维码过期，将执行: napcat restart ${qq}`)
  const restart = spawnSync('napcat', ['restart', String(qq)], { stdio: 'inherit' })
  if (restart.status === 0) return
  console.log(`napcat restart 未成功，将执行: napcat start ${qq}`)
  spawnSync('napcat', ['start', String(qq)], { stdio: 'inherit' })
}

function printVerifyGuidance(answers: SetupAnswers, prefix = '请'): void {
  if (answers.selfLogEnabled) {
    console.log(`${prefix}在 QQ 给自己发送: ${answers.commandPrefix} ping`)
    return
  }
  console.log(`${prefix}用 QQ ${answers.senderQq} 给 QQ ${answers.napcatQq} 发送: ${answers.commandPrefix} ping`)
}

function printOfficialVerifyGuidance(answers: OfficialSetupAnswers, prefix = '请'): void {
  console.log(`${prefix}用刚才配对的 QQ 给官方机器人发送: ${answers.commandPrefix} ping`)
}

function printSetupRefreshGuidance(): void {
  console.log(yellow('如果重新 setup、重新配置 OneBot token、重配 NapCat、或更换 QQ Bot 应用，请重新运行 setup 更新配置。'))
}

function commandExists(cmd: string): boolean {
  return spawnSync('sh', ['-lc', `command -v ${shellQuote(cmd)}`], { stdio: 'ignore' }).status === 0
}

function runChecked(cmd: string, args: readonly string[]): void {
  const result = spawnSync(cmd, args, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`)
}

function resolveDshHome(): string {
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
}

function profileBackupPath(): string {
  return join(toolRoot(), 'backups', 'cordis.patch.yml.bak')
}

function settingsBackupPath(): string {
  return join(toolRoot(), 'backups', 'settings.yaml.bak')
}

function toolRoot(): string {
  return fileURLToPath(new URL('../../', import.meta.url))
}

function resolveUserPath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2))
  return resolve(path)
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function shellQuote(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`
}

function green(text: string): string {
  return `\x1b[32m${text}\x1b[0m`
}

function yellow(text: string): string {
  return `\x1b[33m${text}\x1b[0m`
}
