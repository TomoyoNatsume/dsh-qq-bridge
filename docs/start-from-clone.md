# 从 clone 到跑通 QQ 回显

这是一份给终端用户看的最短启动说明。目标是先跑通:

```text
你的主号 QQ -> NapCat 登录的机器人小号 -> dsh-qq-bridge -> 回发 echo
```

跑通回显以后，再把插件挂进真实 DSH/Cordis Host。

## 你需要准备

- 一台能长期运行的电脑或服务器。
- Node.js 20+ 和 npm。
- 一个专用 QQ 小号，用来登录 NapCat。不要用主号当机器人号。
- 你的主号 QQ，用来给机器人小号发 `/dsh ping`。

## 1. clone 项目

```bash
git clone https://github.com/TomoyoNatsume/dsh-qq-bridge.git
cd dsh-qq-bridge
```

## 2. 安装并登录 NapCat

NapCat 负责登录 QQ 小号，并提供 OneBot WebSocket 给本插件连接。

### Linux / WSL2 推荐方式

在真实终端里执行，安装过程可能需要 `sudo`:

```bash
cd ~
curl -o napcat.sh https://raw.githubusercontent.com/NapNeko/NapCat-Installer/main/script/install.sh
bash napcat.sh --docker n --cli y
```

安装完成后启动 NapCat:

```bash
napcat start <机器人小号QQ>
napcat log <机器人小号QQ>
```

`napcat log` 会持续输出日志，登录二维码通常会打印在这里。用手机 QQ 登录这个专用小号并扫码确认。

如果提示 `napcat: command not found`，先尝试重新打开一个终端，或检查安装器最后输出的实际启动命令。

### Windows / macOS

从 NapCat 官方仓库 `NapNeko/NapCatQQ` 的 Releases 下载对应系统版本，解压后运行。窗口或终端里出现二维码后，用手机 QQ 登录专用小号扫码。

不要把 QQ 密码交给任何脚本或机器人，登录只走手机扫码。

## 3. 开启 OneBot 正向 WebSocket

先进入 NapCat WebUI。默认地址通常是:

```text
http://127.0.0.1:6099
```

如果 NapCat 跑在 WSL2 / 本机 Linux 上，也可以在宿主机浏览器打开:

```text
http://localhost:6099
```

WebUI 登录 token 一般会打印在 NapCat 日志里:

```bash
napcat log <机器人小号QQ>
```

也可以尝试查看配置文件: `~/Napcat/log/napcat_[你的账号].log`

进入 WebUI 后，开启:

```text
正向 WebSocket / Forward WebSocket
监听地址: 127.0.0.1
端口: 3001
token: 可空；如果设置了，后面 DSH_QQ_TOKEN 必须一致
```

保存后保持 NapCat 运行。

## 4. 启动本插件的回显模式

回到 `dsh-qq-bridge` 项目目录:

```bash
DSH_QQ_ADMIN=<你的主号QQ> bash scripts/start-local-echo.sh
```

如果 NapCat 设置了 token:

```bash
DSH_QQ_ADMIN=<你的主号QQ> \
DSH_QQ_TOKEN=<NapCat里设置的OneBot token> \
bash scripts/start-local-echo.sh
```

如果端口不是 3001:

```bash
DSH_QQ_ADMIN=<你的主号QQ> \
DSH_QQ_WS_URL=ws://127.0.0.1:<端口> \
bash scripts/start-local-echo.sh
```

脚本会自动:

1. 安装 npm 依赖。
2. 编译 TypeScript。
3. 启动 `npm start` 的本地回显入口。

看到类似下面的日志就表示插件已连上 NapCat:

```text
[dsh-qq-bridge] 已连接 ws://127.0.0.1:3001
```

## 5. 用 QQ 验证

用你的主号给机器人小号发:

```text
/dsh ping
```

预期机器人小号回复:

```text
echo: ping
```

这说明 QQ -> NapCat -> 插件 -> QQ 的链路已经打通。

## 5.1 实验:单号 / 我的电脑模式

如果你想用同一个 QQ 号登录 NapCat，并从手机 QQ 给“我的电脑”或自己发消息，可以启用实验性的 NapCat 日志输入。

前提:

- NapCat 登录号和 `DSH_QQ_ADMIN` 是同一个 QQ。
- NapCat 日志里能看到类似:

```text
发送 -> 私聊 (554616801) /dsh hello
发送 -> 移动设备 /dsh hello
```

启动时增加 `DSH_QQ_SELF_LOG=true`:

```bash
DSH_QQ_ADMIN=<你的QQ号> \
DSH_QQ_TOKEN=<NapCat里设置的OneBot token> \
DSH_QQ_SELF_LOG=true \
bash scripts/start-local-echo.sh
```

默认日志路径是:

```text
~/Napcat/log/napcat_<你的QQ号>.log
```

如果你的日志路径不同，显式指定:

```bash
DSH_QQ_ADMIN=<你的QQ号> \
DSH_QQ_SELF_LOG=true \
DSH_QQ_SELF_LOG_PATH=/path/to/napcat_<你的QQ号>.log \
bash scripts/start-local-echo.sh
```

开启后，从手机 QQ 给“我的电脑”发送:

```text
/dsh ping
```

预期仍然回复:

```text
echo: ping
```

这个模式通过 tail NapCat 日志实现，属于兼容方案；大小号模式仍然是首选稳定路径。

## 6. 常见问题

### 插件提示无法连接 onebot WS

检查:

- NapCat 是否还在运行。
- WebUI 是否能打开: `http://127.0.0.1:6099`。
- 正向 WebSocket 是否开启。
- 端口是否和 `DSH_QQ_WS_URL` 一致。
- token 是否和 `DSH_QQ_TOKEN` 一致。

### NapCat WebUI 打不开

检查:

```bash
napcat status <机器人小号QQ>
napcat start <机器人小号QQ>
napcat log <机器人小号QQ>
```

如果日志里显示的 WebUI 端口不是 `6099`，以日志为准。

### 主号发消息没反应

检查:

- 消息是否以 `/dsh` 开头。
- `DSH_QQ_ADMIN` 是否填的是主号 QQ，不是机器人小号。
- 主号是否已经是机器人小号好友。

### `nc` 打开的是 OpenBSD netcat

这是正常的命令名冲突。请使用:

```bash
napcat start <机器人小号QQ>
napcat log <机器人小号QQ>
```

二维码一般在 `napcat log` 输出里。

### 机器人小号过一段时间掉线

这是 QQ 登录态或风控问题，不是 bridge 本身的问题。建议:

- 使用稳定网络和固定机器。
- 不要频繁重装、换 IP、换容器。
- Docker 部署时持久化 QQ 配置目录。
- 用正常使用过一段时间的专用小号。

## 7. 接入真实 DSH

上面的 `scripts/start-local-echo.sh` 只是回显验证，不会调用真实 DSH Agent。

确认 QQ 链路通了以后，在 DSH Host 的 Cordis 插件配置里使用本包默认导出的插件入口，并按 `examples/config.example.json` 填:

```json
{
  "napcat": {
    "wsUrl": "ws://127.0.0.1:3001",
    "token": ""
  },
  "access": {
    "adminQq": 10001,
    "allowlist": [],
    "commandPrefix": "/dsh",
    "mode": "whitelist"
  },
  "agent": {
    "provider": "deepseek-official",
    "model": "deepseek-v4-flash"
  },
  "shell": {
    "enabled": false
  }
}
```

真实 DSH 模式下，同一个 QQ 私聊或群聊会复用同一个 live agent 会话，支持多轮上下文。
