// 一次性诊断:解压 DSH 会话日志,检查事件形状(尤其 user/message 的 source)。
import { zstdDecompressSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

const file = '/home/liangyihao/.dsh/sessions/--home-liangyihao-temp-dsh-qq-bridge--/session-3d1cded9-80ec-4c0e-a3ec-06f6bffe053d/session.jsonl.zstd'
const buf = readFileSync(file)
let out
try {
  out = zstdDecompressSync(buf)
} catch (e) {
  // 可能是多帧拼接;逐帧尝试太复杂,先报错
  console.log('decompress failed:', e.message)
  process.exit(1)
}
const text = out.toString('utf8')
const lines = text.split('\n').filter((l) => l.trim())
console.log('total lines:', lines.length)
for (let i = 0; i < lines.length; i++) {
  try {
    const evt = JSON.parse(lines[i])
    if (['user/message', 'assistant/message', 'tool/result', 'agent/inbox/spliced', 'turn/end'].includes(evt.type)) {
      const msg = evt.type === 'user/message' ? evt.data : evt.data?.message
      console.log(`--- seq ${evt.seq} type=${evt.type} id=${evt.id ?? (msg?.id ?? '?')}`)
      if (evt.type === 'user/message') {
        console.log('    source:', JSON.stringify(evt.data?.source))
        console.log('    role:', evt.data?.role, ' contentLen:', evt.data?.content?.length)
      } else if (evt.type === 'turn/end') {
        console.log('    reason:', JSON.stringify(evt.data?.reason))
      } else if (evt.type === 'agent/inbox/spliced') {
        console.log('    inserted sources:', JSON.stringify(evt.data?.inserted?.map((m) => m.source)))
      } else {
        console.log('    source:', JSON.stringify(msg?.source))
      }
    }
  } catch { /* skip non-json */ }
}
