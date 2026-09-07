# NapCat 掉线排查记录

检查日期：2026-09-06。本记录仅包含版本、配置项、事件计数和时间，不复制私聊内容、密码、token、二维码或设备标识。

## 已确认的本机事实

- 环境：WSL2，Linux 6.18.33.2-microsoft-standard-WSL2，x86_64；WSL 已启用 systemd。
- NapCat 启动日志版本：4.18.19；QQ 安装包版本：3.2.30-50828。
- 两份账号日志分别记录到 4 次、5 次 `[KickedOffLine]`，因此问题不只出现在一个账号。它们不是同时登录的证据，也不能据此认定设备或账号风控。
- 对每次下线前 30 行的有限检查：仍有正常收发消息，未找到 `ECONN`、网络断开、网络异常或 timeout 字样，亦未见 `[error]`。这不能排除网络问题，但不支持将本问题简单归因于空闲或 OneBot 心跳不足。
- 下线后存在“快速登录失败 → 二维码”的记录。2026-09-06 18:18:45 尝试密码回退，18:18:46 要求验证码，与用户反馈一致。
- `~/.config/QQ` 存在，所有者为当前用户，权限 0700。未发现目录缺失或所有权不符；没有删除、迁移或重建登录数据。
- `~/Napcat/opt/QQ/resources/app/app_launcher/napcat/config/napcat.json` 和两份 `napcat_<QQ>.json` 的 `o3HookMode` 都为 1；`packetBackend` 为 `auto`。

## 配置文档与当前实现的差异

[官方安全文档](https://napneko.github.io/other/security)建议从账号、设备和包拦截配置排查频繁掉线，文档使用的是旧字段 `o3Hook`。

已检查本机 4.18.19 构建产物，以及[官方配置源码](https://github.com/NapNeko/NapCatQQ/blob/main/packages/napcat-core/helper/config.ts)：实际字段为 `o3HookMode`，默认值 0。登录前先读取全局 `napcat.json`，再把 `o3HookMode === 1` 传给 NativePacketHandler。

但是，[当前 NativePacketHandler](https://github.com/NapNeko/NapCatQQ/blob/main/packages/napcat-core/packet/handler/client.ts)在值为 false 时仍调用 `initHook`。因此不能把 `o3HookMode: 0` 描述成“完全关闭所有包拦截”，也不能保证旧文档方案直接对应当前版本。

## 建议的对照顺序

1. **固定账号和设备，先测默认 hook 模式。** 备份全局 `napcat.json` 与当前账号配置，只把 `o3HookMode` 从 1 改成 0，不同时改 QQ/NapCat 版本、IP、账号或其它选项。下一次正常重启并扫码后，先验证桥接所需私聊/群聊收发，再观察至少 24–48 小时。记录有效登录时长与掉线次数，而不是仅记录重启次数。此项目前是待执行对照，尚未修改本机配置，也尚无稳定性改善结论。
2. **若仍掉线，用同一账号对照另一台固定设备。** 暂停原设备实例，在另一设备维持相同用途、相近消息量与稳定网络。已有两个账号在同一环境掉线的记录，所以优先做设备对照，比继续盲目换账号更有区分度。这只是排查优先级，不代表已经证明 WSL2 有问题。
3. **补充宿主机和账号证据。** 逐次对齐 Windows 休眠/唤醒、VPN/网络切换时间与下线时间；查看手机 QQ 的安全提醒、登录设备和功能限制。WSL 内的这些 NapCat 日志不能替代宿主机或腾讯账号侧记录。用户已明确排除自己在其他平台登录挤掉，不将其反复作为默认原因。
4. **账号与客户端对照。** 若同账号换设备后仍掉线，观察该账号在正常官方客户端是否也掉线/受限；若只有 NapCat 触发，再针对准确 QQ/NapCat 版本提交脱敏日志或测试经确认兼容的版本组合。一次只改一项，保留回滚配置。

不提高自发消息保活频率，不循环重启，不删除 QQ 用户数据，不通过频繁切换 IP“试运气”。这些动作会引入额外变量，当前证据不足以支持其有效性。

## 当前恢复行为

插件已取消密码输入和密码回退传递，旧版保存的 `napcat.loginPassword` 不再参与运行配置。启动/重启子进程会移除 `NAPCAT_QUICK_PASSWORD` 与 `NAPCAT_QUICK_PASSWORD_MD5`，但不会改动父进程环境或删除 QQ 缓存。此变更不等于从宿主 DSH 存储中擦除历史密码值。

明确下线后，插件受控重启一次并提示打开 NapCat WebUI 或 `napcat log <QQ>` 扫码。等待扫码期间不再重启。若原快速登录凭据仍有效，NapCat 可自行复用，不强制注销。扫码后收到新 QQ 消息可恢复监控。
