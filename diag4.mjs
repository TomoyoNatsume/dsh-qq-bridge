import { zstdDecompressSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
const buf = readFileSync('/home/liangyihao/.dsh/sessions/--home-liangyihao-temp-dsh-qq-bridge--/session-3d1cded9-80ec-4c0e-a3ec-06f6bffe053d/session.jsonl.zstd')
let rest = buf
let total = ''
let guard = 0
const magic = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])
while (rest.length > 0 && guard++ < 2000) {
  let dec
  try { dec = zstdDecompressSync(rest) } catch { break }
  total += dec.toString('utf8')
  let idx = -1
  for (let i = 4; i < rest.length - 4; i++) {
    if (rest[i] === magic[0] && rest[i+1] === magic[1] && rest[i+2] === magic[2] && rest[i+3] === magic[3]) { idx = i; break }
  }
  if (idx <= 0) break
  rest = rest.subarray(idx)
}
const lines = total.split('\n').filter(l => l.trim())
console.log('total lines:', lines.length)
// 找关键事件: user/message, turn/start, turn/end, assistant/message
const interesting = []
for (const line of lines) {
  try {
    const evt = JSON.parse(line)
    if (['user/message','turn/start','turn/end','assistant/message','agent/inbox/spliced'].includes(evt.type)) {
      interesting.push(evt)
    }
  } catch {}
}
console.log('interesting events:', interesting.length)
for (const evt of interesting.slice(0, 40)) {
  if (evt.type === 'user/message') console.log(`seq${evt.seq} USER source=${JSON.stringify(evt.data?.source)} content=${JSON.stringify(evt.data?.content)?.slice(0,120)}`)
  else if (evt.type === 'turn/start') console.log(`seq${evt.seq} TURN_START`)
  else if (evt.type === 'turn/end') console.log(`seq${evt.seq} TURN_END reason=${JSON.stringify(evt.data?.reason)?.slice(0,200)}`)
  else if (evt.type === 'assistant/message') console.log(`seq${evt.seq} ASSISTANT content=${JSON.stringify(evt.data?.message?.content)?.slice(0,150)}`)
  else if (evt.type === 'agent/inbox/spliced') console.log(`seq${evt.seq} INBOX inserted=${JSON.stringify(evt.data?.inserted?.map(m=>({id:m?.id, src:m?.source})))?.slice(0,150)}`)
}
