# dsh-qq-bridge · QQ Remote Control for DSH

<p align="center">
  <img src="https://img.shields.io/badge/DSH-plugin-blue?style=flat-square" alt="DSH Plugin">
  &nbsp;
  <img src="https://img.shields.io/badge/QQ-NapCat%20%2F%20OneBot-12b7f5?style=flat-square" alt="NapCat OneBot">
  &nbsp;
  <img src="https://img.shields.io/badge/QQ%20Bot-Official-00a870?style=flat-square" alt="QQ Official Bot">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>


<div align="center">

[是什么](#是什么) · [功能](#功能) · [快速开始](#快速开始) · [配置](#配置) · [安全](#安全) · [停止服务](#停止服务) · [常见问题](#常见问题) · [许可与致谢](#许可与致谢)

</div>

<div align="center">

<h2><span style="color:#16a34a;">想随时随地操控鲸鱼娘帮你干活？</span></h2>
<h2><span style="color:#2563eb;">把任务丢给鲸鱼娘就转头刷手机忘记盯进度？</span></h2>

<strong>把 DSH 绑定到 QQ：出门在外也能发任务，Web 对话完成后立刻提醒刷手机的你。</strong>
<strong>无需开放外部端口，无需配置公网地址~ 零安全风险~</strong>

<br>

<sub>QQ 远程控制 · Agent 回复提醒 · NapCat / 官方 QQ Bot 双路径</sub>

</div>

## 是什么

- 控制鲸鱼娘：

<p align="center">
  <img src="docs/asset/test0.jpg" alt="控制鲸鱼娘" width="760">
</p>

- web 会话完成提醒：

<p align="center">
  <img src="docs/asset/AgentReply.jpg" alt="会话完成提醒" width="760">
</p>

dsh-qq-bridge 是一个 DeepSeek Harness（DSH）Web profile 插件，用来把 QQ 消息转成 DSH Agent 会话请求，再把 Agent 回复发回 QQ。最常用的链路是：

```text
QQ 发送消息 -> NapCat / OneBot -> dsh-qq-bridge -> DSH Agent -> QQ 回复
```

默认推荐走 **NapCat / OneBot**：用一个 QQ 号登录 NapCat，然后从手机 QQ 给自己发消息，不需要额外准备机器人小号。也支持双号模式：一个 QQ 登录 NapCat，另一个 QQ 负责发指令。

如果不想使用 NapCat，也可以选择 **腾讯官方 QQ 开放平台机器人**。官方模式不需要扫码登录 NapCat，但需要在 QQ 开放平台创建机器人，并提供 AppID、AppSecret，再通过一次性 `pair <code>` 配对写入管理员 openid。

当前不支持通过 QQ 的“我的电脑”会话完整交互；这类消息可以被日志捕获，但回复会回到当前 QQ 自身，链路不完整。项目背景和架构说明见 [docs/project-overview.md](docs/project-overview.md)，使用导图见 [docs/usage-guide.html](docs/usage-guide.html)。

## 功能

### QQ 遥控 DSH Agent

在 QQ 里直接发送消息即可触发 DSH：

```text
当前工作目录是什么
列出当前目录下的文件
/dir /home/xxx/project
帮我把工作目录改到 /home/xxx/project
```

插件会先发送确认消息，随后把 Agent 的最终回复发回 QQ。默认前缀为空，白名单用户的所有消息都会进入 Agent；可在 `access.commandPrefix` 中改回 `/dsh`、`/ai` 等前缀。`/dir <目录>` 是内置控制命令，用来切换当前 QQ 会话的工作区，目录存在时下一条消息会使用新的 Agent session，并通过 DSH workspaceRegistry 归类到 Web UI 对应工作区。

如果你用自然语言要求 Agent 切换工作目录，QQ 专用 preset 会让 Agent 输出私有控制块；插件会拦截并执行 `set_cwd`，不会把控制块内容发回 QQ。后续切换效果与 `/dir <目录>` 一致。

内置控制命令会优先于 Agent 消息处理。后续新增 `/xxx` 指令时，只需要注册新的 handler 并放在 Agent fallback 前面；命中后会独占消费，不会把控制命令误发给 Agent。

### NapCat / OneBot 默认路径

NapCat 路径适合个人本机使用。setup 会检查 `napcat` 命令、启动状态和登录日志，自动配置 OneBot 正向 WebSocket 到 `127.0.0.1:3001`，并创建或复用 OneBot access token。

支持两种用法：

- 双号模式：一个QQ号登录DSH，监听消息，另一个QQ号给DSH发送指令，推荐新用户直接用这个。

> 双号模式下，登陆DSH的账号不建议用*不常用小号*，因为不常用的号登陆可能会被腾讯服务端kill掉~

- 单号模式：同一个 QQ 登录 NapCat，并从手机 QQ 给自己发消息。

> 单号模式下，可以收到`Agent完成自动提醒`，但可能无法收到消息提示哦~

### 腾讯官方 QQ Bot 可选路径

官方路径适合想用开放平台机器人账号的用户。setup 会提示你先到 [QQ 开放平台机器人控制台](https://q.qq.com/qqbot/dashboard/) 创建机器人，然后输入 AppID、AppSecret 和沙箱开关。

>由于腾讯开放平台规则限制，当前插件若走QQ Bot路径，则不支持`Agent完成自动提醒`功能

第一次配置时不需要手动找 `adminOpenId`：setup 会临时连接 QQBot 网关，生成一次性 `pair <code>`，你用管理员 QQ 发给机器人后，插件会自动读取 sender openid、回复“配对成功”，并写入 `official.adminOpenId`。

> 官方 QQ Bot 的主动提醒有额度限制。插件在官方模式下默认关闭 `notifications.agentReply.enabled`，避免触发 `40034122` / `召回消息已达区间上限`。

### setup 自动写入 profile

配置入口是：

```bash
pnpm exec dsh-qq-bridge setup
```

向导会写入 `~/.dsh/profiles/web/cordis.patch.yml`，只增改 `insert` 下的 `id: dsh-qq-bridge`。如果你选择更新 DSH 默认权限，它还会写入 `~/.dsh/settings.yaml` 的 `permission.defaultPreset`。

写入前的文件会覆盖备份到插件目录：

```text
backups/cordis.patch.yml.bak
backups/settings.yaml.bak
```

每次 setup 只保留最新一份备份。

### 后台启动与管理 dsh web

setup 可以帮你后台启动 DSH web。如果 `http://127.0.0.1:3080` 已经可访问，会跳过启动，避免重复起服务。

后台管理命令：

```bash
dsh-qq-bridge web status
dsh-qq-bridge web logs
dsh-qq-bridge web stop
```

pid 文件在 `/tmp/dsh-qq-bridge-dsh-web.pid`，日志在 `/tmp/dsh-qq-bridge-dsh-web.log`。

## 快速开始

> 当前自动安装向导只适配 Linux / WSL2 环境；原生 Windows 暂未适配。Windows 用户建议先在 WSL2 中使用。

### 系统要求

- 已安装 DSH / DeepSeek Harness，且 `dsh web` 可正常启动。
- DeepSeek API Key 已按 DSH 自身方式配置好。
- Node.js 20+。
- Linux / WSL2 环境。
- 选择 NapCat 路径时，需要一个可扫码登录的 QQ 号。
- 选择官方 QQ Bot 路径时，需要 QQ 开放平台机器人 AppID 和 AppSecret。

### 三步上手

1. 安装插件：

   ```bash
   pnpm dsh plugin --profile web add github:TomoyoNatsume/dsh-qq-bridge
   ```

> 过程中涉及到额外配置，新手建议安装插件后把插件提给你的AI，让他指导操作。

2. 进入 web profile 并运行 setup：

   ```bash
   cd ~/.dsh/profiles/web
   pnpm exec dsh-qq-bridge setup
   ```
> 注意setup过程中对于`Napcat/QQ bot`两种路径分别需要外部操作。请根据setup提示或者agent

3. 重启或启动 `dsh web`，在 QQ 里发送：

   ```text
   ping
   ```

### NapCat 安装

选择 NapCat 路径前，本机需要有 `napcat` 命令。Linux / WSL2 推荐：

```bash
cd ~
curl -o napcat.sh https://raw.githubusercontent.com/NapNeko/NapCat-Installer/main/script/install.sh
bash napcat.sh --docker n --cli y
```

安装后确认命令可用：

```bash
napcat help
```

NapCat 扫码登录时请打开 setup 打印的日志。日志里可能有多个二维码，请拉到最后一个二维码扫码；如果二维码过期，在 setup 里选择“二维码过期”，它会重启 NapCat 生成新的登录请求。

### setup 会做什么

<p align="center">
  <img src="docs/asset/test2.png" alt="setup 交互式向导截图" width="760">
</p>

setup 会按你选择的接入方式完成配置：

- 选择 `NapCat / OneBot` 或 `腾讯官方 QQ Bot`。
- NapCat 路径会校验 QQ 号、DSH 项目目录、NapCat 根目录、模型、单号/双号模式。
- NapCat 路径会检查 `napcat status <QQ>`，未启动时自动执行 `napcat start <QQ>`。
- NapCat 路径会配置 OneBot 正向 WebSocket：`127.0.0.1:3001`。
- 官方 QQ Bot 路径会要求先创建机器人，输入 AppID、AppSecret、沙箱开关，并通过 `pair <code>` 自动配置 `adminOpenId`。
- 可选更新 `~/.dsh/settings.yaml` 的 `permission.defaultPreset`。
- 可选后台启动 DSH web。

setup 或手动修改 `cordis.patch.yml` 后，需要重启 `dsh web` 才会加载新配置。只有修改本项目 `src/` 源码时，才需要重新执行 `npm run build`。

### 验证

从手机 QQ 发送：

```text
ping
```

成功后再试：

```text
当前工作目录是什么
列出当前工作目录下的目录和文件
/dir /home/xxx/project
帮我把工作目录改到 /home/xxx/project
```

如果是自己前台启动的 DSH web，启动成功后会看到类似界面：

<p align="center">
  <img src="docs/asset/test0.png" alt="DSH 启动成功截图" width="760">
</p>

## 配置

正式使用时主要改这个文件：

```text
~/.dsh/profiles/web/cordis.patch.yml
```

改完后重启 `dsh web`。重启 DSH web 时不需要再导出 `DSH_QQ_TOKEN` 或 `DSH_PERMISSION_MODE`；setup 已经把必要配置写入本机 profile。

### 选择 QQ 接入方式

默认是 NapCat / OneBot：

```yaml
platform: napcat
napcat:
  wsUrl: ws://127.0.0.1:3001
  token: "<NapCat OneBot access token>"
```

切到腾讯官方 QQ Bot 时，推荐重新运行 setup。手动配置示例：

```yaml
platform: official
official:
  appId: "<QQ 开放平台 AppID>"
  appSecret: "<QQ 开放平台 AppSecret>"
  adminOpenId: "<管理员 openid>"
  allowlistOpenIds: []
  sandbox: false
access:
  adminQq: 0
  allowlist: []
  commandPrefix: ""
  mode: whitelist
notifications:
  agentReply:
    enabled: false
```

`adminOpenId` 是“你的 QQ 用户在这个机器人应用下的 openid”，不是 QQ 号，也不是 AppID。第一次不知道它时，用 setup 自动配对最稳。

### 更改模型

修改 `agent.provider` 和 `agent.model`：

```yaml
agent:
  provider: deepseek-official
  model: deepseek-v4-pro
  cwd: /home/xxx
  preset: dsh-qq-bridge
  ackMessage: 收到，正在处理...
  timeoutMs: 120000
  timeoutMessage: agent 无响应，请稍后重试。
```

- `provider`：DSH 里已配置好的模型提供方。
- `model`：该 provider 下的模型 id。
- `cwd`：QQ Agent 默认工作目录。setup 会询问该目录，默认是 `~`；`/dir <目录>` 会覆盖当前 QQ 会话的后续 session 目录。
- `preset`：QQ 会话使用的 DSH agent preset。setup 会安装 `dsh-qq-bridge` 专用 preset；普通 Web 会话不选它就不会看到 QQ 回复风格 skill。

### 更改确认消息和超时

收到有效 QQ 指令后，插件会先回复 `agent.ackMessage`。设为空字符串 `""` 可以关闭确认消息：

```yaml
agent:
  ackMessage: 收到，正在处理...
  timeoutMs: 120000
  timeoutMessage: agent 无响应，请稍后重试。
```

`timeoutMs` 是等待 Agent 的最长时间，单位毫秒；超时后回复 `timeoutMessage`。

### QQ 回复风格 Skill

setup 会同步一个 QQ 专用 preset 到：

```text
~/.dsh/.agent-presets/dsh-qq-bridge
```

这个 preset 挂载随附的回复风格 skill：

```text
~/.dsh/.agent-presets/dsh-qq-bridge/skills/qq-session-reply-style/SKILL.md
~/.dsh/.agent-presets/dsh-qq-bridge/skills/qq-session-reply-style/references/reply-style.md
```

默认规则：

- 先给结论。
- 回复尽量简明扼要。
- 不用 Markdown 风格，用纯文本，可以多用 emoji。

插件只会在 QQ 会话的第 1、30、60... 个 Agent 回合主动发送 `/qq-session-reply-style`，让 DSH 的 skill 工具加载入口文件并按模块读取回复风格；其它 QQ 回合只附加一句很短的临时风格标记，避免每轮塞入大段 prompt。

如果你要改 QQ 回复风格，优先改上面的 `references/reply-style.md`；`SKILL.md` 只作为入口和模块索引。注意保留“只适用于 dsh-qq-bridge QQ 会话、不要写入记忆、不要影响普通 DSH Web 会话”的限制。

如果不想要 QQ 专属回复风格，改成：

```yaml
agent:
  qqReplyStyleSkill:
    enabled: false
```

### 更改指令前缀

修改 `access.commandPrefix`：

```yaml
access:
  commandPrefix: /dsh
```

例如改成 `/ai` 后，QQ 里就要发送：

```text
/ai ping
```

### 更改允许使用的人

NapCat 模式使用 QQ 号鉴权。只允许自己使用：

```yaml
access:
  adminQq: <你的QQ号>
  allowlist: []
  mode: whitelist
```

允许额外 QQ：

```yaml
access:
  adminQq: <你的QQ号>
  allowlist: [10001, 10002]
  mode: whitelist
```

官方 QQ Bot 模式使用 openid 鉴权：

```yaml
platform: official
official:
  adminOpenId: "<管理员 openid>"
  allowlistOpenIds: ["<允许的用户 openid>"]
access:
  adminQq: 0
  allowlist: []
  mode: whitelist
```

不建议把 `mode` 改成 `open`，除非你明确知道风险。

### 单号模式日志

单号模式会读取 NapCat 日志，把“自己给自己”的消息转成内部消息：

```yaml
selfLogInput:
  enabled: true
  logPath: /home/<你的Linux用户名>/Napcat/log/napcat_<你的QQ号>.log
  pollIntervalMs: 1000
  replayOnStart: false
```

如果你是“主号发给机器人小号”，通常可以关闭：

```yaml
selfLogInput:
  enabled: false
```

### Agent 回复提醒

`notifications.agentReply.enabled` 控制“非 QQ 会话中 Agent 完成一轮回复后，主动给管理员发提醒”：

```yaml
notifications:
  agentReply:
    enabled: true
```

NapCat 模式默认开启；官方 QQ Bot 模式默认关闭。QQ 自身发起的对话不会再额外发送“主人，您收到一条 Agent 回复...”提醒，只保留实际 Agent 回复。

### DSH 默认权限

setup 可选修改 `~/.dsh/settings.yaml`：

```yaml
permission:
  defaultPreset: workspace-write
```

可选项：

- `workspace-write`：较安全。Agent 只能写工作区和允许的临时目录，越权操作需要网页端审批。
- `danger-full-access`：最省心但风险最高。Agent 可直接访问本机进程权限能访问的路径，且不会弹出审批。
- 保持现有 settings：setup 不修改 DSH 全局默认权限。

这个默认值只影响之后新建的 Web 会话，不改变已经打开的会话。

### 本地回显测试

只想测试 QQ 链路、不接 DSH Agent 时，可以用本地回显模式：

```bash
DSH_QQ_ADMIN=<你的QQ号> \
DSH_QQ_TOKEN=<NapCat OneBot access token> \
DSH_QQ_SELF_LOG=true \
bash scripts/start-local-echo.sh
```

发送 `ping`，预期回复：

```text
echo: ping
```

正式使用 `pnpm dsh web` 时，以 `cordis.patch.yml` 为准，不需要这些环境变量。

## 安全

这个项目的定位是“私用 QQ 遥控自己的 DSH”，默认按本机私有服务来设计。建议保持下面几条。

### 保持白名单

默认 `mode: whitelist`，只允许 `adminQq` / `allowlist`，或官方模式下的 `adminOpenId` / `allowlistOpenIds` 触发。`mode: open` 表示任何能给这个 QQ 或机器人发消息的人都可能触发 DSH，只适合临时调试。

### 指令入口

默认 `commandPrefix: ""`，白名单用户的普通消息会直接进入 DSH。设置为 `/dsh`、`/ai` 等非空值后，只有以该前缀开头的消息才会进入 DSH。`/dir <目录>` 是内置工作区切换命令，默认空前缀时可直接发送。

### OneBot 只监听本机

NapCat 正向 WebSocket 推荐：

```text
监听地址: 127.0.0.1
端口: 3001
access token: <随机 token>
```

不要把 NapCat OneBot WS 监听地址改成 `0.0.0.0` 或公网 IP，除非你已经准备好防火墙、内网/VPN 隔离和强 token。

### 不提交本机凭据

不要把 `~/.dsh/profiles/web/cordis.patch.yml`、QQ 凭据、NapCat WebUI token、OneBot access token、QQ 开放平台 AppSecret、DeepSeek API Key 提交到仓库或公开日志。

### shell handler 默认关闭

配置示例里保持：

```yaml
shell:
  enabled: false
```

QQ 消息默认不会直接执行 shell 命令。即使之后扩展 shell 能力，也应继续保持白名单、强指令前缀和 DSH 自身权限控制。

### 单号模式不回放历史日志

单号模式默认：

```yaml
selfLogInput:
  replayOnStart: false
```

这能避免 DSH 重启时把历史消息重新执行一遍。

## 停止服务

如果是前台运行的 `pnpm dsh web`，在终端按：

```text
Ctrl+C
```

如果是 setup 后台启动的 DSH web：

```bash
dsh-qq-bridge web status
dsh-qq-bridge web logs
dsh-qq-bridge web stop
```

如果只想停 QQ 机器人能力，也可以在 DSH Web 的插件管理里禁用 `dsh-qq-bridge`，然后重启 `dsh web`。

## 常见问题

### QQ 消息没回复

NapCat 模式先看日志：

```bash
napcat log <你的QQ号>
```

重点检查：

- NapCat 是否还在线。
- 正向 WebSocket 是否开启，端口是否是 `3001`。
- `~/.dsh/profiles/web/cordis.patch.yml` 里的 `napcat.token` 是否等于 OneBot access token。
- 如果你设置了非空 `commandPrefix`，消息是否以该前缀开头。
- `adminQq` 是否填的是发消息的 QQ。
- 单号模式下 `selfLogInput.logPath` 是否正确。

官方 QQ Bot 模式重点检查：

- `platform` 是否为 `official`。
- `official.appId` / `official.appSecret` 是否来自同一个机器人应用。
- 沙箱测试时 `official.sandbox` 是否为 `true`，正式环境是否为 `false`。
- `official.adminOpenId` 是否是给这个机器人发消息的用户 openid。
- `access.mode` 是否已经从临时 `open` 改回 `whitelist`。

### 发送后一直无回复

如果 DSH 卡在工具审批，通常是当前会话正在等待网页端确认。可以在 DSH Web 页面手动批准当前工具调用，或调整当前会话权限。修改 `~/.dsh/settings.yaml` 后，需要重启 `dsh web` 并新建/刷新 Web 会话，新的默认权限才会生效。

### 官方 QQ Bot 日志出现 40034122

`40034122` / `召回消息已达区间上限` 通常是官方主动提醒额度耗尽。保持：

```yaml
notifications:
  agentReply:
    enabled: false
```

这不代表正常对话回复失败。

### 返回 `<tool_calls>` 或 DSML 文本

通常是模型/工具调用模式不匹配，或插件版本不是最新构建。先执行：

```bash
npm run build
```

然后重启 DSH。推荐使用已验证过的 `deepseek-v4-pro` 配置。

### 临时调试时想用一次性 patch 启动

正式使用建议通过 setup 写入 `~/.dsh/profiles/web/cordis.patch.yml` 后执行 `pnpm dsh web`。临时调试时，也可以把一次性 patch 写到 `/tmp/dsh-qq-bridge-agent.patch.yml`，并在 patch 里写入 `napcat.token`，然后从 DSH 项目目录执行：

```bash
pnpm dsh web --patch /tmp/dsh-qq-bridge-agent.patch.yml
```

后台运行并写日志：

```bash
pnpm dsh web --patch /tmp/dsh-qq-bridge-agent.patch.yml \
  > /tmp/dsh-qq-agent.log 2>&1 &
```

## 许可与致谢

本项目使用 MIT License 发布，见 [LICENSE](LICENSE)。第三方依赖、协议与外部项目说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目会连接或参考以下项目/协议：

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)：提供 QQ / OneBot 运行端点。本项目不打包、不修改、不再分发 NapCatQQ，只要求用户自行安装并运行。
- 腾讯 QQ 开放平台：提供可选的官方机器人运行端点；本项目通过 `@tencent-connect/qqbot-nodejs` 连接。
- [OneBot](https://github.com/botuniverse/onebot)：聊天机器人接口标准，本项目通过 OneBot WebSocket 协议与 NapCat 通信。
- [DeepSeek Harness / DSH](https://github.com/deepseek-ai/deepseek-harness)：本插件运行所在的 Host / Agent 环境。
- `ws`、`zod` 等 npm 依赖：详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
