import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const sourcePath = resolve('src/client.js')
const targetPath = resolve('dist/client.js')

const source = await readFile(sourcePath, 'utf8')

if (!source.includes('id: "@yachangchang/dsh-qq-bridge"')) {
  throw new Error('client bundle must register @yachangchang/dsh-qq-bridge')
}

if (!source.includes('const NS = "dsh-qq-bridge"')) {
  throw new Error('client settings namespace must remain dsh-qq-bridge')
}

await mkdir(dirname(targetPath), { recursive: true })
await writeFile(targetPath, source)

console.log(`[build-client] wrote ${targetPath}`)
