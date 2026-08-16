# 本机部署:WSL2 上开启 NapCat 并登录 QQ

> 适用:**当前这台机器**(Linux/WSL2 Ubuntu 24.04, x86_64, 无 Docker)。
> 目标:装好 NapCat → 用手机 QQ 扫码登录**专用小号** → 开启正向 WebSocket → 让 `dsh-qq-bridge` 插件连上。
> 前置:你在这个机器的 **shell 里有 `sudo`**,并能操作一个**交互终端**(登录要扫码)。

## ⚠️ 为什么这些命令要你在自己的终端跑,而不是让 agent 代跑

`dsh-qq-bridge` 的开发环境是受限沙箱:
- `$HOME` 只读,装不进 `~/Napcat`;
- `sudo` 被禁用(`no new privileges`),而安装脚本硬依赖 sudo 装系统依赖和 TUI-CLI。

所以**安装和登录都必须在你的 WSL2 用户 shell 里进行**。以下是完整流程。

---

## 第 1 步:安装 NapCat(一次性,约几分钟,需 sudo)

在 WSL2 终端执行:

```bash
cd ~
curl -o napcat.sh https://raw.githubusercontent.com/NapNeko/NapCat-Installer/main/script/install.sh
bash napcat.sh --docker n --cli y
```

参数:
- `--docker n` → 原生直装(不装 Docker,适用本机)。
- `--cli y` → 安装 TUI-CLI(无图形界面的命令行管理工具,用于**开启正向 WS** 和**查看登录二维码**)。

脚本会在过程中:
1. 用 `sudo apt-get` 安装 QQ 运行所需的系统依赖(`xvfb screen jq libnss3 libgbm1` 等)。
2. 下载官方 QQ Linux 客户端 + NapCat,解压注入到 `~/Napcat/`。
3. 在 `~/Napcat/opt/QQ/resources/app/app_launcher/napcat/` 落下 NapCat 本体。

> 若脚本中途问是否安装依赖 / 需要确认,选 **yes**。若脚本因网络慢而失败,可加 `--proxy 1` 走国内镜像重试。

安装完成后,优先使用 `napcat` 管理命令启动和查看日志。不要直接运行 `nc`:在 Debian/Ubuntu 中 `nc` 通常是 OpenBSD netcat,不是 NapCat。

---

## 第 2 步:启动 NapCat 并手机扫码登录

**保持你的终端,执行:**

```bash
napcat start <机器人小号QQ>
napcat log <机器人小号QQ>
```

启动后,**终端会打印一个 QR 登录二维码**。此时:
1. 用你的**手机 QQ**(用**专用机器人小号**，不要用主号)右上角「扫一扫」扫这个码。
2. 手机上确认登录。
3. 终端提示登录成功后,QQ 小号即上线,NapCat 开始工作。

如果 `napcat: command not found`,重新打开一个终端再试;仍不行就查看安装器最后输出的实际启动路径。若你运行 `nc` 看到 `OpenBSD netcat (Debian patchlevel ...)`,说明调用到的是系统 netcat,不是 NapCat。

> ⚠️ 如果你不想让登录状态在每次重启后丢失,可在登录成功后**启用「快速登录」或固定 pad 票据**;否则每次重启可能要重新扫码。

---

## 第 3 步:进入 WebUI 并开启 OneBot 正向 WebSocket(端口 3001)

先打开 NapCat WebUI。默认地址通常是:

```text
http://127.0.0.1:6099
```

WSL2 本机部署时,也可以在 Windows 浏览器里打开:

```text
http://localhost:6099
```

WebUI 登录 token 通常会打印在 NapCat 日志中:

```bash
napcat log <机器人小号QQ>
```

也可以尝试读取配置文件:

```bash
cat ~/Napcat/config/webui.json
```

进入 WebUI 后,开启**正向 WebSocket(Forward WebSocket)**,设置为:

```text
监听端口: 3001
```
(若开启 token,记下来,后面插件配置里要填一致的值。)

保存后确认:**`ws://127.0.0.1:3001` 可连**。

---

## 第 4 步:对接 dsh-qq-bridge 插件

在本机运行本项目(独立入口,无 DSH 回显模式验证链路):

```bash
cd /home/liangyihao/temp/dsh-qq-bridge
npm run build
DSH_QQ_WS_URL=ws://127.0.0.1:3001 DSH_QQ_ADMIN=<你的主号QQ> npm start
```

看到日志:
```
[dsh-qq-bridge] 已连接 ws://127.0.0.1:3001 ...
```
即插件已连上 NapCat。

然后从**你的主号 QQ** 给**机器人小号**发:

```
/dsh ping
```

- 小号能收到并作出回应 → 上行 OK。
- 插件能把回应发回主号 → 下行 OK = **M5 真机验证通过**。

> 若日志提示连不上:检查 NapCat 是否仍在运行、端口是否 3001、token 是否一致。

### ✅ 实机已验证状态(本机)

在本机已完成并通过:

- 扫描登录小号成功(登录号 `<机器人小号QQ>`,NapCat WebUI 在 `http://localhost:6099`,token 见 `config/webui.json`)。
- 正向 WS 已配:端口 **3001**,服务名「DSH-QQ-Bridge」,已设访问 token(必须由插件通过 `Authorization: Bearer <token>` 携带,否则握手返回 `retcode 1403 token验证失败`)。
- 插件连接、鉴权、API 往返均验证通过(`get_login_info` 返回正确 user_id)。
- 端到端已通:主号 `<你的主号QQ>` 发 `/dsh ping`,机器人小号回发 `echo: ping`。

> ⚠️ **安全提醒**:本机 NapCat 的 WS token 与 WebUI token 属敏感凭证,不要提交进 Git。正式对外使用时建议在 WebUI 轮换并改用环境变量注入。

### 🛠 日常运维命令

本机 NapCat 由官方控制脚本 `napcat` 管理(安装时随 TUI-CLI 落地到 `/usr/local/bin`):

```bash
# 启动 / 状态 / 查看日志(登录二维码与登录成功会在这里打印)
napcat start <机器人小号QQ>
napcat status <机器人小号QQ>
napcat log <机器人小号QQ>            # tail -f 等
# 停止 / 重启 / 开机自启
napcat stop <机器人小号QQ>
napcat restart <机器人小号QQ>
napcat startup <机器人小号QQ>
```

- **小号掉线恢复**:若 NapCat 进程停止(`napcat status` 显示无服务),先 `napcat start <QQ号>` 拉起;若需重新扫码,看 `napcat log` 里的二维码,用手机 QQ 扫。
- **插件与 DSH Host**:插件是以 Cordis 插件形式挂在 DSH Host 的 web profile(`~/.dsh/profiles/web/cordis.patch.yml`,`name` 指向本仓库 `dist/index.js`)。
- **自动重连**:`WsTransport` 现已内置断线自动重连(指数退避)。因此 **NapCat 掉线/重启后无需重启 DSH Host**,插件会自动恢复。
- **改插件代码的热更新**:已在 `cordis.patch.yml` 重新启用模块级 HMR 并 watch 插件目录(`root: [dsh-qq-bridge 路径]`)。此后:
  ```bash
  # 改完源码只需 build,不用重启 host:
  cd /home/liangyihao/temp/dsh-qq-bridge && npm run build
  # HMR 检测到 dist/index.js 变化后自动热重载插件
  ```
- **一键重启(兜底)**:若 HMR 未生效或需要完全干净重启:
  ```bash
  bash /home/liangyihao/temp/dsh-qq-bridge/scripts/restart-dsh.sh   # build + 重启 host
  bash /home/liangyihao/temp/dsh-qq-bridge/scripts/restart-dsh.sh --no-build  # 仅重启
  ```

### ✅ 真实 DSH Agent 驱动(全链路)

插件通过 `ctx.agentLoop.createAgent(...)` + `ctx.sessionQuery.readSurface()` 接入真实 DSH Agent:
- 每 QQ 会话持有一个常驻 live agent(多轮上下文)。
- 从主号发 `/dsh <问题>`,机器人小号回发**由真实 DSH Agent 生成的智能回复**(而非 `echo:` 回显)。

---

## 第 5 步(可选):做成常驻服务

本机是长期运行主机,可用 `systemd`(WSL2 需 `systemd=true` 的较新版本)或 `tmux/screen` 让它挂后台:

```bash
# 用 tmux 保活(简单)
tmux new -s napcat
# 在 tmux 里运行 napcat start/log 或安装器提示的启动脚本,然后 Ctrl+b d 脱离
```

这样即使关掉 SSH/WSL 窗口,NapCat 也会继续跑。

---

## 常见问题

| 症状 | 处理 |
|------|------|
| 装依赖要 sudo | 你已在 WSL2 用户 shell,输入你的密码即可 |
| 扫码后提示登录失败/风控 | 用专用小号、开启设备锁;官方客户端风控属正常现象 |
| WebUI 打不开 | 先 `napcat status <QQ号>` / `napcat start <QQ号>` / `napcat log <QQ号>`,确认日志里的 WebUI 端口 |
| 端口占满 | 换一个端口并在插件 `wsUrl` 里同步 |
| 控制台没二维码 | 确认用的是交互终端,且启动了正确进程 |
