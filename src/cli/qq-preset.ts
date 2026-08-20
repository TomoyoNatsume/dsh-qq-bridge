import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const QQ_BRIDGE_PRESET_ID = 'dsh-qq-bridge'
const SKILLS_DIR_TOKEN = '__DSH_QQ_BRIDGE_SKILLS_DIR__'

export interface InstallQqBridgePresetResult {
  sourceDir: string
  targetDir: string
}

export async function installQqBridgePreset(dshHome: string): Promise<InstallQqBridgePresetResult> {
  const sourceDir = fileURLToPath(new URL('../../agent-presets/dsh-qq-bridge/', import.meta.url))
  const targetDir = join(dshHome, '.agent-presets', QQ_BRIDGE_PRESET_ID)
  await mkdir(dirname(targetDir), { recursive: true })
  await rm(targetDir, { recursive: true, force: true })
  await cp(sourceDir, targetDir, { recursive: true })
  const compositionPath = join(targetDir, 'agent.cordis.yml')
  const composition = await readFile(compositionPath, 'utf8')
  await writeFile(
    compositionPath,
    composition.replaceAll(SKILLS_DIR_TOKEN, yamlQuote(join(targetDir, 'skills'))),
    'utf8',
  )
  return { sourceDir, targetDir }
}

function yamlQuote(value: string): string {
  return JSON.stringify(value)
}
