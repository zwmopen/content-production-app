const { contextBridge, ipcRenderer, webUtils } = require("electron");

try {
  window.alert = (msg) => { console.warn("[Suppressed window.alert]", msg); };
  window.confirm = (msg) => { console.warn("[Suppressed window.confirm]", msg); return true; };
} catch (_) {}

contextBridge.exposeInMainWorld("desktopFiles", {
  getPath(file) {
    return webUtils.getPathForFile(file);
  }
});

contextBridge.exposeInMainWorld("desktopDialogs", {
  pickFolder(options = {}) {
    return ipcRenderer.invoke("desktop:pick-folder", {
      title: String(options.title || "选择文件夹"),
      defaultPath: String(options.defaultPath || "")
    });
  },
  pickFile(options = {}) {
    return ipcRenderer.invoke("desktop:pick-file", {
      title: String(options.title || "选择要传送的文件"),
      defaultPath: String(options.defaultPath || "")
    });
  }
});

contextBridge.exposeInMainWorld("wechatWorkbench", {
  available: true,
  status() {
    return ipcRenderer.invoke("desktop:wechat-draft-status");
  },
  show(bounds = {}) {
    return ipcRenderer.invoke("desktop:wechat-draft-show", { bounds });
  },
  hide() {
    return ipcRenderer.invoke("desktop:wechat-draft-hide");
  },
  navigate(action = "home", targetUrl = "") {
    return ipcRenderer.invoke("desktop:wechat-draft-navigate", {
      action: String(action || "home"),
      targetUrl: String(targetUrl || "")
    });
  },
  runDraft(input = {}) {
    return ipcRenderer.invoke("desktop:wechat-draft-run", {
      postPath: String(input.postPath || ""),
      title: String(input.title || ""),
      body: String(input.body || ""),
      images: Array.isArray(input.images) ? input.images.map(String) : [],
      draftType: input.draftType === "article" ? "article" : "newspic",
      autoSave: input.autoSave !== false
    });
  },
  onUrlChanged(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, input) => callback(input || {});
    ipcRenderer.on("desktop:wechat-draft-url-changed", listener);
    return () => ipcRenderer.removeListener("desktop:wechat-draft-url-changed", listener);
  }
});

contextBridge.exposeInMainWorld("onlinePlatformWorkbench", {
  available: true,
  status(platformId = "wechat") {
    return ipcRenderer.invoke("desktop:online-platform-status", String(platformId || "wechat"));
  },
  show(platformId = "wechat", bounds = {}) {
    return ipcRenderer.invoke("desktop:online-platform-show", {
      platformId: String(platformId || "wechat"),
      bounds
    });
  },
  hide(platformId = "") {
    return ipcRenderer.invoke("desktop:online-platform-hide", String(platformId || ""));
  },
  navigate(platformId = "wechat", action = "home", targetUrl = "") {
    return ipcRenderer.invoke("desktop:online-platform-navigate", {
      platformId: String(platformId || "wechat"),
      action: String(action || "home"),
      targetUrl: String(targetUrl || "")
    });
  },
  ctripDraft(input = {}) {
    return ipcRenderer.invoke("desktop:ctrip-draft-run", {
      title: String(input.title || ""),
      body: String(input.body || ""),
      topics: Array.isArray(input.topics) ? input.topics.map(String) : [],
      images: Array.isArray(input.images) ? input.images.map(String) : []
    });
  }
});

contextBridge.exposeInMainWorld("gptWorkbench", {
  available: true,
  assistantOverlay: true,
  updateAssistant(input = {}) {
    return ipcRenderer.invoke("desktop:assistant-update", input);
  },
  onAssistantAction(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, input) => callback(input || {});
    ipcRenderer.on("desktop:assistant-action", listener);
    return () => ipcRenderer.removeListener("desktop:assistant-action", listener);
  },
  status(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-status", String(accountId || ""));
  },
  pageHealth(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-page-health", String(accountId || ""));
  },
  show(bounds, accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-show", {
      bounds,
      accountId: String(accountId || "")
    });
  },
  hide() {
    return ipcRenderer.invoke("desktop:gpt-hide");
  },
  setTheme(theme = "neo") {
    return ipcRenderer.invoke("desktop:gpt-theme", { theme: String(theme || "neo") });
  },
  releaseIdle(minutes = 30) {
    return ipcRenderer.invoke("desktop:gpt-release-idle", { minutes: Number(minutes || 30) });
  },
  maintenance(input = {}) {
    return ipcRenderer.invoke("desktop:gpt-maintenance", {
      accountId: String(input.accountId || ""),
      clearTemporaryCache: Boolean(input.clearTemporaryCache || input.clearCache),
      reason: String(input.reason || "")
    });
  },
  recreate(input = {}) {
    return ipcRenderer.invoke("desktop:gpt-recreate", {
      accountId: String(input.accountId || ""),
      reason: String(input.reason || ""),
      forceRecovery: input.forceRecovery === true,
      controlledRecovery: input.controlledRecovery === true,
      allowActiveTaskRecovery: input.allowActiveTaskRecovery === true,
      recoveryRequestId: String(input.recoveryRequestId || ""),
      knownConversationUrl: String(input.knownConversationUrl || ""),
      freshRoot: input.freshRoot === true,
      invalidConversationUrl: String(input.invalidConversationUrl || "")
    });
  },
  navigate(action, accountId = "", targetUrl = "") {
    return ipcRenderer.invoke("desktop:gpt-navigate", {
      action: String(action || "reload"),
      accountId: String(accountId || ""),
      targetUrl: String(targetUrl || "")
    });
  },
  onUrlChanged(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, input) => callback(input || {});
    ipcRenderer.on("desktop:gpt-url-changed", listener);
    return () => ipcRenderer.removeListener("desktop:gpt-url-changed", listener);
  },
  onLoadingChanged(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, input) => callback(input || {});
    ipcRenderer.on("desktop:gpt-loading-changed", listener);
    return () => ipcRenderer.removeListener("desktop:gpt-loading-changed", listener);
  },
  reload(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-navigate", {
      action: "reload",
      accountId: String(accountId || "")
    });
  },
  sendTask(task) {
    return ipcRenderer.invoke("desktop:gpt-send-task", task);
  },
  pausePendingTask(accountId = "", requestId = "") {
    return ipcRenderer.invoke("desktop:gpt-pause-pending-task", {
      accountId: String(accountId || ""),
      requestId: String(requestId || "")
    });
  },
  stopCurrentTask(accountId = "", requestId = "", options = {}) {
    const stopOptions = options && typeof options === "object" ? options : {};
    return ipcRenderer.invoke("desktop:gpt-stop-current-task", {
      accountId: String(accountId || ""),
      requestId: String(requestId || ""),
      userInitiated: stopOptions.userInitiated !== false,
      reason: String(stopOptions.reason || "user-stop"),
      recoveryConversationUrl: String(stopOptions.recoveryConversationUrl || "")
    });
  },
  setUserHold(accountId = "", held = false) {
    return ipcRenderer.invoke("desktop:gpt-set-user-hold", {
      accountId: String(accountId || ""),
      held: Boolean(held)
    });
  },
  workflowStatus(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-workflow-status", String(accountId || ""));
  },
  inspectStatus(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-inspect-status", String(accountId || ""));
  },
  discoverPatrolConversations(accountId = "", options = {}) {
    return ipcRenderer.invoke("desktop:gpt-patrol-discover", {
      accountId: String(accountId || ""),
      denylist: Array.isArray(options.denylist) ? options.denylist.map(String) : [],
      maximumScrolls: Number(options.maximumScrolls || 16)
    });
  },
  continuePatrolConversation(accountId = "", options = {}) {
    return ipcRenderer.invoke("desktop:gpt-patrol-continue", {
      accountId: String(accountId || ""),
      targetUrl: String(options.targetUrl || ""),
      denylist: Array.isArray(options.denylist) ? options.denylist.map(String) : [],
      confirmText: String(options.confirmText || "1"),
      copyPrompt: String(options.copyPrompt || ""),
      generationRequestCount: Number(options.generationRequestCount || 0),
      maximumGenerationRequests: Number(options.maximumGenerationRequests || 5),
      productionRequestId: String(options.productionRequestId || ""),
      materialName: String(options.materialName || ""),
      sourceMaterialPath: String(options.sourceMaterialPath || ""),
      templateId: String(options.templateId || ""),
      downloadRoot: String(options.downloadRoot || ""),
      productRoot: String(options.productRoot || ""),
      autoArchive: options.autoArchive !== false,
      allowUntitledRecovery: Boolean(options.allowUntitledRecovery),
      allowStaleComposerRecovery: Boolean(options.allowStaleComposerRecovery),
      allowExistingPackageRelease: Boolean(options.allowExistingPackageRelease),
      existingPackagePath: String(options.existingPackagePath || ""),
      existingPackageImages: Math.max(0, Number(options.existingPackageImages || 0)),
      durableImageUrls: Array.isArray(options.durableImageUrls)
        ? options.durableImageUrls.map(String).filter(Boolean).slice(0, 10)
        : [],
      durableImageCount: Math.max(0, Number(options.durableImageCount || 0)),
      inspectOnly: Boolean(options.inspectOnly)
    });
  },
  diagnostic(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-diagnostic", String(accountId || ""));
  },
  manualAction(action = "download", accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-manual-action", {
      action: String(action || "download"),
      accountId: String(accountId || "")
    });
  },
  loginRecoveryStatus(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-login-recovery-status", String(accountId || ""));
  },
  createLoginRecovery(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-login-recovery-create", String(accountId || ""));
  },
  restoreLoginRecovery(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-login-recovery-restore", String(accountId || ""));
  },
  profiles() {
    return ipcRenderer.invoke("desktop:gpt-profiles");
  },
  saveProfile(profile = {}) {
    return ipcRenderer.invoke("desktop:gpt-profile-save", profile);
  },
  reorderProfiles(accountIds = []) {
    return ipcRenderer.invoke("desktop:gpt-profile-reorder", Array.isArray(accountIds) ? accountIds : []);
  },
  hideProfile(profile = {}) {
    return ipcRenderer.invoke("desktop:gpt-profile-hide", profile);
  },
  removeProfile(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-profile-remove", String(accountId || ""));
  },
  deleteProfileLogin(accountId = "") {
    return ipcRenderer.invoke("desktop:gpt-profile-delete-login", String(accountId || ""));
  },
  setProductionActive(active = false, accountId = "") {
    const id = String(accountId || "").trim();
    return id
      ? ipcRenderer.invoke("desktop:production-active", { active: Boolean(active), accountId: id })
      : ipcRenderer.invoke("desktop:production-active", Boolean(active));
  },
  getLaunchAtLogin() {
    return ipcRenderer.invoke("desktop:launch-at-login-get");
  },
  setLaunchAtLogin(enabled = false) {
    return ipcRenderer.invoke("desktop:launch-at-login-set", Boolean(enabled));
  },
  notify(input = "", body = "") {
    const payload = input && typeof input === "object"
      ? input
      : { title: String(input || ""), body: String(body || "") };
    return ipcRenderer.invoke("desktop:notify", payload);
  },
  restartApp(options = {}) {
    return ipcRenderer.invoke("desktop:restart-app", {
      source: String(options.source || "automation").slice(0, 64),
      interactive: options.interactive === true
    });
  },
  onPauseProduction(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = () => callback();
    ipcRenderer.on("desktop:pause-production", listener);
    return () => ipcRenderer.removeListener("desktop:pause-production", listener);
  },
  onWindowRestored(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = () => callback();
    ipcRenderer.on("desktop:window-restored", listener);
    return () => ipcRenderer.removeListener("desktop:window-restored", listener);
  }
});
