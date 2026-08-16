# dsh-qq-bridge

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

如果打不开，以 NapCat 日志里打印的地址为准:

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

## 5. 写 DSH patch 配置

创建 `/tmp/dsh-qq-bridge-agent.patch.yml`:

```yaml
- id: webserver
  config:
    host: 127.0.0.1
    port: 3081

- id: llm-deepseek
  config:
    thinking: enabled
    reasoningEffort: high

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

切到 DSH / DeepSeek Harness 项目目录执行，也就是包含 `apps/cli/src/bin.ts` 的目录:

```bash
cd <你的 deepseek-harness 目录>

export DSH_QQ_TOKEN='<NapCat OneBot access token>'
export DSH_PERMISSION_MODE=danger-full-access

setsid node --import tsx/esm apps/cli/src/bin.ts \
  --profile web \
  --patch /tmp/dsh-qq-bridge-agent.patch.yml \
  > /tmp/dsh-qq-agent.log 2>&1 &
```

`DSH_QQ_TOKEN` 填 WebUI 里正向 WebSocket 的 access token，不是 WebUI 登录链接里的 token。

`DSH_PERMISSION_MODE=danger-full-access` 会让 DSH Agent 直接执行本机工具调用，不再卡在审批流程。只建议在私用、白名单只放自己的情况下使用。

查看启动日志:

```bash
tail -f /tmp/dsh-qq-agent.log
```

看到下面几行就表示启动成功:

```text
[dsh-qq-bridge] onebot ws connected: ws://127.0.0.1:3001
dsh web: http://127.0.0.1:3081
[dsh-qq-bridge] mounting agent preset "standard"
```

DSH WebUI 地址是:

```text
http://127.0.0.1:3081
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

## 8. 查看和停止后台进程

查看 DSH 进程:

```bash
ps -eo pid,ppid,lstart,cmd | grep 'apps/cli/src/bin.ts' | grep -v grep
```

停止:

```bash
kill <PID>
```

这里要 kill 的是 `ps` 查到的 node 进程 PID，不一定是 shell 打印的 job id。

## 9. 常见问题

### QQ 消息没回复

先看日志:

```bash
tail -n 100 /tmp/dsh-qq-agent.log
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
