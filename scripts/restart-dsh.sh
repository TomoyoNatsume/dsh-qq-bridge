#!/usr/bin/env bash
# 一键重建插件并重启 DSH Host(web profile)。
#
# 用法:
#   bash scripts/restart-dsh.sh          # build 插件 + 重启 host
#   bash scripts/restart-dsh.sh --no-build   # 仅重启 host(不重新编译)
#
# 说明:
# - 默认先 `npm run build` 编译 dsh-qq-bridge(改源码后必须)。
# - 再 kill 当前 DSH web host,并在 deepseek-harness checkout 下 nohup 重启。
# - 重启后插件随 cordis.patch.yml 自动挂载并连上 NapCat。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_CHECKOUT="${DSH_CHECKOUT:-/home/liangyihao/deepseek-harness}"
WEB_LOG="${WEB_LOG:-/tmp/dsh-web.log}"

echo "[1/3] build dsh-qq-bridge..."
if [[ "${1:-}" != "--no-build" ]]; then
  (cd "$HERE" && npm run build)
fi

echo "[2/3] stop current DSH web host..."
pkill -f "apps/cli/src/bin.ts web" || true
sleep 1

echo "[3/3] start DSH web host..."
(cd "$DSH_CHECKOUT" && nohup node --import tsx/esm apps/cli/src/bin.ts web > "$WEB_LOG" 2>&1 &)
sleep 2

echo "done. host log: $WEB_LOG"
echo "插件已挂载;从主号发 /dsh <问题> 验证。"
