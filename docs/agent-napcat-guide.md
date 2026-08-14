# 给 Agent 的 NapCat 安装向导

> 阅读对象:**AI Agent**(而非终端用户)。你可能正在 DSH 等环境中运行,用户希望让 QQ 接入,但本机尚未安装 NapCat。本文档指导你如何一步步引导用户完成部署,并在插件连接失败时给出正确的排查路径。
>
> 目标:把用户最终稳定在一个「插件可连的 onebot WS 端点」上。**插件本身不负责也不应该负责安装 NapCat。**

## 0. 你的角色定位

- 你**不需要**替用户安装 NapCat,但你应当**清晰引导**用户安装,并在用户遇到障碍时给出可操作的下一步。
- 记住安全原则:**绝不向用户索要 QQ 账号密码**。NapCat 登录统一走扫码。
- 插件 `dsh-qq-bridge` 只依赖一个 onebot WS 端点(`wsUrl`)。NapCat 只是实现该端点的一种方式。

## 0.1 先探测当前 DSH 运行所在的操作系统(必做)

**动手引导前,你必须先自行判断当前机器属于哪个平台,再据此采用对应的 NapCat 安装与说明。** 不要只给通用步骤,要按系统给出用户在该机器上真正能跑的动作。

探测方式(在 DSH 运行的那台机器上):
- 运行 `uname -s`(`Linux` / `Darwin`)或确认 `process.platform`(`win32` / `darwin` / `linux`)。
- 若在 DSH 会话内可直接读到宿主进程环境,直接使用该信号。

分平台要点(Agent 据此引导):

| 平台 | 关键说明(Agent 据此引导) |
|------|--------------------------|
| **Windows** | NapCat 以 `.exe` 可执行文件运行;注意 PowerShell / CMD 启动差异;日志与二维码多在**交互式终端窗口**输出,须提示用户保持窗口打开 |
| **Linux** | 常用于无头服务器;若**无图形界面**,二维码打印在终端或容器日志;按架构选 `linux-x64` 等构建;建议用 `screen`/`tmux` 或 Docker 保活 |
| **macOS** | 分 Apple Silicon(`darwin-arm64`)与 Intel(`darwin-x64`);可能触发 **Gatekeeper**,需引导用户右键「打开」以运行不受信任的应用 |

**通用做法:确认平台后即进入对应平台分支的具体安装引导,不要跳过平台判断直接让用户操作。**

## 1. 先判断插件连不上时的症状

如果插件报「无法连接 onebot WS」或启动日志出现连接失败,先做:

1. 检查配置里的 `wsUrl`(默认 `ws://127.0.0.1:3001`)。
2. 确认本机是否 **有 NapCat 在运行并用这个端口提供 onebot WS**。
3. 若没有 → 进入下面的安装引导;若有 → 可能是端口/地址配错或未开启正向 WS。

## 2. 询问用户:本机是否具备 Docker

在引导安装前,先问一个关键问题决定两条路线:

> 「你希望用 Docker 跑 NapCat,还是直接在本机原生运行?」

- **无 Docker / 更轻量** → 走 **[路线 A:本机原生直装](#路线a本机原生直装)**。
- **有 Docker 且想要隔离/更稳定** → 走 **[路线 B:Docker 运行](#路线bdocker运行)**。
- 用户不确定 → 默认推荐 **路线 A**(不引入 Docker 依赖,交付最轻)。

## 3. 路线 A:本机原生直装

### 3.1 下载
- 前往 NapCat 官方发布渠道获取:GitHub 仓库 **`NapNeko/NapCatQQ`** 的 Releases(latest)。
- **先按 0.1 节确认为当前 OS/架构选择的构建**(Windows / Linux-x64 / macOS-arm64 等),再让用户下载对应文件。
- ⚠️ **只从官方 GitHub 获取**,不要使用任何网络上的「一键包 / 收费商业版 / 站群版」——收费版通常是第三方打包,且可能夹带非开源内容。

### 3.1.1 Linux:一键安装命令(给用户的默认指令,默认带镜像下载)

对 **Linux**(含 WSL2 / 无头服务器)的官方一键安装,给用户默认以下命令。**默认加 GitHub 代理镜像**,避免直连 GitHub 下载大文件被中断。

```bash
curl -o napcat.sh https://raw.githubusercontent.com/NapNeko/NapCat-Installer/main/script/install.sh \
  && bash napcat.sh --docker n --cli y
```

- `--docker n` → Shell 直接安装(不用 Docker);`--cli y` → 装 TUI-CLI(便于命令行管理/看二维码)。
- 以下命令在`$HOME`等用户目录先手动下好完好的 `NapCat.Shell.zip`,让脚本跳过内置下载:

```bash
cd ~
wget -c -O NapCat.Shell.zip "https://gh-proxy.com/https://github.com/NapNeko/NapCatQQ/releases/latest/download/NapCat.Shell.zip"
```

> **镜像来源说明**:`gh-proxy.com`、`ghfast.top`、`gh-proxy.net` 等是常用的 GitHub 加速反代。若其中一个慢或失败,可换另一个;`wget -c` 支持断点续传。

**已知坑(务必提前提醒用户):** 直连 GitHub 下载 `NapCat.Shell.zip` 在国内网络下极易被中断,导致文件损坏,安装脚本报 **`[文件验证失败, 请检查错误]`**。此时:
1. 不要直接重跑脚本(脚本会沿用坏 zip)。
2. 手动用上面的镜像命令重新下载完整 zip,再在同一目录跑脚本,脚本会打印「检测到已下载NapCat安装包,跳过下载...」并越过该校验点。

若后续又报「QQ下载失败」,同样手动下 `QQ.deb` 到同目录(腾讯官方源,一般较稳):
```bash
wget -c -O QQ.deb "https://qqdl.gtimg.cn/qqfile/QQNT/9.9.32/beta/727ce4e5/linuxqq_3.2.30-50828_amd64.deb"
```

### 3.2 运行并登录
1. 解压并运行 NapCat 可执行文件。
2. 终端/窗口会出现**登录二维码**。
3. 让**用户用手机 QQ 扫描二维码**(即用那个专用机器人小号登录)。**不要索取或获取账号密码。**
4. 建议:使用**专用小号**,不要用主号;开启设备锁/登录保护,降低风控与封号风险。

### 3.3 启用 OneBot 正向 WS
1. 在 NapCat 的 WebUI 或配置文件中,启用 **正向 WebSocket(Forward WebSocket)**。
2. 记录端口(默认 `3001`)。
3. 可选:`token`。若开启,需与插件 `napcat.wsUrl` / `napcat.token` 配置一致。
4. 确认 NapCat 在该端口开始监听。

### 3.4 验证端点
- 让用户保持 NapCat 运行,把插件 `wsUrl` 指到 `ws://127.0.0.1:<端口>`(含 token 则填 `token`)。
- 重启插件,确认连接成功。

## 4. 路线 B:Docker 运行

若用户选择 Docker,提供以下两种引导之一(建议给用户一段 `docker run` 或 `docker-compose.yml`):

```bash
# 示例(以 NapCat 官方 Docker 镜像为准,NapNeko/NapCatQQ)
docker run -d --name napcat --restart always \
  -p 3001:3001 \
  -v napcat-config:/app/config \
  your/napcat-image
```

```yaml
# docker-compose.yml(示例)
services:
  napcat:
    image: your/napcat-image
    restart: always
    ports:
      - "3001:3001"
    volumes:
      - napcat-config:/app/config
```

- 用户扫码/登录逻辑与路线 A 相同(在容器日志里取二维码)。
- 缺点告知用户:会占用较多镜像体积(~数百 MB),且需本机有 Docker。

## 5. 登录安全与风控提醒(务必转达用户)

- 用**专用小号**,绝不使用主号。
- 开启**设备锁 / 登录保护**。
- **长期在线**:让承载 NapCat 的机器保持稳定联网,不要频繁关机。
- 说明风险:QQ 对非官方客户端有风控,可能封号/异常;这是社区方案的通病,不是插件 bug。

## 6. 连接成功后确认

当插件成功连上端点,可用一条 `/dsh ping`(或 `/help`)从用户主号发给机器人小号,验证:
- 机器人小号能否收到并回复 → 上行 OK
- 插件能否把回复发回主号 → 下行 OK

## 7. 常见失败排查表

| 症状 | 可能原因 | 指引 |
|------|---------|------|
| 连接拒绝/超时 | NapCat 未运行 / 端口不对 / 未监听该端口 | 确认运行中,核对 `wsUrl` 端口 |
| 安装报 文件验证失败 | `NapCat.Shell.zip` 直连 GitHub 下载损坏 | 手动用镜像+`wget -c` 重新下完整 zip 到同目录再重跑(见 3.1.1) |
| 安装报 QQ下载失败 | LinuxQQ 包下载失败 | 手动下 `QQ.deb` 到同目录后重跑(见 3.1.1) |
| 401 / token 错误 | token 不匹配 | 让用户核对 NapCat 与插件 `token` |
| 收到消息但插件无响应 | 没用指令前缀 / 白名单不含该 QQ | 检查 `commandPrefix` 与 `access.adminQq` |
| 机器人小号收不到主号消息 | 小号未在线 / 被拉黑 | 让用户确认小号在线 |

## 8. 总结给 Agent 的话术要点

当用户问你「NapCat 怎么装」时,你的回答应该:
1. **先自行探测当前机器系统**(`uname -s` / `process.platform`),按 Windows / Linux / macOS 走对应分支指引(见 0.1)。
2. 然后问**有没有 Docker**,决定路线 A/B。
2. 明确:**扫码登录,不要密码**。
3. 强调:**专用小号 + 设备锁**,风险自担警告。
4. 引导到官方 GitHub 下载,禁用收费打包。
5. 配置正向 WS,记下端口,让插件 `wsUrl` 对齐。
6. 用 `/dsh ping` 验证双向通。
