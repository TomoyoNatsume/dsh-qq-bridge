#!/usr/bin/env bash
# Start dsh-qq-bridge in local echo mode.
#
# This script is for first-run verification after NapCat is already logged in
# and its OneBot forward WebSocket is enabled.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WS_URL="${DSH_QQ_WS_URL:-ws://127.0.0.1:3001}"
ADMIN_QQ="${DSH_QQ_ADMIN:-}"
TOKEN="${DSH_QQ_TOKEN:-}"
PREFIX="${DSH_QQ_PREFIX:-/dsh}"

usage() {
  cat <<'EOF'
Usage:
  DSH_QQ_ADMIN=<your-main-qq> [DSH_QQ_WS_URL=ws://127.0.0.1:3001] [DSH_QQ_TOKEN=...] bash scripts/start-local-echo.sh

Example:
  DSH_QQ_ADMIN=10001 bash scripts/start-local-echo.sh

Then send this from your main QQ to the NapCat bot account:
  /dsh ping
EOF
}

if [[ -z "$ADMIN_QQ" ]]; then
  echo "error: DSH_QQ_ADMIN is required."
  echo
  usage
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is not installed. Please install Node.js 20+ first."
  exit 2
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is not installed. Please install npm first."
  exit 2
fi

if [[ ! -d node_modules ]]; then
  echo "[1/3] installing dependencies..."
  npm install --cache ./.npm-cache
else
  echo "[1/3] dependencies already installed."
fi

echo "[2/3] building..."
npm run build

echo "[3/3] starting local echo bridge..."
echo "  wsUrl:  $WS_URL"
echo "  admin:  $ADMIN_QQ"
echo "  prefix: $PREFIX"
if [[ -n "$TOKEN" ]]; then
  echo "  token:  set"
else
  echo "  token:  empty"
fi
echo
echo "Send \"${PREFIX} ping\" from your main QQ to the NapCat bot account."
echo "Expected reply in echo mode: echo: ping"
echo

exec npm start
