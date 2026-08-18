import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBridgeInsertItem, updateSetupProfilePatch, writeProfilePatchWithBackup } from './dsh-profile.js';
import { updatePermissionDefaultPreset, writeSettingsWithBackup } from './dsh-settings.js';
import { canAcceptUserConfirmedLogin, classifyNapcatLogin, classifyNapcatLogPaths, classifyNapcatRuntime, defaultNapcatLogDir, defaultNapcatLogPath, defaultNapcatRootPath, defaultOnebotConfigPath, tryReadOnebotToken, updateOnebotConfigFile, } from './napcat.js';
import { parseQq, Prompter } from './prompt.js';
import { startDshWebBackground } from './dsh-runner.js';
export async function runSetup() {
    const prompt = new Prompter();
    try {
        console.log('dsh-qq-bridge setup');
        console.log('目标: Linux/WSL2 + NapCat CLI + DSH web profile\n');
        await preflight(prompt);
        const answers = await collectAnswers(prompt);
        const logPath = defaultNapcatLogPath(answers.qq, answers.napcatRoot);
        const token = await configureNapcatEnvironment(prompt, answers.qq, answers.napcatRoot);
        if (!token) {
            console.log('\n未能取得 OneBot token。请在 NapCat WebUI 配好正向 WebSocket 后重新运行 setup。');
            process.exitCode = 1;
            return;
        }
        await configureDshProfile(answers, logPath, token);
        await configureDshSettings();
        if (await prompt.confirm('是否后台启动 DSH web', true)) {
            const result = await startDshWebBackground({
                cwd: answers.dshCheckout,
            });
            if (result.alreadyRunning && result.ready) {
                console.log(`检测到 DSH web 已在运行: ${result.url}`);
                if (result.pid !== null)
                    console.log(`管理 PID: ${result.pid}`);
                console.log('已跳过后台启动，避免重复启动多个 DSH web。');
            }
            else if (result.alreadyRunning) {
                console.log('检测到 DSH web 管理进程正在运行，但服务暂不可访问。');
                if (result.pid !== null)
                    console.log(`管理 PID: ${result.pid}`);
                console.log(`地址: ${result.url}`);
                console.log(`日志: ${result.logPath}`);
                console.log('请查看日志确认启动状态。');
            }
            else if (result.ready) {
                console.log('DSH web 后台启动成功。');
                if (result.pid !== null)
                    console.log(`管理 PID: ${result.pid}`);
                console.log(`地址: ${result.url}`);
                console.log(`日志: ${result.logPath}`);
                console.log(`启动命令: ${result.command}`);
            }
            else {
                console.log('已尝试后台启动 DSH web。');
                if (result.pid !== null)
                    console.log(`管理 PID: ${result.pid}`);
                console.log(`地址: ${result.url}`);
                console.log(`日志: ${result.logPath}`);
                console.log(`启动命令: ${result.command}`);
                console.log('但 30 秒内未确认服务可访问，请查看日志确认启动状态。');
            }
            console.log('管理命令: dsh-qq-bridge web status | dsh-qq-bridge web logs | dsh-qq-bridge web stop');
            console.log(`请在 QQ 发送: ${answers.commandPrefix} ping`);
            console.log(`如果发送 ${answers.commandPrefix} ping 后没有响应，请查看 NapCat 日志确认 QQ 是否登录成功。`);
            printSetupRefreshGuidance();
        }
        else {
            console.log('\n之后可手动启动 DSH web。');
            console.log(`启动后发送 ${answers.commandPrefix} ping；如果没有响应，请查看 NapCat 日志确认 QQ 是否登录成功。`);
            printSetupRefreshGuidance();
        }
    }
    catch (err) {
        console.error(`setup failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
    finally {
        prompt.close();
    }
}
async function preflight(prompt) {
    if (platform() !== 'linux') {
        throw new Error('第一版 setup 只支持 Linux/WSL2。其它平台请按 README 手动配置。');
    }
    const missing = ['node', 'npm', 'pnpm', 'napcat'].filter((cmd) => !commandExists(cmd));
    if (missing.length > 0) {
        throw new Error(`缺少命令: ${missing.join(', ')}。请先安装后再运行 setup。`);
    }
    if (!existsSync(fileURLToPath(new URL('../index.js', import.meta.url)))) {
        if (!await prompt.confirm('未找到 dist/index.js，是否运行 npm install && npm run build', true)) {
            throw new Error('缺少 dist/index.js，无法写入 DSH 插件入口。');
        }
        runChecked('npm', ['install']);
        runChecked('npm', ['run', 'build']);
    }
}
async function collectAnswers(prompt) {
    const qq = await promptQq(prompt);
    const commandPrefix = await prompt.text('QQ 指令前缀', '/dsh');
    const model = await prompt.choice('选择 DSH 模型', ['deepseek-v4-flash', 'deepseek-v4-pro'], 'deepseek-v4-flash');
    const selfLogEnabled = await prompt.confirm('是否使用单号模式（自己给自己发消息）', true);
    const dshCheckout = await promptExistingDirectory(prompt, 'DSH / deepseek-harness 目录', process.env.DSH_CHECKOUT ?? join(homedir(), 'deepseek-harness'));
    const napcatRoot = await resolveNapcatRoot(prompt);
    return { qq, commandPrefix, model, selfLogEnabled, dshCheckout, napcatRoot };
}
async function promptQq(prompt) {
    while (true) {
        try {
            return parseQq(await prompt.text('请输入登录 NapCat 的 QQ 号'));
        }
        catch (err) {
            console.log(err instanceof Error ? err.message : String(err));
            console.log('请重新输入 QQ 号。');
        }
    }
}
async function promptExistingDirectory(prompt, label, fallback) {
    while (true) {
        const path = resolveUserPath(await prompt.text(label, fallback));
        if (directoryExists(path))
            return path;
        console.log(`目录不存在: ${path}`);
        console.log('请重新输入。');
    }
}
async function resolveNapcatRoot(prompt) {
    const defaultRoot = defaultNapcatRootPath();
    if (directoryExists(defaultRoot))
        return defaultRoot;
    console.log(`未找到默认 NapCat 目录: ${defaultRoot}`);
    return promptExistingDirectory(prompt, 'NapCat 根目录', defaultRoot);
}
async function configureDshProfile(answers, logPath, token) {
    const profilePath = join(resolveDshHome(), 'profiles', 'web', 'cordis.patch.yml');
    const pluginName = fileURLToPath(new URL('../index.js', import.meta.url));
    const item = buildBridgeInsertItem({
        pluginName,
        wsUrl: 'ws://127.0.0.1:3001',
        token,
        adminQq: answers.qq,
        commandPrefix: answers.commandPrefix,
        provider: 'deepseek-official',
        model: answers.model,
        selfLogEnabled: answers.selfLogEnabled,
        selfLogPath: answers.selfLogEnabled ? logPath : undefined,
    });
    const previous = await readFile(profilePath, 'utf8').catch(() => '[]\n');
    const update = updateSetupProfilePatch(previous, item);
    console.log(`\n最后一步: 写入 DSH profile: ${profilePath}`);
    console.log(update.preview);
    const backup = await writeProfilePatchWithBackup(profilePath, update.content);
    console.log(`已写入 profile。备份: ${backup}`);
    console.log(`如需调整模型、前缀或 QQ 白名单，可修改: ${profilePath}`);
}
async function configureDshSettings() {
    const settingsPath = join(resolveDshHome(), 'settings.yaml');
    const previous = await readFile(settingsPath, 'utf8').catch(() => '');
    const update = updatePermissionDefaultPreset(previous);
    console.log(`\n写入 DSH 默认权限设置: ${settingsPath}`);
    console.log(update.preview);
    const backup = await writeSettingsWithBackup(settingsPath, update.content);
    console.log(`已写入 settings。备份: ${backup}`);
}
async function configureNapcatEnvironment(prompt, qq, napcatRoot) {
    const onebotPath = defaultOnebotConfigPath(qq, napcatRoot);
    console.log('\n第一步: 配置 NapCat 环境');
    let status = inspectNapcat(qq, napcatRoot);
    printNapcatStatus(status);
    if (status.runtime === 'not-running') {
        console.log(`NapCat 未启动，将执行: napcat start ${qq}`);
        spawnSync('napcat', ['start', String(qq)], { stdio: 'inherit' });
        status = inspectNapcat(qq, napcatRoot);
        printNapcatStatus(status);
    }
    await waitForNapcatLogin(prompt, qq, napcatRoot, status);
    return prepareOnebot(prompt, onebotPath);
}
async function prepareOnebot(prompt, configPath) {
    console.log(`\n配置 OneBot 正向 WebSocket: ${configPath}`);
    try {
        const update = await updateOnebotConfigFile(configPath);
        console.log(`OneBot WS: ${update.server.host}:${update.server.port}, token=${update.token ? 'set' : 'empty'}`);
        if (update.changed) {
            console.log('已更新 NapCat OneBot 配置。');
            if (await prompt.confirm('是否执行 napcat restart 让 OneBot 配置生效', true)) {
                const qq = /onebot11_(\d+)\.json$/.exec(configPath)?.[1];
                if (qq)
                    spawnSync('napcat', ['restart', qq], { stdio: 'inherit' });
            }
        }
        return update.token;
    }
    catch (err) {
        console.warn(`自动配置 OneBot 失败: ${err instanceof Error ? err.message : String(err)}`);
        console.log('\n请改用 NapCat WebUI 手动开启:');
        console.log('  正向 WebSocket / Forward WebSocket');
        console.log('  监听地址: 127.0.0.1');
        console.log('  端口: 3001');
        console.log('  access token: 设置一个随机 token；setup 会把它写入 DSH profile');
        if (await prompt.confirm('已经在 WebUI 中手动配置完成了吗', false)) {
            const token = await tryReadOnebotToken(configPath);
            if (token)
                return token;
            const typed = await prompt.text('请输入 OneBot access token');
            return typed || null;
        }
        return null;
    }
}
function inspectNapcat(qq, napcatRoot) {
    const status = spawnSync('napcat', ['status', String(qq)], { encoding: 'utf8' });
    const output = [status.stdout, status.stderr].filter(Boolean).join('\n').trim();
    return {
        runtime: classifyNapcatRuntime(status.status, output),
        login: classifyNapcatLogin(output),
        logState: classifyNapcatLogPaths({
            rootExists: existsSync(napcatRoot),
            logDirExists: existsSync(defaultNapcatLogDir(napcatRoot)),
            accountLogExists: existsSync(defaultNapcatLogPath(qq, napcatRoot)),
        }),
        output,
    };
}
async function waitForNapcatLogin(prompt, qq, napcatRoot, initialStatus) {
    let status = initialStatus;
    while (true) {
        printNapcatLogGuidance(qq, napcatRoot, status.logState);
        const action = await prompt.choice('是否已打开日志并完成扫码登录', ['是', '二维码过期'], '是');
        if (action === '二维码过期') {
            restartNapcatForQr(qq);
            status = inspectNapcat(qq, napcatRoot);
            printNapcatStatus(status);
            continue;
        }
        if (action !== '是') {
            console.log('请选择 1 或 2。');
            continue;
        }
        status = inspectNapcat(qq, napcatRoot);
        printNapcatStatus(status);
        if (canAcceptUserConfirmedLogin(status)) {
            console.log('已确认 NapCat 登录成功。');
            if (status.login === 'unknown') {
                console.log('napcat status 未明确输出登录状态；已根据“进程运行 + 当前 QQ 日志存在 + 你的确认”继续。');
            }
            return;
        }
        if (status.runtime === 'not-running') {
            console.log(`NapCat 当前未启动，将执行: napcat start ${qq}`);
            spawnSync('napcat', ['start', String(qq)], { stdio: 'inherit' });
            status = inspectNapcat(qq, napcatRoot);
            printNapcatStatus(status);
        }
        console.log(green('尚未确认登录成功。请继续打开日志扫码；如果二维码过期，请选择“二维码过期”。'));
    }
}
function printNapcatStatus(status) {
    if (status.output) {
        console.log('\n--- napcat status ---');
        console.log(status.output);
        console.log('--- end status ---');
    }
    if (status.runtime === 'running' && status.login === 'not-logged-in') {
        console.log('识别结果: NapCat 已启动，但看起来尚未登录。');
    }
    else if (status.runtime === 'running') {
        console.log('识别结果: NapCat 已启动。登录状态请以日志为准。');
    }
    else if (status.runtime === 'not-running') {
        console.log('识别结果: NapCat 未启动。');
    }
    else {
        console.log('识别结果: NapCat 状态不明确。');
    }
}
function printNapcatLogGuidance(qq, napcatRoot, state) {
    const rootPath = napcatRoot;
    const logDir = defaultNapcatLogDir(napcatRoot);
    const logPath = defaultNapcatLogPath(qq, napcatRoot);
    console.log('\n请打开 NapCat 登录日志，按日志里的二维码扫码登录。');
    console.log(green('提示: 日志中可能有多个二维码，请拉到最后一个二维码扫码。'));
    if (state === 'missing-root') {
        console.log(`未找到 NapCat 目录: ${rootPath}`);
        console.log('请确认 NapCat 已安装，或先执行 README 中的 NapCat 安装步骤。');
    }
    else if (state === 'missing-log-dir') {
        console.log(`未找到 NapCat log 目录: ${logDir}`);
        console.log('请确认 NapCat 已启动过，或重新执行 napcat start。');
    }
    else if (state === 'missing-account-log') {
        console.log(`未找到当前 QQ 的日志文件: ${logPath}`);
        console.log('这通常表示 QQ 号不匹配、NapCat 尚未为该账号启动，或日志还没生成。');
    }
    else {
        console.log(`日志文件: ${logPath}`);
    }
    console.log(`查看命令: napcat log ${qq}`);
    console.log(`持续查看: tail -f ${logPath}`);
}
function restartNapcatForQr(qq) {
    console.log(`二维码过期，将执行: napcat restart ${qq}`);
    const restart = spawnSync('napcat', ['restart', String(qq)], { stdio: 'inherit' });
    if (restart.status === 0)
        return;
    console.log(`napcat restart 未成功，将执行: napcat start ${qq}`);
    spawnSync('napcat', ['start', String(qq)], { stdio: 'inherit' });
}
function printSetupRefreshGuidance() {
    console.log(yellow('如果重新 setup、重新配置 OneBot token、或重装/重配 NapCat，请重新运行 setup 更新配置。'));
}
function commandExists(cmd) {
    return spawnSync('sh', ['-lc', `command -v ${shellQuote(cmd)}`], { stdio: 'ignore' }).status === 0;
}
function runChecked(cmd, args) {
    const result = spawnSync(cmd, args, { stdio: 'inherit' });
    if (result.status !== 0)
        throw new Error(`${cmd} ${args.join(' ')} failed`);
}
function resolveDshHome() {
    return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh');
}
function resolveUserPath(path) {
    if (path === '~')
        return homedir();
    if (path.startsWith('~/'))
        return resolve(homedir(), path.slice(2));
    return resolve(path);
}
function directoryExists(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
function shellQuote(input) {
    return `'${input.replace(/'/g, `'\\''`)}'`;
}
function green(text) {
    return `\x1b[32m${text}\x1b[0m`;
}
function yellow(text) {
    return `\x1b[33m${text}\x1b[0m`;
}
