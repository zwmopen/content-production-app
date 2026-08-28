const { app, BrowserWindow, WebContentsView, dialog, ipcMain, session, Tray, Menu, Notification, screen } = require("electron");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { version: APP_VERSION } = require("../package.json");
const {
  classifyWorkbenchPortProbe,
  formatPortInUseMessage
} = require("../lib/workbench-port");
const {
  normalizeChatConversationUrl,
  resolveGptStartupUrl,
  isGptPageProductionReady
} = require("../lib/gpt-session-guard");
const {
  planGptPageRecovery,
  isGptPageDocumentStable,
  shouldDeferGptPageRecovery,
  shouldPreserveGptPageAfterReadTimeout,
  shouldAbortPendingGptTask,
  shouldEscalateGptBridgeTimeout
} = require("../lib/gpt-page-recovery");
const {
  TEMPORARY_WEB_CACHE_INTERVAL_MS,
  TEMPORARY_WEB_CACHE_STARTUP_GRACE_MS,
  planTemporaryWebCacheCleanup
} = require("../lib/temporary-web-cache-schedule");
const { shouldKeepGptAccountView } = require("../lib/gpt-view-continuity");
const { readRuntimeState } = require("../lib/gpt-runtime-state");
const {
  defaultAccountId: defaultInstanceAccountId,
  getInstanceConfig,
  instanceIdForPort,
  normalizeInstanceId,
  resolveAssignedAccountIds
} = require("../lib/instance-account-policy");
const {
  WECHAT_HOME_URL,
  classifyWechatWebPage,
  normalizeWechatWebDraft,
  buildWechatWebProbeScript,
  buildWechatWebFillScript,
  buildWechatWebMoveCaretScript,
  buildWechatWebSaveScript,
  buildWechatWebOpenEditorScript
} = require("../lib/wechat-web-automation");

// Some Windows machines repeatedly lose the Electron GPU subprocess during
// startup (exit code -1073741515), which otherwise terminates the whole app.
// The workbench is automation/UI bound, so software compositing is the safer
// default and keeps unattended production recoverable after a restart.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch(`disable-gpu`);
app.commandLine.appendSwitch(`disable-gpu-compositing`);

// Use the unified userData directory.  The environment variable is set by
// start.ps1, but if it is missing (e.g. launched via a shortcut that loses
// the variable), fall back to the canonical path so account profiles and
// login state are never silently lost.
const CONTENT_INSTANCE_ID = normalizeInstanceId(
  process.env.CONTENT_INSTANCE_ID || instanceIdForPort(process.env.PORT || "")
);
const CONTENT_INSTANCE_LABEL = String(process.env.CONTENT_INSTANCE_LABEL || `实例 ${CONTENT_INSTANCE_ID}`).trim();
const CONTENT_ONLY_MODE = String(process.env.CONTENT_ONLY_MODE || "") === "1";
const INSTANCE_CONFIG = getInstanceConfig(CONTENT_INSTANCE_ID);
const DEFAULT_INSTANCE_PORT = String(INSTANCE_CONFIG.port);
const DEFAULT_REMOTE_DEBUGGING_PORT = String(INSTANCE_CONFIG.remoteDebuggingPort);
const DEFAULT_INSTANCE_RUNTIME = `D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-${CONTENT_INSTANCE_ID}`;
const TB_USER_DATA_ROOT = process.env.TB_USER_DATA_ROOT
  || path.join(DEFAULT_INSTANCE_RUNTIME, "electron-userdata");
app.setPath("userData", path.resolve(TB_USER_DATA_ROOT));
// Electron's single-instance lock is keyed by the app name.  A-D are
// intentionally separate production applications with separate login stores;
// give each one its own lock namespace so starting A cannot silently focus B
// and exit before its own window is created. Set the user-data root first so
// the lock and the login profile are resolved from the same instance context.
app.setName(`jianghu-content-production-${CONTENT_INSTANCE_ID.toLowerCase()}`);

const APP_PORT = String(process.env.PORT || DEFAULT_INSTANCE_PORT).trim() || DEFAULT_INSTANCE_PORT;
const APP_URL = `http://127.0.0.1:${APP_PORT}/`;
// Fresh-session uploads get a finite pre-submit window.  If the native bridge
// is still unresponsive after it, automatic recovery may take ownership of
// the account instead of deferring forever behind the pending request.
const GPT_PRE_SUBMIT_DISPATCH_GRACE_MS = 180_000;
const RUNTIME_ROOT = process.env.TEAMBUILDING_DASHBOARD_RUNTIME || DEFAULT_INSTANCE_RUNTIME;
const APP_TITLE = `内容生产 · ${CONTENT_INSTANCE_LABEL}`;
const ASSIGNED_ACCOUNT_IDS = new Set(
  resolveAssignedAccountIds(CONTENT_INSTANCE_ID, process.env.CONTENT_ACCOUNT_IDS, { contentOnlyMode: CONTENT_ONLY_MODE })
);
const DESKTOP_LOG_FILE = path.join(RUNTIME_ROOT, "desktop.log");
const GPT_RUNTIME_STATE_FILE = path.join(RUNTIME_ROOT, "gpt-production-runtime.json");
const GPT_LOGIN_RECOVERY_ROOT = path.join(RUNTIME_ROOT, "gpt-login-recovery");
const GPT_PENDING_BACKUP_FILE = path.join(GPT_LOGIN_RECOVERY_ROOT, "pending-backup.json");
const GPT_PENDING_RESTORE_FILE = path.join(GPT_LOGIN_RECOVERY_ROOT, "pending-restore.json");
let serverProcess = null;
let mainWindow = null;
let assistantOverlayWindow = null;
const gptJavaScriptInFlight = new WeakMap();
// A single GPT WebContents can receive inspect/status/result probes from
// different recovery loops at the same time. Chromium does not provide a
// cancellation primitive for executeJavaScript, so duplicate evaluations on
// the same channel must remain serialized. Keep the tails per channel,
// however: a stalled inspect/status probe must not block the workflow upload
// channel for the same account window.
const gptJavaScriptExecutionTails = new WeakMap();
const GPT_INITIALIZATION_TIMEOUT_MS = 10_000;
// Busy GPT renderers can leave a read probe queued behind a long-running
// conversation update. After a few consecutive timeouts, briefly back off
// read probes so the native renderer can drain instead of creating a timeout
// storm that makes the whole workbench feel frozen. Control commands are
// never throttled by this health state.
const gptJavaScriptReadHealth = new WeakMap();
let assistantOverlayState = {
  message: "",
  bubbleVisible: true,
  catVisible: true,
  theme: "neo",
  cursorX: 0,
  cursorY: 0,
  settings: {}
};
let assistantCursorTimer = null;
// While the user interacts with the child overlay, Windows can briefly report
// both it and the parent as unfocused. Keep a short grace period so a drag or
// click cannot make the cat flicker or disappear.
let assistantOverlayInteractionUntil = 0;
let tray = null;
let isExplicitQuit = false;
let quitFlushStarted = false;
let quitFlushCompleted = false;
let productionTaskActive = false;
let legacyProductionTaskActive = false;
const productionTaskAccounts = new Set();
let gptThemeName = "neo";
const gptAccounts = new Map();
// Long ChatGPT conversations can each consume hundreds of MB in Chromium.
// Creating every account renderer at the same instant makes the oldest
// conversations start as blank shells and then trips the load watchdog. Keep
// startup/recovery creation bounded; once a view exists, account workers stay
// independent and may still produce in parallel.
const GPT_ACCOUNT_INITIALIZATION_CONCURRENCY = 1;
let gptAccountInitializationActive = 0;
const gptAccountInitializationQueue = [];
let activeGptAccountId = defaultInstanceAccountId(CONTENT_INSTANCE_ID);
let wechatDraftView = null;
const onlinePlatformViews = new Map();
const onlinePlatformStates = new Map();
let wechatDraftPageState = {
  loading: false,
  domReady: false,
  error: "",
  startedAt: "",
  finishedAt: ""
};
let wechatDraftRunPromise = null;
let ctripDraftRunPromise = null;

const GPT_PARTITION_PREFIX = "persist:teambuilding-gpt-production";
const WECHAT_DRAFT_PARTITION = "persist:teambuilding-wechat-draft";
const ONLINE_PLATFORM_PARTITION_PREFIX = "persist:teambuilding-online-platform";
const WORKBENCH_PARTITION = "persist:teambuilding-workbench-0.12.2";
const GPT_URL = "https://chatgpt.com/";
const ONLINE_PLATFORM_WEB_CONFIG = Object.freeze({
  wechat: { name: "公众号", homeUrl: "https://mp.weixin.qq.com/", hosts: ["mp.weixin.qq.com"] },
  xiaohongshu: { name: "小红书", homeUrl: "https://creator.xiaohongshu.com/publish/publish", hosts: ["creator.xiaohongshu.com"] },
  douyin: { name: "抖音", homeUrl: "https://creator.douyin.com/creator-micro/content/upload", hosts: ["creator.douyin.com"] },
  x: { name: "X / 推特", homeUrl: "https://x.com/compose/post", hosts: ["x.com", "twitter.com"] },
  ctrip: { name: "携程旅行", homeUrl: "https://we.ctrip.com/publish/contentManagement", hosts: ["we.ctrip.com", "ctrip.com"] }
});
const GPT_BROWSER_PROFILES_FILE = "gpt-browser-profiles.json";
const ASSISTANT_OVERLAY_POSITION_FILE = "assistant-overlay-position.json";
const ASSISTANT_OVERLAY_SIZE = { width: 460, height: 330 };
const ASSISTANT_OVERLAY_CAT_BOUNDS = {
  width: 96,
  height: 116,
  top: 37,
  leftWhenBubbleRight: 4,
  leftWhenBubbleLeft: 360
};
// Chromium's HTTP/media cache is disposable; account sessions are not. Keep
// the cleanup deliberately separate from clearStorageData so login cookies,
// localStorage, IndexedDB and production checkpoints remain untouched.
let temporaryWebCacheCleanupTimer = null;
let temporaryWebCacheCleanupLastRunAt = 0;
let temporaryWebCacheCleanupStartupGraceUntil = Date.now() + TEMPORARY_WEB_CACHE_STARTUP_GRACE_MS;

function assistantOverlayPositionFile() {
  return path.join(app.getPath("userData"), ASSISTANT_OVERLAY_POSITION_FILE);
}

function persistedGptUserHold(accountId) {
  const key = String(accountId || "").trim();
  if (!key) return false;
  const runtime = readRuntimeState(GPT_RUNTIME_STATE_FILE);
  const accountRuntime = runtime?.control?.windowRuntime?.[key];
  return Boolean(accountRuntime?.pausedByUser || accountRuntime?.stoppedByUser);
}

function defaultAssistantOverlayBounds() {
  const parent = mainWindow?.getBounds() || { x: 0, y: 0, width: 1520, height: 940 };
  return { ...ASSISTANT_OVERLAY_SIZE, x: parent.x + parent.width - 438, y: parent.y + 54 };
}

function readAssistantOverlayBounds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(assistantOverlayPositionFile(), "utf8"));
    if ([parsed.x, parsed.y].every(Number.isFinite)) return { ...defaultAssistantOverlayBounds(), x: parsed.x, y: parsed.y };
  } catch {}
  return defaultAssistantOverlayBounds();
}

function clampAssistantOverlayBounds(bounds) {
  const parent = mainWindow?.getBounds() || { x: 0, y: 0, width: 1520, height: 940 };
  const { width, height } = ASSISTANT_OVERLAY_SIZE;
  const workArea = screen.getDisplayMatching(parent)?.workArea || parent;
  const rawX = Number(bounds.x);
  const rawY = Number(bounds.y);
  const fallbackX = parent.x + parent.width - width - 18;
  const fallbackY = parent.y + 54;
  const requestedX = Number.isFinite(rawX) ? rawX : fallbackX;
  const dockSide = requestedX + width / 2 < workArea.x + workArea.width / 2 ? "right" : "left";
  const catLeft = dockSide === "right" ? ASSISTANT_OVERLAY_CAT_BOUNDS.leftWhenBubbleRight : ASSISTANT_OVERLAY_CAT_BOUNDS.leftWhenBubbleLeft;
  const catTop = ASSISTANT_OVERLAY_CAT_BOUNDS.top;
  const catWidth = ASSISTANT_OVERLAY_CAT_BOUNDS.width;
  const catHeight = ASSISTANT_OVERLAY_CAT_BOUNDS.height;
  return {
    width,
    height,
    x: Math.max(workArea.x - catLeft, Math.min(workArea.x + workArea.width - (catLeft + catWidth), requestedX)),
    y: Math.max(workArea.y - catTop, Math.min(workArea.y + workArea.height - (catTop + catHeight), Number.isFinite(rawY) ? rawY : fallbackY))
  };
}

function assistantOverlayDockSide(bounds) {
  const workArea = screen.getDisplayMatching(bounds)?.workArea || mainWindow?.getBounds() || { x: 0, width: 1520 };
  return bounds.x + bounds.width / 2 < workArea.x + workArea.width / 2 ? "right" : "left";
}

function sendAssistantOverlayState() {
  if (!assistantOverlayWindow || assistantOverlayWindow.isDestroyed()) return;
  assistantOverlayWindow.webContents.send("assistant-overlay:state", assistantOverlayState);
}

function assistantOverlayIsDetached() {
  return assistantOverlayState.settings?.detached === true;
}

function applyAssistantOverlayWindowMode(overlay = assistantOverlayWindow) {
  if (!overlay || overlay.isDestroyed()) return;
  const detached = assistantOverlayIsDetached();
  const alwaysOnTop = assistantOverlayState.settings?.alwaysOnTop === true;
  overlay.setParentWindow(detached ? null : mainWindow);
  overlay.setAlwaysOnTop(detached && alwaysOnTop, "floating", 1);
}

function hideAttachedAssistantOverlayWhenInactive() {
  setTimeout(() => {
    if (assistantOverlayIsDetached()) return;
    if (Date.now() < assistantOverlayInteractionUntil) return;
    if (mainWindow?.isFocused() || assistantOverlayWindow?.isFocused()) return;
    assistantOverlayWindow?.hide();
  }, 120);
}

function showAssistantOverlayForWorkbench() {
  if (!assistantOverlayWindow || assistantOverlayWindow.isDestroyed()) return;
  if (assistantOverlayState.catVisible === false) return;
  if (assistantOverlayIsDetached() || mainWindow?.isFocused()) assistantOverlayWindow.showInactive();
}

function updateAssistantCursorDirection() {
  if (!assistantOverlayWindow || assistantOverlayWindow.isDestroyed()) return;
  const motionEnabled = assistantOverlayState.settings?.motionEnabled !== false;
  let cursorX = 0;
  let cursorY = 0;
  if (assistantOverlayState.catVisible !== false && motionEnabled) {
    const bounds = assistantOverlayWindow.getBounds();
    const dockSide = assistantOverlayState.dockSide === "right" ? "right" : "left";
    const catLeft = dockSide === "right" ? ASSISTANT_OVERLAY_CAT_BOUNDS.leftWhenBubbleRight : ASSISTANT_OVERLAY_CAT_BOUNDS.leftWhenBubbleLeft;
    const centerX = bounds.x + catLeft + ASSISTANT_OVERLAY_CAT_BOUNDS.width / 2;
    const centerY = bounds.y + ASSISTANT_OVERLAY_CAT_BOUNDS.top + ASSISTANT_OVERLAY_CAT_BOUNDS.height * 0.42;
    const cursor = screen.getCursorScreenPoint();
    cursorX = Math.max(-1, Math.min(1, (cursor.x - centerX) / 260));
    cursorY = Math.max(-1, Math.min(1, (cursor.y - centerY) / 220));
  }
  if (Math.abs(cursorX - Number(assistantOverlayState.cursorX || 0)) < 0.025
    && Math.abs(cursorY - Number(assistantOverlayState.cursorY || 0)) < 0.025) return;
  assistantOverlayState = { ...assistantOverlayState, cursorX, cursorY };
  sendAssistantOverlayState();
}

async function ensureAssistantOverlay() {
  if (!mainWindow || assistantOverlayWindow && !assistantOverlayWindow.isDestroyed()) return assistantOverlayWindow;
  const initialBounds = clampAssistantOverlayBounds(readAssistantOverlayBounds());
  assistantOverlayState = { ...assistantOverlayState, dockSide: assistantOverlayDockSide(initialBounds) };
  const overlay = new BrowserWindow({
    ...initialBounds,
    parent: mainWindow,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, "assistant-overlay-preload.js")
    }
  });
  assistantOverlayWindow = overlay;
  overlay.setMenuBarVisibility(false);
  // 透明区域点击穿透：初始忽略鼠标事件，只有鼠标进入小猫/气泡时才恢复
  overlay.setIgnoreMouseEvents(true, { forward: true });
  // The cat belongs to the workbench by default. System-level floating is an
  // explicit opt-in and only applies after the user also allows detaching it.
  applyAssistantOverlayWindowMode(overlay);
  // Do not hide on the child overlay's blur.  During a drag or a pointer-mode
  // handoff Electron briefly reports the transparent child as blurred even
  // though the workbench is still focused; hiding here made the cat flicker
  // or disappear mid-drag.  The parent window's blur handler below remains
  // the single authority for leaving the workbench.
  overlay.on("close", (event) => {
    if (isExplicitQuit) return;
    event.preventDefault();
    overlay.hide();
  });
  overlay.on("closed", () => {
    assistantOverlayWindow = null;
    if (assistantCursorTimer) clearInterval(assistantCursorTimer);
    assistantCursorTimer = null;
  });
  await overlay.loadURL(`${APP_URL}assistant-overlay.html?appVersion=${encodeURIComponent(APP_VERSION)}`);
  sendAssistantOverlayState();
  if (!assistantCursorTimer) assistantCursorTimer = setInterval(updateAssistantCursorDirection, 50);
  if (mainWindow.isFocused() && assistantOverlayState.catVisible !== false) overlay.showInactive();
  return overlay;
}

function durableRuntimeAppRoot() {
  return path.join(RUNTIME_ROOT, "runtime-builds", APP_VERSION, "app");
}

function isDevMode() {
  // app.isPackaged 在 Electron 43.x 中通过 execPath 是否为 electron.exe 来判断
  // 但当我们直接用 node_modules/electron/dist/electron.exe 运行 main.js 时仍然返回 true
  // 更可靠的方式：检查可执行文件名是否为 electron.exe
  return path.basename(process.execPath).toLowerCase() === "electron.exe";
}

function ensureDurableRuntimeResources() {
  if (isDevMode()) return path.resolve(__dirname, "..");
  const source = path.resolve(__dirname, "..");
  const target = durableRuntimeAppRoot();
  const manifestFile = path.join(target, "runtime-manifest.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (manifest.version === APP_VERSION && fs.existsSync(path.join(target, "server.js"))) return target;
  } catch {
    // First launch or an interrupted older copy: refresh this version in place.
  }
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true, errorOnExist: false });
  fs.writeFileSync(manifestFile, JSON.stringify({ version: APP_VERSION, copiedAt: new Date().toISOString(), source }, null, 2), "utf8");
  appendDesktopLog("durable-runtime-ready", target);
  return target;
}

function runtimeAppRoot() {
  if (isDevMode()) return path.resolve(__dirname, "..");
  const durable = durableRuntimeAppRoot();
  return fs.existsSync(path.join(durable, "runtime-manifest.json")) ? durable : ensureDurableRuntimeResources();
}

function gptBrowserProfilesFile() {
  return path.join(app.getPath("userData"), GPT_BROWSER_PROFILES_FILE);
}

function safeGptProductionMode(value = "manual", fallback = "manual") {
  const normalized = String(value || fallback || "manual").trim().toLowerCase();
  const migrated = ["multi", "rotate", "all-day-multi", "multi-account"].includes(normalized) ? "single" : normalized;
  return ["manual", "semi-auto", "automatic", "single", "scheduled", "patrol", "all-day"].includes(migrated)
    ? migrated
    : String(fallback || "manual");
}

function safeGptWorkflowVariant(value = "legacy-v1") {
  const normalized = String(value || "legacy-v1").trim().toLowerCase();
  return ["legacy-v1", "fresh-session-fixed-template"].includes(normalized)
    ? normalized
    : "legacy-v1";
}

function defaultBrowserProfiles() {
  const firstAssignedAccountId = [...ASSIGNED_ACCOUNT_IDS][0] || defaultInstanceAccountId(CONTENT_INSTANCE_ID);
  return {
    version: 1,
    activeId: firstAssignedAccountId,
    profiles: [{
      id: firstAssignedAccountId,
      name: `账号窗口 ${firstAssignedAccountId.replace("account-", "")}`,
      quotaGroup: firstAssignedAccountId,
      mode: "single",
      workflowVariant: "legacy-v1",
      workflowVariantVersion: "1",
      experimentId: "",
      sessionPolicy: "reuse-conversation",
      hidden: false,
      disabled: false,
      lastUrl: GPT_URL,
      lastBrowserUrl: GPT_URL,
      lastConversationUrl: "",
      lastInvalidConversationUrl: "",
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString()
    }]
  };
}

function readBrowserProfiles() {
  try {
    const parsed = JSON.parse(fs.readFileSync(gptBrowserProfilesFile(), "utf8").replace(/^\uFEFF/, ""));
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles.filter((profile) => {
        const accountId = profile && safeGptAccountId(profile.id);
        return accountId && (!ASSIGNED_ACCOUNT_IDS.size || ASSIGNED_ACCOUNT_IDS.has(accountId));
      }).map((profile, index) => ({
        id: safeGptAccountId(profile.id),
        name: (/^浏览器\s*\d+$/i.test(String(profile.name || "")) ? `账号窗口 ${index + 1}` : String(profile.name || `账号窗口 ${index + 1}`)).slice(0, 24),
        quotaGroup: safeGptAccountId(profile.quotaGroup || profile.id),
        mode: safeGptProductionMode(profile.mode),
        workflowVariant: safeGptWorkflowVariant(profile.workflowVariant),
        workflowVariantVersion: String(profile.workflowVariantVersion || "1").slice(0, 40),
        experimentId: String(profile.experimentId || "").slice(0, 80),
        assignmentAt: String(profile.assignmentAt || "").slice(0, 40),
        sessionPolicy: String(profile.sessionPolicy || (safeGptWorkflowVariant(profile.workflowVariant) === "fresh-session-fixed-template" ? "fresh-session" : "reuse-conversation")).slice(0, 80),
        selectedTemplateId: String(profile.selectedTemplateId || "").slice(0, 80),
        templateConversationUrl: normalizeChatConversationUrl(profile.templateConversationUrl),
        workflowProfileId: String(profile.workflowProfileId || "").slice(0, 80),
        hidden: Boolean(profile.hidden),
        ...(Object.prototype.hasOwnProperty.call(profile, "disabled")
          ? { disabled: Boolean(profile.disabled) }
          : {}),
        lastUrl: safeGptUrl(profile.lastUrl),
        lastBrowserUrl: safeBrowserUrlOrDefault(profile.lastBrowserUrl || profile.lastUrl || GPT_URL),
        lastConversationUrl: normalizeChatConversationUrl(profile.lastConversationUrl || profile.lastUrl),
        lastInvalidConversationUrl: normalizeChatConversationUrl(profile.lastInvalidConversationUrl),
        createdAt: String(profile.createdAt || new Date().toISOString()),
        lastOpenedAt: String(profile.lastOpenedAt || "")
      })).slice(0, 8)
      : [];
    if (!profiles.length) return writeBrowserProfiles(defaultBrowserProfiles());
    return {
      version: 1,
      activeId: profiles.some((profile) => profile.id === parsed.activeId) ? parsed.activeId : profiles[0].id,
      profiles
    };
  } catch {
    return writeBrowserProfiles(defaultBrowserProfiles());
  }
}

function safeGptUrl(value = "") {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || !["chatgpt.com", "www.chatgpt.com", "chat.openai.com"].includes(parsed.hostname)) return GPT_URL;
    if (/^\/(?:auth|login|logout)(?:\/|$)/i.test(parsed.pathname)) return GPT_URL;
    return parsed.href;
  } catch {
    return GPT_URL;
  }
}

// The embedded GPT surface is also a real browser tab.  Keep navigation
// limited to normal web URLs so an address pasted into the workbench cannot
// execute javascript, open local files, or jump into a privileged Electron
// scheme.  The persistent account partition is intentionally reused by the
// caller, so visiting another site does not create a second login session.
function safeBrowserUrl(value = "") {
  let raw = String(value || "").trim();
  if (!raw) throw new Error("请输入要访问的网址");
  if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) {
    raw = /^(?:localhost|127(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2})(?::\d+)?(?:\/|$)/i.test(raw)
      ? `http://${raw}`
      : `https://${raw}`;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("网址格式不正确，请输入 http:// 或 https:// 地址");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("只允许访问 http:// 或 https:// 网页");
  }
  if (parsed.username || parsed.password) {
    throw new Error("为保护账号安全，不允许在网址中携带用户名或密码");
  }
  return parsed.href;
}

function safeBrowserUrlOrDefault(value = "", fallback = GPT_URL) {
  try {
    return safeBrowserUrl(value || fallback);
  } catch {
    return fallback;
  }
}

function resolveGptRecoveryTargetUrl(account) {
  const liveUrl = safeBrowserUrlOrDefault(account?.view?.webContents?.getURL?.(), "");
  const savedProfile = readBrowserProfiles().profiles.find((profile) => profile.id === safeGptAccountId(account?.id));
  const profile = savedProfile
    ? { ...savedProfile, lastBrowserUrl: liveUrl || savedProfile.lastBrowserUrl || "" }
    : { lastBrowserUrl: liveUrl };
  return safeBrowserUrlOrDefault(
    resolveGptStartupUrl(profile, liveUrl || GPT_URL),
    liveUrl || GPT_URL
  );
}

function patrolConversationUrlInput(value = "") {
  // The extension's patrol ledger key is intentionally scoped by material:
  // https://chatgpt.com/c/<conversation>::material:<length>:<hash>. It is a
  // ledger identifier, not a navigable URL; strip only that known suffix.
  return String(value || "").trim().replace(/::material:\d+:[0-9a-f]+$/i, "");
}

function safePatrolConversationUrl(value = "") {
  const parsed = new URL(safeBrowserUrl(patrolConversationUrlInput(value)));
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const directConversation = /^\/c\/[a-z0-9_-]+(?:\/[^/]*)?$/i.test(pathname);
  const customGptConversation = /^\/g\/[a-z0-9_-]+\/c\/[a-z0-9_-]+(?:\/[^/]*)?$/i.test(pathname);
  if (!["chatgpt.com", "www.chatgpt.com", "chat.openai.com"].includes(parsed.hostname.toLowerCase())
    || (!directConversation && !customGptConversation)) {
    throw new Error("巡检续接只允许访问明确的 ChatGPT 对话链接");
  }
  parsed.pathname = pathname;
  parsed.search = "";
  parsed.hash = "";
  return parsed.href.replace(/\/$/, "");
}

function rememberGptUrl(accountId, value) {
  const nextUrl = safeGptUrl(value);
  if (nextUrl === GPT_URL && String(value || "").trim() !== GPT_URL) return;
  const state = readBrowserProfiles();
  const profile = state.profiles.find((item) => item.id === safeGptAccountId(accountId));
  if (!profile || profile.lastUrl === nextUrl) return;
  profile.lastUrl = nextUrl;
  profile.lastOpenedAt = new Date().toISOString();
  writeBrowserProfiles(state);
}

function rememberBrowserUrl(accountId, value) {
  const nextUrl = safeBrowserUrlOrDefault(value, "");
  if (!nextUrl) return;
  const state = readBrowserProfiles();
  const profile = state.profiles.find((item) => item.id === safeGptAccountId(accountId));
  if (!profile) return;
  const conversationUrl = normalizeChatConversationUrl(nextUrl);
  const browserUrlChanged = profile.lastBrowserUrl !== nextUrl;
  const conversationChanged = Boolean(conversationUrl && profile.lastConversationUrl !== conversationUrl);
  if (!browserUrlChanged && !conversationChanged) return;
  profile.lastBrowserUrl = nextUrl;
  if (conversationUrl) {
    profile.lastConversationUrl = conversationUrl;
    profile.lastUrl = conversationUrl;
    if (profile.lastInvalidConversationUrl
      && profile.lastInvalidConversationUrl !== conversationUrl) {
      profile.lastInvalidConversationUrl = "";
    }
  } else if (nextUrl === GPT_URL) {
    // A renderer reload or a failed ChatGPT navigation can briefly report the
    // home URL even though this account still owns a durable conversation
    // checkpoint. Keep that checkpoint so an app restart returns to the same
    // account conversation instead of silently falling back to the homepage.
    // Explicit home/new-chat commands clear it before navigation below.
    profile.lastUrl = profile.lastConversationUrl || GPT_URL;
  }
  profile.lastOpenedAt = new Date().toISOString();
  writeBrowserProfiles(state);
  // Navigation can also happen inside the embedded browser itself (clicking a
  // conversation, a shared template, or an external page), without going
  // through the renderer's address-bar handler. Push the live URL back to the
  // workbench so the visible address bar follows the active account window.
  mainWindow?.webContents.send("desktop:gpt-url-changed", {
    accountId: safeGptAccountId(accountId),
    url: nextUrl
  });
}

function gptPartitionIds() {
  const profileState = readBrowserProfiles();
  return [...new Set([
    ...profileState.profiles.map((profile) => safeGptAccountId(profile.id)),
    ...gptAccounts.keys()
  ])];
}

async function clearReproducibleWebCaches(reason = "manual", options = {}) {
  const includeGpt = options.includeGpt !== false;
  const partitions = [
    ...(includeGpt
      ? gptPartitionIds().map((id) => session.fromPartition(`${GPT_PARTITION_PREFIX}-${id}`))
      : []),
    session.fromPartition(WECHAT_DRAFT_PARTITION),
    ...Object.keys(ONLINE_PLATFORM_WEB_CONFIG).map((id) => session.fromPartition(`${ONLINE_PLATFORM_PARTITION_PREFIX}-${id}`))
  ];
  let cleared = 0;
  let failed = 0;
  for (const profileSession of partitions) {
    try {
      // Only Chromium's disposable HTTP/media cache is cleared here. This is
      // Never call clearStorageData() here: clearing that would log out
      // accounts and erase site-local state used by the web automation.
      await profileSession.clearCache();
      cleared += 1;
    } catch (error) {
      failed += 1;
      appendDesktopLog("web-cache-clear-failed", `${reason} ${error?.message || error}`);
    }
  }
  appendDesktopLog("web-cache-cleared", `reason=${reason} partitions=${partitions.length} cleared=${cleared} failed=${failed}`);
  return { ok: failed === 0, reason, partitions: partitions.length, cleared, failed };
}

function startTemporaryWebCacheCleanup() {
  if (temporaryWebCacheCleanupTimer) clearTimeout(temporaryWebCacheCleanupTimer);
  const schedule = () => {
    const activeTaskCount = productionTaskAccounts.size + (legacyProductionTaskActive ? 1 : 0);
    const plan = planTemporaryWebCacheCleanup({
      now: new Date(),
      lastRunAt: temporaryWebCacheCleanupLastRunAt,
      activeTaskCount,
      startupGraceUntil: temporaryWebCacheCleanupStartupGraceUntil,
      intervalMs: TEMPORARY_WEB_CACHE_INTERVAL_MS
    });
    if (plan.action === "run") {
      temporaryWebCacheCleanupTimer = setTimeout(() => {
        temporaryWebCacheCleanupTimer = null;
        const finalPlan = planTemporaryWebCacheCleanup({
          now: new Date(),
          lastRunAt: temporaryWebCacheCleanupLastRunAt,
          activeTaskCount: productionTaskAccounts.size + (legacyProductionTaskActive ? 1 : 0),
          startupGraceUntil: temporaryWebCacheCleanupStartupGraceUntil,
          intervalMs: TEMPORARY_WEB_CACHE_INTERVAL_MS
        });
        if (finalPlan.action !== "run") {
          schedule();
          return;
        }
        // The GPT partitions are long-lived production sessions. Clearing
        // their HTTP cache here can invalidate active page resources between
        // two queue steps and trigger a false bridge/load recovery. GPT cache
        // maintenance remains available through the per-account safe boundary;
        // this global timer only handles unrelated web workspaces.
        clearReproducibleWebCaches("scheduled-3h", { includeGpt: false })
          .then(() => { temporaryWebCacheCleanupLastRunAt = Date.now(); })
          .catch((error) => {
            appendDesktopLog("web-cache-clear-unhandled", String(error?.message || error));
          })
          .finally(schedule);
      }, 1_000);
      temporaryWebCacheCleanupTimer.unref?.();
      return;
    }
    if (plan.reason === "production-active" || plan.reason === "outside-work-hours") {
      appendDesktopLog("web-cache-clear-deferred", `reason=${plan.reason} nextAt=${new Date(plan.nextAt).toISOString()} activeWorkers=${activeTaskCount}`);
    }
    temporaryWebCacheCleanupTimer = setTimeout(() => {
      temporaryWebCacheCleanupTimer = null;
      schedule();
    }, Math.max(1_000, Number(plan.delayMs || 0)));
    temporaryWebCacheCleanupTimer.unref?.();
  };
  schedule();
}

function notifyGptLoadingChanged(accountId, loading, failed = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:gpt-loading-changed", {
    accountId: safeGptAccountId(accountId),
    loading: Boolean(loading),
    failed: Boolean(failed)
  });
}

function writeBrowserProfiles(value) {
  const file = gptBrowserProfilesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  return value;
}

function safeGptAccountId(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || defaultInstanceAccountId(CONTENT_INSTANCE_ID);
}

function assertAssignedGptAccountId(value = "", options = {}) {
  const id = safeGptAccountId(value);
  if (ASSIGNED_ACCOUNT_IDS.size > 0 && !ASSIGNED_ACCOUNT_IDS.has(id)) {
    const error = new Error(`当前实例 ${CONTENT_INSTANCE_ID} 未绑定账号 ${id}`);
    error.code = "CONTENT_ACCOUNT_NOT_ASSIGNED";
    throw error;
  }
  if (options.required === true && !String(value || "").trim()) {
    const error = new Error("当前请求缺少账号标识");
    error.code = "CONTENT_ACCOUNT_REQUIRED";
    throw error;
  }
  return id;
}

function gptPartitionDirectory(accountId = activeGptAccountId) {
  const id = safeGptAccountId(accountId);
  return path.join(app.getPath("userData"), "Partitions", `teambuilding-gpt-production-${id}`);
}

function gptRecoveryDirectory(accountId = activeGptAccountId) {
  return path.join(GPT_LOGIN_RECOVERY_ROOT, safeGptAccountId(accountId), "profile");
}

function recoveryMetadataFile(accountId = activeGptAccountId) {
  return path.join(GPT_LOGIN_RECOVERY_ROOT, safeGptAccountId(accountId), "recovery.json");
}

function isInsideDirectory(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function copyDirectorySnapshot(source, target) {
  if (!fs.existsSync(source)) throw new Error("当前账号还没有可备份的本机登录档案");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    if (!isInsideDirectory(GPT_LOGIN_RECOVERY_ROOT, target)) throw new Error("恢复点目录不安全");
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.cpSync(source, target, { recursive: true, force: true, errorOnExist: false });
}

async function releaseGptAccountView(accountId = activeGptAccountId) {
  const id = safeGptAccountId(accountId);
  const account = gptAccounts.get(id);
  if (!account) return;
  if (account.loadRecoveryTimer) clearTimeout(account.loadRecoveryTimer);
  if (account.loadRecoveryResetTimer) clearTimeout(account.loadRecoveryResetTimer);
  account.gptThemeReplayTimers?.forEach((timer) => clearTimeout(timer));
  account.gptThemeReplayTimers = [];
  try {
    await Promise.resolve(account.session?.flushStorageData?.());
  } catch {
    // Releasing a view must continue even when Chromium cannot flush one store.
  }
  if (account.view && !account.view.webContents.isDestroyed()) {
    account.view.setVisible(false);
    try {
      mainWindow?.contentView.removeChildView(account.view);
    } catch {
      // The view may already have been detached.
    }
    account.view.webContents.close();
  }
  gptAccounts.delete(id);
  appendDesktopLog("gpt-view-released", `account=${id} reason=idle-or-explicit`);
}

async function recreateGptAccountView(accountId = activeGptAccountId, options = {}) {
  const id = assertAssignedGptAccountId(accountId);
  const account = gptAccounts.get(id);
  const runtime = readRuntimeState(GPT_RUNTIME_STATE_FILE)?.control?.windowRuntime?.[id] || {};
  const recoveryRequestId = String(options.recoveryRequestId || "").trim();
  const allowActiveTaskRecovery = options.allowActiveTaskRecovery === true
    && Boolean(recoveryRequestId);
  const controlledRecovery = options.controlledRecovery === true
    && Boolean(recoveryRequestId)
    && (["retry-wait", "failed", "probing"].includes(String(runtime.status || ""))
      || allowActiveTaskRecovery)
    && runtime.pausedByUser !== true
    && runtime.stoppedByUser !== true
    && !account?.maintenancePromise;
  const knownConversationUrl = String(options.knownConversationUrl || "").trim();
  const freshRoot = options.freshRoot === true;
  if (controlledRecovery && freshRoot) {
    const profiles = readBrowserProfiles();
    const profile = profiles.profiles.find((item) => item.id === id);
    if (profile) {
      profile.lastUrl = GPT_URL;
      profile.lastBrowserUrl = GPT_URL;
      profile.lastConversationUrl = "";
      profile.lastInvalidConversationUrl = normalizeChatConversationUrl(
        options.invalidConversationUrl || profile.lastInvalidConversationUrl
      );
      writeBrowserProfiles(profiles);
    }
  }
  if (controlledRecovery && /\/c\//i.test(knownConversationUrl)) {
    // Persist the original conversation before release. ensureGptAccount()
    // will reopen this exact /c/... URL from the same profile partition.
    rememberBrowserUrl(id, knownConversationUrl);
  }
  const currentUrl = String(account?.view?.webContents?.getURL?.() || "").split(/[?#]/)[0].replace(/\/$/, "");
  const rootPageNotReady = account?.pageState?.loading === true
    || account?.pageState?.finished !== true
    || account?.pageState?.extensionReady !== true;
  const rootPageLoadStall = options.forceRecovery === true
    && rootPageNotReady
    && (!currentUrl || currentUrl === "https://chatgpt.com")
    && !/生图|生成图片|等待图片|图片生成|文案|下载|打包|归档/.test(String(runtime.currentStage || ""));
  // Once the bridge timeout handler has aborted the native request it owns
  // the recovery of this account's current task.  Do not let the still-live
  // renderer worker/task bookkeeping veto the one recreate that is meant to
  // repair that dead bridge.  The pending request must already be cleared;
  // user holds and maintenance still keep the normal safety gate closed.
  const bridgeRecoveryOwnsTask = options.reason === "stalled-conversation-bridge"
    && account?.bridgeRecoveryPending === true
    && !account?.pendingGptTask
    && !account?.userRecoveryHold
    && !account?.maintenancePromise
    && runtime.pausedByUser !== true
    && runtime.stoppedByUser !== true;
  const bridgeRecoveryRecreate = options.reason === "stalled-conversation-bridge"
    && ["running", "retry-wait", "failed", "probing"].includes(String(runtime.status || ""))
    && runtime.pausedByUser !== true
    && runtime.stoppedByUser !== true
    && (bridgeRecoveryOwnsTask || (
      !productionTaskAccounts.has(id)
      && !account?.pendingGptTask
      && !account?.maintenancePromise
    ));
  const recoveryRecreate = controlledRecovery || bridgeRecoveryRecreate;
  if (persistedGptUserHold(id)) return { ok: false, accountId: id, skipped: "user-hold" };
  if (!rootPageLoadStall && !recoveryRecreate && (productionTaskAccounts.has(id) || account?.pendingGptTask || account?.maintenancePromise)) {
    return { ok: false, accountId: id, skipped: "active-task" };
  }
  // A renderer recreation is itself a page reload.  After a bridge timeout
  // the durable checkpoint can be retry-wait/failed while the renderer
  // worker is about to reattach; recreating that view again aborts the exact
  // page recovery path and creates a reload -> checkpoint loop.  Keep every
  // non-terminal owned checkpoint attached, except the explicit root-page
  // recovery that has no usable ChatGPT conversation to preserve.
  const runtimeTaskStillBusy = !rootPageLoadStall
    && !recoveryRecreate
    && String(runtime.currentTaskId || "").trim()
    && !["idle", "completed", "waiting-quota"].includes(String(runtime.status || ""))
    && runtime.pausedByUser !== true
    && runtime.stoppedByUser !== true;
  if (!rootPageLoadStall && runtimeTaskStillBusy) {
    return { ok: false, accountId: id, skipped: "runtime-task" };
  }
  if (rootPageLoadStall) {
    appendDesktopLog("gpt-view-recreate-forced-stalled-root", `account=${id} stage=${String(runtime.currentStage || "").slice(0, 80)}`);
  }
  appendDesktopLog("gpt-view-recreate-start", `account=${id} requestId=${String(options.recoveryRequestId || runtime.currentTaskId || "")} reason=${String(options.reason || "automatic-recovery").slice(0, 80)} url=${knownConversationUrl || currentUrl}`);
  await releaseGptAccountView(id);
  const restored = await ensureGptAccount(id);
  const url = restored?.view?.webContents?.getURL?.() || "";
  appendDesktopLog("gpt-view-recreate-finished", `account=${id} url=${url}`);
  return { ok: true, accountId: id, url };
}

function enqueueGptAccountInitialization(task, accountId = "") {
  return new Promise((resolve, reject) => {
    gptAccountInitializationQueue.push({ task, accountId: String(accountId || ""), resolve, reject });
    drainGptAccountInitializationQueue();
  });
}

function drainGptAccountInitializationQueue() {
  while (
    gptAccountInitializationActive < GPT_ACCOUNT_INITIALIZATION_CONCURRENCY
    && gptAccountInitializationQueue.length
  ) {
    const entry = gptAccountInitializationQueue.shift();
    gptAccountInitializationActive += 1;
    appendDesktopLog("gpt-account-init-start", `account=${entry.accountId} active=${gptAccountInitializationActive} queued=${gptAccountInitializationQueue.length}`);
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        gptAccountInitializationActive = Math.max(0, gptAccountInitializationActive - 1);
        appendDesktopLog("gpt-account-init-finished", `account=${entry.accountId} active=${gptAccountInitializationActive} queued=${gptAccountInitializationQueue.length}`);
        drainGptAccountInitializationQueue();
      });
  }
}

function applyPendingGptLoginRestore() {
  if (!fs.existsSync(GPT_PENDING_RESTORE_FILE)) return;
  const pending = JSON.parse(fs.readFileSync(GPT_PENDING_RESTORE_FILE, "utf8").replace(/^\uFEFF/, ""));
  const accountId = safeGptAccountId(pending.accountId);
  const source = gptRecoveryDirectory(accountId);
  const target = gptPartitionDirectory(accountId);
  if (!isInsideDirectory(GPT_LOGIN_RECOVERY_ROOT, source)
    || !isInsideDirectory(path.join(app.getPath("userData"), "Partitions"), target)) {
    throw new Error("登录档案恢复路径不安全");
  }
  if (!fs.existsSync(source)) throw new Error("没有找到这个账号的本机恢复点");
  const rollback = path.join(GPT_LOGIN_RECOVERY_ROOT, accountId, `rollback-${Date.now()}`);
  if (fs.existsSync(target)) fs.cpSync(target, rollback, { recursive: true, force: true, errorOnExist: false });
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true, errorOnExist: false });
  fs.rmSync(GPT_PENDING_RESTORE_FILE, { force: true });
  appendDesktopLog("gpt-login-recovery-restored", accountId);
}

function applyPendingGptLoginBackup() {
  if (!fs.existsSync(GPT_PENDING_BACKUP_FILE)) return;
  const pending = JSON.parse(fs.readFileSync(GPT_PENDING_BACKUP_FILE, "utf8").replace(/^\uFEFF/, ""));
  const accountId = safeGptAccountId(pending.accountId);
  const source = gptPartitionDirectory(accountId);
  const target = gptRecoveryDirectory(accountId);
  if (!isInsideDirectory(path.join(app.getPath("userData"), "Partitions"), source)
    || !isInsideDirectory(GPT_LOGIN_RECOVERY_ROOT, target)) {
    throw new Error("登录档案备份路径不安全");
  }
  copyDirectorySnapshot(source, target);
  const metadata = {
    accountId,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    machineOnly: true
  };
  fs.mkdirSync(path.dirname(recoveryMetadataFile(accountId)), { recursive: true });
  fs.writeFileSync(recoveryMetadataFile(accountId), JSON.stringify(metadata, null, 2), "utf8");
  fs.rmSync(GPT_PENDING_BACKUP_FILE, { force: true });
  appendDesktopLog("gpt-login-recovery-created", accountId);
}

function resolveGptExtensionPath() {
  const configured = String(process.env.TEAMBUILDING_GPT_EXTENSION || "").trim();
  const bundled = path.join(runtimeAppRoot(), "integrations", "gpt-production-extension");
  const candidates = configured
    ? [configured, bundled]
    : [bundled];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "manifest.json"))) || candidates[0];
}

// --- Auto-reload GPT views when extension source files change ---
let extensionWatcher = null;
let extensionReloadTimer = null;
const activeGptTaskAccounts = new Set();
let extensionReloadPending = false;
let extensionReloadInFlight = null;

function abortPendingGptTask(account, reason = "GPT 网页已重新加载，当前任务需要从检查点重接") {
  const pending = account?.pendingGptTask;
  if (!pending) return false;
  account.pendingGptTask = null;
  pending.resolve({
    ok: false,
    status: "aborted",
    requestId: pending.requestId,
    errorCode: "GPT_PAGE_RELOADED",
    error: reason
  });
  appendDesktopLog("gpt-task-aborted", `account=${account.id} requestId=${pending.requestId} reason=${reason}`);
  return true;
}

function reloadAllGptViewsForExtensionChange() {
  if (activeGptTaskAccounts.size > 0) {
    extensionReloadPending = true;
    appendDesktopLog(
      "gpt-extension-auto-reload-deferred",
      `activeAccounts=${Array.from(activeGptTaskAccounts).join(",")}`
    );
    return Promise.resolve(false);
  }
  if (extensionReloadInFlight) return extensionReloadInFlight;
  extensionReloadInFlight = (async () => {
    extensionReloadPending = false;
    const extensionPath = resolveGptExtensionPath();
    for (const [id, account] of gptAccounts) {
      if (account.userRecoveryHold) {
        appendDesktopLog("gpt-extension-auto-reload-deferred", `account=${id} reason=user-hold`);
        continue;
      }
      const extensionId = account.extensionInfo?.id;
      if (!extensionId || !account.session?.extensions) continue;
      try {
        // Electron keeps a loaded extension in the session registry. Reloading
        // the WebContents alone therefore leaves the old bundle active.
        await account.session.extensions.removeExtension(extensionId);
        account.extensionInfo = await account.session.extensions.loadExtension(extensionPath, { allowFileAccess: true });
        account.extensionPath = extensionPath;
        account.extensionRuntimeReady = await waitForExtensionReady(account.session, account.extensionInfo.id);
        account.extensionError = "";
        appendDesktopLog(
          "gpt-extension-registered",
          `account=${id} ${account.extensionInfo.name} ${account.extensionInfo.version}`
        );
      } catch (error) {
        account.extensionRuntimeReady = false;
        account.extensionError = error.message;
        appendDesktopLog("gpt-extension-auto-reload-failed", `account=${id} ${error.stack || error.message}`);
        continue;
      }
      if (!account.view || account.view.webContents.isDestroyed()) continue;
      if (!account.view.webContents.getURL?.().startsWith("https://")) continue;
      // The reload can race with a task that starts after the extension
      // registry swap but before this async loop reaches webContents.reload().
      // Re-check ownership at the final navigation boundary; replacing the
      // extension bundle is harmless, but navigating an active GPT page aborts
      // its bridge task and can leave a completed package without its source
      // material archive step.
      if (activeGptTaskAccounts.has(id) || account.pendingGptTask) {
        extensionReloadPending = true;
        appendDesktopLog("gpt-extension-auto-reload-deferred", `account=${id} reason=task-started-during-reload`);
        continue;
      }
      appendDesktopLog("gpt-extension-auto-reload", `account=${id} reason=extension-file-changed`);
      account.view.webContents.reload();
    }
    return true;
  })().catch((error) => {
    appendDesktopLog("gpt-extension-auto-reload-failed", error.stack || error.message);
    return false;
  }).finally(() => {
    extensionReloadInFlight = null;
  });
  return extensionReloadInFlight;
}

function watchExtensionForChanges() {
  if (extensionWatcher) return;
  const extensionPath = resolveGptExtensionPath();
  if (!fs.existsSync(extensionPath)) return;
  try {
    extensionWatcher = fs.watch(extensionPath, { recursive: true }, (_eventType, filename) => {
      if (!filename || !/\.(?:js|json|css)$/i.test(filename)) return;
      // Debounce: wait 800ms after the last change before reloading,
      // so a multi-file save doesn't trigger multiple reloads.
      if (extensionReloadTimer) clearTimeout(extensionReloadTimer);
      extensionReloadTimer = setTimeout(() => {
        extensionReloadTimer = null;
        reloadAllGptViewsForExtensionChange();
      }, 800);
    });
    extensionWatcher.on("error", () => {
      // Watcher may fail if the directory is recreated; retry once.
      try { extensionWatcher?.close(); } catch {}
      extensionWatcher = null;
    });
    appendDesktopLog("gpt-extension-watcher-started", extensionPath);
  } catch (error) {
    appendDesktopLog("gpt-extension-watcher-failed", error.message);
  }
}

function safeGptBounds(input = {}) {
  const width = Math.max(320, Math.round(Number(input.width) || 320));
  const height = Math.max(320, Math.round(Number(input.height) || 320));
  return {
    x: Math.max(0, Math.round(Number(input.x) || 0)),
    y: Math.max(0, Math.round(Number(input.y) || 0)),
    width,
    height
  };
}

function hideWechatDraftView() {
  if (!wechatDraftView || wechatDraftView.webContents.isDestroyed()) return;
  wechatDraftView.setVisible(false);
}

function isAllowedWechatUrl(value = "") {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && parsed.hostname === "mp.weixin.qq.com";
  } catch {
    return false;
  }
}

function loadWechatUrlBounded(contents, url, timeoutMs = 15000) {
  if (!contents || contents.isDestroyed()) return Promise.resolve({ ok: false, error: "公众号网页视图不可用" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      contents.removeListener("dom-ready", onReady);
      contents.removeListener("did-fail-load", onFail);
      resolve(result);
    };
    const onReady = () => finish({ ok: true, url: contents.getURL(), readyAt: "dom-ready" });
    const onFail = (_event, code, description, validatedURL, isMainFrame) => {
      if (isMainFrame) finish({ ok: false, error: `${code}: ${description}`, url: validatedURL });
    };
    const timer = setTimeout(() => finish({
      ok: ["interactive", "complete"].includes(wechatDraftPageState.domReady ? "complete" : ""),
      url: contents.getURL(),
      readyAt: "timeout",
      error: wechatDraftPageState.domReady ? "" : "公众号网页加载超时"
    }), Math.max(3000, Number(timeoutMs || 0)));
    contents.once("dom-ready", onReady);
    contents.on("did-fail-load", onFail);
    Promise.resolve(contents.loadURL(url)).catch((error) => finish({ ok: false, error: error.message, url }));
  });
}

function normalizeOnlinePlatformId(value = "wechat") {
  const id = String(value || "wechat").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ONLINE_PLATFORM_WEB_CONFIG, id) ? id : "wechat";
}

function onlinePlatformConfig(platformId = "wechat") {
  return ONLINE_PLATFORM_WEB_CONFIG[normalizeOnlinePlatformId(platformId)];
}

function isAllowedOnlinePlatformUrl(platformId, value = "") {
  const config = onlinePlatformConfig(platformId);
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:"
      && config.hosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function onlinePlatformState(platformId) {
  const id = normalizeOnlinePlatformId(platformId);
  const config = onlinePlatformConfig(id);
  const view = id === "wechat" ? wechatDraftView : onlinePlatformViews.get(id);
  const state = onlinePlatformStates.get(id) || {};
  return {
    ok: true,
    platformId: id,
    name: config.name,
    loaded: Boolean(view && !view.webContents.isDestroyed()),
    loading: Boolean(state.loading),
    domReady: Boolean(state.domReady),
    error: String(state.error || ""),
    url: view && !view.webContents.isDestroyed() ? view.webContents.getURL() : config.homeUrl,
    canGoBack: Boolean(view && !view.webContents.isDestroyed() && view.webContents.canGoBack()),
    canGoForward: Boolean(view && !view.webContents.isDestroyed() && view.webContents.canGoForward())
  };
}

function hideOnlinePlatformViews(exceptId = "") {
  const keep = exceptId ? normalizeOnlinePlatformId(exceptId) : "";
  if (keep !== "wechat") hideWechatDraftView();
  for (const [id, view] of onlinePlatformViews) {
    if (!view || view.webContents.isDestroyed()) continue;
    view.setVisible(Boolean(keep && id === keep));
  }
}

function loadOnlinePlatformUrl(contents, platformId, url, timeoutMs = 15000) {
  const id = normalizeOnlinePlatformId(platformId);
  if (!contents || contents.isDestroyed()) return Promise.resolve({ ok: false, error: `${onlinePlatformConfig(id).name}网页视图不可用` });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      contents.removeListener("dom-ready", onReady);
      contents.removeListener("did-fail-load", onFail);
      resolve(result);
    };
    const onReady = () => finish({ ok: true, url: contents.getURL(), readyAt: "dom-ready" });
    const onFail = (_event, code, description, validatedURL, isMainFrame) => {
      if (isMainFrame) finish({ ok: false, error: `${code}: ${description}`, url: validatedURL });
    };
    const timer = setTimeout(() => finish({
      ok: Boolean(onlinePlatformStates.get(id)?.domReady),
      url: contents.getURL(),
      readyAt: "timeout",
      error: onlinePlatformStates.get(id)?.domReady ? "" : `${onlinePlatformConfig(id).name}网页加载超时`
    }), Math.max(3000, Number(timeoutMs || 0)));
    contents.once("dom-ready", onReady);
    contents.on("did-fail-load", onFail);
    Promise.resolve(contents.loadURL(url)).catch((error) => finish({ ok: false, error: error.message, url }));
  });
}

async function ensureOnlinePlatformView(platformId = "wechat") {
  const id = normalizeOnlinePlatformId(platformId);
  if (id === "wechat") return ensureWechatDraftView();
  const existing = onlinePlatformViews.get(id);
  if (existing && !existing.webContents.isDestroyed()) return existing;
  if (!mainWindow) throw new Error("工作台窗口尚未就绪");
  const config = onlinePlatformConfig(id);
  const partition = `${ONLINE_PLATFORM_PARTITION_PREFIX}-${id}`;
  const platformSession = session.fromPartition(partition);
  const view = new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  onlinePlatformViews.set(id, view);
  onlinePlatformStates.set(id, {
    loading: true,
    domReady: false,
    error: "",
    startedAt: new Date().toISOString(),
    finishedAt: ""
  });
  view.setBackgroundColor("#f5f7f8");
  view.setBorderRadius(16);
  mainWindow.contentView.addChildView(view);
  view.setVisible(false);
  view.webContents.on("did-start-loading", () => {
    onlinePlatformStates.set(id, {
      ...onlinePlatformStates.get(id),
      loading: true,
      domReady: false,
      error: "",
      startedAt: new Date().toISOString(),
      finishedAt: ""
    });
    mainWindow?.webContents.send("desktop:online-platform-state", onlinePlatformState(id));
  });
  view.webContents.on("dom-ready", () => {
    onlinePlatformStates.set(id, { ...onlinePlatformStates.get(id), loading: false, domReady: true });
    mainWindow?.webContents.send("desktop:online-platform-state", onlinePlatformState(id));
  });
  view.webContents.on("did-finish-load", () => {
    onlinePlatformStates.set(id, { ...onlinePlatformStates.get(id), loading: false, domReady: true, error: "", finishedAt: new Date().toISOString() });
    mainWindow?.webContents.send("desktop:online-platform-state", onlinePlatformState(id));
  });
  view.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame) onlinePlatformStates.set(id, { ...onlinePlatformStates.get(id), loading: false, error: `${code}: ${description}` });
    appendDesktopLog("online-platform-load-failed", `platform=${id} code=${code} main=${isMainFrame} url=${validatedURL} ${description}`);
  });
  const notifyUrl = (_event, url) => {
    mainWindow?.webContents.send("desktop:online-platform-state", { ...onlinePlatformState(id), url: String(url || "") });
  };
  view.webContents.on("did-navigate", notifyUrl);
  view.webContents.on("did-navigate-in-page", notifyUrl);
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedOnlinePlatformUrl(id, url)) {
      view.webContents.loadURL(url).catch((error) => appendDesktopLog("online-platform-popup-load-failed", `platform=${id} ${error.message}`));
    }
    return { action: "deny" };
  });
  const initialLoad = await loadOnlinePlatformUrl(view.webContents, id, config.homeUrl);
  if (!initialLoad.ok) appendDesktopLog("online-platform-initial-load-incomplete", `platform=${id} ${initialLoad.error || initialLoad.readyAt || "unknown"}`);
  await Promise.resolve(platformSession.flushStorageData()).catch(() => {});
  return view;
}

async function showOnlinePlatformView(platformId = "wechat", bounds = {}) {
  const id = normalizeOnlinePlatformId(platformId);
  const view = await ensureOnlinePlatformView(id);
  hideAllGptViews();
  hideOnlinePlatformViews(id);
  view.setBounds(safeGptBounds(bounds));
  view.setBorderRadius(16);
  view.setVisible(true);
  return id === "wechat" ? { ...(await probeWechatDraftPage()), ...onlinePlatformState(id) } : onlinePlatformState(id);
}

async function hideOnlinePlatformView(platformId = "") {
  const id = String(platformId || "").trim().toLowerCase();
  if (!id) {
    hideOnlinePlatformViews();
    return { ok: true };
  }
  if (id === "wechat") hideWechatDraftView();
  else onlinePlatformViews.get(normalizeOnlinePlatformId(id))?.setVisible(false);
  return { ok: true };
}

async function navigateOnlinePlatformView(platformId = "wechat", action = "home", targetUrl = "") {
  const id = normalizeOnlinePlatformId(platformId);
  const view = await ensureOnlinePlatformView(id);
  const contents = view.webContents;
  const config = onlinePlatformConfig(id);
  const command = String(action || "home");
  if (command === "reload") contents.reload();
  else if (command === "back" && contents.canGoBack()) contents.goBack();
  else if (command === "forward" && contents.canGoForward()) contents.goForward();
  else {
    const url = command === "url" ? String(targetUrl || "") : config.homeUrl;
    if (!isAllowedOnlinePlatformUrl(id, url)) throw new Error(`只允许打开${config.name}官方网页`);
    const load = id === "wechat"
      ? await loadWechatUrlBounded(contents, url)
      : await loadOnlinePlatformUrl(contents, id, url);
    if (!load.ok) throw new Error(load.error || `${config.name}网页打开失败`);
  }
  return id === "wechat" ? { ...(await probeWechatDraftPage()), ...onlinePlatformState(id) } : onlinePlatformState(id);
}

const CTRIP_CONTENT_MANAGEMENT_URL = "https://we.ctrip.com/publish/contentManagement";
const CTRIP_PICTURE_TEXT_URL = "https://we.ctrip.com/publish/publishPictureText";

function normalizeCtripTopics(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\n,，、#]+/u);
  const blocked = /^(?:已发|已制作|未使用|使用\d+次|素材库|作品库|待发|公众号待处理|已归档|完整|缺(?:图片|文案))$/u;
  return [...new Set(raw.map((item) => String(item || "").replace(/^#+/u, "").trim())
    .filter((item) => item.length >= 2 && item.length <= 30 && !blocked.test(item)))]
    .slice(0, 8);
}

function appendCtripTopics(body, topics) {
  const text = String(body || "").trim();
  const normalizedTopics = normalizeCtripTopics(topics);
  const missingTopics = normalizedTopics.filter((topic) => !text.split(/\s+/u).includes(`#${topic}`));
  return missingTopics.length ? `${text}${text ? "\n\n" : ""}${missingTopics.map((topic) => `#${topic}`).join(" ")}` : text;
}

function buildCtripDraftProbeScript() {
  return `(() => {
    const url = String(location.href || "");
    let parsed = null;
    try { parsed = new URL(url); } catch (_) {}
    const pathname = String(parsed?.pathname || "").replace(/\\/+$/, "") || "/";
    const bodyText = String(document.body?.innerText || "").slice(0, 6000);
    const fileInputs = [...document.querySelectorAll('input[type="file"]')];
    const locationSelect = [...document.querySelectorAll('.ant-select')]
      .find((node) => /请输入地理位置/.test(String(node.innerText || node.textContent || ""))
        || /添加地点/.test(String(node.parentElement?.innerText || node.parentElement?.parentElement?.innerText || ""))) || null;
    const locationText = String(locationSelect?.innerText || locationSelect?.textContent || "").trim();
    const locationContainerText = String(locationSelect?.parentElement?.innerText || locationSelect?.parentElement?.parentElement?.innerText || "");
    const locationRequired = Boolean(locationSelect && /添加地点\s*\*/.test(locationContainerText));
    const locationReady = !locationSelect || Boolean(
      locationSelect.querySelector('.ant-select-selection-item')
        || (locationText && !/请输入地理位置/.test(locationText))
    );
    const editors = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter((node) => node.offsetParent !== null || node.getBoundingClientRect().width > 0)
      .map((node) => ({
        text: String(node.innerText || "").slice(0, 120),
        role: String(node.getAttribute('role') || ""),
        editorBodyClass: String(node.closest('.editor-body')?.className || ""),
        parentText: String(node.closest('.editor-body')?.parentElement?.innerText || node.parentElement?.innerText || "").slice(0, 240),
        placeholder: String(node.querySelector('[data-text="true"]')?.innerText || node.getAttribute('data-placeholder') || "").slice(0, 160)
      }));
    const titleEditor = editors.find((editor) => editor.role === "textbox") || editors[0] || null;
    const bodyEditor = editors.find((editor) => editor.role === "combobox" || /editor-has-count/.test(editor.editorBodyClass))
      || editors.find((editor) => editor !== titleEditor) || null;
    const saveButtons = [...document.querySelectorAll('button, [role="button"]')]
      .map((node) => String(node.innerText || node.textContent || "").trim())
      .filter(Boolean)
      .filter((text) => text === "存草稿" || text === "保存草稿");
    const loginRequired = /\\/(?:account\\/login|login)(?:\\?|$)/i.test(pathname)
      || (!editors.length && /扫码登录|请先登录|登录后继续/.test(bodyText));
    const editorReady = /\\/publish\\/publishPictureText$/i.test(pathname)
      && Boolean(titleEditor && bodyEditor && fileInputs.length >= 1);
    const managementReady = /\\/publish\\/contentManagement$/i.test(pathname);
    const saveSuccess = /保存(?:草稿)?成功|存草稿成功|已保存到草稿/.test(bodyText);
    return {
      url,
      pathname,
      readyState: document.readyState,
      stage: loginRequired ? "login-required" : saveSuccess ? "saved" : editorReady ? "editor-ready" : managementReady ? "dashboard-ready" : "loading",
      fileInputCount: fileInputs.length,
      fileInputFileCount: fileInputs.reduce((total, input) => total + Number(input.files?.length || 0), 0),
      editorCount: editors.length,
      titleEditor: Boolean(titleEditor),
      bodyEditor: Boolean(bodyEditor),
      editors,
      saveButtonCount: saveButtons.length,
      saveButtons,
      saveSuccess,
      locationRequired,
      locationReady,
      locationText,
      bodyText: bodyText.slice(-1200)
    };
  })()`;
}

function buildCtripDraftFillScript(input = {}) {
  const title = String(input.title || "").trim().slice(0, 30);
  const body = String(input.body || "").trim().slice(0, 20_000);
  return `(() => {
    const title = ${JSON.stringify(title)};
    const body = ${JSON.stringify(body)};
    const nodes = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter((node) => node.offsetParent !== null || node.getBoundingClientRect().width > 0);
    const labeled = (node) => String(node.closest('.editor-body')?.parentElement?.innerText || node.parentElement?.innerText || "");
    const titleNode = nodes.find((node) => node.getAttribute('role') === 'textbox')
      || nodes.find((node) => /标题/.test(labeled(node))) || nodes[0];
    const bodyNode = nodes.find((node) => node.getAttribute('role') === 'combobox')
      || nodes.find((node) => /描述|3000/.test(labeled(node))) || nodes.find((node) => node !== titleNode);
    const write = (node, value) => {
      if (!node) return false;
      node.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
      let inserted = false;
      try { inserted = document.execCommand('insertText', false, value); } catch (_) {}
      if (!inserted || String(node.innerText || '').replace(/\\u200b/gu, '').trim() !== value.trim()) {
        node.textContent = value;
      }
      const eventOptions = { bubbles: true, cancelable: false, inputType: 'insertText', data: value };
      try { node.dispatchEvent(new InputEvent('input', eventOptions)); } catch (_) { node.dispatchEvent(new Event('input', { bubbles: true })); }
      node.dispatchEvent(new Event('change', { bubbles: true }));
      node.blur();
      return String(node.innerText || '').trim() === value.trim();
    };
    const titleWritten = write(titleNode, title);
    const bodyWritten = write(bodyNode, body);
    return {
      ok: Boolean(titleWritten && bodyWritten),
      titleWritten,
      bodyWritten,
      titleText: String(titleNode?.innerText || '').replace(/\\u200b/gu, '').trim(),
      bodyText: String(bodyNode?.innerText || '').replace(/\\u200b/gu, '').trim().slice(0, 200)
    };
  })()`;
}

function buildCtripDraftSaveScript() {
  return `(() => {
    const button = [...document.querySelectorAll('button, [role="button"]')]
      .find((node) => String(node.innerText || node.textContent || '').trim() === '存草稿'
        || String(node.innerText || node.textContent || '').trim() === '保存草稿');
    if (!button) return { ok: false, error: '没有找到携程“存草稿”按钮' };
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return { ok: false, error: '携程“存草稿”按钮当前不可用' };
    button.click();
    return { ok: true, label: String(button.innerText || button.textContent || '').trim() };
  })()`;
}

async function probeCtripDraftPage(view) {
  const contents = view?.webContents;
  if (!contents || contents.isDestroyed()) return { stage: "failed", error: "携程网页视图不可用" };
  return contents.executeJavaScript(buildCtripDraftProbeScript(), true)
    .catch((error) => ({ stage: "loading", error: error.message, url: contents.getURL() }));
}

async function waitForCtripDraftState(view, predicate, timeoutMs = 60_000, intervalMs = 700) {
  const deadline = Date.now() + Math.max(2_000, Number(timeoutMs || 0));
  let last = null;
  while (Date.now() < deadline) {
    last = await probeCtripDraftPage(view);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last || { stage: "loading", error: "携程编辑器状态探测超时" };
}

async function setCtripDraftImageFiles(contents, imagePaths) {
  let attachedHere = false;
  try {
    const marked = await contents.executeJavaScript(`(() => {
      const inputs = [...document.querySelectorAll('input[type="file"]')];
      inputs.forEach((input) => input.removeAttribute('data-tb-ctrip-image-input'));
      const candidate = inputs.find((input) => /image|jpg|jpeg|png|webp/i.test(String(input.accept || '')) || input.multiple) || inputs[0];
      if (!candidate) return { ok: false, count: 0 };
      candidate.setAttribute('data-tb-ctrip-image-input', 'ready');
      return { ok: true, count: inputs.length, accept: String(candidate.accept || '') };
    })()`, true);
    if (!marked?.ok) throw new Error("携程图文编辑器没有找到图片上传入口");
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach("1.3");
      attachedHere = true;
    }
    await contents.debugger.sendCommand("DOM.enable");
    const documentNode = await contents.debugger.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
    const query = await contents.debugger.sendCommand("DOM.querySelector", {
      nodeId: documentNode.root.nodeId,
      selector: "input[data-tb-ctrip-image-input='ready']"
    });
    if (!query.nodeId) throw new Error("携程图文编辑器图片上传入口已经刷新，请重试");
    await contents.debugger.sendCommand("DOM.setFileInputFiles", { nodeId: query.nodeId, files: imagePaths });
    return { ok: true, count: imagePaths.length };
  } finally {
    if (attachedHere && contents.debugger.isAttached()) contents.debugger.detach();
  }
}

function domNodeAttribute(node, name) {
  const attributes = Array.isArray(node?.attributes) ? node.attributes : [];
  const index = attributes.findIndex((value) => String(value || "").toLowerCase() === String(name || "").toLowerCase());
  return index >= 0 ? String(attributes[index + 1] || "") : "";
}

function collectDomNodes(node, output = []) {
  if (!node || typeof node !== "object") return output;
  output.push(node);
  const children = [
    ...(Array.isArray(node.children) ? node.children : []),
    ...(Array.isArray(node.shadowRoots) ? node.shadowRoots : []),
    ...(node.contentDocument ? [node.contentDocument] : []),
    ...(node.templateContent ? [node.templateContent] : [])
  ];
  children.forEach((child) => collectDomNodes(child, output));
  return output;
}

function selectGptFileInputNode(documentNode) {
  const candidates = collectDomNodes(documentNode).filter((node) => {
    if (String(node.nodeName || "").toLowerCase() !== "input" || !Number(node.nodeId)) return false;
    if (domNodeAttribute(node, "type").toLowerCase() !== "file") return false;
    return !domNodeAttribute(node, "disabled");
  });
  if (!candidates.length) return null;
  return candidates.find((node) => {
    const accept = domNodeAttribute(node, "accept");
    return Boolean(domNodeAttribute(node, "multiple")) || /image|file|jpe?g|png|webp|gif|bmp|txt/i.test(accept);
  }) || candidates[0];
}

async function setGptTaskFileInputFiles(contents, filePaths) {
  const files = [...new Set((Array.isArray(filePaths) ? filePaths : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean))].slice(0, 30);
  if (!files.length) return { ok: true, count: 0 };
  const invalid = files.find((file) => !path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile());
  if (invalid) return { ok: false, count: 0, error: `GPT 原生上传文件不存在：${invalid}` };
  if (!contents || contents.isDestroyed() || !contents.debugger) {
    return { ok: false, count: 0, error: "GPT 网页视图不可用，无法进行原生附件注入" };
  }
  let attachedHere = false;
  try {
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach("1.3");
      attachedHere = true;
    }
    await contents.debugger.sendCommand("DOM.enable");
    let selected = null;
    for (let attempt = 0; attempt < 12 && !selected; attempt += 1) {
      const documentNode = await contents.debugger.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
      selected = selectGptFileInputNode(documentNode.root);
      if (selected) break;
      // The ChatGPT composer may mount its hidden input only after the attach
      // control is opened. Keep this UI nudge short and scoped to this exact
      // WebContents; never use a URL-matched CDP target or a file picker API.
      if (attempt === 0) {
        await contents.debugger.sendCommand("Runtime.evaluate", {
          expression: `(() => {
            const button = [...document.querySelectorAll("button")].find((item) => {
              const label = String(item.getAttribute("aria-label") || "") + " " + String(item.title || "");
              return /attach|add (?:photos|files)|upload|附件|添加文件|上传/i.test(label) && !item.disabled;
            });
            if (button) button.click();
            return Boolean(button);
          })()`,
          returnByValue: true,
          userGesture: true
        }).catch(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!selected) return { ok: false, count: 0, error: "GPT 当前页面没有找到可用的原生附件入口" };
    await contents.debugger.sendCommand("DOM.setFileInputFiles", { nodeId: selected.nodeId, files });
    return { ok: true, count: files.length };
  } catch (error) {
    return { ok: false, count: 0, error: error?.message || String(error) };
  } finally {
    if (attachedHere && contents.debugger.isAttached()) {
      try { contents.debugger.detach(); } catch {}
    }
  }
}

async function runCtripDraft(input = {}) {
  if (ctripDraftRunPromise) return ctripDraftRunPromise;
  ctripDraftRunPromise = (async () => {
    const title = String(input.title || "").trim().slice(0, 30);
    const topics = normalizeCtripTopics(input.topics);
    const body = appendCtripTopics(String(input.body || "").trim().slice(0, 20_000), topics);
    const images = Array.isArray(input.images) ? input.images.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20) : [];
    if (title.length < 5 || title.length > 30) return { ok: false, stage: "validate", error: "携程标题需要 5-30 个字" };
    if (!body) return { ok: false, stage: "validate", error: "携程描述不能为空" };
    if (Array.from(body).length > 3_000) return { ok: false, stage: "validate", error: "携程描述超过 3000 字，请先缩短" };
    if (!images.length) return { ok: false, stage: "validate", error: "携程图文至少需要 1 张图片" };
    for (const imagePath of images) {
      if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) return { ok: false, stage: "validate", error: `图片文件不存在：${imagePath}` };
    }
    const view = await ensureOnlinePlatformView("ctrip");
    const contents = view.webContents;
    const loaded = await loadOnlinePlatformUrl(contents, "ctrip", CTRIP_PICTURE_TEXT_URL, 30_000);
    if (!loaded.ok && !onlinePlatformStates.get("ctrip")?.domReady) {
      return { ok: false, stage: "loading", error: loaded.error || "携程图文编辑页打开失败" };
    }
    const ready = await waitForCtripDraftState(view, (state) => ["editor-ready", "login-required"].includes(state.stage), 60_000);
    if (ready.stage === "login-required") return { ok: false, stage: "login-required", error: "请先在携程内容中心登录，登录后点击重试" };
    if (ready.stage !== "editor-ready") return { ok: false, stage: ready.stage || "editor", error: "携程图文编辑器尚未就绪", state: ready };
    if (ready.locationRequired && !ready.locationReady) {
      return { ok: false, stage: "location-required", error: "请先在右侧携程页面选择地点，选择后再重试批量保存", state: ready };
    }
    const filled = await contents.executeJavaScript(buildCtripDraftFillScript({ title, body }), true).catch((error) => ({ ok: false, error: error.message }));
    if (!filled?.ok) return { ok: false, stage: "fill", error: filled?.error || "携程标题或描述没有成功写入", filled };
    const uploaded = await setCtripDraftImageFiles(contents, images).catch((error) => ({ ok: false, error: error.message }));
    if (!uploaded?.ok) return { ok: false, stage: "upload", error: uploaded?.error || "携程图片没有成功加入编辑器" };
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const save = await contents.executeJavaScript(buildCtripDraftSaveScript(), true).catch((error) => ({ ok: false, error: error.message }));
    if (!save?.ok) return { ok: false, stage: "save", error: save?.error || "携程存草稿按钮不可用", save };
    const saved = await waitForCtripDraftState(view, (state) => state.stage === "saved" || /\/publish\/contentManagement$/i.test(String(state.pathname || "")), 90_000);
    if (saved.stage !== "saved" && !/\/publish\/contentManagement$/i.test(String(saved.pathname || ""))) {
      return { ok: false, stage: "save-confirmation", error: "携程网页没有确认已保存到草稿箱", state: saved };
    }
    await Promise.resolve(session.fromPartition(`${ONLINE_PLATFORM_PARTITION_PREFIX}-ctrip`).flushStorageData()).catch(() => {});
    return { ok: true, stage: "saved", saved: true, title, bodyLength: body.length, topics, imageCount: images.length, state: saved };
  })().finally(() => {
    ctripDraftRunPromise = null;
  });
  return ctripDraftRunPromise;
}

function gptJavaScriptChannelForLabel(label = "") {
  const value = String(label || "");
  if (/^(?:pause|stop):/.test(value)) return "control";
  if (/^inspect:/.test(value)) return "inspect";
  if (/^workflow:/.test(value)) return "workflow";
  if (/^(?:status|recovery|send-readiness|patrol-(?:discover|continue)-ready):/.test(value)) return "health";
  return "read";
}

function gptAccountForWebContents(contents) {
  for (const account of gptAccounts.values()) {
    if (account?.view?.webContents === contents) return account;
  }
  return null;
}

function noteGptBridgeTimeout(account, channel) {
  if (!account || account.userRecoveryHold || !["workflow", "inspect"].includes(channel)) return;
  account.bridgeTimeoutStreak = Number(account.bridgeTimeoutStreak || 0) + 1;
  const pending = account.pendingGptTask;
  const pendingRequest = Boolean(pending);
  const freshRootPreSubmitElapsed = pending?.startedAt > 0
    ? Date.now() - pending.startedAt
    : 0;
  const freshRootPreSubmitRecoveryDue = pending?.freshConversationBootstrap === true
    && pending?.submittedToGpt !== true
    && freshRootPreSubmitElapsed >= GPT_PRE_SUBMIT_DISPATCH_GRACE_MS;
  const pendingForEscalation = pendingRequest && !freshRootPreSubmitRecoveryDue;
  const productionTaskActive = productionTaskAccounts.has(account.id);
  if (!shouldEscalateGptBridgeTimeout({
    consecutiveTimeouts: account.bridgeTimeoutStreak,
    pendingRequest: pendingForEscalation,
    productionTaskActive: productionTaskActive && !freshRootPreSubmitRecoveryDue,
    userHold: account.userRecoveryHold
  })) {
    if (account.bridgeTimeoutStreak >= 3) {
      appendDesktopLog(
        "gpt-bridge-timeout-deferred",
        `account=${account.id} channel=${channel} streak=${account.bridgeTimeoutStreak} pending=${pendingRequest} active=${productionTaskActive} preSubmitDue=${freshRootPreSubmitRecoveryDue}`
      );
    }
    return;
  }
  if (account.bridgeRecoveryPending) return;
  account.bridgeRecoveryPending = true;
  const aborted = abortPendingGptTask(account, "GPT 网页桥接连续无响应，已从检查点重接");
  Object.assign(account.pageState, {
    loading: true,
    finished: false,
    error: "GPT 网页桥接连续无响应，已从检查点自动重接",
    startedAt: new Date().toISOString()
  });
  account.forceGptPageRecovery = true;
  appendDesktopLog(
    "gpt-bridge-stalled-recovery",
    `account=${account.id} channel=${channel} streak=${account.bridgeTimeoutStreak} aborted=${aborted}`
  );
  scheduleStalledGptPageRecovery(account);
}

function noteGptBridgeSuccess(account, channel) {
  if (!account || channel === "control") return;
  account.bridgeTimeoutStreak = 0;
  account.bridgeRecoveryPending = false;
}

let gptCdpRequestSequence = 0;

async function executeGptJavaScriptViaCdp(contents, script, timeoutMs = 4000) {
  // Do not resolve a target by URL: all account windows can legitimately be
  // on https://chatgpt.com/ at the same time. Electron's WebContents debugger
  // is the only local channel that preserves the exact embedded window.
  if (!contents || contents.isDestroyed() || !contents.debugger) {
    return { supported: false, value: undefined };
  }
  let attachedHere = false;
  const limit = Math.max(500, Number(timeoutMs || 0));
  try {
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach("1.3");
      attachedHere = true;
    }
    const result = await Promise.race([
      contents.debugger.sendCommand("Runtime.evaluate", {
        expression: String(script || ""),
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("GPT debugger evaluate timeout")), limit))
    ]);
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "GPT debugger script exception");
    }
    return { supported: true, value: result?.result?.value };
  } catch (error) {
    // Fall back to the exact WebContents executeJavaScript path below. Never
    // fall back to a global URL-matched CDP target, which can read another
    // account window and send recovery actions to the wrong session.
    return { supported: false, value: undefined, error: error?.message || String(error) };
  } finally {
    if (attachedHere && contents.debugger.isAttached()) {
      try { contents.debugger.detach(); } catch {}
    }
  }
}

function executeGptJavaScriptBounded(contents, script, timeoutMs = 4000, fallback = null, label = "gpt-read") {
  if (!contents || contents.isDestroyed()) return Promise.resolve(fallback);
  const channel = gptJavaScriptChannelForLabel(label);
  const account = gptAccountForWebContents(contents);
  const now = Date.now();
  const healthByChannel = channel === "control"
    ? null
    : (gptJavaScriptReadHealth.get(contents) || new Map());
  const readHealth = healthByChannel
    ? (healthByChannel.get(channel) || { consecutiveTimeouts: 0, backoffUntil: 0, backoffLoggedUntil: 0 })
    : null;
  if (healthByChannel && !healthByChannel.has(channel)) {
    healthByChannel.set(channel, readHealth);
    gptJavaScriptReadHealth.set(contents, healthByChannel);
  }
  if (readHealth && readHealth.backoffUntil > now) {
    if (!readHealth.backoffLoggedUntil || readHealth.backoffLoggedUntil <= now) {
      readHealth.backoffLoggedUntil = readHealth.backoffUntil;
      healthByChannel.set(channel, readHealth);
      gptJavaScriptReadHealth.set(contents, healthByChannel);
      appendDesktopLog("gpt-read-backoff", `label=${label} remainingMs=${readHealth.backoffUntil - now}`);
    }
    return Promise.resolve(fallback);
  }
  const inFlight = gptJavaScriptInFlight.get(contents) || new Set();
  if (inFlight.has(channel)) return Promise.resolve(fallback);
  inFlight.add(channel);
  gptJavaScriptInFlight.set(contents, inFlight);
  const executionTails = gptJavaScriptExecutionTails.get(contents) || new Map();
  const previousExecution = executionTails.get(channel) || Promise.resolve();
  let releaseExecution;
  const executionReleased = new Promise((resolve) => {
    releaseExecution = resolve;
  });
  const limit = Math.max(500, Number(timeoutMs || 0));
  const resultPromise = previousExecution.catch(() => {}).then(() => new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let channelReleased = false;
    let forcedReleaseTimer = null;
    const forcedReleaseDelayMs = Math.max(15_000, limit * 3);
    const releaseChannel = () => {
      if (channelReleased) return;
      channelReleased = true;
      if (forcedReleaseTimer) {
        clearTimeout(forcedReleaseTimer);
        forcedReleaseTimer = null;
      }
      inFlight.delete(channel);
      releaseExecution();
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (readHealth) {
        if (timedOut) {
          readHealth.consecutiveTimeouts += 1;
          if (readHealth.consecutiveTimeouts >= 3) {
            readHealth.backoffUntil = Date.now() + 5000;
            readHealth.backoffLoggedUntil = 0;
          }
        } else {
          readHealth.consecutiveTimeouts = 0;
          readHealth.backoffUntil = 0;
          readHealth.backoffLoggedUntil = 0;
        }
        healthByChannel.set(channel, readHealth);
        gptJavaScriptReadHealth.set(contents, healthByChannel);
      }
      resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      appendDesktopLog("gpt-execute-timeout", `label=${label} timeoutMs=${limit}`);
      // executeJavaScript cannot be cancelled once Chromium has accepted it.
      // Keep this channel occupied for a bounded grace period. Chromium
      // usually settles the native promise shortly after the timeout, but a
      // renderer that never settles must not permanently block every later
      // readiness probe for this browser window.
      finish(fallback);
      noteGptBridgeTimeout(account, channel);
      forcedReleaseTimer = setTimeout(() => {
        if (channelReleased) return;
        releaseChannel();
        appendDesktopLog("gpt-read-channel-released-after-timeout", `label=${label} graceMs=${forcedReleaseDelayMs}`);
      }, forcedReleaseDelayMs);
    }, limit);
      Promise.resolve()
      .then(async () => {
        // A failed CDP attach/evaluate must not consume the entire bounded
        // read budget before the exact WebContents fallback gets a chance.
        // Previously a 4s inspect (or 10s init) spent nearly all of its time
        // inside the CDP race, so the native fallback started too late and
        // every account looked bridge-stalled even though the page and
        // extension were already usable.
        // Native execution is the healthy-path channel. CDP is only a
        // secondary probe after this exact read channel has timed out before;
        // trying a known-slow debugger first on every probe consumed most of
        // the 3s readiness budget and created false bridge failures.
        if (readHealth && readHealth.consecutiveTimeouts > 0) {
          const cdpBudget = Math.min(1500, Math.max(500, Math.floor(limit * 0.25)));
          const cdpResult = await executeGptJavaScriptViaCdp(contents, script, cdpBudget);
          if (cdpResult.supported) return cdpResult.value;
          if (cdpResult.error) {
            appendDesktopLog("gpt-cdp-fallback", `label=${label} reason=${String(cdpResult.error).slice(0, 160)}`);
          }
        }
        return contents.executeJavaScript(script, true);
      })
      .then((value) => {
        noteGptBridgeSuccess(account, channel);
        releaseChannel();
        finish(value);
      })
      .catch(() => {
        releaseChannel();
        finish(fallback);
      });
  }));
  const executionTail = resultPromise.then(() => executionReleased, () => executionReleased);
  executionTails.set(channel, executionTail);
  gptJavaScriptExecutionTails.set(contents, executionTails);
  executionTail.then(() => {
    if (executionTails.get(channel) === executionTail) {
      executionTails.delete(channel);
    }
    if (executionTails.size === 0 && gptJavaScriptExecutionTails.get(contents) === executionTails) {
      gptJavaScriptExecutionTails.delete(contents);
    }
  }, () => {
    if (executionTails.get(channel) === executionTail) {
      executionTails.delete(channel);
    }
    if (executionTails.size === 0 && gptJavaScriptExecutionTails.get(contents) === executionTails) {
      gptJavaScriptExecutionTails.delete(contents);
    }
  });
  return resultPromise;
}

const GPT_PAGE_READINESS_FALLBACK = {
  url: "",
  readyState: "",
  extensionReady: false,
  extensionVersion: "",
  extensionSource: "",
  composerReady: false,
  authenticationRequired: false,
  chatConversation: false
};

function gptPageReadinessScript() {
  return `(() => {
    const url = String(location.href || "");
    const signalNodes = document.querySelectorAll('input, button, [role="alert"], [role="dialog"], h1, h2');
    const signalParts = [];
    for (let index = 0; index < Math.min(signalNodes.length, 40); index += 1) {
      const node = signalNodes[index];
      signalParts.push(String(node.innerText || node.getAttribute?.("aria-label") || node.value || "").slice(0, 160));
    }
    const bodyText = signalParts.join(" ").slice(0, 2000).toLowerCase();
    const composerReady = Boolean(document.querySelector('#prompt-textarea, textarea[data-id="root"], [contenteditable="true"]'));
    const authenticationSignal = ["one-time code", "one time code", "verification code", "verify your identity", "check your email", "sign in", "log in", "一次性验证码", "验证码", "检查邮箱", "登录"]
      .some((signal) => bodyText.includes(signal));
    const terminalAuthenticationSignal = ["session has expired", "your session has expired", "会话已过期", "请重新登录"]
      .some((signal) => bodyText.includes(signal));
    let parsedUrl = null;
    try { parsedUrl = new URL(url); } catch (_) { parsedUrl = null; }
    const pathname = String(parsedUrl?.pathname || "").replace(/\\/+$/, "") || "/";
    const chatHost = parsedUrl?.hostname === "chatgpt.com" || parsedUrl?.hostname === "www.chatgpt.com";
    const chatConversation = Boolean(chatHost && (/^\\/c\\/[a-z0-9_-]+(?:\\/|$)/i.test(pathname) || /^\\/g\\/[a-z0-9_-]+\\/c\\/[a-z0-9_-]+(?:\\/|$)/i.test(pathname)));
    const authenticationUrl = parsedUrl?.hostname === "auth.openai.com"
      || pathname.startsWith("/auth/login")
      || pathname.startsWith("/auth/signup")
      || pathname.startsWith("/api/auth/signin");
    return {
      url,
      readyState: document.readyState,
      extensionReady: document.documentElement.dataset.tbGptProductionExtension === "ready" || Boolean(document.getElementById("tb-gpt-production-extension-marker")),
      extensionVersion: document.documentElement.dataset.tbGptProductionExtensionVersion || document.getElementById("tb-gpt-production-extension-marker")?.content || "",
      extensionSource: document.documentElement.dataset.tbGptProductionExtensionSource || "",
      composerReady,
      authenticationRequired: authenticationUrl || terminalAuthenticationSignal || (!composerReady && authenticationSignal),
      chatConversation
    };
  })()`;
}

async function probeGptPageReadiness(account, label = "readiness", timeoutMs = 3000) {
  const contents = account?.view?.webContents;
  if (!contents || contents.isDestroyed()) return { ...GPT_PAGE_READINESS_FALLBACK, errorCode: "GPT_PAGE_NOT_READY" };
  const targetUrl = contents.getURL();
  const fallback = {
    ...GPT_PAGE_READINESS_FALLBACK,
    url: targetUrl,
    readyState: account.pageState?.domReady ? "complete" : "",
    extensionReady: Boolean(account.pageState?.extensionReady),
    chatConversation: Boolean(normalizeChatConversationUrl(targetUrl)),
    readTimedOut: true
  };
  const state = await executeGptJavaScriptBounded(
    contents,
    gptPageReadinessScript(),
    timeoutMs,
    fallback,
    `${label}:${account.id}`
  );
  const normalized = { ...GPT_PAGE_READINESS_FALLBACK, ...(state && typeof state === "object" ? state : {}) };
  const readTimedOut = Boolean(normalized.readTimedOut);
  normalized.productionReady = isGptPageProductionReady(normalized);
  normalized.errorCode = normalized.authenticationRequired
    ? "GPT_AUTH_REQUIRED"
    : (normalized.productionReady ? "" : (readTimedOut ? "GPT_BRIDGE_READ_TIMEOUT" : "GPT_PAGE_NOT_READY"));
  if (account.pageState && !readTimedOut) {
    account.pageState.domReady = ["interactive", "complete"].includes(String(normalized.readyState || ""));
    account.pageState.extensionReady = Boolean(normalized.extensionReady);
    if (normalized.productionReady) {
      account.pageState.loading = false;
      account.pageState.finished = true;
      account.pageState.finishedAt ||= new Date().toISOString();
      notifyGptLoadingChanged(account.id, false);
    }
  }
  normalized.readTimedOut = readTimedOut;
  normalized.knownPageStable = shouldPreserveGptPageAfterReadTimeout({
    readTimedOut,
    knownDomReady: Boolean(account.pageState?.domReady),
    knownFinished: Boolean(account.pageState?.finished),
    targetUrl
  });
  return normalized;
}

function isFreshRootGptPageReady(readiness = {}) {
  const url = String(readiness.url || "").trim();
  return /^https:\/\/(?:chatgpt\.com|www\.chatgpt\.com)\/?$/i.test(url)
    && readiness.extensionReady === true
    && readiness.composerReady === true
    && readiness.authenticationRequired !== true
    && ["interactive", "complete"].includes(String(readiness.readyState || ""));
}

function isFreshRootGptTaskPending(account, runtimeState = null) {
  const pending = account?.pendingGptTask;
  if (pending?.freshConversationBootstrap === true
    && (pending?.submittedToGpt !== true || !normalizeChatConversationUrl(pending?.conversationUrl))) return true;
  const persisted = runtimeState || readRuntimeState(GPT_RUNTIME_STATE_FILE) || {};
  const runtime = persisted?.control?.windowRuntime?.[account?.id] || {};
  const queue = persisted?.queue || {};
  const tasks = Array.isArray(queue.tasks) ? queue.tasks : [];
  const currentTaskId = String(
    runtime.currentTaskId
      || tasks[Number(queue.index || 0)]?.requestId
      || ""
  ).trim();
  const task = tasks.find((item) => String(item?.requestId || "").trim() === currentTaskId)
    || tasks[Number(queue.index || 0)];
  const freshSession = task?._freshConversationBootstrap === true
    || task?.freshConversationBootstrap === true
    || task?.workflowVariant === "fresh-session-fixed-template"
    || task?.sessionPolicy === "fresh-session"
    || runtime.workflowVariant === "fresh-session-fixed-template"
    || runtime.sessionPolicy === "fresh-session";
  if (!freshSession) return false;
  const submitted = task?._submittedToGpt === true || task?.submittedToGpt === true;
  const taskConversationUrl = normalizeChatConversationUrl(
    task?.conversationUrl || task?.browserConversationUrl || task?.chatUrl
  );
  const runtimeConversationUrl = normalizeChatConversationUrl(runtime.conversationUrl);
  const ownerConfirmed = task?._conversationLogOwnerConfirmed === true
    || task?.conversationOwnerConfirmed === true;
  // A fresh-session task with no durable owner proof must not reuse a stale
  // /c/... URL written by an earlier recovery attempt. It must recover at the
  // ChatGPT root until the exact conversation is explicitly confirmed.
  return !submitted || !taskConversationUrl || (!runtimeConversationUrl && !ownerConfirmed);
}

function durableSubmittedConversationUrl(accountId, runtimeState = null) {
  const key = String(accountId || "").trim();
  if (!key) return "";
  const persisted = runtimeState || readRuntimeState(GPT_RUNTIME_STATE_FILE) || {};
  const tasks = Array.isArray(persisted?.queue?.tasks) ? persisted.queue.tasks : [];
  const runtime = persisted?.control?.windowRuntime?.[key] || {};
  const currentTaskId = String(runtime.currentTaskId || "").trim();
  const candidate = tasks.find((task) => {
    const taskAccount = String(
      task?.accountId || task?.preferredAccountId || task?.accountWindowId || ""
    ).trim();
    const status = String(task?._status || task?.status || "").trim();
    const freshSession = task?._freshConversationBootstrap === true
      || task?.freshConversationBootstrap === true
      || task?.workflowVariant === "fresh-session-fixed-template"
      || task?.sessionPolicy === "fresh-session"
      || runtime.workflowVariant === "fresh-session-fixed-template"
      || runtime.sessionPolicy === "fresh-session";
    const ownerConfirmed = task?._conversationLogOwnerConfirmed === true
      || task?.conversationOwnerConfirmed === true;
    if (freshSession && !ownerConfirmed) return false;
    return taskAccount === key
      && task?._submittedToGpt === true
      && (!currentTaskId || String(task?.requestId || "").trim() === currentTaskId)
      && !["completed", "archived", "skipped"].includes(status)
      && Boolean(normalizeChatConversationUrl(
        task?.conversationUrl || task?.chatUrl || task?.browserConversationUrl || ""
      ));
  });
  return normalizeChatConversationUrl(
    candidate?.conversationUrl || candidate?.chatUrl || candidate?.browserConversationUrl || ""
  );
}

async function waitForGptPageReadiness(account, timeoutMs = 30_000, shouldStop = () => false, options = {}) {
  const deadline = Date.now() + Math.max(3_000, Number(timeoutMs) || 30_000);
  let last = { ...GPT_PAGE_READINESS_FALLBACK, productionReady: false, errorCode: "GPT_PAGE_NOT_READY" };
  while (Date.now() < deadline && !shouldStop()) {
    last = await probeGptPageReadiness(account, "send-readiness", 3000);
    if (last.authenticationRequired
      || last.productionReady
      || (options.allowFreshRoot === true && isFreshRootGptPageReady(last))) return last;
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(100, deadline - Date.now()))));
  }
  if (shouldStop()) return { ...last, status: "aborted", errorCode: "GPT_PAGE_RELOADED", error: "GPT 网页已重新加载，当前任务需要从检查点重接" };
  return {
    ...last,
    productionReady: false,
    errorCode: last.authenticationRequired ? "GPT_AUTH_REQUIRED" : "GPT_PAGE_NOT_READY",
    error: last.authenticationRequired ? "GPT 账号需要登录" : "GPT 网页尚未完成加载或输入框尚未出现"
  };
}

// The production extension still exposes TeambuildingGptConversationStateSnapshot
// for workflow/recovery actions.  Lightweight readiness probes deliberately do
// not call it because a busy native renderer must never make the status bridge
// wait on a full conversation scan.

async function ensureWechatDraftView() {
  if (wechatDraftView && !wechatDraftView.webContents.isDestroyed()) return wechatDraftView;
  if (!mainWindow) throw new Error("工作台窗口尚未就绪");
  const draftSession = session.fromPartition(WECHAT_DRAFT_PARTITION);
  const view = new WebContentsView({
    webPreferences: {
      partition: WECHAT_DRAFT_PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  wechatDraftView = view;
  view.setBackgroundColor("#f5f7f8");
  view.setBorderRadius(16);
  mainWindow.contentView.addChildView(view);
  view.setVisible(false);
  view.webContents.on("did-start-loading", () => {
    Object.assign(wechatDraftPageState, {
      loading: true,
      domReady: false,
      error: "",
      startedAt: new Date().toISOString(),
      finishedAt: ""
    });
  });
  view.webContents.on("dom-ready", () => {
    wechatDraftPageState.domReady = true;
    wechatDraftPageState.loading = false;
  });
  view.webContents.on("did-finish-load", () => {
    Object.assign(wechatDraftPageState, {
      loading: false,
      domReady: true,
      error: "",
      finishedAt: new Date().toISOString()
    });
  });
  view.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame) Object.assign(wechatDraftPageState, { loading: false, error: `${code}: ${description}` });
    appendDesktopLog("wechat-draft-load-failed", `code=${code} main=${isMainFrame} url=${validatedURL} ${description}`);
  });
  const notifyUrl = (_event, url) => {
    mainWindow?.webContents.send("desktop:wechat-draft-url-changed", { url: String(url || "") });
  };
  view.webContents.on("did-navigate", notifyUrl);
  view.webContents.on("did-navigate-in-page", notifyUrl);
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedWechatUrl(url)) {
      view.webContents.loadURL(url).catch((error) => appendDesktopLog("wechat-draft-popup-load-failed", error.message));
    }
    return { action: "deny" };
  });
  const initialLoad = await loadWechatUrlBounded(view.webContents, WECHAT_HOME_URL);
  if (!initialLoad.ok) appendDesktopLog("wechat-draft-initial-load-incomplete", initialLoad.error || initialLoad.readyAt || "unknown");
  await Promise.resolve(draftSession.flushStorageData()).catch(() => {});
  return view;
}

async function probeWechatDraftPage() {
  const view = await ensureWechatDraftView();
  const raw = await view.webContents.executeJavaScript(buildWechatWebProbeScript(), true)
    .catch((error) => ({
      url: view.webContents.getURL(),
      readyState: "",
      error: String(error?.message || error)
    }));
  if (["interactive", "complete"].includes(raw.readyState)) {
    wechatDraftPageState.domReady = true;
    wechatDraftPageState.loading = false;
  }
  return {
    ...classifyWechatWebPage(raw),
    ...raw,
    pageState: { ...wechatDraftPageState },
    loaded: true
  };
}

async function setWechatDraftImageFiles(contents, imagePaths) {
  let attachedHere = false;
  try {
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach("1.3");
      attachedHere = true;
    }
    await contents.debugger.sendCommand("DOM.enable");
    const documentNode = await contents.debugger.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
    const query = await contents.debugger.sendCommand("DOM.querySelector", {
      nodeId: documentNode.root.nodeId,
      selector: "[data-tb-wechat-image-input='ready']"
    });
    if (!query.nodeId) throw new Error("公众号编辑器没有找到可用的图片上传入口");
    await contents.debugger.sendCommand("DOM.setFileInputFiles", {
      nodeId: query.nodeId,
      files: imagePaths
    });
    return { ok: true, count: imagePaths.length };
  } finally {
    if (attachedHere && contents.debugger.isAttached()) contents.debugger.detach();
  }
}

async function waitForWechatDraftState(predicate, timeoutMs = 180000, intervalMs = 1000) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 0));
  let last = null;
  while (Date.now() < deadline) {
    last = await probeWechatDraftPage();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last || { stage: "failed", error: "公众号网页状态探测超时" };
}

async function openWechatDraftEditor(view, initialState, desiredDraftType = "newspic") {
  let state = initialState || await probeWechatDraftPage();
  if (state.stage === "login-required") return state;
  if (state.stage === "editor-ready") {
    return state.draftType === desiredDraftType
      ? state
      : { ...state, stage: "wrong-editor", error: `当前打开的是${state.draftType === "newspic" ? "贴图" : "文章"}编辑器，请返回公众号首页后重试` };
  }

  if (state.stage === "saved") {
    const loaded = await loadWechatUrlBounded(view.webContents, WECHAT_HOME_URL, 30000);
    if (!loaded.ok) return { ...state, stage: "failed", error: loaded.error || "公众号首页加载失败" };
    state = await waitForWechatDraftState(
      (next) => ["dashboard-ready", "editor-ready", "login-required"].includes(next.stage),
      30000
    );
  }

  if (state.stage !== "dashboard-ready") return state;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const opened = await view.webContents.executeJavaScript(buildWechatWebOpenEditorScript(desiredDraftType), true)
      .catch((error) => ({ ok: false, error: String(error?.message || error) }));
    if (opened?.ok) {
      return waitForWechatDraftState(
        (next) => ["editor-ready", "login-required", "failed"].includes(next.stage),
        60000
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    state = await probeWechatDraftPage();
    if (state.stage === "editor-ready" || state.stage === "login-required") return state;
  }
  return { ...state, error: state.error || "没有找到公众号的新建图文入口" };
}

async function runWechatWebDraft(input = {}) {
  if (wechatDraftRunPromise) return wechatDraftRunPromise;
  wechatDraftRunPromise = (async () => {
    const payload = normalizeWechatWebDraft(input);
    for (const imagePath of payload.images) {
      if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
        throw new Error(`图片文件不存在：${imagePath}`);
      }
    }
    const view = await ensureWechatDraftView();
    const before = await openWechatDraftEditor(view, await probeWechatDraftPage(), payload.draftType);
    if (before.stage !== "editor-ready") {
      return {
        ok: false,
        stage: before.stage,
        error: before.stage === "login-required"
          ? "请先在公众号原生网页扫码登录"
          : before.stage === "dashboard-ready"
            ? "请先在公众号后台打开一篇新的图文编辑页"
            : before.error || "公众号草稿编辑器尚未就绪",
        state: before
      };
    }
    const filled = await view.webContents.executeJavaScript(buildWechatWebFillScript(payload), true);
    if (!filled?.ok) return { ok: false, stage: "fill", error: "标题或正文没有成功写入网页", filled };
    const uploadStart = await probeWechatDraftPage();
    const uploadBaseline = Number(uploadStart.uploadedImageCount || 0);
    let uploaded = uploadStart;
    for (let index = 0; index < payload.images.length; index += 1) {
      if (payload.draftType === "article") {
        const caret = await view.webContents.executeJavaScript(buildWechatWebMoveCaretScript(), true);
        if (!caret?.ok) {
          return { ok: false, stage: "upload", error: caret?.error || "无法定位图片插入位置", state: uploaded };
        }
      }
      await setWechatDraftImageFiles(view.webContents, [payload.images[index]]);
      const expectedTotal = uploadBaseline + index + 1;
      uploaded = await waitForWechatDraftState((state) => (
        state.stage === "editor-ready"
        && !state.uploading
        && Number(state.uploadedImageCount || 0) >= expectedTotal
      ), 90000);
      if (uploaded.stage !== "editor-ready" || Number(uploaded.uploadedImageCount || 0) < expectedTotal) {
        return {
          ok: false,
          stage: "upload",
          error: `第 ${index + 1} 张图片上传未完成：${path.basename(payload.images[index])}`,
          uploadIndex: index,
          state: uploaded
        };
      }
    }
    const uploadOrder = payload.images.map((imagePath) => path.basename(imagePath));
    if (input.autoSave === false) {
      return { ok: true, stage: "ready-to-save", saved: false, payload, uploadOrder, state: uploaded };
    }
    const save = await view.webContents.executeJavaScript(buildWechatWebSaveScript(), true);
    if (!save?.ok) return { ok: false, stage: "save", error: save?.error || "保存草稿按钮不可用", save };
    const saved = await waitForWechatDraftState((state) => ["saved", "failed"].includes(state.stage), 90000);
    if (saved.stage !== "saved") {
      return { ok: false, stage: "save-confirmation", error: saved.error || "网页没有确认草稿保存成功", state: saved };
    }
    return { ok: true, stage: "saved", saved: true, payload, uploadOrder, state: saved };
  })().finally(() => {
    wechatDraftRunPromise = null;
  });
  return wechatDraftRunPromise;
}

async function initializeEmbeddedGptPage(account) {
  const view = account?.view;
  if (!view || view.webContents.isDestroyed()) return;
  // `did-finish-load` and the initial `loadURL()` continuation can arrive in
  // either order.  Coalesce them so a reload never installs two theme
  // observers or races the embedded workbench's localStorage bootstrap.
  if (account.gptInitializationPromise) return account.gptInitializationPromise;
  const initialization = (async () => {
    const apiRoot = new URL(APP_URL).origin;
    const initialized = await executeGptJavaScriptBounded(view.webContents, `(() => {
      localStorage.setItem("tb-workbench-embedded", "1");
      localStorage.setItem("tb-workbench-api-root", ${JSON.stringify(apiRoot)});
      localStorage.setItem("tb-workbench-account-id", ${JSON.stringify(account.id)});
      return true;
    })()`, GPT_INITIALIZATION_TIMEOUT_MS, null, `init:${account.id}`);
    account.gptEmbeddedInitialized = initialized !== null;
    if (initialized === null) appendDesktopLog("gpt-init-timeout", `account=${account.id}`);
    return applyEmbeddedGptTheme(account, gptThemeName);
  })();
  account.gptInitializationPromise = initialization;
  try {
    return await initialization;
  } finally {
    if (account.gptInitializationPromise === initialization) account.gptInitializationPromise = null;
  }
}

function embeddedGptPalette(theme = "neo") {
  const palettes = {
    neo: {
      dark: false, main: "#e9f0f6", sidebar: "#dce7f0", secondary: "#f4f7fa", tertiary: "#e2ebf2", composer: "#f7f9fb",
      textPrimary: "#0d0d0d", textSecondary: "#5d5d5d", textTertiary: "#8f8f8f", textPlaceholder: "#000000b3",
      iconPrimary: "#0d0d0d", iconSecondary: "#5d5d5d", iconTertiary: "#8f8f8f", sidebarBody: "#0d0d0d", sidebarIcon: "#7d7d7d",
      border: "#0000001a", hover: "#00000012", message: "#f4f4f4"
    },
    glass: {
      dark: false, main: "#edf4f8", sidebar: "#dfeaf1", secondary: "#f7fafc", tertiary: "#e5eef4", composer: "#f8fbfc",
      textPrimary: "#0d0d0d", textSecondary: "#5d5d5d", textTertiary: "#8f8f8f", textPlaceholder: "#000000b3",
      iconPrimary: "#0d0d0d", iconSecondary: "#5d5d5d", iconTertiary: "#8f8f8f", sidebarBody: "#0d0d0d", sidebarIcon: "#7d7d7d",
      border: "#0000001a", hover: "#00000012", message: "#f4f4f4"
    },
    midnight: {
      dark: true, main: "#0b1925", sidebar: "#07131e", secondary: "#142a3a", tertiary: "#1b3445", composer: "#173042",
      textPrimary: "#e8f1ef", textSecondary: "#b6c7cc", textTertiary: "#8faab3", textPlaceholder: "#b6c7cc",
      iconPrimary: "#e8f1ef", iconSecondary: "#b6c7cc", iconTertiary: "#8faab3", sidebarBody: "#e8f1ef", sidebarIcon: "#9bb2ba",
      border: "rgba(144, 193, 207, .22)", hover: "rgba(196, 222, 235, .12)", message: "#142a3a"
    },
    "midnight-glass": {
      dark: true, main: "#091722", sidebar: "#06111b", secondary: "#12293a", tertiary: "#19364a", composer: "#163246",
      textPrimary: "#edf6f7", textSecondary: "#b6c7cc", textTertiary: "#8faab3", textPlaceholder: "#b6c7cc",
      iconPrimary: "#edf6f7", iconSecondary: "#b6c7cc", iconTertiary: "#8faab3", sidebarBody: "#edf6f7", sidebarIcon: "#9bb2ba",
      border: "rgba(144, 193, 207, .2)", hover: "rgba(196, 222, 235, .12)", message: "#12293a"
    }
  };
  return palettes[theme] || palettes.neo;
}

function scheduleEmbeddedGptThemeReplay(account, delays = [0, 220, 900]) {
  if (!account) return;
  account.gptThemeReplayTimers?.forEach((timer) => clearTimeout(timer));
  account.gptThemeReplayTimers = delays.map((delay) => setTimeout(() => {
    // Let the embedded-page bootstrap own the first document evaluation;
    // an early theme write otherwise occupies the same WebContents tail and
    // makes initialization look like a bridge timeout.
    if (account.gptEmbeddedInitialized !== true) return;
    applyEmbeddedGptTheme(account, gptThemeName).catch((error) => {
      appendDesktopLog("gpt-theme-sync-failed", `${account.id} ${error.message}`);
    });
  }, delay));
}

async function applyEmbeddedGptTheme(account, theme = "neo") {
  const view = account?.view;
  const webContents = view?.webContents;
  if (!view || !webContents || typeof webContents.isDestroyed !== "function" || webContents.isDestroyed()) return false;
  const palette = embeddedGptPalette(theme);
  const isDark = palette.dark;
  try {
    view.setBackgroundColor(palette.main);
    const applied = await executeGptJavaScriptBounded(webContents, `(() => {
      const root = document.documentElement;
      const palette = ${JSON.stringify(palette)};
      const configuredColorScheme = ${JSON.stringify(isDark ? "dark" : "light")};
      root.dataset.tbWorkbenchTheme = ${JSON.stringify(theme)};
      root.dataset.tbWorkbenchColorScheme = configuredColorScheme;
      root.dataset.theme = ${JSON.stringify(isDark ? "dark" : "light")};
      const apply = () => {
        // ChatGPT may remove unknown data attributes during hydration. The
        // requested theme must stay authoritative in this document instead of
        // falling back to light mode when that happens.
        const dark = configuredColorScheme === "dark";
        root.classList.toggle("dark", dark);
        document.body?.classList.toggle("dark", dark);
        root.style.setProperty("color-scheme", dark ? "dark" : "light", "important");
        document.body?.style.setProperty("background-color", palette.main, "important");
        document.body?.style.setProperty("color-scheme", dark ? "dark" : "light", "important");
        const values = {
        "--main-surface-primary": palette.main,
        "--sidebar-surface-primary": palette.sidebar,
        "--sidebar-surface": palette.sidebar,
        "--bg-secondary-surface": palette.sidebar,
        "--main-surface-secondary": palette.secondary,
        "--main-surface-secondary-selected": palette.tertiary,
        "--main-surface-tertiary": palette.tertiary,
        "--main-surface-background": palette.secondary,
        "--composer-surface-primary": palette.composer,
        "--composer-surface": palette.composer,
        // ChatGPT's current renderer uses explicit text/icon tokens instead
        // of inheriting body color; keep them in sync after page reloads.
        "--text-primary": palette.textPrimary,
        "--text-secondary": palette.textSecondary,
        "--text-tertiary": palette.textTertiary,
        "--text-placeholder": palette.textPlaceholder,
        "--text-primary-inverse": palette.dark ? "#0d0d0d" : "#ececec",
        "--text-inverted": palette.dark ? "#071522" : "#fff",
        "--icon-primary": palette.iconPrimary,
        "--icon-secondary": palette.iconSecondary,
        "--icon-tertiary": palette.iconTertiary,
        "--icon-surface": palette.dark ? "232 241 239" : "13 13 13",
        "--sidebar-body-primary": palette.sidebarBody,
        "--sidebar-icon": palette.sidebarIcon,
        "--component-sidebar-bg": palette.sidebar,
        "--sidebar-surface-secondary": palette.dark ? palette.tertiary : "#ececec",
        "--sidebar-surface-tertiary": palette.dark ? palette.secondary : "#e3e3e3",
        "--message-surface": palette.message,
        "--surface-hover": palette.hover,
        "--border-default": palette.border,
        "--border-light": palette.border,
        "--border-medium": palette.border,
        "--border-heavy": palette.border,
        "--theme-secondary-btn-text": palette.textPrimary,
        "--theme-user-msg-text": palette.textPrimary,
        "--default-theme-secondary-btn-text": palette.textPrimary,
        "--default-theme-user-msg-text": palette.textPrimary,
        "--blue-theme-secondary-btn-text": palette.textPrimary,
        "--blue-theme-user-msg-text": palette.textPrimary,
        "--black-theme-secondary-btn-text": palette.textPrimary,
        "--black-theme-user-msg-text": palette.textPrimary
        };
        Object.entries(values).forEach(([name, value]) => root.style.setProperty(name, value, "important"));
      };
      window.__tbWorkbenchThemeObserver?.disconnect?.();
      window.__tbWorkbenchThemeObserver = new MutationObserver(() => queueMicrotask(apply));
      window.__tbWorkbenchThemeObserver.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
      apply();
      return root.dataset.tbWorkbenchColorScheme;
    })()`, 4000, null, `theme:${account.id}`);
    if (applied === null) return false;
    return true;
  } catch (error) {
    // A view can be released between the guard and executeJavaScript during
    // automatic renderer recovery. That is an expected stale-view race, not
    // a theme failure and must not flood the production log.
    if (account?.view !== view || webContents.isDestroyed()) return false;
    appendDesktopLog("gpt-theme-sync-failed", `${account.id} ${error.message}`);
    return false;
  }
}

function waitForExtensionReady(profileSession, extensionId, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      profileSession.off("extension-ready", onReady);
      resolve(Boolean(ready));
    };
    const onReady = (_event, extension) => {
      if (!extensionId || extension?.id === extensionId) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    profileSession.on("extension-ready", onReady);
    const alreadyLoaded = profileSession.extensions?.getAllExtensions?.()
      ?.some((extension) => extension?.id === extensionId);
    if (alreadyLoaded) finish(true);
  });
}

async function readEmbeddedExtensionState(account, attempts = 12, intervalMs = 250) {
  const contents = account?.view?.webContents;
  if (!contents || contents.isDestroyed()) return { ready: false, version: "", source: "" };
  for (let index = 0; index < attempts; index += 1) {
    const state = await contents.executeJavaScript(`({
      ready: document.documentElement.dataset.tbGptProductionExtension === "ready" || Boolean(document.getElementById("tb-gpt-production-extension-marker")),
      version: document.documentElement.dataset.tbGptProductionExtensionVersion || document.getElementById("tb-gpt-production-extension-marker")?.content || "",
      source: document.documentElement.dataset.tbGptProductionExtensionSource || ""
    })`, true).catch(() => ({ ready: false, version: "", source: "" }));
    if (state.ready) return state;
    if (index + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ready: false, version: "", source: "" };
}

async function ensureGptAccount(accountId = activeGptAccountId) {
  const id = assertAssignedGptAccountId(accountId);
  const existing = gptAccounts.get(id);
  if (existing?.view && !existing.view.webContents.isDestroyed()) return existing;
  if (existing?.initializing) return existing.initializing;
  if (!mainWindow) throw new Error("工作台窗口尚未就绪");
  const account = {
    id,
    partition: `${GPT_PARTITION_PREFIX}-${id}`,
    session: session.fromPartition(`${GPT_PARTITION_PREFIX}-${id}`),
    view: null,
    extensionInfo: null,
    extensionPath: "",
    extensionRuntimeReady: false,
    extensionError: "",
    pageState: {
      loading: true,
      domReady: false,
      finished: false,
      extensionReady: false,
      error: "",
      startedAt: new Date().toISOString(),
      finishedAt: ""
    },
    lastUsedAt: Date.now(),
    pendingGptTask: null,
    // A renderer-level "停止本窗口" must also stop the native page-recovery
    // timer. Without this separate flag, a stopped account could still be
    // reloaded by the Electron loading watchdog while the queue was held.
    userRecoveryHold: persistedGptUserHold(id),
    loadRecoveryTimer: null,
    loadRecoveryResetTimer: null,
    loadRecoveryAttempts: 0,
    initializing: null
  };
  gptAccounts.set(id, account);
  const initializeAccount = async () => {
  const extensionPath = resolveGptExtensionPath();
  account.extensionPath = extensionPath;
  try {
    if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) throw new Error(`扩展目录不存在：${extensionPath}`);
    account.extensionInfo = await account.session.extensions.loadExtension(extensionPath, { allowFileAccess: true });
    account.extensionRuntimeReady = await waitForExtensionReady(account.session, account.extensionInfo.id);
    appendDesktopLog("gpt-extension-loaded", `${id} ${account.extensionInfo.name} ${account.extensionInfo.version}`);
  } catch (error) {
    account.extensionError = error.message;
    appendDesktopLog("gpt-extension-failed", `${id} ${error.stack || error.message}`);
  }
  account.view = new WebContentsView({
    webPreferences: {
      partition: account.partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Automatic production must continue while the workbench is minimized
      // to the tray. Chromium otherwise heavily throttles or suspends timers
      // in this hidden WebContentsView and the workflow appears stuck after 1.
      backgroundThrottling: false
    }
  });
  const currentUserAgent = account.view.webContents.getUserAgent();
  account.view.webContents.setUserAgent(`${currentUserAgent} TeambuildingWorkbenchGPT/0.2`);
  account.view.setBackgroundColor(embeddedGptPalette(gptThemeName).main);
  account.view.setBorderRadius(16);
  mainWindow.contentView.addChildView(account.view);
  account.view.setVisible(false);
  account.view.webContents.on("did-start-loading", () => {
    // ChatGPT may perform a full-document reload while keeping the same
    // conversation. Do not turn that navigation signal into an immediate
    // production abort: the durable result/checkpoint bridge can reappear
    // after DOM ready. A confirmed navigation to another /c/... is handled by
    // did-navigate below.
    if (account.pendingGptTask) {
      appendDesktopLog("gpt-task-navigation-deferred", `account=${id} requestId=${account.pendingGptTask.requestId}`);
    }
    account.bridgeTimeoutStreak = 0;
    // Keep the timeout-recovery ownership token until the recovery chain has
    // either recreated this view or explicitly confirmed a usable bridge.
    // Clearing it on did-start-loading/dom-ready races the scheduled recreate
    // and recreates the old task-in-flight deadlock.
    if (account.loadRecoveryResetTimer) {
      clearTimeout(account.loadRecoveryResetTimer);
      account.loadRecoveryResetTimer = null;
    }
    Object.assign(account.pageState, { loading: true, domReady: false, finished: false, extensionReady: false, error: "", startedAt: new Date().toISOString(), finishedAt: "" });
    account.gptEmbeddedInitialized = false;
    if (!account.userRecoveryHold) scheduleStalledGptPageRecovery(account);
    notifyGptLoadingChanged(id, true);
  });
  account.view.webContents.on("dom-ready", () => {
    account.bridgeTimeoutStreak = 0;
    if (account.loadRecoveryTimer) {
      clearTimeout(account.loadRecoveryTimer);
      account.loadRecoveryTimer = null;
    }
    scheduleGptPageRecoveryReset(account);
    // ChatGPT keeps background requests alive after the usable DOM and
    // composer are ready. Chromium may therefore omit/delay did-finish-load;
    // the workbench progress indicator must reflect usability, not idle
    // network silence.
    Object.assign(account.pageState, {
      loading: false,
      domReady: true,
      finished: true,
      finishedAt: new Date().toISOString()
    });
    notifyGptLoadingChanged(id, false);
    // The bootstrap below owns the first document evaluation. Theme replay
    // waits for it instead of occupying the same execution tail first.
    scheduleEmbeddedGptThemeReplay(account, [1200, 2200]);
  });
  account.view.webContents.on("did-finish-load", async () => {
    if (account.loadRecoveryTimer) {
      clearTimeout(account.loadRecoveryTimer);
      account.loadRecoveryTimer = null;
    }
    scheduleGptPageRecoveryReset(account);
    Object.assign(account.pageState, { loading: false, domReady: true, finished: true, finishedAt: new Date().toISOString() });
    notifyGptLoadingChanged(id, false);
    await initializeEmbeddedGptPage(account);
    scheduleEmbeddedGptThemeReplay(account, [180, 700]);
    const embeddedExtension = await readEmbeddedExtensionState(account);
    account.pageState.extensionReady = embeddedExtension.ready;
    account.pageState.extensionVersion = embeddedExtension.version;
    account.pageState.extensionSource = embeddedExtension.source;
    if (!embeddedExtension.ready) {
      account.pageState.error = "生产扩展未注入，已停止自动生产；可刷新网页重试";
      appendDesktopLog("gpt-extension-not-injected", `account=${id} path=${account.extensionPath}`);
    }
  });
  account.view.webContents.on("did-navigate", (_event, url) => {
    const pendingConversation = normalizeChatConversationUrl(account.pendingGptTask?.conversationUrl || "");
    const navigatedConversation = normalizeChatConversationUrl(url);
    if (pendingConversation && navigatedConversation && pendingConversation !== navigatedConversation) {
      abortPendingGptTask(account, "GPT 网页已切换到其他对话，当前任务需要从原检查点重接");
    }
    rememberBrowserUrl(id, url);
    scheduleEmbeddedGptThemeReplay(account);
  });
  account.view.webContents.on("did-navigate-in-page", (_event, url) => {
    rememberBrowserUrl(id, url);
    scheduleEmbeddedGptThemeReplay(account, [80, 320]);
  });
  account.view.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    // Chromium emits ERR_ABORTED (-3) for an ordinary redirect/reload handoff.
    // The next navigation is still loading, so do not flash a false failure.
    if (isMainFrame && code !== -3) {
      Object.assign(account.pageState, { loading: false, finished: false, error: `${code}: ${description}` });
      notifyGptLoadingChanged(id, false, true);
    }
    appendDesktopLog("gpt-load-failed", `account=${id} code=${code} main=${isMainFrame} url=${validatedURL} ${description}`);
  });
  const savedProfiles = readBrowserProfiles();
  const savedProfile = savedProfiles.profiles.find((profile) => profile.id === id);
  const startupFreshRoot = isFreshRootGptTaskPending({ id }, readRuntimeState(GPT_RUNTIME_STATE_FILE));
  if (startupFreshRoot && savedProfile) {
    // Do not let a stale profile conversation win over a fresh-session task
    // whose submitted turn has not been durably tied to that conversation.
    savedProfile.lastUrl = GPT_URL;
    savedProfile.lastBrowserUrl = GPT_URL;
    savedProfile.lastInvalidConversationUrl = normalizeChatConversationUrl(
      savedProfile.lastConversationUrl || savedProfile.lastBrowserUrl
    );
    savedProfile.lastConversationUrl = "";
    writeBrowserProfiles(savedProfiles);
  }
  const startupProfile = startupFreshRoot
    ? { ...(savedProfile || {}), lastUrl: GPT_URL, lastBrowserUrl: GPT_URL, lastConversationUrl: "" }
    : (savedProfile || {});
  const startupUrl = safeBrowserUrlOrDefault(resolveGptStartupUrl(startupProfile, GPT_URL));
  const loaded = await loadGptUrlBounded(account.view.webContents, startupUrl, 15_000);
  if (!loaded.ok) appendDesktopLog("gpt-account-load-bounded", `account=${id} url=${startupUrl} error=${loaded.error || "timeout"}`);
  await initializeEmbeddedGptPage(account);
  return account;
  };
  account.initializing = enqueueGptAccountInitialization(initializeAccount, id);
  try {
    return await account.initializing;
  } finally {
    account.initializing = null;
  }
}

function activeGptAccount() {
  const account = gptAccounts.get(activeGptAccountId);
  return account?.view && !account.view.webContents.isDestroyed() ? account : null;
}

function scheduleGptPageRecoveryReset(account) {
  if (!account) return;
  if (account.loadRecoveryResetTimer) clearTimeout(account.loadRecoveryResetTimer);
  account.loadRecoveryResetTimer = setTimeout(() => {
    account.loadRecoveryResetTimer = null;
    if (!account.pageState?.loading) account.loadRecoveryAttempts = 0;
  }, 60_000);
}

function scheduleStalledGptPageRecovery(account) {
  if (!account?.view || account.view.webContents.isDestroyed()) return;
  const forceRecovery = Boolean(account.forceGptPageRecovery);
  account.forceGptPageRecovery = false;
  if (account.loadRecoveryTimer) clearTimeout(account.loadRecoveryTimer);
  const startedAt = String(account.pageState?.startedAt || "");
  const initialTargetUrl = resolveGptRecoveryTargetUrl(account);
  const initialPlan = planGptPageRecovery({
    attempts: Number(account.loadRecoveryAttempts || 0),
    targetUrl: initialTargetUrl
  });
  account.loadRecoveryTimer = setTimeout(async () => {
    account.loadRecoveryTimer = null;
    if (!account.pageState?.loading || String(account.pageState.startedAt || "") !== startedAt) return;
    const contents = account.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    const bridgeRecoveryOwnsTask = account.bridgeRecoveryPending === true
      && !account.pendingGptTask
      && !account.userRecoveryHold
      && !account.maintenancePromise;
    if (!bridgeRecoveryOwnsTask && shouldDeferGptPageRecovery({
      pendingRequest: Boolean(account.pendingGptTask),
      userHold: Boolean(account.userRecoveryHold)
    })) {
      const reason = account.userRecoveryHold ? "user-stop" : "task-in-flight";
      appendDesktopLog("gpt-page-recovery-deferred", `account=${account.id} reason=${reason} requestId=${account.pendingGptTask?.requestId || "unknown"}`);
      if (!account.userRecoveryHold) {
        account.loadRecoveryTimer = setTimeout(() => {
          account.loadRecoveryTimer = null;
          if (account.pageState?.loading && String(account.pageState.startedAt || "") === startedAt) {
            scheduleStalledGptPageRecovery(account);
          }
        }, 20_000);
      }
      return;
    }
    // Chromium can keep the navigation lifecycle in `loading` while the
    // usable ChatGPT DOM, composer, and production extension are already
    // live. Probe the document before forcing a reload; otherwise a slow but
    // healthy GPT window loses its durable bridge checkpoint unnecessarily.
    const liveReadiness = await probeGptPageReadiness(account, "recovery", 3000).catch(() => null);
    if (account.userRecoveryHold) {
      appendDesktopLog("gpt-page-recovery-deferred", `account=${account.id} reason=user-stop-after-probe`);
      return;
    }
    const preservedAfterReadTimeout = shouldPreserveGptPageAfterReadTimeout({
      readTimedOut: Boolean(liveReadiness?.readTimedOut),
      knownDomReady: Boolean(account.pageState?.domReady),
      knownFinished: Boolean(account.pageState?.finished),
      targetUrl: contents.getURL()
    });
    const recoveryRuntimeState = readRuntimeState(GPT_RUNTIME_STATE_FILE) || {};
    const recoveryRuntime = recoveryRuntimeState?.control?.windowRuntime?.[account.id] || {};
    const automaticRecoveryPending = !account.pendingGptTask
      && !productionTaskAccounts.has(account.id)
      && Boolean(String(recoveryRuntime.currentTaskId || "").trim())
      && ["retry-wait", "failed", "probing"].includes(String(recoveryRuntime.status || ""))
      && recoveryRuntime.pausedByUser !== true
      && recoveryRuntime.stoppedByUser !== true;
    // DOM-ready only proves Chromium mounted a document. During automatic
    // recovery it is not enough: the production bridge and composer must be
    // responsive before we suppress a reload, otherwise a renderer with a
    // dead executeJavaScript channel can remain in retry-wait forever. Active
    // production requests are already deferred above and keep their page.
    const productionBridgeReady = Boolean(liveReadiness?.productionReady || liveReadiness?.authenticationRequired);
    const freshRootReady = isFreshRootGptTaskPending(account, recoveryRuntimeState)
      && isFreshRootGptPageReady(liveReadiness || { url: contents.getURL() });
    const stableForAutomaticRecovery = isGptPageDocumentStable({
      ...(liveReadiness || { url: contents.getURL() }),
      freshRootReady
    })
      && (!automaticRecoveryPending || productionBridgeReady);
    const preserveKnownPage = preservedAfterReadTimeout;
    if (!forceRecovery && (stableForAutomaticRecovery || preserveKnownPage)) {
      Object.assign(account.pageState, {
        loading: false,
        domReady: true,
        finished: true,
        error: "",
        finishedAt: account.pageState.finishedAt || new Date().toISOString()
      });
      scheduleGptPageRecoveryReset(account);
      const reason = preservedAfterReadTimeout
        ? "bridge-timeout-known-stable"
        : liveReadiness?.authenticationRequired
        ? "authentication-page"
        : freshRootReady
          ? "fresh-root-bootstrap"
        : liveReadiness?.productionReady
          ? "live-ready"
          : "dom-ready";
      appendDesktopLog("gpt-page-recovery-suppressed", `account=${account.id} reason=${reason} url=${contents.getURL()}`);
      if (account.bridgeRecoveryPending) {
        account.bridgeRecoveryPending = false;
        appendDesktopLog("gpt-bridge-recovery-confirmed", `account=${account.id} url=${contents.getURL()}`);
      }
      notifyGptLoadingChanged(account.id, false);
      return;
    }
    const targetUrl = resolveGptRecoveryTargetUrl(account);
    const attempts = Number(account.loadRecoveryAttempts || 0);
    const plan = planGptPageRecovery({ attempts, targetUrl });
    if (plan.action === "wait") {
      const retryAfterMs = Math.max(60_000, Number(plan.timeoutMs || 0));
      const recoveryRuntime = readRuntimeState(GPT_RUNTIME_STATE_FILE)?.control?.windowRuntime?.[account.id] || {};
      const bridgeRecoveryOwnsTask = account.bridgeRecoveryPending === true
        && !account.pendingGptTask
        && !account.userRecoveryHold
        && !account.maintenancePromise
        && recoveryRuntime.pausedByUser !== true
        && recoveryRuntime.stoppedByUser !== true;
      const canRecreateStalledConversation = ["running", "retry-wait", "failed", "probing"].includes(String(recoveryRuntime.status || ""))
        && recoveryRuntime.pausedByUser !== true
        && recoveryRuntime.stoppedByUser !== true
        && (bridgeRecoveryOwnsTask || (
          !productionTaskAccounts.has(account.id)
          && !account.pendingGptTask
          && !account.maintenancePromise
        ));
      if (canRecreateStalledConversation) {
        account.loadRecoveryAttempts = 0;
        Object.assign(account.pageState, { loading: false, finished: false, error: "GPT 网页桥接持续无响应，正在重建原会话窗口" });
        appendDesktopLog("gpt-page-recovery-recreate", `account=${account.id} reason=stalled-conversation-bridge url=${targetUrl}`);
        const recreated = await recreateGptAccountView(account.id, { reason: "stalled-conversation-bridge" }).catch((error) => ({ ok: false, error: error?.message || String(error) }));
        if (recreated?.ok) return;
        appendDesktopLog("gpt-page-recovery-recreate-deferred", `account=${account.id} reason=${String(recreated?.skipped || recreated?.error || "unknown").slice(0, 120)}`);
      }
      const error = "GPT 网页暂态异常，已进入自动探测等待；不会要求手动重开";
      Object.assign(account.pageState, { loading: false, finished: false, error });
      appendDesktopLog("gpt-page-recovery-waiting", `account=${account.id} attempts=${attempts} retryAfterMs=${retryAfterMs} url=${targetUrl}`);
      notifyGptLoadingChanged(account.id, false, true);
      account.loadRecoveryTimer = setTimeout(() => {
        account.loadRecoveryTimer = null;
        if (account.userRecoveryHold || account.pendingGptTask) return;
        account.loadRecoveryAttempts = 0;
        Object.assign(account.pageState, { loading: true, finished: false, error: "", startedAt: new Date().toISOString() });
        scheduleStalledGptPageRecovery(account);
        notifyGptLoadingChanged(account.id, true);
      }, retryAfterMs);
      return;
    }
    account.loadRecoveryAttempts = attempts + 1;
    appendDesktopLog("gpt-page-load-stalled", `account=${account.id} attempt=${account.loadRecoveryAttempts}/${plan.maxAttempts} elapsedMs=${plan.timeoutMs} method=${plan.action} url=${targetUrl}`);
    try { contents.stop(); } catch {}
    // `loadURL()` returns a navigation promise that Electron internally keeps
    // tied to WebContents loading events. When the renderer is already hung,
    // stacking another `loadURL()` on every recovery attempt accumulates
    // `did-stop-loading` listeners and eventually makes the bridge even less
    // responsive. Recovery is an in-place reload, so use the void-returning
    // reload APIs and let the readiness watchdog observe the result.
    const reload = plan.action === "reloadIgnoringCache" && typeof contents.reloadIgnoringCache === "function"
      ? () => contents.reloadIgnoringCache()
      : () => contents.reload();
    try {
      reload();
    } catch (error) {
      appendDesktopLog("gpt-page-recovery-failed", `account=${account.id} ${error?.message || error}`);
      // A previous navigation can still own Chromium's load lifecycle even
      // after `stop()`. In that state another in-place reload throws
      // `ERR_ABORTED`; keep retrying the same view would only leave the task
      // in retry-wait. Rebuild this account's WebContents instead, preserving
      // its partition and the exact fresh-root/conversation checkpoint.
      const recoveryRequestId = String(
        recoveryRuntime.currentTaskId || account.pendingGptTask?.requestId || ""
      ).trim();
      const rebuilt = await recreateGptAccountView(account.id, {
        reason: "stalled-navigation",
        forceRecovery: true,
        controlledRecovery: Boolean(recoveryRequestId),
        allowActiveTaskRecovery: true,
        recoveryRequestId,
        knownConversationUrl: freshRootReady ? GPT_URL : targetUrl,
        freshRoot: freshRootReady,
        invalidConversationUrl: targetUrl
      }).catch((rebuildError) => ({ ok: false, error: rebuildError?.message || String(rebuildError) }));
      if (!rebuilt?.ok) {
        appendDesktopLog("gpt-page-recovery-recreate-deferred", `account=${account.id} reason=${String(rebuilt?.skipped || rebuilt?.error || "unknown").slice(0, 120)}`);
      }
    }
  }, initialPlan.timeoutMs);
}

function loadGptUrlBounded(contents, url, timeoutMs = 15_000) {
  if (!contents || contents.isDestroyed()) return Promise.resolve({ ok: false, error: "GPT 网页视图不可用", url });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      contents.removeListener("dom-ready", onReady);
      contents.removeListener("did-fail-load", onFail);
      resolve(result);
    };
    const onReady = () => finish({ ok: true, url: contents.getURL(), readyAt: "dom-ready" });
    const onFail = (_event, code, description, validatedURL, isMainFrame) => {
      if (isMainFrame) finish({ ok: false, error: `${code}: ${description}`, url: validatedURL });
    };
    const timer = setTimeout(() => finish({
      ok: false,
      error: "GPT 网页加载超时，已交给自动恢复继续探测",
      url: contents.getURL() || url,
      readyAt: "timeout"
    }), Math.max(3000, Number(timeoutMs || 0)));
    contents.once("dom-ready", onReady);
    contents.on("did-fail-load", onFail);
    Promise.resolve(contents.loadURL(url)).catch((error) => finish({ ok: false, error: error.message, url }));
  });
}

function hideAllGptViews(exceptId = "") {
  for (const [id, account] of gptAccounts) {
    if (!account.view || account.view.webContents.isDestroyed()) continue;
    account.view.setVisible(Boolean(exceptId && id === exceptId));
  }
}

async function ensureGptView(accountId = activeGptAccountId) {
  const account = await ensureGptAccount(accountId);
  return account.view;
}

function waitForGptPageLoad(contents, timeoutMs = 120000) {
  if (!contents || contents.isDestroyed()) return Promise.resolve({ ok: false, error: "GPT 网页视图不可用" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      contents.removeListener("did-finish-load", onFinish);
      contents.removeListener("did-fail-load", onFail);
      resolve(result);
    };
    const onFinish = () => finish({ ok: true, url: contents.getURL() });
    const onFail = (_event, code, description, validatedURL, isMainFrame) => {
      if (isMainFrame) finish({ ok: false, error: `${code}: ${description}`, url: validatedURL });
    };
    const timer = setTimeout(() => finish({ ok: false, error: "GPT 网页刷新超时", url: contents.getURL() }), Math.max(5000, timeoutMs));
    contents.once("did-finish-load", onFinish);
    contents.on("did-fail-load", onFail);
  });
}

async function refreshGptAccountSession(accountId = activeGptAccountId, options = {}) {
  const id = assertAssignedGptAccountId(accountId);
  const account = await ensureGptAccount(id);
  const contents = account?.view?.webContents;
  if (!contents || contents.isDestroyed()) return { ok: false, accountId: id, error: "GPT 网页视图不可用" };
  if (account.maintenancePromise) return account.maintenancePromise;
  // A maintenance refresh is also a navigation.  Never let the post-task
  // refresh/cache timer interrupt a new task that has already taken ownership
  // of this account's original /c/... conversation.  The renderer has the
  // same guard, but this native boundary is the final protection because a
  // did-start-loading event aborts the pending bridge task.
  const durableRuntime = readRuntimeState(GPT_RUNTIME_STATE_FILE)?.control?.windowRuntime?.[id] || {};
  const durableTaskStillBusy = Boolean(
    durableRuntime.currentTaskId
    && !["idle", "completed", "waiting-quota"].includes(String(durableRuntime.status || ""))
    && durableRuntime.pausedByUser !== true
    && durableRuntime.stoppedByUser !== true
  );
  if (productionTaskAccounts.has(id) || account.pendingGptTask || durableTaskStillBusy) {
    const reason = String(options.reason || "production-complete").slice(0, 80);
    appendDesktopLog("gpt-page-maintenance-deferred", `account=${id} reason=${reason} active-task=true`);
    return {
      ok: false,
      deferred: true,
      accountId: id,
      reason: "active-task",
      error: "当前账号仍有自动生产检查点，已延后网页刷新"
    };
  }
  const clearTemporaryCache = Boolean(options.clearTemporaryCache || options.clearCache);
  const reason = String(options.reason || (clearTemporaryCache ? "3h-temporary-cache" : "production-complete")).slice(0, 80);
  account.maintenancePromise = (async () => {
    let cacheError = "";
    if (clearTemporaryCache) {
      try {
        // Safe maintenance boundary: clear Chromium's HTTP/media cache only.
        // Never call clearStorageData here; cookies, localStorage and the
        // account partition contain the user's GPT/Google login state.
        await account.session.clearCache();
      } catch (error) {
        cacheError = String(error?.message || error);
        appendDesktopLog("gpt-cache-clear-failed", `account=${id} reason=${reason} ${cacheError}`);
      }
    }
    const load = waitForGptPageLoad(contents);
    if (clearTemporaryCache && typeof contents.reloadIgnoringCache === "function") contents.reloadIgnoringCache();
    else contents.reload();
    const result = await load;
    Object.assign(account.pageState, {
      loading: !result.ok,
      domReady: result.ok,
      finished: result.ok,
      error: result.ok ? "" : String(result.error || "GPT 网页刷新失败")
    });
    appendDesktopLog("gpt-page-maintenance", `account=${id} reason=${reason} cacheCleared=${clearTemporaryCache} ok=${result.ok}${cacheError ? ` cacheError=${cacheError}` : ""}`);
    return {
      ok: Boolean(result.ok),
      accountId: id,
      url: result.url || contents.getURL(),
      cacheCleared: clearTemporaryCache && !cacheError,
      cacheError,
      error: result.ok ? "" : String(result.error || "GPT 网页刷新失败")
    };
  })().finally(() => {
    account.maintenancePromise = null;
  });
  return account.maintenancePromise;
}

function embeddedGptTaskResultScript(requestId) {
  return `(() => {
    try {
      const data = JSON.parse(document.getElementById("tb-workbench-bridge-result")?.textContent || "null");
      return data?.source === "tb-gpt-production-extension"
        && data?.type === "tb-workbench-task-result"
        && data?.requestId === ${JSON.stringify(String(requestId || ""))}
        ? data
        : null;
    } catch (_) {
      return null;
    }
  })()`;
}

async function waitForEmbeddedGptTaskResult(account, requestId, aborted, timeoutMs = 65 * 60 * 1000) {
  const contents = account?.view?.webContents;
  if (!contents || contents.isDestroyed()) {
    return {
      ok: false,
      status: "unavailable",
      requestId,
      errorCode: "GPT_PAGE_NOT_READY",
      error: "GPT 网页视图不可用"
    };
  }
  const deadline = Date.now() + Math.max(30_000, Number(timeoutMs || 0));
  while (Date.now() < deadline) {
    const result = await Promise.race([
      executeGptJavaScriptBounded(
        contents,
        embeddedGptTaskResultScript(requestId),
        2500,
        null,
        `read:${account.id}:result`
      ),
      aborted
    ]);
    if (result?.status === "aborted") return result;
    if (result?.requestId === requestId) {
      return { ok: result.status === "success", ...result };
    }
    const remainingMs = Math.max(0, deadline - Date.now());
    if (!remainingMs) break;
    const waitResult = await Promise.race([
      new Promise((resolve) => setTimeout(() => resolve(null), Math.min(750, remainingMs))),
      aborted
    ]);
    if (waitResult?.status === "aborted") return waitResult;
  }
  return {
    ok: false,
    status: "timeout",
    requestId,
    errorCode: "GPT_TASK_RESULT_TIMEOUT",
    retryable: true,
    error: "GPT 附件助手响应超时"
  };
}

async function sendTaskToEmbeddedGpt(task = {}) {
  const accountId = assertAssignedGptAccountId(task.accountId || activeGptAccountId);
  const view = await ensureGptView(accountId);
  const account = gptAccounts.get(accountId);
  if (!account) return { ok: false, status: "unavailable", errorCode: "GPT_PAGE_NOT_READY", error: "GPT 账号窗口不可用" };
  if (account) account.lastUsedAt = Date.now();
  const requestId = String(task.requestId || `workbench-${Date.now()}`);
  const activeRequest = account.pendingGptTask;
  if (activeRequest) {
    if (String(activeRequest.requestId || "") === requestId && activeRequest.promise) return activeRequest.promise;
    const busyResult = {
      ok: false,
      status: "busy",
      requestId,
      activeRequestId: String(activeRequest.requestId || ""),
      errorCode: "GPT_REQUEST_IN_FLIGHT",
      retryable: true,
      error: "当前账号窗口已有请求正在等待 GPT 网页响应，本次点击未重复上传"
    };
    appendDesktopLog("gpt-task-rejected", `account=${accountId} requestId=${requestId} activeRequestId=${busyResult.activeRequestId} reason=GPT_REQUEST_IN_FLIGHT`);
    return busyResult;
  }
  const payload = {
    source: "teambuilding-workbench",
    type: "tb-workbench-upload",
    requestId,
    name: String(task.name || "工作台素材"),
    materialPath: String(task.materialPath || ""),
    attachments: Array.isArray(task.attachments) ? task.attachments.slice(0, 30) : [],
    templateAttachments: Array.isArray(task.templateAttachments) ? task.templateAttachments.slice(0, 20) : [],
    prompt: String(task.prompt || ""),
    taskType: String(task.taskType || "material"),
    templateId: String(task.templateId || ""),
    accountId,
    quotaAccountId: String(task.quotaAccountId || accountId),
    autoRun: Boolean(task.autoRun),
    autoOptions: task.autoOptions && typeof task.autoOptions === "object" ? task.autoOptions : {},
    retryOf: String(task.retryOf || ""),
    retryFromStage: String(task.retryFromStage || ""),
    retryFromPercent: Math.max(0, Math.min(100, Number(task.retryFromPercent || 0))),
    reconcileAction: String(task.reconcileAction || ""),
    forceUpload: Boolean(task.forceUpload),
    conversationUrl: String(task.conversationUrl || task.browserConversationUrl || ""),
    conversationOwnerConfirmed: task._conversationLogOwnerConfirmed === true,
    resumePlanSubmitted: Boolean(task.workflow?.planSubmitted),
    // A renderer restart must not reduce a partially downloaded image set to
    // whatever subset is currently mounted in ChatGPT's virtualized DOM.
    // Carry the durable workflow checkpoint into the extension worker.
    workflow: task.workflow && typeof task.workflow === "object"
      ? JSON.parse(JSON.stringify(task.workflow))
      : {},
    expectedImages: Math.max(0, Number(task.expectedImages || task.expectedImageCount || 0)),
    submittedToGpt: task._submittedToGpt === true,
    freshConversationBootstrap: task._freshConversationBootstrap === true,
    // File selection must happen through Electron's exact WebContents. The
    // extension receives this flag and only waits for the native attachment;
    // it must not synthesize a DataTransfer for production uploads.
    nativeUpload: Array.isArray(task.attachments)
      && task.attachments.length > 0
      && (task.forceUpload === true
        || (task._submittedToGpt !== true && task.workflow?.planSubmitted !== true))
  };
  if (payload.freshConversationBootstrap && !payload.submittedToGpt) {
    payload.conversationUrl = "";
  }
  // Do not keep one executeJavaScript promise alive for the whole production
  // workflow. Chromium serializes these evaluations per renderer; a long
  // image-generation/download task would therefore block health, inspect and
  // stop calls in the same GPT window and look like a frozen bridge. Dispatch
  // the request as a short script, then poll the durable result bridge below.
  const dispatchScript = `(() => {
    const payload = ${JSON.stringify(payload)};
    let bridge = document.getElementById("tb-workbench-bridge-request");
    if (!bridge) {
      bridge = document.createElement("script");
      bridge.id = "tb-workbench-bridge-request";
      bridge.type = "application/json";
      document.documentElement.appendChild(bridge);
    }
    bridge.textContent = JSON.stringify(payload);
    document.dispatchEvent(new Event("tb-workbench-upload"));
    window.postMessage(payload, "*");
    return { ok: true, requestId: payload.requestId };
  })()`;
  let pendingResolver = null;
  const aborted = new Promise((resolve) => {
    pendingResolver = resolve;
  });
  const pending = {
    requestId,
    startedAt: Date.now(),
    resolve: pendingResolver,
    promise: null,
    freshConversationBootstrap: payload.freshConversationBootstrap && !payload.submittedToGpt,
    submittedToGpt: payload.submittedToGpt === true,
    conversationUrl: payload.freshConversationBootstrap && !payload.submittedToGpt
      ? ""
      : (normalizeChatConversationUrl(payload.conversationUrl || view.webContents.getURL()) || "")
  };
  account.pendingGptTask = pending;
  activeGptTaskAccounts.add(accountId);
  const requestPromise = (async () => {
    const readiness = await Promise.race([
      waitForGptPageReadiness(
        account,
        30_000,
        () => account.pendingGptTask !== pending,
        { allowFreshRoot: payload.freshConversationBootstrap && !payload.submittedToGpt }
      ),
      aborted
    ]);
    if (readiness?.status === "aborted") return readiness;
    const freshRootReady = payload.freshConversationBootstrap
      && !payload.submittedToGpt
      && isFreshRootGptPageReady(readiness);
    if (!readiness?.productionReady && !freshRootReady) {
      const result = {
        ok: false,
        status: "not-ready",
        requestId,
        errorCode: readiness?.errorCode || "GPT_PAGE_NOT_READY",
        retryable: readiness?.authenticationRequired !== true,
        error: readiness?.error || (readiness?.authenticationRequired ? "GPT 账号需要登录" : "GPT 网页尚未就绪")
      };
      appendDesktopLog("gpt-task-not-ready", `account=${accountId} requestId=${requestId} code=${result.errorCode} url=${view.webContents.getURL()}`);
      return result;
    }
    if (payload.nativeUpload) {
      const nativeUpload = await Promise.race([
        setGptTaskFileInputFiles(view.webContents, payload.attachments),
        aborted
      ]);
      if (nativeUpload?.status === "aborted") return nativeUpload;
      if (!nativeUpload?.ok) {
        const result = {
          ok: false,
          status: "native-upload-failed",
          requestId,
          errorCode: "GPT_NATIVE_FILE_INPUT_FAILED",
          retryable: true,
          error: String(nativeUpload?.error || "GPT 原生附件注入失败")
        };
        appendDesktopLog("gpt-native-file-input-failed", `account=${accountId} requestId=${requestId} error=${result.error}`);
        return result;
      }
      appendDesktopLog("gpt-native-file-input-set", `account=${accountId} requestId=${requestId} count=${nativeUpload.count}`);
    }
    const dispatched = await Promise.race([
      executeGptJavaScriptBounded(
        view.webContents,
        dispatchScript,
        5000,
        { ok: false, requestId, error: "GPT 附件助手未确认接收请求" },
        `workflow:${accountId}:dispatch`
      ),
      aborted
    ]);
    if (dispatched?.status === "aborted") return dispatched;
    if (!dispatched?.ok) {
      return {
        ok: false,
        status: "dispatch-failed",
        requestId,
        errorCode: "GPT_REQUEST_DISPATCH_FAILED",
        retryable: true,
        error: String(dispatched?.error || "GPT 附件助手未确认接收请求")
      };
    }
    // From this point GPT has accepted the workflow request.  The fresh-root
    // grace window is only for pre-submit readiness/upload; never treat a
    // submitted generation as an unsent bootstrap during recovery.
    pending.submittedToGpt = true;
    return waitForEmbeddedGptTaskResult(account, requestId, aborted);
  })();
  pending.promise = requestPromise;
  try {
    return await requestPromise;
  } finally {
    if (account.pendingGptTask === pending) account.pendingGptTask = null;
    activeGptTaskAccounts.delete(accountId);
    if (account.pageState?.loading && !account.loadRecoveryTimer) scheduleStalledGptPageRecovery(account);
    if (activeGptTaskAccounts.size === 0 && extensionReloadPending) {
      if (extensionReloadTimer) clearTimeout(extensionReloadTimer);
      extensionReloadTimer = setTimeout(() => {
        extensionReloadTimer = null;
        reloadAllGptViewsForExtensionChange();
      }, 1000);
    }
  }
}

async function pausePendingTaskInEmbeddedGpt(input = {}) {
  const accountId = assertAssignedGptAccountId(input.accountId || activeGptAccountId);
  const requestId = String(input.requestId || "").trim();
  const view = await ensureGptView(accountId);
  const payload = {
    source: "teambuilding-workbench",
    type: "tb-workbench-pause-before-submit",
    requestId
  };
  return executeGptJavaScriptBounded(view.webContents, `(() => {
    const payload = ${JSON.stringify(payload)};
    window.postMessage(payload, "*");
    document.dispatchEvent(new CustomEvent("tb-workbench-pause-before-submit", { detail: payload }));
    return { ok: true, accountId: ${JSON.stringify(accountId)}, requestId: payload.requestId };
  })()`, 3000, { ok: false, accountId, requestId, error: "GPT 网页暂时无响应，停止前置任务未确认" }, `pause:${accountId}`);
}

async function stopCurrentTaskInEmbeddedGpt(input = {}) {
  const accountId = assertAssignedGptAccountId(input.accountId || activeGptAccountId);
  const requestId = String(input.requestId || "").trim();
  const userInitiated = input.userInitiated !== false;
  const reason = String(input.reason || (userInitiated ? "user-stop" : "automatic-recovery"));
  const automaticHeartbeatRecovery = !userInitiated && reason === "heartbeat-recovery";
  const account = gptAccounts.get(accountId);
  const pending = account?.pendingGptTask;
  const pendingAborted = shouldAbortPendingGptTask({
    pendingRequestId: pending?.requestId,
    requestId
  });
  if (pendingAborted) {
    abortPendingGptTask(account, userInitiated
      ? "GPT 当前请求已停止，正在从检查点恢复"
      : "GPT 自动恢复中断当前请求，正在从检查点恢复");
    appendDesktopLog("gpt-task-cancelled", `account=${accountId} requestId=${pending.requestId} reason=${reason}`);
  }
  // The workflow heartbeat calls this path after it has proved that the
  // renderer bridge is stalled.  Aborting the native promise alone is not
  // enough: the worker would immediately dispatch the same checkpoint again
  // against the same frozen WebContents.  Rebuild only this account's view,
  // preserving its partition, login state, original conversation URL and
  // durable checkpoint.  User stops/holds continue through the ordinary
  // non-destructive stop path.
  if (automaticHeartbeatRecovery && pendingAborted && account) {
    const runtimeState = readRuntimeState(GPT_RUNTIME_STATE_FILE) || {};
    const runtime = runtimeState?.control?.windowRuntime?.[accountId] || {};
    const recoveryRequestId = String(pending?.requestId || requestId || runtime.currentTaskId || "").trim();
    const suppliedRecoveryUrl = normalizeChatConversationUrl(input.recoveryConversationUrl || "");
    const persistedSubmittedUrl = durableSubmittedConversationUrl(accountId, runtimeState);
    const freshRoot = isFreshRootGptTaskPending(account, runtimeState)
      && !suppliedRecoveryUrl
      && !persistedSubmittedUrl;
    const knownConversationUrl = freshRoot
      ? GPT_URL
      : String(
        suppliedRecoveryUrl
          || persistedSubmittedUrl
          || pending?.conversationUrl
          || runtime.conversationUrl
          || ""
      ).trim();
    account.bridgeRecoveryPending = true;
    Object.assign(account.pageState, {
      loading: true,
      finished: false,
      error: "GPT 网页桥接连续无响应，已从检查点自动重接",
      startedAt: new Date().toISOString()
    });
    account.forceGptPageRecovery = true;
    appendDesktopLog(
      "gpt-bridge-stalled-recovery",
      `account=${accountId} channel=workflow-heartbeat requestId=${recoveryRequestId} aborted=true freshRoot=${freshRoot}`
    );
    const rebuilt = await recreateGptAccountView(accountId, {
      reason: "stalled-conversation-bridge",
      forceRecovery: true,
      controlledRecovery: Boolean(recoveryRequestId),
      allowActiveTaskRecovery: true,
      recoveryRequestId,
      knownConversationUrl,
      freshRoot,
      invalidConversationUrl: freshRoot ? "" : knownConversationUrl
    }).catch((error) => ({ ok: false, error: error?.message || String(error) }));
    if (rebuilt?.ok) {
      return {
        ok: true,
        accountId,
        requestId: recoveryRequestId,
        pendingAborted,
        userInitiated,
        reason,
        recovery: rebuilt
      };
    }
    appendDesktopLog(
      "gpt-bridge-stalled-recovery-deferred",
      `account=${accountId} requestId=${recoveryRequestId} error=${String(rebuilt?.error || "rebuild-failed").slice(0, 180)}`
    );
  }
  const view = await ensureGptView(accountId);
  const payload = {
    source: "teambuilding-workbench",
    type: "tb-workbench-stop-current-task",
    requestId,
    userInitiated,
    reason
  };
  const result = await executeGptJavaScriptBounded(view.webContents, `(() => {
    const payload = ${JSON.stringify(payload)};
    window.postMessage(payload, "*");
    document.dispatchEvent(new CustomEvent("tb-workbench-stop-current-task", { detail: payload }));
    return { ok: true, accountId: ${JSON.stringify(accountId)}, requestId: payload.requestId };
  })()`, 3000, { ok: false, accountId, requestId, error: "GPT 网页暂时无响应，停止当前任务未确认" }, `stop:${accountId}`);
  return { ...result, pendingAborted, userInitiated, reason };
}

async function setGptAccountUserHold(input = {}) {
  const accountId = assertAssignedGptAccountId(input.accountId || activeGptAccountId);
  const account = await ensureGptAccount(accountId);
  const held = Boolean(input.held);
  account.userRecoveryHold = held;
  if (held && account.loadRecoveryTimer) {
    clearTimeout(account.loadRecoveryTimer);
    account.loadRecoveryTimer = null;
  }
  if (!held && account.pageState?.loading && !account.loadRecoveryTimer) {
    scheduleStalledGptPageRecovery(account);
  }
  appendDesktopLog("gpt-page-recovery-hold", `account=${accountId} held=${held}`);
  return { ok: true, accountId, held };
}

ipcMain.handle("desktop:pick-folder", async (_event, options = {}) => {
  const dialogOptions = {
    title: String(options.title || "选择文件夹"),
    defaultPath: String(options.defaultPath || "").trim() || undefined,
    buttonLabel: "选择",
    properties: ["openDirectory", "createDirectory", "promptToCreate"]
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  return result.canceled ? "" : String(result.filePaths?.[0] || "");
});

ipcMain.handle("desktop:pick-file", async (_event, options = {}) => {
  const dialogOptions = {
    title: String(options.title || "选择要传送的文件"),
    defaultPath: String(options.defaultPath || "").trim() || undefined,
    buttonLabel: "选择",
    properties: ["openFile"]
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  return result.canceled ? "" : String(result.filePaths?.[0] || "");
});

ipcMain.handle("desktop:gpt-profiles", async () => readBrowserProfiles());

ipcMain.handle("desktop:gpt-profile-save", async (_event, input = {}) => {
  const state = readBrowserProfiles();
  const id = assertAssignedGptAccountId(input.id, { required: true });
  const existing = state.profiles.find((profile) => profile.id === id);
  // Keep the browser's live address separate from the last ChatGPT
  // conversation URL. Renderer-side profile saves often only update the
  // label or quota group; they must never reset an external page to GPT.
  const lastBrowserUrl = safeBrowserUrlOrDefault(
    input.lastBrowserUrl || existing?.lastBrowserUrl || input.lastUrl || existing?.lastUrl || GPT_URL,
    GPT_URL
  );
  // A renderer refresh/re-hydration often sends the current native page as
  // the ChatGPT home URL while the profile still owns a durable /c/<id>
  // conversation.  The home page is not an instruction to forget that
  // conversation; only an explicit home/new-chat action may clear it.
  const clearConversation = input.clearConversation === true;
  const profile = {
    id,
    name: String(input.name || existing?.name || `账号窗口 ${state.profiles.length + 1}`).trim().slice(0, 24),
    quotaGroup: assertAssignedGptAccountId(input.quotaGroup || existing?.quotaGroup || id),
    mode: safeGptProductionMode(input.mode ?? existing?.mode),
    workflowVariant: safeGptWorkflowVariant(input.workflowVariant ?? existing?.workflowVariant),
    workflowVariantVersion: String(input.workflowVariantVersion || existing?.workflowVariantVersion || "1").slice(0, 40),
    experimentId: String(input.experimentId ?? existing?.experimentId ?? "").slice(0, 80),
    assignmentAt: String(input.assignmentAt || existing?.assignmentAt || new Date().toISOString()).slice(0, 40),
    sessionPolicy: String(input.sessionPolicy || existing?.sessionPolicy || "reuse-conversation").slice(0, 80),
    selectedTemplateId: String(input.selectedTemplateId ?? existing?.selectedTemplateId ?? "").slice(0, 80),
    templateConversationUrl: normalizeChatConversationUrl(input.templateConversationUrl || existing?.templateConversationUrl),
    workflowProfileId: String(input.workflowProfileId ?? existing?.workflowProfileId ?? "").slice(0, 80),
    hidden: Boolean(input.hidden ?? existing?.hidden),
    disabled: Boolean(input.disabled ?? existing?.disabled),
    lastUrl: safeGptUrl(input.lastUrl || existing?.lastUrl),
    lastBrowserUrl,
    lastConversationUrl: clearConversation
      ? ""
      : normalizeChatConversationUrl(input.lastConversationUrl || existing?.lastConversationUrl || input.lastUrl || existing?.lastUrl),
    lastInvalidConversationUrl: normalizeChatConversationUrl(
      Object.prototype.hasOwnProperty.call(input, "lastInvalidConversationUrl")
        ? input.lastInvalidConversationUrl
        : existing?.lastInvalidConversationUrl
    ),
    createdAt: existing?.createdAt || new Date().toISOString(),
    lastOpenedAt: String(input.lastOpenedAt || existing?.lastOpenedAt || new Date().toISOString())
  };
  if (existing) Object.assign(existing, profile);
  else if (state.profiles.length < 8) state.profiles.push(profile);
  else throw new Error("最多保留 8 个账号窗口档案");
  state.activeId = input.active === false ? state.activeId : id;
  writeBrowserProfiles(state);
  return state;
});

ipcMain.handle("desktop:gpt-profile-reorder", async (_event, accountIds = []) => {
  const state = readBrowserProfiles();
  const requested = Array.isArray(accountIds)
    ? accountIds.map(safeGptAccountId).filter(Boolean)
    : [];
  const byId = new Map(state.profiles.map((profile) => [profile.id, profile]));
  const ordered = requested.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map((profile) => profile.id));
  ordered.push(...state.profiles.filter((profile) => !seen.has(profile.id)));
  state.profiles = ordered;
  writeBrowserProfiles(state);
  return state;
});

ipcMain.handle("desktop:gpt-profile-hide", async (_event, input = {}) => {
  const state = readBrowserProfiles();
  const id = assertAssignedGptAccountId(input.id, { required: true });
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile) throw new Error("没有找到账号窗口档案");
  profile.hidden = Boolean(input.hidden);
  if (state.activeId === id && profile.hidden) {
    state.activeId = state.profiles.find((item) => !item.hidden)?.id || id;
  }
  writeBrowserProfiles(state);
  if (profile.hidden) hideAllGptViews();
  return state;
});

ipcMain.handle("desktop:gpt-profile-remove", async (_event, accountId = "") => {
  const state = readBrowserProfiles();
  const id = assertAssignedGptAccountId(accountId, { required: true });
  if (state.profiles.length <= 1) throw new Error("至少保留一个账号窗口档案");
  state.profiles = state.profiles.filter((profile) => profile.id !== id);
  if (state.activeId === id) state.activeId = state.profiles.find((profile) => !profile.hidden)?.id || state.profiles[0].id;
  writeBrowserProfiles(state);
  await releaseGptAccountView(id);
  return state;
});

ipcMain.handle("desktop:gpt-profile-delete-login", async (_event, accountId = "") => {
  const id = assertAssignedGptAccountId(accountId, { required: true });
  await releaseGptAccountView(id);
  const profileSession = session.fromPartition(`${GPT_PARTITION_PREFIX}-${id}`);
  await profileSession.clearStorageData();
  return { ok: true, id };
});

ipcMain.handle("desktop:production-active", async (_event, input = false) => {
  const isObjectInput = input && typeof input === "object";
  const active = isObjectInput ? Boolean(input.active) : Boolean(input);
  const rawAccountId = isObjectInput ? String(input.accountId || "").trim() : "";
  if (rawAccountId) {
    const accountId = assertAssignedGptAccountId(rawAccountId, { required: true });
    if (active) productionTaskAccounts.add(accountId);
    else productionTaskAccounts.delete(accountId);
  } else {
    // Compatibility path for the legacy single renderer worker.
    legacyProductionTaskActive = active;
  }
  productionTaskActive = legacyProductionTaskActive || productionTaskAccounts.size > 0;
  appendDesktopLog("gpt-worker-active", rawAccountId
    ? `account=${safeGptAccountId(rawAccountId)} active=${active} workers=${productionTaskAccounts.size}`
    : `legacy active=${active} workers=${productionTaskAccounts.size}`);
  refreshTrayMenu();
  return { ok: true, active: productionTaskActive, accountIds: [...productionTaskAccounts] };
});

function launchAtLoginOptions(openAtLogin) {
  if (app.isPackaged) return { openAtLogin: Boolean(openAtLogin) };
  return {
    openAtLogin: Boolean(openAtLogin),
    path: process.execPath,
    args: [path.resolve(__dirname, "..")]
  };
}

ipcMain.handle("desktop:launch-at-login-get", async () => {
  if (process.platform !== "win32") return { supported: false, enabled: false };
  const options = launchAtLoginOptions(true);
  const state = app.getLoginItemSettings({ path: options.path, args: options.args });
  return { supported: true, enabled: Boolean(state.openAtLogin) };
});

ipcMain.handle("desktop:launch-at-login-set", async (_event, enabled = false) => {
  if (process.platform !== "win32") return { supported: false, enabled: false };
  app.setLoginItemSettings(launchAtLoginOptions(enabled));
  const state = app.getLoginItemSettings(launchAtLoginOptions(enabled));
  appendDesktopLog("launch-at-login", `enabled=${Boolean(state.openAtLogin)}`);
  return { supported: true, enabled: Boolean(state.openAtLogin) };
});

ipcMain.handle("desktop:notify", async (_event, input = {}) => {
  if (!Notification.isSupported()) return { ok: false };
  new Notification({
    title: String(input.title || "图文工作台"),
    body: String(input.body || "").slice(0, 300)
  }).show();
  return { ok: true };
});

ipcMain.handle("desktop:restart-app", async (_event, input = {}) => {
  return restartApp({
    source: String(input.source || "automation").slice(0, 64),
    interactive: input.interactive === true
  });
});

ipcMain.handle("desktop:assistant-update", async (_event, input = {}) => {
  const legacyBubbleVisible = Object.prototype.hasOwnProperty.call(input, "visible") ? input.visible !== false : undefined;
  const previousDetached = assistantOverlayIsDetached();
  const previousAlwaysOnTop = assistantOverlayState.settings?.alwaysOnTop === true;
  assistantOverlayState = {
    ...assistantOverlayState,
    message: String(input.message || assistantOverlayState.message || ""),
    bubbleVisible: input.bubbleVisible == null ? (legacyBubbleVisible ?? assistantOverlayState.bubbleVisible) : input.bubbleVisible !== false,
    catVisible: input.catVisible == null ? assistantOverlayState.catVisible !== false : input.catVisible !== false,
    settings: input.settings && typeof input.settings === "object" ? { ...assistantOverlayState.settings, ...input.settings } : assistantOverlayState.settings
  };
  const overlay = await ensureAssistantOverlay();
  const modeChanged = previousDetached !== assistantOverlayIsDetached()
    || previousAlwaysOnTop !== (assistantOverlayState.settings?.alwaysOnTop === true);
  if (modeChanged) applyAssistantOverlayWindowMode(overlay);
  sendAssistantOverlayState();
  if (assistantOverlayState.catVisible && (assistantOverlayIsDetached() || mainWindow?.isFocused())) overlay.showInactive();
  else overlay.hide();
  return { ok: true };
});

ipcMain.on("assistant-overlay:action", (_event, input = {}) => {
  if (["chat", "open-settings"].includes(String(input.type || ""))) restoreMainWindow();
  mainWindow?.webContents.send("desktop:assistant-action", input);
});

ipcMain.on("assistant-overlay:move", (_event, input = {}) => {
  if (!assistantOverlayWindow || assistantOverlayWindow.isDestroyed()) return;
  assistantOverlayInteractionUntil = Date.now() + 800;
  const [x, y] = assistantOverlayWindow.getPosition();
  const next = clampAssistantOverlayBounds({ x: x + Number(input.dx || 0), y: y + Number(input.dy || 0) });
  assistantOverlayWindow.setBounds(next, false);
  assistantOverlayState = { ...assistantOverlayState, dockSide: assistantOverlayDockSide(next) };
  sendAssistantOverlayState();
  fs.writeFileSync(assistantOverlayPositionFile(), JSON.stringify({ x: next.x, y: next.y }, null, 2), "utf8");
});

ipcMain.on("assistant-overlay:set-mouse-events", (_event, input = {}) => {
  if (!assistantOverlayWindow || assistantOverlayWindow.isDestroyed()) return;
  if (input.ignore) {
    assistantOverlayInteractionUntil = Date.now() + 350;
    assistantOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    assistantOverlayInteractionUntil = Date.now() + 800;
    assistantOverlayWindow.setIgnoreMouseEvents(false);
    if (!assistantOverlayIsDetached() && mainWindow && !mainWindow.isDestroyed()) assistantOverlayWindow.showInactive();
  }
});

ipcMain.handle("desktop:gpt-status", async (_event, accountId = activeGptAccountId) => {
  const id = assertAssignedGptAccountId(accountId);
  const account = gptAccounts.get(id);
  const contents = account?.view && !account.view.webContents.isDestroyed() ? account.view.webContents : null;
  const liveState = contents ? await probeGptPageReadiness(account, "status", 3000) : null;
  if (account?.pageState && liveState && !liveState.readTimedOut) {
    account.pageState.domReady = ["interactive", "complete"].includes(liveState.readyState);
    account.pageState.extensionReady = Boolean(liveState.extensionReady);
    if (account.pageState.domReady && liveState?.composerReady) {
      account.pageState.loading = false;
      account.pageState.finished = true;
      account.pageState.finishedAt ||= new Date().toISOString();
      notifyGptLoadingChanged(id, false);
    }
  }
  return {
    available: Boolean(WebContentsView),
    accountId: id,
    loaded: Boolean(contents),
    ready: Boolean(contents && account?.pageState?.domReady && liveState?.extensionReady),
    productionReady: Boolean(contents && (
      liveState?.productionReady
      || (liveState?.readTimedOut
        && account?.pageState?.domReady
        && account?.pageState?.finished
        && account?.pageState?.extensionReady
        && Boolean(normalizeChatConversationUrl(contents.getURL())))
    )),
    domReady: Boolean(account?.pageState?.domReady),
    extensionReady: Boolean(liveState?.extensionReady),
    composerReady: Boolean(liveState?.composerReady),
    authenticationRequired: Boolean(liveState?.authenticationRequired),
    chatConversation: Boolean(liveState?.chatConversation),
    conversationState: liveState?.conversationState || null,
    pageState: account?.pageState || null,
    extensionLoaded: Boolean(account?.extensionInfo),
    extensionRuntimeReady: Boolean(account?.extensionRuntimeReady),
    extensionInfo: account?.extensionInfo ? {
      id: account.extensionInfo.id,
      name: account.extensionInfo.name,
      version: account.extensionInfo.version,
      path: account.extensionPath
    } : null,
    extensionVersion: liveState?.extensionVersion || "",
    extensionSource: liveState?.extensionSource || "",
    extensionError: account?.extensionError || "",
    url: contents?.getURL() || GPT_URL,
    canGoBack: Boolean(contents?.canGoBack()),
    canGoForward: Boolean(contents?.canGoForward())
  };
});

ipcMain.handle("desktop:gpt-show", async (_event, input = {}) => {
  hideWechatDraftView();
  hideOnlinePlatformViews();
  const accountId = assertAssignedGptAccountId(input.accountId || activeGptAccountId);
  activeGptAccountId = accountId;
  const account = await ensureGptAccount(accountId);
  account.lastUsedAt = Date.now();
  const view = account.view;
  hideAllGptViews(accountId);
  view.setBounds(safeGptBounds(input.bounds || input));
  view.setBorderRadius(16);
  view.setVisible(true);
  const liveReady = await view.webContents.executeJavaScript(`({
    readyState: document.readyState,
    extensionReady: document.documentElement.dataset.tbGptProductionExtension === "ready" || Boolean(document.getElementById("tb-gpt-production-extension-marker")),
    extensionVersion: document.documentElement.dataset.tbGptProductionExtensionVersion || document.getElementById("tb-gpt-production-extension-marker")?.content || "",
    extensionSource: document.documentElement.dataset.tbGptProductionExtensionSource || "",
    composerReady: Boolean(document.querySelector('#prompt-textarea, textarea[data-id="root"], [contenteditable="true"]'))
  })`, true).catch(() => ({ readyState: "", extensionReady: false, extensionVersion: "", extensionSource: "", composerReady: false }));
  return {
    ok: true,
    accountId,
    extensionLoaded: Boolean(account.extensionInfo),
    extensionRuntimeReady: Boolean(account.extensionRuntimeReady),
    extensionInfo: account.extensionInfo ? {
      id: account.extensionInfo.id,
      name: account.extensionInfo.name,
      version: account.extensionInfo.version,
      path: account.extensionPath
    } : null,
    extensionVersion: liveReady.extensionVersion || "",
    extensionSource: liveReady.extensionSource || "",
    extensionError: account.extensionError,
    ready: ["interactive", "complete"].includes(liveReady.readyState) && Boolean(liveReady.extensionReady),
    domReady: ["interactive", "complete"].includes(liveReady.readyState),
    extensionReady: Boolean(liveReady.extensionReady),
    composerReady: Boolean(liveReady.composerReady),
    url: view.webContents.getURL(),
    canGoBack: view.webContents.canGoBack(),
    canGoForward: view.webContents.canGoForward(),
    isChatGpt: /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/i.test(view.webContents.getURL() || "")
  };
});

ipcMain.handle("desktop:gpt-hide", async () => {
  hideAllGptViews();
  return { ok: true };
});

ipcMain.handle("desktop:wechat-draft-status", async () => probeWechatDraftPage());

ipcMain.handle("desktop:online-platform-status", async (_event, platformId = "wechat") => {
  const id = normalizeOnlinePlatformId(platformId);
  if (id === "wechat") return { ...(await probeWechatDraftPage()), ...onlinePlatformState(id) };
  return onlinePlatformState(id);
});

ipcMain.handle("desktop:online-platform-show", async (_event, input = {}) => showOnlinePlatformView(input.platformId, input.bounds || input));

ipcMain.handle("desktop:online-platform-hide", async (_event, platformId = "") => hideOnlinePlatformView(platformId));

ipcMain.handle("desktop:online-platform-navigate", async (_event, input = {}) => navigateOnlinePlatformView(input.platformId, input.action, input.targetUrl));

ipcMain.handle("desktop:ctrip-draft-run", async (_event, input = {}) => runCtripDraft(input));

ipcMain.handle("desktop:wechat-draft-show", async (_event, input = {}) => {
  const view = await ensureWechatDraftView();
  hideAllGptViews();
  view.setBounds(safeGptBounds(input.bounds || input));
  view.setBorderRadius(16);
  view.setVisible(true);
  return probeWechatDraftPage();
});

ipcMain.handle("desktop:wechat-draft-hide", async () => {
  hideWechatDraftView();
  return { ok: true };
});

ipcMain.handle("desktop:wechat-draft-navigate", async (_event, input = {}) => {
  const view = await ensureWechatDraftView();
  const contents = view.webContents;
  const action = String(input.action || "home");
  if (action === "reload") contents.reload();
  else if (action === "back" && contents.canGoBack()) contents.goBack();
  else if (action === "forward" && contents.canGoForward()) contents.goForward();
  else if (action === "url") {
    const targetUrl = String(input.targetUrl || "");
    if (!isAllowedWechatUrl(targetUrl)) throw new Error("只允许打开微信公众平台网页");
    const load = await loadWechatUrlBounded(contents, targetUrl);
    if (!load.ok) throw new Error(load.error || "公众号网页打开失败");
  } else {
    const load = await loadWechatUrlBounded(contents, WECHAT_HOME_URL);
    if (!load.ok) throw new Error(load.error || "公众号网页打开失败");
  }
  return probeWechatDraftPage();
});

ipcMain.handle("desktop:wechat-draft-run", async (_event, input = {}) => runWechatWebDraft(input));

ipcMain.handle("desktop:gpt-theme", async (_event, input = {}) => {
  gptThemeName = ["neo", "glass", "midnight", "midnight-glass"].includes(input.theme) ? input.theme : "neo";
  assistantOverlayState = { ...assistantOverlayState, theme: gptThemeName };
  sendAssistantOverlayState();
  const results = await Promise.all([...gptAccounts.values()].map((account) => applyEmbeddedGptTheme(account, gptThemeName)));
  return { ok: true, theme: gptThemeName, dark: embeddedGptPalette(gptThemeName).dark, updated: results.filter(Boolean).length };
});

ipcMain.handle("desktop:gpt-release-idle", async (_event, input = {}) => {
  const idleMs = Math.max(5, Number(input.minutes || 30)) * 60 * 1000;
  const runtime = readRuntimeState(GPT_RUNTIME_STATE_FILE);
  const runtimeQueue = runtime?.queue?.tasks || [];
  const runtimeSettings = runtime?.control?.settings || {};
  const profiles = new Map(readBrowserProfiles().profiles.map((profile) => [profile.id, profile]));
  const released = [];
  for (const [id, account] of [...gptAccounts]) {
    const accountBusy = productionTaskAccounts.has(id)
      || Boolean(account.pendingGptTask)
      || Boolean(account.maintenancePromise);
    const accountRuntime = runtime?.control?.windowRuntime?.[id] || {};
    const keepAlive = shouldKeepGptAccountView({
      accountId: id,
      activeAccountId: activeGptAccountId,
      profile: profiles.get(id) || {},
      settings: runtimeSettings,
      runtime: accountRuntime,
      queue: runtimeQueue,
      accountBusy
    });
    if (id === activeGptAccountId
      || keepAlive
      || Date.now() - Number(account.lastUsedAt || Date.now()) < idleMs) continue;
    await releaseGptAccountView(id);
    released.push(id);
  }
  return { ok: true, released };
});

ipcMain.handle("desktop:gpt-maintenance", async (_event, input = {}) => {
  const accountId = assertAssignedGptAccountId(input.accountId || activeGptAccountId);
  return refreshGptAccountSession(accountId, {
    clearTemporaryCache: Boolean(input.clearTemporaryCache || input.clearCache),
    reason: input.reason
  });
});

ipcMain.handle("desktop:gpt-recreate", async (_event, input = {}) => {
  const accountId = assertAssignedGptAccountId(input.accountId || activeGptAccountId);
  return recreateGptAccountView(accountId, {
    reason: input.reason,
    forceRecovery: input.forceRecovery === true,
    controlledRecovery: input.controlledRecovery === true,
    allowActiveTaskRecovery: input.allowActiveTaskRecovery === true,
    recoveryRequestId: String(input.recoveryRequestId || ""),
    knownConversationUrl: String(input.knownConversationUrl || ""),
    freshRoot: input.freshRoot === true,
    invalidConversationUrl: String(input.invalidConversationUrl || "")
  });
});

ipcMain.handle("desktop:gpt-navigate", async (_event, input = {}) => {
  const accountId = assertAssignedGptAccountId(input.accountId || activeGptAccountId);
  const account = await ensureGptAccount(accountId);
  const contents = account.view.webContents;
  const action = String(input.action || "reload");
  if (action === "back" && contents.canGoBack()) contents.goBack();
  else if (action === "forward" && contents.canGoForward()) contents.goForward();
  else if (action === "url") {
    const targetUrl = safeBrowserUrl(input.targetUrl);
    await contents.loadURL(targetUrl);
  }
  else if (action === "home" || action === "new-chat") {
    const profiles = readBrowserProfiles();
    const profile = profiles.profiles.find((item) => item.id === accountId);
    if (profile) {
      profile.lastUrl = GPT_URL;
      profile.lastBrowserUrl = GPT_URL;
      profile.lastConversationUrl = "";
      profile.lastInvalidConversationUrl = "";
      writeBrowserProfiles(profiles);
    }
    await contents.loadURL(GPT_URL);
  }
  else contents.reload();
  return {
    ok: true,
    accountId,
    url: contents.getURL(),
    canGoBack: contents.canGoBack(),
    canGoForward: contents.canGoForward(),
    isChatGpt: /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/i.test(contents.getURL() || "")
  };
});

ipcMain.handle("desktop:gpt-send-task", async (_event, task = {}) => sendTaskToEmbeddedGpt(task));
ipcMain.handle("desktop:gpt-pause-pending-task", async (_event, input = {}) => pausePendingTaskInEmbeddedGpt(input));
ipcMain.handle("desktop:gpt-stop-current-task", async (_event, input = {}) => stopCurrentTaskInEmbeddedGpt(input));
ipcMain.handle("desktop:gpt-set-user-hold", async (_event, input = {}) => setGptAccountUserHold(input));

ipcMain.handle("desktop:gpt-page-health", async (_event, accountId = activeGptAccountId) => {
  const id = assertAssignedGptAccountId(accountId);
  const account = gptAccounts.get(id);
  const contents = account?.view?.webContents;
  return {
    ok: Boolean(contents && !contents.isDestroyed()),
    accountId: id,
    url: contents && !contents.isDestroyed() ? contents.getURL() : "",
    loading: Boolean(account?.pageState?.loading),
    domReady: Boolean(account?.pageState?.domReady),
    finished: Boolean(account?.pageState?.finished),
    extensionReady: Boolean(account?.pageState?.extensionReady),
    extensionVersion: String(account?.pageState?.extensionVersion || account?.extensionInfo?.version || ""),
    startedAt: String(account?.pageState?.startedAt || ""),
    finishedAt: String(account?.pageState?.finishedAt || ""),
    error: String(account?.pageState?.error || "")
  };
});

ipcMain.handle("desktop:gpt-workflow-status", async (_event, accountId = activeGptAccountId) => {
  const id = assertAssignedGptAccountId(accountId);
  const account = gptAccounts.get(id);
  const contents = account?.view?.webContents;
  if (!contents || contents.isDestroyed()) return null;
  // ChatGPT can spend a few seconds on a renderer turn while the extension
  // is receiving images. This is a read-only heartbeat, so give it a slightly
  // longer bound than readiness probes without allowing concurrent reads.
  return executeGptJavaScriptBounded(contents, `(() => {
    try { return JSON.parse(document.getElementById("tb-workbench-bridge-progress")?.textContent || "null"); }
    catch { return null; }
  })()`, 5000, null, `status:${safeGptAccountId(accountId)}:workflow`);
});

ipcMain.handle("desktop:gpt-inspect-status", async (_event, accountId = activeGptAccountId) => {
  const id = assertAssignedGptAccountId(accountId);
  // Automatic recovery may arrive after the 3-hour idle timer released the
  // native view. Recreate the same persisted account session before probing;
  // otherwise the renderer sees null forever and retries can never reach the
  // real conversation checkpoint. Explicitly stopped accounts stay untouched.
  const account = persistedGptUserHold(id) ? gptAccounts.get(id) : await ensureGptAccount(id);
  const contents = account?.view?.webContents;
  if (!contents || contents.isDestroyed()) return null;
  const requestId = `inspect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return executeGptJavaScriptBounded(contents, `new Promise((resolve) => {
    const requestId = ${JSON.stringify(requestId)};
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
     }, 15000);
    function onMessage(event) {
      const data = event?.data;
      if (data?.source !== "tb-gpt-production-extension"
        || data?.type !== "tb-workbench-inspect-result"
        || data.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(data);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({
      source: "teambuilding-workbench",
      type: "tb-workbench-inspect-request",
      requestId
    }, "*");
  })`, 18000, null, `inspect:${safeGptAccountId(accountId)}`);
});

ipcMain.handle("desktop:gpt-patrol-discover", async (_event, input = {}) => {
  const requestedAccountId = assertAssignedGptAccountId(input.accountId || activeGptAccountId);
  const account = await ensureGptAccount(requestedAccountId);
  const contents = account?.view?.webContents;
  if (!contents || contents.isDestroyed()) return null;
  const readyDeadline = Date.now() + 20_000;
  while (Date.now() < readyDeadline) {
    const ready = await executeGptJavaScriptBounded(contents, "document.documentElement.dataset.tbGptProductionExtension === 'ready'", 2000, false, `patrol-discover-ready:${requestedAccountId}`);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const requestId = `patrol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    source: "teambuilding-workbench",
    type: "tb-workbench-patrol-discover-request",
    requestId,
    denylist: Array.isArray(input.denylist) ? input.denylist.map(String) : [],
    maximumScrolls: Math.max(0, Math.min(40, Number(input.maximumScrolls || 16)))
  };
  return contents.executeJavaScript(`new Promise((resolve) => {
    const request = ${JSON.stringify(payload)};
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, 30000);
    function onMessage(event) {
      const data = event?.data;
      if (data?.source !== "tb-gpt-production-extension"
        || data?.type !== "tb-workbench-patrol-discover-result"
        || data.requestId !== request.requestId) return;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(data);
    }
    window.addEventListener("message", onMessage);
    window.postMessage(request, "*");
  })`, true).catch(() => null);
});

ipcMain.handle("desktop:gpt-patrol-continue", async (_event, input = {}) => {
  const accountId = assertAssignedGptAccountId(input.accountId || activeGptAccountId);
  let targetUrl;
  try {
    targetUrl = safePatrolConversationUrl(input.targetUrl);
  } catch (error) {
    // A stale recovery checkpoint must not reject the renderer IPC call. Return
    // a structured result so Continue/Retry can keep the queue actionable and
    // show the actual boundary instead of surfacing "Error invoking remote
    // method" as a dead-end system error.
    return {
      ok: false,
      acted: false,
      reason: "invalid-target-url",
      error: error?.message || String(error),
      accountId,
      targetUrl: patrolConversationUrlInput(input.targetUrl)
    };
  }
  const denylist = Array.isArray(input.denylist) ? input.denylist.map(String) : [];
  const normalizedDenylist = denylist.map((value) => {
    try { return safePatrolConversationUrl(value); } catch { return String(value || "").trim(); }
  });
  if (normalizedDenylist.includes(targetUrl)) {
    return { ok: false, acted: false, reason: "target-explicitly-excluded", accountId, targetUrl };
  }

  const account = await ensureGptAccount(accountId);
  const contents = account?.view?.webContents;
  if (!contents || contents.isDestroyed()) return { ok: false, acted: false, error: "GPT 网页尚未就绪" };
  const currentUrl = String(contents.getURL() || "").split(/[?#]/)[0].replace(/\/$/, "");
  if (currentUrl !== targetUrl) await contents.loadURL(targetUrl);
  const readyDeadline = Date.now() + 20_000;
  while (Date.now() < readyDeadline) {
    const ready = await executeGptJavaScriptBounded(contents, "document.documentElement.dataset.tbGptProductionExtension === 'ready'", 2000, false, `patrol-continue-ready:${accountId}`);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const requestId = `patrol-continue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    source: "teambuilding-workbench",
    type: "tb-workbench-patrol-continue-request",
    requestId,
    targetUrl,
    denylist: normalizedDenylist,
    confirmText: String(input.confirmText || "1"),
    copyPrompt: String(input.copyPrompt || ""),
    generationRequestCount: Math.max(0, Number(input.generationRequestCount || 0)),
    maximumGenerationRequests: Math.max(1, Math.min(20, Number(input.maximumGenerationRequests || 5))),
    productionRequestId: String(input.productionRequestId || ""),
    materialName: String(input.materialName || ""),
    sourceMaterialPath: String(input.sourceMaterialPath || ""),
    templateId: String(input.templateId || ""),
    downloadRoot: String(input.downloadRoot || ""),
    productRoot: String(input.productRoot || ""),
    autoArchive: input.autoArchive !== false,
    allowUntitledRecovery: Boolean(input.allowUntitledRecovery),
    allowStaleComposerRecovery: Boolean(input.allowStaleComposerRecovery),
    allowExistingPackageRelease: Boolean(input.allowExistingPackageRelease),
    existingPackagePath: String(input.existingPackagePath || ""),
    existingPackageImages: Math.max(0, Number(input.existingPackageImages || 0)),
    durableImageUrls: Array.isArray(input.durableImageUrls)
      ? input.durableImageUrls.map(String).filter(Boolean).slice(0, 10)
      : [],
    durableImageCount: Math.max(0, Number(input.durableImageCount || 0)),
    expectedImageCount: Math.max(0, Math.min(10, Number(input.expectedImageCount || 0))),
    inspectOnly: Boolean(input.inspectOnly)
  };
  return contents.executeJavaScript(`new Promise((resolve) => {
    const request = ${JSON.stringify(payload)};
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, acted: false, error: "巡检单步续接超时" });
    }, 600000);
    function onMessage(event) {
      const data = event?.data;
      if (data?.source !== "tb-gpt-production-extension"
        || data?.type !== "tb-workbench-patrol-continue-result"
        || data.requestId !== request.requestId) return;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(data);
    }
    window.addEventListener("message", onMessage);
    window.postMessage(request, "*");
  })`, true).catch((error) => ({ ok: false, acted: false, error: error?.message || String(error) }));
});

// --- Diagnostic: returns full GPT page state for troubleshooting ---
ipcMain.handle("desktop:gpt-diagnostic", async (_event, accountId = activeGptAccountId) => {
  const id = assertAssignedGptAccountId(accountId);
  const account = gptAccounts.get(id);
  const contents = account?.view && !account.view.webContents.isDestroyed() ? account.view.webContents : null;
  if (!contents) {
    return {
      ok: true,
      accountId: id,
      timestamp: new Date().toISOString(),
      hasView: false,
      extensionLoaded: Boolean(account?.extensionInfo),
      extensionRuntimeReady: Boolean(account?.extensionRuntimeReady),
      extensionInfo: account?.extensionInfo ? {
        id: account.extensionInfo.id,
        name: account.extensionInfo.name,
        version: account.extensionInfo.version,
        path: account.extensionPath
      } : null,
      extensionError: account?.extensionError || "",
      pageState: account?.pageState || null,
      url: GPT_URL,
      liveState: null,
      productionReady: false,
      notReadyReasons: ["GPT 窗口尚未创建"]
    };
  }
  const liveState = await executeGptJavaScriptBounded(contents, `(() => {
    const url = String(location.href || "");
    const bodyText = String(document.body?.innerText || "").slice(0, 8000).toLowerCase();
    const readyState = document.readyState;
    const composerReady = Boolean(document.querySelector('#prompt-textarea, textarea[data-id="root"], [contenteditable="true"]'));
    const authenticationSignal = ["one-time code", "one time code", "verification code", "verify your identity", "check your email", "sign in", "log in", "\u4e00\u6b21\u6027\u9a8c\u8bc1\u7801", "\u9a8c\u8bc1\u7801", "\u68c0\u67e5\u90ae\u7bb1", "\u767b\u5f55"]
      .some((signal) => bodyText.includes(signal));
    const terminalAuthenticationSignal = ["session has expired", "your session has expired", "\u4f1a\u8bdd\u5df2\u8fc7\u671f", "\u8bf7\u91cd\u65b0\u767b\u5f55"]
      .some((signal) => bodyText.includes(signal));
    let parsedUrl = null;
    try { parsedUrl = new URL(url); } catch (_) { parsedUrl = null; }
    const pathname = String(parsedUrl?.pathname || "");
    const authenticationUrl = parsedUrl?.hostname === "auth.openai.com"
      || pathname.startsWith("/auth/login")
      || pathname.startsWith("/auth/signup")
      || pathname.startsWith("/api/auth/signin");
    const chatConversation = (parsedUrl?.hostname === "chatgpt.com" || parsedUrl?.hostname === "www.chatgpt.com")
      && (/^\\/c\\/[a-z0-9_-]+(?:\\/|$)/i.test(pathname) || /^\\/g\\/[a-z0-9_-]+\\/c\\/[a-z0-9_-]+(?:\\/|$)/i.test(pathname));
    const extensionReady = document.documentElement.dataset.tbGptProductionExtension === "ready" || Boolean(document.getElementById("tb-gpt-production-extension-marker"));
    const extensionVersion = document.documentElement.dataset.tbGptProductionExtensionVersion || document.getElementById("tb-gpt-production-extension-marker")?.content || "";
    const extensionSource = document.documentElement.dataset.tbGptProductionExtensionSource || "";
    const sidebarVisible = Boolean(document.querySelector("#tb-gpt-production-sidebar, .tb-gpt-sidebar"));
    const bodySnippet = bodyText.slice(0, 500);
    return {
      url,
      readyState,
      extensionReady,
      extensionVersion,
      extensionSource,
      composerReady,
      authenticationRequired: authenticationUrl || terminalAuthenticationSignal || (!composerReady && authenticationSignal),
      chatConversation,
      sidebarVisible,
      bodySnippet,
      hostname: parsedUrl?.hostname || "",
      pathname
    };
  })()`, 4000, {
    url: contents?.getURL() || GPT_URL,
    readyState: "",
    extensionReady: false,
    extensionVersion: "",
    extensionSource: "",
    composerReady: false,
    authenticationRequired: false,
    chatConversation: false,
    sidebarVisible: false,
    bodySnippet: "",
    hostname: "",
    pathname: "",
    error: "GPT 页面状态读取超时"
  }, `diagnostic:${id}`);
  if (account?.pageState && liveState) {
    const domReady = ["interactive", "complete"].includes(liveState.readyState);
    account.pageState.domReady = domReady;
    account.pageState.extensionReady = Boolean(liveState.extensionReady);
    if (domReady && liveState.composerReady && liveState.chatConversation && !liveState.authenticationRequired) {
      // A SPA navigation may expose a fully usable live DOM before the
      // native did-finish-load mirror catches up. Sync the mirror here so the
      // heartbeat cannot cancel a healthy checkpoint as a stale page load.
      account.pageState.loading = false;
      account.pageState.finished = true;
      account.pageState.error = "";
      account.pageState.finishedAt ||= new Date().toISOString();
      account.pageState.extensionVersion = String(liveState.extensionVersion || account.pageState.extensionVersion || "");
      account.pageState.extensionSource = String(liveState.extensionSource || account.pageState.extensionSource || "");
      notifyGptLoadingChanged(id, false);
    }
  }
  const notReadyReasons = [];
  if (!account?.pageState?.domReady) notReadyReasons.push("DOM 未加载完成");
  if (!liveState?.extensionReady) notReadyReasons.push("扩展未注入页面");
  if (!liveState?.composerReady) notReadyReasons.push("ChatGPT 输入框未找到");
  if (!liveState?.chatConversation) notReadyReasons.push(`URL 不是对话页: ${liveState?.hostname}${liveState?.pathname}`);
  if (liveState?.authenticationRequired) notReadyReasons.push("需要登录或验证码");
  const productionReady = Boolean(contents && account?.pageState?.domReady && liveState?.extensionReady && liveState?.composerReady && liveState?.chatConversation && !liveState?.authenticationRequired);
  return {
    ok: true,
    accountId: id,
    timestamp: new Date().toISOString(),
    hasView: true,
    extensionLoaded: Boolean(account?.extensionInfo),
    extensionRuntimeReady: Boolean(account?.extensionRuntimeReady),
    extensionInfo: account?.extensionInfo ? {
      id: account.extensionInfo.id,
      name: account.extensionInfo.name,
      version: account.extensionInfo.version,
      path: account.extensionPath
    } : null,
    extensionError: account?.extensionError || "",
    pageState: account?.pageState || null,
    url: contents?.getURL() || GPT_URL,
    liveState,
    productionReady,
    notReadyReasons
  };
});

ipcMain.handle("desktop:gpt-manual-action", async (_event, input = {}) => {
  const accountId = assertAssignedGptAccountId(input.accountId || activeGptAccountId);
  const account = await ensureGptAccount(accountId);
  const action = String(input.action || "download").replace(/[^a-z-]/g, "").slice(0, 32) || "download";
  const contents = account?.view?.webContents;
  if (!contents || contents.isDestroyed()) return { ok: false, error: "GPT 网页尚未就绪" };
  const requestId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const script = `new Promise((resolve) => {
    const requestId = ${JSON.stringify(requestId)};
    const timeout = setTimeout(() => {
      document.removeEventListener("tb-workbench-manual-action-result", onResult);
      resolve({ ok: false, error: "网页手动操作超时" });
    }, ${15 * 60 * 1000});
    function onResult() {
      let result = null;
      try { result = JSON.parse(document.getElementById("tb-workbench-manual-action-result")?.textContent || "null"); }
      catch { result = null; }
      if (!result || result.requestId !== requestId) return;
      clearTimeout(timeout);
      document.removeEventListener("tb-workbench-manual-action-result", onResult);
      resolve(result);
    }
    document.addEventListener("tb-workbench-manual-action-result", onResult);
    let bridge = document.getElementById("tb-workbench-manual-action-request");
    if (!bridge) {
      bridge = document.createElement("script");
      bridge.id = "tb-workbench-manual-action-request";
      bridge.type = "application/json";
      document.documentElement.appendChild(bridge);
    }
    bridge.textContent = ${JSON.stringify(JSON.stringify({ requestId, action }))};
    document.dispatchEvent(new Event("tb-workbench-manual-action"));
  })`;
  return contents.executeJavaScript(script, true)
    .catch((error) => ({ ok: false, error: error?.message || String(error) }));
});

ipcMain.handle("desktop:gpt-login-recovery-status", async (_event, accountId = activeGptAccountId) => {
  const id = assertAssignedGptAccountId(accountId);
  const metadataFile = recoveryMetadataFile(id);
  let metadata = null;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
  } catch {
    metadata = null;
  }
  return {
    ok: true,
    accountId: id,
    exists: fs.existsSync(gptRecoveryDirectory(id)),
    createdAt: metadata?.createdAt || "",
    machineOnly: true
  };
});

ipcMain.handle("desktop:gpt-login-recovery-create", async (_event, accountId = activeGptAccountId) => {
  const id = assertAssignedGptAccountId(accountId);
  const account = await ensureGptAccount(id);
  await account.session.flushStorageData();
  hideAllGptViews();
  await releaseGptAccountView(id);
  const request = {
    accountId: id,
    requestedAt: new Date().toISOString()
  };
  fs.mkdirSync(GPT_LOGIN_RECOVERY_ROOT, { recursive: true });
  fs.writeFileSync(GPT_PENDING_BACKUP_FILE, JSON.stringify(request, null, 2), "utf8");
  appendDesktopLog("gpt-login-recovery-scheduled", id);
  app.relaunch();
  app.exit(0);
  return { ok: true, restarting: true, ...request };
});

ipcMain.handle("desktop:gpt-login-recovery-restore", async (_event, accountId = activeGptAccountId) => {
  const id = assertAssignedGptAccountId(accountId);
  if (!fs.existsSync(gptRecoveryDirectory(id))) throw new Error("这个账号还没有本机 GPT 登录恢复点");
  await releaseGptAccountView(id);
  fs.mkdirSync(GPT_LOGIN_RECOVERY_ROOT, { recursive: true });
  fs.writeFileSync(GPT_PENDING_RESTORE_FILE, JSON.stringify({
    accountId: id,
    requestedAt: new Date().toISOString()
  }, null, 2), "utf8");
  appendDesktopLog("gpt-login-recovery-scheduled", id);
  app.relaunch();
  app.exit(0);
  return { ok: true, restarting: true };
});

if (!app.isPackaged || process.env.TB_DESKTOP_SMOKE === "1") {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    String(process.env.TB_REMOTE_DEBUGGING_PORT || (CONTENT_ONLY_MODE ? DEFAULT_REMOTE_DEBUGGING_PORT : "9333"))
  );
}

function appendDesktopLog(event, detail = "") {
  try {
    fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
    const safeDetail = String(detail || "").replace(/[\r\n]+/g, " ").slice(0, 2000);
    fs.appendFileSync(DESKTOP_LOG_FILE, `${new Date().toISOString()}\t${event}\t${safeDetail}\n`, "utf8");
  } catch {
    // Diagnostics must never prevent the app from starting.
  }
}

async function flushAllGptStorageData() {
  const profileState = readBrowserProfiles();
  const ids = new Set([
    ...profileState.profiles.map((profile) => safeGptAccountId(profile.id)),
    ...gptAccounts.keys(),
  ]);
  await Promise.all([...ids].map(async (id) => {
    try {
      await Promise.resolve(session.fromPartition(`${GPT_PARTITION_PREFIX}-${id}`).flushStorageData());
    } catch (error) {
      appendDesktopLog("gpt-storage-flush-failed", `${id} ${error.message}`);
    }
  }));
  try {
    await Promise.resolve(session.fromPartition(WECHAT_DRAFT_PARTITION).flushStorageData());
  } catch (error) {
    appendDesktopLog("wechat-draft-storage-flush-failed", error.message);
  }
  await Promise.all(Object.keys(ONLINE_PLATFORM_WEB_CONFIG).map(async (id) => {
    try {
      await Promise.resolve(session.fromPartition(`${ONLINE_PLATFORM_PARTITION_PREFIX}-${id}`).flushStorageData());
    } catch (error) {
      appendDesktopLog("online-platform-storage-flush-failed", `${id} ${error.message}`);
    }
  }));
  appendDesktopLog("gpt-storage-flushed", [...ids].join(","));
}

function restoreMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

let gptWindowRestoreTimer = null;
function notifyWindowRestored(reason = "show") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(gptWindowRestoreTimer);
  // A minimized BrowserWindow emits `restore`, not necessarily `show`.
  // Wait until Chromium has laid the workbench out again before asking the
  // renderer to re-attach the native GPT surface. This preserves the live
  // page/session and avoids reloading ChatGPT just to recover its pixels.
  gptWindowRestoreTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return;
    const account = activeGptAccount();
    if (account?.view && !account.view.webContents.isDestroyed()) {
      try {
        const bounds = account.view.getBounds();
        // Skip re-attaching if bounds are 0x0 — the view was just created
        // by ensureGptAccount but desktop:gpt-show hasn't set the real
        // bounds yet.  Re-attaching with 0x0 makes the GPT window invisible.
        if (bounds.width > 0 && bounds.height > 0) {
          mainWindow.contentView.removeChildView(account.view);
          mainWindow.contentView.addChildView(account.view);
          account.view.setBounds(bounds);
          account.view.setBackgroundColor(embeddedGptPalette(gptThemeName).main);
          account.view.setBorderRadius(16);
          appendDesktopLog("gpt-surface-restored", `${reason} ${account.id} ${bounds.width}x${bounds.height}`);
        } else {
          appendDesktopLog("gpt-surface-skip", `${reason} ${account.id} bounds=${bounds.width}x${bounds.height}`);
        }
      } catch (error) {
        appendDesktopLog("gpt-surface-restore-failed", `${reason} ${error.message}`);
      }
    }
    mainWindow.webContents.send("desktop:window-restored", { reason });
    showAssistantOverlayForWorkbench();
  }, 140);
}

async function requestExplicitQuit() {
  if (productionTaskActive && mainWindow) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "自动生产仍在运行",
      message: "彻底退出会中断当前自动生产任务。",
      detail: "普通关闭窗口只会退到后台。确定仍要彻底退出吗？",
      buttons: ["留在后台", "彻底退出"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (result.response !== 1) return;
  }
  isExplicitQuit = true;
  app.quit();
}

async function restartApp({ source = "automation", interactive = false } = {}) {
  if (interactive && productionTaskActive && mainWindow) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "自动生产仍在运行",
      message: "重启工作台会中断当前自动生产任务。",
      detail: "重启后单账号全自动窗口会从安全检查点自动恢复；只有你明确暂停或切到手动模式的窗口不会恢复。确定要重启吗？",
      buttons: ["取消", "重启"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (result.response !== 1) return { ok: false, cancelled: true };
  }
  appendDesktopLog("desktop-restart", source);
  setTimeout(() => {
    app.relaunch();
    // app.exit() bypasses before-quit. Reap the server child explicitly or
    // the next Electron instance can attach to the old 4327 process and keep
    // serving the previous source version after a restart.
    const ownedServer = serverProcess;
    serverProcess = null;
    if (ownedServer && !ownedServer.killed) {
      appendDesktopLog("server-stop", `restart ${source}`);
      try { ownedServer.kill(); } catch (error) {
        appendDesktopLog("server-stop-failed", `${source} ${error.message}`);
      }
    }
    // Give Windows a short chance to release 4327 before the relaunched
    // instance probes it. This is a process handoff delay, not a production
    // wait; checkpoints remain the source of truth during the handoff.
    setTimeout(() => app.exit(0), 180);
  }, 100);
  return { ok: true, scheduled: true };
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开图文工作台", click: restoreMainWindow },
    {
      label: productionTaskActive ? "暂停自动生产" : "当前没有自动任务",
      enabled: productionTaskActive,
      click: () => mainWindow?.webContents.send("desktop:pause-production")
    },
    { type: "separator" },
    { label: "重启工作台", click: () => restartApp({ source: "tray-menu", interactive: app.isPackaged }) },
    { type: "separator" },
    { label: "彻底退出", click: () => requestExplicitQuit() }
  ]));
  tray.setToolTip(productionTaskActive ? "图文工作台 · 自动生产中" : "图文工作台 · 后台运行");
}

function createTray() {
  if (tray) return tray;
  tray = new Tray(path.join(__dirname, "团建工作台.ico"));
  tray.on("click", restoreMainWindow);
  tray.on("double-click", restoreMainWindow);
  refreshTrayMenu();
  return tray;
}


function probeWorkbenchServer() {
  return new Promise((resolve) => {
    const request = http.get(APP_URL, { timeout: 1200 }, (response) => {
      response.resume();
      resolve(classifyWorkbenchPortProbe({ statusCode: response.statusCode }));
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(classifyWorkbenchPortProbe({ timedOut: true }));
    });
    request.on("error", (error) => resolve(classifyWorkbenchPortProbe({ errorCode: error.code })));
  });
}

async function ensureServer() {
  const initialProbe = await probeWorkbenchServer();
  if (initialProbe === "ready") return;
  if (initialProbe === "occupied") throw new Error(formatPortInUseMessage(APP_PORT));
  // Development must execute the checked-out source directly so a front-end
  // or server-side hot update is actually testable. Packaged builds retain
  // the durable runtime copy for restart-safe execution.
  const serverFile = app.isPackaged
    ? path.join(runtimeAppRoot(), "server.js")
    : path.join(__dirname, "..", "server.js");
  const releaseRoot = app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || process.execPath))
    : path.resolve(__dirname, "..", "..", "releases");
  serverProcess = childProcess.spawn(process.execPath, [serverFile], {
    cwd: path.dirname(serverFile),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: APP_PORT,
      CONTENT_INSTANCE_ID,
      CONTENT_INSTANCE_LABEL,
      CONTENT_ACCOUNT_IDS: process.env.CONTENT_ACCOUNT_IDS || "",
      CONTENT_ONLY_MODE: process.env.CONTENT_ONLY_MODE || "1",
      TEAMBUILDING_DASHBOARD_RUNTIME: RUNTIME_ROOT,
      TB_USER_DATA_ROOT,
      TEAMBUILDING_RELEASE_ROOT: releaseRoot
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProcess.stdout?.on("data", (chunk) => appendDesktopLog("server", chunk));
  serverProcess.stderr?.on("data", (chunk) => appendDesktopLog("server-error", chunk));
  serverProcess.on("error", (error) => appendDesktopLog("server-spawn-error", error?.stack || error?.message || String(error)));
  serverProcess.on("exit", (code, signal) => appendDesktopLog("server-exit", `code=${code} signal=${signal || ""}`));
  // Cold-starting Electron's server child can take longer when two isolated
  // instances initialize together. Keep the UI startup bounded but do not
  // label a healthy child as failed after the old 7.5s window.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const probe = await probeWorkbenchServer();
    if (probe === "ready") return;
    if (probe === "occupied") throw new Error(formatPortInUseMessage(APP_PORT));
  }
  throw new Error("本地工作台服务未能启动");
}

async function createWindow() {
  appendDesktopLog("desktop-start", `electron=${process.versions.electron} chrome=${process.versions.chrome}`);
  await ensureServer();
  const window = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    title: APP_TITLE,
    icon: path.join(__dirname, "团建工作台.ico"),
    show: false,
    backgroundColor: "#e7eee9",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      partition: WORKBENCH_PARTITION,
      // The renderer owns the durable GPT maintenance timers and queue
      // checkpoints. Keep them alive when the workbench is hidden to tray;
      // the native GPT WebContentsView already has the same guarantee.
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  mainWindow = window;
  window.on("minimize", () => {
    hideAllGptViews();
    hideOnlinePlatformViews();
    if (!assistantOverlayIsDetached()) assistantOverlayWindow?.hide();
  });
  window.on("hide", () => {
    hideAllGptViews();
    hideOnlinePlatformViews();
    if (!assistantOverlayIsDetached()) assistantOverlayWindow?.hide();
  });
  window.on("blur", hideAttachedAssistantOverlayWhenInactive);
  window.on("focus", showAssistantOverlayForWorkbench);
  window.on("show", () => {
    notifyWindowRestored("show");
  });
  window.on("restore", () => {
    notifyWindowRestored("restore");
  });
  window.on("close", (event) => {
    if (isExplicitQuit) return;
    event.preventDefault();
    hideAllGptViews();
    hideOnlinePlatformViews();
    window.hide();
    appendDesktopLog("desktop-background", productionTaskActive ? "production-active" : "idle");
    if (Notification.isSupported()) {
      new Notification({
        title: "图文工作台仍在后台运行",
        body: productionTaskActive ? "自动生产没有中断，可从右下角托盘重新打开。" : "可从右下角托盘重新打开或彻底退出。"
      }).show();
    }
  });
  window.on("closed", () => {
    if (assistantOverlayWindow && !assistantOverlayWindow.isDestroyed()) assistantOverlayWindow.destroy();
    assistantOverlayWindow = null;
    for (const account of gptAccounts.values()) {
      if (account.view && !account.view.webContents.isDestroyed()) account.view.webContents.close();
    }
    if (wechatDraftView && !wechatDraftView.webContents.isDestroyed()) wechatDraftView.webContents.close();
    wechatDraftView = null;
    for (const view of onlinePlatformViews.values()) {
      if (view && !view.webContents.isDestroyed()) view.webContents.close();
    }
    onlinePlatformViews.clear();
    onlinePlatformStates.clear();
    gptAccounts.clear();
    mainWindow = null;
  });

  window.once("ready-to-show", () => {
    if (process.env.TB_DESKTOP_HIDDEN !== "1") window.show();
  });
  // The "show" event may fire before the renderer's DOM is ready, causing
  // notifyWindowRestored to send desktop:window-restored into the void.
  // Re-trigger after the page finishes loading so the renderer can actually
  // receive it and restore the embedded GPT surface.
  window.webContents.once("did-finish-load", () => {
    setTimeout(() => notifyWindowRestored("did-finish-load"), 200);
  });
  window.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    appendDesktopLog("shell-load-failed", `code=${code} main=${isMainFrame} url=${validatedURL} ${description}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    appendDesktopLog("shell-render-gone", `${details.reason} exitCode=${details.exitCode}`);
  });

  const versionedUrl = new URL(APP_URL);
  versionedUrl.searchParams.set("appVersion", APP_VERSION);
  await window.loadURL(versionedUrl.toString());
  await ensureAssistantOverlay();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
appendDesktopLog("desktop-instance-lock", `id=${CONTENT_INSTANCE_ID} name=${app.getName()} userData=${app.getPath("userData")} acquired=${hasSingleInstanceLock}`);
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    ensureDurableRuntimeResources();
    applyPendingGptLoginBackup();
    applyPendingGptLoginRestore();
    startTemporaryWebCacheCleanup();
    createTray();
    watchExtensionForChanges();
    return createWindow();
  }).catch((error) => {
    appendDesktopLog("startup-failed", error.stack || error.message);
    console.error(error);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (isExplicitQuit && serverProcess && !serverProcess.killed) serverProcess.kill();
});

app.on("before-quit", (event) => {
  if (!quitFlushCompleted) {
    event.preventDefault();
    if (!quitFlushStarted) {
      quitFlushStarted = true;
      flushAllGptStorageData().finally(() => {
        quitFlushCompleted = true;
        app.quit();
      });
    }
    return;
  }
  isExplicitQuit = true;
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
