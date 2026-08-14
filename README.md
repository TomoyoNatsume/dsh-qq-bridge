# dsh-qq-bridge

一个用于 **DSH(DeepSeek Harness)** 的 Host 端插件:通过 **NapCat(OneBot 协议)** 连接 QQ,把 QQ 消息转发给 DSH Agent / 本地能力处理,并回发结果。

> **状态:M3(核心 + DSH 对接 + 多轮上下文完成)。**
> 核心模块、OneBot client、router、security 均已落地并有本地单测;M2/M3 已接通 DSH `agentLoop`+`sessionQuery` 驱动 Agent,并实现每 QQ 会话常驻 live agent 的多轮上下文。真实 QQ(NapCat + 小号)端到端验证在 M4。

## 设计定位

**C 骨架 + A 内置默认 handler**:

- **C**:插件是一个可插拔的消息分发器(`MessageRouter`),社区可注册新 handler(遥控 Agent、跑 shell、查 API……)。
- **A**:内置 `AgentRpcHandler`,把 QQ 消息交给 DSH Agent 会话执行并回发 —— 即"远程 QQ 遥控 DSH"。

## 架构

```
[你的个人 QQ] --(腾讯服务器)--> [机器人小号(NapCat)]
                                    │ onebot WS
                                    ▼
                    dsh-qq-bridge(Host 插件)
                    OnebotClient → AccessGate(白名单/前缀)
                                 → MessageRouter → handler → DSH service
                                    │ 回发
                                    ▼
                    [机器人小号] --(腾讯)--> [你的个人 QQ]
```

NapCat 负责 QQ 登录/收发(寄生在已登录的官方 QQ 客户端上,非破解);OneBot 是它对外通信的协议标准。

## 安全

- **白名单**:只放行 `adminQq` + `allowlist` 内的 QQ;`whitelist` 模式下陌生人一律拒绝。
- **指令前缀**:消息须以 `/dsh`(可配置)开头才进入处理,避免机器人小号被无关 QQ 打扰。
- **命令隔离**:shell handler 默认关闭,需显式启用并受 DSH sandboxPolicy 约束。

## 里程碑

- **M0** 架构/部署/接口定稿 ✅
- **M1** 工程骨架 + OneBot client + router + security + 本地单测 ✅
- **M2** 接通 DSH `agentLoop` + `sessionQuery`,驱动 Agent 并读取回复 ✅
- **M3** 常驻 live agent 实现多轮上下文(每 QQ 会话一个 DSH agent),per-key 串行,teardown 释放 ✅
- **M4** 装 NapCat + 接入真实小号,QQ→DSH→回发闭环

## 本地开发

```bash
# 本会话因沙箱默认 npm cache 只读,需指定工作区内 cache
npm install --cache ./.npm-cache
npm test          # 5 个单测,无需 QQ 小号
npx tsc -p tsconfig.json --noEmit
```

## 许可

MIT
