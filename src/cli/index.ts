import { runEcho } from './echo.js'
import { getDshWebStatus, stopDshWeb, tailDshWebLog } from './dsh-runner.js'
import { runSetup } from './setup.js'

export async function runCli(argv: readonly string[]): Promise<void> {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp()
    return
  }
  if (command === 'echo') {
    if (argv[1] === '--help' || argv[1] === '-h') {
      printEchoHelp()
      return
    }
    runEcho()
    return
  }
  if (command === 'setup') {
    if (argv[1] === '--help' || argv[1] === '-h') {
      printSetupHelp()
      return
    }
    await runSetup()
    return
  }
  if (command === 'web') {
    await runWebCommand(argv.slice(1))
    return
  }
  console.error(`unknown command: ${command}`)
  printHelp()
  process.exitCode = 2
}

async function runWebCommand(argv: readonly string[]): Promise<void> {
  const command = argv[0] ?? 'status'
  if (command === '--help' || command === '-h' || command === 'help') {
    printWebHelp()
    return
  }
  if (command === 'status') {
    const status = await getDshWebStatus()
    console.log(`地址: ${status.url}`)
    console.log(`可访问: ${status.reachable ? '是' : '否'}`)
    console.log(`pid 文件: ${status.pidFile}`)
    console.log(`pid: ${status.pid ?? '无'}`)
    console.log(`进程存活: ${status.processAlive ? '是' : '否'}`)
    console.log(`日志: ${status.logPath}`)
    return
  }
  if (command === 'logs' || command === 'log') {
    const code = tailDshWebLog()
    process.exitCode = code ?? 0
    return
  }
  if (command === 'stop') {
    const result = await stopDshWeb()
    console.log(result.message)
    if (!result.stopped) process.exitCode = 1
    return
  }
  console.error(`unknown web command: ${command}`)
  printWebHelp()
  process.exitCode = 2
}

function printHelp(): void {
  console.log(`dsh-qq-bridge

Usage:
  dsh-qq-bridge setup     interactive Linux/WSL2 setup wizard
  dsh-qq-bridge web       manage setup-started DSH web background process
  dsh-qq-bridge echo      local QQ echo link test
  dsh-qq-bridge --help    show this help

For existing scripts, npm start still runs echo mode.`)
}

function printSetupHelp(): void {
  console.log(`dsh-qq-bridge setup

Interactive setup wizard for Linux/WSL2 + NapCat CLI or Tencent official QQ Bot.

It previews and writes the DSH web profile, configures either
NapCat/OneBot or an official QQ Bot pairing, and optionally starts
DSH web.`)
}

function printWebHelp(): void {
  console.log(`dsh-qq-bridge web

Manage the DSH web process started by setup.

Usage:
  dsh-qq-bridge web status   show pid, url, and log path
  dsh-qq-bridge web logs     tail the DSH web log
  dsh-qq-bridge web stop     stop the managed DSH web process`)
}

function printEchoHelp(): void {
  console.log(`dsh-qq-bridge echo

Local QQ echo link test. Configure with:
  DSH_QQ_ADMIN=<qq>
  DSH_QQ_TOKEN=<onebot token>
  DSH_QQ_WS_URL=ws://127.0.0.1:3001
  DSH_QQ_PREFIX=/dsh
  DSH_QQ_SELF_LOG=true`)
}
