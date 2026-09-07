#!/usr/bin/env bash

set -euo pipefail

readonly REGISTRY_REPOSITORY='mlikiowa/napcat-docker'
readonly QQ_LAYER='6f2083899dc30ea70bae6b9c3997933c62e047712a6e3b08c2db152454618f20'
readonly NAPCAT_LAYER='b1baa3746fdc48d256aad190d7b4ec5ed6012f9c04b07e878eff0e40011bb6e8'
readonly NAPCAT_ZIP_SHA256='700163fc159ef1a96932720152bc5b44eed5b76bdcee7282f98365fb5e82fdd4'
readonly EXPECTED_QQ_VERSION='3.2.21-42086'
readonly EXPECTED_NAPCAT_VERSION='4.15.19'

for command_name in curl jq tar unzip sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少命令：$command_name" >&2
    echo '请先完成 README 中的普通 NapCat 安装，再运行本修复脚本。' >&2
    exit 1
  fi
done

case "$(uname -m)" in
  x86_64 | amd64) ;;
  *)
    echo '当前固定版本修复脚本只验证过 Linux x86_64。' >&2
    exit 1
    ;;
esac

if ! command -v napcat >/dev/null 2>&1; then
  echo '未找到 napcat CLI。请先按 README 的默认方式安装 NapCat。' >&2
  exit 1
fi

repair_work_dir="$(mktemp -d)"
trap 'rm -rf -- "$repair_work_dir"' EXIT
mkdir -p "$repair_work_dir/rootfs"

echo '正在获取固定版本下载凭据...'
registry_token="$({
  curl -fsSL \
    "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${REGISTRY_REPOSITORY}:pull"
} | jq -er '.token')"

download_layer() {
  local digest="$1"
  local target="$2"

  curl -fL \
    -H "Authorization: Bearer $registry_token" \
    "https://registry-1.docker.io/v2/${REGISTRY_REPOSITORY}/blobs/sha256:${digest}" \
    -o "$target"
  printf '%s  %s\n' "$digest" "$target" | sha256sum -c -
}

echo "正在下载 QQ $EXPECTED_QQ_VERSION..."
download_layer "$QQ_LAYER" "$repair_work_dir/qq-layer.tar.gz"

echo "正在下载 NapCat $EXPECTED_NAPCAT_VERSION..."
download_layer "$NAPCAT_LAYER" "$repair_work_dir/napcat-layer.tar.gz"

tar -xzf "$repair_work_dir/qq-layer.tar.gz" \
  -C "$repair_work_dir/rootfs" opt/QQ
tar -xzf "$repair_work_dir/napcat-layer.tar.gz" \
  -C "$repair_work_dir/rootfs" app/NapCat.Shell.zip

printf '%s  %s\n' \
  "$NAPCAT_ZIP_SHA256" \
  "$repair_work_dir/rootfs/app/NapCat.Shell.zip" \
  | sha256sum -c -

qq_version="$(jq -er '.version' "$repair_work_dir/rootfs/opt/QQ/resources/app/package.json")"
if [[ "$qq_version" != "$EXPECTED_QQ_VERSION" ]]; then
  echo "QQ 版本校验失败：预期 $EXPECTED_QQ_VERSION，实际 $qq_version" >&2
  exit 1
fi

printf '\n将执行以下操作：\n'
printf '  1. 停止当前 NapCat 实例。\n'
printf '  2. 备份 ~/.config/QQ 和 ~/Napcat。\n'
printf '  3. 安装 QQ %s 与 NapCat %s。\n' "$EXPECTED_QQ_VERSION" "$EXPECTED_NAPCAT_VERSION"
printf '  4. 清空登录状态，安装后需要重新扫码。\n\n'
read -r -p '继续？[y/N] ' repair_confirm
if [[ ! "$repair_confirm" =~ ^[Yy]$ ]]; then
  echo '已取消，未修改现有安装。'
  exit 0
fi

napcat stop || true

repair_backup_dir="$HOME/dsh-qq-bridge-backup/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$repair_backup_dir"
if [[ -d "$HOME/.config/QQ" ]]; then
  mv "$HOME/.config/QQ" "$repair_backup_dir/QQ"
fi
if [[ -d "$HOME/Napcat" ]]; then
  mv "$HOME/Napcat" "$repair_backup_dir/Napcat"
fi

mkdir -p "$HOME/Napcat/opt"
cp -a "$repair_work_dir/rootfs/opt/QQ" "$HOME/Napcat/opt/QQ"

napcat_dir="$HOME/Napcat/opt/QQ/resources/app/app_launcher/napcat"
qq_package="$HOME/Napcat/opt/QQ/resources/app/package.json"
mkdir -p "$napcat_dir" "$HOME/Napcat/log" "$HOME/Napcat/run"
unzip -q "$repair_work_dir/rootfs/app/NapCat.Shell.zip" -d "$napcat_dir"

printf '%s\n' "(async () => {await import('file:///$napcat_dir/napcat.mjs');})();" \
  > "$HOME/Napcat/opt/QQ/resources/app/loadNapCat.js"
jq '.main = "./loadNapCat.js"' "$qq_package" > "$qq_package.tmp"
mv "$qq_package.tmp" "$qq_package"

installed_qq_version="$(jq -er '.version' "$qq_package")"
if ! grep -Fq -m1 "$EXPECTED_NAPCAT_VERSION" "$napcat_dir/napcat.mjs"; then
  echo 'NapCat 版本校验失败。旧安装仍保存在：' >&2
  echo "$repair_backup_dir" >&2
  exit 1
fi

printf '\n修复安装完成。\n'
printf 'QQ: %s\n' "$installed_qq_version"
printf 'NapCat: %s\n' "$EXPECTED_NAPCAT_VERSION"
printf '旧文件备份：%s\n\n' "$repair_backup_dir"
printf '接下来运行：\n'
printf '  napcat start <你的QQ号>\n'
printf '  napcat log <你的QQ号>\n'
printf '扫码登录后运行：\n'
printf '  napcat status <你的QQ号>\n'
