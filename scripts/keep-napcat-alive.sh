#!/usr/bin/env bash
# NapCat 掉线守护:周期检测小号登录态,掉线自动重启 NapCat(快速登录自动重登)。
#
# 用法:
#   bash scripts/keep-napcat-alive.sh           # 前台运行(用 tmux/nohup 保活)
#   bash scripts/keep-napcat-alive.sh --once    # 只检测一次(供 cron 用)
#
# 原理:
# - 通过 onebot API get_login_info 检测登录态(比只看进程更准:进程活但被风控踢下线也算掉线)。
# - 掉线(检测失败/超时/进程不在)时自动 `napcat restart <QQ>`,利用快速登录票据自动重登,无需扫码。
# - 风控掉线无法根治,此脚本是「自动恢复」手段。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QQ="${DSH_QQ_BOT:-3678586949}"                    # 机器人小号
WS_URL="${DSH_QQ_WS:-ws://127.0.0.1:3001}"
TOKEN="${DSH_QQ_TOKEN:-KQLITQUqweSF7sHP}"         # onebot token(与插件一致)
CHECK_INTERVAL="${DSH_QQ_CHECK_INTERVAL:-60}"     # 秒
LOG="${DSH_QQ_ALIVE_LOG:-/tmp/napcat-alive.log}"  # 默认 /tmp(避免 $HOME 只读)

check_once() {
  # 1) QQ 进程必须在
  if ! pgrep -f "Napcat/opt/QQ/qq --no-sandbox -q ${QQ}" >/dev/null; then
    echo "$(date '+%F %T') QQ 进程不在 -> 重启" >> "$LOG"
    return 1
  fi
  # 2) onebot API 能返回登录态(进程活着但被踢也会失败/超时)
  #    在项目目录跑,确保 node 能解析 ws 模块
  (cd "$HERE" && node --input-type=module -e "
    import WebSocket from 'ws'
    const ws = new WebSocket('${WS_URL}', { headers: { Authorization: 'Bearer ${TOKEN}' } })
    const done = (code, msg) => { console.log(msg); try{ws.close()}catch{}; process.exit(code) }
    ws.on('open', () => ws.send(JSON.stringify({ action: 'get_login_info', echo: 'alive' })))
    ws.on('message', (d) => {
      try { const j = JSON.parse(String(d)); if (j.echo === 'alive') done(j.retcode === 0 && j.data?.user_id ? 0 : 1, 'check=' + (j.retcode === 0 ? 'online' : 'offline')) } catch {}
    })
    ws.on('error', (e) => done(1, 'ws-error ' + e.message))
    setTimeout(() => done(2, 'timeout'), 8000)
  ") 2>>"$LOG"
}

if [[ "${1:-}" == "--once" ]]; then
  if check_once; then echo "ONLINE"; exit 0; else echo "OFFLINE/需要重启"; exit 1; fi
fi

echo "$(date '+%F %T') 守护启动:QQ=${QQ} 每 ${CHECK_INTERVAL}s 检测,日志=${LOG}"
while true; do
  if ! check_once; then
    echo "$(date '+%F %T') 检测到掉线,重启 NapCat..." >> "$LOG"
    napcat restart "$QQ" >> "$LOG" 2>&1 || true
    sleep 20  # 等重启+重登
  fi
  sleep "$CHECK_INTERVAL"
done
