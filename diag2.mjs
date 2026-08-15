import { zstdDecompressSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
const file = '/home/liangyihao/.dsh/sessions/--home-liangyihao-temp-dsh-qq-bridge--/session-3d1cded9-80ec-4c0e-a3ec-06f6bffe053d/session.jsonl.zstd'
const out = zstdDecompressSync(readFileSync(file))
const text = out.toString('utf8')
console.log('decoded length:', text.length)
console.log('--- first 800 chars ---')
console.log(text.slice(0, 800))
console.log('--- last 800 chars ---')
console.log(text.slice(-800))
