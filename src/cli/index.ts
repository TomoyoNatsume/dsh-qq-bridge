import { runEcho } from './echo.js'
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
  console.error(`unknown command: ${command}`)
  printHelp()
  process.exitCode = 2
}

function printHelp(): void {
  console.log(`dsh-qq-bridge

Usage:
  dsh-qq-bridge setup     interactive Linux/WSL2 setup wizard
  dsh-qq-bridge echo      local QQ echo link test
  dsh-qq-bridge --help    show this help

For existing scripts, npm start still runs echo mode.`)
}

function printSetupHelp(): void {
  console.log(`dsh-qq-bridge setup

Interactive setup wizard for Linux/WSL2 + NapCat CLI.

It previews and writes the DSH web profile, then checks/starts
NapCat, prints log commands for QR login, configures local OneBot
WebSocket, and optionally starts DSH web.`)
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
