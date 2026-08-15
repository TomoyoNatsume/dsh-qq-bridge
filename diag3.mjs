import { zstdDecompressSync, constants } from 'node:zlib'
import { readFileSync } from 'node:fs'
// 简单多帧解码:反复解压剩余 buffer,直到耗尽
const buf = readFileSync('/home/liangyihao/.dsh/sessions/--home-liangyihao-temp-dsh-qq-bridge--/session-3d1cded9-80ec-4c0e-a3ec-06f6bffe053d/session.jsonl.zstd')
let rest = buf
let total = ''
let guard = 0
while (rest.length > 0 && guard++ < 1000) {
  let dec
  try {
    dec = zstdDecompressSync(rest)
  } catch (e) {
    // 无法继续解压,尝试截断到最后一个完整帧太复杂,先看已解压内容
    console.log('frame decompress stopped:', e.message.slice(0,80))
    break
  }
  const s = dec.toString('utf8')
  total += s
  // 计算该帧消耗的字节:用压缩参数解回看长度不可靠;改试:减去已解压内容的……不行。
  // 用 zstdDecompressSync 无法得知帧边界,换思路:扫描 magic 0x28 B5 2F FD 找下一帧
  const magic = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])
  let idx = -1
  for (let i = 4; i < rest.length - 4; i++) {
    if (rest[i] === magic[0] && rest[i+1] === magic[1] && rest[i+2] === magic[2] && rest[i+3] === magic[3]) { idx = i; break }
  }
  if (idx <= 0) break
  rest = rest.subarray(idx)
  if (guard > 50) break // 安全阀
}
console.log('decoded total length:', total.length)
console.log('--- last 1500 chars ---')
console.log(total.slice(-1500))
