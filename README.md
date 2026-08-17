# dsh-qq-bridge

## 效果展示

<img src="docs/asset/test1.png" alt="QQ 验证成功截图" width="360">

从 clone 到 QQ 遥控 DSH 的最短流程。目标是:

```text
QQ 发送 /dsh ... -> NapCat -> dsh-qq-bridge -> DSH Agent -> QQ 回复
```

推荐先用**一个 QQ 号**登录 NapCat，然后从手机 QQ 给“我的电脑”或自己发送 `/dsh ...`。这样不需要准备机器人小号和主号两个账号。

项目背景和架构说明见 [`docs/project-overview.md`](docs/project-overview.md)。

## 0. 准备

- Node.js 20+ 和 npm。
- 一个 QQ 号，用手机扫码登录 NapCat。
- 已安装好的 DSH / DeepSeek Harness，且知道它的项目目录。
- DeepSeek API Key 已按 DSH 自身方式配置好。

> 您可以将本项目（本文件）交给agent，让Ta帮您完成大部分配置工作。您只需完成扫码登陆QQ、配置Napcat WebUI等工作，根据您的agent引导即可。

## 1. clone 并构建插件

```bash
git clone https://github.com/TomoyoNatsume/dsh-qq-bridge.git
cd dsh-qq-bridge
npm install
npm run build
```

## 2. 安装并登录 NapCat

Linux / WSL2 推荐:

```bash
cd ~
curl -o napcat.sh https://raw.githubusercontent.com/NapNeko/NapCat-Installer/main/script/install.sh
bash napcat.sh --docker n --cli y
```

启动并查看登录日志:

```bash
napcat start <你的QQ号>
napcat log <你的QQ号>
```

**用手机 QQ 扫日志里的二维码完成登录。**

>注意:不要运行 `nc`。在 Debian / Ubuntu 上，`nc` 通常是 OpenBSD netcat，不是 NapCat。

## 3. 进入 NapCat WebUI

WebUI 默认地址通常是:

```text
http://localhost:6099
```
>注意wsl用户不要用127.0.0.1，而要用localhost

如果打不开，以 NapCat 日志里打印的地址为准：

```bash
napcat log <你的QQ号>

# 或者直接查看log文件：
cat ~/Napcat/log/napcat_<你的QQ号>.log
```

日志里一般会出现类似:

```text
http://localhost:6099/webui?token=...
```

这里的 token 是 **WebUI 登录 token**，只用于打开 WebUI，不是后面插件用的 OneBot token。

## 4. 开启 OneBot 正向 WebSocket

在 NapCat WebUI 里开启:

```text
正向 WebSocket / Forward WebSocket
监听地址: 127.0.0.1
端口: 3001
access token: 使用默认分配的值; 或者自己设置一个，后面 DSH_QQ_TOKEN 要填同一个
```

保存后保持 NapCat 运行。

## 5. 配置 DSH web profile

把插件写入 DSH 的 `web` profile。默认配置文件是:

```text
~/.dsh/profiles/web/cordis.patch.yml
```

如果这个文件目前只有 `[]`，可以替换成下面内容；如果已经有别的配置，就把 `insert` 这一段合并进去(注意替换其中的qq号和log路径):

```yaml
- insert:
    - id: dsh-qq-bridge
      name: /path/to/dsh-qq-bridge/dist/index.js
      config:
        napcat:
          wsUrl: ws://127.0.0.1:3001
          token: !!js process.env.DSH_QQ_TOKEN
        access:
          adminQq: <你的QQ号>
          allowlist: []
          commandPrefix: /dsh
          mode: whitelist
        agent:
          provider: deepseek-official
          model: deepseek-v4-pro
          preset: standard
          streamReasoning: false
          maxMessageLength: 4500
        shell:
          enabled: false
        selfLogInput:
          enabled: true
          logPath: /home/<你的Linux用户名>/Napcat/log/napcat_<你的QQ号>.log
          pollIntervalMs: 1000
          replayOnStart: false
```

需要改的地方:

- `name`:改成你 clone 后的真实插件入口路径，例如 `/home/me/dsh-qq-bridge/dist/index.js`。
- `adminQq`:填你的 QQ 号。
- `logPath`:填你的 NapCat 日志路径。
- `model`:按你的 DSH 模型配置调整。

如果你不用“我的电脑/自己给自己发消息”，而是主号发给机器人小号，可以删除 `selfLogInput` 这一段，并把 `adminQq` 填主号 QQ。

## 6. 启动 DSH

**需要重启DSH服务。**切到 DSH / DeepSeek Harness 项目目录执行:

```bash
cd <你的 deepseek-harness 目录>

export DSH_QQ_TOKEN='<NapCat OneBot access token>'
export DSH_PERMISSION_MODE=danger-full-access

pnpm dsh web
```

`DSH_QQ_TOKEN` 填 WebUI 里正向 WebSocket 的 access token，不是 WebUI 登录链接里的 token。

`DSH_PERMISSION_MODE=danger-full-access` 会让 DSH Agent 直接执行本机工具调用，不再卡在审批流程。只建议在私用、白名单只放自己的情况下使用。

看到下面几行就表示启动成功:

```text
[dsh-qq-bridge] onebot ws connected: ws://127.0.0.1:3001
dsh web: http://127.0.0.1:3080
[dsh-qq-bridge] mounting agent preset "standard"
```

![DSH 启动成功截图](docs/asset/test0.png)

DSH WebUI 默认地址是:

```text
http://127.0.0.1:3080
```

## 7. 用 QQ 验证

从手机 QQ 给“我的电脑”或自己发送:

```text
/dsh ping
```

能收到回复后，再试:

```text
/dsh 当前工作目录是什么
/dsh 列出当前工作目录下的目录和文件
```

## 8. 更改配置

正式接入 DSH 时，主要改这个文件:

```text
~/.dsh/profiles/web/cordis.patch.yml
```

改完配置后需要**重启 DSH** 才会生效；只有改了本项目 `src/` 源码时，才需要重新执行 `npm run build`。

### 更改调用的 DSH 模型

修改 `agent.provider` 和 `agent.model`:

```yaml
agent:
  provider: deepseek-official
  model: deepseek-v4-pro
  preset: standard
```

- `provider`:DSH 里已配置好的模型提供方。
- `model`:该 provider 下的模型 id。
- `preset`:DSH agent preset，通常保持 `standard` 即可。

### 更改 QQ 指令前缀

修改 `access.commandPrefix`:

```yaml
access:
  adminQq: <你的QQ号>
  allowlist: []
  commandPrefix: /dsh
  mode: whitelist
```

例如改成 `/ai` 后，QQ 里就要发送:

```text
/ai ping
```

如果开启了单号模式的 `selfLogInput`，它会复用同一个 `commandPrefix`，不需要额外改一处。

### 更改允许使用机器人的 QQ

只允许自己使用时:

```yaml
access:
  adminQq: <你的QQ号>
  allowlist: []
  mode: whitelist
```

要额外允许其他 QQ 使用，把 QQ 号加到 `allowlist`:

```yaml
access:
  adminQq: <你的QQ号>
  allowlist: [10001, 10002]
  mode: whitelist
```

不建议把 `mode` 改成 `open`，除非你明确知道风险。

### 更改单号模式日志路径

如果你用“我的电脑/自己给自己发消息”，保持:

```yaml
selfLogInput:
  enabled: true
  logPath: /home/<你的Linux用户名>/Napcat/log/napcat_<你的QQ号>.log
  pollIntervalMs: 1000
  replayOnStart: false
```

如果你是“主号发给机器人小号”，通常可以删除 `selfLogInput`，或改成:

```yaml
selfLogInput:
  enabled: false
```

### 本地回显测试入口的配置

只有运行 `bash scripts/start-local-echo.sh` 或 `npm start` 这种不接 DSH Agent 的本地测试入口时，才用环境变量改配置:

```bash
DSH_QQ_WS_URL=ws://127.0.0.1:3001 \
DSH_QQ_ADMIN=<你的QQ号> \
DSH_QQ_PREFIX=/dsh \
DSH_QQ_SELF_LOG=true \
npm start
```

正式使用 `pnpm dsh web` 时，以 `cordis.patch.yml` 为准。

## 9. 停止 DSH

如果是前台运行的 `pnpm dsh web`，在终端按:

```text
Ctrl+C
```

如果你把它放到后台运行了，再查进程:

```bash
ps -eo pid,ppid,lstart,cmd | grep -E 'pnpm dsh web|apps/cli/src/bin.ts' | grep -v grep
```

停止:

```bash
kill <PID>
```

这里要 kill 的是 `ps` 查到的实际进程 PID，不一定是 shell 打印的 job id。

## 10. 开源许可与致谢

本项目使用 MIT License 发布，见 [`LICENSE`](LICENSE)。

发布 release 时建议保留以下文件:

- [`LICENSE`](LICENSE):本项目许可证。
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md):第三方依赖、协议与外部项目说明。

本项目会连接或参考以下项目/协议:

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ):提供 QQ / OneBot 运行端点。本项目不打包、不修改、不再分发 NapCatQQ，只要求用户自行安装并运行。NapCatQQ 使用自定义的 Limited Redistribution License，若未来 release 中包含 NapCatQQ 文件，必须额外遵守其上游许可证与非商业/再分发限制。
- [OneBot](https://github.com/botuniverse/onebot):聊天机器人接口标准，本项目通过 OneBot WebSocket 协议与 NapCat 通信。
- [DeepSeek Harness / DSH](https://github.com/deepseek-ai/deepseek-harness):本插件运行所在的 Host / Agent 环境。
- `ws`、`zod` 等 npm 依赖:详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

简单说:需要 mention。对 `ws`、`zod` 这类依赖，保留 package metadata 和 third-party notices 即可；对 NapCatQQ 这类没有打包进本仓库但对项目很关键的外部运行时，README 里做清晰致谢和边界说明最稳。

## 11. 常见问题

### QQ 消息没回复

先看日志:

```bash
napcat log <你的QQ号>
```

重点检查:

- NapCat 是否还在线。
- 正向 WebSocket 是否开启，端口是否是 `3001`。
- `DSH_QQ_TOKEN` 是否等于 OneBot access token。
- 消息是否以 `/dsh` 开头。
- `adminQq` 是否填的是发消息的 QQ。
- 单号模式下 `selfLogInput.logPath` 是否正确。

### 发送后一直无回复

如果 DSH 卡在工具审批，通常是没有设置:

```bash
export DSH_PERMISSION_MODE=danger-full-access
```

重新 kill 旧进程，再按第 6 步启动。

### 临时调试时想用一次性 patch 启动

正式使用建议写入 `~/.dsh/profiles/web/cordis.patch.yml` 后执行 `pnpm dsh web`。临时调试时，也可以把同样的 patch 写到 `/tmp/dsh-qq-bridge-agent.patch.yml`，然后从 DSH 项目目录执行:

```bash
export DSH_QQ_TOKEN='<NapCat OneBot access token>'
export DSH_PERMISSION_MODE=danger-full-access

pnpm dsh web --patch /tmp/dsh-qq-bridge-agent.patch.yml
```

如果需要后台运行并写日志:

```bash
pnpm dsh web --patch /tmp/dsh-qq-bridge-agent.patch.yml \
  > /tmp/dsh-qq-agent.log 2>&1 &
```

### 返回 `<tool_calls>` 或 DSML 文本

通常是模型/工具调用模式不匹配，或插件版本不是最新构建。先执行:

```bash
npm run build
```

然后重启 DSH。推荐使用已验证过的 `deepseek-v4-pro` 配置。

### 只想测试 QQ 链路，不接 DSH Agent

可以用本地回显模式:

```bash
DSH_QQ_ADMIN=<你的QQ号> \
DSH_QQ_TOKEN=<NapCat OneBot access token> \
DSH_QQ_SELF_LOG=true \
bash scripts/start-local-echo.sh
```

发送:

```text
/dsh ping
```

预期回复:

```text
echo: ping
```
