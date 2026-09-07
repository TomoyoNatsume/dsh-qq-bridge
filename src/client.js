window.__ModuleLoader__.load({
  id: "@yachangchang/dsh-qq-bridge",
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
      const attemptedDraft = React.useRef();
      const writeRevision = React.useRef();
      const detectionRevision = React.useRef(0);
      const [tagStates, setTagStates] = React.useState({ installed: "idle", runtime: "idle", login: "idle" });
      const [snapshot, setSnapshot] = React.useState(() => props.scope.getSnapshot());
      const [draft, setDraft] = React.useState(() => draftFrom(snapshot.value));
      const [generalDirty, setGeneralDirty] = React.useState(false);
      const [dirty, setDirty] = React.useState(false);
      const [pendingAction, setPendingAction] = React.useState("");
      const [message, setMessage] = React.useState("");
      const [napcatStatus, setNapcatStatus] = React.useState({ state: "idle", message: "正在等待检测 NapCat 状态。" });
      const [hostInfo, setHostInfo] = React.useState({ homeDir: "" });

      React.useEffect(() => props.scope.subscribe(() => {
        const next = props.scope.getSnapshot();
        setSnapshot(next);
        if (!dirty && !generalDirty) setDraft(draftFrom(next.value, hostInfo.homeDir));
      }), [props.scope, dirty, generalDirty, hostInfo.homeDir]);

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

      const detectStatus = async () => {
        const revision = ++detectionRevision.current;
        const active = () => revision === detectionRevision.current;
        await detectNapcatTags(props.rpc, (next) => { if (active()) setTagStates(next); }, active);
        if (!active()) return;
        try {
          const status = await callNapcatStatus(props.rpc, napcatLoginQqText(draft));
          if (active()) setNapcatStatus(status);
        } catch (error) {
          if (active()) setNapcatStatus({ state: "unavailable", message: String(error), commands: [] });
        }
      };
      React.useEffect(() => {
        detectionRevision.current += 1;
        setTagStates({ installed: "idle", runtime: "idle", login: "idle" });
        return () => { detectionRevision.current += 1; };
      }, [draft.platform, draft.napcat.accountMode, draft.napcat.loginQqText, draft.access.adminQqText]);

      React.useEffect(() => {
        if (draft.platform !== "napcat" || !draft.enabled || !props.rpc?.call) return undefined;
        let alive = true;
        let pending = false;
        const poll = async () => {
          if (pending) return;
          pending = true;
          try {
            const response = await props.rpc.call(NAPCAT_CHANNEL, "recovery", { adminQq: napcatLoginQqText(draft) });
            if (alive && response.ok) setNapcatStatus((prev) => ({ ...prev, recovery: response.value }));
          } catch { /* Retry on the next poll without affecting manual status tags. */ }
          finally { pending = false; }
        };
        void poll();
        const timer = setInterval(poll, 5000);
        return () => { alive = false; clearInterval(timer); };
      }, [props.rpc, draft.platform, draft.enabled, draft.napcat.accountMode, draft.napcat.loginQqText, draft.access.adminQqText]);

      const update = (path, value) => {
        if (isGeneralPath(path)) setGeneralDirty(true);
        else setDirty(true);
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
        setDraft((prev) => setPath(prev, ["platform"], platform));
      };
      const updateAgentProvider = (provider) => {
        setGeneralDirty(true);
        setDraft((prev) => {
          const models = modelOptionsForProvider(provider, prev.agent.model);
          const model = models.includes(prev.agent.model) ? prev.agent.model : models[0] || prev.agent.model;
          return setPath(setPath(prev, ["agent", "provider"], provider), ["agent", "model"], model);
        });
      };
      const persist = async (ops) => {
        const latest = props.scope.getSnapshot();
        const revision = Math.max(latest.revision ?? 0, writeRevision.current ?? 0);
        const response = await mutateSettings(props.api, { ...latest, revision }, ops);
        if (response.result.ok) writeRevision.current = response.result.value.revision;
        return response;
      };
      const cleanSavedDraft = (prev, enabled = prev.enabled) => ({ ...prev, enabled,
        official: { ...prev.official, appSecret: "", secretConfigured: prev.official.secretConfigured || Boolean(prev.official.appSecret.trim()) },
      });
      const saveAndStart = async () => {
        const enabled = true;
        const validationError = configurationError(draft);
        if (validationError) {
          setMessage(validationError);
          return;
        }
        setPendingAction("save");
        setMessage("");
        try {
          const response = await persist(platformOpsFromDraft(draft, napcatStatus, enabled));
          if (!response.result.ok) {
            setMessage(response.result.error?.message || "保存失败");
          } else {
            setDirty(false);
            setGeneralDirty(false);
            setDraft((prev) => cleanSavedDraft(prev, enabled));
            setMessage(draft.platform === "official" ? "配置已保存，QQ bridge 已启用。连接状态请在官方平台确认。" : "配置已自动保存。登录配置可点击“启动/重启Napcat”应用。");
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setPendingAction("");
        }
      };

      const refreshNapcatStatus = async () => {
        setPendingAction("refresh-napcat");
        setMessage("");
        setNapcatStatus({ state: "loading", message: "正在刷新 NapCat 状态..." });
        try {
          await detectStatus();
          setMessage("配置、安装、目标 QQ 进程和登录状态已刷新。");
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          setNapcatStatus({ state: "unavailable", message: text, commands: [] });
          setMessage(text);
        } finally {
          setPendingAction("");
        }
      };

      React.useEffect(() => {
        if (draft.platform !== "napcat") return;
        void refreshNapcatStatus();
      }, []);

      const startNapcat = async () => {
        setPendingAction("start-napcat");
        setMessage("");
        let setupStatus = napcatStatus;
        try {
          const installation = await props.rpc.call(NAPCAT_CHANNEL, "tag", { stage: "installed" });
          if (!installation.ok) throw new Error(installation.error?.message || "NapCat 安装检测失败");
          if (!installation.value.installed) {
            setMessage("NapCat 未安装，请先安装 NapCat 后再启动。");
            setNapcatStatus({ state: "not-installed", installed: false, message: "NapCat 未安装，请先安装。", commands: [] });
            return;
          }
          const validationError = configurationError(draft);
          if (validationError) { setMessage(validationError); return; }
          const saved = await persist(platformOpsFromDraft(draft, napcatStatus, draft.enabled));
          if (!saved.result.ok) throw new Error(saved.result.error?.message || "保存失败");
          if (draft.platform === "napcat") {
            setNapcatStatus({ state: "loading", message: "正在启动 NapCat 并配置 OneBot..." });
            setupStatus = await callNapcatSetup(props.rpc, napcatLoginQqText(draft));
            setNapcatStatus(setupStatus);
          }
          const response = await persist(platformOpsFromDraft(draft, setupStatus, true));
          if (!response.result.ok) {
            setMessage(response.result.error?.message || "启动失败");
          } else {
            setDirty(false);
            setGeneralDirty(false);
            setDraft((prev) => cleanSavedDraft(prev, true));
            setMessage(draft.platform === "napcat"
              ? napcatLogHint(setupStatus, napcatLoginQqText(draft))
              : "服务已启动。QQ bridge 已在当前 DSH Web 进程中启用。");
          }
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          if (draft.platform === "napcat") setNapcatStatus({ state: "unavailable", message: text, commands: [] });
          setMessage(text);
        } finally {
          setPendingAction("");
        }
      };

      const generalKey = JSON.stringify(generalOpsFromDraft(draft));
      React.useEffect(() => {
        if (!generalDirty || snapshot.status !== "ready" || !snapshot.writable || pendingAction || attemptedDraft.current === generalKey) return undefined;
        const timer = setTimeout(async () => {
          const error = generalConfigurationError(draft);
          if (error) { setMessage(error); return; }
          attemptedDraft.current = generalKey;
          setPendingAction("save-general");
          try {
            const response = await persist(generalOpsFromDraft(draft));
            if (!response.result.ok) throw new Error(response.result.error?.message || "保存失败");
            setGeneralDirty(false);
            setMessage("通用配置已自动保存。");
          } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
          } finally { setPendingAction(""); }
        }, 800);
        return () => clearTimeout(timer);
      }, [generalKey, generalDirty, snapshot.status, snapshot.writable, pendingAction]);

      const disabled = snapshot.status !== "ready" || !snapshot.writable || pendingAction !== "";
      const startNapcatDisabled = disabled || draft.platform !== "napcat";
      return h("div", { style: styles.page },
        h("div", { style: styles.header },
          h("div", { style: styles.titleRow },
            h("h2", { style: styles.title }, "QQ bridge"),

          ),
          h("p", { style: styles.subtle }, "通用配置自动保存；选择接入方式后，平台配置仅在点击启动按钮时提交。"),
        ),
        snapshot.status === "unavailable"
          ? h("p", { role: "alert", style: styles.error }, "当前连接不能写入本机设置，需在本机 loopback 的 DSH Web 中配置。")
          : null,
        h("section", { style: styles.band },
          h("h3", { style: styles.sectionTitle }, "通用配置"),
          h("p", { style: styles.subtle }, "配置应用后重建桥接服务，无需重启 DSH 或 NapCat；现有 QQ Agent 会话会被释放。"),
          h("div", { style: styles.grid },
            selectField("Provider", draft.agent.provider, providerOptions(draft.agent.provider), disabled, updateAgentProvider),
            selectField("Model", draft.agent.model, modelOptionsForProvider(draft.agent.provider, draft.agent.model), disabled, (value) => update(["agent", "model"], value)),
            textField("默认工作目录", draft.agent.cwd, disabled, (value) => update(["agent", "cwd"], value)),
            readonlyField("超时", "不限制"),
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
          h("h4", { style: styles.sectionTitle }, "安全与权限"),
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
          h("div", { role: "group", "aria-label": "接入方式", style: styles.segment },
            choiceButton("NapCat / OneBot", draft.platform === "napcat", disabled, () => updatePlatform("napcat")),
            choiceButton("官方 QQ Bot", draft.platform === "official", disabled, () => updatePlatform("official")),
          ),
        draft.platform === "napcat" ? h("section", { style: styles.band },
          h("div", { style: styles.titleRow },
            h("h3", { style: styles.sectionTitle }, "napcat登录配置"),
            statusTags(tagStates),
          ),
          tagStates.error ? h("p", { role: "alert", style: styles.error }, tagStates.error) : null,
          draft.platform === "napcat"
            ? h(NapcatFields, { draft, disabled, update, updateAdminQq, updateNapcatLoginQq, updateAccountMode, status: napcatStatus })
            : h("p", { style: styles.subtle }, "当前使用官方 QQ Bot，无需启动 NapCat。"),
          draft.platform === "napcat"
            ? h("div", { style: styles.cardActions },
                h("button", {
                  type: "button",
                  style: disabled ? styles.primaryDisabled : styles.secondary,
                  disabled,
                  onClick: refreshNapcatStatus,
                }, pendingAction === "refresh-napcat" ? "刷新中..." : "刷新状态"),
                h("button", {
                  type: "button",
                  style: startNapcatDisabled ? styles.primaryDisabled : styles.primary,
                  disabled: startNapcatDisabled,
                  onClick: startNapcat,
                }, pendingAction === "start-napcat" ? "启动中..." : "启动/重启Napcat"),
              )
            : null,
        ) : h("section", { style: styles.band },
          h("h3", { style: styles.sectionTitle }, "官方 QQ Bot 配置"),
          h(OfficialFields, { draft, disabled, update }),
          draft.platform === "official" ? h("div", { style: { ...styles.footer, justifyContent: "flex-end" } },
            h("button", { type: "button", disabled, onClick: saveAndStart,
              style: disabled ? styles.primaryDisabled : styles.primary,
            }, pendingAction === "save" ? "保存中..." : "保存并启动"),
          ) : null,
        ),
        message ? (message.startsWith("NapCat 未安装") ? warnCard(message, [], "alert") : statusMessage(message, isErrorMessage(message))) : null,
      );
    }

    function NapcatFields({ draft, disabled, update, updateAdminQq, updateNapcatLoginQq, updateAccountMode, status }) {
      const [showGuide, setShowGuide] = React.useState(false);
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
      const recoveryFields = h("div", { style: styles.stack },
        h("label", { style: styles.checkbox },
          h("input", { type: "checkbox", checked: draft.napcat.autoRestart, disabled,
            onChange: (event) => update(["napcat", "autoRestart"], event.currentTarget.checked) }),
          h("span", null, "掉线后自动重启并提示扫码"),
        ),
        h("p", { style: styles.subtle }, "掉线后重启一次，请打开 NapCat WebUI 或日志扫码登录。等待扫码期间不会反复重启。"),
        status.recovery ? statusMessage(status.recovery.message, ["needs-attention", "limited"].includes(status.recovery.state)) : null,
      );
      const setupGuide = napcatSetupGuide(showGuide, setShowGuide, napcatLoginQqText(draft));
      if (status.state === "loading") {
        return h("div", { style: styles.stack }, setupGuide, modeSwitch, loginField, senderField, logField, recoveryFields, warnCard("正在检测 NapCat...", [], "status"));
      }
      if (status.state === "not-installed") {
        return h("div", { style: styles.stack },
          setupGuide,
          modeSwitch,
          loginField,
          senderField,
          logField,
          recoveryFields,
          warnCard(status.message, status.commands || [], "alert"),
        );
      }
      if (status.state === "needs-admin") {
        return h("div", { style: styles.stack },
          setupGuide,
          modeSwitch,
          loginField,
          senderField,
          logField,
          recoveryFields,
          warnCard(status.message, status.commands || [], "status"),
        );
      }
      if (status.state === "not-running") {
        return h("div", { style: styles.stack },
          setupGuide,
          modeSwitch,
          loginField,
          senderField,
          logField,
          recoveryFields,
        );
      }
      if (status.state === "unavailable") {
        return h("div", { style: styles.stack },
          setupGuide,
          modeSwitch,
          loginField,
          senderField,
          logField,
          recoveryFields,
          warnCard(status.message, status.commands || [], "alert"),
        );
      }
      const wsUrl = status.onebot?.wsUrl ?? draft.napcat.wsUrl;
      const tokenPreview = status.onebot?.tokenPreview ?? "启动时生成";
      return h("div", { style: styles.stack },
        setupGuide,
        modeSwitch,
        h("div", { style: styles.grid },
          loginField,
          senderField,
          readonlyField("OneBot WebSocket", wsUrl),
          readonlyField("OneBot token", tokenPreview),
          logField,
          textField("命令前缀", draft.access.commandPrefix, disabled, (value) => update(["access", "commandPrefix"], value), "text", { placeholder: "(空)" }),
        ),
        recoveryFields,
        h("p", { style: styles.subtle }, status.message),
      );
    }

    function napcatSetupGuide(showGuide, setShowGuide, loginQq) {
      return h("details", { style: styles.guide },
        h("summary", { style: styles.secondary }, "如何安装和配置Napcat"),
        napcatGuideCard(loginQq),
      );
    }

    function napcatGuideCard(loginQq) {
      const qq = String(loginQq || "").trim();
      const logCommand = /^\d+$/.test(qq) ? `napcat log ${qq}` : "napcat log <你的QQ号>";
      return h("div", { id: "napcat-install-guide", role: "note", style: styles.guideCard },
        h("strong", { style: styles.warnTitle }, "NapCat 安装配置教程"),
        h("ol", { style: styles.guideList },
          h("li", null, "确认环境是 Linux 或 WSL2，并确保本机能使用 node、npm、pnpm。"),
          h("li", null, "安装 NapCat CLI 后运行 napcat help，确认系统里已经有 napcat 命令。"),
          h("li", null, "只需要安装 NapCat CLI，不需要自己先启动 QQ 后台；填写 NapCat 登录 QQ 后，点击“启动/重启Napcat”，插件会直接执行 napcat start。已有其他 QQ 运行时会先 stop 旧 QQ。"),
          h("li", null, "NapCat 首次启动并生成配置文件后，插件会写入 OneBot 正向 WebSocket 配置。"),
          h("li", null, "扫码登录时打开最后生成的二维码；如果发送 ping 没反应，用日志命令确认是否已经登录。"),
        ),
        commandBlock([
          "cd ~",
          "curl -o napcat.sh https://raw.githubusercontent.com/NapNeko/NapCat-Installer/main/script/install.sh",
          "bash napcat.sh --docker n --cli y",
          "napcat help",
          logCommand,
        ]),
        h("p", { style: styles.subtle }, "设置页会把 OneBot 正向 WebSocket 配到 127.0.0.1:3001，并创建或复用 token；不要把 OneBot 监听地址暴露到公网。"),
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
        "aria-pressed": active,
        disabled,
        onClick,
        style: active ? styles.segmentActive : styles.segmentButton,
      }, label);
    }

    function switchModeControl(mode, disabled, onChange) {
      return h("div", { role: "group", "aria-label": "账号模式", style: styles.grid },
        ...[["single", "单号模式"], ["dual", "双号模式"]].map(([value, label]) =>
          h("label", { key: value, style: styles.checkbox },
            h("input", { type: "radio", name: "qq-bridge-account-mode", checked: mode === value, disabled, onChange: () => onChange(value) }),
            h("span", null, label),
          )),
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
        warnMessage(message),
        commands && commands.length > 0
          ? commandBlock(commands)
          : null,
      );
    }

    function warnMessage(message) {
      return h("div", { style: styles.messageBlock },
        normalizeCommandLines([message]).map((line, index) => messageLineNode(line, index, index === 0)),
      );
    }

    function statusMessage(message, error) {
      const napcatSetupInfo = !error && String(message || "").startsWith("已完成 NapCat/OneBot 配置。");
      return h("div", { role: "status", style: error ? styles.error : napcatSetupInfo ? styles.successInfo : styles.ok },
        normalizeCommandLines([message]).map((line, index) => messageLineNode(line, index, napcatSetupInfo && index === 0)),
      );
    }

    function messageLineNode(line, index, emphasized) {
      const key = `${index}-${line}`;
      if (isCodeMessageLine(line)) return h("code", { key, style: styles.messageCodeLine }, line);
      return emphasized
        ? h("strong", { key, style: styles.warnTitle }, line)
        : h("span", { key, style: styles.messageLine }, line);
    }

    function isCodeMessageLine(line) {
      const text = String(line || "").trim();
      return text.startsWith("/") || /^~\//.test(text) || /^napcat\s+/.test(text);
    }

    function commandBlock(lines) {
      const normalized = normalizeCommandLines(lines);
      return h("div", { style: styles.codeBlock },
        normalized.map((line, index) => h("code", { key: `${index}-${line}`, style: styles.codeLine }, line)),
      );
    }

    function normalizeCommandLines(lines) {
      return (lines || [])
        .flatMap((line) => String(line ?? "").split(/\r?\n/))
        .map((line) => line.trimEnd())
        .filter(Boolean);
    }

    function isErrorMessage(value) {
      return /失败|只允许|不能为空|请先|不可用|无法|无响应|未找到/.test(value);
    }

    async function detectNapcatTags(rpc, update, active = () => true) {
      const states = { installed: "checking", runtime: "checking", login: "checking" };
      const publish = () => update({ ...states });
      const check = async (stage, extra = {}) => {
        if (!rpc || typeof rpc.call !== "function") throw new Error("NapCat 检测接口不可用，请检查 DSH Web 连接。");
        const response = await rpc.call(NAPCAT_CHANNEL, "tag", { stage, ...extra });
        if (!response.ok) {
          const detail = response.error?.message || "检测接口请求失败";
          if (/unknown NapCat endpoint.*tag/i.test(detail)) throw new Error("DSH 后端尚未加载新版 NapCat 检测接口。请重启 dsh web 后刷新页面（无需重启 NapCat）。");
          throw new Error(detail);
        }
        const field = { installed: "installed", runtime: "running", login: "loggedIn" }[stage];
        if (typeof response.value?.[field] !== "boolean") throw new Error("NapCat 检测接口返回格式不正确，请确认 DSH 前后端插件版本一致。");
        return response.value;
      };
      publish();
      let stage = "installed";
      try {
        const installation = await check(stage);
        if (!active()) return;
        states.installed = installation.installed ? "yes" : "no";
        if (!installation.installed) {
          states.runtime = "no"; states.login = "no"; publish(); return;
        }
        publish();
        stage = "runtime";
        const runtime = await check(stage);
        if (!active()) return;
        states.runtime = runtime.running ? "yes" : "no";
        if (!runtime.running) { states.login = "no"; publish(); return; }
        publish();
        stage = "login";
        let loggedIn = false;
        for (const qq of runtime.runningQqs) {
          const login = await check(stage, { qq });
          if (!active()) return;
          if (login.loggedIn) { loggedIn = true; break; }
        }
        states.login = loggedIn ? "yes" : "no";
        publish();
      } catch (error) {
        if (!active()) return;
        states.error = error instanceof Error ? error.message : String(error);
        states[stage] = "error";
        if (stage === "installed") states.runtime = "blocked";
        if (stage !== "login") states.login = "blocked";
        publish();
      }
    }

    function statusTags(states) {
      return h("div", { style: styles.tags, "aria-live": "polite" },
        ...[["installed", "安装"], ["runtime", "启动"], ["login", "登录"]].map(([key, label]) => {
          const state = states[key];
          const text = state === "checking" ? `NapCat ${label}：正在检测` : state === "error" ? `NapCat ${label}：检测失败` : state === "blocked" || state === "idle" ? `NapCat ${label}：暂未检测` : `NapCat ${state === "yes" ? "已" : "未"}${label}`;
          return h("span", { key, title: states.error || text, style: state === "checking" || state === "error" || state === "blocked" || state === "idle" ? styles.tagNeutral : state === "yes" ? styles.tagOk : styles.tagWarn }, text);
        }),
      );
    }

    function numberField(label, value, disabled, onChange, extra = {}) {
      return textField(label, value === undefined ? "" : String(value), disabled, (next) => onChange(Number(next) || 0), "number", extra);
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
      if (status?.logState && status.logState !== "ready") return `找不到，请通过 napcat log ${qq} 查看`;
      if (status?.logState === "ready" && status.logPath) return status.logPath;
      if (draft.selfLogInput?.logPath?.trim()) return draft.selfLogInput.logPath.trim();
      return `启动服务后生成；找不到时请通过 napcat log ${qq} 查看`;
    }

    async function callNapcatSetup(rpc, adminQq) {
      if (!rpc || typeof rpc.call !== "function") {
        throw new Error("当前 DSH Web 没有暴露本机 NapCat setup 接口。");
      }
      const response = await rpc.call(NAPCAT_CHANNEL, "setup", { adminQq });
      if (!response.ok) throw new Error(response.error?.message || "NapCat setup 失败");
      return response.value;
    }

    async function callNapcatStart(rpc, adminQq) {
      if (!rpc || typeof rpc.call !== "function") {
        throw new Error("当前 DSH Web 没有暴露本机 NapCat setup 接口。");
      }
      const response = await rpc.call(NAPCAT_CHANNEL, "setup", { adminQq });
      if (!response.ok) throw new Error(response.error?.message || "NapCat 启动失败");
      return response.value;
    }

    async function callNapcatStatus(rpc, adminQq) {
      if (!rpc || typeof rpc.call !== "function") {
        throw new Error("当前 DSH Web 没有暴露本机 NapCat status 接口。");
      }
      const response = await rpc.call(NAPCAT_CHANNEL, "status", { adminQq });
      if (!response.ok) throw new Error(response.error?.message || "NapCat 状态检测失败");
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
          autoRestart: source.napcat?.autoRestart !== false,
          loginQqText: napcatLoginQq > 0 ? String(napcatLoginQq) : accountMode === "single" && accessAdminQq > 0 ? String(accessAdminQq) : "",
          wsUrl: source.napcat?.wsUrl ?? "ws://127.0.0.1:3001",
        },
        official: {
          appId: source.official?.appId ?? "",
          appSecret: "",
          secretConfigured: Boolean(source.official?.appSecret),
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

    function isGeneralPath(path) {
      return ["agent", "notifications", "permissionDefault"].includes(path[0]) || (path[0] === "access" && path[1] === "mode");
    }

    function generalOpsFromDraft(draft) {
      return [
        ...["provider", "model", "cwd", "streamText"].map((key) => set(["agent", key], draft.agent[key])),
        set(["access", "mode"], draft.access.mode),
        set(["permissionDefault"], draft.permissionDefault),
        set(["notifications", "agentReply", "enabled"], draft.notifications.agentReplyEnabled),
      ];
    }

    function platformOpsFromDraft(draft, status, enabled) {
      return opsFromDraft(draft, status, enabled).filter(({ path }) =>
        draft.platform === "napcat" ? path[0] !== "official" :
          !["napcat", "selfLogInput"].includes(path[0]) && !(path[0] === "access" && ["adminQq", "allowlist"].includes(path[1])),
      );
    }

    function opsFromDraft(draft, napcatStatus, enabled) {
      const detectedOnebot = draft.platform === "napcat" && napcatStatus?.state === "ready" ? napcatStatus.onebot : undefined;
      const detectedLogPath = napcatLogPathForSettings(draft, napcatStatus);
      const loginQq = Number(napcatLoginQqText(draft)) || 0;
      const senderQq = draft.napcat.accountMode === "single" ? loginQq : Number(draft.access.adminQqText) || 0;
      const ops = [
        set(["enabled"], Boolean(enabled)),
        set(["platform"], draft.platform),
        set(["napcat", "loginQq"], loginQq),
        set(["napcat", "autoRestart"], draft.napcat.autoRestart),
        set(["napcat", "wsUrl"], detectedOnebot?.wsUrl ?? draft.napcat.wsUrl),
        set(["official", "appId"], draft.official.appId),
        set(["official", "adminOpenId"], draft.official.adminOpenId),
        set(["official", "allowlistOpenIds"], splitLines(draft.official.allowlistOpenIdsText)),
        set(["official", "sandbox"], draft.official.sandbox),
        set(["access", "adminQq"], senderQq),
        set(["access", "allowlist"], []),
        set(["access", "commandPrefix"], draft.access.commandPrefix),
        set(["access", "mode"], draft.access.mode),
        set(["agent"], {
          preset: "dsh-qq-bridge",
          provider: draft.agent.provider,
          model: draft.agent.model,
          cwd: draft.agent.cwd,
          streamText: draft.agent.streamText,
          streamReasoning: false,
          maxMessageLength: 4500,
          ackMessage: "收到，正在处理...",
          qqReplyStyleSkill: { enabled: true, skillName: "qq-session-reply-style" },
        }),
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

    function configurationComplete(draft) {
      return configurationError(draft) === "";
    }

    function validQq(value) {
      return /^\d+$/.test(String(value).trim()) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
    }

    function generalConfigurationError(draft) {
      if (!["whitelist", "open"].includes(draft.access.mode)) return "请选择有效的访问模式。";
      if (!["workspace-write", "danger-full-access", "keep"].includes(draft.permissionDefault)) return "请选择有效的默认权限。";
      if (!String(draft.agent.provider || "").trim()) return "请选择 Agent Provider。";
      if (!String(draft.agent.model || "").trim()) return "请选择 Agent Model。";
      if (!String(draft.agent.cwd || "").trim()) return "默认工作目录不能为空。";
      return "";
    }

    function configurationError(draft) {
      if (!["napcat", "official"].includes(draft.platform)) return "请选择有效的接入方式。";
      const generalError = generalConfigurationError(draft);
      if (generalError) return generalError;
      if (draft.platform === "official") {
        if (!String(draft.official.appId || "").trim()) return "AppID 不能为空。";
        if (!draft.official.secretConfigured && !String(draft.official.appSecret || "").trim()) return "AppSecret 不能为空。";
        if (draft.access.mode === "whitelist" && !String(draft.official.adminOpenId || "").trim()) return "Admin OpenID 不能为空。";
        return "";
      }
      if (!validQq(napcatLoginQqText(draft))) return "NapCat 登录 QQ 必须是正整数，且不能超出安全整数范围。";
      if (draft.napcat.accountMode === "dual" && !validQq(draft.access.adminQqText)) return "发送端 QQ 必须是正整数，且不能超出安全整数范围。";
      return "";
    }

    function mutateSettings(api, snapshot, ops) {
      return api.settings.mutate({
        ns: NS,
        ops,
        ...(snapshot.revision === undefined ? {} : { expectedRevision: snapshot.revision }),
      });
    }

    function napcatLogPathForSettings(draft, napcatStatus) {
      if (draft.platform !== "napcat") return draft.selfLogInput?.logPath?.trim() || "";
      if (napcatStatus?.state === "ready") {
        return napcatStatus.logState === "ready" && napcatStatus.logPath ? napcatStatus.logPath : "";
      }
      return draft.selfLogInput?.logPath?.trim() || "";
    }

    function napcatLogHint(status, qq) {
      const logPath = status?.logPath || "";
      const qqText = String(qq || "").trim();
      const command = qqText ? `napcat log ${qqText}` : "napcat log <QQ>";
      return logPath
        ? ["已启动 NapCat 进程，请打开 NapCat 日志文件", logPath, "或执行", command, "查看日志，确保已经扫码登陆。"].join("\n")
        : ["已启动 NapCat 进程，请执行", command, "查看日志，确保已经扫码登陆。"].join("\n");
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
      page: { display: "grid", gap: 16, width: "100%", maxWidth: 880, minWidth: 0, boxSizing: "border-box", color: "var(--dsw-alias-label-primary)" },
      header: { display: "grid", gap: 6, minWidth: 0, maxWidth: "100%" },
      titleRow: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", minWidth: 0, maxWidth: "100%" },
      tags: { display: "flex", justifyContent: "flex-end", gap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0, maxWidth: "100%" },
      title: { margin: 0, fontSize: 22, fontWeight: 650 },
      subtle: { margin: "6px 0 0", color: "var(--dsw-alias-label-secondary)", lineHeight: 1.5, fontSize: 13, minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" },
      band: { border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8, padding: 16, background: "var(--dsw-alias-bg-layer-1)", width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", overflow: "hidden" },
      cardActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14, minWidth: 0, maxWidth: "100%" },
      sectionTitle: { margin: "0 0 12px", fontSize: 14, fontWeight: 650 },
      stack: { display: "grid", gap: 12, minWidth: 0, maxWidth: "100%" },
      grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12, minWidth: 0, maxWidth: "100%" },
      field: { display: "grid", gap: 6, minWidth: 0, maxWidth: "100%", boxSizing: "border-box" },
      label: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", minWidth: 0, overflowWrap: "anywhere" },
      input: { minWidth: 0, width: "100%", maxWidth: "100%", height: 34, boxSizing: "border-box", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", padding: "0 10px", font: "inherit" },
      readonly: { display: "block", minWidth: 0, width: "100%", maxWidth: "100%", minHeight: 34, boxSizing: "border-box", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-secondary)", padding: "7px 10px", font: "inherit", overflowWrap: "anywhere", whiteSpace: "normal" },
      warn: { border: "1px solid var(--dsw-alias-state-warning-primary, #b7791f)", borderRadius: 8, background: "color-mix(in srgb, var(--dsw-alias-state-warning-primary, #b7791f) 10%, transparent)", padding: 14, display: "grid", gap: 10, minWidth: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box", overflow: "hidden" },
      warnTitle: { fontSize: 15, lineHeight: 1.55, fontWeight: 650, minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" },
      messageBlock: { display: "grid", gap: 5, minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" },
      messageLine: { display: "block", minWidth: 0, maxWidth: "100%", fontSize: 14, lineHeight: 1.55, overflowWrap: "anywhere", whiteSpace: "normal" },
      messageCodeLine: { display: "block", minWidth: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box", borderRadius: 6, padding: "6px 8px", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13, lineHeight: 1.5, overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
      codeBlock: { margin: 0, padding: 10, borderRadius: 6, background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: 12, lineHeight: 1.45, display: "grid", gap: 5, minWidth: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box" },
      codeLine: { display: "block", minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit" },
      guide: { display: "grid", justifyItems: "start", gap: 10, minWidth: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box" },
      guideCard: { border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8, background: "var(--dsw-alias-bg-layer-2)", padding: 14, display: "grid", gap: 10, minWidth: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box", overflow: "hidden" },
      guideList: { margin: 0, paddingLeft: 20, color: "var(--dsw-alias-label-secondary)", fontSize: 13, lineHeight: 1.65, minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" },
      switchRow: { display: "flex", gap: 8, alignItems: "center", fontSize: 13 },
      tagOk: { display: "inline-flex", alignItems: "center", flexShrink: 0, height: 24, padding: "0 9px", borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: "nowrap", cursor: "help", color: "var(--dsw-alias-state-success-primary)", background: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 38%, transparent)" },
      tagReady: { display: "inline-flex", alignItems: "center", flexShrink: 0, height: 24, padding: "0 9px", borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: "nowrap", cursor: "help", color: "var(--dsw-alias-brand-primary)", background: "color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, transparent)" },
      tagWarn: { display: "inline-flex", alignItems: "center", flexShrink: 0, height: 24, padding: "0 9px", borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: "nowrap", cursor: "help", color: "var(--dsw-alias-state-warning-primary, #b7791f)", background: "color-mix(in srgb, var(--dsw-alias-state-warning-primary, #b7791f) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #b7791f) 36%, transparent)" },
      tagNeutral: { display: "inline-flex", alignItems: "center", flexShrink: 0, height: 24, padding: "0 9px", borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: "nowrap", cursor: "help", color: "var(--dsw-alias-label-secondary)", background: "var(--dsw-alias-bg-layer-2)", border: "1px solid var(--dsw-alias-border-l1)" },
      modeToggle: { display: "inline-grid", gridTemplateColumns: "1fr 1fr", width: "min(100%, 280px)", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, overflow: "hidden", background: "var(--dsw-alias-bg-base)" },
      modeToggleButton: { minWidth: 0, minHeight: 34, border: 0, padding: "0 14px", background: "transparent", color: "var(--dsw-alias-label-secondary)", font: "inherit", fontSize: 13, cursor: "pointer", overflowWrap: "anywhere" },
      modeToggleActive: { minWidth: 0, minHeight: 34, border: 0, padding: "0 14px", background: "var(--dsw-alias-brand-primary)", color: "white", font: "inherit", fontSize: 13, fontWeight: 650, cursor: "pointer", overflowWrap: "anywhere" },
      checkbox: { display: "flex", gap: 8, alignItems: "center", minHeight: 34, fontSize: 13, minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" },
      segment: { display: "inline-grid", gridTemplateColumns: "1fr 1fr", width: "min(100%, 320px)", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, overflow: "hidden", marginBottom: 14 },
      segmentButton: { minWidth: 0, border: 0, padding: "8px 12px", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-secondary)", font: "inherit", cursor: "pointer", overflowWrap: "anywhere" },
      segmentActive: { minWidth: 0, border: 0, padding: "8px 12px", background: "var(--dsw-alias-brand-primary)", color: "white", font: "inherit", cursor: "pointer", overflowWrap: "anywhere" },
      footer: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", minWidth: 0, maxWidth: "100%" },
      primary: { maxWidth: "100%", boxSizing: "border-box", border: 0, borderRadius: 6, padding: "9px 14px", color: "white", background: "var(--dsw-alias-brand-primary)", font: "inherit", cursor: "pointer", overflowWrap: "anywhere" },
      primaryDisabled: { maxWidth: "100%", boxSizing: "border-box", border: 0, borderRadius: 6, padding: "9px 14px", color: "var(--dsw-alias-label-secondary)", background: "var(--dsw-alias-bg-layer-2)", font: "inherit", overflowWrap: "anywhere" },
      secondary: { maxWidth: "100%", boxSizing: "border-box", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1)", padding: "8px 12px", color: "var(--dsw-alias-label-primary)", background: "var(--dsw-alias-bg-base)", font: "inherit", fontSize: 13, cursor: "pointer", overflowWrap: "anywhere", whiteSpace: "normal", textAlign: "left" },
      ok: { margin: 0, color: "var(--dsw-alias-state-success-primary)", fontSize: 14, display: "grid", gap: 5, minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" },
      successInfo: { flexBasis: "100%", margin: 0, padding: 14, borderRadius: 8, border: "1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 42%, transparent)", background: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)", color: "var(--dsw-alias-state-success-primary)", fontSize: 14, display: "grid", gap: 5, minWidth: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box", overflowWrap: "anywhere" },
      error: { margin: 0, color: "var(--dsw-alias-state-error-primary)", fontSize: 14, display: "grid", gap: 5, minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" },
    };
    return module.exports;
  }
});
