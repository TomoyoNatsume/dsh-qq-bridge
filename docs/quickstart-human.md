# dsh-qq-bridge 快速上手指南(人读版)

> 本指南面向**项目维护者 / 想跑起来验证的开发者和终端用户**。
> 如果你是「把 NapCat 装上、让 QQ 接入」的部署步骤,请同时参考给 Agent 的安装向导 [`agent-napcat-guide.md`](./agent-napcat-guide.md)。

`dsh-qq-bridge` 是一个把 **DSH(DeepSeek Harness)** 和 **QQ** 连起来的 Host 端插件:
QQ 消息经 **NapCat(OneBot 协议)** 进到本插件被转发给 DSH Agent / 本地能力,再把回复发回 QQ。

## 一、总体架构

```
[你的 QQ] ──腾讯──> [机器人小号(NapCat)] ──onebot WS──> dsh-qq-bridge
                                                            │
                                               MessageRouter → DSH Agent / 本地 handler
                                                            │ 回发
[你的 QQ] <──腾讯── [机器人小号] <──onebot WS──────────────┘
```

- **NapCat**:负责 QQ 登录 / 收发,寄生在官方 QQ 客户端上(非破解),对外提供 **OneBot v11** 标准端点。
- **dsh-qq-bridge**:`npm` 插件,连接 onebot WS,做白名单 + 指令前缀过滤,转发给 handler。

## 二、M5 之前的本地自检(无需任何 QQ)

项目内置了一套**本地回环集成测试**,把「WS → OnebotClient → Router → Agent → 回发」全链路用内存 mock 跑通:

```bash
npm install --cache ./.npm-cache   # 沙箱默认 npm cache 只读时用 workspace 内 cache
npm test
npx tsc -p tsconfig.json --noEmit # 类型检查
```

预期输出:
- `Test Files 3 passed ...` 等;现有单元测试 + 新增的 `test/e2e-loopback.test.ts` 全部通过。
- `tsc` 无报错。

这验证的是**逻辑层面正确性**,但不包含真实网络 / NapCat。真机验证见下文「四」。

## 三、用独立入口跑一个「无 DSH 回显」模式

项目提供了一个独立 CLI 入口 `src/main.ts`(build 后为 `dist/main.js`,也可 `npm run start` 直接跑)。

```bash
npm run build
DSH_QQ_WS_URL=ws://127.0.0.1:3001 \
DSH_QQ_ADMIN=10001 \
npm start
```

- 该入口**默认走 fallback executor**,不启动真实 DSH host,收到什么 payload 就回显 `echo: <payload>`,用于先打通 QQ↔插件 的链路。
- 接入真实 DSH 时,请改为使用 **Cordis 插件入口**(`src/index.ts` 默认导出),它通过 `agentLoop` + `sessionQuery` 接入 DSH live agent。

## 四、真机端到端验证(M5)

真机验证需要:一台装了 NapCat 的机器 + 一个专用机器人小号 + 你的主号。

1. **安装并登录 NapCat**:按 [`agent-napcat-guide.md`](./agent-napcat-guide.md) 引导(扫码登录专用小号,启用正向 WS,记住端口与 token)。
2. **配置插件**:把 `wsUrl` 指向 NapCat 的 onebot WS 端点,`access.adminQq` 填你的主号。
   - Cordis 插件入口:在 DSH host 的插件配置里填(字段见 `examples/config.example.json`)。
   - 独立入口:通过 `DSH_QQ_WS_URL` / `DSH_QQ_ADMIN` 等环境变量。
3. **启动插件**,确认日志出现「已连接 ...」。
4. **从主号向机器人小号发送**:
   ```
   /dsh ping
   ```
   - 小号收到并回复 → 上行 OK。
   - 插件回复能回到主号 → 下行 OK。
   - 两端通,即 M5 达成。

## 五、配置说明

所有可配置字段(独立入口用环境变量,插件入口用配置对象),与 `src/config.ts` 的 zod schema 一一对应:

| 字段 | 说明 | 默认 |
|------|------|------|
| `napcat.wsUrl` | NapCat 提供的 onebot 正向 WS 端点地址 | `ws://127.0.0.1:3001` |
| `napcat.token` | 可选,若 NapCat 开启鉴权则需一致 | 无 |
| `access.adminQq` | 拥有者 QQ(总是放行) | 无(必填) |
| `access.allowlist` | 额外允许的 QQ 数组 | `[]` |
| `access.commandPrefix` | 指令前缀,消息须以此开头才处理 | `/dsh` |
| `access.mode` | `whitelist`(默认)或 `open`(仅测试) | `whitelist` |
| `shell.enabled` | 是否注册 shell handler(默认关闭,避免任意命令) | `false` |

> ⚠️ **安全**:`whitelist` 模式下陌生人一律拒绝;`shell` 默认关闭,显式启用也受 DSH `sandboxPolicy` 约束。

## 六、两个入口的区别

| 入口 | 场景 | DSH 集成 |
|------|------|----------|
| `src/index.ts`(默认导出) | **生产**:作为 Cordis 插件挂进 DSH Host | 完整接入 `agentLoop`/`sessionQuery` live agent,每 QQ 会话多轮上下文 |
| `src/main.ts`(独立 CLI) | 本地开发 / 打链路 / 先验证 QQ 通 | fallback 回显,不含真实 DSH |

## 七、里程碑状态

- M0-M4 已完成(见 `project-overview.md`)
- **M5** 真机端到端验证:需实机(本仓库已备好本地回环测试 + 独立入口 + 上述验证步骤)
- **M6** 文档 / 发布:本指南 + 示例配置 + CI 已就绪,待申报 dsh-plugin 社区
