window.__ModuleLoader__.load({
  id: "dsh-qq-bridge",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;
    const NS = "dsh-qq-bridge";
    const NAPCAT_CHANNEL = "/dsh-qq-bridge-napcat";
    const PROVIDER_OPTIONS = ["deepseek-official"];
    const MODEL_OPTIONS_BY_PROVIDER = {
      "deepseek-official": ["deepseek-v4-flash", "deepseek-v4-pro"],
    };

    exports.inject = ["slots", "connection", "remote", "settingsScope"];
    exports.apply = function apply(ctx) {
      const connection = ctx.get("connection");
      const scope = ctx.settingsScope.bind({ namespace: NS, decode: decodeSettings });
      const injected = () => ({
        scope,
        api: connection.api,
        rpc: connection.rpc,
      });
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "qq-bridge",
        order: 70,
        label: "QQ bridge",
        inject: injected,
      }, QqBridgeSettingsSection));
    };

    function QqBridgeSettingsSection(props) {
      const [snapshot, setSnapshot] = React.useState(() => props.scope.getSnapshot());
      const [draft, setDraft] = React.useState(() => draftFrom(snapshot.value));
      const [dirty, setDirty] = React.useState(false);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState("");
      const [napcatStatus, setNapcatStatus] = React.useState({ state: "idle", message: "保存配置时会检测 NapCat 并配置 OneBot。" });
      const [hostInfo, setHostInfo] = React.useState({ homeDir: "" });

      React.useEffect(() => props.scope.subscribe(() => {
        const next = props.scope.getSnapshot();
        setSnapshot(next);
        if (!dirty) setDraft(draftFrom(next.value, hostInfo.homeDir));
      }), [props.scope, dirty, hostInfo.homeDir]);

      React.useEffect(() => {
        let alive = true;
        callHostInfo(props.rpc).then((info) => {
          if (!alive) return;
          setHostInfo(info);
          setDraft((prev) => dirty ? prev : normalizeDraftCwd(prev, info.homeDir));
        }).catch(() => {
          // Host info is a display nicety; keep the page usable if older hosts lack it.
        });
        return () => {
          alive = false;
        };
      }, [props.rpc, dirty]);

      const update = (path, value) => {
        setDirty(true);
        setDraft((prev) => setPath(prev, path, value));
      };
      const updateAdminQq = (value) => {
        if (!/^\d*$/.test(value)) {
          setMessage("QQ 号只允许输入数字。");
          return;
        }
        setMessage("");
        update(["access", "adminQqText"], value);
      };
      const updateNapcatLoginQq = (value) => {
        if (!/^\d*$/.test(value)) {
          setMessage("QQ 号只允许输入数字。");
          return;
        }
        setMessage("");
        update(["napcat", "loginQqText"], value);
      };
      const updateAccountMode = (mode) => {
        setDirty(true);
        setMessage("");
        setDraft((prev) => setPath(setPath(prev, ["napcat", "accountMode"], mode), ["selfLogInput", "enabled"], mode === "single"));
      };
      const updatePlatform = (platform) => {
        setDirty(true);
        setDraft((prev) => {
          const withPlatform = setPath(prev, ["platform"], platform);
          return setPath(withPlatform, ["notifications", "agentReplyEnabled"], platform !== "official");
        });
      };
      const updateAgentProvider = (provider) => {
        setDirty(true);
        setDraft((prev) => {
          const models = modelOptionsForProvider(provider, prev.agent.model);
          const model = models.includes(prev.agent.model) ? prev.agent.model : models[0] || prev.agent.model;
          return setPath(setPath(prev, ["agent", "provider"], provider), ["agent", "model"], model);
        });
      };
      const save = async () => {
        setSaving(true);
        setMessage("");
        let setupStatus = napcatStatus;
        if (draft.platform === "napcat") {
          if (!/^\d+$/.test(napcatLoginQqText(draft).trim())) {
            setMessage("NapCat 登录 QQ 只允许输入数字，且不能为空。");
            setSaving(false);
            return;
          }
          if (draft.napcat.accountMode === "dual" && !/^\d+$/.test(draft.access.adminQqText.trim())) {
            setMessage("发送端 QQ 只允许输入数字，且不能为空。");
            setSaving(false);
            return;
          }
        }
        try {
          if (draft.platform === "napcat") {
            setNapcatStatus({ state: "loading", message: "正在检测 NapCat 并执行 setup..." });
            setupStatus = await callNapcatSetup(props.rpc, napcatLoginQqText(draft));
            setNapcatStatus(setupStatus);
          }
          const ops = opsFromDraft(draft, setupStatus);
          const response = await props.api.settings.mutate({
            ns: NS,
            ops,
            ...(snapshot.revision === undefined ? {} : { expectedRevision: snapshot.revision }),
          });
          if (!response.result.ok) {
            setMessage(response.result.error?.message || "保存失败");
          } else {
            setDraft((prev) => setPath(prev, ["enabled"], true));
            setDirty(false);
            if (draft.platform === "napcat") {
              setMessage(napcatLogHint(setupStatus, napcatLoginQqText(draft)));
            } else {
              setMessage("已保存并启用。QQ bridge 会在当前 DSH Web 进程中按新配置启动。");
            }
          }
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          if (draft.platform === "napcat") {
            setNapcatStatus({ state: "unavailable", message: text, commands: [] });
          }
          setMessage(text);
        } finally {
          setSaving(false);
        }
      };

      const disabled = snapshot.status !== "ready" || !snapshot.writable || saving;
      return h("div", { style: styles.page },
        h("div", { style: styles.header },
          h("div", null,
            h("h2", { style: styles.title }, "QQ bridge"),
            h("p", { style: styles.subtle }, "配置 QQ 到 DSH Agent 的桥接入口。保存配置后会在当前 DSH Web 进程中启动或重启 bridge。"),
          ),
          statusTag(draft, napcatStatus),
        ),
        snapshot.status === "unavailable"
          ? h("p", { role: "alert", style: styles.error }, "当前连接不能写入本机设置，需在本机 loopback 的 DSH Web 中配置。")
          : null,
        h("section", { style: styles.band },
          h("h3", { style: styles.sectionTitle }, "接入方式"),
          h("div", { style: styles.segment },
            choiceButton("NapCat / OneBot", draft.platform === "napcat", disabled, () => updatePlatform("napcat")),
            choiceButton("官方 QQ Bot", draft.platform === "official", disabled, () => updatePlatform("official")),
          ),
          draft.platform === "napcat"
            ? h(NapcatFields, { draft, disabled, update, updateAdminQq, updateNapcatLoginQq, updateAccountMode, status: napcatStatus })
            : h(OfficialFields, { draft, disabled, update }),
        ),
        h("section", { style: styles.band },
          h("h3", { style: styles.sectionTitle }, "Agent"),
          h("div", { style: styles.grid },
            selectField("Provider", draft.agent.provider, providerOptions(draft.agent.provider), disabled, updateAgentProvider),
            selectField("Model", draft.agent.model, modelOptionsForProvider(draft.agent.provider, draft.agent.model), disabled, (value) => update(["agent", "model"], value)),
            textField("默认工作目录", draft.agent.cwd, disabled, (value) => update(["agent", "cwd"], value)),
            numberField("超时（秒）", draft.agent.timeoutSeconds, disabled, (value) => update(["agent", "timeoutSeconds"], value)),
          ),
          h("label", { style: styles.checkbox },
            h("input", {
              type: "checkbox",
              checked: draft.agent.streamText,
              disabled,
              onChange: (event) => update(["agent", "streamText"], event.currentTarget.checked),
            }),
            h("span", null, "边生成边回发文本"),
          ),
        ),
        h("section", { style: styles.band },
          h("h3", { style: styles.sectionTitle }, "安全与权限"),
          h("div", { style: styles.grid },
            selectField("访问模式", draft.access.mode, ["whitelist", "open"], disabled, (value) => update(["access", "mode"], value)),
            selectField("默认权限", draft.permissionDefault, ["workspace-write", "danger-full-access", "keep"], disabled, (value) => update(["permissionDefault"], value)),
          ),
          h("label", { style: styles.checkbox },
            h("input", {
              type: "checkbox",
              checked: draft.notifications.agentReplyEnabled,
              disabled,
              onChange: (event) => update(["notifications", "agentReplyEnabled"], event.currentTarget.checked),
            }),
            h("span", null, "非 QQ 会话 Agent 完成后提醒管理员"),
          ),
          h("p", { style: styles.subtle }, "默认权限保存为 QQ bridge 配置意图；第一版不会自动改全局 permission.defaultPreset。"),
        ),
        h("div", { style: styles.footer },
          h("button", { type: "button", style: disabled ? styles.primaryDisabled : styles.primary, disabled, onClick: save },
            saving ? "保存并启动中..." : "保存并启动",
          ),
          message ? h("p", { role: "status", style: isErrorMessage(message) ? styles.error : styles.ok }, message) : null,
        ),
      );
    }

    function NapcatFields({ draft, disabled, update, updateAdminQq, updateNapcatLoginQq, updateAccountMode, status }) {
      const accountMode = draft.napcat.accountMode === "single" ? "single" : "dual";
      const loginField = textField("NapCat 登录 QQ", napcatLoginQqText(draft), disabled, accountMode === "single" ? updateAdminQq : updateNapcatLoginQq, "text", {
        inputMode: "numeric",
        pattern: "[0-9]*",
        placeholder: "只允许数字",
      });
      const senderField = accountMode === "dual"
        ? textField("发送端 QQ", draft.access.adminQqText, disabled, updateAdminQq, "text", {
            inputMode: "numeric",
            pattern: "[0-9]*",
            placeholder: "只允许数字",
          })
        : null;
      const modeSwitch = switchModeControl(accountMode, disabled, updateAccountMode);
      const logField = readonlyField("NapCat 日志路径", napcatLogPathText(status, draft));
      if (status.state === "loading") {
        return h("div", { style: styles.stack }, modeSwitch, loginField, senderField, logField, warnCard("正在检测 NapCat...", [], "status"));
      }
      if (status.state === "not-installed") {
        return h("div", { style: styles.stack },
          modeSwitch,
          loginField,
          senderField,
          logField,
          warnCard(status.message, status.commands || [], "alert"),
        );
      }
      if (status.state === "needs-admin") {
        return h("div", { style: styles.stack },
          modeSwitch,
          loginField,
          senderField,
          logField,
          warnCard(status.message, status.commands || [], "status"),
        );
      }
      if (status.state === "not-running" || status.state === "unavailable") {
        return h("div", { style: styles.stack },
          modeSwitch,
          loginField,
          senderField,
          logField,
          warnCard(status.message, status.commands || [], "alert"),
        );
      }
      const wsUrl = status.onebot?.wsUrl ?? draft.napcat.wsUrl;
      const tokenPreview = status.onebot?.tokenPreview ?? "保存时生成";
      return h("div", { style: styles.stack },
        modeSwitch,
        h("div", { style: styles.grid },
          loginField,
          senderField,
          readonlyField("OneBot WebSocket", wsUrl),
          readonlyField("OneBot token", tokenPreview),
          logField,
          textField("命令前缀", draft.access.commandPrefix, disabled, (value) => update(["access", "commandPrefix"], value), "text", { placeholder: "(空)" }),
        ),
        h("p", { style: styles.subtle }, status.message),
      );
    }

    function OfficialFields({ draft, disabled, update }) {
      return h("div", { style: styles.grid },
        textField("AppID", draft.official.appId, disabled, (value) => update(["official", "appId"], value)),
        textField("AppSecret", draft.official.appSecret, disabled, (value) => update(["official", "appSecret"], value), "password"),
        textField("Admin OpenID", draft.official.adminOpenId, disabled, (value) => update(["official", "adminOpenId"], value)),
        textField("Allowlist OpenIDs", draft.official.allowlistOpenIdsText, disabled, (value) => update(["official", "allowlistOpenIdsText"], value)),
        h("label", { style: styles.checkbox },
          h("input", {
            type: "checkbox",
            checked: draft.official.sandbox,
            disabled,
            onChange: (event) => update(["official", "sandbox"], event.currentTarget.checked),
          }),
          h("span", null, "沙箱环境"),
        ),
      );
    }

    function choiceButton(label, active, disabled, onClick) {
      return h("button", {
        type: "button",
        disabled,
        onClick,
        style: active ? styles.segmentActive : styles.segmentButton,
      }, label);
    }

    function switchModeControl(mode, disabled, onChange) {
      const dual = mode === "dual";
      return h("div", { role: "group", "aria-label": "账号模式", style: styles.modeToggle },
        h("button", {
          type: "button",
          "aria-pressed": !dual,
          disabled,
          onClick: () => onChange("single"),
          style: !dual ? styles.modeToggleActive : styles.modeToggleButton,
        }, "单号模式"),
        h("button", {
          type: "button",
          "aria-pressed": dual,
          disabled,
          onClick: () => onChange("dual"),
          style: dual ? styles.modeToggleActive : styles.modeToggleButton,
        }, "双号模式"),
      );
    }

    function textField(label, value, disabled, onChange, type = "text", extra = {}) {
      return h("label", { style: styles.field },
        h("span", { style: styles.label }, label),
        h("input", {
          type,
          value: value ?? "",
          disabled,
          style: styles.input,
          onChange: (event) => onChange(event.currentTarget.value),
          ...extra,
        }),
      );
    }

    function readonlyField(label, value) {
      return h("label", { style: styles.field },
        h("span", { style: styles.label }, label),
        h("output", { style: styles.readonly }, value || "未检测到"),
      );
    }

    function warnCard(message, commands, role) {
      return h("div", { role, style: styles.warn },
        h("strong", { style: styles.warnTitle }, message),
        commands && commands.length > 0
          ? h("pre", { style: styles.code }, commands.join("\n"))
          : null,
      );
    }

    function isErrorMessage(value) {
      return /失败|只允许|不能为空|请先|不可用|无法|无响应/.test(value);
    }

    function statusTag(draft, napcatStatus) {
      const status = bridgeStatus(draft, napcatStatus);
      return h("span", { style: status.style, title: status.title, "aria-label": status.title }, status.label);
    }

    function bridgeStatus(draft, napcatStatus) {
      if (draft.platform === "napcat") {
        if (napcatStatus?.state === "loading") {
          return { label: "检测中", style: styles.tagNeutral, title: "正在检测 NapCat 并执行 setup，请稍等。" };
        }
        if (napcatStatus?.state === "idle") {
          return draft.enabled
            ? { label: "已启用", style: styles.tagOk, title: "如果发送消息无响应，则打开napcat log确认是否已登陆" }
            : { label: "保存后启用", style: styles.tagReady, title: "点击“保存并启动”后会检测 NapCat、写入配置并启动 bridge。" };
        }
        if (napcatStatus?.state !== "ready") {
          return { label: "未就绪", style: styles.tagWarn, title: "请点击“保存并启动”，按提示安装或启动 NapCat。" };
        }
        if (draft.enabled) {
          return { label: "已启用", style: styles.tagOk, title: "如果发送消息无响应，则打开napcat log确认是否已登陆" };
        }
        return { label: "保存后启用", style: styles.tagReady, title: "点击“保存并启动”后会检测 NapCat、写入配置并启动 bridge。" };
      }
      return draft.enabled
        ? { label: "已启用", style: styles.tagOk, title: "如果官方机器人无响应，请检查 DSH web 日志和 QQ 开放平台机器人状态。" }
        : { label: "保存后启用", style: styles.tagReady, title: "点击“保存并启动”后会写入配置并启动 bridge。" };
    }

    function numberField(label, value, disabled, onChange) {
      return textField(label, value === undefined ? "" : String(value), disabled, (next) => onChange(Number(next) || 0), "number");
    }

    function selectField(label, value, options, disabled, onChange) {
      return h("label", { style: styles.field },
        h("span", { style: styles.label }, label),
        h("select", {
          value,
          disabled,
          style: styles.input,
          onChange: (event) => onChange(event.currentTarget.value),
        }, options.map((option) => h("option", { key: option, value: option }, option))),
      );
    }

    function providerOptions(current) {
      return withCurrentOption(PROVIDER_OPTIONS, current);
    }

    function modelOptionsForProvider(provider, current) {
      return withCurrentOption(MODEL_OPTIONS_BY_PROVIDER[provider] || [], current);
    }

    function withCurrentOption(options, current) {
      const value = String(current || "").trim();
      return value && !options.includes(value) ? [...options, value] : options;
    }

    function decodeSettings(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      return value;
    }

    function napcatLoginQqText(draft) {
      return draft.napcat.accountMode === "single" ? draft.access.adminQqText : draft.napcat.loginQqText;
    }

    function napcatLogPathText(status, draft) {
      const qq = napcatLoginQqText(draft).trim() || "<qq号>";
      if (status?.state === "loading") return "正在检测...";
      if (status?.logState === "ready" && status.logPath) return status.logPath;
      if (status?.logState) return `找不到，请通过 napcat log ${qq} 查看`;
      return `保存并启动后检测；找不到时请通过 napcat log ${qq} 查看`;
    }

    async function callNapcatSetup(rpc, adminQq) {
      if (!rpc || typeof rpc.call !== "function") {
        throw new Error("当前 DSH Web 没有暴露本机 NapCat setup 接口。");
      }
      const response = await rpc.call(NAPCAT_CHANNEL, "setup", { adminQq });
      if (!response.ok) throw new Error(response.error?.message || "NapCat setup 失败");
      return response.value;
    }

    async function callHostInfo(rpc) {
      if (!rpc || typeof rpc.call !== "function") return { homeDir: "" };
      const response = await rpc.call(NAPCAT_CHANNEL, "host-info", {});
      if (!response.ok) return { homeDir: "" };
      const homeDir = typeof response.value?.homeDir === "string" ? response.value.homeDir : "";
      return { homeDir };
    }

    function draftFrom(value, homeDir = "") {
      const source = value && typeof value === "object" ? value : {};
      const accessAdminQq = Number(source.access?.adminQq ?? 0);
      const napcatLoginQq = Number(source.napcat?.loginQq ?? 0);
      const accountMode = source.selfLogInput?.enabled ? "single" : "dual";
      return {
        enabled: Boolean(source.enabled),
        platform: source.platform === "official" ? "official" : "napcat",
        napcat: {
          accountMode,
          loginQqText: napcatLoginQq > 0 ? String(napcatLoginQq) : accountMode === "single" && accessAdminQq > 0 ? String(accessAdminQq) : "",
          wsUrl: source.napcat?.wsUrl ?? "ws://127.0.0.1:3001",
        },
        official: {
          appId: source.official?.appId ?? "",
          appSecret: "",
          adminOpenId: source.official?.adminOpenId ?? "",
          allowlistOpenIdsText: Array.isArray(source.official?.allowlistOpenIds)
            ? source.official.allowlistOpenIds.join("\n")
            : "",
          sandbox: Boolean(source.official?.sandbox),
        },
        access: {
          adminQq: accessAdminQq,
          adminQqText: accessAdminQq > 0 ? String(accessAdminQq) : "",
          commandPrefix: source.access?.commandPrefix ?? "",
          mode: source.access?.mode === "open" ? "open" : "whitelist",
        },
        agent: {
          provider: source.agent?.provider ?? "deepseek-official",
          model: source.agent?.model ?? "deepseek-v4-flash",
          cwd: displayCwd(source.agent?.cwd, homeDir),
          timeoutSeconds: Math.max(1, Math.round(Number(source.agent?.timeoutMs ?? 120000) / 1000)),
          streamText: Boolean(source.agent?.streamText),
        },
        selfLogInput: {
          enabled: Boolean(source.selfLogInput?.enabled),
          logPath: source.selfLogInput?.logPath ?? "",
        },
        notifications: {
          agentReplyEnabled: source.notifications?.agentReply?.enabled ?? source.platform !== "official",
        },
        permissionDefault: source.permissionDefault ?? "workspace-write",
      };
    }

    function normalizeDraftCwd(draft, homeDir) {
      return setPath(draft, ["agent", "cwd"], displayCwd(draft.agent.cwd, homeDir));
    }

    function displayCwd(value, homeDir) {
      const text = String(value ?? "").trim();
      const home = String(homeDir || "").trim();
      if (text === "" || text === "~") return home || "~";
      if (text.startsWith("~/") && home) return `${home}/${text.slice(2)}`;
      return text;
    }

    function opsFromDraft(draft, napcatStatus) {
      const detectedOnebot = draft.platform === "napcat" && napcatStatus?.state === "ready" ? napcatStatus.onebot : undefined;
      const detectedLogPath = draft.platform === "napcat" && napcatStatus?.logState === "ready" ? napcatStatus.logPath : "";
      const loginQq = Number(napcatLoginQqText(draft)) || 0;
      const senderQq = draft.napcat.accountMode === "single" ? loginQq : Number(draft.access.adminQqText) || 0;
      const ops = [
        set(["enabled"], true),
        set(["platform"], draft.platform),
        set(["napcat", "loginQq"], loginQq),
        set(["napcat", "wsUrl"], detectedOnebot?.wsUrl ?? draft.napcat.wsUrl),
        set(["official", "appId"], draft.official.appId),
        set(["official", "adminOpenId"], draft.official.adminOpenId),
        set(["official", "allowlistOpenIds"], splitLines(draft.official.allowlistOpenIdsText)),
        set(["official", "sandbox"], draft.official.sandbox),
        set(["access", "adminQq"], senderQq),
        set(["access", "allowlist"], []),
        set(["access", "commandPrefix"], draft.access.commandPrefix),
        set(["access", "mode"], draft.access.mode),
        set(["agent", "preset"], "dsh-qq-bridge"),
        set(["agent", "provider"], draft.agent.provider),
        set(["agent", "model"], draft.agent.model),
        set(["agent", "cwd"], draft.agent.cwd),
        set(["agent", "streamText"], draft.agent.streamText),
        set(["agent", "streamReasoning"], false),
        set(["agent", "maxMessageLength"], 4500),
        set(["agent", "ackMessage"], "收到，正在处理..."),
        set(["agent", "timeoutMs"], Math.max(1, Number(draft.agent.timeoutSeconds) || 120) * 1000),
        set(["agent", "timeoutMessage"], "agent 无响应，请稍后重试。"),
        set(["agent", "qqReplyStyleSkill"], { enabled: true, skillName: "qq-session-reply-style" }),
        set(["shell", "enabled"], false),
        set(["notifications", "agentReply", "enabled"], draft.notifications.agentReplyEnabled),
        set(["selfLogInput", "enabled"], draft.napcat.accountMode === "single"),
        set(["selfLogInput", "logPath"], detectedLogPath || ""),
        set(["selfLogInput", "pollIntervalMs"], 1000),
        set(["selfLogInput", "replayOnStart"], false),
        set(["permissionDefault"], draft.permissionDefault),
      ];
      if (detectedOnebot?.token && detectedOnebot.token.trim() !== "") ops.push(set(["napcat", "token"], detectedOnebot.token));
      if (draft.official.appSecret.trim() !== "") ops.push(set(["official", "appSecret"], draft.official.appSecret));
      return ops;
    }

    function napcatLogHint(status, qq) {
      const logPath = status?.logPath || "";
      const qqText = String(qq || "").trim();
      const command = qqText ? `napcat log ${qqText}` : "napcat log <QQ>";
      return logPath
        ? `已保存并启用。如果发送 "ping" 后没反应，请运行 ${command} 或查看 ${logPath} 确认是否已登录。`
        : `已保存并启用。如果发送 "ping" 后没反应，请运行 ${command} 确认是否已登录。`;
    }

    function set(path, value) {
      return { op: "set", path, value };
    }

    function splitLines(value) {
      return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
    }

    function setPath(source, path, value) {
      const [head, ...tail] = path;
      if (head === undefined) return value;
      return {
        ...source,
        [head]: tail.length === 0 ? value : setPath(source[head] ?? {}, tail, value),
      };
    }

    const styles = {
      page: { display: "grid", gap: 16, maxWidth: 880, color: "var(--dsw-alias-label-primary)" },
      header: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" },
      title: { margin: 0, fontSize: 22, fontWeight: 650 },
      subtle: { margin: "6px 0 0", color: "var(--dsw-alias-label-secondary)", lineHeight: 1.5, fontSize: 13 },
      band: { border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8, padding: 16, background: "var(--dsw-alias-bg-layer-1)" },
      sectionTitle: { margin: "0 0 12px", fontSize: 14, fontWeight: 650 },
      stack: { display: "grid", gap: 12 },
      grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 },
      field: { display: "grid", gap: 6, minWidth: 0 },
      label: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" },
      input: { minWidth: 0, height: 34, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", padding: "0 10px", font: "inherit" },
      readonly: { minWidth: 0, minHeight: 34, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-secondary)", padding: "7px 10px", font: "inherit", overflowWrap: "anywhere" },
      warn: { border: "1px solid var(--dsw-alias-state-warning-primary, #b7791f)", borderRadius: 8, background: "color-mix(in srgb, var(--dsw-alias-state-warning-primary, #b7791f) 10%, transparent)", padding: 14, display: "grid", gap: 10 },
      warnTitle: { fontSize: 13, lineHeight: 1.5, fontWeight: 650 },
      code: { margin: 0, padding: 10, borderRadius: 6, background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
      switchRow: { display: "flex", gap: 8, alignItems: "center", fontSize: 13 },
      tagOk: { display: "inline-flex", alignItems: "center", flexShrink: 0, height: 24, padding: "0 9px", borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: "nowrap", cursor: "help", color: "var(--dsw-alias-state-success-primary)", background: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 38%, transparent)" },
      tagReady: { display: "inline-flex", alignItems: "center", flexShrink: 0, height: 24, padding: "0 9px", borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: "nowrap", cursor: "help", color: "var(--dsw-alias-brand-primary)", background: "color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, transparent)" },
      tagWarn: { display: "inline-flex", alignItems: "center", flexShrink: 0, height: 24, padding: "0 9px", borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: "nowrap", cursor: "help", color: "var(--dsw-alias-state-warning-primary, #b7791f)", background: "color-mix(in srgb, var(--dsw-alias-state-warning-primary, #b7791f) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #b7791f) 36%, transparent)" },
      tagNeutral: { display: "inline-flex", alignItems: "center", flexShrink: 0, height: 24, padding: "0 9px", borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: "nowrap", cursor: "help", color: "var(--dsw-alias-label-secondary)", background: "var(--dsw-alias-bg-layer-2)", border: "1px solid var(--dsw-alias-border-l1)" },
      modeToggle: { display: "inline-grid", gridTemplateColumns: "1fr 1fr", width: "fit-content", minWidth: 180, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, overflow: "hidden", background: "var(--dsw-alias-bg-base)" },
      modeToggleButton: { minHeight: 34, border: 0, padding: "0 14px", background: "transparent", color: "var(--dsw-alias-label-secondary)", font: "inherit", fontSize: 13, cursor: "pointer" },
      modeToggleActive: { minHeight: 34, border: 0, padding: "0 14px", background: "var(--dsw-alias-brand-primary)", color: "white", font: "inherit", fontSize: 13, fontWeight: 650, cursor: "pointer" },
      checkbox: { display: "flex", gap: 8, alignItems: "center", minHeight: 34, fontSize: 13 },
      segment: { display: "inline-grid", gridTemplateColumns: "1fr 1fr", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, overflow: "hidden", marginBottom: 14 },
      segmentButton: { border: 0, padding: "8px 12px", background: "transparent", color: "var(--dsw-alias-label-secondary)", font: "inherit", cursor: "pointer" },
      segmentActive: { border: 0, padding: "8px 12px", background: "var(--dsw-alias-brand-primary)", color: "white", font: "inherit", cursor: "pointer" },
      footer: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" },
      primary: { border: 0, borderRadius: 6, padding: "9px 14px", color: "white", background: "var(--dsw-alias-brand-primary)", font: "inherit", cursor: "pointer" },
      primaryDisabled: { border: 0, borderRadius: 6, padding: "9px 14px", color: "var(--dsw-alias-label-secondary)", background: "var(--dsw-alias-bg-layer-2)", font: "inherit" },
      ok: { margin: 0, color: "var(--dsw-alias-state-success-primary)", fontSize: 13 },
      error: { margin: 0, color: "var(--dsw-alias-state-error-primary)", fontSize: 13 },
    };
    return module.exports;
  }
});
