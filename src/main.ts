#!/usr/bin/env node
import { runCli } from './cli/index.js'

void runCli(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
