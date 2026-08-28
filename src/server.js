const http = require("http");
const dgram = require("dgram");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const crypto = require("crypto");
const os = require("os");
const zlib = require("zlib");
const { Worker } = require("worker_threads");
const sharp = require("sharp");
const { generateImages, generateText, networkFetch, normalizeImageApiConfig, normalizeTextApiConfig } = require("./lib/image-generation");
const {
  applySuggestedTitles,
  buildCopyPrompt,
  buildPagePrompt,
  buildProductionPlan,
  recipeForTemplate
} = require("./lib/production-recipes");
const { getJuguangSnapshot, queryKeywords } = require("./lib/juguang-data");
const {
  appendWorkflowOperation,
  classifyCollectionName,
  confirmOfficialUpload,
  getWorkflowStageRoots,
  getDistributionSnapshot,
  inspectSource,
  markOfficialUsed,
  moveCollectionSourceToStage,
  recordDeviceDistribution,
  readWorkflowOperations,
  renameCollectionType,
  reconcileWorkflowFolders
} = require("./lib/distribution-data");
const wechatDraft = require("./lib/wechat-draft");
const {
  isDownloadedText,
  ledgerStatus,
  productionHistoryStatus,
  registerDownloadedText,
  syncDedupLedger
} = require("./lib/dedup-ledger");
const {
  publicTransferTask,
  updateTransferProgress
} = require("./lib/transfer-progress");
const {
  automaticDistributionAdmission,
  automaticDistributionCandidateEligible,
  automaticDistributionBlockedMessage,
  automaticDistributionDecisionFingerprint,
  automaticDistributionSendCount,
  automaticDistributionSkipMessage,
  classifyAutomaticDistributionError,
  countReserve,
  decorateTrustedDevices,
  deviceApprovalKey,
  deviceTransportTarget,
  findRegisteredDevice,
  selectDeviceInventory,
  normalizePageSettings
} = require("./lib/workbench-settings");
const {
  dueMomentsSchedule,
  dueMomentsCollectionSchedule,
  nextMomentsSchedule,
  nextMomentsCollectionSchedule,
  isMomentsSelectionOnlyFailure,
  momentsScheduleRetryDecision,
  normalizeCollectionScheduleCatchUpDays,
  previousMonthWindow,
  selectionPolicyForRule
} = require("./lib/moments-scheduler");
const {
  normalizeQuotaLedger,
  recordQuotaEvent,
  rollingQuotaStatus
} = require("./lib/gpt-production-orchestrator");
const {
  normalizeWorkPackageTitle,
  publishTitleFromClipboard
} = require("./lib/work-package-title");
const {
  readRuntimeState: readGptRuntimeStateRaw,
  writeRuntimeState: writeGptRuntimeStateRaw,
  writeRuntimeStateAsync: writeGptRuntimeStateAsyncRaw
} = require("./lib/gpt-runtime-state");
const { normalizeEvidenceSnapshot } = require("./lib/gpt-production-evidence");
const {
  directoryIndex: getWorkPackageDirectoryIndex,
  historyIndex: getWorkPackageHistoryIndex,
  resolveWorkPackagePath
} = require("./lib/work-package-locator");
const {
  DEFAULT_WORK_DISTRIBUTION_CLAIM_TTL_MS,
  DEFAULT_WORK_DISTRIBUTION_ORPHAN_CLAIM_GRACE_MS,
  inspectWorks,
  readWorkDistributionLedger,
  acquireWorkDistributionClaims,
  hasWorkDistributionClaim,
  readWorkDistributionClaimNames,
  pruneStaleWorkDistributionClaims,
  releaseWorkDistributionClaims,
  touchWorkDistributionClaims,
  recordSuccessfulWorkDistribution,
  rebaseSuccessfulWorkDistributionPaths,
  workDistributionEligibility
} = require("./lib/work-distribution-ledger");
const {
  TAG_GROUPS,
  MATERIAL_TAG_RULES,
  deriveSystemTagGroups,
  inferWorkTagGroups,
  mergePlatformUsage,
  platformUsageCount,
  platformUsageEligibility,
  platformUsageTagGroups,
  recordPlatformUsage: recordWorkPlatformUsage,
  syncWorkTagLedger,
  updateWorkTagLedger
} = require("./lib/work-tags");
const {
  formatPortInUseMessage
} = require("./lib/workbench-port");
const {
  downloadBackup,
  importLifeGameConfig,
  publicStatus: publicCloudBackupStatus,
  readSecureConfig,
  saveManualConfig,
  saveSecureConfig,
  testConnection: testCloudBackupConnection,
  uploadBackup,
  uploadFile
} = require("./lib/webdav-backup");
const {
  inspectProductionQuality,
  qualityReportText
} = require("./lib/production-quality");
const {
  parsePlatformCopy,
  validatePlatformCopy
} = require("./integrations/gpt-production-extension/gpt-automation-core");
const {
  MATERIAL_LIFECYCLE_STATES,
  MATERIAL_OPERATION_STATUSES,
  MATERIAL_CONFLICT_CODES,
  normalizeLifecycleState,
  normalizeOperationalStatus,
  uniqueConflicts,
  decideMaterialLifecycle,
  canClaimMaterial,
  archiveEventKey,
  hasArchiveEvent,
  appendArchiveEvent,
  operationalStatusForFailure
} = require("./lib/material-lifecycle");
const { analyzeCollectionCandidates } = require("./lib/material-collection-keywords");
const {
  getInstanceConfig,
  instanceIdForPort,
  normalizeAccountId,
  normalizeInstanceId,
  resolveAssignedAccountIds
} = require("./lib/instance-account-policy");

// --- 分模块路由（渐进式拆分，每拆一个域加一行 require） ---
const juguangRoute = require("./server/routes/juguang");
const wechatDraftRoute = require("./server/routes/wechat-draft");
const backupRoute = require("./server/routes/backup");
const settingsRoute = require("./server/routes/settings");
const distributionRoute = require("./server/routes/distribution");
const platformPublishingRoute = require("./server/routes/platform-publishing");
const productionRoute = require("./server/routes/production");
const gptExtensionRoute = require("./server/routes/gpt-extension");
const conversionRoute = require("./server/routes/conversion");
const skillsRoute = require("./server/routes/skills");
const { resolveAuthorizedDownloadRoot } = require("./lib/gpt-download-root");

const PORT = Number(process.env.PORT || 4327);
const LISTEN_HOST = process.env.TB_WORKBENCH_HOST || "127.0.0.1";
const PROJECT_ROOT = process.env.TEAMBUILDING_ROOT || "D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目";
const TEMPLATE_REPOSITORY_OPEN_ROOT = process.env.TEAMBUILDING_TEMPLATE_REPOSITORY_ROOT
  || "D:\\AICode\\项目推进\\模板仓库";
const TEMPLATE_PROJECT_LEDGER_OPEN_ROOT = process.env.TEAMBUILDING_TEMPLATE_PROJECT_ROOT
  || path.join(PROJECT_ROOT, "02-模板库");
const SKILL_ROOT = process.env.TEAMBUILDING_SKILL_ROOT || "D:\\AICode\\AI\\skills\\图文创作相关技能\\团建相关技能";
const SKILLS_LIBRARY_ROOT = process.env.TEAMBUILDING_MAINTENANCE_SKILL_ROOT || "D:\\AICode\\AI\\skills\\技能包\\技能";
const APP_ROOT = __dirname;
const PUBLIC_ROOT = path.join(APP_ROOT, "public");
const PROJECT_APP_ROOT = path.resolve(APP_ROOT, "..");
const CONVERSION_SERVICE_ORIGIN = process.env.JIANGHU_CONVERSION_ORIGIN || "http://127.0.0.1:8765";
const CONVERSION_ASSISTANT_ROOT = process.env.JIANGHU_CONVERSION_ROOT || "D:\\AICode\\工具开发\\projects\\jianghu-conversion-assistant";
const CONVERSION_ASSISTANT_LAUNCHER = path.join(CONVERSION_ASSISTANT_ROOT, "start.vbs");
const CONVERSION_RUNTIME_ROOT = process.env.JIANGHU_CONVERSION_RUNTIME_ROOT || "D:\\AICode\\运行数据\\江湖有旅人\\转化助手";
const CONVERSION_KNOWLEDGE_REPORT_PATH = process.env.TEAMBUILDING_KNOWLEDGE_REPORT
  || path.join("D:\\AICode\\AI\\repos\\江湖团建企业转化知识库", "05-分析与复盘", "团建项目全链路知识库.html");
const APP_VERSION = (() => {
  try { return fs.readFileSync(path.join(PROJECT_APP_ROOT, "VERSION"), "utf8").trim() || "0.0.0"; }
  catch { return require("./package.json").version || "0.0.0"; }
})();
const RELEASE_ROOT = process.env.TEAMBUILDING_RELEASE_ROOT || path.join(PROJECT_APP_ROOT, "releases");
const SOURCE_REPOSITORY_URL = process.env.TB_WORKBENCH_REPOSITORY_URL
  || "https://github.com/zwmopen/teambuilding-workflow-dashboard";
const RELEASE_URL = process.env.TB_WORKBENCH_RELEASE_URL
  || `${SOURCE_REPOSITORY_URL.replace(/\/$/, "")}/releases`;
// 手机接收端是独立发布的；从设置页直达它的 Release，避免用户在两个仓库之间找版本。
const MOBILE_UPDATE_URL = process.env.TB_MOBILE_UPDATE_URL
  || "https://github.com/zwmopen/team-video-workflow/releases";
const CONTENT_ONLY_MODE = String(process.env.CONTENT_ONLY_MODE || "") === "1";
const CONTENT_INSTANCE_ID = normalizeInstanceId(process.env.CONTENT_INSTANCE_ID
  || instanceIdForPort(process.env.PORT || 4327));
const CONTENT_INSTANCE_CONFIG = getInstanceConfig(CONTENT_INSTANCE_ID);
const CONTENT_INSTANCE_LABEL = String(
  process.env.CONTENT_INSTANCE_LABEL || `实例 ${CONTENT_INSTANCE_ID}`
).trim();
const ASSIGNED_ACCOUNT_IDS = new Set(resolveAssignedAccountIds(
  CONTENT_INSTANCE_ID,
  process.env.CONTENT_ACCOUNT_IDS,
  { contentOnlyMode: CONTENT_ONLY_MODE }
));
const DEFAULT_CONTENT_RUNTIME_ROOT = `D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-${CONTENT_INSTANCE_ID}`;
const DATA_ROOT = process.env.TEAMBUILDING_DASHBOARD_RUNTIME
  || (CONTENT_ONLY_MODE ? DEFAULT_CONTENT_RUNTIME_ROOT : "D:\\AICode\\运行数据\\江湖有旅人\\团建工作台");
const SHARED_MATERIAL_ROOT = process.env.TEAMBUILDING_SHARED_MATERIAL_ROOT
  || (CONTENT_ONLY_MODE ? path.join(path.dirname(DATA_ROOT), "shared-material") : DATA_ROOT);
const STATE_FILE = path.join(DATA_ROOT, "state.json");
const PROMPTS_FILE = path.join(DATA_ROOT, "prompt-versions.json");
const TASK_INDEX_FILE = path.join(DATA_ROOT, "production-task-index.json");
const APP_SETTINGS_FILE = path.join(DATA_ROOT, "app-settings.json");
const IMAGE_API_SECRET_FILE = path.join(DATA_ROOT, "secrets", "image-api.local.env");
const WEBDAV_CONFIG_FILE = path.join(DATA_ROOT, "secrets", "webdav-config.dpapi.json");
const CLOUD_BACKUP_META_FILE = path.join(DATA_ROOT, "cloud-backup-meta.json");
const CLOUD_LARGE_BACKUP_MANIFEST_FILE = path.join(DATA_ROOT, "cloud-large-backup-manifest.json");
const IMAGE_REVIEW_ROOT = path.join(DATA_ROOT, "API生产待审");
const PRODUCTION_JOB_ROOT = path.join(DATA_ROOT, "production-jobs");
const COLLECTION_LEDGER_FILE = path.join(DATA_ROOT, "collection-ledger.json");
const DEVICE_PRESENCE_FILE = path.join(DATA_ROOT, "device-presence.json");
const DEVICE_NOTES_FILE = path.join(DATA_ROOT, "device-notes.json");
const DEVICE_DISTRIBUTION_APPROVALS_FILE = path.join(DATA_ROOT, "device-distribution-approvals.json");
const WORK_DISTRIBUTION_LEDGER_FILE = path.join(DATA_ROOT, "work-distribution-ledger.json");
const WORK_DISTRIBUTION_CLAIMS_ROOT = path.join(DATA_ROOT, "work-distribution-claims");
const WORK_TAG_LEDGER_FILE = path.join(DATA_ROOT, "work-tag-ledger.json");
const DISTRIBUTION_AUTOMATION_LOG_FILE = path.join(DATA_ROOT, "distribution-automation.jsonl");
const MOBILE_CONVERSION_TOKEN_FILE = path.join(DATA_ROOT, "secrets", "mobile-conversion.token");
const MATERIAL_SCAN_CACHE_FILE = path.join(SHARED_MATERIAL_ROOT, "material-scan-cache.json");
const MATERIAL_LIBRARY_CACHE_FILE = path.join(SHARED_MATERIAL_ROOT, "material-library-cache.json");
const DEDUP_LEDGER_FILE = path.join(SHARED_MATERIAL_ROOT, "防重复账本", "dedup-ledger.json");
const EXTENSION_DOWNLOAD_LOG_FILE = path.join(DATA_ROOT, "防重复账本", "extension-download-events.json");
const MATERIAL_USAGE_LEDGER_FILE = path.join(SHARED_MATERIAL_ROOT, "防重复账本", "material-usage-ledger.json");
const MATERIAL_METADATA_LEDGER_FILE = path.join(SHARED_MATERIAL_ROOT, "防重复账本", "material-metadata-ledger.json");
const MATERIAL_HASH_CACHE_FILE = path.join(SHARED_MATERIAL_ROOT, "material-hash-cache.json");
const MATERIAL_GLOBAL_INDEX_FILE = path.join(SHARED_MATERIAL_ROOT, "material-global-index.json");
const MATERIAL_LIFECYCLE_LEDGER_FILE = path.join(SHARED_MATERIAL_ROOT, "material-lifecycle-ledger.json");
const MATERIAL_CLAIM_LOCK_FILE = path.join(SHARED_MATERIAL_ROOT, ".material-lifecycle.lock");
const GPT_QUOTA_LEDGER_FILE = path.join(DATA_ROOT, "gpt-production-quota.json");
const GPT_PRODUCTION_CHECKPOINT_FILE = path.join(DATA_ROOT, "gpt-production-checkpoints.json");
const GPT_RUNTIME_STATE_FILE = path.join(DATA_ROOT, "gpt-production-runtime.json");
const GPT_PRODUCTION_ARCHIVE_LOG_FILE = path.join(DATA_ROOT, "gpt-production-archive.jsonl");
const GPT_CONVERSATION_LOG_FILE = path.join(DATA_ROOT, "gpt-conversation-log.jsonl");

function isContentAccountAssigned(value) {
  const accountId = normalizeAccountId(value);
  return Boolean(accountId) && (!ASSIGNED_ACCOUNT_IDS.size || ASSIGNED_ACCOUNT_IDS.has(accountId));
}

function assertContentAccount(value, options = {}) {
  const accountId = normalizeAccountId(value);
  if (!accountId) {
    if (options.required === true || ASSIGNED_ACCOUNT_IDS.size > 0) {
      const error = new Error("当前请求缺少账号标识");
      error.code = "CONTENT_ACCOUNT_REQUIRED";
      throw error;
    }
    return "";
  }
  if (ASSIGNED_ACCOUNT_IDS.size > 0 && !ASSIGNED_ACCOUNT_IDS.has(accountId)) {
    const error = new Error(`当前实例 ${CONTENT_INSTANCE_ID} 未绑定账号 ${accountId}`);
    error.code = "CONTENT_ACCOUNT_NOT_ASSIGNED";
    throw error;
  }
  return accountId;
}

function scopeRuntimeStateForInstance(state) {
  if (!ASSIGNED_ACCOUNT_IDS.size || !state || typeof state !== "object") return state;
  const assigned = ASSIGNED_ACCOUNT_IDS;
  const accountFromTask = (task) => normalizeAccountId(task?.accountId || task?.accountWindowId || "");
  const queue = state.queue && typeof state.queue === "object"
    ? {
      ...state.queue,
      activeAccountId: isContentAccountAssigned(state.queue.activeAccountId)
        ? normalizeAccountId(state.queue.activeAccountId)
        : "",
      tasks: Array.isArray(state.queue.tasks)
        ? state.queue.tasks.filter((task) => {
          const accountId = accountFromTask(task);
          return !accountId || assigned.has(accountId);
        })
        : state.queue.tasks
    }
    : state.queue;
  const control = state.control && typeof state.control === "object"
    ? {
      ...state.control,
      windowRuntime: Object.fromEntries(Object.entries(state.control.windowRuntime || {})
        .filter(([accountId]) => assigned.has(normalizeAccountId(accountId))))
    }
    : state.control;
  return { ...state, queue, control };
}

function readGptRuntimeState(file) {
  return scopeRuntimeStateForInstance(readGptRuntimeStateRaw(file));
}

function writeGptRuntimeState(file, input = {}) {
  return scopeRuntimeStateForInstance(writeGptRuntimeStateRaw(file, scopeRuntimeStateForInstance(input)));
}

async function writeGptRuntimeStateAsync(file, input = {}) {
  const saved = await writeGptRuntimeStateAsyncRaw(file, scopeRuntimeStateForInstance(input));
  return scopeRuntimeStateForInstance(saved);
}

function withMaterialLedgerLock(work, options = {}) {
  fs.mkdirSync(SHARED_MATERIAL_ROOT, { recursive: true });
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 15000));
  const staleMs = Math.max(10000, Number(options.staleMs || 60000));
  const deadline = Date.now() + timeoutMs;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  let handle = null;
  while (!handle && Date.now() < deadline) {
    try {
      handle = fs.openSync(MATERIAL_CLAIM_LOCK_FILE, "wx");
      fs.writeFileSync(handle, `${process.pid}:${new Date().toISOString()}`);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const stat = fs.statSync(MATERIAL_CLAIM_LOCK_FILE);
        if (Date.now() - stat.mtimeMs > staleMs) fs.unlinkSync(MATERIAL_CLAIM_LOCK_FILE);
      } catch { /* another process is acquiring or releasing the lock */ }
      Atomics.wait(waitBuffer, 0, 0, 40);
    }
  }
  if (handle === null) {
    const error = new Error("共享素材账本正在被另一个生产实例更新，请稍后重试");
    error.code = "MATERIAL_LEDGER_BUSY";
    throw error;
  }
  try {
    return work();
  } finally {
    try { fs.closeSync(handle); } catch { /* already closed */ }
    try { fs.unlinkSync(MATERIAL_CLAIM_LOCK_FILE); } catch { /* another recovery cleaned a stale lock */ }
  }
}

function readRecentGptConversationEntries(limit = 50) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit || 50)));
  if (!fs.existsSync(GPT_CONVERSATION_LOG_FILE)) return [];
  const stat = fs.statSync(GPT_CONVERSATION_LOG_FILE);
  const fd = fs.openSync(GPT_CONVERSATION_LOG_FILE, "r");
  const chunks = [];
  let position = stat.size;
  let lineBreaks = 0;
  try {
    // Recovery only needs the newest bounded events. Read from the tail in
    // chunks instead of parsing the entire ever-growing JSONL file on every
    // worker startup; otherwise a few seconds of disk I/O can make the
    // client-side recovery probe time out and leave an archived task queued.
    const chunkSize = 256 * 1024;
    while (position > 0 && lineBreaks < safeLimit + 1) {
      const start = Math.max(0, position - chunkSize);
      const buffer = Buffer.alloc(position - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      chunks.unshift(buffer);
      position = start;
      for (const byte of buffer) if (byte === 0x0a) lineBreaks += 1;
    }
  } finally {
    fs.closeSync(fd);
  }
  const lines = Buffer.concat(chunks).toString("utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-safeLimit)
    .reverse();
  return lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function readGptConversationOwnership(requestIds = []) {
  const ids = [...new Set((Array.isArray(requestIds) ? requestIds : [requestIds])
    .map((value) => String(value || "").trim())
    .filter(Boolean))].slice(0, 24);
  const result = Object.fromEntries(ids.map((id) => [id, { accounts: [], firstAccount: "", lastAccount: "", conversationUrls: [] }]));
  if (!ids.length || !fs.existsSync(GPT_CONVERSATION_LOG_FILE)) return result;
  const idSet = new Set(ids);
  const text = fs.readFileSync(GPT_CONVERSATION_LOG_FILE, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || !ids.some((id) => line.includes(id))) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const requestId = String(entry?.requestId || "").trim();
    if (!idSet.has(requestId)) continue;
    const account = String(entry?.account || entry?.accountId || "").trim();
    const conversationUrl = String(entry?.conversationUrl || "").split("::material:")[0].trim();
    const record = result[requestId];
    if (account && isContentAccountAssigned(account)) {
      const normalizedAccount = normalizeAccountId(account);
      record.firstAccount ||= normalizedAccount;
      record.lastAccount = normalizedAccount;
      if (!record.accounts.includes(normalizedAccount)) record.accounts.push(normalizedAccount);
    }
    if (conversationUrl && !record.conversationUrls.includes(conversationUrl)) {
      record.conversationUrls.push(conversationUrl);
    }
  }
  return result;
}
const WORKBENCH_CONTEXT_SOURCE_FILES = Object.freeze({
  app: path.join(PUBLIC_ROOT, "app.js"),
  server: path.join(APP_ROOT, "server.js"),
  desktop: path.join(APP_ROOT, "desktop", "main.js"),
  preload: path.join(APP_ROOT, "desktop", "preload.js"),
  commandbus: path.join(PUBLIC_ROOT, "workbench-command-bus.js")
});
const WORKBENCH_CONTEXT_LOG_FILES = Object.freeze({
  runtime: GPT_RUNTIME_STATE_FILE,
  conversation: GPT_CONVERSATION_LOG_FILE,
  archive: GPT_PRODUCTION_ARCHIVE_LOG_FILE,
  quota: GPT_QUOTA_LEDGER_FILE
});
const WORKPKG_SCRIPT_ROOT = path.join(DATA_ROOT, "work-package");
const WORKPKG_CONFIG_FILE = process.env.TEAMBUILDING_WORKPKG_CONFIG_FILE || path.join(WORKPKG_SCRIPT_ROOT, "workpkg_config.json");
// The standalone content-production instances intentionally share the existing
// local work-package inbox. The UI has always defaulted to D:\Download, but
// falling back to DATA_ROOT/work-package made that persisted (and valid) path
// fail the server-side authorization check after a restart.
const DOWNLOAD_ROOT = process.env.TEAMBUILDING_DOWNLOAD_ROOT
  || (CONTENT_ONLY_MODE ? "D:\\Download" : WORKPKG_SCRIPT_ROOT);
const PUBLISH_ROOT = process.env.TEAMBUILDING_PUBLISH_ROOT
  || path.join(PROJECT_ROOT, "成品库（GPT+本地脚本制作）", "发布空间");
const DEVICE_TRANSFER_ROOT = process.env.DEVICE_TRANSFER_SKILL_ROOT
  || "D:\\AICode\\AI\\skills\\技能包\\技能\\device-folder-transfer";
const DEVICE_REGISTRY_FILE = path.join(DEVICE_TRANSFER_ROOT, "references", "device-registry.json");
// 朋友圈作品库是独立于常规图文素材库的本地私有数据。默认沿用当前 V1
// 约定的 D 盘目录，也允许通过环境变量切换，不把个人素材复制进仓库。
const MOMENTS_LIBRARY_ROOT = process.env.TEAMBUILDING_MOMENTS_LIBRARY_ROOT || "D:\\朋友圈weflow";
const MOMENTS_PYTHON_ROOT = path.join(APP_ROOT, ".venv-moments", "Scripts", "python.exe");
const WEFLOW_CONTACTS_CACHE = process.env.TEAMBUILDING_WEFLOW_CONTACTS_CACHE
  || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "weflow", "cache", "contacts.json");
const MOMENTS_MAX_MEDIA = 9;
let momentsSchedulerTimer = null;
let momentsSchedulerRunning = false;
let momentsSchedulerLastRun = null;
let momentsCollectionSchedulerRunning = false;
const momentsSchedulerConsumedKeys = new Set();
const momentsSchedulerRetryExhaustedKeys = new Set();

// Windows 上 `py` (Python Launcher) 不一定安装，查找可用的 Python 可执行文件
let _pythonExe = null;
function pythonExe() {
  if (_pythonExe) return _pythonExe;
  const candidates = [
    "python",       // PATH 中的 python
    "python3",      // PATH 中的 python3
    "py",            // Python Launcher（如果安装了）
    "C:\\Users\\z\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
    "C:\\Python311\\python.exe",
    "D:\\Program Files\\Python311\\python.exe",
  ];
  for (const cmd of candidates) {
    try {
      const result = childProcess.spawnSync(cmd, ["--version"], {
        windowsHide: true,
        timeout: 5000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      if (result.status === 0 && /Python \d/i.test(result.stdout || result.stderr || "")) {
        _pythonExe = cmd;
        return cmd;
      }
    } catch {
      // 继续尝试下一个候选
    }
  }
  // 回退到 "python"，让系统报错时给出可读信息
  _pythonExe = "python";
  return _pythonExe;
}

const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const textExts = new Set([".txt", ".md"]);
const MATERIAL_MAIN_TAGS = ["团建游戏", "团建转化", "合集攻略"];
const PREVIEW_LIMITS = {
  materialItemsPerCategory: 1000,
  materialImagesPerItem: 12,
  templateImages: 5,
  productWorksPerGroup: 36,
  productImagesPerWork: 12
};
const materialCategoryCache = new Map();
let materialGlobalIndexJob = {
  status: "idle",
  startedAt: "",
  completedAt: "",
  currentCategory: "",
  processedCategories: 0,
  totalCategories: 0,
  indexedItems: 0,
  error: ""
};
let materialGlobalIndexWorker = null;
function readDevicePresenceSnapshot(file = DEVICE_PRESENCE_FILE) {
  const saved = readJson(file, null);
  const onlineDevices = Array.isArray(saved?.onlineDevices) ? saved.onlineDevices : [];
  return {
    version: 1,
    checkedAt: Number(saved?.checkedAt || 0),
    onlineDevices,
    stale: saved?.stale === true,
    scanError: saved?.scanError ? String(saved.scanError) : "",
    scanErrorAt: saved?.scanErrorAt ? String(saved.scanErrorAt) : "",
    output: saved?.output ? String(saved.output) : ""
  };
}

function writeDevicePresenceSnapshot(snapshot = {}, file = DEVICE_PRESENCE_FILE) {
  const normalized = {
    version: 1,
    checkedAt: Number(snapshot?.checkedAt || 0),
    onlineDevices: Array.isArray(snapshot?.onlineDevices) ? snapshot.onlineDevices : []
  };
  if (snapshot?.stale === true) normalized.stale = true;
  if (snapshot?.scanError) normalized.scanError = String(snapshot.scanError);
  if (snapshot?.scanErrorAt) normalized.scanErrorAt = String(snapshot.scanErrorAt);
  if (snapshot?.output) normalized.output = String(snapshot.output);
  writeJson(file, normalized);
  return normalized;
}

let deviceStatusCache = readDevicePresenceSnapshot();
let deviceStatusPromise = null;
let automaticDistributionTimer = null;
let automaticDistributionScanInFlight = false;
const DEVICE_DISCOVERY_PORT = 45834;
const DEVICE_BEACON_TTL_MS = 15_000;
let devicePresenceEventSocket = null;
let devicePresenceEventRetryTimer = null;
const devicePresenceEventRecords = new Map();
// Android publishes a UDP beacon every 2.5 seconds. Keep the workbench
// reaction below one beacon window instead of batching decisions every 10s.
const AUTOMATIC_DISTRIBUTION_SCAN_INTERVAL_MS = 3_000;
const DEVICE_STATUS_SCAN_TIMEOUT_MS = 18_000;
let automaticDistributionMonitorState = {
  enabled: true,
  mode: "双向 UDP 握手（发现后补充库存）",
  intervalMs: AUTOMATIC_DISTRIBUTION_SCAN_INTERVAL_MS,
  startedAt: "",
  lastScanStartedAt: "",
  lastScanCompletedAt: "",
  lastScanDurationMs: null,
  lastScanDeviceCount: 0,
  lastScanError: "",
  scanInFlight: false,
  eventMode: "pending",
  eventPort: DEVICE_DISCOVERY_PORT,
  lastEventAt: "",
  lastEventDevice: "",
  eventCount: 0,
  eventError: ""
};
const genericTransferTasks = new Map();
const distributionTasks = new Map();
const distributionClaimHeartbeatTimers = new Map();
const automaticDistributionSessions = new Map();
const automaticDistributionActiveDeviceKeys = new Set();
// A deterministic receiver-format failure must not create a new transfer on
// every inventory poll. Keep this in memory until the device disappears and
// reconnects (the expected point at which a new APK can be installed).
const automaticDistributionBlockedDevices = new Map();
let automaticDistributionBlockedDevicesHydrated = false;
const pendingProductionPlans = new Map();
const productionJobs = new Map();
const productionAbortControllers = new Map();
const conversionProxyCache = new Map();
const CONVERSION_CACHE_TTL_MS = PORT === 4327 ? 10 * 60 * 1000 : 2_000;
// The distribution snapshot walks the real work folders and can be large.  The
// browser polls it periodically, so rebuilding it for every request makes the
// UI look frozen even though the underlying transfer/production process is
// healthy.  Keep the last complete snapshot briefly and let explicit refresh
// requests bypass it.  Mutating paths invalidate it below.
const LIVE_DISTRIBUTION_CACHE_TTL_MS = 15_000;
let liveDistributionSnapshotCache = {
  key: "",
  generatedAt: 0,
  value: null
};

function startDistributionClaimHeartbeat(taskId, workIds) {
  const normalizedTaskId = String(taskId || "").trim();
  const ids = Array.isArray(workIds) ? workIds.filter(Boolean) : [];
  if (!normalizedTaskId || !ids.length) return;
  stopDistributionClaimHeartbeat(normalizedTaskId);
  const timer = setInterval(() => {
    touchWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, ids, { taskId: normalizedTaskId });
  }, 60_000);
  timer.unref?.();
  distributionClaimHeartbeatTimers.set(normalizedTaskId, timer);
}

function stopDistributionClaimHeartbeat(taskId) {
  const normalizedTaskId = String(taskId || "").trim();
  const timer = distributionClaimHeartbeatTimers.get(normalizedTaskId);
  if (!timer) return;
  clearInterval(timer);
  distributionClaimHeartbeatTimers.delete(normalizedTaskId);
}

let cloudBackupTimer = null;
let largeCloudBackupTask = null;

function ensureDataFiles() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.mkdirSync(SHARED_MATERIAL_ROOT, { recursive: true });
  if (!fs.existsSync(STATE_FILE) || !readJson(STATE_FILE, null)) writeJson(STATE_FILE, buildDefaultState());
  if (!fs.existsSync(PROMPTS_FILE)) {
    writeJson(PROMPTS_FILE, buildDefaultPromptVersions());
  }
  if (!fs.existsSync(APP_SETTINGS_FILE)) {
    writeJson(APP_SETTINGS_FILE, {
      materialRoot: path.join(PROJECT_ROOT, "01-素材库")
    });
  }
  // The content-only app can run two instances concurrently. A cold start
  // must not make both processes synchronously rescan the entire material
  // library before the HTTP server becomes responsive. Seed the shared
  // ledger during setup or refresh it explicitly through the maintenance UI.
  if (!fs.existsSync(DEDUP_LEDGER_FILE)) {
    if (CONTENT_ONLY_MODE) {
      writeJson(DEDUP_LEDGER_FILE, {
        version: 1,
        updatedAt: new Date().toISOString(),
        localOnly: true,
        downloads: [],
        distributions: [],
        archives: [],
        imports: []
      });
    } else {
      syncHistoricalDedupLedger();
    }
  }
  loadProductionJobs();
}

function getCloudBackupStatus() {
  let config = null;
  try { config = readSecureConfig(WEBDAV_CONFIG_FILE); } catch { config = null; }
  return publicCloudBackupStatus(config, {
    ...readJson(CLOUD_BACKUP_META_FILE, {
    lastBackupAt: "",
    lastBackupFile: "",
    lastResult: ""
    }),
    largeBackup: largeCloudBackupTask || readJson(CLOUD_LARGE_BACKUP_MANIFEST_FILE, {}).lastTask || null
  });
}

function buildCloudBackupPayload() {
  const files = [
    STATE_FILE,
    PROMPTS_FILE,
    TASK_INDEX_FILE,
    APP_SETTINGS_FILE,
    COLLECTION_LEDGER_FILE,
    DEVICE_PRESENCE_FILE,
    DEVICE_NOTES_FILE,
    DEVICE_DISTRIBUTION_APPROVALS_FILE,
    WORK_DISTRIBUTION_LEDGER_FILE,
    DEDUP_LEDGER_FILE,
    EXTENSION_DOWNLOAD_LOG_FILE,
    MATERIAL_USAGE_LEDGER_FILE,
    MATERIAL_METADATA_LEDGER_FILE,
    GPT_QUOTA_LEDGER_FILE
  ];
  const records = {};
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    const relative = path.relative(DATA_ROOT, filePath).replace(/\\/g, "/");
    try { records[relative] = JSON.parse(fs.readFileSync(filePath, "utf8")); }
    catch { records[relative] = fs.readFileSync(filePath, "utf8"); }
  }
  return {
    schema: "teambuilding-workbench-backup-v1",
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    machine: os.hostname?.() || process.env.COMPUTERNAME || "windows",
    scope: "设置、提示词、任务索引、设备备注、分发与防重复记录；不包含素材和成品大文件",
    records
  };
}

function restoreBackupPayload(payload = {}) {
  if (payload.schema !== "teambuilding-workbench-backup-v1") {
    throw new Error("备份文件格式不正确");
  }
  const allowedFiles = [
    STATE_FILE,
    PROMPTS_FILE,
    TASK_INDEX_FILE,
    APP_SETTINGS_FILE,
    COLLECTION_LEDGER_FILE,
    DEVICE_PRESENCE_FILE,
    DEVICE_NOTES_FILE,
    DEVICE_DISTRIBUTION_APPROVALS_FILE,
    WORK_DISTRIBUTION_LEDGER_FILE,
    DEDUP_LEDGER_FILE,
    EXTENSION_DOWNLOAD_LOG_FILE,
    MATERIAL_USAGE_LEDGER_FILE,
    MATERIAL_METADATA_LEDGER_FILE,
    GPT_QUOTA_LEDGER_FILE
  ];
  const allowed = new Map(allowedFiles.map((filePath) => [
    path.relative(DATA_ROOT, filePath).replace(/\\/g, "/"),
    filePath
  ]));
  const restorable = Object.entries(payload.records || {}).filter(([relative]) => allowed.has(relative));
  if (!restorable.length) throw new Error("备份中没有可恢复的工作台记录");
  const recoveryRoot = path.join(DATA_ROOT, "恢复前快照");
  fs.mkdirSync(recoveryRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const localSnapshot = path.join(recoveryRoot, `before-restore-${stamp}.json`);
  writeJson(localSnapshot, buildCloudBackupPayload());
  for (const [relative, value] of restorable) {
    const target = allowed.get(relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (typeof value === "string") fs.writeFileSync(target, value, "utf8");
    else writeJson(target, value);
  }
  materialCategoryCache.clear();
  materialPostCache = null;
  materialLibraryCache = null;
  return { restored: restorable.length, localSnapshot };
}

async function runCloudBackupNow() {
  const config = readSecureConfig(WEBDAV_CONFIG_FILE);
  if (!config) throw new Error("请先配置坚果云 WebDAV");
  const payload = buildCloudBackupPayload();
  const stamp = payload.createdAt.replace(/[:.]/g, "-");
  const fileName = `teambuilding-workbench-${stamp}.json`;
  await uploadBackup(config, payload, fileName);
  const metadata = {
    lastBackupAt: payload.createdAt,
    lastBackupFile: fileName,
    lastResult: `已备份 ${Object.keys(payload.records).length} 份本地记录`
  };
  writeJson(CLOUD_BACKUP_META_FILE, metadata);
  return publicCloudBackupStatus(config, metadata);
}

async function inspectLatestCloudBackup() {
  const config = readSecureConfig(WEBDAV_CONFIG_FILE);
  if (!config) throw new Error("请先配置坚果云 WebDAV");
  const payload = await downloadBackup(config);
  const recordNames = Object.keys(payload.records || {});
  return {
    ok: true,
    schema: payload.schema,
    createdAt: payload.createdAt || "",
    appVersion: payload.appVersion || "",
    recordCount: recordNames.length,
    records: recordNames,
    message: `云端最新备份可读取，共 ${recordNames.length} 份记录`
  };
}

async function restoreLatestCloudBackup() {
  const config = readSecureConfig(WEBDAV_CONFIG_FILE);
  if (!config) throw new Error("请先配置坚果云 WebDAV");
  const payload = await downloadBackup(config);
  const restored = restoreBackupPayload(payload);
  return {
    ok: true,
    restoredAt: new Date().toISOString(),
    sourceCreatedAt: payload.createdAt || "",
    restoredRecords: restored.restored,
    localSnapshot: restored.localSnapshot,
    message: `已恢复 ${restored.restored} 份记录；恢复前快照已保留`
  };
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function scanLargeBackupFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.name.startsWith(".")
        || entry.name.startsWith("~$")
        || ["desktop.ini", "thumbs.db"].includes(entry.name.toLowerCase())) continue;
      let stats;
      try { stats = await fs.promises.lstat(fullPath); } catch { continue; }
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) queue.push(fullPath);
      else if (stats.isFile()) {
        files.push({
          path: fullPath,
          relative: path.relative(root, fullPath).replace(/\\/g, "/"),
          size: stats.size,
          mtimeMs: Math.trunc(stats.mtimeMs)
        });
      }
    }
    // The configured WebDAV source can contain a large knowledge base. Yield
    // between directories so local health probes, GPT runtime reads, and
    // production checkpoints are never held behind one synchronous scan.
    await new Promise((resolve) => setImmediate(resolve));
  }
  return files.sort((left, right) => left.mtimeMs - right.mtimeMs || left.relative.localeCompare(right.relative, "zh-CN"));
}

async function executeLargeCloudBackup() {
  const settings = getPageSettings().backup || {};
  const sourceRoot = path.resolve(settings.sourceRoot || "");
  if (!settings.sourceRoot || !exists(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error("请先设置有效的方案/大文件来源目录");
  }
  const config = readSecureConfig(WEBDAV_CONFIG_FILE);
  if (!config) throw new Error("请先配置坚果云 WebDAV");
  await testCloudBackupConnection(config);

  const manifest = readJson(CLOUD_LARGE_BACKUP_MANIFEST_FILE, {
    schema: "teambuilding-large-backup-v1",
    files: {},
    monthlyUsage: {}
  });
  const month = currentMonthKey();
  const limitBytes = Math.max(0, Number(settings.monthlyLargeFileLimitMb || 0)) * 1024 * 1024;
  let usedBytes = Math.max(0, Number(manifest.monthlyUsage?.[month] || 0));
  const candidates = (await scanLargeBackupFiles(sourceRoot)).filter((file) => {
    const previous = manifest.files?.[file.relative];
    return !previous || previous.size !== file.size || previous.mtimeMs !== file.mtimeMs;
  });
  const task = {
    id: `large-backup-${Date.now()}`,
    state: "running",
    sourceRoot,
    startedAt: new Date().toISOString(),
    totalFiles: candidates.length,
    completedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    uploadedBytes: 0,
    monthlyUsedBytes: usedBytes,
    monthlyLimitBytes: limitBytes,
    percent: candidates.length ? 0 : 100,
    message: candidates.length ? "正在增量备份方案文件" : "没有需要上传的新文件"
  };
  largeCloudBackupTask = task;
  manifest.files ||= {};
  manifest.monthlyUsage ||= {};
  let consecutiveFailures = 0;

  for (const file of candidates) {
    if (limitBytes === 0 || usedBytes + file.size > limitBytes) {
      task.skippedFiles += 1;
      continue;
    }
    try {
      await uploadFile(config, file.path, `方案增量/${file.relative}`);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      task.failedFiles += 1;
      task.skippedFiles += 1;
      task.lastFailedFile = file.relative;
      task.message = `有文件无法上传，已跳过并继续：${file.relative}`;
      manifest.lastTask = { ...task };
      writeJson(CLOUD_LARGE_BACKUP_MANIFEST_FILE, manifest);
      if (consecutiveFailures >= 3) {
        throw new Error(`连续 3 个文件上传失败，最后文件：${file.relative}；${error.message || "上传失败"}`);
      }
      continue;
    }
    usedBytes += file.size;
    task.completedFiles += 1;
    task.uploadedBytes += file.size;
    task.monthlyUsedBytes = usedBytes;
    task.percent = Math.round(((task.completedFiles + task.skippedFiles) / Math.max(1, candidates.length)) * 100);
    task.message = `已上传 ${task.completedFiles}/${candidates.length} 个文件`;
    manifest.files[file.relative] = {
      size: file.size,
      mtimeMs: file.mtimeMs,
      backedUpAt: new Date().toISOString()
    };
    manifest.monthlyUsage[month] = usedBytes;
    manifest.lastTask = { ...task };
    writeJson(CLOUD_LARGE_BACKUP_MANIFEST_FILE, manifest);
  }

  task.state = "completed";
  task.finishedAt = new Date().toISOString();
  task.percent = 100;
  task.message = task.skippedFiles
    ? `本月额度内上传 ${task.completedFiles} 个，${task.skippedFiles} 个跳过或留待下月`
    : `增量备份完成，共上传 ${task.completedFiles} 个文件`;
  manifest.monthlyUsage[month] = usedBytes;
  manifest.lastTask = { ...task };
  writeJson(CLOUD_LARGE_BACKUP_MANIFEST_FILE, manifest);
  return task;
}

function startLargeCloudBackup() {
  if (largeCloudBackupTask?.state === "running") return largeCloudBackupTask;
  const task = {
    id: `large-backup-${Date.now()}`,
    state: "starting",
    startedAt: new Date().toISOString(),
    percent: 0,
    message: "正在检查方案文件"
  };
  largeCloudBackupTask = task;
  setImmediate(async () => {
    try {
      await executeLargeCloudBackup();
    } catch (error) {
      const current = largeCloudBackupTask || task;
      largeCloudBackupTask = {
        ...current,
        state: "failed",
        finishedAt: new Date().toISOString(),
        message: error.message || "大文件备份失败"
      };
      const manifest = readJson(CLOUD_LARGE_BACKUP_MANIFEST_FILE, {
        schema: "teambuilding-large-backup-v1",
        files: {},
        monthlyUsage: {}
      });
      manifest.lastTask = { ...largeCloudBackupTask };
      writeJson(CLOUD_LARGE_BACKUP_MANIFEST_FILE, manifest);
    }
  });
  return task;
}

function cloudBackupIsDue(now = Date.now()) {
  const settings = getPageSettings().backup || {};
  if (settings.scheduleEnabled === false) return false;
  const metadata = readJson(CLOUD_BACKUP_META_FILE, {});
  const last = Date.parse(metadata.lastBackupAt || "");
  if (!Number.isFinite(last)) return true;
  return now - last >= Math.max(1, Number(settings.intervalHours || 24)) * 60 * 60 * 1000;
}

async function runScheduledCloudBackup() {
  if (!cloudBackupIsDue()) return;
  try {
    await runCloudBackupNow();
    if (getPageSettings().backup?.sourceRoot) startLargeCloudBackup();
  } catch (error) {
    const metadata = readJson(CLOUD_BACKUP_META_FILE, {});
    writeJson(CLOUD_BACKUP_META_FILE, {
      ...metadata,
      lastAttemptAt: new Date().toISOString(),
      lastResult: `自动备份未完成：${error.message}`
    });
  }
}

function syncHistoricalDedupLedger() {
  const settings = getWorkspaceSettings();
  return syncDedupLedger({
    ledgerFile: DEDUP_LEDGER_FILE,
    libraryRoot: settings.workPackage.libraryPath,
    downloadRoot: DOWNLOAD_ROOT,
    publishRoot: PUBLISH_ROOT
  });
}

function getDedupLedger() {
  if (!fs.existsSync(DEDUP_LEDGER_FILE)) return syncHistoricalDedupLedger();
  return readJson(DEDUP_LEDGER_FILE, {
    version: 1,
    updatedAt: "",
    localOnly: true,
    downloads: [],
    distributions: [],
    archives: [],
    imports: []
  });
}

function publicDedupStatus(ledger = getDedupLedger()) {
  const settings = getWorkspaceSettings();
  const historyFile = path.join(
    settings.workPackage.libraryPath,
    "_作品历史数据",
    "作品历史数据库.json"
  );
  return {
    ...ledgerStatus(ledger),
    production: productionHistoryStatus(historyFile),
    ledgerPath: DEDUP_LEDGER_FILE,
    dataRoot: path.dirname(DEDUP_LEDGER_FILE),
    localOnly: true,
    rules: {
      production: "整组图片 SHA-256 精确去重；64 位 dHash 只做视觉近似预警",
      downloads: "旧文案 SHA-256 仅作兼容提示，不再作为作品重复的主判据",
      mobile: "小红书与抖音同属手机组，任一平台使用后整组不可再分发",
      official: "公众号独立记录，只有人工确认上传完成才标记已使用"
    }
  };
}

function materialUsageKey(value) {
  return path.resolve(String(value || "")).toLowerCase();
}

function materialUsageFingerprint(entryPath) {
  const digests = safeList(entryPath)
    .filter((entry) => entry.isFile())
    .filter((entry) => imageExts.has(path.extname(entry.name).toLowerCase()) || textExts.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const filePath = path.join(entryPath, entry.name);
      return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    })
    .sort();
  if (!digests.length) return "";
  return crypto.createHash("sha256").update(digests.join("\u0000")).digest("hex");
}

function materialFolderSignature(entryPath) {
  const stat = fs.statSync(entryPath, { bigint: true });
  const birth = stat.birthtimeNs ?? BigInt(Math.round(Number(stat.birthtimeMs || 0) * 1_000_000));
  return `${stat.dev}:${stat.ino}:${birth}`;
}

function getMaterialHashCache(cacheFile = MATERIAL_HASH_CACHE_FILE) {
  return readJson(cacheFile, { version: 1, updatedAt: "", entries: {} });
}

function materialFolderHash(entryPath, options = {}) {
  const cacheFile = options.cacheFile || MATERIAL_HASH_CACHE_FILE;
  const cache = options.cache || getMaterialHashCache(cacheFile);
  const key = materialUsageKey(entryPath);
  const signature = materialFolderSignature(entryPath);
  const direct = cache.entries?.[key];
  if (direct?.signature === signature && direct?.hash) return { hash: direct.hash, cache, changed: false };
  // Directory identity stays stable after a same-volume rename and remains distinct
  // even when two folders contain identical files. Content dedup uses a separate hash.
  const hash = crypto.createHash("sha256").update(`tb-folder-v1\u0000${signature}`).digest("hex");
  cache.entries = { ...(cache.entries || {}), [key]: { entryPath, signature, hash, updatedAt: new Date().toISOString() } };
  cache.updatedAt = new Date().toISOString();
  return { hash, cache, changed: true };
}

function getMaterialMetadataLedger(ledgerFile = MATERIAL_METADATA_LEDGER_FILE) {
  return readJson(ledgerFile, { version: 1, updatedAt: "", entries: {}, events: [] });
}

function inferMaterialMainTag(categoryName, itemName, preview) {
  const haystack = `${categoryName || ""} ${itemName || ""} ${preview || ""}`.toLowerCase();
  const gameKeywords = ["团建游戏", "团建小游戏", "小团建游戏", "聚会游戏", "破冰游戏", "团队游戏", "室内团建游戏", "户外团建游戏"];
  const guideKeywords = ["合集", "攻略", "好去处", "周边游", "大集合", "爬山", "一句话攻略"];
  if (gameKeywords.some((keyword) => haystack.includes(keyword))) return "团建游戏";
  if (guideKeywords.some((keyword) => haystack.includes(keyword))) return "合集攻略";
  return "团建转化";
}

function inferMaterialUsageCountFromPath(entryPath = "", categoryName = "", options = {}) {
  const source = `${categoryName || ""} ${entryPath || ""}`;
  const numeric = source.match(/(?:已使用|已上传|已制作)\s*(\d+)\s*次/i);
  if (numeric) return Math.max(0, Number(numeric[1]) || 0);
  const chinese = source.match(/(?:已使用|已上传|已制作)\s*(一次|两次|二次|三次)/i)?.[1] || "";
  if (chinese) return { "一次": 1, "两次": 2, "二次": 2, "三次": 3 }[chinese] || 0;

  // Canonical physical archive layout: the first folder directly below the
  // configured material root is `0`, `1`, `2`, `3`, ... . Only that direct segment
  // is trusted, so numbers in a post title or date cannot become usage data.
  const archiveUsage = materialArchiveUsageFolder(entryPath, options.materialRoot);
  if (archiveUsage !== null) return archiveUsage;
  return 0;
}

function materialArchiveUsageFolder(entryPath = "", materialRoot = "") {
  const root = String(materialRoot || "").trim();
  if (!root || !entryPath) return null;
  const relative = path.relative(path.resolve(root), path.resolve(entryPath));
  const segments = relative.split(path.sep).filter(Boolean);
  const archiveFolder = segments[0] || "";
  return /^\d+$/.test(archiveFolder) ? Number(archiveFolder) : null;
}

function materialMetadataProfile(item, categoryName, options = {}) {
  const metadata = options.metadata || getMaterialMetadataLedger(options.ledgerFile);
  const hashResult = materialFolderHash(item.path, options);
  const saved = metadata.entries?.[hashResult.hash] || {};
  const automaticMainTag = inferMaterialMainTag(categoryName, item.name, item.preview);
  const automaticTags = inferMaterialTags(categoryName, item.name, item.preview);
  const materialRoot = options.materialRoot || getWorkspaceSettings().materialRoot;
  const archiveUsage = materialArchiveUsageFolder(item.path, materialRoot);
  const inferredUsage = inferMaterialUsageCountFromPath(item.path, categoryName, { materialRoot });
  const effectiveUsageCount = archiveUsage === null
    ? Math.max(0, Number(saved.usageCount || 0), inferredUsage)
    : archiveUsage;
  const businessGroups = inferWorkTagGroups({
    name: item.name,
    text: item.preview,
    tags: Array.from(new Set([...(automaticTags || []), ...(saved.tags || [])])),
    contentType: automaticMainTag === "团建游戏" ? "traffic" : automaticMainTag === "合集攻略" ? "guide" : "conversion"
  });
  return {
    folderHash: hashResult.hash,
    mainTag: MATERIAL_MAIN_TAGS.includes(saved.mainTag) ? saved.mainTag : automaticMainTag,
    mainTagSource: MATERIAL_MAIN_TAGS.includes(saved.mainTag) ? "manual" : "automatic",
    tags: Array.from(new Set([...(automaticTags || []), ...(saved.tags || [])])),
    tagGroups: { ...businessGroups, ...deriveSystemTagGroups({ imageCount: item.imageCount, textCount: item.textCount, usageCount: effectiveUsageCount, workflowStage: "material" }) },
    usageCount: effectiveUsageCount,
    lifecycleState: normalizeLifecycleState(saved.lifecycleState),
    operationalStatus: normalizeOperationalStatus(saved.operationalStatus),
    conflicts: uniqueConflicts(saved.conflicts),
    contentFingerprint: String(saved.contentFingerprint || ""),
    lock: saved.lock || null,
    updatedAt: saved.updatedAt || "",
    hashCache: hashResult.cache,
    hashCacheChanged: hashResult.changed
  };
}

function updateMaterialMetadata(body = {}, options = {}) {
  const ledgerFile = options.ledgerFile || MATERIAL_METADATA_LEDGER_FILE;
  const cacheFile = options.cacheFile || MATERIAL_HASH_CACHE_FILE;
  const indexFile = options.indexFile
    || (options.ledgerFile ? path.join(path.dirname(ledgerFile), "material-global-index.json") : MATERIAL_GLOBAL_INDEX_FILE);
  const materialRoot = path.resolve(options.materialRoot || getWorkspaceSettings().materialRoot);
  const entryPath = path.resolve(String(body.entryPath || "").trim());
  if (!String(body.entryPath || "").trim() || !isPathInside(materialRoot, entryPath) || !exists(entryPath)) {
    throw new Error("只能更新当前素材库中真实存在的素材");
  }
  const materialFiles = safeList(entryPath).filter((entry) => entry.isFile());
  const hasImage = materialFiles.some((entry) => imageExts.has(path.extname(entry.name).toLowerCase()));
  const hasText = materialFiles.some((entry) => textExts.has(path.extname(entry.name).toLowerCase()));
  if (!hasImage || !hasText) throw new Error("只能更新同时包含图片和文案的素材文件夹");
  const hashResult = materialFolderHash(entryPath, { cacheFile });
  const requestedFolderHash = String(body.folderHash || "").trim();
  if (requestedFolderHash && requestedFolderHash !== hashResult.hash) {
    throw new Error("素材文件夹已经变化，请刷新列表后再操作");
  }
  if (hashResult.changed) writeJson(cacheFile, hashResult.cache);
  const ledger = getMaterialMetadataLedger(ledgerFile);
  const previous = ledger.entries?.[hashResult.hash] || {};
  const requestedMainTag = String(body.mainTag || "").trim();
  if (requestedMainTag && requestedMainTag !== "自动" && !MATERIAL_MAIN_TAGS.includes(requestedMainTag)) {
    throw new Error("主标签只能是团建游戏、团建转化或合集攻略");
  }
  const tags = Array.isArray(body.tags)
    ? body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 30)
    : (previous.tags || []);
  const physicalUsageCount = inferMaterialUsageCountFromPath(entryPath, "", { materialRoot });
  const archiveUsage = materialArchiveUsageFolder(entryPath, materialRoot);
  const usageCount = body.incrementUsage === true
    // 目录移动后物理数字可能暂时回到 0；账本里的同一 folderHash
    // 才是连续使用次数的真源，避免“用过一次→移动→再次使用”被重置。
    ? Math.max(physicalUsageCount, Number(previous.usageCount || 0)) + 1
    : archiveUsage === null
      ? Math.max(0, Number(body.usageCount ?? previous.usageCount ?? 0))
      : archiveUsage;
  const now = new Date().toISOString();
  const record = {
    ...previous,
    folderHash: hashResult.hash,
    entryPath,
    name: String(body.name || path.basename(entryPath)),
    mainTag: requestedMainTag === "自动" ? "" : (requestedMainTag || previous.mainTag || ""),
    tags: Array.from(new Set(tags)),
    usageCount,
    updatedAt: now
  };
  ledger.entries = { ...(ledger.entries || {}), [hashResult.hash]: record };
  ledger.events = [...(ledger.events || []), {
    folderHash: hashResult.hash,
    entryPath,
    action: body.incrementUsage === true ? "increment-usage" : "update-tags",
    mainTag: record.mainTag,
    usageCount,
    recordedAt: now
  }].slice(-3000);
  ledger.updatedAt = now;
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  writeJson(ledgerFile, ledger);
  patchMaterialGlobalIndexMetadata(entryPath, record, indexFile);
  return record;
}

function patchMaterialGlobalIndexMetadata(entryPath, record, indexFile = MATERIAL_GLOBAL_INDEX_FILE) {
  const snapshot = readJson(indexFile, null);
  if (!snapshot?.items?.length) return false;
  const item = snapshot.items.find((candidate) => materialUsageKey(candidate.path) === materialUsageKey(entryPath));
  if (!item) return false;
  item.mainTag = MATERIAL_MAIN_TAGS.includes(record.mainTag)
    ? record.mainTag
    : inferMaterialMainTag(item.categoryName, item.name, "");
  item.mainTagSource = MATERIAL_MAIN_TAGS.includes(record.mainTag) ? "manual" : "automatic";
  item.tags = Array.from(new Set([...(item.tags || []), ...(record.tags || [])]));
  item.usageCount = Math.max(0, Number(record.usageCount || 0));
  item.usageSource = record.usageSource || (item.usageCount ? "扩展实时记录" : "暂无使用证据");
  item.lifecycleState = normalizeLifecycleState(record.lifecycleState);
  item.operationalStatus = normalizeOperationalStatus(record.operationalStatus);
  item.conflicts = uniqueConflicts(record.conflicts);
  item.contentFingerprint = String(record.contentFingerprint || item.contentFingerprint || "");
  item.lock = record.lock || null;
  snapshot.stats = materialIndexStats(snapshot.items, snapshot.review || []);
  snapshot.metadataUpdatedAt = new Date().toISOString();
  writeJson(indexFile, snapshot);
  return true;
}

function getMaterialUsageLedger(ledgerFile = MATERIAL_USAGE_LEDGER_FILE) {
  return readJson(ledgerFile, {
    version: 1,
    updatedAt: "",
    entries: {},
    events: []
  });
}

function recordMaterialUsage(body = {}, options = {}) {
  const ledgerFile = options.ledgerFile || MATERIAL_USAGE_LEDGER_FILE;
  const metadataLedgerFile = options.metadataLedgerFile
    || (options.ledgerFile ? path.join(path.dirname(ledgerFile), "material-metadata-ledger.json") : MATERIAL_METADATA_LEDGER_FILE);
  const hashCacheFile = options.hashCacheFile
    || (options.ledgerFile ? path.join(path.dirname(ledgerFile), "material-hash-cache.json") : MATERIAL_HASH_CACHE_FILE);
  const materialRoot = path.resolve(options.materialRoot || getWorkspaceSettings().materialRoot);
  const entryPath = path.resolve(String(body.entryPath || "").trim());
  if (!String(body.entryPath || "").trim() || !isPathInside(materialRoot, entryPath) || !exists(entryPath)) {
    throw new Error("只能记录当前素材库中真实存在的素材");
  }
  const status = body.status === "used" ? "used" : "prepared";
  const now = new Date().toISOString();
  const ledger = getMaterialUsageLedger(ledgerFile);
  const key = materialUsageKey(entryPath);
  const fingerprint = materialUsageFingerprint(entryPath);
  const fingerprintMatch = fingerprint
    ? Object.values(ledger.entries || {}).find((entry) => entry.fingerprint === fingerprint) || null
    : null;
  const previous = ledger.entries?.[key] || fingerprintMatch || {};
  const record = {
    ...previous,
    entryPath,
    name: String(body.name || path.basename(entryPath)),
    status: previous.status === "used" ? "used" : status,
    preparedAt: previous.preparedAt || now,
    usedAt: status === "used" ? now : (previous.usedAt || ""),
    conversationUrl: String(body.conversationUrl || previous.conversationUrl || ""),
    fingerprint: fingerprint || previous.fingerprint || "",
    updatedAt: now
  };
  ledger.entries = { ...(ledger.entries || {}), [key]: record };
  ledger.events = [...(ledger.events || []), {
    entryPath,
    status,
    conversationUrl: record.conversationUrl,
    recordedAt: now
  }].slice(-2000);
  ledger.updatedAt = now;
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  writeJson(ledgerFile, ledger);
  if (status === "used" && options.skipMetadataIncrement !== true) {
    try {
      updateMaterialMetadata({
        entryPath,
        name: record.name,
        incrementUsage: true
      }, {
        materialRoot,
        ledgerFile: metadataLedgerFile,
        cacheFile: hashCacheFile
      });
    } catch (error) {
      // Historical ledgers may contain image-only folders. Keep their usage
      // history valid while reserving the richer metadata ledger for real
      // image + copy material folders.
      if (!/同时包含图片和文案/.test(String(error?.message || ""))) throw error;
    }
  }
  return record;
}

function checkMaterialUsage(body = {}, options = {}) {
  const ledgerFile = options.ledgerFile || MATERIAL_USAGE_LEDGER_FILE;
  const materialRoot = path.resolve(options.materialRoot || getWorkspaceSettings().materialRoot);
  const entryPath = path.resolve(String(body.entryPath || "").trim());
  if (!String(body.entryPath || "").trim() || !isPathInside(materialRoot, entryPath) || !exists(entryPath)) {
    throw new Error("只能检查当前素材库中真实存在的素材");
  }
  const ledger = getMaterialUsageLedger(ledgerFile);
  const direct = ledger.entries?.[materialUsageKey(entryPath)] || null;
  const fingerprint = materialUsageFingerprint(entryPath);
  const matched = direct || (fingerprint
    ? Object.values(ledger.entries || {}).find((entry) => entry.fingerprint === fingerprint) || null
    : null);
  return {
    duplicate: matched?.status === "used",
    status: matched?.status || "unused",
    match: direct ? "path" : matched ? "fingerprint" : "",
    fingerprint,
    record: matched
  };
}

function moveWorkspaceEntry(body = {}, options = {}) {
  const sourceInput = String(body.sourcePath || "").trim();
  const targetInput = String(body.targetPath || "").trim();
  if (!sourceInput || !targetInput) throw new Error("需要提供要移动的文件夹和目标文件夹");
  const roots = (options.roots || (() => {
    const settings = getWorkspaceSettings();
    return [settings.materialRoot, settings.workPackage?.libraryPath];
  })()).filter(Boolean).map((root) => path.resolve(root));
  const sourcePath = path.resolve(sourceInput);
  const targetPath = path.resolve(targetInput);
  const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
  const sourceRoot = roots.find((item) => isPathInside(item, sourcePath));
  const targetRoot = roots.find((item) => isPathInside(item, targetPath));
  if (sourceRoot && samePath(sourcePath, sourceRoot)) throw new Error("不能移动素材库或成品库根目录");
  if (!sourceRoot || !targetRoot || !samePath(sourceRoot, targetRoot)) {
    throw new Error("只能在同一个素材库或成品库内部移动");
  }
  if (!exists(sourcePath)) throw new Error("要移动的文件夹不存在");
  const sourceStat = fs.lstatSync(sourcePath);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error("只能移动真实文件夹，不能移动文件或软链接");
  if (!exists(targetPath)) throw new Error("目标必须是已存在的文件夹");
  const targetStat = fs.lstatSync(targetPath);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error("目标必须是已存在的真实文件夹");
  const realRoot = fs.realpathSync.native(sourceRoot);
  const realSource = fs.realpathSync.native(sourcePath);
  const realTarget = fs.realpathSync.native(targetPath);
  if (!isPathInside(realRoot, realSource) || !isPathInside(realRoot, realTarget)) {
    throw new Error("文件夹真实位置超出当前素材库或成品库");
  }
  if (samePath(sourcePath, targetPath) || isPathInside(sourcePath, targetPath)) {
    throw new Error("不能把文件夹移动到它自己或它的子文件夹里");
  }
  if (samePath(path.dirname(sourcePath), targetPath)) throw new Error("已经在这个文件夹里了");
  const destination = path.join(targetPath, path.basename(sourcePath));
  if (exists(destination)) throw new Error(`目标文件夹里已存在同名项：${path.basename(sourcePath)}`);
  fs.renameSync(sourcePath, destination);
  materialCategoryCache.clear();
  materialPostCache = null;
  materialLibraryCache = null;
  if (!options.roots) setImmediate(() => queueMaterialGlobalIndexRefresh({ force: true }));
  return { from: sourcePath, to: destination };
}

function gptQuotaSnapshot(accountId = "", now = Date.now()) {
  const ledger = normalizeQuotaLedger(readJson(GPT_QUOTA_LEDGER_FILE, {}));
  const pageAccounts = getPageSettings().gptAuto?.accounts || [];
  for (const accountSettings of pageAccounts) {
    if (!isContentAccountAssigned(accountSettings.id)) continue;
    const account = ledger.accounts[accountSettings.id] || { events: [] };
    account.settings = {
      enabled: getPageSettings().gptAuto?.quotaReminderEnabled !== false,
      windowHours: accountSettings.windowHours,
      uploadLimit: accountSettings.uploadLimit,
      generationLimit: accountSettings.generationLimit
    };
    ledger.accounts[accountSettings.id] = account;
  }
  if (accountId) {
    const normalizedAccountId = assertContentAccount(accountId, { required: true });
    const account = ledger.accounts[normalizedAccountId] || { settings: {}, events: [] };
    return { accountId: normalizedAccountId, ...rollingQuotaStatus(account, now) };
  }
  return {
    generatedAt: new Date(now).toISOString(),
    accounts: Object.fromEntries(Object.entries(ledger.accounts)
      .filter(([id]) => isContentAccountAssigned(id)).map(([id, account]) => [
      id,
      { accountId: id, ...rollingQuotaStatus(account, now) }
    ]))
  };
}

function appendGptQuotaEvent(body = {}) {
  const accountId = assertContentAccount(body.accountId, { required: true });
  const ledger = recordQuotaEvent(readJson(GPT_QUOTA_LEDGER_FILE, {}), accountId, {
    kind: body.kind,
    count: body.count,
    requestId: body.requestId
  });
  const settings = getPageSettings().gptAuto?.accounts?.find((account) => account.id === accountId);
  if (settings) {
    ledger.accounts[accountId].settings = {
      enabled: getPageSettings().gptAuto?.quotaReminderEnabled !== false,
      windowHours: settings.windowHours,
      uploadLimit: settings.uploadLimit,
      generationLimit: settings.generationLimit
    };
  }
  writeJson(GPT_QUOTA_LEDGER_FILE, ledger);
  return gptQuotaSnapshot(accountId);
}

function readGptProductionCheckpoint(requestId = "") {
  const safeId = String(requestId || "").trim();
  if (!safeId || safeId.length > 160) return null;
  const saved = readJson(GPT_PRODUCTION_CHECKPOINT_FILE, { version: 1, items: {} });
  const checkpoint = saved.items?.[safeId] || null;
  if (checkpoint && !isContentAccountAssigned(checkpoint.accountId || checkpoint.accountWindowId)) return null;
  return checkpoint;
}

function writeGptProductionCheckpoint(body = {}) {
  const requestId = String(body.requestId || "").trim();
  if (!requestId || requestId.length > 160) throw new Error("生产检查点编号无效");
  const source = body.checkpoint && typeof body.checkpoint === "object" ? body.checkpoint : {};
  const checkpointAccountId = assertContentAccount(
    source.accountId || source.accountWindowId,
    { required: ASSIGNED_ACCOUNT_IDS.size > 0 }
  );
  const checkpoint = {
    requestId,
    stage: String(source.stage || "").slice(0, 80),
    percent: Math.max(0, Math.min(100, Number(source.percent || 0))),
    // ── 状态机字段（V1.0 设计说明书） ──
    taskState: String(source.taskState || "").slice(0, 40),
    conversationUrl: String(source.conversationUrl || "").slice(0, 1000),
    sourceMaterialPath: String(source.sourceMaterialPath || "").slice(0, 4000),
    materialHash: String(source.materialHash || "").slice(0, 128),
    templateId: String(source.templateId || "").slice(0, 80),
    productionMode: String(source.productionMode || "").slice(0, 40),
    workflowVariant: String(source.workflowVariant || "legacy-v1").slice(0, 40),
    workflowVariantVersion: String(source.workflowVariantVersion || "").slice(0, 40),
    experimentId: String(source.experimentId || "").slice(0, 80),
    sessionPolicy: String(source.sessionPolicy || "reuse-conversation").slice(0, 80),
    templateConversationUrl: String(source.templateConversationUrl || "").slice(0, 1000),
    workflowProfileId: String(source.workflowProfileId || "").slice(0, 80),
    accountWindowId: String(source.accountWindowId || "").slice(0, 80),
    accountId: checkpointAccountId || String(source.accountId || source.accountWindowId || "").slice(0, 80),
    attachmentCount: Math.max(0, Math.min(99, Number(source.attachmentCount || 0))),
    promptHash: String(source.promptHash || "").slice(0, 128),
    // ── 计划与确认字段 ──
    plannedImageCount: Math.max(0, Math.min(10, Number(source.plannedImageCount || 0))),
    totalPlannedPages: Math.max(0, Math.min(10, Number(source.totalPlannedPages || 0))),
    batchExpectedPages: Math.max(0, Math.min(10, Number(source.batchExpectedPages || 0))),
    planText: String(source.planText || "").slice(0, 10_000),
    planSubmitted: Boolean(source.planSubmitted),
    confirmSentAt: String(source.confirmSentAt || "").slice(0, 40),
    confirmRetried: Boolean(source.confirmRetried),
    confirmTurnKey: String(source.confirmTurnKey || "").slice(0, 160),
    beforeImagesCount: Math.max(0, Math.min(500, Number(source.beforeImagesCount || 0))),
    beforeImageAssistantKeys: Array.isArray(source.beforeImageAssistantKeys)
      ? source.beforeImageAssistantKeys.map((item) => String(item || "").slice(0, 160)).filter(Boolean).slice(0, 500)
      : [],
    // ── 图片字段 ──
    imageSubmitted: Boolean(source.imageSubmitted),
    detectedImageCount: Math.max(0, Math.min(30, Number(source.detectedImageCount || 0))),
    generatedImageUrls: Array.isArray(source.generatedImageUrls)
      ? source.generatedImageUrls.map((item) => String(item || "").slice(0, 4000)).filter(Boolean).slice(0, 30)
      : [],
    generatedBaselineUrls: Array.isArray(source.generatedBaselineUrls)
      ? source.generatedBaselineUrls.map((item) => String(item || "").slice(0, 4000)).filter(Boolean).slice(0, 30)
      : [],
    generatedImageActualCount: Math.max(0, Math.min(30, Number(source.generatedImageActualCount || 0))),
    generatedImageDetection: source.generatedImageDetection && typeof source.generatedImageDetection === "object" ? {
      confident: source.generatedImageDetection.confident === true,
      evidence: String(source.generatedImageDetection.evidence || "").slice(0, 120),
      detectedAt: String(source.generatedImageDetection.detectedAt || "").slice(0, 40),
      turnKey: String(source.generatedImageDetection.turnKey || "").slice(0, 160),
      declaredCount: Math.max(0, Math.min(30, Number(source.generatedImageDetection.declaredCount || 0)))
    } : null,
    imageRecoveryAttempts: Math.max(0, Math.min(20, Math.floor(Number(source.imageRecoveryAttempts || 0)))),
    imageRecoveryLastSignature: String(source.imageRecoveryLastSignature || "").slice(0, 16_000),
    recoveryBoundaryConfirmed: source.recoveryBoundaryConfirmed === true,
    imageGenerationDetectedAt: String(source.imageGenerationDetectedAt || "").slice(0, 40),
    firstImageReadyAt: String(source.firstImageReadyAt || "").slice(0, 40),
    lastImageReadyAt: String(source.lastImageReadyAt || "").slice(0, 40),
    // ── 文案字段 ──
    textSubmitted: Boolean(source.textSubmitted),
    copyText: String(source.copyText || "").slice(0, 200_000),
    copyTextPath: String(source.copyTextPath || "").slice(0, 2000),
    copyRecoveryAttempts: Math.max(0, Math.min(20, Math.floor(Number(source.copyRecoveryAttempts || 0)))),
    copyRecoveryExhausted: source.copyRecoveryExhausted === true,
    // 每步有限等待与历史计时，供重启后诊断卡点；旧检查点没有这些字段时保持兼容。
    metricsStartedAt: String(source.metricsStartedAt || "").slice(0, 40),
    stageHistory: Array.isArray(source.stageHistory) ? source.stageHistory.slice(-64).map((item) => ({
      stage: String(item?.stage || "").slice(0, 120),
      status: String(item?.status || "").slice(0, 40),
      startedAt: String(item?.startedAt || "").slice(0, 40),
      endedAt: String(item?.endedAt || "").slice(0, 40),
      durationMs: Math.max(0, Number(item?.durationMs || 0)),
      deadlineAt: String(item?.deadlineAt || "").slice(0, 40),
      waitLimitMs: Math.max(0, Number(item?.waitLimitMs || 0)),
      attempt: Math.max(0, Math.min(99, Math.floor(Number(item?.attempt || 0))))
    })) : [],
    workflowStepHistory: Array.isArray(source.workflowStepHistory) ? source.workflowStepHistory.slice(-64).map((item) => ({
      action: String(item?.action || "").slice(0, 80),
      status: String(item?.status || "").slice(0, 40),
      attempt: Math.max(0, Math.min(99, Math.floor(Number(item?.attempt || 0)))),
      startedAt: String(item?.startedAt || "").slice(0, 40),
      endedAt: String(item?.endedAt || "").slice(0, 40),
      elapsedMs: Math.max(0, Number(item?.elapsedMs || 0)),
      timeoutMs: Math.max(0, Number(item?.timeoutMs || 0)),
      deadlineAt: String(item?.deadlineAt || "").slice(0, 40),
      timeoutTriggered: item?.timeoutTriggered === true
    })) : [],
    workflowStepAttempts: source.workflowStepAttempts && typeof source.workflowStepAttempts === "object"
      ? Object.fromEntries(Object.entries(source.workflowStepAttempts).slice(0, 64).map(([key, value]) => [
        String(key).slice(0, 80),
        Math.max(0, Math.min(99, Math.floor(Number(value || 0))))
      ]))
      : {},
    workflowStartedAt: String(source.workflowStartedAt || "").slice(0, 40),
    workflowDeadlineAt: String(source.workflowDeadlineAt || "").slice(0, 40),
    workflowTimeoutMs: Math.max(0, Number(source.workflowTimeoutMs || 0)),
    stepTiming: source.stepTiming && typeof source.stepTiming === "object" ? {
      action: String(source.stepTiming.action || "").slice(0, 80),
      status: String(source.stepTiming.status || "").slice(0, 40),
      attempt: Math.max(0, Math.min(99, Math.floor(Number(source.stepTiming.attempt || 0)))),
      startedAt: String(source.stepTiming.startedAt || "").slice(0, 40),
      endedAt: String(source.stepTiming.endedAt || "").slice(0, 40),
      elapsedMs: Math.max(0, Number(source.stepTiming.elapsedMs || 0)),
      timeoutMs: Math.max(0, Number(source.stepTiming.timeoutMs || 0)),
      deadlineAt: String(source.stepTiming.deadlineAt || "").slice(0, 40),
      timeoutTriggered: source.stepTiming.timeoutTriggered === true
    } : null,
    // ── 下载与打包字段 ──
    batchId: String(source.batchId || "").slice(0, 80),
    downloadRoot: String(source.downloadRoot || "").slice(0, 2000),
    downloadedFiles: Array.isArray(source.downloadedFiles)
      ? source.downloadedFiles.map((item) => String(item || "").slice(0, 2000)).filter(Boolean).slice(0, 30)
      : [],
    packagePath: String(source.packagePath || "").slice(0, 2000),
    // ── 限额与恢复字段 ──
    quotaDetectedAt: String(source.quotaDetectedAt || "").slice(0, 40),
    nextProbeAt: String(source.nextProbeAt || "").slice(0, 40),
    // ── 归档字段 ──
    usageUpdated: Boolean(source.usageUpdated),
    ...normalizeEvidenceSnapshot(source),
    updatedAt: new Date().toISOString()
  };
  const saved = readJson(GPT_PRODUCTION_CHECKPOINT_FILE, { version: 1, items: {} });
  saved.version = 1;
  saved.items ||= {};
  saved.items[requestId] = checkpoint;
  const ordered = Object.values(saved.items).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 200);
  saved.items = Object.fromEntries(ordered.map((item) => [item.requestId, item]));
  saved.updatedAt = checkpoint.updatedAt;
  writeJson(GPT_PRODUCTION_CHECKPOINT_FILE, saved);
  return checkpoint;
}

function findRecoverableImageBatch(body = {}) {
  const expected = Math.max(1, Math.min(30, Number(body.expectedImageCount || 0)));
  const requestedRoot = String(body.downloadRoot || "").trim();
  const configuredRoot = String(readJson(WORKPKG_CONFIG_FILE, {}).image_inbox_path || "").trim();
  const authorizedRequestedRoot = resolveAuthorizedDownloadRoot(requestedRoot, {
    defaultRoot: DOWNLOAD_ROOT,
    configuredRoot
  });
  const roots = [...new Set([authorizedRequestedRoot, path.resolve(DOWNLOAD_ROOT)].filter(Boolean))]
    .filter((item) => exists(item) && fs.statSync(item).isDirectory());
  const groups = new Map();
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^chatgpt-workpkg-(\d{8}-\d{6}-[a-z0-9]{4})-(\d+)-of-(\d+)\.(?:png|jpe?g|webp)$/i);
      if (!match || Number(match[3]) !== expected) continue;
      const filePath = path.join(root, entry.name);
      const stat = fs.statSync(filePath);
      if (stat.size < 1_000) continue;
      const key = `${root}\0${match[1]}`;
      const group = groups.get(key) || { batchId: match[1], downloadRoot: root, files: [], newestMs: 0 };
      group.files.push({ index: Number(match[2]), path: filePath });
      group.newestMs = Math.max(group.newestMs, stat.mtimeMs);
      groups.set(key, group);
    }
  }
  const complete = [...groups.values()].filter((group) => {
    const indexes = [...new Set(group.files.map((file) => file.index))].sort((a, b) => a - b);
    return indexes.length === expected && indexes.every((value, index) => value === index + 1);
  }).sort((a, b) => b.newestMs - a.newestMs)[0];
  if (!complete) return null;
  return {
    count: expected,
    batchId: complete.batchId,
    downloadRoot: complete.downloadRoot,
    files: complete.files.sort((a, b) => a.index - b.index).map((file) => file.path),
    recoveredAt: new Date().toISOString()
  };
}

function safeArchiveDestination(targetRoot, sourcePath, fingerprint) {
  const baseName = path.basename(sourcePath);
  let destination = path.join(targetRoot, baseName);
  if (!exists(destination)) return destination;
  const suffix = String(fingerprint || crypto.createHash("sha256").update(sourcePath).digest("hex")).slice(0, 8);
  destination = path.join(targetRoot, `${baseName}（${suffix}）`);
  if (exists(destination)) throw new Error(`归档目录已存在同名素材：${path.basename(destination)}`);
  return destination;
}

function materialUsageDirectoryName(usageCount) {
  const count = Math.max(1, Number(usageCount) || 1);
  return String(count);
}

function archiveMaterialAfterProductionUnlocked(body = {}, options = {}) {
  const settings = options.settings || getWorkspaceSettings();
  const materialRoot = path.resolve(settings.materialRoot);
  const metadataFile = options.metadataLedgerFile || MATERIAL_METADATA_LEDGER_FILE;
  const usageFile = options.usageLedgerFile || MATERIAL_USAGE_LEDGER_FILE;
  const hashFile = options.hashCacheFile || MATERIAL_HASH_CACHE_FILE;
  const indexFile = options.indexFile || MATERIAL_GLOBAL_INDEX_FILE;
  const lifecycleFile = options.lifecycleLedgerFile || MATERIAL_LIFECYCLE_LEDGER_FILE;
  const archiveLogFile = options.archiveLogFile || GPT_PRODUCTION_ARCHIVE_LOG_FILE;
  const lifecycle = getMaterialLifecycleLedger(lifecycleFile);
  const sourceInput = String(body.entryPath || "").trim();
  if (!sourceInput) throw new Error("缺少要归档的素材文件夹");
  const sourcePath = path.resolve(sourceInput);
  const packageInput = String(body.packagePath || "").trim();
  const libraryRoot = path.resolve(settings.workPackage?.libraryPath || "");
  const packagePath = packageInput ? path.resolve(packageInput) : "";
  const requestedEventKey = String(body.archiveEventKey || "").trim();
  const requestId = String(body.requestId || "").trim();
  const sourceName = path.basename(sourcePath).toLowerCase();
  // A renderer/browser rebuild can replay the same archive callback with a
  // different packagePath (the late callback commonly has it empty). The
  // request itself is the stronger idempotency boundary than that incidental
  // field. Match the material name too so a malformed reused request id can
  // never suppress a different source folder.
  const requestAlreadyArchived = requestId
    ? Object.values(lifecycle.entries || {}).find((entry) => {
      const result = entry?.archiveResult;
      return result
        && String(result.requestId || "").trim() === requestId
        && path.basename(String(result.sourceMaterialPath || result.from || "")).toLowerCase() === sourceName;
    })
    : null;
  if (requestAlreadyArchived?.archiveResult) {
    return { ...requestAlreadyArchived.archiveResult, idempotent: true, reason: "request-already-archived" };
  }
  const knownEvent = Object.values(lifecycle.entries || {}).find((entry) => {
    const key = archiveEventKey({
      archiveEventKey: requestedEventKey,
      folderHash: entry.folderHash,
      entryPath: sourcePath,
      requestId: body.requestId,
      packagePath: body.packagePath
    });
    return hasArchiveEvent(entry, key);
  });
  if (knownEvent?.archiveResult) {
    return { ...knownEvent.archiveResult, idempotent: true };
  }
  const packageVerified = Boolean(
    packagePath
      && libraryRoot
      && isPathInside(libraryRoot, packagePath)
      && exists(packagePath)
      && fs.statSync(packagePath).isDirectory()
  );
  if (!packageVerified) {
    const error = new Error("归档前必须先确认成品包路径存在；未验证成品包，不增加使用次数或移动素材");
    error.code = "MISSING_VERIFIED_PACKAGE";
    throw error;
  }
  if (!isPathInside(materialRoot, sourcePath) || sourcePath === materialRoot || !exists(sourcePath)) {
    // Packaging can be retried after the source folder was already moved by a
    // previous successful run or by an operator. If the verified work package
    // exists inside the configured library, the source move is already
    // idempotently complete; do not turn that into a blocking archive error.
    if (packageVerified) {
      if (knownEvent?.archiveResult) return { ...knownEvent.archiveResult, idempotent: true };
      return {
        skipped: true,
        reason: "source-material-missing-or-already-archived",
        sourceMaterialPath: sourcePath,
        packagePath,
        recordedAt: new Date().toISOString()
      };
    }
    throw new Error("只能归档当前素材库中的真实帖子文件夹");
  }
  const stat = fs.lstatSync(sourcePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("只能归档真实文件夹");
  const hashResult = materialFolderHash(sourcePath, { cacheFile: hashFile });
  const eventKey = archiveEventKey({
    archiveEventKey: requestedEventKey,
    folderHash: hashResult.hash,
    entryPath: sourcePath,
    requestId: body.requestId,
    packagePath: body.packagePath
  });
  const currentState = getMaterialLifecycleLedger(lifecycleFile).entries?.[hashResult.hash] || {};
  if (hasArchiveEvent(currentState, eventKey)) {
    return { ...(currentState.archiveResult || {}), idempotent: true, archiveEventKey: eventKey };
  }
  updateMaterialLifecycleFiles(sourcePath, hashResult.hash, {
    lifecycleState: "作品已完成待归档",
    operationalStatus: "正常",
    archiveEventKey: eventKey,
    updatedAt: new Date().toISOString()
  }, { lifecycleLedgerFile: lifecycleFile, metadataLedgerFile: metadataFile, hashCacheFile: hashFile, indexFile });
  let metadata;
  const usageAlreadyIncremented = currentState.archiveEventKey === eventKey && currentState.usageIncremented === true;
  if (usageAlreadyIncremented) {
    metadata = getMaterialMetadataLedger(metadataFile).entries?.[hashResult.hash] || currentState;
  } else {
    metadata = updateMaterialMetadata({
      entryPath: sourcePath,
      name: path.basename(sourcePath),
      incrementUsage: true
    }, { materialRoot, ledgerFile: metadataFile, cacheFile: hashFile, indexFile });
    updateMaterialLifecycleFiles(sourcePath, hashResult.hash, {
      lifecycleState: "作品已完成待归档",
      operationalStatus: "正常",
      archiveEventKey: eventKey,
      usageIncremented: true,
      usageCount: Math.max(1, Number(metadata.usageCount || 1)),
      updatedAt: new Date().toISOString()
    }, { lifecycleLedgerFile: lifecycleFile, metadataLedgerFile: metadataFile, hashCacheFile: hashFile, indexFile });
  }
  const usageCount = Math.max(1, Number(metadata.usageCount || currentState.usageCount || 1));
  const usageRecord = recordMaterialUsage({
    entryPath: sourcePath,
    name: path.basename(sourcePath),
    status: "used",
    conversationUrl: body.conversationUrl
  }, {
    skipMetadataIncrement: true,
    materialRoot,
    ledgerFile: usageFile,
    metadataLedgerFile: metadataFile,
    hashCacheFile: hashFile
  });
  const targetRoot = path.join(materialRoot, materialUsageDirectoryName(usageCount));
  fs.mkdirSync(targetRoot, { recursive: true });
  const destination = safeArchiveDestination(targetRoot, sourcePath, usageRecord.fingerprint);
  try {
    if (path.resolve(path.dirname(sourcePath)).toLowerCase() !== path.resolve(targetRoot).toLowerCase()) {
      fs.renameSync(sourcePath, destination);
    } else if (path.resolve(sourcePath).toLowerCase() !== path.resolve(destination).toLowerCase()) {
      fs.renameSync(sourcePath, destination);
    }
  } catch (error) {
    updateMaterialLifecycleFiles(sourcePath, hashResult.hash, {
      lifecycleState: "作品已完成待归档",
      operationalStatus: "失败待恢复",
      archiveEventKey: eventKey,
      usageIncremented: true,
      lastError: error.message || String(error),
      updatedAt: new Date().toISOString()
    }, { lifecycleLedgerFile: lifecycleFile, metadataLedgerFile: metadataFile, hashCacheFile: hashFile, indexFile });
    error.code ||= "MATERIAL_ARCHIVE_MOVE_FAILED";
    throw error;
  }
  const finalPath = exists(destination) ? destination : sourcePath;
  updateMaterialMetadata({
    entryPath: finalPath,
    name: path.basename(finalPath),
    usageCount
  }, { materialRoot, ledgerFile: metadataFile, cacheFile: hashFile, indexFile });
  if (packagePath && libraryRoot && isPathInside(libraryRoot, packagePath) && exists(packagePath)) {
    const packageRecordFile = path.join(packagePath, "GPT作品记录.json");
    if (exists(packageRecordFile) && fs.statSync(packageRecordFile).isFile()) {
      try {
        const packageRecord = readJson(packageRecordFile, {});
        packageRecord.sourceMaterialPath ||= sourcePath;
        packageRecord.sourceMaterialName ||= path.basename(sourcePath);
        packageRecord.sourceMaterialArchivePath = finalPath;
        packageRecord.sourceMaterialUpdatedAt = new Date().toISOString();
        writeJson(packageRecordFile, packageRecord);
      } catch {
        // Archiving remains successful; the package record can be repaired
        // later from the append-only archive event.
      }
    }
  }
  const event = {
    recordedAt: new Date().toISOString(),
    requestId: String(body.requestId || ""),
    templateId: String(body.templateId || ""),
    conversationUrl: String(body.conversationUrl || ""),
    packagePath: String(packagePath || ""),
    from: sourcePath,
    to: finalPath,
    sourceMaterialPath: sourcePath,
    sourceMaterialArchivePath: finalPath,
    usageCount,
    fingerprint: usageRecord.fingerprint,
    archiveEventKey: eventKey
  };
  fs.mkdirSync(path.dirname(archiveLogFile), { recursive: true });
  fs.appendFileSync(archiveLogFile, `${JSON.stringify(event)}\n`, "utf8");
  const completedState = getMaterialLifecycleLedger(lifecycleFile);
  const previousCompletedState = completedState.entries?.[hashResult.hash] || {};
  const completedRecord = appendArchiveEvent(previousCompletedState, eventKey, event.recordedAt);
  completedRecord.entryPath = finalPath;
  completedRecord.sourceMaterialPath = sourcePath;
  completedRecord.sourceMaterialArchivePath = finalPath;
  completedRecord.archiveResult = event;
  completedRecord.lifecycleState = "归档完成";
  completedRecord.operationalStatus = "正常";
  completedRecord.lock = null;
  completedRecord.usageIncremented = true;
  completedRecord.usageCount = usageCount;
  completedState.entries = { ...(completedState.entries || {}), [hashResult.hash]: completedRecord };
  completedState.events = [...(completedState.events || []), {
    folderHash: hashResult.hash,
    action: "archive-complete",
    archiveEventKey: eventKey,
    entryPath: finalPath,
    recordedAt: event.recordedAt
  }].slice(-4000);
  writeMaterialLifecycleLedger(completedState, lifecycleFile);
  if (exists(finalPath)) writeMaterialTagDocument(finalPath, lifecycleTagsForEntry(finalPath, completedRecord));
  materialCategoryCache.clear();
  materialPostCache = null;
  materialLibraryCache = null;
  if (options.refreshIndex !== false) {
    setImmediate(() => queueMaterialGlobalIndexRefresh({
      force: true,
      materialRoot,
      ledgerFile: metadataFile,
      cacheFile: hashFile,
      indexFile
    }));
  }
  return event;
}

function extensionProductSnapshot(collectionName = "") {
  const settings = getWorkspaceSettings();
  const distribution = getDistributionSnapshot({
    publishRoot: PUBLISH_ROOT,
    libraryRoot: settings.workPackage.libraryPath
  });
  const collections = (distribution.collections || []).map((collection) => ({
    name: collection.name,
    path: collection.sourcePath,
    type: collection.type,
    typeLabel: collection.typeLabel,
    itemCount: collection.itemCount,
    fileCount: collection.fileCount,
    bytes: collection.bytes,
    mobileAvailable: collection.dualPlatformEligible,
    officialAccount: collection.officialAccount
  }));
  const selected = collections.find((item) => item.name === collectionName);
  let works = [];
  if (selected?.path && isAllowedFile(selected.path) && exists(selected.path)) {
    works = safeList(selected.path)
      .filter((entry) => entry.isDirectory())
      .slice(0, 60)
      .map((entry) => {
        const workPath = path.join(selected.path, entry.name);
        const files = safeList(workPath)
          .filter((file) => file.isFile())
          .map((file) => path.join(workPath, file.name))
          .filter((file) => imageExts.has(path.extname(file).toLowerCase()) || textExts.has(path.extname(file).toLowerCase()));
        return {
          id: workPath,
          name: entry.name,
          path: workPath,
          imageCount: files.filter((file) => imageExts.has(path.extname(file).toLowerCase())).length,
          attachments: files.slice(0, 30)
        };
      });
  }
  return {
    root: settings.workPackage.libraryPath,
    batchSize: settings.workPackage.batchSize,
    collections,
    selected: selected || null,
    works
  };
}

function extensionProductTreeSnapshot(requestedPath = "", rootOverride = "") {
  const settings = getWorkspaceSettings();
  const root = path.resolve(rootOverride || settings.workPackage.libraryPath);
  const target = requestedPath
    ? path.resolve(requestedPath)
    : root;
  if (!isPathInside(root, target)) {
    throw new Error("只能读取当前成品库内部的文件夹");
  }
  if (!exists(target) || !fs.statSync(target).isDirectory()) {
    throw new Error("成品文件夹不存在或不是文件夹");
  }

  const entries = safeList(target).map((entry) => {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      const children = safeList(entryPath);
      const directFiles = children
        .filter((child) => child.isFile())
        .map((child) => path.join(entryPath, child.name));
      const attachments = directFiles.filter((file) => {
        const extension = path.extname(file).toLowerCase();
        return imageExts.has(extension) || textExts.has(extension);
      });
      return {
        id: entryPath,
        kind: "directory",
        name: entry.name,
        path: entryPath,
        hasChildren: children.length > 0,
        folderCount: children.filter((child) => child.isDirectory()).length,
        fileCount: directFiles.length,
        imageCount: attachments.filter((file) => imageExts.has(path.extname(file).toLowerCase())).length,
        textCount: attachments.filter((file) => textExts.has(path.extname(file).toLowerCase())).length,
        attachments: attachments.slice(0, 30)
      };
    }
    let size = 0;
    try {
      size = fs.statSync(entryPath).size;
    } catch {}
    const extension = path.extname(entry.name).toLowerCase();
    const uploadable = imageExts.has(extension) || textExts.has(extension);
    return {
      id: entryPath,
      kind: "file",
      name: entry.name,
      path: entryPath,
      size,
      uploadable,
      imageCount: imageExts.has(extension) ? 1 : 0,
      textCount: textExts.has(extension) ? 1 : 0,
      attachments: uploadable ? [entryPath] : []
    };
  });

  return {
    root,
    path: target,
    relativePath: path.relative(root, target),
    parentPath: target === root ? "" : path.dirname(target),
    entries
  };
}

function findCompletedWorkPackageByBatchId(productRoot, batchId, options = {}) {
  const root = path.resolve(String(productRoot || ""));
  const expectedBatchId = String(batchId || "").trim();
  if (!expectedBatchId || !exists(root) || !fs.statSync(root).isDirectory()) return "";
  const maximumDirectories = Math.max(100, Number(options.maximumDirectories || 10_000));
  const maximumDepth = Math.max(1, Number(options.maximumDepth || 6));
  const queue = [{ directory: root, depth: 0 }];
  let inspected = 0;
  let newest = null;
  while (queue.length && inspected < maximumDirectories) {
    const current = queue.shift();
    inspected += 1;
    const recordPath = path.join(current.directory, "GPT作品记录.json");
    if (exists(recordPath)) {
      const record = readJson(recordPath, {});
      if (String(record.batchId || "").trim() === expectedBatchId
        && String(record.status || "").toLowerCase() === "completed") {
        const recordedPath = String(record.packagePath || "").trim();
        const actualPath = recordedPath && exists(recordedPath) && fs.statSync(recordedPath).isDirectory()
          ? recordedPath
          : current.directory;
        const modifiedAt = fs.statSync(recordPath).mtimeMs;
        if (!newest || modifiedAt > newest.modifiedAt) newest = { path: actualPath, modifiedAt };
      }
    }
    if (current.depth >= maximumDepth) continue;
    for (const entry of safeList(current.directory)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (/^\.workpkg_staging_/i.test(entry.name) || entry.name === "_作品历史数据") continue;
      queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
    }
  }
  return newest?.path || "";
}

function saveExtensionCopyText(body = {}) {
  const copyText = String(body.copyText || "").trim();
  if (!copyText) throw new Error("本轮文案为空，未创建 TXT");
  const platformCopy = parsePlatformCopy(copyText);
  if (platformCopy.formatVersion === 2) {
    const validation = validatePlatformCopy(copyText, { minimumSectionLength: 80 });
    if (!validation.valid) {
      throw new Error(`双平台文案 TXT 协议无效：${validation.issues.join("、")}`);
    }
  }
  const batchId = String(body.batchId || "").trim();
  if (!/^\d{8}-\d{6}-[a-z0-9]{4}$/i.test(batchId)) {
    throw new Error("本轮文案批次号无效，未创建 TXT");
  }
  const requestedRoot = String(body.downloadRoot || "").trim();
  const configuredRoot = String(readJson(WORKPKG_CONFIG_FILE, {}).image_inbox_path || "").trim();
  const targetRoot = resolveAuthorizedDownloadRoot(requestedRoot, {
    defaultRoot: DOWNLOAD_ROOT,
    configuredRoot
  });
  const stagingDir = path.join(targetRoot, ".gpt-copy-staging");
  fs.mkdirSync(stagingDir, { recursive: true });
  const target = path.join(stagingDir, `${batchId}.txt`);
  fs.writeFileSync(target, copyText, { encoding: "utf8" });
  return {
    ok: true,
    batchId,
    filename: target,
    bytes: Buffer.byteLength(copyText, "utf8"),
    copyTextLength: copyText.length
  };
}

function removeExtensionCopyText(root, batchId) {
  const safeBatchId = String(batchId || "").trim();
  if (!/^\d{8}-\d{6}-[a-z0-9]{4}$/i.test(safeBatchId)) return;
  const targetRoot = path.resolve(String(root || DOWNLOAD_ROOT));
  if (!isPathInside(path.resolve(DOWNLOAD_ROOT), targetRoot)) return;
  try {
    fs.rmSync(path.join(targetRoot, ".gpt-copy-staging", `${safeBatchId}.txt`), { force: true });
  } catch {
  }
}

function inspectGptWorkPackage(packagePath, expectedImageCount = 0) {
  const rawPath = String(packagePath || "").trim();
  if (!rawPath) return { valid: false, imageCount: 0, textCount: 0 };
  const target = path.resolve(rawPath);
  if (!exists(target)) return { valid: false, imageCount: 0, textCount: 0 };
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return { valid: false, imageCount: 0, textCount: 0 };
  }
  if (!stat.isDirectory()) return { valid: false, imageCount: 0, textCount: 0 };
  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  const textExts = new Set([".txt"]);
  const entries = safeList(target);
  const imageCount = entries.filter((entry) => entry.isFile() && imageExts.has(path.extname(entry.name).toLowerCase())).length;
  const textCount = entries.filter((entry) => entry.isFile() && textExts.has(path.extname(entry.name).toLowerCase())).length;
  const plannedExpected = Math.max(0, Number(expectedImageCount || 0));
  const packageRecord = readJson(path.join(target, "GPT作品记录.json"), null);
  const recordedExpected = Math.max(0, Number(packageRecord?.expectedImageCount || 0));
  const recordedActual = Math.max(0, Number(packageRecord?.actualImages || 0));
  // ChatGPT can explicitly split a plan larger than ten pages into a first
  // 10-page publishable batch. The packager records the exact batch contract;
  // use it only when the completed record and the files on disk agree. This
  // prevents history sync from turning a verified 10/10 package back into a
  // false "12 pages missing 2" state while still rejecting partial folders.
  const recordMatchesDisk = packageRecord?.status === "completed"
    && recordedExpected > 0
    && recordedActual === recordedExpected
    && imageCount === recordedActual;
  const expected = recordMatchesDisk ? recordedExpected : plannedExpected;
  return {
    valid: imageCount > 0 && textCount > 0 && (expected === 0 || imageCount >= expected),
    imageCount,
    textCount,
    expectedImageCount: expected,
    plannedImageCount: plannedExpected,
    validatedByPackageRecord: recordMatchesDisk
  };
}

function validateGptWorkPackageImageCount(actualImageCount, expectedImageCount = 0) {
  const actual = Math.max(0, Number(actualImageCount || 0));
  const expected = Math.max(0, Number(expectedImageCount || 0));
  return {
    valid: actual > 0 && (expected === 0 || actual >= expected),
    actualImageCount: actual,
    expectedImageCount: expected,
    overproduced: expected > 0 && actual > expected
  };
}

function runExtensionWorkPackage(body = {}) {
  const script = path.join(DOWNLOAD_ROOT, "make_work_package.ps1");
  if (!exists(script)) {
    throw new Error("本地打包程序不存在，请先在设置中恢复正式打包程序");
  }
  const clipboardText = String(body.clipboardText || "");
  if (!clipboardText.trim()) {
    throw new Error("请先复制本次作品文案，再执行打包");
  }
  const requestedDownloadRoot = String(body.downloadRoot || "").trim();
  const requestedProductRoot = String(body.productRoot || "").trim();
  const normalProductRoot = path.join(PROJECT_ROOT, "成品库（GPT+本地脚本制作）");
  const workspaceSettings = getWorkspaceSettings();
  const configuredProductRoot = String(workspaceSettings?.workPackage?.libraryPath || "").trim();
  const isAcceptancePath = (value) => /(?:^|[\\/])(?:_测试验收|验收)(?:[\\/]|$)/i.test(value);
  const effectiveRequestedDownloadRoot = isAcceptancePath(requestedDownloadRoot) ? DOWNLOAD_ROOT : requestedDownloadRoot;
  const effectiveRequestedProductRoot = isAcceptancePath(requestedProductRoot)
    ? normalProductRoot
    : (requestedProductRoot || configuredProductRoot || normalProductRoot);
  const effectiveDownloadRoot = requestedDownloadRoot
    ? path.resolve(effectiveRequestedDownloadRoot)
    : path.resolve(DOWNLOAD_ROOT);
  const effectiveProductRoot = path.resolve(effectiveRequestedProductRoot);
  const stageRoots = getWorkflowStageRoots(effectiveProductRoot);
  const configuredPackedRoot = String(getPageSettings()?.production?.packedRoot || "").trim();
  const effectivePortfolioOutputRoot = configuredPackedRoot
    ? path.resolve(configuredPackedRoot)
    : stageRoots.mobile;
  const configPath = path.join(DOWNLOAD_ROOT, "workpkg_config.json");
  const originalConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath) : null;
  let configRestored = false;
  const restoreWorkPackageConfig = () => {
    if (configRestored) return;
    configRestored = true;
    if (originalConfig) fs.writeFileSync(configPath, originalConfig);
    else fs.rmSync(configPath, { force: true });
  };
  // Manual buttons and the automatic state machine must execute against the
  // same concrete inbox/library pair.  The legacy packager reads these values
  // from workpkg_config.json, so leaving an older temporary path in that file
  // made a manual click diverge from an automatic run.
  if (!path.isAbsolute(effectiveDownloadRoot)) throw new Error("下载暂存目录必须是完整路径");
  if (!path.isAbsolute(effectiveProductRoot)) throw new Error("成品库目录必须是完整路径");
  if (!isPathInside(effectiveProductRoot, effectivePortfolioOutputRoot)) {
    throw new Error("作品集目录必须位于当前成品库内");
  }
  fs.mkdirSync(effectiveDownloadRoot, { recursive: true });
  fs.mkdirSync(effectiveProductRoot, { recursive: true });
  fs.mkdirSync(effectivePortfolioOutputRoot, { recursive: true });
  const config = readJson(configPath, {});
  config.image_inbox_path = effectiveDownloadRoot;
  config.library_path = effectiveProductRoot;
  config.portfolio_output_path = effectivePortfolioOutputRoot;
  config.portfolio_batch_size = Math.max(1, Math.min(100, Number(workspaceSettings?.workPackage?.batchSize || 7)));
  config.portfolio_auto_group = workspaceSettings?.workPackage?.autoGroup !== false;
  config.portfolio_auto_zip = workspaceSettings?.workPackage?.autoZip === true;
  writeJson(configPath, config);
  const batchId = String(body.batchId || "").trim();
  const expectedImageCount = Math.max(0, Number(body.expectedImageCount || 0));
  if (batchId && !/^\d{8}-\d{6}-[a-z0-9]{4}$/i.test(batchId)) {
    throw new Error("本次图片批次号无效，已停止打包");
  }
  if (batchId && expectedImageCount < 1) {
    throw new Error("本次图片数量无效，已停止打包");
  }
  const normalizedBodyTitle = normalizeWorkPackageTitle(body.title);
  const metadata = JSON.stringify({
    accountName: String(body.accountName || ""),
    conversationUrl: String(body.conversationUrl || ""),
    title: normalizedBodyTitle,
    sourceMaterialPath: String(body.sourceMaterialPath || "")
  });
  const args = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", script,
    "-ClipboardTextOverride", clipboardText,
    "-ConversationMetadataJsonOverride", metadata,
    "-NoMessage"
  ];
  let taskFile = "";
  if (batchId) {
    // The PowerShell packager reads its task manifest from image_inbox_path.
    // Writing it to the global download root made every custom/acceptance
    // download directory fail with TASK_MISSING even though all images existed.
    taskFile = path.join(effectiveDownloadRoot, `chatgpt-workpkg-task-${batchId}.json`);
    const publishTitle = publishTitleFromClipboard(clipboardText, normalizedBodyTitle);
    writeJson(taskFile, {
      version: 1,
      batchId,
      expectedImageCount,
      copyText: clipboardText,
      accountName: String(body.accountName || ""),
      conversationUrl: String(body.conversationUrl || ""),
      sourceMaterialPath: String(body.sourceMaterialPath || ""),
      // Embedded automation has no trustworthy foreground browser title. A
      // login/security page title such as "验证你的身份 - OpenAI" used to leak
      // into the output folder name. Matching the conversation title to the
      // publish title keeps the existing packager naming logic deterministic.
      conversationTitle: publishTitle,
      title: normalizedBodyTitle,
      status: "ready",
      createdAt: new Date().toISOString()
    });
    args.push("-BatchId", batchId, "-ExpectedImageCount", String(expectedImageCount));
  }
  if (body.preview === true) args.push("-Preview");

  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("powershell.exe", args, {
      cwd: DOWNLOAD_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => { stdoutChunks.push(Buffer.from(chunk)); });
    child.stderr.on("data", (chunk) => { stderrChunks.push(Buffer.from(chunk)); });
    child.on("error", (error) => {
      restoreWorkPackageConfig();
      reject(error);
    });
    child.on("close", (code) => {
      const decodeWindowsOutput = (chunks) => {
        const bytes = Buffer.concat(chunks);
        const utf8 = bytes.toString("utf8");
        if (!utf8.includes("\uFFFD")) return utf8;
        return new TextDecoder("gb18030").decode(bytes);
      };
      const stdout = decodeWindowsOutput(stdoutChunks);
      const stderr = decodeWindowsOutput(stderrChunks);
      restoreWorkPackageConfig();
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `打包程序退出码 ${code}`));
        return;
      }
      const output = stdout.trim();
      const fields = Object.fromEntries(output.split(/\r?\n/).map((line) => {
        const separator = line.indexOf("=");
        return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : null;
      }).filter(Boolean));
      if (body.preview !== true && /^DUPLICATE$/m.test(output)) {
        removeExtensionCopyText(effectiveDownloadRoot, batchId);
        const duplicatePackagePath = String(fields.DuplicatePackagePath || "").trim();
        const verifiedDuplicatePackagePath = duplicatePackagePath
          && isPathInside(effectiveProductRoot, path.resolve(duplicatePackagePath))
          && exists(path.resolve(duplicatePackagePath))
          && fs.statSync(path.resolve(duplicatePackagePath)).isDirectory()
          ? path.resolve(duplicatePackagePath)
          : "";
        resolve({
          ok: true,
          duplicate: true,
          skipped: true,
          duplicateReason: String(fields.DuplicateReason || "ExactImageSet"),
          deletedImages: Math.max(0, Number(fields.DeletedImages || 0)),
          batchId,
          expectedImageCount,
          packagePath: verifiedDuplicatePackagePath,
          imageCount: 0,
          textFile: "",
          output
        });
        return;
      }
      if (body.preview !== true && !/^OK$/m.test(output)) {
        reject(new Error(output || "打包程序没有返回完成标记"));
        return;
      }
      let packagePath = String(fields.Folder || "").trim();
      if (body.preview !== true && batchId
        && (!packagePath || !exists(packagePath) || !fs.statSync(packagePath).isDirectory())) {
        // Windows PowerShell 5 may emit a Chinese path through an OEM code page
        // that happens to decode as valid (but wrong) UTF-8.  The package record
        // is UTF-8 JSON and is therefore the authoritative result channel.
        packagePath = findCompletedWorkPackageByBatchId(effectiveProductRoot, batchId) || packagePath;
      }
      let packageImageCount = 0;
      let imageValidation = null;
      if (body.preview !== true) {
        if (!packagePath || !exists(packagePath) || !fs.statSync(packagePath).isDirectory()) {
          reject(new Error("打包程序已结束，但没有找到成品文件夹"));
          return;
        }
        const packageFiles = fs.readdirSync(packagePath, { withFileTypes: true });
        packageImageCount = packageFiles.filter((entry) =>
          entry.isFile() && imageExts.has(path.extname(entry.name).toLowerCase())
        ).length;
        const textCount = packageFiles.filter((entry) =>
          entry.isFile() && path.extname(entry.name).toLowerCase() === ".txt"
        ).length;
        imageValidation = validateGptWorkPackageImageCount(packageImageCount, expectedImageCount);
        if (!imageValidation.valid) {
          reject(new Error(`成品图片核对失败：${packageImageCount}/${expectedImageCount}`));
          return;
        }
        if (imageValidation.overproduced) {
          appendAutomationLog({
            event: "gpt-package-overproduced",
            batchId,
            packagePath,
            actualImageCount: imageValidation.actualImageCount,
            expectedImageCount: imageValidation.expectedImageCount,
            action: "accept-and-archive"
          });
        }
        if (textCount < 1) {
          reject(new Error("成品文件夹没有 TXT 文案，已停止后续队列"));
          return;
        }
        removeExtensionCopyText(effectiveDownloadRoot, batchId);
      }
      resolve({
        ok: true,
        mode: "workbench-direct",
        fallback: false,
        preview: body.preview === true,
        batchId,
        expectedImageCount,
        packagePath,
        imageCount: body.preview === true
          ? Number(fields.Images || expectedImageCount || 0)
          : packageImageCount,
        overproduced: body.preview !== true && imageValidation?.overproduced === true,
        textFile: String(fields.Txt || ""),
        output
      });
    });
  });
}

function getWorkspaceSettings() {
  const local = readJson(APP_SETTINGS_FILE, {});
  const workPackage = readJson(WORKPKG_CONFIG_FILE, {});
  const defaultMaterialRoot = path.join(PROJECT_ROOT, "01-素材库");
  return {
    materialRoot: path.resolve(local.materialRoot || defaultMaterialRoot),
    imageApi: publicImageApiSettings(local.imageApi),
    textApi: publicTextApiSettings(local.textApi),
    pageSettings: getPageSettings(),
    workPackage: {
      configFile: WORKPKG_CONFIG_FILE,
      scriptDirectory: path.dirname(WORKPKG_CONFIG_FILE),
      libraryPath: workPackage.library_path || path.join(PROJECT_ROOT, "成品库（GPT+本地脚本制作）"),
      batchSize: Number(workPackage.portfolio_batch_size || 14),
      autoGroup: workPackage.portfolio_auto_group !== false,
      autoZip: workPackage.portfolio_auto_zip !== false
    }
  };
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).reduce((result, line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) result[match[1]] = match[2].trim();
    return result;
  }, {});
}

function imageApiCredential(provider, suppliedKey = "") {
  if (String(suppliedKey).trim()) return String(suppliedKey).trim();
  const saved = readEnvFile(IMAGE_API_SECRET_FILE);
  if (provider === "minimax") {
    return saved.MINIMAX_IMAGE_API_KEY || process.env.TEAMBUILDING_MINIMAX_IMAGE_API_KEY
      || process.env.MINIMAXI_API_KEY || process.env.MINIMAX_API_KEY || "";
  }
  if (provider === "bytecat") {
    return saved.BYTECAT_IMAGE_API_KEY || process.env.TEAMBUILDING_BYTECAT_IMAGE_API_KEY || "";
  }
  return saved.LOCAL_IMAGE_API_KEY || process.env.TEAMBUILDING_IMAGE_API_KEY || "";
}

function textApiCredential(provider, suppliedKey = "") {
  if (String(suppliedKey).trim()) return String(suppliedKey).trim();
  const saved = readEnvFile(IMAGE_API_SECRET_FILE);
  if (provider === "minimax") {
    return saved.MINIMAX_TEXT_API_KEY || saved.MINIMAX_IMAGE_API_KEY
      || process.env.TEAMBUILDING_MINIMAX_TEXT_API_KEY
      || process.env.MINIMAXI_API_KEY || process.env.MINIMAX_API_KEY || "";
  }
  if (provider === "bytecat") {
    return saved.BYTECAT_TEXT_API_KEY || saved.BYTECAT_IMAGE_API_KEY
      || process.env.TEAMBUILDING_BYTECAT_TEXT_API_KEY || "";
  }
  return saved.LOCAL_TEXT_API_KEY || saved.LOCAL_IMAGE_API_KEY
    || process.env.TEAMBUILDING_TEXT_API_KEY || process.env.TEAMBUILDING_IMAGE_API_KEY || "";
}

function textGenerationConnection(suppliedKey = "") {
  const savedTextApi = readJson(APP_SETTINGS_FILE, {}).textApi || {};
  const config = normalizeTextApiConfig(savedTextApi);
  const apiKey = textApiCredential(config.provider, suppliedKey);
  if (apiKey) return { config, apiKey };
  const localApiKey = textApiCredential("local-openai");
  return localApiKey
    ? { config: normalizeTextApiConfig({ provider: "local-openai" }), apiKey: localApiKey }
    : { config, apiKey: "" };
}

const WORKBENCH_ASSISTANT_ACTIONS = new Set([
  "capabilities",
  "status",
  "open_tab",
  "open_settings",
  "detect_devices",
  "send_collection",
  "restock_device",
  "produce",
  "backup",
  "unclear"
]);

async function interpretWorkbenchAssistantCommand(command) {
  const cleanCommand = String(command || "").trim().slice(0, 500);
  if (!cleanCommand) return { action: "unclear", reply: "请告诉我想处理哪一步。" };
  const connection = textGenerationConnection();
  if (!connection.apiKey) throw new Error("当前没有可用的文案模型密钥");
  const prompt = [
    "你是图文工作台里的命令理解器，只负责理解意图，不执行操作。",
    "只返回一个 JSON 对象，不要 Markdown。",
    "允许的 action：capabilities,status,open_tab,open_settings,detect_devices,send_collection,restock_device,produce,backup,unclear。",
    "字段：action、tab、settings、deviceNumber、category、collection、count、reply。",
    "tab 只能是 dashboard、distribution、conversion、settings。",
    "settings 只能是 production、distribution、global、backup。",
    "category 只能是 conversion、traffic、unclassified、all。",
    "涉及发送但设备编号、作品集或分类不足时，action 必须是 unclear，并在 reply 里只追问缺少的信息。",
    "涉及删除、覆盖、新设备的首次自动分发、任意系统命令时，action 必须是 unclear。",
    `用户原话：${cleanCommand}`
  ].join("\n");
  const raw = await generateText({
    config: connection.config,
    apiKey: connection.apiKey,
    prompt,
    model: connection.config.model
  });
  const jsonText = String(raw || "").replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const result = JSON.parse(jsonText);
  const action = WORKBENCH_ASSISTANT_ACTIONS.has(result?.action) ? result.action : "unclear";
  return {
    action,
    tab: ["dashboard", "distribution", "conversion", "settings"].includes(result?.tab) ? result.tab : "",
    settings: ["production", "distribution", "global", "backup"].includes(result?.settings) ? result.settings : "",
    deviceNumber: String(result?.deviceNumber || "").replace(/\D/g, "").slice(0, 3),
    category: ["conversion", "traffic", "unclassified", "all"].includes(result?.category) ? result.category : "",
    collection: String(result?.collection || "").trim().slice(0, 100),
    count: Math.max(0, Math.min(100, Number(result?.count) || 0)),
    reply: String(result?.reply || "").trim().slice(0, 300)
  };
}

function publicImageApiSettings(value = {}) {
  const saved = readEnvFile(IMAGE_API_SECRET_FILE);
  const config = normalizeImageApiConfig({
    provider: value?.provider || saved.LOCAL_IMAGE_API_PROVIDER,
    baseUrl: value?.baseUrl || saved.LOCAL_IMAGE_API_BASE_URL,
    model: value?.model || saved.LOCAL_IMAGE_API_MODEL
  });
  return { ...config, credentialConfigured: Boolean(imageApiCredential(config.provider)), secretStoredLocally: true };
}

function publicTextApiSettings(value = {}) {
  const saved = readEnvFile(IMAGE_API_SECRET_FILE);
  const config = normalizeTextApiConfig({
    provider: value?.provider || saved.LOCAL_TEXT_API_PROVIDER,
    baseUrl: value?.baseUrl || saved.LOCAL_TEXT_API_BASE_URL,
    model: value?.model || saved.LOCAL_TEXT_API_MODEL
  });
  return { ...config, credentialConfigured: Boolean(textApiCredential(config.provider)), secretStoredLocally: true };
}

function saveImageApiSecret({ provider, baseUrl, model, apiKey }) {
  const existing = readEnvFile(IMAGE_API_SECRET_FILE);
  const config = normalizeImageApiConfig({ provider, baseUrl, model });
  const next = { ...existing };
  next.LOCAL_IMAGE_API_PROVIDER = config.provider;
  next.LOCAL_IMAGE_API_BASE_URL = config.baseUrl;
  next.LOCAL_IMAGE_API_MODEL = config.model;
  if (String(apiKey || "").trim()) {
    if (config.provider === "minimax") next.MINIMAX_IMAGE_API_KEY = String(apiKey).trim();
    else if (config.provider === "bytecat") next.BYTECAT_IMAGE_API_KEY = String(apiKey).trim();
    else next.LOCAL_IMAGE_API_KEY = String(apiKey).trim();
  }
  fs.mkdirSync(path.dirname(IMAGE_API_SECRET_FILE), { recursive: true });
  const lines = [
    "# 图文工作台本机生图凭据。禁止提交仓库、日志或导出包。",
    "# 界面只返回是否已配置，不会回传密钥明文。",
    ...Object.entries(next).map(([key, value]) => `${key}=${value}`)
  ];
  fs.writeFileSync(IMAGE_API_SECRET_FILE, `${lines.join("\n")}\n`, "utf8");
  return config;
}

function saveTextApiSecret({ provider, baseUrl, model, apiKey }) {
  const existing = readEnvFile(IMAGE_API_SECRET_FILE);
  const config = normalizeTextApiConfig({ provider, baseUrl, model });
  const next = { ...existing };
  next.LOCAL_TEXT_API_PROVIDER = config.provider;
  next.LOCAL_TEXT_API_BASE_URL = config.baseUrl;
  next.LOCAL_TEXT_API_MODEL = config.model;
  if (String(apiKey || "").trim()) {
    if (config.provider === "minimax") next.MINIMAX_TEXT_API_KEY = String(apiKey).trim();
    else if (config.provider === "bytecat") next.BYTECAT_TEXT_API_KEY = String(apiKey).trim();
    else next.LOCAL_TEXT_API_KEY = String(apiKey).trim();
  }
  fs.mkdirSync(path.dirname(IMAGE_API_SECRET_FILE), { recursive: true });
  const lines = [
    "# 图文工作台本机 API 凭据。禁止提交仓库、日志或导出包。",
    "# 界面只返回是否已配置，不会回传密钥明文。",
    ...Object.entries(next).map(([key, value]) => `${key}=${value}`)
  ];
  fs.writeFileSync(IMAGE_API_SECRET_FILE, `${lines.join("\n")}\n`, "utf8");
  return config;
}

function safeOutputName(value) {
  return String(value || "待审作品").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 70) || "待审作品";
}

function collectReferenceImages(folderPath, limit = 4) {
  if (!folderPath || !isAllowedFile(folderPath) || !exists(folderPath) || !fs.statSync(folderPath).isDirectory()) return [];
  return safeList(folderPath)
    .filter((entry) => entry.isFile() && imageExts.has(path.extname(entry.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }))
    .slice(0, limit)
    .map((entry) => path.join(folderPath, entry.name));
}

function materialFacts(folderPath) {
  if (!folderPath || !isAllowedFile(folderPath) || !exists(folderPath)) return "";
  return safeList(folderPath)
    .filter((entry) => entry.isFile() && textExts.has(path.extname(entry.name).toLowerCase()))
    .slice(0, 3)
    .map((entry) => readPromptFile(path.join(folderPath, entry.name)))
    .join("\n")
    .slice(0, 12000);
}

function buildProductionPrompt(body, facts) {
  const userPrompt = String(body.prompt || "").trim().slice(0, 16000);
  return [
    "你正在执行严格的轮播母版迁移，不是自由设计。第一组参考图是A类永久视觉母版，后续参考图是B类内容素材。",
    "锁定母版的字体气质、字号比例、配色、标题位置、拼图骨架和页面气质；只从素材提取真实内容。",
    "禁止继承素材自身排版，禁止虚构地点、项目、价格、车程或场景，禁止新增素材和事实中没有的露营、篝火、建筑等内容。",
    "图片只负责真实场景与视觉结构，不写起接人数、价格、联系方式或交易话术。人物、分区和道具应去重，保持真实手机抓拍感。",
    "每次只生成一张独立3:4图片，所有关键信息与人物必须放在画面中央安全区，便于落盘时统一裁切为1200×1600。不得输出多页合集、长图、缩略图墙或样机展示。中文必须准确。",
    "校准图禁止自行添加01/08、1/9等页码或总页数；只有正式整套计划明确给出准确页数时才能显示页码。",
    `本次阶段：${body.stage === "inner" ? "典型内页校准" : "封面校准"}。质量档：${body.quality || "标准"}。`,
    userPrompt ? `用户补充要求：\n${userPrompt}` : "",
    facts ? `素材事实（只能从这里取业务事实）：\n${facts}` : ""
  ].filter(Boolean).join("\n\n");
}

function productionPlanId(plans, mode) {
  return crypto.createHash("sha256")
    .update(JSON.stringify({ mode, plans: plans.map((plan) => ({
      materialPath: plan.materialPath,
      templatePath: plan.templatePath,
      pageCount: plan.pageCount,
      pages: plan.pages.map((page) => ({ role: page.role, title: page.title, sourceImage: page.sourceImage }))
    })) }))
    .digest("hex")
    .slice(0, 20);
}

async function createProductionPlans(body) {
  const templatePath = path.resolve(String(body.templatePath || ""));
  if (!isAllowedFile(templatePath) || !exists(templatePath)) throw new Error("请选择真实存在的模板文件夹");
  const requested = Array.isArray(body.materialPaths) && body.materialPaths.length
    ? body.materialPaths
    : [body.materialPath];
  const materialPaths = [...new Set(requested.map((item) => path.resolve(String(item || ""))).filter(Boolean))]
    .slice(0, 50);
  if (!materialPaths.length) throw new Error("请选择要生产的素材");
  const mode = materialPaths.length > 1 ? "batch" : "set";
  let plans = materialPaths.map((materialPath, index) => {
    if (!isAllowedFile(materialPath) || !exists(materialPath)) throw new Error(`素材文件夹不存在：${materialPath}`);
    const materialImages = collectReferenceImages(materialPath, 10);
    if (!materialImages.length) throw new Error(`素材文件夹中没有可用图片：${path.basename(materialPath)}`);
    const plan = buildProductionPlan({
      mode: "set",
      materialPath,
      templatePath,
      materialImages,
      facts: materialFacts(materialPath),
      requestedPages: body.requestedPages,
      batchIndex: index
    });
    return plan;
  });
  const titleConnection = textGenerationConnection();
  if (titleConnection.apiKey) {
    plans = await Promise.all(plans.map(async (plan) => {
      try {
        const titlePrompt = [
          "请根据团建素材事实为轮播出图计划提炼短标题。只返回严格 JSON，不要 Markdown。",
          `格式：{"workTitle":"作品总标题","pages":[{"title":"P1标题"},{"title":"P2标题"}]}`,
          `必须正好返回 ${plan.pageCount} 个 pages。workTitle 4—12 个中文字符；内页标题 2—8 个中文字符。`,
          "不得使用 emoji、括号、序号、夸张词、HR话术、无限、必看、快收藏、咨询、报价、全包。",
          "只能提取素材明确出现的地点和项目，不得虚构。P1是作品主题；后续每页各自一个不同项目。",
          `原文件夹名：${path.basename(plan.materialPath)}`,
          `素材事实：\n${materialFacts(plan.materialPath)}`
        ].join("\n\n");
        const raw = await generateText({
          config: titleConnection.config,
          apiKey: titleConnection.apiKey,
          prompt: titlePrompt,
          model: String(body.textModel || titleConnection.config.model).trim() || titleConnection.config.model
        });
        const jsonText = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
        return applySuggestedTitles(plan, JSON.parse(jsonText));
      } catch {
        return plan;
      }
    }));
  }
  const id = productionPlanId(plans, mode);
  const planBundle = {
    id,
    mode,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    plans,
    totals: {
      works: plans.length,
      images: plans.reduce((sum, plan) => sum + plan.pageCount, 0),
      copyFiles: plans.length
    }
  };
  pendingProductionPlans.set(id, planBundle);
  return planBundle;
}

function publicProductionJob(job) {
  const imageResults = (job.results || []).filter((item) => item.type === "image");
  return {
    id: job.id,
    planId: job.planId,
    mode: job.mode,
    status: job.status,
    phase: job.phase,
    message: job.message,
    progress: job.progress,
    total: job.total,
    remaining: Math.max(0, Number(job.total || 0) - Number(job.progress || 0)),
    runScope: job.options?.runScope || "full",
    generationRequestCount: imageResults.reduce(
      (sum, item) => sum + Number(item.requestMeta?.requestCount || 0),
      0
    ),
    generationAttemptCount: imageResults.reduce(
      (sum, item) => sum + Number(item.requestMeta?.attemptCount || 0),
      0
    ),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt || "",
    finishedAt: job.finishedAt || "",
    durationMs: job.startedAt
      ? Math.max(0, new Date(
        job.finishedAt || (job.status === "running" ? Date.now() : job.updatedAt || Date.now())
      ).getTime() - new Date(job.startedAt).getTime())
      : 0,
    outputRoots: job.outputRoots || [],
    results: (job.results || []).map((item) => ({
      ...item,
      previewUrl: item.outputFile ? `/file?path=${encodeURIComponent(item.outputFile)}` : ""
    })),
    failures: job.failures || [],
    qualityReports: job.qualityReports || [],
    resumable: ["calibration-ready", "interrupted", "failed", "needs-rework", "cancelled"].includes(job.status),
    cancelable: job.status === "running",
    error: job.error || ""
  };
}

function safeProductionOptions(options = {}) {
  const config = normalizeImageApiConfig(options);
  const textConfig = normalizeTextApiConfig(readJson(APP_SETTINGS_FILE, {}).textApi || {});
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    quality: String(options.quality || "严格母版").slice(0, 100),
    prompt: String(options.prompt || "").slice(0, 30_000),
    textModel: String(options.textModel || textConfig.model).slice(0, 200),
    outputPrefix: safeOutputName(String(options.outputPrefix || "")).slice(0, 40),
    runScope: String(options.runScope || "") === "calibration" ? "calibration" : "full"
  };
}

function productionRequestSummary(results, work) {
  const images = (results || []).filter((item) => item.type === "image" && item.work === work);
  return {
    imageCount: images.length,
    paidGenerationRequests: images.reduce(
      (sum, item) => sum + Number(item.requestMeta?.requestCount || 0),
      0
    ),
    generationAttempts: images.reduce(
      (sum, item) => sum + Number(item.requestMeta?.attemptCount || 0),
      0
    ),
    automaticPaidRetries: 0,
    pages: images.map((item) => ({
      page: item.page,
      provider: item.provider,
      model: item.model,
      referenceCount: Number(item.requestMeta?.referenceCount || 0),
      providerRequestId: item.requestMeta?.providerRequestId || "",
      attempts: item.requestMeta?.attempts || [],
      usage: item.requestMeta?.usage || null,
      durationMs: item.durationMs
    }))
  };
}

function productionResumeScope(job = {}) {
  if (job.status === "calibration-ready") return "full";
  return job.options?.runScope === "calibration" ? "calibration" : "full";
}

function productionPageAllowed(runScope, planIndex, pageCode, firstPageCode) {
  if (runScope !== "calibration") return true;
  return Number(planIndex) === 0 && String(pageCode || "") === String(firstPageCode || "");
}

function saveProductionJob(job) {
  fs.mkdirSync(PRODUCTION_JOB_ROOT, { recursive: true });
  writeJson(path.join(PRODUCTION_JOB_ROOT, `${job.id}.json`), {
    ...job,
    options: safeProductionOptions(job.options || {}),
    planBundle: job.planBundle || null
  });
}

function loadProductionJobs() {
  fs.mkdirSync(PRODUCTION_JOB_ROOT, { recursive: true });
  for (const entry of safeList(PRODUCTION_JOB_ROOT)) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const saved = readJson(path.join(PRODUCTION_JOB_ROOT, entry.name), null);
    if (!saved?.id || !saved?.planBundle) continue;
    if (saved.status === "running") {
      saved.status = "interrupted";
      saved.phase = "interrupted";
      saved.message = "应用曾在生产中关闭，已保留进度，可以继续生产。";
      saved.updatedAt = new Date().toISOString();
      saved.cancelRequested = false;
    }
    productionJobs.set(saved.id, saved);
  }
}

function updateProductionJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  productionJobs.set(job.id, job);
  saveProductionJob(job);
}

async function runProductionJob(job, planBundle, options) {
  const config = normalizeImageApiConfig(options);
  const apiKey = imageApiCredential(config.provider, options.apiKey);
  if (!apiKey) throw new Error("没有找到这个平台的本机密钥");
  const textConnection = textGenerationConnection(options.textApiKey);
  const abortController = new AbortController();
  productionAbortControllers.set(job.id, abortController);
  job.planBundle = planBundle;
  job.options = safeProductionOptions(options);
  const calibrationOnly = job.options.runScope === "calibration";
  const uniqueResults = new Map();
  for (const item of job.results || []) {
    if (!item?.type || !item?.outputFile || !exists(item.outputFile)) continue;
    const key = item.type === "image"
      ? `image:${item.work || ""}:${item.page || ""}`
      : `${item.type}:${item.work || ""}:${item.outputFile}`;
    uniqueResults.set(key, item);
  }
  job.results = [...uniqueResults.values()];
  job.failures = [];
  job.qualityReports = [];
  job.cancelRequested = false;
  job.startedAt ||= new Date().toISOString();
  job.finishedAt = "";
  updateProductionJob(job, {
    status: "running",
    phase: "starting",
    message: calibrationOnly
      ? "省钱校准模式：本次只生成第一套作品的首张封面，只发起 1 次付费生图请求"
      : "首图已确认，正在核对已完成页面并继续生成剩余内容",
    error: ""
  });
  let completed = job.results.filter((item) => item.type === "image").length;
  for (const [planIndex, plan] of planBundle.plans.entries()) {
    if (job.cancelRequested) break;
    if (calibrationOnly && planIndex > 0) break;
    const facts = materialFacts(plan.materialPath);
    const templateImages = collectReferenceImages(plan.templatePath, 5);
    const materialImages = collectReferenceImages(plan.materialPath, 10);
    if (!templateImages.length) {
      job.failures.push({ work: plan.materialName, phase: "prepare", message: `模板中没有可用参考图：${plan.templateName}` });
      continue;
    }
    job.workRoots ||= {};
    const workKey = String(planIndex);
    if (!job.workRoots[workKey]) {
      const outputPrefix = safeOutputName(String(options.outputPrefix || ""));
      const folderName = `${outputPrefix}${job.createdAt.slice(0, 10).replaceAll("-", "")}_${safeOutputName(plan.materialName)}_${safeOutputName(plan.recipe.name)}_${job.id.slice(-6)}`;
      job.workRoots[workKey] = path.join(IMAGE_REVIEW_ROOT, folderName);
    }
    const outputRoot = job.workRoots[workKey];
    fs.mkdirSync(outputRoot, { recursive: true });
    job.outputRoots = [...new Set([...(job.outputRoots || []), outputRoot])];
    writeJson(path.join(outputRoot, "出图计划.json"), plan);
    for (const page of plan.pages) {
      if (job.cancelRequested) break;
      if (!productionPageAllowed(job.options.runScope, planIndex, page.code, planBundle.plans[0]?.pages[0]?.code)) break;
      const existing = (job.results || []).find((item) => (
        item.type === "image"
        && item.work === plan.materialName
        && item.page === page.code
        && exists(item.outputFile)
      ));
      if (existing) {
        if (calibrationOnly) {
          updateProductionJob(job, {
            status: "calibration-ready",
            phase: "calibration-ready",
            finishedAt: new Date().toISOString(),
            message: `首张校准图已存在。本批剩余 ${Math.max(0, job.total - completed)} 张尚未调用接口；确认后再继续。`,
            progress: completed
          });
          return;
        }
        updateProductionJob(job, {
          phase: "resuming",
          message: `${plan.materialName} · ${page.code} 已完成，继续下一页`,
          progress: completed
        });
        continue;
      }
      const pageStartedAt = Date.now();
      updateProductionJob(job, {
        phase: "generating-images",
        message: `正在做 ${plan.materialName} · ${page.code} ${page.title}`,
        progress: completed
      });
      const templateRef = page.role === "cover"
        ? templateImages[0]
        : (templateImages[Math.min(1, templateImages.length - 1)] || templateImages[0]);
      const pageMaterial = page.sourceImage && exists(page.sourceImage)
        ? page.sourceImage
        : materialImages[Math.min(page.index - 1, materialImages.length - 1)];
      // Keep each request small and deterministic. The local image bridge becomes
      // unreliable with a large multipart payload; one master page plus one source
      // image is enough to lock the layout while preserving the real scene.
      const referencePaths = [templateRef, pageMaterial];
      const prompt = buildPagePrompt(plan, page, facts, options.prompt, options.quality);
      const failedAttemptAudit = [];
      try {
        const generated = await generateImages({
          config,
          apiKey,
          prompt,
          referencePaths: [...new Set(referencePaths.filter(Boolean))].slice(0, 8),
          outputRoot,
          count: 1,
          retryOptions: {
            attempts: 1,
            delays: [],
            onAttempt: (entry) => failedAttemptAudit.push(entry)
          },
          signal: abortController.signal
        });
        const original = generated[0];
        const extension = path.extname(original.outputFile);
        const finalFile = path.join(outputRoot, `${page.code}_${safeOutputName(page.title)}${extension}`);
        if (exists(finalFile)) fs.rmSync(finalFile, { force: true });
        fs.renameSync(original.outputFile, finalFile);
        job.results.push({
          type: "image",
          work: plan.materialName,
          page: page.code,
          title: page.title,
          outputFile: finalFile,
          bytes: original.bytes,
          width: original.width,
          height: original.height,
          provider: original.provider,
          model: original.model,
          requestMeta: original.requestMeta || {
            requestCount: 1,
            attemptCount: 1,
            attempts: [],
            referenceCount: referencePaths.filter(Boolean).length,
            usage: null
          },
          durationMs: Date.now() - pageStartedAt
        });
        completed += 1;
        if (calibrationOnly) {
          writeJson(path.join(outputRoot, "生产记录.json"), {
            status: "calibration-ready",
            createdAt: new Date().toISOString(),
            plan,
            provider: config.provider,
            imageModel: config.model,
            textModel: options.textModel || textConnection.config.model,
            requestSummary: productionRequestSummary(job.results, plan.materialName),
            note: "省钱校准模式只生成首张封面。确认首图后才会生成剩余页面与文案。",
            officialLibraryWritten: false,
            files: job.results.filter((item) => item.work === plan.materialName).map((item) => item.outputFile)
          });
          updateProductionJob(job, {
            status: "calibration-ready",
            phase: "calibration-ready",
            progress: completed,
            finishedAt: new Date().toISOString(),
            message: `首张校准图已生成。本次仅调用 1 次、未自动重试；剩余 ${Math.max(0, job.total - completed)} 张尚未调用接口。请先看图，再决定是否继续整套。`
          });
          return;
        }
        updateProductionJob(job, { progress: completed });
      } catch (error) {
        job.failures.push({
          work: plan.materialName,
          page: page.code,
          phase: "image",
          message: String(error?.message || error).slice(0, 500),
          requestMeta: {
            requestCount: 1,
            attemptCount: failedAttemptAudit.length,
            attempts: failedAttemptAudit,
            referenceCount: [...new Set(referencePaths.filter(Boolean))].length,
            provider: config.provider,
            model: config.model,
            automaticPaidRetries: 0
          }
        });
        if (calibrationOnly) {
          writeJson(path.join(outputRoot, "生产记录.json"), {
            status: "calibration-failed",
            createdAt: new Date().toISOString(),
            plan,
            provider: config.provider,
            imageModel: config.model,
            requestSummary: {
              paidGenerationRequests: 1,
              generationAttempts: failedAttemptAudit.length,
              automaticPaidRetries: 0,
              failedPage: page.code,
              attempts: failedAttemptAudit
            },
            failure: String(error?.message || error).slice(0, 500),
            officialLibraryWritten: false,
            files: []
          });
          updateProductionJob(job, {
            status: "failed",
            phase: "calibration-failed",
            finishedAt: new Date().toISOString(),
            message: `${plan.materialName} · ${page.code} 首张校准图生成失败；为避免继续扣费，后续页面没有调用接口。`,
            progress: completed
          });
          return;
        }
        updateProductionJob(job, {
          message: `${plan.materialName} · ${page.code} 生成失败，已记录并继续下一页`,
          progress: completed
        });
      }
    }
    const copyFile = path.join(outputRoot, "小红书文案.txt");
    const existingCopy = (job.results || []).find((item) => item.type === "copy"
      && item.work === plan.materialName && exists(item.outputFile));
    if (!job.cancelRequested && !existingCopy) {
      updateProductionJob(job, {
        phase: "generating-copy",
        message: `正在写 ${plan.materialName} 的小红书文案`
      });
      const copyStartedAt = Date.now();
      try {
        const copy = await generateText({
          config: textConnection.config,
          apiKey: textConnection.apiKey,
          prompt: buildCopyPrompt(plan, facts),
          model: String(options.textModel || textConnection.config.model).trim() || textConnection.config.model
        });
        fs.writeFileSync(copyFile, `${copy}\n`, "utf8");
        job.results.push({
          type: "copy",
          work: plan.materialName,
          outputFile: copyFile,
          bytes: Buffer.byteLength(copy),
          durationMs: Date.now() - copyStartedAt
        });
      } catch (error) {
        job.failures.push({
          work: plan.materialName,
          phase: "copy",
          message: String(error?.message || error).slice(0, 500)
        });
      }
    }
    updateProductionJob(job, {
      phase: "quality-check",
      message: `正在检查 ${plan.materialName} 的数量、尺寸、重复图和文案`
    });
    const quality = await inspectProductionQuality({
      plan,
      outputRoot,
      results: job.results,
      startedAt: job.startedAt,
      finishedAt: new Date().toISOString()
    });
    const qualityJsonFile = path.join(outputRoot, "质量报告.json");
    const qualityTextFile = path.join(outputRoot, "质量报告.txt");
    job.qualityReports.push({ ...quality, reportFile: qualityTextFile });
    writeJson(qualityJsonFile, quality);
    fs.writeFileSync(qualityTextFile, qualityReportText(quality), "utf8");
    writeJson(path.join(outputRoot, "生产记录.json"), {
      status: quality.status,
      createdAt: new Date().toISOString(),
      plan,
      provider: config.provider,
      imageModel: config.model,
      textModel: options.textModel || textConnection.config.model,
      requestSummary: productionRequestSummary(job.results, plan.materialName),
      failedRequests: job.failures.filter((item) => item.work === plan.materialName && item.phase === "image"),
      quality,
      officialLibraryWritten: false,
      files: job.results.filter((item) => item.work === plan.materialName).map((item) => item.outputFile)
    });
  }
  if (job.cancelRequested) {
    updateProductionJob(job, {
      status: "cancelled",
      phase: "cancelled",
      finishedAt: new Date().toISOString(),
      message: "任务已停止，已完成页面和文案均已保留，可稍后继续。"
    });
    return;
  }
  const hasQualityFailures = job.qualityReports.some((report) => report.failures?.length);
  const finalStatus = job.failures.length || hasQualityFailures ? "needs-rework" : "review-ready";
  updateProductionJob(job, {
    status: finalStatus,
    phase: "completed",
    progress: completed,
    finishedAt: new Date().toISOString(),
    message: finalStatus === "review-ready"
      ? `${planBundle.plans.length} 套作品已生成并完成自动检查；请按质量报告做最终看图确认。`
      : `本批已继续完成可生成页面；有 ${job.failures.length} 项需要重试或人工处理。`
  });
}

function mergeCollectionLedger(collections) {
  const saved = readJson(COLLECTION_LEDGER_FILE, { records: [] });
  const existing = new Map((saved.records || []).map((record) => [record.name, record]));
  let changed = false;
  const records = collections.map((collection) => {
    const previous = existing.get(collection.name);
    if (previous) return previous;
    changed = true;
    return {
      name: collection.name,
      type: collection.type,
      tags: [],
      note: "",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
  const activeNames = new Set(collections.map((collection) => collection.name));
  (saved.records || []).forEach((record) => {
    if (!activeNames.has(record.name)) records.push({ ...record, missing: true });
  });
  if (changed || !exists(COLLECTION_LEDGER_FILE)) {
    writeJson(COLLECTION_LEDGER_FILE, { version: 1, records });
  }
  const recordMap = new Map(records.map((record) => [record.name, record]));
  return collections.map((collection) => {
    const record = recordMap.get(collection.name);
    return {
      ...collection,
      type: collection.type,
      typeLabel: collection.typeLabel,
      ledger: record || null
    };
  });
}

function decorateCollectionWorks(collection) {
  const works = collection?.sourceValid && collection?.sourcePath
    ? inspectWorks(collection.sourcePath)
    : [];
  const distributionLedger = readWorkDistributionLedger(WORK_DISTRIBUTION_LEDGER_FILE);
  const automaticWorks = works.map((work) => ({
    ...work,
    automatic: inferWorkTagGroups({
      name: work.name,
      text: work.textPreview,
      tags: work.tags,
      contentType: work.contentType,
      collectionType: collection.type
    })
  }));
  const tagLedger = syncWorkTagLedger(WORK_TAG_LEDGER_FILE, automaticWorks).ledger;
  const decoratedWorks = automaticWorks.map((work) => {
    const distribution = workDistributionEligibility(distributionLedger, work.workId);
    const business = tagLedger.entries?.[work.workId]?.effective || work.automatic;
    // “微信公众号”只是兼容旧工作流的物理阶段，不等于其中每篇作品都已发到抖音/小红书。
    // 只有成功分发账本命中当前 workId，才把这篇作品视为移动端已用。
    const hasSuccessfulDeviceDistribution = distribution.duplicateBlocked === true;
    const platformUsage = mergePlatformUsage(
      work.platformUsage,
      tagLedger.entries?.[work.workId]?.platformUsage,
      work.tags,
      hasSuccessfulDeviceDistribution
        ? { douyin_xiaohongshu: { source: "legacy_device_distribution" } }
        : {}
    );
    const usageCount = platformUsageCount(platformUsage);
    const platformTags = platformUsageTagGroups(platformUsage);
    const platformEligibility = Object.fromEntries(
      ["wechat", "douyin", "xiaohongshu", "ctrip", "x"].map((platform) => [
        platform,
        platformUsageEligibility({ platformUsage }, platform)
      ])
    );
    const system = deriveSystemTagGroups({
      imageCount: work.imageCount,
      textCount: work.textCount,
      usageCount,
      workflowStage: collection.workflowStage,
      distributed: hasSuccessfulDeviceDistribution
    });
    return {
      ...work,
      usageCount,
      platformUsage,
      platformEligibility,
      tags: [...new Set([
        ...(work.tags || []),
        ...Object.values(business).flat(),
        ...(platformTags.publish || [])
      ])],
      tagGroups: { ...business, ...system, ...platformTags },
      tagSources: {
        automatic: work.automatic,
        manual: tagLedger.entries?.[work.workId]?.manual || {},
        platformUsage
      },
      distribution
    };
  });
  const alreadyDistributedWorks = decoratedWorks.filter((work) => !work.distribution.automaticEligible);
  return {
    ...collection,
    works: decoratedWorks,
    workCount: decoratedWorks.length,
    alreadyDistributedWorkCount: alreadyDistributedWorks.length,
    automaticEligible: collection.automaticEligible === true && alreadyDistributedWorks.length === 0,
    dualPlatformEligible: collection.dualPlatformEligible === true && alreadyDistributedWorks.length === 0,
    manualResendRequiresConfirmation: alreadyDistributedWorks.length > 0,
    firstDistribution: alreadyDistributedWorks[0]?.distribution?.firstDistribution || null,
    exclusionReasons: alreadyDistributedWorks.length
      ? [...new Set([...(collection.exclusionReasons || []), "作品中已有成功分发记录，不能再次自动分发"])]
      : (collection.exclusionReasons || [])
  };
}

function decorateCollectionsWithWorks(collections) {
  return (collections || []).map(decorateCollectionWorks);
}

function updateCollectionLedger(body) {
  const name = String(body.name || "").trim();
  if (!name) throw new Error("作品集名称不能为空");
  const data = readJson(COLLECTION_LEDGER_FILE, { version: 1, records: [] });
  const record = (data.records || []).find((item) => item.name === name);
  if (!record) throw new Error("作品集台账中不存在该记录，请先刷新作品集");
  const type = String(body.type || record.type);
  if (!["traffic", "conversion", "unclassified"].includes(type)) {
    throw new Error("作品集类型无效");
  }
  const tags = Array.isArray(body.tags)
    ? body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20)
    : [];
  Object.assign(record, {
    type,
    tags: Array.from(new Set(tags)),
    note: String(body.note || "").trim().slice(0, 500),
    enabled: body.enabled !== false,
    missing: false,
    updatedAt: new Date().toISOString()
  });
  writeJson(COLLECTION_LEDGER_FILE, data);
  return record;
}

function mergeDeviceNotes(devices) {
  const saved = readJson(DEVICE_NOTES_FILE, { version: 1, notes: {} });
  const notes = saved && typeof saved.notes === "object" ? saved.notes : {};
  const approvedKeys = readDeviceDistributionApprovals().keys;
  return decorateTrustedDevices((devices || []).map((device) => {
    const hasSavedNote = Object.prototype.hasOwnProperty.call(notes, device.id);
    const syncedName = String(device.displayName || device.name || device.model || "").trim();
    return {
      ...device,
      // `note` is the computer-side presentation label.  Keep the source
      // device identity available separately so a phone refresh can update
      // its reported name/model without overwriting a user's remark.
      note: String(hasSavedNote ? notes[device.id] : device.localRemark || "").trim(),
      noteIsCustom: hasSavedNote,
      syncedName,
      syncedModel: String(device.models?.[0] || device.model || "").trim()
    };
  }), approvedKeys);
}

function readDeviceDistributionApprovals() {
  const saved = readJson(DEVICE_DISTRIBUTION_APPROVALS_FILE, { version: 1, approvals: {} });
  const approvals = saved && typeof saved.approvals === "object" && saved.approvals
    ? saved.approvals : {};
  return { version: 1, approvals, keys: Object.keys(approvals) };
}

function normalizeDeviceTarget(value) {
  return String(value || "").toLowerCase()
    .replace(/[（(][^）)]*作品数[^）)]*[）)]/g, "")
    .replace(/[\s（）()·_\-/\\]+/g, "");
}

function matchesDeviceTarget(device = {}, target = "") {
  const wanted = normalizeDeviceTarget(target);
  if (!wanted) return false;
  const values = [
    device.id, device.displayName, device.name, device.liveName, device.model,
    ...(Array.isArray(device.models) ? device.models : []),
    ...(Array.isArray(device.aliases) ? device.aliases : [])
  ].map(normalizeDeviceTarget).filter(Boolean);
  return values.some((value) => value === wanted || value.includes(wanted) || wanted.includes(value));
}

function approveDistributionDevice(body = {}) {
  const target = String(body.device || body.name || body.id || "").trim();
  const model = String(body.model || "").trim();
  const liveRecords = readJson(DEVICE_PRESENCE_FILE, { onlineDevices: [] }).onlineDevices || [];
  const live = liveRecords.find((record) => record.current !== false
    && (matchesDeviceTarget(record, target) || (model && matchesDeviceTarget(record, model))));
  const registered = findRegisteredDevice(registeredDevices(), target)
    || (model ? findRegisteredDevice(registeredDevices(), model) : null);
  if (!live && !registered) throw new Error("设备当前未连接，请在手机上打开接收端后重试");
  const candidate = registered || {
    id: target || model,
    displayName: target || live?.name || model || live?.model,
    name: live?.name || target,
    model: live?.model || model,
    models: [live?.model || model].filter(Boolean),
    aliases: [live?.name || target].filter(Boolean)
  };
  const key = deviceApprovalKey(candidate);
  if (!key) throw new Error("无法识别设备唯一标识，请重新连接手机");
  const saved = readDeviceDistributionApprovals();
  saved.approvals[key] = {
    key,
    deviceId: registered?.id || "",
    name: candidate.displayName || candidate.name || "",
    model: candidate.model || candidate.models?.[0] || "",
    approvedAt: new Date().toISOString()
  };
  writeJson(DEVICE_DISTRIBUTION_APPROVALS_FILE, { version: 1, approvals: saved.approvals });
  automaticDistributionSessions.clear();
  return { ok: true, approval: saved.approvals[key], approvedDeviceKeys: Object.keys(saved.approvals) };
}

function getPageSettings() {
  const local = readJson(APP_SETTINGS_FILE, {});
  return normalizePageSettings(local.pageSettings || {});
}

function configuredDistributionSendRoots(distributionSettings = {}) {
  // The work-package library is the normal source of truth. These roots were
  // a legacy escape hatch and are ignored unless an old installation opts in.
  if (distributionSettings.legacyAdditionalRootsEnabled !== true) return [];
  const roots = distributionSettings.defaultSendRoots || {};
  const entries = [
    { root: roots.traffic, category: "traffic" },
    { root: roots.conversion, category: "conversion" }
  ]
    .map((entry) => ({ ...entry, root: String(entry.root || "").trim() }))
    .filter((entry) => entry.root);
  if (entries.length) return entries;
  const legacyRoot = String(distributionSettings.defaultSendRoot || "").trim();
  return legacyRoot ? [{ root: legacyRoot, category: "" }] : [];
}

function savePageSettings(body = {}) {
  const current = readJson(APP_SETTINGS_FILE, {});
  const pageSettings = normalizePageSettings({
    ...getPageSettings(),
    ...body,
    skills: { ...getPageSettings().skills, ...(body.skills || {}) },
    moments: { ...getPageSettings().moments, ...(body.moments || {}) },
    production: { ...getPageSettings().production, ...(body.production || {}) },
    distribution: { ...getPageSettings().distribution, ...(body.distribution || {}) },
    backup: { ...getPageSettings().backup, ...(body.backup || {}) },
    gptAuto: { ...getPageSettings().gptAuto, ...(body.gptAuto || {}) }
  });
  if (pageSettings.production.templateRoot) {
    const templateRoot = path.resolve(pageSettings.production.templateRoot);
    if (!exists(templateRoot) || !fs.statSync(templateRoot).isDirectory()) {
      throw new Error("模板库目录不存在或不是文件夹");
    }
    pageSettings.production.templateRoot = templateRoot;
  }
  if (pageSettings.moments.libraryRoot) {
    const libraryRoot = path.resolve(pageSettings.moments.libraryRoot);
    if (!exists(libraryRoot) || !fs.statSync(libraryRoot).isDirectory()) {
      throw new Error("朋友圈素材库目录不存在或不是文件夹");
    }
    pageSettings.moments.libraryRoot = libraryRoot;
  }
  if (pageSettings.production.packedRoot) {
    const packedRoot = path.resolve(pageSettings.production.packedRoot);
    if (!exists(packedRoot) || !fs.statSync(packedRoot).isDirectory()) {
      throw new Error("已打包库目录不存在或不是文件夹");
    }
    pageSettings.production.packedRoot = packedRoot;
  }
  if (pageSettings.backup.sourceRoot) {
    const sourceRoot = path.resolve(pageSettings.backup.sourceRoot);
    if (!exists(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
      throw new Error("大文件备份来源目录不存在或不是文件夹");
    }
    pageSettings.backup.sourceRoot = sourceRoot;
  }
  writeJson(APP_SETTINGS_FILE, { ...current, pageSettings });
  return pageSettings;
}

function registeredDevices() {
  return mergeDeviceNotes(readJson(DEVICE_REGISTRY_FILE, { devices: [] }).devices || []);
}

function hasCurrentDevicePresence(records, registered, target, deviceModel = "") {
  const candidates = [
    target,
    deviceModel,
    registered?.displayName,
    registered?.name,
    ...(registered?.aliases || []),
    ...(registered?.models || [])
  ].filter(Boolean);
  return (Array.isArray(records) ? records : []).some((record) =>
    record.current !== false && candidates.some((candidate) => matchesDeviceTarget(record, candidate))
  );
}

function assertDiscoveredDeviceTarget(target, options = {}) {
  const registered = findRegisteredDevice(registeredDevices(), target);
  if (registered) {
    const liveRecords = readJson(DEVICE_PRESENCE_FILE, { onlineDevices: [] }).onlineDevices || [];
    if (!hasCurrentDevicePresence(liveRecords, registered, target, options.deviceModel)) {
      throw new Error("设备当前未连接，请先在手机上打开接收端并刷新设备");
    }
    if (options.approveDevice === true && registered.firstConfirmationRequired) {
      approveDistributionDevice({ device: target, model: options.deviceModel });
      return findRegisteredDevice(registeredDevices(), target) || registered;
    }
    return registered;
  }
  const liveRecords = readJson(DEVICE_PRESENCE_FILE, { onlineDevices: [] }).onlineDevices || [];
  const live = liveRecords.find((record) => record.current !== false && (
    matchesDeviceTarget(record, target)
      || (options.deviceModel && matchesDeviceTarget(record, options.deviceModel))
  ));
  if (!live) throw new Error("设备当前未连接，请先在手机上打开接收端");
  const discovered = {
    id: deviceApprovalKey(live) || `discovered-${normalizeDeviceTarget(live.model || live.name)}`,
    displayName: String(live.name || live.model || target).replace(/[（(][^）)]*作品数[^）)]*[）)]/g, "").trim(),
    name: live.name || target,
    model: live.model || options.deviceModel || "",
    models: [live.model || options.deviceModel].filter(Boolean),
    aliases: [live.name, target].filter(Boolean),
    trusted: true
  };
  if (options.approveDevice === true) {
    approveDistributionDevice({ device: target, model: discovered.model });
    discovered.autoDistributionApproved = true;
    discovered.firstConfirmationRequired = false;
  }
  return discovered;
}

// The UI uses stable business aliases (for example "6号") while the
// transport script matches the name/model reported by the receiver. Resolve
// the alias once at the server boundary so manual and automatic sends use the
// same canonical live target. Falling back to the supplied model/target keeps
// direct-discovered devices working when the presence snapshot is momentarily
// stale; assertDiscoveredDeviceTarget has already enforced that the device is
// currently reachable.
function resolveDeviceTransportTarget(target, deviceModel = "", registered = null, recordsOverride = null) {
  const records = recordsOverride || readJson(DEVICE_PRESENCE_FILE, { onlineDevices: [] }).onlineDevices || [];
  const candidates = [
    target,
    deviceModel,
    registered?.displayName,
    registered?.name,
    ...(registered?.aliases || []),
    ...(registered?.models || [])
  ].filter(Boolean);
  const live = (Array.isArray(records) ? records : []).find((record) =>
    record.current !== false
      && candidates.some((candidate) => matchesDeviceTarget(record, candidate))
  );
  return live
    ? deviceTransportTarget(live, deviceModel || target)
    : String(deviceModel || target || "").trim();
}

function appendAutomationLog(event) {
  invalidateLiveDistributionSnapshot();
  fs.mkdirSync(path.dirname(DISTRIBUTION_AUTOMATION_LOG_FILE), { recursive: true });
  fs.appendFileSync(DISTRIBUTION_AUTOMATION_LOG_FILE, `${JSON.stringify({
    time: new Date().toISOString(),
    ...event
  })}\n`, "utf8");
}

function recentAutomationLogs(limit = 30) {
  if (!exists(DISTRIBUTION_AUTOMATION_LOG_FILE)) return [];
  return fs.readFileSync(DISTRIBUTION_AUTOMATION_LOG_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.max(1, Math.min(100, Number(limit) || 30)))
    .reverse()
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function updateDeviceNote(body) {
  const id = String(body.id || "").trim();
  if (!id) throw new Error("设备标识不能为空");
  const registry = readJson(DEVICE_REGISTRY_FILE, { devices: [] });
  const presence = readJson(DEVICE_PRESENCE_FILE, { onlineDevices: [] }).onlineDevices || [];
  const known = registry.devices?.some((device) => device.id === id)
    || id.startsWith("discovered-")
    || presence.some((device) => `discovered-${normalizeDeviceTarget(device.model || device.name)}` === id);
  if (!known) throw new Error("设备不存在");
  const note = String(body.note || "").trim().slice(0, 100);
  const saved = readJson(DEVICE_NOTES_FILE, { version: 1, notes: {} });
  saved.version = 1;
  saved.notes = saved.notes && typeof saved.notes === "object" ? saved.notes : {};
  saved.notes[id] = note;
  saved.updatedAt = new Date().toISOString();
  writeJson(DEVICE_NOTES_FILE, saved);
  return { ok: true, id, note };
}

function collectionLedgerCsv() {
  const distribution = getDistributionSnapshot({
    publishRoot: PUBLISH_ROOT,
    libraryRoot: getWorkspaceSettings().workPackage.libraryPath
  });
  const collections = mergeCollectionLedger(distribution.collections || []);
  const escapeCell = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [
    ["作品集", "内容类型", "标签", "备注", "小红书", "抖音", "公众号", "作品数", "源文件夹", "更新时间"],
    ...collections.map((item) => [
      item.name,
      item.typeLabel,
      (item.ledger?.tags || []).join("|"),
      item.ledger?.note || "",
      item.xhs,
      item.douyin === "archived" ? "used" : item.douyin,
      item.officialAccount,
      item.itemCount || 0,
      item.sourcePath || "",
      item.ledger?.updatedAt || ""
    ])
  ];
  return `\ufeff${rows.map((row) => row.map(escapeCell).join(",")).join("\r\n")}\r\n`;
}

function buildDefaultState() {
  return {
    selectedMaterialCategory: "",
    selectedMaterialCategoryPath: "",
    selectedMaterial: "",
    selectedTemplate: "T01",
    currentProductionPair: {},
    paneWidths: {
      left: 286,
      right: 390
    },
    selectedProduct: "",
    activeTab: "gptProductionTest",
    updatedAt: new Date().toISOString()
  };
}

function sanitizeState(state) {
  const clean = { ...state };
  delete clean.productionMode;
  delete clean.selectedTemplateUsage;
  return clean;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function hydrateAutomaticDistributionBlockedDevices() {
  if (automaticDistributionBlockedDevicesHydrated) return;
  automaticDistributionBlockedDevicesHydrated = true;
  if (!exists(DISTRIBUTION_AUTOMATION_LOG_FILE)) return;
  let events = [];
  try {
    events = fs.readFileSync(DISTRIBUTION_AUTOMATION_LOG_FILE, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-500)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return;
  }
  const states = new Map();
  for (const event of events) {
    const identity = event.deviceModel || event.deviceName || event.deviceId;
    if (!identity) continue;
    const key = event.deviceModel || event.deviceName
      ? devicePresenceKey({ model: event.deviceModel, name: event.deviceName })
      : `id:${String(event.deviceId).trim().toLowerCase()}`;
    if (["started", "item-completed", "completed"].includes(event.event)) {
      states.delete(key);
      continue;
    }
    if (!["blocked", "failed", "retrying"].includes(event.event)) continue;
    const classification = classifyAutomaticDistributionError(event.message || "");
    if (!classification.retryable) {
      states.set(key, {
        code: classification.code,
        message: classification.message,
        blockedAt: Date.parse(event.time || "") || Date.now()
      });
    }
  }
  states.forEach((state, key) => automaticDistributionBlockedDevices.set(key, state));
}

function latestConversionRuntimeJson(prefix) {
  try {
    const files = fs.readdirSync(CONVERSION_RUNTIME_ROOT)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .map((name) => {
        const file = path.join(CONVERSION_RUNTIME_ROOT, name);
        const stat = fs.statSync(file);
        return { name, file, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = files[0];
    if (!latest) return null;
    return {
      name: latest.name,
      updatedAt: new Date(latest.mtimeMs).toISOString(),
      data: readJson(latest.file, null)
    };
  } catch {
    return null;
  }
}

function getConversionSyncStatus() {
  const api = latestConversionRuntimeJson("WeFlow API增量同步-");
  const weekly = latestConversionRuntimeJson("每周增量更新-");
  const snapshot = latestConversionRuntimeJson("工作台增量快照-");
  const formalFile = path.join(CONVERSION_RUNTIME_ROOT, "SOP正式知识库.json");
  const formalData = readJson(formalFile, null);
  let formalUpdatedAt = "";
  try {
    formalUpdatedAt = formalData?.生成时间 || new Date(fs.statSync(formalFile).mtimeMs).toISOString();
  } catch {
    formalUpdatedAt = formalData?.生成时间 || "";
  }
  const apiData = api?.data || {};
  const weeklyData = weekly?.data || {};
  // 累计候选状态是运行层的唯一总量真源。兜底快照可能来自旧批次，不能覆盖它。
  const candidateState = readJson(path.join(CONVERSION_RUNTIME_ROOT, "WeFlow API候选累计.json"), null) || {};
  const candidateMessages = Number(
    candidateState.pendingMessages
      ?? apiData.pendingMessages
      ?? snapshot?.data?.candidateTotals?.messages
      ?? snapshot?.data?.counts?.pulledMessages
      ?? apiData.pulledMessages
      ?? 0
  );
  const candidateChangedSessions = Number(
    candidateState.pendingChangedSessions
      ?? apiData.pendingChangedSessions
      ?? snapshot?.data?.candidateTotals?.changedSessions
      ?? snapshot?.data?.counts?.changedSessions
      ?? apiData.changedSessions
      ?? 0
  );
  const candidate = {
    apiSessions: Number(candidateState.apiSessions ?? apiData.apiSessions ?? snapshot?.data?.apiSessions ?? 0),
    changedSessions: candidateChangedSessions,
    messages: candidateMessages,
    formalWrite: apiData.formalWrite === true,
    updatedAt: candidateState.updatedAt || apiData.checkedAt || snapshot?.data?.updatedAt || api?.updatedAt || ""
  };
  const deferred = apiData.syncStatus === "deferred_api_unavailable"
    || weeklyData.status === "completed_with_deferred_api"
    || apiData.apiCurrentlyAvailable === false;
  return {
    status: deferred ? "candidate_pending" : candidate.formalWrite ? "formal_updated" : "ready",
    formal: {
      status: formalData ? "ready" : "missing",
      version: formalData?.版本 || "",
      questionCount: Number(formalData?.总问题数 || 0),
      updatedAt: formalUpdatedAt
    },
    candidate,
    api: {
      available: apiData.apiCurrentlyAvailable !== false,
      checkedAt: apiData.checkedAt || api?.updatedAt || "",
      reason: apiData.reason || weeklyData.apiHealthDetail || ""
    },
    lastRun: {
      status: weeklyData.status || apiData.syncStatus || "unknown",
      checkedAt: weeklyData.checkedAt || apiData.checkedAt || weekly?.updatedAt || "",
      snapshotAt: snapshot?.data?.updatedAt || snapshot?.updatedAt || ""
    },
    confirmedDirection: apiData.userConfirmedDirection || snapshot?.data?.userConfirmedDirection || "",
    nextStep: weeklyData.nextStep || apiData.nextStep || "恢复 API 后按游标继续，再审核候选并重建正式 SOP。"
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function safeList(dir, options = {}) {
  try {
    const includeHidden = options.includeHidden === true;
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => includeHidden || !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  } catch {
    return [];
  }
}

function toUrl(filePath) {
  return `/file?path=${encodeURIComponent(filePath)}`;
}

function readTextPreview(dir) {
  const files = safeList(dir).filter((entry) => entry.isFile());
  const textFile = files.find((entry) => entry.name.toLowerCase() === "text.txt")
    || files.find((entry) => textExts.has(path.extname(entry.name).toLowerCase()));
  if (!textFile) return "";
  try {
    const full = path.join(dir, textFile.name);
    const text = fs.readFileSync(full, "utf8").replace(/\s+/g, " ").trim();
    return text.slice(0, 280);
  } catch {
    return "";
  }
}


const tagRules = MATERIAL_TAG_RULES;

function readHiddenTags(dir) {
  const file = path.join(dir, ".tags.json");
  if (!exists(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    const tags = Array.isArray(data) ? data : data.tags;
    return Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function inferMaterialTags(categoryName, itemName, preview) {
  const haystack = `${categoryName || ""} ${itemName || ""} ${preview || ""}`.toLowerCase();
  const tags = [];
  tagRules.forEach(([tag, keywords]) => {
    if (keywords.some((keyword) => haystack.includes(String(keyword).toLowerCase()))) tags.push(tag);
  });
  const monthMatches = haystack.match(/(?:^|[^0-9])([1-9]|1[0-2])\s*(?:月|月份|🈷)/g) || [];
  monthMatches.forEach((match) => {
    const number = match.match(/([1-9]|1[0-2])/)?.[1];
    if (number) tags.push(`${number}月`);
  });
  return Array.from(new Set(tags));
}
function listImageEntries(dir) {
  return safeList(dir)
    .filter((entry) => entry.isFile() && imageExts.has(path.extname(entry.name).toLowerCase()));
}

function scanPostFolders(rootPath, options = {}) {
  const root = path.resolve(rootPath);
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 20;
  const maxDirectories = Number.isFinite(options.maxDirectories)
    ? options.maxDirectories
    : 10000;
  if (!exists(root) || !fs.statSync(root).isDirectory()) return [];

  const posts = [];
  const queue = [{ directory: root, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < maxDirectories) {
    const current = queue.shift();
    visited += 1;
    const entries = safeList(current.directory, { includeHidden: options.includeHidden === true });
    const files = entries.filter((entry) => entry.isFile());
    const imageCount = files.filter((entry) =>
      imageExts.has(path.extname(entry.name).toLowerCase())
    ).length;
    const textCount = files.filter((entry) =>
      textExts.has(path.extname(entry.name).toLowerCase())
    ).length;
    const relativePath = path.relative(root, current.directory);
    const relativeDepth = relativePath
      ? relativePath.split(path.sep).filter(Boolean).length
      : 0;

    if (relativeDepth > 0 && imageCount > 0 && textCount > 0) {
      let updatedAt = null;
      try {
        updatedAt = fs.statSync(current.directory).mtime.toISOString();
      } catch {
        updatedAt = null;
      }
      posts.push({
        name: path.basename(current.directory),
        path: current.directory,
        relativePath,
        relativeDepth,
        imageCount,
        textCount,
        updatedAt
      });
      continue;
    }

    if (current.depth >= maxDepth) continue;
    entries.forEach((entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) return;
      queue.push({
        directory: path.join(current.directory, entry.name),
        depth: current.depth + 1
      });
    });
  }
  return posts.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "zh-Hans-CN")
  );
}

function scanMaterialFolderDiagnostics(rootPath, options = {}) {
  const root = path.resolve(rootPath);
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 20;
  const maxDirectories = Number.isFinite(options.maxDirectories) ? options.maxDirectories : 10000;
  const emptyResult = () => ({
    readyCount: 0,
    invalidCount: 0,
    reasons: { missingText: 0, missingImage: 0, empty: 0 },
    direct: { total: 0, ready: 0, missingText: 0, missingImage: 0, empty: 0, containers: 0 },
    nested: { total: 0, ready: 0, missingText: 0, missingImage: 0, empty: 0, containers: 0 },
    collection: {
      candidateCount: 0,
      recognizedLocationCount: 0,
      unclassifiedCount: 0,
      locations: [],
      formats: [],
      activities: [],
      seasons: [],
      queries: [],
      candidates: []
    },
    issues: []
  });
  if (!exists(root) || !fs.statSync(root).isDirectory()) return emptyResult();

  const direct = emptyResult().direct;
  const nested = emptyResult().nested;
  const issues = [];
  const queue = [{ directory: root, depth: 0 }];
  let visited = 0;
  let readyCount = 0;
  const collectionEntries = [];
  while (queue.length && visited < maxDirectories) {
    const current = queue.shift();
    visited += 1;
    const entries = safeList(current.directory);
    const files = entries.filter((entry) => entry.isFile());
    const directories = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
    const hasImage = files.some((entry) => imageExts.has(path.extname(entry.name).toLowerCase()));
    const hasText = files.some((entry) => textExts.has(path.extname(entry.name).toLowerCase()));
    const bucket = current.depth === 1 ? direct : nested;
    if (current.depth > 0) bucket.total += 1;

    if (current.depth > 0 && hasImage && hasText) {
      bucket.ready += 1;
      readyCount += 1;
      continue;
    }

    if (current.depth > 0) {
      let reason = "";
      if (hasImage && !hasText) {
        bucket.missingText += 1;
        reason = "missing-text";
        collectionEntries.push({
          name: path.basename(current.directory),
          path: current.directory,
          relativePath: path.relative(root, current.directory),
          bucket: path.relative(root, current.directory).split(path.sep).filter(Boolean)[0] || "",
          imageCount: files.filter((entry) => imageExts.has(path.extname(entry.name).toLowerCase())).length,
          textCount: 0
        });
      } else if (!hasImage && hasText) {
        bucket.missingImage += 1;
        reason = "missing-image";
      } else if (directories.length) {
        bucket.containers += 1;
        reason = "container";
      } else {
        bucket.empty += 1;
        reason = "empty";
      }
      issues.push({
        name: path.basename(current.directory),
        path: current.directory,
        relativePath: path.relative(root, current.directory),
        depth: current.depth,
        reason
      });
    }

    if (current.depth >= maxDepth) continue;
    directories.forEach((entry) => queue.push({
      directory: path.join(current.directory, entry.name),
      depth: current.depth + 1
    }));
  }

  const reasons = {
    missingText: direct.missingText + nested.missingText,
    missingImage: direct.missingImage + nested.missingImage,
    empty: direct.empty + nested.empty
  };
  const collection = analyzeCollectionCandidates(collectionEntries, {
    maxCandidates: Math.max(collectionEntries.length, 2000)
  });
  const collectionByPath = new Map(collection.candidates.map((candidate) => [candidate.path, candidate]));
  const enrichedIssues = issues.map((issue) => {
    if (issue.reason !== "missing-text") return issue;
    const candidate = collectionByPath.get(issue.path);
    if (!candidate) return issue;
    return {
      ...issue,
      collection: {
        normalizedTitle: candidate.normalizedTitle,
        keywords: candidate.keywords,
        suggestedQueries: candidate.suggestedQueries
      }
    };
  });
  const { candidates: _collectionCandidates, ...collectionSummary } = collection;
  return {
    readyCount,
    invalidCount: reasons.missingText + reasons.missingImage + reasons.empty,
    reasons,
    direct,
    nested,
    collection: collectionSummary,
    issues: enrichedIssues
  };
}

function listImages(dir, limit = 18) {
  return listImageEntries(dir)
    .slice(0, limit)
    .map((entry) => {
      const full = path.join(dir, entry.name);
      return {
        name: entry.name,
        path: full,
        url: toUrl(full)
      };
    });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] || "";
    });
    return item;
  });
}

let materialPostCache = null;
let materialLibraryCache = null;
let materialWatcher = null;
let materialCacheStaleTime = 0;
let materialWatcherDebounce = null;

function invalidateMaterialCache() {
  materialLibraryCache = null;
  materialCategoryCache.clear();
  materialCacheStaleTime = Date.now();
}

function startMaterialWatcher() {
  const root = getWorkspaceSettings().materialRoot;
  if (!root || !exists(root)) return;
  if (materialWatcher) {
    try { materialWatcher.close(); } catch { /* ignore */ }
    materialWatcher = null;
  }
  try {
    materialWatcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      if (materialWatcherDebounce) clearTimeout(materialWatcherDebounce);
      materialWatcherDebounce = setTimeout(() => {
        invalidateMaterialCache();
      }, 800);
    });
    materialWatcher.on("error", () => { /* ignore watcher errors, will restart on next refresh */ });
  } catch {
    /* recursive watch may not be supported on all platforms; fail silently */
  }
}

function restartMaterialWatcherIfNeeded() {
  const root = getWorkspaceSettings().materialRoot;
  if (!root || !exists(root)) return;
  if (!materialWatcher) startMaterialWatcher();
}

function materialTreeSignature(root) {
  if (!exists(root)) return "";
  const rows = safeList(root, { includeHidden: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const full = path.join(root, entry.name);
      return `${entry.name}\u0000${safeMtime(full)}`;
    })
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  return rows.join("\u0001");
}

function materialCategoryIndex(root) {
  if (!exists(root)) return [];
  return safeList(root, { includeHidden: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry, index) => {
      const categoryPath = path.join(root, entry.name);
      return {
        id: categoryPath,
        order: index + 1,
        name: entry.name,
        path: categoryPath,
        // Explorer shows this count when the category itself is open. Keep it
        // separate from `count`, which means recursively detected production
        // posts that contain both an image and copy text.
        folderCount: safeList(categoryPath)
          .filter((child) => child.isDirectory() && !child.isSymbolicLink())
          .length,
        folderCountKnown: true
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true }));
}

function materialCategoryCountMap(root, snapshot = readJson(MATERIAL_GLOBAL_INDEX_FILE, null)) {
  const currentRoot = path.resolve(root || "");
  if (!snapshot?.root
    || path.resolve(snapshot.root).toLowerCase() !== currentRoot.toLowerCase()
    || !Array.isArray(snapshot.categories)) {
    return new Map();
  }
  return new Map(snapshot.categories
    .filter((category) => category?.path
      && category.sourceSignature
      && category.sourceSignature === materialTreeSignature(category.path)
      && Number.isInteger(Number(category.count))
      && Number(category.count) >= 0)
    .map((category) => [path.resolve(category.path), Number(category.count)]));
}

function getDetectedMaterialPosts(root, force = false) {
  const categoryRoot = path.resolve(root);
  const sourceSignature = materialTreeSignature(categoryRoot);
  const cached = materialCategoryCache.get(categoryRoot);
  if (!force && cached?.sourceSignature === sourceSignature && Array.isArray(cached.posts)) {
    return cached.posts;
  }
  // 素材数量、诊断和自动队列必须共用同一口径：点号开头的隐藏目录不参与生产。
  const posts = scanPostFolders(categoryRoot);
  const record = {
    root: categoryRoot,
    sourceSignature,
    scannedAt: new Date().toISOString(),
    posts
  };
  materialCategoryCache.set(categoryRoot, record);
  materialPostCache = record;
  return posts;
}

function getMaterialLibrary(force = false, selectedLibraryPath = "", options = {}) {
  const root = getWorkspaceSettings().materialRoot;
  const sourceSignature = materialTreeSignature(root);
  const descriptors = materialCategoryIndex(root);
  const indexedCounts = materialCategoryCountMap(root);
  if (descriptors.some((descriptor) => !indexedCounts.has(path.resolve(descriptor.path)))
    && materialGlobalIndexJob.status !== "running") {
    setImmediate(() => queueMaterialGlobalIndexRefresh({ force: true, materialRoot: root }));
  }
  const requestedPath = selectedLibraryPath ? path.resolve(selectedLibraryPath) : "";
  const requestedCategory = descriptors.find((category) => category.path === requestedPath);
  const selectedCategory = requestedCategory
    || (options.loadDefault === false ? null : descriptors[0] || null);

  function materialItem(post, categoryName, itemIndex) {
    const itemPath = post.path;
    const images = listImages(itemPath, PREVIEW_LIMITS.materialImagesPerItem);
    const textFiles = safeList(itemPath)
      .filter((entry) => entry.isFile() && textExts.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(itemPath, entry.name));
    const preview = readTextPreview(itemPath);
    const tagText = readMaterialTagText(itemPath);
    const tags = Array.from(new Set([...inferMaterialTags(categoryName, post.name, tagText), ...readHiddenTags(itemPath)]));
    const profile = materialMetadataProfile({
      path: itemPath,
      name: post.name,
      preview: tagText,
      imageCount: post.imageCount,
      textCount: post.textCount
    }, categoryName, { materialRoot: root });
    return {
      id: itemPath,
      order: itemIndex + 1,
      name: post.name,
      path: itemPath,
      imageCount: post.imageCount,
      textCount: post.textCount,
      relativePath: post.relativePath,
      images,
      attachments: [...images.map((image) => image.path), ...textFiles].slice(0, 30),
      preview,
      tags,
      folderHash: profile.folderHash,
      mainTag: profile.mainTag,
      mainTagSource: profile.mainTagSource,
      usageCount: profile.usageCount,
      lifecycleState: profile.lifecycleState,
      operationalStatus: profile.operationalStatus,
      conflicts: profile.conflicts,
      contentFingerprint: profile.contentFingerprint,
      lock: profile.lock,
      updatedAt: post.updatedAt || safeMtime(itemPath)
    };
  }

  function categoryFromPosts(descriptor, posts, loaded) {
    const cachedPosts = materialCategoryCache.get(descriptor.path)?.posts;
    const indexedCount = indexedCounts.get(path.resolve(descriptor.path));
    const countKnown = loaded || Array.isArray(cachedPosts) || Number.isInteger(indexedCount);
    const items = posts
      .slice(0, PREVIEW_LIMITS.materialItemsPerCategory)
      .map((post, itemIndex) => materialItem(post, descriptor.name, itemIndex));
    const diagnostics = loaded && options.includeDiagnostics
      ? scanMaterialFolderDiagnostics(descriptor.path)
      : null;
    return {
      ...descriptor,
      count: loaded
        ? posts.length
        : (Array.isArray(cachedPosts) ? cachedPosts.length : (Number.isInteger(indexedCount) ? indexedCount : 0)),
      countKnown,
      visibleCount: items.length,
      loaded,
      diagnostics,
      items: loaded ? items : []
    };
  }

  const loadAll = Boolean(options.loadAll);
  const categories = descriptors.map((descriptor) => {
    const loaded = loadAll || descriptor.path === selectedCategory?.path;
    const posts = loaded ? getDetectedMaterialPosts(descriptor.path, force) : [];
    return categoryFromPosts(descriptor, posts, loaded);
  });
  const library = {
    root,
    recursive: true,
    lazy: true,
    selectedCategoryPath: selectedCategory?.path || "",
    detectionRule: "图片 + 文案",
    categories
  };
  materialLibraryCache = { root, sourceSignature, scannedAt: new Date().toISOString(), library };
  return library;
}

// Automatic production must not wait for a synchronous recursive category
// scan.  The global material index is refreshed independently and already
// contains the lifecycle/usage facts needed for safe low-usage selection.
// Hydrate attachments only for the small number of candidates returned to a
// worker; this keeps the 4327 request loop responsive while preserving the
// existing image + TXT production gate.
function getFastAutomaticMaterialEntries(count = 8, excludedPaths = [], options = {}) {
  const snapshot = readJson(MATERIAL_GLOBAL_INDEX_FILE, null);
  const indexedItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const lifecycle = getMaterialLifecycleLedger(MATERIAL_LIFECYCLE_LEDGER_FILE);
  const lifecycleEntries = lifecycle.entries || {};
  const owner = String(options.owner || "automatic-material-selector").trim() || "automatic-material-selector";
  const now = Date.now();
  const excluded = new Set((Array.isArray(excludedPaths) ? excludedPaths : [excludedPaths])
    .map((value) => path.resolve(String(value || "")).toLowerCase())
    .filter(Boolean));
  const candidates = indexedItems
    .filter((item) => item?.path && exists(item.path))
    .filter((item) => !String(item.path || "").split(/[\\/]+/).some((segment) => segment.startsWith(".")))
    .filter((item) => !excluded.has(path.resolve(item.path).toLowerCase()))
    .filter((item) => Number(item.imageCount || 0) > 0 && Number(item.textCount || 0) > 0)
    // The global index can lag behind the lifecycle ledger after a scan or
    // conflict update. Admission uses the same authoritative canClaimMaterial
    // rule as the later POST /claim boundary, so an automatic batch is filled
    // with claimable materials instead of eight stale review rows.
    .filter((item) => {
      const entry = lifecycleEntries[String(item.folderHash || "")] || null;
      return Boolean(entry && canClaimMaterial(entry, { owner, now }).ok);
    })
    .sort((left, right) => (
      Number(left.usageCount || 0) - Number(right.usageCount || 0)
      || (Date.parse(String(left.updatedAt || "")) || 0) - (Date.parse(String(right.updatedAt || "")) || 0)
      || String(left.path || "").localeCompare(String(right.path || ""), "zh-Hans-CN", { numeric: true })
    ));
  const entries = [];
  for (const indexed of candidates) {
    if (entries.length >= Math.max(1, Math.min(30, Number(count || 1)))) break;
    const images = listImages(indexed.path, 30);
    const textFiles = safeList(indexed.path)
      .filter((entry) => entry.isFile() && textExts.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(indexed.path, entry.name));
    if (!images.length || !textFiles.length) continue;
    entries.push({
      item: {
        ...indexed,
        id: indexed.path,
        images,
        attachments: [...images.map((image) => image.path), ...textFiles].slice(0, 30),
        updatedAt: indexed.updatedAt || safeMtime(indexed.path)
      },
      category: {
        id: indexed.categoryId || "",
        path: indexed.categoryId || "",
        name: indexed.categoryName || ""
      }
    });
  }
  return entries;
}

function compactMaterialItem(item, categoryName, usageByPath = {}, options = {}) {
  const profile = materialMetadataProfile(item, categoryName, options);
  if (profile.hashCacheChanged) options.onHashCacheChanged?.();
  const directUsage = usageByPath[materialUsageKey(item.path)] || null;
  const contentFingerprint = directUsage || !Object.keys(usageByPath).length ? "" : materialUsageFingerprint(item.path);
  const usage = directUsage
    || Object.values(usageByPath).find((entry) => entry.fingerprint && entry.fingerprint === contentFingerprint)
    || null;
  return {
    id: item.id,
    name: item.name,
    path: item.path,
    imageCount: item.imageCount,
    textCount: item.textCount,
    attachments: item.attachments || [],
    folderHash: profile.folderHash,
    mainTag: profile.mainTag,
    mainTagSource: profile.mainTagSource,
    tags: profile.tags,
    tagGroups: profile.tagGroups,
    usageCount: Math.max(profile.usageCount, Number(usage?.usageCount || 0)),
    lifecycleState: profile.lifecycleState,
    operationalStatus: profile.operationalStatus,
    conflicts: profile.conflicts,
    contentFingerprint: profile.contentFingerprint,
    lock: profile.lock,
    usage
  };
}

function compactMaterialIndex(library, categoryId = "") {
  const usageByPath = getMaterialUsageLedger().entries || {};
  const metadata = getMaterialMetadataLedger();
  const hashCache = getMaterialHashCache();
  let hashCacheChanged = false;
  const categories = (library.categories || []).map((category) => ({
    id: category.id,
    name: category.name,
    path: category.path,
    folderCount: category.folderCount,
    folderCountKnown: category.folderCountKnown !== false,
    count: category.count,
    countKnown: category.countKnown !== false,
    loaded: category.id === categoryId && category.loaded !== false,
    items: category.id === categoryId && category.loaded !== false
      ? (category.items || []).map((item) => {
          return compactMaterialItem(item, category.name, usageByPath, {
            metadata,
            cache: hashCache,
            materialRoot: root,
            onHashCacheChanged: () => { hashCacheChanged = true; }
          });
      })
      : []
  }));
  if (hashCacheChanged) writeJson(MATERIAL_HASH_CACHE_FILE, hashCache);
  return {
    root: library.root,
    recursive: library.recursive,
    lazy: true,
    detectionRule: library.detectionRule,
    categories
  };
}

function getLegacyMaterialEvidence(projectRoot = PROJECT_ROOT) {
  const linkFile = path.join(projectRoot, "01-素材库", "素材链接记录.csv");
  const productionFile = path.join(projectRoot, "04-技能库", "运行记录", "制作日志.csv");
  const evidenceByKey = new Map();

  function addEvidence(row, source) {
    const status = String(row["状态"] || "").trim();
    const successful = source === "素材链接记录"
      ? /已生成|完成/.test(status)
      : /完成|结构校准/.test(status) && !/失败|作废|移除/.test(status);
    if (!successful) return;
    const materialId = String(row["素材ID"] || "").trim();
    const folderName = String(row["素材文件夹"] || "").trim();
    const title = String(row["素材标题"] || row["作品标题"] || "").trim();
    const sourcePath = String(row["原始素材路径"] || "").trim();
    const eventKey = [
      materialId || normalizeMatchKey(folderName || title),
      String(row["时间"] || row["添加时间"] || "").trim(),
      String(row["模板ID"] || "").trim()
    ].join("|");
    const previous = evidenceByKey.get(eventKey);
    evidenceByKey.set(eventKey, {
      eventKey,
      materialId,
      folderName: folderName || previous?.folderName || "",
      title: title || previous?.title || "",
      sourcePath: sourcePath || previous?.sourcePath || "",
      status,
      sources: Array.from(new Set([...(previous?.sources || []), source]))
    });
  }

  if (exists(linkFile)) {
    parseCsv(fs.readFileSync(linkFile, "utf8")).forEach((row) => addEvidence(row, "素材链接记录"));
  }
  if (exists(productionFile)) {
    parseCsv(fs.readFileSync(productionFile, "utf8")).forEach((row) => addEvidence(row, "制作日志"));
  }
  return Array.from(evidenceByKey.values());
}

function matchLegacyMaterialEvidence(items, evidenceRows) {
  const byPath = new Map();
  const byName = new Map();
  items.forEach((item) => {
    byPath.set(materialUsageKey(item.path), item);
    const key = normalizeMatchKey(item.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(item);
  });
  const matched = new Map();
  const review = [];

  evidenceRows.forEach((evidence) => {
    const pathCandidates = [];
    if (evidence.sourcePath) {
      pathCandidates.push(evidence.sourcePath);
      if (evidence.folderName) pathCandidates.push(path.join(evidence.sourcePath, evidence.folderName));
    }
    let candidates = pathCandidates
      .map((candidate) => byPath.get(materialUsageKey(candidate)))
      .filter(Boolean);
    if (!candidates.length) {
      const nameKeys = Array.from(new Set([
        normalizeMatchKey(evidence.folderName),
        normalizeMatchKey(path.basename(evidence.sourcePath || "")),
        normalizeMatchKey(evidence.title)
      ].filter(Boolean)));
      candidates = Array.from(new Set(nameKeys.flatMap((key) => byName.get(key) || [])));
    }
    if (candidates.length === 1) {
      const item = candidates[0];
      if (!matched.has(item.folderHash)) matched.set(item.folderHash, []);
      matched.get(item.folderHash).push(evidence);
      return;
    }
    review.push({
      eventKey: evidence.eventKey,
      materialId: evidence.materialId,
      name: evidence.folderName || evidence.title || evidence.materialId,
      reason: candidates.length ? "发现多个同名素材文件夹" : "历史路径已变化且未找到唯一同名文件夹",
      candidates: candidates.slice(0, 10).map((item) => ({ name: item.name, path: item.path }))
    });
  });

  return { matched, review };
}

function applyLegacyMaterialEvidence(items, evidenceRows, options = {}) {
  const ledgerFile = options.ledgerFile || MATERIAL_METADATA_LEDGER_FILE;
  const ledger = options.ledger || getMaterialMetadataLedger(ledgerFile);
  const result = matchLegacyMaterialEvidence(items, evidenceRows);
  const now = new Date().toISOString();
  let importedEvents = 0;

  result.matched.forEach((evidence, folderHash) => {
    const item = items.find((candidate) => candidate.folderHash === folderHash);
    const previous = ledger.entries?.[folderHash] || {};
    const previousKeys = new Set(previous.importedEvidenceKeys || []);
    const newEvidence = evidence.filter((entry) => !previousKeys.has(entry.eventKey));
    if (!newEvidence.length) return;
    newEvidence.forEach((entry) => previousKeys.add(entry.eventKey));
    importedEvents += newEvidence.length;
    const record = {
      ...previous,
      folderHash,
      entryPath: item.path,
      name: item.name,
      usageCount: Math.max(0, Number(previous.usageCount || 0)) + newEvidence.length,
      importedEvidenceKeys: Array.from(previousKeys),
      usageSource: "历史日志 + 扩展实时记录",
      updatedAt: now
    };
    ledger.entries = { ...(ledger.entries || {}), [folderHash]: record };
    ledger.events = [...(ledger.events || []), ...newEvidence.map((entry) => ({
      folderHash,
      entryPath: item.path,
      action: "import-legacy-usage",
      evidenceKey: entry.eventKey,
      sources: entry.sources,
      recordedAt: now
    }))].slice(-3000);
  });

  if (importedEvents) {
    ledger.updatedAt = now;
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    writeJson(ledgerFile, ledger);
  }
  return { ...result, ledger, importedEvents };
}

function materialIndexStats(items, review = []) {
  const byMainTag = Object.fromEntries(MATERIAL_MAIN_TAGS.map((tag) => [tag, 0]));
  const byUsage = { unused: 0, once: 0, twice: 0, threePlus: 0, used: 0 };
  items.forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(byMainTag, item.mainTag)) byMainTag[item.mainTag] += 1;
    const count = Math.max(0, Number(item.usageCount || 0));
    if (count === 0) byUsage.unused += 1;
    if (count === 1) byUsage.once += 1;
    if (count === 2) byUsage.twice += 1;
    if (count >= 3) byUsage.threePlus += 1;
    if (count > 0) byUsage.used += 1;
  });
  return { total: items.length, byMainTag, byUsage, review: review.length };
}

function materialGlobalIndexPublic(snapshot = null) {
  const saved = snapshot || readJson(MATERIAL_GLOBAL_INDEX_FILE, null);
  return {
    status: materialGlobalIndexJob.status,
    startedAt: materialGlobalIndexJob.startedAt,
    completedAt: materialGlobalIndexJob.completedAt || saved?.generatedAt || "",
    currentCategory: materialGlobalIndexJob.currentCategory,
    processedCategories: materialGlobalIndexJob.processedCategories,
    totalCategories: materialGlobalIndexJob.totalCategories || Number(saved?.categories?.length || 0),
    indexedItems: materialGlobalIndexJob.status === "running"
      ? materialGlobalIndexJob.indexedItems
      : Number(saved?.stats?.total || 0),
    error: materialGlobalIndexJob.error,
    generatedAt: saved?.generatedAt || "",
    root: saved?.root || getWorkspaceSettings().materialRoot,
    stats: saved?.stats || materialIndexStats([]),
    evidence: saved?.evidence || { total: 0, matchedFolders: 0, importedEvents: 0, pendingReview: 0 },
    categories: saved?.categories || [],
    items: saved?.items || [],
    review: saved?.review || []
  };
}

function findMaterialGlobalIndexEntry(folderName = "") {
  const targetName = String(folderName || "").trim();
  if (targetName.length < 8) return null;
  const snapshot = readJson(MATERIAL_GLOBAL_INDEX_FILE, null);
  const item = snapshot?.items?.find((candidate) =>
    String(candidate?.name || "").trim() === targetName
    || path.basename(String(candidate?.path || "")) === targetName
  );
  if (!item?.path) return null;
  const materialRoot = path.resolve(getWorkspaceSettings().materialRoot || snapshot.root || "");
  const materialPath = path.resolve(String(item.path));
  if (!materialRoot || !isPathInside(materialRoot, materialPath)
    || !exists(materialPath) || !fs.statSync(materialPath).isDirectory()) return null;
  const files = safeList(materialPath)
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(materialPath, entry.name))
    .filter((file) => imageExts.has(path.extname(file).toLowerCase())
      || textExts.has(path.extname(file).toLowerCase()));
  return {
    ...item,
    path: materialPath,
    imageCount: files.filter((file) => imageExts.has(path.extname(file).toLowerCase())).length,
    textCount: files.filter((file) => path.extname(file).toLowerCase() === ".txt").length,
    attachments: files.slice(0, 30)
  };
}

function runMaterialGlobalIndexRefresh(options = {}) {
  if (materialGlobalIndexJob.status === "running") return materialGlobalIndexPublic();
  const root = path.resolve(options.materialRoot || getWorkspaceSettings().materialRoot);
  const descriptors = materialCategoryIndex(root);
  const metadata = getMaterialMetadataLedger(options.ledgerFile);
  const hashCache = getMaterialHashCache(options.cacheFile);
  const items = [];
  const categorySummaries = [];
  let cursor = 0;
  materialGlobalIndexJob = {
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: "",
    currentCategory: "",
    processedCategories: 0,
    totalCategories: descriptors.length,
    indexedItems: 0,
    error: ""
  };

  function finish() {
    try {
      const evidence = getLegacyMaterialEvidence(options.projectRoot || PROJECT_ROOT);
      const reconciled = applyLegacyMaterialEvidence(items, evidence, {
        ledger: metadata,
        ledgerFile: options.ledgerFile
      });
      items.forEach((item) => {
        const saved = reconciled.ledger.entries?.[item.folderHash] || {};
        const archiveUsage = materialArchiveUsageFolder(item.path, root);
        item.usageCount = archiveUsage === null
          ? Math.max(Number(item.usageCount || 0), Number(saved.usageCount || 0))
          : archiveUsage;
        item.usageSource = saved.usageSource || (item.usageCount ? "扩展实时记录" : "暂无使用证据");
        item.lifecycleState = normalizeLifecycleState(saved.lifecycleState);
        item.operationalStatus = normalizeOperationalStatus(saved.operationalStatus);
        item.conflicts = uniqueConflicts(saved.conflicts);
        item.contentFingerprint = String(saved.contentFingerprint || item.contentFingerprint || "");
        item.lock = saved.lock || null;
      });
      const snapshot = {
        version: 1,
        generatedAt: new Date().toISOString(),
        root,
        categories: categorySummaries,
        items,
        review: reconciled.review,
        evidence: {
          total: evidence.length,
          matchedFolders: reconciled.matched.size,
          importedEvents: reconciled.importedEvents,
          pendingReview: reconciled.review.length
        },
        stats: materialIndexStats(items, reconciled.review)
      };
      writeJson(options.indexFile || MATERIAL_GLOBAL_INDEX_FILE, snapshot);
      writeJson(options.cacheFile || MATERIAL_HASH_CACHE_FILE, hashCache);
      materialGlobalIndexJob = {
        ...materialGlobalIndexJob,
        status: "complete",
        completedAt: snapshot.generatedAt,
        currentCategory: "",
        processedCategories: descriptors.length,
        indexedItems: items.length
      };
    } catch (error) {
      materialGlobalIndexJob = {
        ...materialGlobalIndexJob,
        status: "failed",
        error: error.message || String(error),
        currentCategory: ""
      };
    }
  }

  function scanNextCategory() {
    if (cursor >= descriptors.length) return finish();
    const category = descriptors[cursor];
    materialGlobalIndexJob.currentCategory = category.name;
    try {
      const posts = getDetectedMaterialPosts(category.path, Boolean(options.force));
      posts.forEach((post) => {
        const preview = readTextPreview(post.path);
        const tagText = readMaterialTagText(post.path);
        const profile = materialMetadataProfile({
          path: post.path,
          name: post.name,
          preview: tagText,
          imageCount: post.imageCount,
          textCount: post.textCount
          }, category.name, { metadata, cache: hashCache, materialRoot: root });
        items.push({
          id: post.path,
          categoryId: category.id,
          categoryName: category.name,
          name: post.name,
          path: post.path,
          imageCount: post.imageCount,
          textCount: post.textCount,
          folderHash: profile.folderHash,
          mainTag: profile.mainTag,
          mainTagSource: profile.mainTagSource,
          tags: profile.tags,
          tagGroups: profile.tagGroups,
          usageCount: profile.usageCount,
          usageSource: profile.usageCount ? "扩展实时记录" : "暂无使用证据",
          lifecycleState: profile.lifecycleState,
          operationalStatus: profile.operationalStatus,
          conflicts: profile.conflicts,
          contentFingerprint: profile.contentFingerprint,
          lock: profile.lock
        });
      });
      categorySummaries.push({
        id: category.id,
        name: category.name,
        path: category.path,
        sourceSignature: materialTreeSignature(category.path),
        count: posts.length
      });
      cursor += 1;
      materialGlobalIndexJob.processedCategories = cursor;
      materialGlobalIndexJob.indexedItems = items.length;
      setImmediate(scanNextCategory);
    } catch (error) {
      materialGlobalIndexJob = {
        ...materialGlobalIndexJob,
        status: "failed",
        error: `${category.name}：${error.message || error}`,
        currentCategory: ""
      };
    }
  }

  setImmediate(scanNextCategory);
  return materialGlobalIndexPublic();
}

function getMaterialGlobalIndexJobStatus() {
  return { ...materialGlobalIndexJob };
}

function queueMaterialGlobalIndexRefresh(options = {}) {
  if (materialGlobalIndexWorker || materialGlobalIndexJob.status === "running") {
    return materialGlobalIndexPublic();
  }
  const root = path.resolve(options.materialRoot || getWorkspaceSettings().materialRoot);
  const descriptors = materialCategoryIndex(root);
  materialGlobalIndexJob = {
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: "",
    currentCategory: "",
    processedCategories: 0,
    totalCategories: descriptors.length,
    indexedItems: 0,
    error: ""
  };
  let worker;
  try {
    worker = new Worker(path.join(APP_ROOT, "material-index-worker.js"), {
      workerData: {
        ...options,
        materialRoot: root,
        indexFile: options.indexFile || MATERIAL_GLOBAL_INDEX_FILE,
        ledgerFile: options.ledgerFile || MATERIAL_METADATA_LEDGER_FILE,
        cacheFile: options.cacheFile || MATERIAL_HASH_CACHE_FILE,
        projectRoot: options.projectRoot || PROJECT_ROOT
      }
    });
  } catch (error) {
    materialGlobalIndexJob = {
      ...materialGlobalIndexJob,
      status: "failed",
      completedAt: new Date().toISOString(),
      error: error.message || String(error)
    };
    return materialGlobalIndexPublic();
  }
  materialGlobalIndexWorker = worker;
  worker.on("message", (message) => {
    if (message?.type !== "status" || !message.status) return;
    materialGlobalIndexJob = { ...materialGlobalIndexJob, ...message.status };
  });
  worker.on("error", (error) => {
    materialGlobalIndexJob = {
      ...materialGlobalIndexJob,
      status: "failed",
      completedAt: new Date().toISOString(),
      currentCategory: "",
      error: error.message || String(error)
    };
  });
  worker.on("exit", (code) => {
    if (materialGlobalIndexWorker !== worker) return;
    materialGlobalIndexWorker = null;
    if (code !== 0 && materialGlobalIndexJob.status === "running") {
      materialGlobalIndexJob = {
        ...materialGlobalIndexJob,
        status: "failed",
        completedAt: new Date().toISOString(),
        currentCategory: "",
        error: `素材全局索引 worker 退出（${code}）`
      };
    }
  });
  return materialGlobalIndexPublic();
}

function getMaterialGlobalIndex(options = {}) {
  const indexFile = options.indexFile || MATERIAL_GLOBAL_INDEX_FILE;
  const saved = readJson(indexFile, null);
  const currentRoot = path.resolve(options.materialRoot || getWorkspaceSettings().materialRoot);
  const stale = !saved || path.resolve(saved.root || "") !== currentRoot;
  if ((options.refresh || stale) && materialGlobalIndexJob.status !== "running") {
    queueMaterialGlobalIndexRefresh({ ...options, materialRoot: currentRoot, indexFile });
  }
  return materialGlobalIndexPublic(stale ? null : saved);
}

function getTemplateLibrary() {
  const configuredTemplateRoot = getPageSettings().production.templateRoot;
  const templateRoot = configuredTemplateRoot || path.join(PROJECT_ROOT, "02-模板库");
  const csv = path.join(templateRoot, "爆款链接库.csv");
  const sourceRoot = path.join(PROJECT_ROOT, "01-素材库", "团建攻略图文素材", "模板素材");
  const rows = exists(csv) ? parseCsv(fs.readFileSync(csv, "utf8")) : [];
  const templates = rows.map((row) => {
    const rel = row["源模板路径"] || "";
    const normalized = rel.replace(/\//g, path.sep);
    const configuredCandidate = path.join(templateRoot, normalized);
    const projectCandidate = path.join(PROJECT_ROOT, normalized);
    const full = path.isAbsolute(normalized)
      ? normalized
      : (configuredTemplateRoot && exists(configuredCandidate) ? configuredCandidate : projectCandidate);
    const images = listImages(full, PREVIEW_LIMITS.templateImages);
    const imageCount = listImageEntries(full).length;
    const textFiles = safeList(full)
      .filter((entry) => entry.isFile() && textExts.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(full, entry.name));
    const descriptor = `${row["模板名称"] || ""} ${row["适用内容"] || ""} ${full}`;
    const productionRecipe = recipeForTemplate(`${descriptor} ${row["备注"] || ""}`);
    const type = /团建小游戏|聚会游戏|破冰游戏|真心话|大冒险|游戏规则|玩法清单/.test(descriptor)
      ? "game"
      : "conversion";
    return {
      id: row["模板ID"] || path.basename(full),
      name: row["模板名称"] || path.basename(full),
      type,
      typeLabel: type === "game" ? "游戏模板" : "转化模板",
      usage: row["适用内容"] || "",
      defaultPages: row["默认页数"] || "",
      status: row["状态"] || "",
      note: row["备注"] || "",
      description: row["模板描述"] || row["备注"] || "",
      productionRecipe,
      path: full,
      images,
      imageCount,
      textCount: textFiles.length,
      attachments: [...images.map((image) => image.path), ...textFiles].slice(0, 30)
    };
  });
  const customGameRoot = path.join(templateRoot, "定制游模板");
  safeList(customGameRoot)
    .filter((entry) => entry.isDirectory() && /游戏|破冰|真心话|大冒险/.test(entry.name))
    .forEach((entry, index) => {
      const full = path.join(customGameRoot, entry.name);
      const images = listImages(full, PREVIEW_LIMITS.templateImages);
      const textFiles = safeList(full)
        .filter((file) => file.isFile() && textExts.has(path.extname(file.name).toLowerCase()))
        .map((file) => path.join(full, file.name));
      if (!images.length) return;
      templates.push({
        id: `G${String(index + 1).padStart(2, "0")}`,
        name: entry.name.replace(/^[^_]*_/, "").slice(0, 36),
        type: "game",
        typeLabel: "游戏模板",
        usage: "团建小游戏/聚会游戏/破冰玩法",
        defaultPages: "5",
        status: "参考",
        note: "多游戏条目和玩法说明模板",
        description: "多游戏条目和玩法说明模板",
        path: full,
        images,
        imageCount: listImageEntries(full).length,
        textCount: textFiles.length,
        attachments: [...images.map((image) => image.path), ...textFiles].slice(0, 30)
      });
    });
  return { csv, sourceRoot, templates };
}

function onlineTemplateFilePath() {
  const configuredTemplateRoot = getPageSettings().production.templateRoot;
  const templateRoot = path.resolve(configuredTemplateRoot || path.join(PROJECT_ROOT, "02-模板库"));
  fs.mkdirSync(templateRoot, { recursive: true });
  return path.join(templateRoot, "链接模板.txt");
}

function normalizeOnlineTemplateUrl(value = "") {
  let parsed;
  try { parsed = new URL(String(value || "").trim()); } catch { return ""; }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "chatgpt.com") return "";
  if (!/^\/(?:c|share)\/[a-z0-9-]+\/?$/i.test(parsed.pathname)) return "";
  parsed.hash = "";
  return parsed.toString();
}

function normalizeOnlineTemplateAccountId(value = "") {
  return /^[a-z0-9_-]+$/i.test(String(value || ""))
    ? String(value).trim().slice(0, 48)
    : "";
}

function normalizeOnlineTemplateText(value = "", limit = 120) {
  return String(value || "").replace(/[\t\r\n]+/g, " ").trim().slice(0, limit);
}

function onlineTemplateIdentityKey(template = {}) {
  const templateId = normalizeOnlineTemplateText(template.templateId, 48).toLowerCase();
  const name = normalizeOnlineTemplateText(template.name, 48).toLowerCase();
  const accountId = normalizeOnlineTemplateAccountId(template.accountId).toLowerCase();
  return `${templateId || name}\0${accountId || "unbound"}`;
}

function onlineTemplateRecordId(template = {}) {
  return `online-${crypto.createHash("sha256").update(onlineTemplateIdentityKey(template)).digest("hex").slice(0, 16)}`;
}

function normalizeOnlineTemplateSuccessKeys(value = []) {
  const source = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  return [...new Set(source.map((item) => normalizeOnlineTemplateText(item, 96)).filter(Boolean))].slice(-24);
}

function readOnlineTemplates(filePath = onlineTemplateFilePath()) {
  const source = exists(filePath) ? fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "") : "";
  const templates = source.split(/\r?\n/).map((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) return null;
    const urlMatch = clean.match(/https:\/\/chatgpt\.com\/(?:c|share)\/[a-z0-9-]+\/?/i);
    const templateUrl = normalizeOnlineTemplateUrl(urlMatch?.[0] || "");
    if (!templateUrl) return null;
    const before = clean.slice(0, Number(urlMatch.index || 0)).replace(/[\t|｜]+$/g, "").trim();
    const after = clean.slice(Number(urlMatch.index || 0) + urlMatch[0].length).replace(/^[\t|｜]+/g, "").trim();
    const explicitIdMatch = before.match(/^\[([A-Za-z0-9_-]+)\]\s*/);
    const templateId = explicitIdMatch?.[1] || "";
    const name = (before.replace(/^\[[A-Za-z0-9_-]+\]\s*/, "") || `在线模板 ${templateUrl.split("/").filter(Boolean).pop()?.slice(0, 8) || ""}`).slice(0, 48);
    const metadata = after.split(/\t/).map((value) => value.trim());
    const accountId = normalizeOnlineTemplateAccountId(metadata[0] || (metadata.length === 1 ? after : ""));
    const browserIdentityId = normalizeOnlineTemplateAccountId(metadata[1] || "");
    const successfulOutputCount = Math.max(0, Number(metadata[2] || 0));
    const autoSaved = ["1", "true", "yes"].includes(String(metadata[3] || "").toLowerCase());
    const status = normalizeOnlineTemplateText(metadata[4] || (autoSaved ? "verified" : "manual"), 32);
    const lastSuccessAt = normalizeOnlineTemplateText(metadata[5] || "", 40);
    const lastOpenedAt = normalizeOnlineTemplateText(metadata[6] || "", 40);
    const createdAt = normalizeOnlineTemplateText(metadata[7] || "", 40);
    const updatedAt = normalizeOnlineTemplateText(metadata[8] || "", 40);
    let successKeys = [];
    try { successKeys = normalizeOnlineTemplateSuccessKeys(metadata[9] ? JSON.parse(metadata[9]) : []); } catch { successKeys = normalizeOnlineTemplateSuccessKeys(metadata[9]); }
    const record = {
      kind: "online",
      templateId,
      name,
      url: templateUrl,
      accountId,
      browserIdentityId,
      successfulOutputCount,
      autoSaved,
      status,
      lastSuccessAt,
      lastOpenedAt,
      createdAt,
      updatedAt,
      successKeys
    };
    return {
      id: onlineTemplateRecordId(record),
      ...record
    };
  }).filter(Boolean);
  return { filePath, templates };
}

function writeOnlineTemplates(templates = [], filePath = onlineTemplateFilePath()) {
  const normalized = templates.map((template) => {
    const record = {
      templateId: normalizeOnlineTemplateText(template?.templateId, 48),
      name: normalizeOnlineTemplateText(template?.name, 48),
      url: normalizeOnlineTemplateUrl(template?.url),
      accountId: normalizeOnlineTemplateAccountId(template?.accountId),
      browserIdentityId: normalizeOnlineTemplateAccountId(template?.browserIdentityId),
      successfulOutputCount: Math.max(0, Number(template?.successfulOutputCount || 0)),
      autoSaved: Boolean(template?.autoSaved),
      status: normalizeOnlineTemplateText(template?.status || (template?.autoSaved ? "verified" : "manual"), 32),
      lastSuccessAt: normalizeOnlineTemplateText(template?.lastSuccessAt, 40),
      lastOpenedAt: normalizeOnlineTemplateText(template?.lastOpenedAt, 40),
      createdAt: normalizeOnlineTemplateText(template?.createdAt, 40),
      updatedAt: normalizeOnlineTemplateText(template?.updatedAt, 40),
      successKeys: normalizeOnlineTemplateSuccessKeys(template?.successKeys)
    };
    return { ...record, id: onlineTemplateRecordId(record) };
  }).filter((template) => template.name && template.url);
  const uniqueByIdentity = new Map();
  normalized.forEach((template) => uniqueByIdentity.set(onlineTemplateIdentityKey(template), template));
  const unique = [...uniqueByIdentity.values()];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const text = unique.map((template) => [
    template.templateId ? `[${template.templateId}] ${template.name}` : template.name,
    template.url,
    template.accountId,
    template.browserIdentityId,
    template.successfulOutputCount,
    template.autoSaved ? "1" : "0",
    template.status,
    template.lastSuccessAt,
    template.lastOpenedAt,
    template.createdAt,
    template.updatedAt,
    JSON.stringify(template.successKeys || [])
  ].join("\t")).join("\r\n");
  fs.writeFileSync(temporary, text ? `${text}\r\n` : "", "utf8");
  fs.renameSync(temporary, filePath);
  return readOnlineTemplates(filePath);
}

function updateOnlineTemplate(body = {}, filePath = onlineTemplateFilePath()) {
  const current = readOnlineTemplates(filePath).templates;
  const action = String(body.action || "upsert");
  if (action === "delete") {
    return writeOnlineTemplates(current.filter((template) => template.id !== String(body.id || "")), filePath);
  }
  if (action === "record-success") {
    const name = normalizeOnlineTemplateText(body.name, 48);
    const templateId = normalizeOnlineTemplateText(body.templateId, 48);
    const templateUrl = normalizeOnlineTemplateUrl(body.url);
    const accountId = normalizeOnlineTemplateAccountId(body.accountId);
    const browserIdentityId = normalizeOnlineTemplateAccountId(body.browserIdentityId || accountId);
    const successKey = normalizeOnlineTemplateText(body.successKey || body.requestId, 96);
    const threshold = Math.max(1, Math.min(50, Number(body.threshold || 5)));
    if (!name) throw new Error("自动沉淀缺少模板名称");
    if (!templateId) throw new Error("自动沉淀缺少模板 ID");
    if (!templateUrl || /\/share\//i.test(new URL(templateUrl).pathname)) throw new Error("自动沉淀只接受当前账号的原始 ChatGPT 会话链接");
    if (!accountId) throw new Error("自动沉淀缺少生产账号");
    const identity = `${templateId.toLowerCase()}\0${accountId.toLowerCase()}`;
    const existing = current.find((template) => onlineTemplateIdentityKey(template) === identity) || {};
    const successKeys = normalizeOnlineTemplateSuccessKeys(existing.successKeys);
    const counted = !successKey || !successKeys.includes(successKey);
    if (successKey && counted) successKeys.push(successKey);
    const successfulOutputCount = Math.max(0, Number(existing.successfulOutputCount || 0)) + (counted ? 1 : 0);
    const now = new Date().toISOString();
    const record = {
      ...existing,
      templateId,
      name,
      url: templateUrl,
      accountId,
      browserIdentityId,
      successfulOutputCount,
      autoSaved: successfulOutputCount >= threshold,
      status: successfulOutputCount >= threshold ? "verified" : "warming",
      lastSuccessAt: now,
      updatedAt: now,
      createdAt: existing.createdAt || now,
      successKeys
    };
    return writeOnlineTemplates([
      ...current.filter((template) => onlineTemplateIdentityKey(template) !== identity),
      record
    ], filePath);
  }
  const name = String(body.name || "").trim().slice(0, 48);
  const templateUrl = normalizeOnlineTemplateUrl(body.url);
  if (!name) throw new Error("在线模板名称不能为空");
  if (!templateUrl) throw new Error("只支持 ChatGPT 会话链接或分享链接");
  const templateId = normalizeOnlineTemplateText(body.templateId, 48);
  const accountId = normalizeOnlineTemplateAccountId(body.accountId);
  const browserIdentityId = normalizeOnlineTemplateAccountId(body.browserIdentityId || accountId);
  const replacingId = String(body.id || "");
  const identity = `${templateId.toLowerCase() || name.toLowerCase()}\0${accountId.toLowerCase() || "unbound"}`;
  const next = current.filter((template) => template.id !== replacingId
    && onlineTemplateIdentityKey(template) !== identity
    && !(template.url === templateUrl && !template.accountId && !accountId));
  const previous = current.find((template) => template.id === replacingId || onlineTemplateIdentityKey(template) === identity) || {};
  next.push({
    ...previous,
    templateId,
    name,
    url: templateUrl,
    accountId,
    browserIdentityId,
    status: previous.status || "manual",
    createdAt: previous.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return writeOnlineTemplates(next, filePath);
}

function getProductLibrary(options = {}) {
  const lite = options?.lite === true;
  // The work library is user-configurable.  The old implementation always
  // scanned PROJECT_ROOT/03-成品库, which no longer exists in the current
  // Jianghu project and made the repository appear empty after refresh.
  const configuredRoot = getWorkspaceSettings()?.workPackage?.libraryPath;
  const root = path.resolve(String(configuredRoot || path.join(PROJECT_ROOT, "成品库（GPT+本地脚本制作）")));
  const reservedNames = new Set(["_portfolio_move_logs", "_作品历史数据", "发布空间"]);
  const hasWorkAssets = (workPath) => safeList(workPath).some((entry) => (
    entry.isFile() && (imageExts.has(path.extname(entry.name).toLowerCase()) || textExts.has(path.extname(entry.name).toLowerCase()))
  ));
  const buildWork = (workPath) => {
    const images = listImages(workPath, PREVIEW_LIMITS.productImagesPerWork);
    const imageCount = listImageEntries(workPath).length;
    return {
      id: workPath,
      name: path.basename(workPath),
      path: workPath,
      images,
      imageCount,
      hasCopy: exists(path.join(workPath, "文案.txt")),
      hasPlan: exists(path.join(workPath, "出图计划.md")),
      hasSource: exists(path.join(workPath, "溯源说明.md")),
      hasCheck: exists(path.join(workPath, "质检说明.md")) || exists(path.join(workPath, "自检.md")),
      updatedAt: safeMtime(workPath)
    };
  };
  const entries = safeList(root).filter((entry) => entry.isDirectory() && !reservedNames.has(entry.name));
  const groups = [];
  const addGroup = (groupPath, name, workEntries) => {
    const allWorks = workEntries.filter((entry) => entry.isDirectory() && hasWorkAssets(path.join(groupPath, entry.name)));
    if (!allWorks.length) return;
    const works = lite
      ? []
      : allWorks
        .slice(0, PREVIEW_LIMITS.productWorksPerGroup)
        .map((entry) => buildWork(path.join(groupPath, entry.name)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    groups.push({ id: groupPath, name, path: groupPath, count: allWorks.length, visibleCount: works.length, works });
  };

  // Current production output is mostly one work folder per root entry.
  addGroup(root, "成品库", entries);
  // Keep collection-style folders (公众号/抖音等) visible as separate groups,
  // including one extra nesting level used by historical work packages.
  entries.forEach((collection) => {
    const collectionPath = path.join(root, collection.name);
    const children = safeList(collectionPath);
    addGroup(collectionPath, collection.name, children);
    children.filter((child) => child.isDirectory()).forEach((nested) => {
      const nestedPath = path.join(collectionPath, nested.name);
      addGroup(nestedPath, `${collection.name} / ${nested.name}`, safeList(nestedPath));
    });
  });
  return { root, groups };
}

function productionWorkbenchProducts() {
  const settings = getWorkspaceSettings();
  const pageSettings = getPageSettings();
  const libraryRoot = path.resolve(settings.workPackage.libraryPath);
  const stageRoots = getWorkflowStageRoots(libraryRoot);
  const packedRoot = pageSettings.production.packedRoot
    ? path.resolve(pageSettings.production.packedRoot)
    : stageRoots.mobile;
  const reservedNames = new Set([
    "_portfolio_move_logs", "_作品历史数据", "发布空间",
    "抖音小红书", "微信公众号", "已发送"
  ]);
  const textFiles = (workPath) => safeList(workPath)
    .filter((entry) => entry.isFile() && textExts.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const full = path.join(workPath, entry.name);
      return { name: entry.name, path: full, url: toUrl(full) };
    });
  const readCopyPreview = (files = []) => {
    const target = files.find((item) => /小红书文案|文案/i.test(item.name)) || files[0];
    if (!target) return "";
    try {
      return fs.readFileSync(target.path, "utf8").trim().slice(0, 420);
    } catch {
      return "";
    }
  };
  const inferWorkCategory = (name, preview = "") => (
    /游戏合集|团建游戏|破冰游戏|真心话|大冒险|小游戏/.test(`${name} ${preview}`)
      ? { type: "traffic", typeLabel: "泛流量贴" }
      : { type: "conversion", typeLabel: "精准流量贴" }
  );
  const buildWork = (workPath, source, extra = {}) => {
    const images = listImages(workPath, 30);
    const attachments = textFiles(workPath);
    const preview = readCopyPreview(attachments);
    const planPath = path.join(workPath, "出图计划.json");
    const plan = exists(planPath) ? readJson(planPath, {}) : {};
    const recipeName = plan.recipe?.name || plan.templateName || "";
    const category = extra.type
      ? { type: extra.type, typeLabel: extra.typeLabel }
      : inferWorkCategory(path.basename(workPath), preview);
    return {
      id: workPath,
      name: path.basename(workPath),
      path: workPath,
      source,
      templateName: recipeName,
      images,
      imageCount: listImageEntries(workPath).length,
      textFiles: attachments,
      textCount: attachments.length,
      preview,
      hasCopy: attachments.length > 0,
      copyPath: attachments[0]?.path || "",
      updatedAt: safeMtime(workPath),
      packed: source === "已打包",
      collectionName: extra.collectionName || "",
      type: category.type,
      typeLabel: category.typeLabel
    };
  };
  const readWorks = (root, source) => safeList(root)
    .filter((entry) => entry.isDirectory() && !reservedNames.has(entry.name))
    .map((entry) => buildWork(path.join(root, entry.name), source))
    .filter((work) => work.imageCount > 0 || work.textCount > 0);
  const unpackedWorks = [
    ...readWorks(IMAGE_REVIEW_ROOT, "待审区"),
    ...readWorks(libraryRoot, "成品库")
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const packedCollections = safeList(packedRoot)
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .flatMap((entry) => {
      const collectionPath = path.join(packedRoot, entry.name);
      const classification = classifyCollectionName(entry.name);
      const direct = buildWork(collectionPath, "已打包", {
        collectionName: entry.name,
        type: classification.type,
        typeLabel: classification.type === "traffic" ? "泛流量贴"
          : classification.type === "conversion" ? "精准流量贴" : "未分类"
      });
      if (direct.imageCount > 0 || direct.textCount > 0) return [direct];
      return safeList(collectionPath)
        .filter((post) => post.isDirectory())
        .map((post) => buildWork(path.join(collectionPath, post.name), "已打包", {
          collectionName: entry.name,
          type: classification.type,
          typeLabel: classification.type === "traffic" ? "泛流量贴"
            : classification.type === "conversion" ? "精准流量贴" : "未分类"
        }))
        .filter((work) => work.imageCount > 0 || work.textCount > 0);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const history = readWorkflowOperations(stageRoots)
    .filter((entry) => /pack|作品集|打包/i.test(`${entry.action || ""} ${entry.detail || ""}`))
    .slice(0, 120);
  return {
    reviewRoot: IMAGE_REVIEW_ROOT,
    libraryRoot,
    packedRoot,
    pendingRoot: packedRoot,
    works: unpackedWorks,
    unpackedWorks,
    packedWorks: packedCollections,
    history
  };
}

function packProductionWorks(paths = []) {
  const settings = getWorkspaceSettings();
  const pageSettings = getPageSettings();
  const libraryRoot = path.resolve(settings.workPackage.libraryPath);
  const stageRoots = getWorkflowStageRoots(libraryRoot);
  const packedRoot = pageSettings.production.packedRoot
    ? path.resolve(pageSettings.production.packedRoot)
    : stageRoots.mobile;
  fs.mkdirSync(packedRoot, { recursive: true });
  const allowedRoots = [path.resolve(IMAGE_REVIEW_ROOT), libraryRoot];
  const selected = [...new Set((Array.isArray(paths) ? paths : []).map((item) => path.resolve(String(item || ""))))];
  if (!selected.length) throw new Error("请先选择至少一个成品文件夹");
  const results = [];
  selected.forEach((sourcePath) => {
    if (!allowedRoots.some((root) => isPathInside(root, sourcePath)) || !exists(sourcePath)) {
      throw new Error(`成品路径不在允许范围：${sourcePath}`);
    }
    if (!fs.statSync(sourcePath).isDirectory()) throw new Error("只能打包作品文件夹");
    const files = safeList(sourcePath);
    if (!files.some((entry) => entry.isFile() && imageExts.has(path.extname(entry.name).toLowerCase()))) {
      throw new Error(`作品中没有图片：${path.basename(sourcePath)}`);
    }
    const targetPath = path.join(packedRoot, path.basename(sourcePath));
    if (exists(targetPath)) {
      results.push({ name: path.basename(sourcePath), status: "exists", targetPath });
      return;
    }
    fs.cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: true });
    appendWorkflowOperation(stageRoots, {
      action: "production-pack",
      collection: path.basename(sourcePath),
      sourcePath,
      targetPath,
      detail: "从素材生产工作台复制到抖音小红书待发"
    });
    results.push({ name: path.basename(sourcePath), status: "packed", targetPath });
  });
  return {
    ok: true,
    pendingRoot: packedRoot,
    packed: results.filter((item) => item.status === "packed").length,
    skipped: results.filter((item) => item.status === "exists").length,
    results
  };
}

function safeMtime(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return "";
  }
}

function getLogs() {
  const productionLog = path.join(PROJECT_ROOT, "04-技能库", "运行记录", "制作日志.csv");
  const imageLog = path.join(PROJECT_ROOT, "04-技能库", "运行记录", "生图日志.csv");
  const production = exists(productionLog) ? parseCsv(fs.readFileSync(productionLog, "utf8")) : [];
  const images = exists(imageLog) ? parseCsv(fs.readFileSync(imageLog, "utf8")) : [];
  return {
    productionLog,
    imageLog,
    productionCount: production.length,
    imageCount: images.length,
    latestProduction: production.slice(-16).reverse(),
    productionRecords: production.slice().reverse()
  };
}

function normalizeMatchKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function resolveProjectPath(maybeRelativePath) {
  if (!maybeRelativePath) return "";
  const cleaned = String(maybeRelativePath).replace(/\//g, "\\");
  return path.isAbsolute(cleaned) ? cleaned : path.join(PROJECT_ROOT, cleaned);
}

function countProductPages(productPath) {
  if (!productPath || !exists(productPath)) return { imageCount: 0, hasCopy: false, hasPlan: false, hasSource: false, hasCheck: false };
  const images = safeList(productPath).filter((entry) => {
    const lower = entry.name.toLowerCase();
    return entry.isFile() && (lower === "封面.png" || /^内页\d+\.(png|jpg|jpeg|webp)$/i.test(entry.name));
  });
  return {
    imageCount: images.length,
    hasCopy: exists(path.join(productPath, "文案.txt")),
    hasPlan: exists(path.join(productPath, "出图计划.md")),
    hasSource: exists(path.join(productPath, "溯源说明.md")),
    hasCheck: exists(path.join(productPath, "质检说明.md")) || exists(path.join(productPath, "自检.md"))
  };
}

function findProductionRecordForPair(records, material, templateId) {
  const materialKey = normalizeMatchKey(material?.name || "");
  const materialKeyNoPrefix = materialKey.replace(/^\d+/, "");
  let best = null;
  records.forEach((record) => {
    if ((record["模板ID"] || "") !== templateId) return;
    const source = normalizeMatchKey(record["素材文件夹"] || "");
    const title = normalizeMatchKey(record["素材标题"] || "");
    let score = 0;
    [materialKey, materialKeyNoPrefix].filter((key) => key.length >= 8).forEach((key) => {
      if (source === key) score = Math.max(score, 100);
      else if (source.includes(key) || key.includes(source)) score = Math.max(score, 82);
      if (title && (key.includes(title) || title.includes(key))) score = Math.max(score, 56);
    });
    const newer = best?.record && String(record["时间"] || "") >= String(best.record["时间"] || "");
    if (score > (best?.score || 0) || (score === best?.score && newer)) best = { record, score };
  });
  return best?.score >= 50 ? best.record : null;
}

function buildProductionTaskIndex(materials, templates, logs, state) {
  const selectedTemplateId = state.selectedTemplate || "T01";
  const template = templates.templates.find((item) => item.id === selectedTemplateId) || templates.templates[0] || {};
  const activeCategories = materials.categories.filter((category) => (
    category.items
    && category.items.length
    && category.name !== "模板素材"
  ));
  const records = logs.productionRecords || [];
  const tasks = [];
  activeCategories.forEach((category) => {
    category.items.forEach((material) => {
      const record = findProductionRecordForPair(records, material, template.id || selectedTemplateId);
      const productPath = resolveProjectPath(record?.["成品路径"] || "");
      const files = countProductPages(productPath);
      const expectedPages = Number.parseInt(template.defaultPages, 10) || Math.min(Math.max(material.imageCount || 5, 5), 10);
      const recordStatus = record?.["状态"] || "";
      const failed = /失败|作废|归档/.test(recordStatus);
      const removed = Boolean(record && /完成/.test(recordStatus) && productPath && !exists(productPath));
      const complete = !failed
        && !removed
        && record
        && files.imageCount >= expectedPages
        && files.hasCopy
        && files.hasPlan
        && files.hasSource;
      const partial = record && !complete && !failed;
      const missing = [];
      if (files.imageCount < expectedPages) missing.push(`缺 ${Math.max(expectedPages - files.imageCount, 0)} 张图`);
      if (record && !files.hasCopy) missing.push("缺文案");
      if (record && !files.hasPlan) missing.push("缺出图计划");
      if (record && !files.hasSource) missing.push("缺溯源");
      tasks.push({
        id: `${template.id || selectedTemplateId}::${material.id}`,
        templateId: template.id || selectedTemplateId,
        templateName: template.name || "",
        materialId: material.id,
        materialName: material.name,
        materialPath: material.path,
        materialLibrary: category.name,
        materialLibraryPath: category.path,
        expectedPages,
        sourceImages: material.imageCount || 0,
        productPath: productPath || "",
        status: complete ? "完成_待人工发布前终检" : removed ? "已移除_不续接" : failed ? "失败记录_需重做" : partial ? "缺页待续接" : "待生成",
        generatedPages: files.imageCount,
        missing,
        recordTime: record?.["时间"] || "",
        recordStatus,
        updatedAt: files.imageCount ? safeMtime(productPath) : ""
      });
    });
  });
  const summary = {
    total: tasks.length,
    done: tasks.filter((task) => task.status.startsWith("完成")).length,
    pending: tasks.filter((task) => task.status === "待生成").length,
    partial: tasks.filter((task) => task.status === "缺页待续接").length,
    failed: tasks.filter((task) => task.status.startsWith("失败")).length,
    removed: tasks.filter((task) => task.status === "已移除_不续接").length
  };
  const selectedMaterialId = state.selectedMaterial || tasks[0]?.materialId || "";
  const current = tasks.find((task) => task.materialId === selectedMaterialId) || tasks[0] || null;
  const next = tasks.find((task) => task.status === "缺页待续接") || tasks.find((task) => task.status === "待生成") || null;
  const index = {
    generatedAt: new Date().toISOString(),
    selectedTemplateId: template.id || selectedTemplateId,
    selectedTemplateName: template.name || "",
    summary,
    current,
    next,
    tasks: tasks.slice(0, 240)
  };
  writeJson(TASK_INDEX_FILE, index);
  return index;
}

function buildDefaultPromptVersions() {
  const sources = [
    {
      id: "template-v36",
      title: "轮播母版迁移器",
      file: path.join(SKILL_ROOT, "00-轮播母版迁移器 V3.6-模板复刻.md"),
      version: "V3.6-动态页数硬锁版",
      role: "永久视觉母版硬锁、动态页数、强制换位/换人/换物、去AI味的母版迁移主提示词"
    },
    {
      id: "team-sop",
      title: "团建 SOP",
      file: path.join(SKILL_ROOT, "00-团建 SOP.md"),
      version: "SOP",
      role: "原始手动生产流程"
    },
    {
      id: "batch-sop",
      title: "批量产图流程",
      file: path.join(PROJECT_ROOT, "05-知识库", "00-工作流入口", "团建批量产图流程显性化SOP.md"),
      version: "2026-06-30",
      role: "Codex 批量生产和续接规则"
    },
    {
      id: "queue-rule",
      title: "素材队列与续接",
      file: path.join(PROJECT_ROOT, "05-知识库", "00-工作流入口", "素材队列与续接规则.md"),
      version: "2026-06-29",
      role: "默认素材库、模板匹配、40 张图续接"
    },
    {
      id: "xhs-copy",
      title: "小红书团建文案编辑器",
      file: path.join(PROJECT_ROOT, "04-技能库", "提示词", "小红书团建文案最高规则.md"),
      version: "SEO搜索决策资产版",
      role: "独立发布文案提示词，和生图/模板迁移分开使用"
    }
  ];
  return {
    updatedAt: new Date().toISOString(),
    prompts: sources.map((source) => ({
      id: source.id,
      title: source.title,
      role: source.role,
      activeVersion: source.version,
      versions: [
        {
          version: source.version,
          createdAt: new Date().toISOString().slice(0, 10),
          sourceFile: source.file,
          content: readPromptFile(source.file)
        }
      ]
    }))
  };
}

function readPromptFile(file) {
  try {
    return fs.readFileSync(file, "utf8").slice(0, 24000);
  } catch {
    return "";
  }
}

function invalidateLiveDistributionSnapshot() {
  liveDistributionSnapshotCache = { key: "", generatedAt: 0, value: null };
}

function momentsLibraryRoot() {
  return path.resolve(getPageSettings().moments?.libraryRoot || MOMENTS_LIBRARY_ROOT);
}

function resolveMomentsTargetWxid(friend = "", wxid = "") {
  const explicit = String(wxid || "").trim().slice(0, 160);
  const target = String(friend || "").trim().slice(0, 160);
  if (explicit) return explicit;
  if (!target) return "";
  if (/^wxid_[\w-]+$/i.test(target) || /@chatroom$/i.test(target)) return target;
  const contacts = readJson(WEFLOW_CONTACTS_CACHE, {});
  const matches = new Set();
  for (const accountContacts of Object.values(contacts.accounts || {})) {
    for (const [candidate, record] of Object.entries(accountContacts || {})) {
      const values = [
        candidate,
        record?.displayName,
        record?.nickname,
        record?.remark,
        record?.alias,
        record?.username
      ].map((value) => String(value || "").trim().toLocaleLowerCase()).filter(Boolean);
      if (values.includes(target.toLocaleLowerCase())) matches.add(candidate);
    }
  }
  if (matches.size > 1) throw new Error("微信昵称匹配到多个账号，请补充 WeFlow UID，避免采错人");
  return matches.size === 1 ? [...matches][0] : target;
}

function momentsFeatureEnabled() {
  return getPageSettings().moments?.enabled !== false;
}

function momentsTodayKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getMomentsPublisherState() {
  const root = momentsLibraryRoot();
  const statePath = path.join(root, "state", "publisher-state.json");
  const state = readJson(statePath, {});
  const date = momentsTodayKey();
  const record = state && typeof state === "object" && state[date] && typeof state[date] === "object"
    ? state[date]
    : null;
  return {
    date,
    status: record?.status || "NO_RECORD",
    record,
    statePath
  };
}

function momentsCollectionScheduleStatePath() {
  return path.join(momentsLibraryRoot(), "state", "collection-scheduler-state.json");
}

function getMomentsCollectionScheduleState() {
  const state = readJson(momentsCollectionScheduleStatePath(), {});
  return state && typeof state === "object" ? state : {};
}

function saveMomentsCollectionScheduleState(state = {}) {
  const file = momentsCollectionScheduleStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJson(file, {
    version: 1,
    lastKey: String(state.lastKey || ""),
    lastAttemptDate: String(state.lastAttemptDate || ""),
    lastRun: state.lastRun && typeof state.lastRun === "object" ? state.lastRun : null,
    targetMonth: String(state.targetMonth || ""),
    collectionMode: String(state.collectionMode || "account-watermark"),
    runningKey: String(state.runningKey || ""),
    runningAt: String(state.runningAt || "")
  });
}

function momentsPublisherAttempts(publisherState = {}) {
  const record = publisherState?.record;
  if (!record || typeof record !== "object") return [];
  if (Array.isArray(record.attempts) && record.attempts.length) {
    return record.attempts.filter((attempt) => attempt && typeof attempt === "object");
  }
  return [record];
}

function momentsScheduledAttemptCount(publisherState = {}) {
  const countedStatuses = new Set([
    "PREPARING",
    "PREPARED_FOR_HUMAN_CONFIRM",
    "CONFIRMED_PUBLISHED",
    "FAILED",
    "WAITING_FOR_HUMAN_LOGIN"
  ]);
  return momentsPublisherAttempts(publisherState).filter((attempt) => {
    // Records written before the source field was introduced are treated as
    // scheduled for the automatic side, conservatively preserving the old
    // one-per-day behavior while the manual UI remains available.
    const source = String(attempt.source || "scheduled");
    const isSelectionOnlyFailure = isMomentsSelectionOnlyFailure(attempt);
    return source === "scheduled"
      && countedStatuses.has(String(attempt.status || ""))
      && !isSelectionOnlyFailure;
  }).length;
}

function momentsScheduleRetryInfo(publisherState = {}, now = new Date()) {
  const attempts = momentsPublisherAttempts(publisherState)
    .filter((attempt) => String(attempt.source || "scheduled") === "scheduled")
    .filter(isMomentsSelectionOnlyFailure);
  const latest = attempts.at(-1) || null;
  if (String(publisherState.status || "") !== "FAILED" || !latest) {
    return {
      retryable: false,
      allowed: false,
      attempts: attempts.length,
      nextAt: "",
      reason: "no-selection-failure"
    };
  }
  return momentsScheduleRetryDecision({
    attempt: latest,
    attempts: attempts.length,
    now
  });
}

function momentsHasPendingPreparation(publisherState = {}) {
  return momentsPublisherAttempts(publisherState).some((attempt) => [
    "PREPARING",
    "PREPARED_FOR_HUMAN_CONFIRM",
    "WAITING_FOR_HUMAN_LOGIN"
  ].includes(String(attempt.status || "")));
}

function momentsWorkDirectory(workId = "", stage = "ready") {
  const root = momentsLibraryRoot();
  const cleanStage = stage === "used" ? "used" : "ready";
  const cleanId = String(workId || "").trim();
  if (!cleanId || cleanId.includes("\\") || cleanId.includes("/") || cleanId === "." || cleanId === "..") return null;
  const candidate = path.resolve(root, cleanStage, cleanId);
  return isPathInside(path.join(root, cleanStage), candidate) ? candidate : null;
}

function readMomentsContent(directory) {
  const preferred = path.join(directory, "content.txt");
  if (exists(preferred)) return fs.readFileSync(preferred, "utf8").replace(/^\uFEFF/, "");
  const fallback = safeList(directory).find((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".txt");
  return fallback ? fs.readFileSync(path.join(directory, fallback.name), "utf8").replace(/^\uFEFF/, "") : "";
}

function readMomentsAsset(directory) {
  return readJson(path.join(directory, "asset.json"), {});
}

function readMomentsMetadata(directory) {
  return readJson(path.join(directory, "metadata.json"), {});
}

const MOMENTS_PLACE_KEYWORDS = [
  ["富阳", ["富阳"]],
  ["萧山", ["萧山"]],
  ["余杭", ["余杭"]],
  ["象山", ["象山"]],
  ["杭州", ["杭州", "西湖", "余杭", "临平", "萧山", "富阳"]],
  ["义乌", ["义乌"]],
  ["宁波", ["宁波", "象山", "东钱湖"]],
  ["安吉", ["安吉"]],
  ["湖州", ["湖州", "莫干山"]],
  ["绍兴", ["绍兴", "柯桥", "上虞"]],
  ["嘉兴", ["嘉兴", "乌镇"]],
  ["上海", ["上海"]],
  ["苏州", ["苏州"]],
  ["千岛湖", ["千岛湖"]]
];
const MOMENTS_ACTIVITY_KEYWORDS = [
  ["露营", ["露营", "营地", "帐篷"]],
  ["漂流", ["漂流"]],
  ["户外拓展", ["拓展", "户外活动"]],
  ["真人CS", ["真人CS", "真人cs", "CS对战"]],
  ["烧烤", ["烧烤", "BBQ", "bbq"]],
  ["骑行", ["骑行", "自行车"]],
  ["皮划艇", ["皮划艇", "桨板"]],
  ["年会", ["年会", "周年会"]],
  ["景区游玩", ["景区", "古镇", "古村", "游玩"]],
  ["团建", ["团建", "团队建设"]]
];

function momentsFacets(text, publishedAt, asset = {}, metadata = {}) {
  const published = publishedAt ? new Date(publishedAt) : null;
  const month = Number(asset.month || metadata.month || (published && !Number.isNaN(published.getTime()) ? published.getMonth() + 1 : 0)) || 0;
  const season = String(asset.season || metadata.season || (month ? ({ 12: "冬季", 1: "冬季", 2: "冬季", 3: "春季", 4: "春季", 5: "春季", 6: "夏季", 7: "夏季", 8: "夏季", 9: "秋季", 10: "秋季", 11: "秋季" }[month]) : "") || "");
  const source = `${text}\n${asset.category || ""}\n${metadata.source_payload?.location?.name || ""}`;
  const storedPlaces = Array.isArray(asset.places) ? asset.places.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const places = Array.from(new Set([
    ...storedPlaces,
    ...MOMENTS_PLACE_KEYWORDS.filter(([, words]) => words.some((word) => source.includes(word))).map(([name]) => name)
  ]));
  const storedActivities = Array.isArray(asset.activity_types) ? asset.activity_types.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const activities = Array.from(new Set([
    ...storedActivities,
    ...MOMENTS_ACTIVITY_KEYWORDS.filter(([, words]) => words.some((word) => source.includes(word))).map(([name]) => name)
  ]));
  const place = String(asset.place || metadata.place || places[0] || "").trim();
  const activityType = String(asset.activity_type || metadata.activity_type || activities[0] || asset.category || "团建").trim() || "团建";
  const usageCount = Math.max(0, Number(asset.usage_count ?? metadata.usage_count ?? 0) || 0);
  return {
    season,
    place,
    places,
    activityType,
    activities: activities.length ? activities : [activityType],
    usageCount,
    tags: [season, place, activityType, ...places, ...activities, usageCount ? `使用 ${usageCount} 次` : "未使用"]
      .map((tag) => String(tag || "").trim()).filter(Boolean)
  };
}

function momentsPublishedAt(asset, metadata, directory) {
  const value = asset.published_at || asset.publishedAt || metadata.published_at || metadata.publishedAt || "";
  if (value) return String(value);
  try { return fs.statSync(directory).mtime.toISOString(); } catch { return ""; }
}

function listMomentImages(directory) {
  return safeList(directory)
    .filter((entry) => entry.isFile() && imageExts.has(path.extname(entry.name).toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true }))
    .map((entry) => {
      return {
        name: entry.name,
        url: `/api/moments/media?workId=${encodeURIComponent(path.basename(directory))}&file=${encodeURIComponent(entry.name)}`,
      };
    });
}

function momentsRecord(directory) {
  const asset = readMomentsAsset(directory);
  const metadata = readMomentsMetadata(directory);
  const publishedAt = momentsPublishedAt(asset, metadata, directory);
  const text = readMomentsContent(directory);
  const facets = momentsFacets(text, publishedAt, asset, metadata);
  const year = Number(asset.year || metadata.year || (publishedAt ? new Date(publishedAt).getFullYear() : 0)) || null;
  const tags = Array.from(new Set([
    ...(Array.isArray(asset.tags) ? asset.tags : []),
    ...(Array.isArray(metadata.tags) ? metadata.tags : []),
    ...facets.tags,
    year ? `${year}年` : ""
  ].map((tag) => String(tag || "").trim()).filter(Boolean)));
  const images = listMomentImages(directory);
  const status = String(metadata.status || asset.status || "QUEUED").trim() || "QUEUED";
  const category = String(asset.category || metadata.category || "团建").trim() || "团建";
  const workId = path.basename(directory);
  const mediaLimitExceeded = images.length > MOMENTS_MAX_MEDIA;
  const selectionBlockReason = mediaLimitExceeded
    ? `微信朋友圈单条最多 ${MOMENTS_MAX_MEDIA} 张图，当前作品有 ${images.length} 张`
    : "";
  return {
    id: workId,
    workId,
    name: workId.replace(/^\d{4}-\d{2}-\d{2}_\d+_/, "") || workId,
    category,
    tags,
    publishedAt,
    year,
    month: Number(asset.month || metadata.month || (publishedAt ? new Date(publishedAt).getMonth() + 1 : 0)) || null,
    day: Number(asset.day || metadata.day || (publishedAt ? new Date(publishedAt).getDate() : 0)) || null,
    season: facets.season,
    place: facets.place,
    places: facets.places,
    activityType: facets.activityType,
    activities: facets.activities,
    usageCount: facets.usageCount,
    sourceLabel: "WeFlow历史采集",
    text,
    contentFile: exists(path.join(directory, "content.txt")) ? "content.txt" : "",
    images,
    imageCount: images.length,
    coverUrl: images[0]?.url || "",
    status,
    selectionEnabled: asset.selection_enabled !== false && status === "QUEUED" && !mediaLimitExceeded,
    mediaLimitExceeded,
    maxMedia: MOMENTS_MAX_MEDIA,
    selectionBlockReason,
    metadata: {
      source: metadata.source || asset.source || "weflow",
      sourceId: metadata.source_id_or_fingerprint || metadata.source_id || "",
      collectedAt: metadata.collected_at || asset.created_at || "",
      updatedAt: asset.updated_at || ""
    }
  };
}

function getMomentsLibrary() {
  const root = momentsLibraryRoot();
  const momentsSettings = getPageSettings().moments || {};
  const collectionProgress = readJson(path.join(root, "state", "collection-progress.json"), { version: 1, accounts: {} });
  const readyRoot = path.join(root, "ready");
  const items = safeList(readyRoot)
    .filter((entry) => entry.isDirectory())
    .map((entry) => momentsRecord(path.join(readyRoot, entry.name)))
    .filter((item) => item.text || item.imageCount)
    .sort((left, right) => String(right.publishedAt || right.workId).localeCompare(String(left.publishedAt || left.workId)));
  return {
    ok: true,
    root,
    readyRoot,
    generatedAt: new Date().toISOString(),
    items,
    summary: {
      total: items.length,
      ready: items.filter((item) => item.selectionEnabled).length,
      failed: items.filter((item) => item.status === "FAILED").length,
      overLimit: items.filter((item) => item.mediaLimitExceeded).length,
      withImages: items.filter((item) => item.imageCount > 0).length,
      totalImages: items.reduce((sum, item) => sum + Number(item.imageCount || 0), 0),
      years: Object.fromEntries(Object.entries(items.reduce((acc, item) => {
        const year = Number(item.year || 0);
        if (year) acc[year] = (acc[year] || 0) + 1;
        return acc;
      }, {})).sort(([left], [right]) => Number(right) - Number(left)))
    },
    settings: {
      libraryRoot: root,
      autoOpenWeChat: momentsSettings.autoOpenWeChat !== false,
      collectionAccount: momentsSettings.collectionAccount || "",
      collectionWxid: momentsSettings.collectionWxid || "",
      collectionLimit: momentsSettings.collectionLimit === "all" ? "all" : "10",
      monthlyCollectionStrategy: "account-watermark",
      requireWechatReady: momentsSettings.requireWechatReady !== false,
      collectionScheduleEnabled: momentsSettings.collectionScheduleEnabled === true,
      collectionScheduleDay: Math.max(1, Math.min(28, Number(momentsSettings.collectionScheduleDay || 1))),
      collectionScheduleTime: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(momentsSettings.collectionScheduleTime || ""))
        ? String(momentsSettings.collectionScheduleTime)
        : "10:20",
      collectionScheduleCatchUpDays: normalizeCollectionScheduleCatchUpDays(momentsSettings.collectionScheduleCatchUpDays),
      triggerMode: momentsSettings.triggerMode || "manual",
      scheduleWindowStart: momentsSettings.scheduleWindowStart || "10:00",
      scheduleWindowEnd: momentsSettings.scheduleWindowEnd || "12:00",
      scheduleTimes: Array.isArray(momentsSettings.scheduleTimes) ? momentsSettings.scheduleTimes : ["09:00"],
      dailyAutoLimit: Math.max(1, Math.min(20, Number(momentsSettings.dailyAutoLimit || 1))),
      selectionRule: momentsSettings.selectionRule || "last-year-day"
    },
    publisherState: getMomentsPublisherState(),
    collectionProgress,
    scheduler: getMomentsSchedulerStatus()
  };
}

function parseMomentsProcessOutput(stdout = "") {
  const text = String(stdout).trim();
  if (!text) return null;

  // moments_library.collect 使用 indent=2 输出完整 JSON；先解析完整输出，
  // 否则多行 JSON 会被误当成若干无法解析的单行片段。
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object") return value;
  } catch {
    // 允许 CLI 在 JSON 前输出诊断信息，继续尝试提取 JSON。
  }

  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") return value;
    } catch {
      // CLI 诊断输出可能混在 JSON 前面，继续找最后一个 JSON 行。
    }
  }

  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    try {
      const value = JSON.parse(text.slice(firstObject, lastObject + 1));
      if (value && typeof value === "object") return value;
    } catch {
      // 输出中若含有不完整 JSON，保持原有 null 语义，由调用方记录原始 stdout。
    }
  }
  return null;
}

function momentsDiagnostic(stderr = "") {
  return String(stderr || "")
    .split(/\r?\n/)
    .filter((line) => !line.includes("LanguageDetectionFailedWarning"))
    .filter((line) => !line.includes("语言检测失败，使用默认“简体中文”"))
    .filter((line) => !line.includes("语言检测失败, 使用默认"))
    .join("\n")
    .trim();
}

function runMomentsCollect({
  friend = "",
  wxid = "",
  source = "weflow",
  limit = 10,
  fullHistory = false,
  resumeOnly = false,
  targetMonth = ""
} = {}) {
  const root = momentsLibraryRoot();
  const python = exists(MOMENTS_PYTHON_ROOT) ? MOMENTS_PYTHON_ROOT : pythonExe();
  const args = [
    "-m", "moments_library.collect",
    "--friend", friend,
    "--output", root,
    "--limit", String(limit),
    "--source", source
  ];
  if (source === "weflow") args.push("--wxid", wxid);
  if (fullHistory) args.push("--all");
  if (resumeOnly) args.push("--resume-only");
  if (targetMonth) args.push("--target-month", String(targetMonth));
  return new Promise((resolve) => {
    const child = childProcess.spawn(python, args, {
      cwd: APP_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        PYTHONPATH: [APP_ROOT, process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: null, timedOut: true, stdout, stderr: `${stderr}\n朋友圈采集超过 30 分钟，进程已停止。` });
    }, 1_800_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ ok: false, code: null, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on("close", (code) => finish({
      ok: code === 0,
      code,
      stdout,
      stderr,
      result: parseMomentsProcessOutput(stdout)
    }));
  });
}

function runMomentsPrepare(workId = "", { retryFailed = false, policy = "", source = "manual", dailyAutoLimit = 1 } = {}) {
  const root = momentsLibraryRoot();
  const python = exists(MOMENTS_PYTHON_ROOT) ? MOMENTS_PYTHON_ROOT : pythonExe();
  const args = ["-m", "moments_publisher.cli", "--library", root, "prepare-today", "--live"];
  if (workId) args.push("--work-id", workId);
  if (policy) args.push("--policy", policy);
  if (retryFailed) args.push("--retry-failed");
  args.push("--source", source === "scheduled" ? "scheduled" : "manual");
  if (source === "scheduled") args.push("--daily-auto-limit", String(Math.max(1, Math.min(20, Number(dailyAutoLimit || 1)))));
  if (getPageSettings().moments?.autoOpenWeChat === false) args.push("--manual-wechat");
  return new Promise((resolve) => {
    const child = childProcess.spawn(python, args, {
      cwd: APP_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        PYTHONPATH: [APP_ROOT, process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: null, timedOut: true, stdout, stderr: `${stderr}\n发布准备超过 180 秒，进程已停止。` });
    }, 180_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ ok: false, code: null, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on("close", (code) => finish({
      ok: code === 0,
      code,
      stdout,
      stderr,
      result: parseMomentsProcessOutput(stdout)
    }));
  });
}

function runMomentsPreflight(workId = "", { policy = "" } = {}) {
  const root = momentsLibraryRoot();
  const python = exists(MOMENTS_PYTHON_ROOT) ? MOMENTS_PYTHON_ROOT : pythonExe();
  const args = ["-m", "moments_publisher.cli", "--library", root, "prepare-today", "--dry-run"];
  if (workId) args.push("--work-id", workId);
  if (policy) args.push("--policy", policy);
  return new Promise((resolve) => {
    const child = childProcess.spawn(python, args, {
      cwd: APP_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        PYTHONPATH: [APP_ROOT, process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: null, timedOut: true, stdout, stderr: `${stderr}\n发送前自检超过 30 秒，进程已停止。` });
    }, 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ ok: false, code: null, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on("close", (code) => finish({
      ok: code === 0,
      code,
      stdout,
      stderr,
      result: parseMomentsProcessOutput(stdout)
    }));
  });
}

function runMomentsDoctor() {
  const root = momentsLibraryRoot();
  const python = exists(MOMENTS_PYTHON_ROOT) ? MOMENTS_PYTHON_ROOT : pythonExe();
  return new Promise((resolve) => {
    const child = childProcess.spawn(python, ["-m", "moments_publisher.cli", "--library", root, "doctor-state"], {
      cwd: APP_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        PYTHONPATH: [APP_ROOT, process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: null, timedOut: true, stdout, stderr: `${stderr}\n朋友圈失败诊断超过 30 秒，进程已停止。` });
    }, 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ ok: false, code: null, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on("close", (code) => finish({
      ok: code === 0,
      code,
      stdout,
      stderr,
      result: parseMomentsProcessOutput(stdout)
    }));
  });
}

function getMomentsSchedulerStatus() {
  const settings = getPageSettings().moments || {};
  const publisherState = getMomentsPublisherState();
  const collectionState = getMomentsCollectionScheduleState();
  const dailyAutoLimit = Math.max(1, Math.min(20, Number(settings.dailyAutoLimit || 1)));
  const dailyAutoCount = momentsScheduledAttemptCount(publisherState);
  const pending = momentsHasPendingPreparation(publisherState);
  const next = nextMomentsSchedule(settings);
  const due = dueMomentsSchedule(settings);
  const nextCollection = nextMomentsCollectionSchedule(settings);
  const nextCollectionTarget = previousMonthWindow(nextCollection?.at ? new Date(nextCollection.at) : new Date());
  const retry = momentsScheduleRetryInfo(publisherState);
  const persistedLastAttempt = [...momentsPublisherAttempts(publisherState)]
    .reverse()
    .find((attempt) => String(attempt.source || "scheduled") === "scheduled");
  const persistedLastRun = persistedLastAttempt ? {
    key: persistedLastAttempt.attempt_id || "",
    policy: settings.selectionRule || "last-year-day",
    startedAt: persistedLastAttempt.started_at || "",
    finishedAt: persistedLastAttempt.prepared_at || persistedLastAttempt.failed_at || persistedLastAttempt.waiting_at || "",
    ok: ["PREPARED_FOR_HUMAN_CONFIRM", "CONFIRMED_PUBLISHED"].includes(String(persistedLastAttempt.status || "")),
    code: persistedLastAttempt.error_code || "",
    status: persistedLastAttempt.status || "",
    workId: persistedLastAttempt.work_id || "",
    error: persistedLastAttempt.error || ""
  } : null;
  return {
    enabled: momentsFeatureEnabled() && settings.triggerMode === "scheduled",
    triggerMode: settings.triggerMode || "manual",
    scheduleWindowStart: settings.scheduleWindowStart || "",
    scheduleWindowEnd: settings.scheduleWindowEnd || "",
    scheduleTimes: Array.isArray(settings.scheduleTimes) ? settings.scheduleTimes : ["09:00"],
    dailyAutoLimit,
    dailyAutoCount,
    dailyAutoRemaining: Math.max(0, dailyAutoLimit - dailyAutoCount),
    selectionRule: settings.selectionRule || "last-year-day",
    selfCheckIntervalMinutes: 15,
    selfCheckMaxAttempts: 8,
    selfCheckAttempts: retry.attempts,
    selfCheckRetryable: retry.retryable,
    selfCheckNextAt: retry.nextAt,
    selfCheckReason: retry.reason,
    nextRunAt: next?.at || "",
    nextRunKey: next?.key || "",
    windowActive: due?.windowActive === true,
    running: momentsSchedulerRunning,
    lockedToday: pending || dailyAutoCount >= dailyAutoLimit,
    lockStatus: publisherState.status,
    lastRun: momentsSchedulerLastRun || persistedLastRun,
    collection: {
      enabled: momentsFeatureEnabled() && settings.collectionScheduleEnabled === true,
      day: Math.max(1, Math.min(28, Number(settings.collectionScheduleDay || 1))),
      time: String(settings.collectionScheduleTime || "10:20"),
      catchUpDays: normalizeCollectionScheduleCatchUpDays(settings.collectionScheduleCatchUpDays),
      nextRunAt: nextCollection?.at || "",
      nextRunKey: nextCollection?.key || "",
      running: momentsCollectionSchedulerRunning,
      targetMonth: nextCollectionTarget.month,
      strategy: "account-watermark",
      lastKey: collectionState.lastKey || "",
      lastAttemptDate: collectionState.lastAttemptDate || "",
      targetMonthLastRun: collectionState.targetMonth || "",
      lastRun: collectionState.lastRun || null
    }
  };
}

async function tickMomentsCollectionScheduler(now = new Date()) {
  const settings = getPageSettings().moments || {};
  const due = dueMomentsCollectionSchedule(settings, now);
  if (!due || momentsCollectionSchedulerRunning) return null;
  const targetWindow = previousMonthWindow(now);

  const stored = getMomentsCollectionScheduleState();
  if (stored.lastKey === due.key) {
    return { triggered: false, reason: "monthly-collection-already-consumed", key: due.key };
  }
  if (stored.runningKey === due.key) {
    const runningAt = Date.parse(String(stored.runningAt || ""));
    const runningAge = Number.isFinite(runningAt) ? Date.now() - runningAt : Number.POSITIVE_INFINITY;
    if (runningAge < 2 * 60 * 60 * 1000) {
      return { triggered: false, reason: "monthly-collection-running", key: due.key };
    }
    appendAutomationLog({
      event: "moments-collection-scheduler-stale-run-recovered",
      scheduleKey: due.key,
      runningAt: stored.runningAt || ""
    });
  }
  // A failed/missing-target attempt is retried on the next catch-up day, not
  // every 15 seconds during the same day. Success is the only event that
  // consumes the month.
  if (stored.lastAttemptDate === due.catchUpDate) {
    return { triggered: false, reason: "monthly-collection-attempted-today", key: due.key };
  }

  const startedAt = new Date().toISOString();
  const finish = (lastRun) => {
    const completedRun = {
      ...lastRun,
      targetMonth: String(lastRun.targetMonth || targetWindow.month),
      targetStart: targetWindow.startAt,
      targetEnd: targetWindow.endAt,
      collectionMode: "account-watermark"
    };
    saveMomentsCollectionScheduleState({
      lastKey: completedRun.ok === true ? due.key : String(stored.lastKey || ""),
      lastAttemptDate: due.catchUpDate,
      lastRun: completedRun,
      targetMonth: completedRun.targetMonth,
      collectionMode: completedRun.collectionMode,
      runningKey: "",
      runningAt: ""
    });
    appendAutomationLog({
      event: "moments-collection-scheduler-finished",
      scheduleKey: due.key,
      ok: lastRun.ok === true,
      status: lastRun.status,
      friend: lastRun.friend,
      imported: lastRun.imported,
      deduplicated: lastRun.deduplicated,
      error: lastRun.error
    });
    return { triggered: true, ...completedRun };
  };

  // Persist the running key before touching WeFlow. A restart during this
  // month must not silently run the same collection twice.
  saveMomentsCollectionScheduleState({ ...stored, runningKey: due.key, runningAt: startedAt });
  momentsCollectionSchedulerRunning = true;
  try {
    const friend = String(settings.collectionAccount || settings.collectionWxid || "").trim();
    if (!friend) {
      return finish({
        key: due.key,
        startedAt,
        finishedAt: new Date().toISOString(),
        ok: false,
        status: "BLOCKED_MISSING_TARGET",
        friend: "",
        imported: 0,
        deduplicated: 0,
        error: "每月自动采集未配置默认采集账号；请在朋友圈设置中填写微信号/昵称和 WeFlow UID"
      });
    }
    const wxid = resolveMomentsTargetWxid(friend, settings.collectionWxid || "");
    if (!wxid) {
      return finish({
        key: due.key,
        startedAt,
        finishedAt: new Date().toISOString(),
        ok: false,
        status: "BLOCKED_MISSING_TARGET",
        friend,
        imported: 0,
        deduplicated: 0,
        error: "WeFlow 采集必须提供目标账号 UID"
      });
    }
    const result = await runMomentsCollect({
      friend,
      wxid,
      source: "weflow",
      // The monthly job is deliberately independent from the manual sample
      // size setting: it reads the full source timeline, then downloads the
      // account's next uncollected time range. The first run falls back to
      // the previous complete month; successful completion advances the
      // account watermark atomically.
      limit: 100,
      fullHistory: true,
      targetMonth: targetWindow.month
    });
    const summary = result.result || {};
    if (!result.ok) {
      return finish({
        key: due.key,
        startedAt,
        finishedAt: new Date().toISOString(),
        ok: false,
        status: "FAILED",
        friend,
        imported: Number(summary.imported || 0),
        deduplicated: Number(summary.deduplicated_or_ignored || 0),
        error: String(result.stderr || summary.error || "朋友圈月度采集失败").trim().slice(-1600)
      });
    }
    return finish({
      key: due.key,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: true,
      status: "COMPLETED",
      friend,
      imported: Number(summary.imported || 0),
      deduplicated: Number(summary.deduplicated_or_ignored || 0),
      libraryRoot: momentsLibraryRoot(),
      error: ""
    });
  } catch (error) {
    return finish({
      key: due.key,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      status: "FAILED",
      friend: String(settings.collectionAccount || settings.collectionWxid || "").trim(),
      imported: 0,
      deduplicated: 0,
      error: error.message
    });
  } finally {
    momentsCollectionSchedulerRunning = false;
  }
}

async function tickMomentsScheduler(now = new Date()) {
  const settings = getPageSettings().moments || {};
  const due = dueMomentsSchedule(settings, now);
  if (!due || momentsSchedulerRunning) return null;

  // The state file is durable. Only an open WeChat preparation blocks the next
  // automatic slot; confirmed slots count against the configurable automatic
  // quota, while manual attempts do not consume that quota.
  const publisherState = getMomentsPublisherState();
  const retryInfo = momentsScheduleRetryInfo(publisherState, now);
  const alreadyConsumed = momentsSchedulerConsumedKeys.has(due.key);
  if (alreadyConsumed && !retryInfo.allowed) {
    if (retryInfo.reason === "retry-budget-exhausted"
      && !momentsSchedulerRetryExhaustedKeys.has(due.key)) {
      momentsSchedulerRetryExhaustedKeys.add(due.key);
      while (momentsSchedulerRetryExhaustedKeys.size > 64) {
        momentsSchedulerRetryExhaustedKeys.delete(momentsSchedulerRetryExhaustedKeys.values().next().value);
      }
      appendAutomationLog({
        event: "moments-scheduler-self-check-exhausted",
        scheduleKey: due.key,
        attempts: retryInfo.attempts,
        reason: "窗口内安全重试额度已用完；已停止，不会换素材或继续点击微信"
      });
    }
    // A selection-only failure is checked again after the backoff interval.
    // Other failures and successful/pending runs remain one-shot for the day.
    return null;
  }
  const settingsDailyAutoLimit = Math.max(1, Math.min(20, Number(settings.dailyAutoLimit || 1)));
  const dailyAutoCount = momentsScheduledAttemptCount(publisherState);
  if (dailyAutoCount >= settingsDailyAutoLimit) {
    momentsSchedulerConsumedKeys.add(due.key);
    appendAutomationLog({
      event: "moments-scheduler-skipped",
      scheduleKey: due.key,
      reason: `今日自动准备额度已用完（${settingsDailyAutoLimit} 条）`,
      status: publisherState.status,
      dailyAutoCount,
      dailyAutoLimit: settingsDailyAutoLimit
    });
    return { triggered: false, reason: "daily-auto-limit-reached", status: publisherState.status, key: due.key };
  }
  if (momentsHasPendingPreparation(publisherState)) {
    momentsSchedulerConsumedKeys.add(due.key);
    appendAutomationLog({
      event: "moments-scheduler-skipped",
      scheduleKey: due.key,
      reason: `已有朋友圈正在等待人工处理（${publisherState.status}），不会并发覆盖微信窗口`,
      status: publisherState.status,
      dailyAutoCount,
      dailyAutoLimit: settingsDailyAutoLimit
    });
    return { triggered: false, reason: "human-confirmation-pending", status: publisherState.status, key: due.key };
  }

  momentsSchedulerConsumedKeys.add(due.key);
  while (momentsSchedulerConsumedKeys.size > 64) {
    momentsSchedulerConsumedKeys.delete(momentsSchedulerConsumedKeys.values().next().value);
  }
  const policy = selectionPolicyForRule(settings.selectionRule);
  const startedAt = new Date().toISOString();
  momentsSchedulerRunning = true;
  try {
    const result = await runMomentsPrepare("", {
      policy,
      source: "scheduled",
      dailyAutoLimit: settingsDailyAutoLimit
    });
    const record = result.result?.record || result.result || {};
    let doctor = null;
    if (!result.ok) {
      // Diagnose immediately, then let the next window poll retry only the
      // idempotent selection-only failure. Upload/UI failures stop here.
      doctor = await runMomentsDoctor();
    }
    const doctorResult = doctor?.result || {};
    const doctorSummary = doctor ? {
      ok: doctor.ok === true,
      code: doctor.code,
      timedOut: doctor.timedOut === true,
      status: doctorResult.status || doctorResult.state || "",
      error: String(doctorResult.error || doctor.stderr || "").trim().slice(-1200)
    } : null;
    momentsSchedulerLastRun = {
      key: due.key,
      policy,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: result.ok === true,
      code: result.code,
      status: record.status || (result.ok ? "PREPARED_FOR_HUMAN_CONFIRM" : "FAILED"),
      workId: record.work_id || result.result?.work_id || "",
      error: result.ok ? "" : String(result.stderr || record.error || "").trim().slice(-1200),
      doctor: doctorSummary
    };
    appendAutomationLog({
      event: "moments-scheduler-finished",
      scheduleKey: due.key,
      selectionRule: settings.selectionRule || "last-year-day",
      policy,
      ok: result.ok === true,
      status: momentsSchedulerLastRun.status,
      workId: momentsSchedulerLastRun.workId,
      error: momentsSchedulerLastRun.error,
      doctorOk: doctorSummary?.ok === true,
      doctorStatus: doctorSummary?.status || "",
      doctorError: doctorSummary?.error || "",
      retryable: momentsScheduleRetryInfo(getMomentsPublisherState(), new Date()).retryable
    });
    return { triggered: true, ...momentsSchedulerLastRun };
  } catch (error) {
    const doctor = await runMomentsDoctor();
    const doctorResult = doctor?.result || {};
    const doctorSummary = {
      ok: doctor?.ok === true,
      code: doctor?.code ?? null,
      timedOut: doctor?.timedOut === true,
      status: doctorResult.status || doctorResult.state || "",
      error: String(doctorResult.error || doctor?.stderr || "").trim().slice(-1200)
    };
    momentsSchedulerLastRun = {
      key: due.key,
      policy,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      code: null,
      status: "FAILED",
      workId: "",
      error: error.message,
      doctor: doctorSummary
    };
    appendAutomationLog({
      event: "moments-scheduler-error",
      scheduleKey: due.key,
      selectionRule: settings.selectionRule || "last-year-day",
      policy,
      error: error.message,
      doctorOk: doctorSummary.ok,
      doctorStatus: doctorSummary.status,
      doctorError: doctorSummary.error
    });
    return { triggered: true, ...momentsSchedulerLastRun };
  } finally {
    momentsSchedulerRunning = false;
  }
}

function startMomentsScheduler() {
  if (momentsSchedulerTimer) return momentsSchedulerTimer;
  // Check often enough to survive a normal minute boundary.  When a daily
  // window is configured, the first poll after the workbench becomes ready
  // prepares the day's item; the durable publisher state and daily quota keep
  // later polls from creating a second attempt.
  momentsSchedulerTimer = setInterval(() => {
    tickMomentsCollectionScheduler()
      .then(() => tickMomentsScheduler())
      .catch((error) => {
      appendAutomationLog({ event: "moments-scheduler-error", error: error.message });
      });
  }, 15_000);
  momentsSchedulerTimer.unref?.();
  return momentsSchedulerTimer;
}

function runMomentsOrganize() {
  const root = momentsLibraryRoot();
  const python = exists(MOMENTS_PYTHON_ROOT) ? MOMENTS_PYTHON_ROOT : pythonExe();
  return new Promise((resolve) => {
    const child = childProcess.spawn(python, ["-m", "moments_library.catalog", "--library", root, "annotate"], {
      cwd: APP_ROOT,
      windowsHide: true,
      env: { ...process.env, PYTHONPATH: [APP_ROOT, process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: null, stdout, stderr: `${stderr}\n素材标签整理超过 120 秒，进程已停止。` });
    }, 120_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ ok: false, code: null, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on("close", (code) => finish({ ok: code === 0, code, stdout, stderr, result: parseMomentsProcessOutput(stdout) }));
  });
}

function getLiveDistributionSnapshot({ workspaceSettings = getWorkspaceSettings(), distributionSettings = workspaceSettings.pageSettings?.distribution || {}, force = false } = {}) {
  const additionalRoots = configuredDistributionSendRoots(distributionSettings);
  const cacheKey = JSON.stringify({
    publishRoot: path.resolve(PUBLISH_ROOT),
    libraryRoot: path.resolve(workspaceSettings.workPackage.libraryPath || ""),
    additionalRoots
  });
  const now = Date.now();
  if (!force
    && liveDistributionSnapshotCache.value
    && liveDistributionSnapshotCache.key === cacheKey
    && now - liveDistributionSnapshotCache.generatedAt < LIVE_DISTRIBUTION_CACHE_TTL_MS) {
    return liveDistributionSnapshotCache.value;
  }
  const distribution = getDistributionSnapshot({
    publishRoot: PUBLISH_ROOT,
    libraryRoot: workspaceSettings.workPackage.libraryPath,
    additionalRoots
  });
  distribution.collections = decorateCollectionsWithWorks(
    mergeCollectionLedger(distribution.collections || [])
  );
  distribution.devices = mergeDeviceNotes(
    readJson(DEVICE_REGISTRY_FILE, { devices: [] }).devices || []
  );
  distribution.approvedDeviceKeys = readDeviceDistributionApprovals().keys;
  distribution.reserve = {
    traffic: countReserve(distribution.collections, "traffic"),
    conversion: countReserve(distribution.collections, "conversion"),
    unclassified: countReserve(distribution.collections, "unclassified"),
    all: countReserve(distribution.collections, "all")
  };
  distribution.automationHistory = recentAutomationLogs();
  distribution.automaticDistributionMonitor = { ...automaticDistributionMonitorState };
  distribution.snapshotDeferred = false;
  liveDistributionSnapshotCache = {
    key: cacheKey,
    generatedAt: Date.now(),
    value: distribution
  };
  return distribution;
}

function getDashboard(force = false, selectedLibraryPath = "", options = {}) {
  ensureDataFiles();
  const lite = options?.lite === true;
  const state = readJson(STATE_FILE, {});
  // Keep first paint lightweight. Scan a category only after the renderer
  // explicitly requests it; a stale saved selection must not trigger a full
  // scan (especially when it points at a dot-prefixed holding folder).
  const materials = getMaterialLibrary(force, selectedLibraryPath, { loadDefault: false });
  const templates = getTemplateLibrary();
  if (CONTENT_ONLY_MODE && lite && !selectedLibraryPath) {
    const workspaceSettings = getWorkspaceSettings();
    const prompts = readJson(PROMPTS_FILE, { prompts: [] });
    return {
      appInfo: {
        name: "内容生产",
        instanceId: CONTENT_INSTANCE_ID,
        instanceLabel: CONTENT_INSTANCE_LABEL,
        port: PORT,
        remoteDebuggingPort: Number(process.env.TB_REMOTE_DEBUGGING_PORT || CONTENT_INSTANCE_CONFIG.remoteDebuggingPort),
        assignedAccountIds: [...ASSIGNED_ACCOUNT_IDS],
        version: APP_VERSION,
        channel: process.versions.electron ? "开发独立实例" : "本地开发版（热更新）",
        runtimeRoot: DATA_ROOT,
        releaseRoot: RELEASE_ROOT,
        sourceRoot: __dirname,
        repositoryUrl: SOURCE_REPOSITORY_URL,
        releaseUrl: RELEASE_URL,
        mobileUpdateUrl: MOBILE_UPDATE_URL,
        desktop: Boolean(process.versions.electron)
      },
      projectRoot: PROJECT_ROOT,
      workspaceSettings,
      skills: { items: [] },
      generatedAt: new Date().toISOString(),
      dashboardLite: true,
      materialCacheStaleTime,
      state,
      materials,
      templates,
      products: { groups: [], root: "", generatedAt: new Date().toISOString() },
      prompts,
      logs: { productionCount: 0, imageCount: 0, entries: [] },
      productionTasks: [],
      distribution: {
        collections: [],
        devices: [],
        approvedDeviceKeys: [],
        reserve: { traffic: 0, conversion: 0, unclassified: 0, all: 0 },
        automationHistory: [],
        snapshotDeferred: true
      },
      tagGroups: TAG_GROUPS,
      stats: {
        materialCategories: materials.categories.length,
        materialItems: materials.categories.reduce((sum, category) => sum + category.count, 0),
        templates: templates.templates.length,
        productGroups: 0,
        products: 0,
        productionRows: 0,
        imageRows: 0
      }
    };
  }
  // The first paint is used by the content-production page as well as the
  // dashboard. In lite mode getProductLibrary stops before reading image
  // metadata; the full product view requests the normal library later.
  const products = getProductLibrary({ lite });
  const logs = getLogs();
  const prompts = readJson(PROMPTS_FILE, { prompts: [] });
  const productionTasks = buildProductionTaskIndex(materials, templates, logs, state);
  const workspaceSettings = getWorkspaceSettings();
  const distributionSettings = workspaceSettings.pageSettings?.distribution || {};
  const distribution = lite
    ? {
      collections: [],
      devices: [],
      approvedDeviceKeys: readDeviceDistributionApprovals().keys,
      reserve: { traffic: 0, conversion: 0, unclassified: 0, all: 0 },
      automationHistory: recentAutomationLogs(),
      snapshotDeferred: true
    }
    : getLiveDistributionSnapshot({ workspaceSettings, distributionSettings });
  restartMaterialWatcherIfNeeded();
  return {
    appInfo: {
      name: "图文工作台",
      instanceId: CONTENT_INSTANCE_ID,
      instanceLabel: CONTENT_INSTANCE_LABEL,
      port: PORT,
      remoteDebuggingPort: Number(process.env.TB_REMOTE_DEBUGGING_PORT || CONTENT_INSTANCE_CONFIG.remoteDebuggingPort),
      assignedAccountIds: [...ASSIGNED_ACCOUNT_IDS],
      version: APP_VERSION,
      channel: process.env.TB_WORKBENCH_CHANNEL || (process.versions.electron ? "便携版" : "本地开发版（热更新）"),
      runtimeRoot: DATA_ROOT,
      releaseRoot: RELEASE_ROOT,
      sourceRoot: __dirname,
      repositoryUrl: SOURCE_REPOSITORY_URL,
      releaseUrl: RELEASE_URL,
      mobileUpdateUrl: MOBILE_UPDATE_URL,
      desktop: Boolean(process.versions.electron)
    },
    projectRoot: PROJECT_ROOT,
    workspaceSettings,
    skills: {
      items: typeof skillsRoute.materialDownloadCatalog === "function"
        ? [skillsRoute.materialDownloadCatalog()]
        : []
    },
    generatedAt: new Date().toISOString(),
    dashboardLite: lite,
    materialCacheStaleTime,
    state,
    materials,
    templates,
    products,
    prompts,
    logs,
    productionTasks,
    distribution,
    tagGroups: TAG_GROUPS,
    stats: {
      materialCategories: materials.categories.length,
      materialItems: materials.categories.reduce((sum, category) => sum + category.count, 0),
      templates: templates.templates.length,
      productGroups: products.groups.length,
      products: products.groups.reduce((sum, group) => sum + group.count, 0),
      productionRows: logs.productionCount,
      imageRows: logs.imageCount
    }
  };
}

function isPathInside(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isAllowedFile(filePath) {
  const resolved = path.resolve(filePath);
  const leadRuntimeRoot = process.env.TEAMBUILDING_LEAD_RUNTIME_ROOT
    || "D:\\AICode\\运行数据\\江湖有旅人\\微信团建客资月度统计";
  const leadAgentRoot = process.env.TEAMBUILDING_LEAD_AGENT_ROOT
    || "D:\\AICode\\AI\\private-config\\agents\\jianghu-teambuilding-lead";
  const allowed = [
    path.resolve(PROJECT_ROOT),
    path.resolve(SKILL_ROOT),
    path.resolve(SKILLS_LIBRARY_ROOT),
    path.resolve(APP_ROOT),
    path.resolve(PROJECT_APP_ROOT),
    path.resolve(DATA_ROOT),
    path.resolve(os.homedir(), "Downloads"),
    path.resolve("D:\\Download\\素材下载"),
    path.resolve("D:\\Download"),
    path.resolve(MOMENTS_LIBRARY_ROOT),
    path.resolve(leadAgentRoot),
    path.resolve(leadRuntimeRoot),
    path.resolve(getWorkspaceSettings().materialRoot),
    path.resolve(getWorkspaceSettings().workPackage.libraryPath),
    path.resolve(TEMPLATE_REPOSITORY_OPEN_ROOT),
    path.resolve(TEMPLATE_PROJECT_LEDGER_OPEN_ROOT)
  ];
  const explicitlyAllowedFiles = [path.resolve(CONVERSION_KNOWLEDGE_REPORT_PATH)];
  return allowed.some((root) => isPathInside(root, resolved)) || explicitlyAllowedFiles.includes(resolved);
}

function trashEditableWorkspaceDirectory(targetInput = "") {
  const target = path.resolve(String(targetInput || "").trim());
  const pageSettings = getPageSettings();
  const roots = [
    getWorkspaceSettings().materialRoot,
    pageSettings.production?.templateRoot || path.join(PROJECT_ROOT, "02-模板库")
  ].filter(Boolean).map((root) => path.resolve(root));
  const root = roots.find((candidate) => isPathInside(candidate, target) && candidate.toLowerCase() !== target.toLowerCase());
  if (!root || !exists(target)) throw new Error("只能删除素材库或模板库内部的真实文件夹");
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("只能删除真实文件夹，不能删除文件或链接");
  const command = "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:TB_TRASH_TARGET,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)";
  const result = childProcess.spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    env: { ...process.env, TB_TRASH_TARGET: target },
    encoding: "utf8"
  });
  if (result.status !== 0 || exists(target)) {
    throw new Error(String(result.stderr || result.stdout || "文件夹没有移入回收站").trim());
  }
  materialCategoryCache.clear();
  materialPostCache = null;
  materialLibraryCache = null;
  setImmediate(() => queueMaterialGlobalIndexRefresh({ force: true }));
  return { ok: true, path: target, recoverable: true };
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": type
  });
  res.end(body);
}

function extensionCorsHeaders(req) {
  const origin = String(req.headers.origin || "");
  const isAllowed = origin === "https://chatgpt.com"
    || origin === "https://chat.openai.com"
    || origin === "https://ad.xiaohongshu.com"
    || /^chrome-extension:\/\/[a-z]{32}$/.test(origin)
    || /^edge-extension:\/\/[a-z]{32}$/.test(origin);
  if (!isAllowed) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Private-Network": "true",
    "Vary": "Origin"
  };
}

function sendExtensionJson(req, res, body, status = 200) {
  if (res.headersSent) return;
  const json = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    ...extensionCorsHeaders(req)
  };
  const acceptsGzip = /(^|,\s*)gzip(?:\s*;|\s*,|\s*$)/i.test(String(req.headers["accept-encoding"] || ""));
  const payload = Buffer.from(json, "utf8");
  if (!acceptsGzip || payload.length < 64 * 1024) {
    res.writeHead(status, headers);
    res.end(payload);
    return;
  }
  return new Promise((resolve, reject) => {
    zlib.gzip(payload, { level: 6 }, (error, compressed) => {
      if (error) {
        reject(error);
        return;
      }
      if (res.headersSent) {
        resolve();
        return;
      }
      res.writeHead(status, {
        ...headers,
        "Content-Encoding": "gzip",
        "Content-Length": compressed.length,
        "Vary": "Accept-Encoding"
      });
      res.end(compressed, resolve);
    });
  });
}


function safeName(name) {
  const cleaned = String(name || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!cleaned || /^\.+$/.test(cleaned)) return "未命名";
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(cleaned) ? `_${cleaned}` : cleaned;
}

function createDirectoryJunction(source, target) {
  try {
    fs.symlinkSync(source, target, "junction");
    return true;
  } catch {
    try {
      fs.cpSync(source, target, { recursive: true, dereference: false, errorOnExist: false });
      return false;
    } catch {
      return false;
    }
  }
}

function collectMaterialLinks(libraryPath, items, filterSummary, options = {}) {
  const libraryRoot = path.resolve(libraryPath || "");
  if (!libraryRoot || !isAllowedFile(libraryRoot) || !exists(libraryRoot)) throw new Error("material library not allowed");
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const folderName = `.筛选整合_${stamp}_${items.length}条`;
  const targetRoot = path.join(libraryRoot, folderName);
  const tempRoot = path.join(libraryRoot, `.tmp-${folderName}`);
  if (!isPathInside(libraryRoot, targetRoot) || !isPathInside(libraryRoot, tempRoot)) throw new Error("target not allowed");
  const linkDirectory = options.linkDirectory || createDirectoryJunction;
  const manifest = [];
  try {
    fs.mkdirSync(tempRoot, { recursive: true });
    items.forEach((item, index) => {
      const source = path.resolve(item.path || "");
      if (!isPathInside(libraryRoot, source) || !exists(source)) return;
      const target = path.join(tempRoot, `${String(index + 1).padStart(3, "0")}_${safeName(item.name || path.basename(source))}`);
      if (exists(target)) return;
      const linked = linkDirectory(source, target);
      manifest.push({ name: item.name || path.basename(source), source, target, linked });
    });
    fs.writeFileSync(path.join(tempRoot, "筛选说明.json"), JSON.stringify({ createdAt: new Date().toISOString(), filterSummary, count: manifest.length, items: manifest }, null, 2), "utf8");
    fs.renameSync(tempRoot, targetRoot);
    return { folderPath: targetRoot, created: manifest.length };
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}
function sendJson(res, body) {
  send(res, 200, JSON.stringify(body), "application/json; charset=utf-8");
}

function isLoopbackAddress(address = "") {
  const normalized = String(address || "").toLowerCase().replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

function requestCookies(req) {
  return String(req.headers.cookie || "").split(";").reduce((cookies, entry) => {
    const separator = entry.indexOf("=");
    if (separator < 0) return cookies;
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function mobileConversionToken() {
  try {
    const existing = fs.readFileSync(MOBILE_CONVERSION_TOKEN_FILE, "utf8").trim();
    if (/^[a-f0-9]{48}$/i.test(existing)) return existing;
  } catch {}
  const token = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(path.dirname(MOBILE_CONVERSION_TOKEN_FILE), { recursive: true });
  fs.writeFileSync(MOBILE_CONVERSION_TOKEN_FILE, token, { encoding: "utf8", mode: 0o600 });
  return token;
}

function hasMobileConversionAccess(req, parsed) {
  const supplied = String(parsed.query.access || requestCookies(req).tb_mobile_access || "");
  const expected = mobileConversionToken();
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length
    && suppliedBuffer.length > 0
    && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function localIPv4Addresses() {
  const addresses = [];
  Object.values(os.networkInterfaces()).flat().forEach((item) => {
    if (!item || item.internal || item.family !== "IPv4") return;
    if (String(item.address).startsWith("169.254.")) return;
    addresses.push(item.address);
  });
  return [...new Set(addresses)];
}

function mobileConversionLink() {
  const address = localIPv4Addresses()[0] || "127.0.0.1";
  return `http://${address}:${PORT}/mobile-conversion?access=${mobileConversionToken()}`;
}

function rewriteIntegratedConversionContent(source) {
  return String(source || "")
    .replaceAll("'/api/", "'/conversion-integrated/api/")
    .replaceAll('"/api/', '"/conversion-integrated/api/')
    .replaceAll("`/api/", "`/conversion-integrated/api/")
    .replaceAll(
      "input.startsWith('/conversion-integrated/api/')",
      "input.startsWith('/api/')"
    )
    .replaceAll(
      "pathname.startsWith('/conversion-integrated/api/')",
      "pathname.startsWith('/api/')"
    )
    .replaceAll(
      "/conversion-integrated/api/正式SOP",
      "/conversion-integrated/api/正式SOP?workbench-proxy=20260729-2"
    )
    .replaceAll(
      "/conversion-integrated/api/用户状态",
      "/conversion-integrated/api/用户状态?workbench-proxy=20260729-2"
    )
    .replaceAll(
      "console.error('正式SOP加载失败',error)",
      "console.warn('正式SOP增强层已回退到页面现有数据',error?.message||error)"
    );
}

function rewriteIntegratedConversionDocument(source) {
  const seamlessEmbeddedStyle = `
<style id="workbench-seamless-embed">
html.embedded-host,
html.embedded-host body,
html.embedded-host .app {
  background: transparent !important;
  background-image: none !important;
}
html.embedded-host .side {
  padding: 18px 28px 8px !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html.embedded-host .main {
  padding: 8px 28px 28px !important;
  background: transparent !important;
}
html.embedded-host .side-bottom {
  background: color-mix(in srgb, var(--panel) 74%, transparent) !important;
}
html.embedded-host[data-workbench-theme="midnight"],
html.embedded-host[data-workbench-theme="midnight"] body,
html.embedded-host[data-workbench-theme="midnight"] .app,
html.embedded-host[data-workbench-theme="midnight-glass"],
html.embedded-host[data-workbench-theme="midnight-glass"] body,
html.embedded-host[data-workbench-theme="midnight-glass"] .app {
  color-scheme: dark;
  --panel: rgba(18, 35, 49, .86);
  --panel-light: rgba(29, 52, 67, .76);
  --line: rgba(144, 193, 207, .2);
  --ink: #edf6f7;
  --muted: #b6c7cc;
  --accent: #68b8ff;
  --selection: rgba(64, 124, 158, .35);
  color: var(--ink) !important;
}
html.embedded-host[data-workbench-theme="midnight"] :is(.card, .panel, .module, .side-bottom, input, textarea, select),
html.embedded-host[data-workbench-theme="midnight-glass"] :is(.card, .panel, .module, .side-bottom, input, textarea, select) {
  color: var(--ink) !important;
  border-color: var(--line) !important;
  background: color-mix(in srgb, var(--panel) 88%, transparent) !important;
}
@media (max-width: 900px) {
  html.embedded-host .side {
    padding: 12px 14px 6px !important;
  }
  html.embedded-host .main {
    padding: 8px 14px 22px !important;
  }
}
</style>`;
  const embeddedThemeScript = `
<script id="workbench-theme-bridge">
(function(){
  function applyWorkbenchTheme(theme){
    var value = String(theme || new URLSearchParams(location.search).get("theme") || "neo");
    document.documentElement.classList.add("embedded-host");
    document.documentElement.dataset.workbenchTheme = value;
    document.documentElement.dataset.theme = value;
  }
  applyWorkbenchTheme(new URLSearchParams(location.search).get("theme"));
  window.addEventListener("message", function(event){
    if (event.origin !== window.location.origin || !event.data || event.data.type !== "jianghu-theme") return;
    applyWorkbenchTheme(event.data.theme);
  });
  window.parent && window.parent.postMessage({ type: "jianghu-theme-ready" }, window.location.origin);
})();
</script>`;
  const rewritten = rewriteIntegratedConversionContent(source)
    .replaceAll(
      "正式SOP增强.js?v=20260718-scrollfix2",
      "正式SOP增强.js?v=20260718-scrollfix2&workbench-proxy=20260729-2"
    )
    .replaceAll('href="/', 'href="/conversion-integrated/')
    .replaceAll('src="/', 'src="/conversion-integrated/');
  return rewritten.includes("</head>")
    ? rewritten.replace("</head>", `${seamlessEmbeddedStyle}${embeddedThemeScript}</head>`)
    : `${seamlessEmbeddedStyle}${embeddedThemeScript}${rewritten}`;
}

function isIntegratedConversionCompatibilityPath(pathname) {
  return pathname === "/api/正式SOP" || pathname === "/api/用户状态";
}

function proxyIntegratedConversion(req, res, parsed, pathname) {
  const prefix = "/conversion-integrated";
  const upstreamPath = pathname.slice(prefix.length) || "/";
  const requestPath = `${upstreamPath}${parsed.search || ""}`;
  const cacheKey = `${upstreamPath}${upstreamPath.endsWith(".js") ? ":js" : ":document"}`;
  const canUseRewriteCache = req.method === "GET" && (upstreamPath === "/" || upstreamPath.endsWith(".js"));
  const cached = canUseRewriteCache ? conversionProxyCache.get(cacheKey) : null;
  if (cached && Date.now() - cached.savedAt < CONVERSION_CACHE_TTL_MS) {
    if (!res.headersSent) {
      res.writeHead(200, {
        "Content-Type": cached.contentType,
        "Content-Length": Buffer.byteLength(cached.content),
        "Cache-Control": "private, max-age=60"
      });
      res.end(cached.content);
    }
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const upstream = http.request(`${CONVERSION_SERVICE_ORIGIN}${requestPath}`, {
      method: req.method,
      headers: {
        ...req.headers,
        host: new URL(CONVERSION_SERVICE_ORIGIN).host,
        origin: CONVERSION_SERVICE_ORIGIN,
        referer: `${CONVERSION_SERVICE_ORIGIN}/`
      }
    }, (upstreamResponse) => {
      const contentTypeHeader = String(upstreamResponse.headers["content-type"] || "");
      const isAppDocument = req.method === "GET"
        && upstreamPath === "/"
        && contentTypeHeader.includes("text/html");
      const isJavascript = req.method === "GET"
        && (contentTypeHeader.includes("javascript") || upstreamPath.endsWith(".js"));
      if (!isAppDocument && !isJavascript) {
        const headers = { ...upstreamResponse.headers, "cache-control": "no-store" };
        delete headers["content-security-policy"];
        res.writeHead(upstreamResponse.statusCode || 502, headers);
        upstreamResponse.pipe(res);
        upstreamResponse.on("end", resolve);
        return;
      }
      const chunks = [];
      upstreamResponse.on("data", (chunk) => chunks.push(chunk));
      upstreamResponse.on("end", () => {
        const source = Buffer.concat(chunks).toString("utf8");
        const content = isAppDocument
          ? rewriteIntegratedConversionDocument(source)
          : rewriteIntegratedConversionContent(source);
        if (canUseRewriteCache && (upstreamResponse.statusCode || 200) < 400) {
          conversionProxyCache.set(cacheKey, {
            savedAt: Date.now(),
            content,
            contentType: isAppDocument
              ? "text/html; charset=utf-8"
              : "application/javascript; charset=utf-8"
          });
        }
        res.writeHead(upstreamResponse.statusCode || 200, {
          "Content-Type": isAppDocument
            ? "text/html; charset=utf-8"
            : "application/javascript; charset=utf-8",
          "Content-Length": Buffer.byteLength(content),
          "Cache-Control": PORT === 4327 ? "private, max-age=60" : "no-store"
        });
        res.end(content);
        resolve();
      });
    });
    upstream.on("error", reject);
    req.pipe(upstream);
  });
}

async function warmIntegratedConversionCache() {
  try {
    await ensureConversionService();
    const response = await networkFetch(`${CONVERSION_SERVICE_ORIGIN}/`);
    if (!response.ok) return;
    const content = rewriteIntegratedConversionDocument(await response.text());
    conversionProxyCache.set("/:document", {
      savedAt: Date.now(),
      content,
      contentType: "text/html; charset=utf-8"
    });
  } catch {
    // The conversion service can be started later without blocking the workbench.
  }
}

async function requestConversionService(endpoint, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15_000));
  try {
    const response = await fetch(`${CONVERSION_SERVICE_ORIGIN}${endpoint}`, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`转化知识库返回了无法识别的内容（${response.status}）`);
    }
    if (!response.ok) throw new Error(payload.error || payload.message || `转化知识库请求失败（${response.status}）`);
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("转化知识库响应超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createConversionServiceSupervisor({ probe, launch, wait, attempts = 30 }) {
  let pending = null;
  return async function ensureReady() {
    if (pending) return pending;
    pending = (async () => {
      try {
        await probe();
        return { ok: true, started: false };
      } catch {}
      await launch();
      let lastError = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        await wait();
        try {
          await probe();
          return { ok: true, started: true };
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(`流量转化模块启动超时${lastError?.message ? `：${lastError.message}` : ""}`);
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}

function launchConversionService() {
  if (!exists(CONVERSION_ASSISTANT_LAUNCHER)) {
    throw new Error("流量转化模块文件不完整，请修复安装后重试");
  }
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("wscript.exe", [CONVERSION_ASSISTANT_LAUNCHER], {
      cwd: CONVERSION_ASSISTANT_ROOT,
      detached: true,
      windowsHide: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.removeListener("error", reject);
      child.unref();
      resolve();
    });
  });
}

const ensureConversionService = createConversionServiceSupervisor({
  probe: () => requestConversionService("/api/健康", { timeoutMs: 1_500 }),
  launch: launchConversionService,
  wait: () => new Promise((resolve) => setTimeout(resolve, 500)),
  attempts: 40
});

async function getConversionSnapshot(options = {}) {
  const includeLargeIndexes = options.includeLargeIndexes !== false;
  const sync = getConversionSyncStatus();
  try {
    await ensureConversionService();
    const baseRequests = [
      requestConversionService("/api/健康", { timeoutMs: 5_000 }),
      requestConversionService("/api/正式SOP", { timeoutMs: 12_000 }),
      requestConversionService("/api/用户旅程", { timeoutMs: 8_000 })
    ];
    if (includeLargeIndexes) {
      baseRequests.push(
        requestConversionService("/api/搜索快照", { timeoutMs: 45_000 }),
        requestConversionService("/api/方案索引", { timeoutMs: 30_000 })
      );
    }
    const [health, sop, journey, search, plans] = await Promise.all(baseRequests);
    return {
      ok: true,
      serviceOrigin: CONVERSION_SERVICE_ORIGIN,
      source: "图文工作台·流量转化",
      health,
      sop,
      search: includeLargeIndexes
        ? search
        : { 成功: true, 延迟加载: true, 数据: { 候选: [] }, 状态: { 已入库统计: {} } },
      plans: includeLargeIndexes
        ? plans
        : { 成功: true, 延迟加载: true, 数据: { 方案: [] }, 状态: {} },
      journey,
      deferredIndexes: !includeLargeIndexes,
      sync
    };
  } catch (error) {
    return {
      ok: false,
      serviceOrigin: CONVERSION_SERVICE_ORIGIN,
      source: "图文工作台·流量转化",
      launcherAvailable: exists(CONVERSION_ASSISTANT_LAUNCHER),
      error: error.message,
      sync
    };
  }
}

function isAllowedExternalTarget(target) {
  if (target === "cgpt-workpkg://run" || target === "cgpt-workpkg://configure") return true;
  try {
    const parsed = new URL(target);
    return parsed.protocol === "https:"
      && [
        "chatgpt.com",
        "mp.weixin.qq.com",
      "github.com",
      "raw.githubusercontent.com",
      "my.feishu.cn",
        "creator.douyin.com",
        "x.com",
        "we.ctrip.com"
      ].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function buildDistributionArgs(body = {}) {
  const type = body.type === "conversion" ? "团建转化" : "泛流量";
  if (body.action === "official-reserve") {
    return ["--official-account", "--type", type];
  }
  if (body.action !== "device-restock") throw new Error("不支持的分发操作");
  const device = String(body.device || "").trim();
  if (!device || device.length > 80 || device.startsWith("-") || /[\r\n\0]/.test(device)) {
    throw new Error("设备名称无效");
  }
  const args = ["--device", device, "--type", type];
  const collection = String(body.collection || "").trim();
  if (collection) {
    if (collection.length > 160 || collection.startsWith("-") || /[\r\n\0]/.test(collection)) {
      throw new Error("作品集名称无效");
    }
    args.push("--collection", collection);
  }
  return args;
}

function runDistributionAction(args) {
  const script = path.join(DEVICE_TRANSFER_ROOT, "scripts", "restock_device.py");
  const actionTaskId = `distribution-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(pythonExe(), [script, ...args], {
      cwd: DEVICE_TRANSFER_ROOT,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        TRAE_TASK_ID: actionTaskId
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const limit = 64 * 1024;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("分发操作超时，已停止等待；请检查设备端状态"));
    }, 20 * 60 * 1000);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < limit) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < limit) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, output: stdout.trim() });
      else reject(new Error((stderr || stdout || `分发脚本退出码 ${code}`).trim()));
    });
  });
}

function trimCompletedTasks(tasks) {
  if (tasks.size < 50) return;
  const removable = Array.from(tasks.entries())
    .filter(([, task]) => !["running", "cancelling"].includes(task.state))
    .sort((left, right) => String(left[1].startedAt).localeCompare(String(right[1].startedAt)));
  removable.slice(0, Math.max(1, tasks.size - 49))
    .forEach(([id]) => tasks.delete(id));
}

function recentPublicTasks(tasks, limit = 12) {
  const cutoff = Date.now() - (3 * 60 * 1000);
  for (const [id, task] of tasks.entries()) {
    if (["running", "cancelling"].includes(task.state)) continue;
    const finishedAt = Date.parse(task.finishedAt || task.startedAt || "");
    if (Number.isFinite(finishedAt) && finishedAt < cutoff) tasks.delete(id);
  }
  return Array.from(tasks.values())
    .sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")))
    .slice(0, limit)
    .map(publicTransferTask);
}

function resolveDistributionCollectionSource(collectionName, options = {}) {
  const name = String(collectionName || "").trim();
  if (!name) throw new Error("请选择一个真实可用的作品集");
  const libraryRoot = path.resolve(getWorkspaceSettings().workPackage.libraryPath);
  const distributionSettings = getPageSettings().distribution || {};
  const configuredSendRoots = configuredDistributionSendRoots(distributionSettings);
  const distribution = getDistributionSnapshot({
    publishRoot: PUBLISH_ROOT,
    libraryRoot,
    additionalRoots: configuredSendRoots
  });
  const collection = decorateCollectionsWithWorks(mergeCollectionLedger(distribution.collections || []))
    .find((item) => String(item.name || "") === name);
  if (!collection) throw new Error(`作品集不存在：${name}`);
  if (collection.manualResendRequiresConfirmation) {
    const error = new Error(`作品集已有成功分发记录，自动和手动都禁止再次发送：${name}`);
    error.code = "DUPLICATE_DISTRIBUTION_BLOCKED";
    throw error;
  }
  const eligible = options.automatic === true
    ? collection.automaticEligible === true
    : collection.manualEligible === true;
  const isDefaultSendSource = configuredSendRoots.some((entry) =>
    isPathInside(entry.root, collection.sourcePath || "")
  );
  if ((collection.workflowStage !== "mobile" && !isDefaultSendSource)
    || collection.sourceValid === false
    || !eligible) {
    const reason = (collection.exclusionReasons || []).join("；") || "作品集不在手机可分发阶段";
    throw new Error(`作品集当前不可发送：${name}（${reason}）`);
  }
  const source = path.resolve(String(collection.sourcePath || ""));
  const stageRoots = getWorkflowStageRoots(libraryRoot);
  const allowedRoots = [
    libraryRoot,
    stageRoots.workflowRoot,
    ...configuredSendRoots.map((entry) => entry.root)
  ].filter(Boolean).map((root) => path.resolve(root));
  if (!source || !exists(source) || !allowedRoots.some((root) => isPathInside(root, source))) {
    throw new Error(`作品集源目录无效：${name}`);
  }
  const managedSource = isPathInside(libraryRoot, source)
    || isPathInside(stageRoots.workflowRoot, source);
  return { collection, source, managedSource };
}

function readMaterialTagText(dir, maxChars = 120000) {
  const files = safeList(dir)
    .filter((entry) => entry.isFile() && textExts.has(path.extname(entry.name).toLowerCase()))
    .sort((left, right) => {
      const leftPriority = left.name.toLowerCase() === "text.txt" ? 0 : 1;
      const rightPriority = right.name.toLowerCase() === "text.txt" ? 0 : 1;
      return leftPriority - rightPriority || left.name.localeCompare(right.name, "zh-Hans-CN");
    });
  if (!files.length) return "";
  const chunks = [];
  let length = 0;
  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(dir, file.name), "utf8")
        .replace(/^\uFEFF/, "")
        .trim();
      if (!text) continue;
      const remaining = Math.max(0, maxChars - length);
      if (!remaining) break;
      const chunk = text.slice(0, remaining);
      chunks.push(chunk);
      length += chunk.length;
    } catch {
      // One unreadable sidecar must not hide tags found in other text files.
    }
  }
  return chunks.join("\n");
}

function readMaterialTagDocument(dir) {
  const file = path.join(dir, ".tags.json");
  if (!exists(file)) return { file, data: {}, exists: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (Array.isArray(parsed)) return { file, data: { tags: parsed }, exists: true };
    return { file, data: parsed && typeof parsed === "object" ? parsed : {}, exists: true };
  } catch {
    return { file, data: {}, exists: true, invalid: true };
  }
}

function writeMaterialTagDocument(entryPath, document) {
  const file = path.join(entryPath, ".tags.json");
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(document, null, 2), "utf8");
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    // Windows cannot replace an existing file with rename in every filesystem
    // provider. The temporary file is still in the same folder, so the
    // fallback remains scoped to this one material's metadata file.
    fs.copyFileSync(temporary, file);
    fs.rmSync(temporary, { force: true });
  }
}

function getMaterialLifecycleLedger(ledgerFile = MATERIAL_LIFECYCLE_LEDGER_FILE) {
  return readJson(ledgerFile, { version: 1, updatedAt: "", entries: {}, events: [] });
}

function writeMaterialLifecycleLedger(ledger, ledgerFile = MATERIAL_LIFECYCLE_LEDGER_FILE) {
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: ledger?.entries || {},
    events: Array.isArray(ledger?.events) ? ledger.events.slice(-4000) : []
  };
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  writeJson(ledgerFile, next);
  return next;
}

function lifecycleTagsForEntry(entryPath, patch = {}) {
  const document = readMaterialTagDocument(entryPath).data || {};
  const existingTags = Array.isArray(document.tags) ? document.tags : [];
  const nextTags = Array.isArray(patch.tags)
    ? patch.tags
    : existingTags;
  return {
    ...document,
    tags: Array.from(new Set(nextTags.map((tag) => String(tag).trim()).filter(Boolean))),
    ...(patch.mainTag ? { mainTag: patch.mainTag } : {}),
    ...(patch.mainTagSource ? { mainTagSource: patch.mainTagSource } : {}),
    ...(patch.folderHash ? { folderHash: patch.folderHash } : {}),
    ...(patch.contentFingerprint ? { contentFingerprint: patch.contentFingerprint } : {}),
    ...(patch.usageCount !== undefined ? { usageCount: Math.max(0, Number(patch.usageCount) || 0) } : {}),
    ...(patch.lifecycleState ? { lifecycleState: patch.lifecycleState } : {}),
    ...(patch.operationalStatus ? { operationalStatus: patch.operationalStatus } : {}),
    ...(patch.conflicts ? { conflicts: uniqueConflicts(patch.conflicts) } : {}),
    ...(patch.lock !== undefined ? { lock: patch.lock } : {}),
    ...(patch.updatedAt ? { updatedAt: patch.updatedAt } : {})
  };
}

function updateMaterialLifecycleFiles(entryPath, folderHash, patch = {}, options = {}) {
  const metadataFile = options.metadataLedgerFile || MATERIAL_METADATA_LEDGER_FILE;
  const stateFile = options.lifecycleLedgerFile || MATERIAL_LIFECYCLE_LEDGER_FILE;
  const hashCacheFile = options.hashCacheFile || MATERIAL_HASH_CACHE_FILE;
  const now = patch.updatedAt || new Date().toISOString();
  const metadata = options.metadata || getMaterialMetadataLedger(metadataFile);
  const lifecycle = options.lifecycle || getMaterialLifecycleLedger(stateFile);
  const previousMetadata = metadata.entries?.[folderHash] || {};
  const previousState = lifecycle.entries?.[folderHash] || {};
  const merged = {
    ...previousMetadata,
    ...patch,
    folderHash,
    entryPath,
    updatedAt: now,
    conflicts: uniqueConflicts(patch.conflicts ?? previousMetadata.conflicts ?? previousState.conflicts)
  };
  metadata.entries = { ...(metadata.entries || {}), [folderHash]: merged };
  metadata.updatedAt = now;
  fs.mkdirSync(path.dirname(metadataFile), { recursive: true });
  writeJson(metadataFile, metadata);
  lifecycle.entries = {
    ...(lifecycle.entries || {}),
    [folderHash]: { ...previousState, ...merged, updatedAt: now }
  };
  writeMaterialLifecycleLedger(lifecycle, stateFile);
  if (exists(entryPath) && fs.statSync(entryPath).isDirectory()) {
    writeMaterialTagDocument(entryPath, lifecycleTagsForEntry(entryPath, merged));
  }
  if (options.refreshIndex !== false) {
    patchMaterialGlobalIndexMetadata(entryPath, merged, options.indexFile || MATERIAL_GLOBAL_INDEX_FILE);
  }
  if (hashCacheFile && exists(hashCacheFile)) {
    // The hash cache is updated by materialFolderHash; keep this branch as a
    // documented extension point without rewriting the whole cache on every
    // heartbeat mutation.
  }
  return { metadata: merged, lifecycle: lifecycle.entries[folderHash] };
}

function initializeMaterialLifecycle(options = {}) {
  const settings = getWorkspaceSettings();
  const materialRoot = path.resolve(options.materialRoot || settings.materialRoot);
  const metadataFile = options.metadataLedgerFile || options.ledgerFile || MATERIAL_METADATA_LEDGER_FILE;
  const stateFile = options.lifecycleLedgerFile || MATERIAL_LIFECYCLE_LEDGER_FILE;
  const hashCacheFile = options.hashCacheFile || MATERIAL_HASH_CACHE_FILE;
  const indexFile = options.indexFile || MATERIAL_GLOBAL_INDEX_FILE;
  const previewOnly = options.preview === true || options.dryRun === true;
  const metadata = getMaterialMetadataLedger(metadataFile);
  const lifecycle = getMaterialLifecycleLedger(stateFile);
  const usage = getMaterialUsageLedger(options.usageLedgerFile || MATERIAL_USAGE_LEDGER_FILE);
  const hashCache = getMaterialHashCache(hashCacheFile);
  const descriptors = materialCategoryIndex(materialRoot)
    .filter((category) => !category.name.startsWith("."));
  const candidates = [];
  let hashCacheChanged = false;
  descriptors.forEach((category) => {
    getDetectedMaterialPosts(category.path, true).forEach((post) => {
      const hashResult = materialFolderHash(post.path, { cacheFile: hashCacheFile, cache: hashCache });
      hashCacheChanged ||= hashResult.changed;
      const tagDocument = readMaterialTagDocument(post.path).data || {};
      const tagText = readMaterialTagText(post.path);
      const autoTags = inferMaterialTags(category.name, post.name, tagText);
      const existingTags = Array.isArray(tagDocument.tags) ? tagDocument.tags : [];
      const saved = metadata.entries?.[hashResult.hash] || {};
      const localMainTag = MATERIAL_MAIN_TAGS.includes(String(tagDocument.mainTag || "").trim())
        ? String(tagDocument.mainTag).trim()
        : "";
      const savedMainTag = MATERIAL_MAIN_TAGS.includes(String(saved.mainTag || "").trim())
        ? String(saved.mainTag).trim()
        : "";
      const automaticMainTag = inferMaterialMainTag(category.name, post.name, tagText);
      const mainTag = localMainTag || savedMainTag || automaticMainTag;
      const tags = Array.from(new Set([...existingTags, ...autoTags, mainTag].filter(Boolean)));
      const archiveUsage = materialArchiveUsageFolder(post.path, materialRoot);
      const inferredUsage = inferMaterialUsageCountFromPath(post.path, category.name, { materialRoot });
      const usageCount = archiveUsage === null
        ? Math.max(0, Number(saved.usageCount || 0), inferredUsage)
        : archiveUsage;
      const fingerprint = materialUsageFingerprint(post.path);
      candidates.push({
        category,
        post,
        hash: hashResult.hash,
        tagDocument,
        saved,
        localMainTag,
        savedMainTag,
        automaticMainTag,
        mainTag,
        tags,
        archiveUsage,
        inferredUsage,
        usageCount,
        fingerprint,
        existingState: lifecycle.entries?.[hashResult.hash] || {}
      });
    });
  });

  const fingerprints = new Map();
  candidates.forEach((candidate) => {
    if (!candidate.fingerprint) return;
    const owners = fingerprints.get(candidate.fingerprint) || [];
    owners.push(candidate);
    fingerprints.set(candidate.fingerprint, owners);
  });
  const result = {
    ok: true,
    preview: previewOnly,
    materialRoot,
    scanned: candidates.length,
    qualified: candidates.length,
    tagged: 0,
    createdTagFiles: 0,
    preservedTagFiles: 0,
    moved: 0,
    conflicts: 0,
    duplicates: 0,
    usageConflicts: 0,
    tagConflicts: 0,
    stateCounts: Object.fromEntries(MATERIAL_LIFECYCLE_STATES.map((state) => [state, 0])),
    conflictCounts: Object.fromEntries(MATERIAL_CONFLICT_CODES.map((code) => [code, 0])),
    items: []
  };
  const now = new Date().toISOString();
  candidates.forEach((candidate) => {
    const conflicts = [];
    if (candidate.localMainTag && candidate.savedMainTag && candidate.localMainTag !== candidate.savedMainTag) {
      conflicts.push("TAG_SOURCE_CONFLICT");
      result.tagConflicts += 1;
    }
    if (candidate.archiveUsage !== null
      && Object.prototype.hasOwnProperty.call(candidate.saved, "usageCount")
      && Number(candidate.saved.usageCount) !== candidate.archiveUsage) {
      conflicts.push("USAGE_COUNT_CONFLICT");
      result.usageConflicts += 1;
    }
    const duplicateOwners = candidate.fingerprint
      ? (fingerprints.get(candidate.fingerprint) || []).filter((owner) => owner.hash !== candidate.hash)
      : [];
    if (duplicateOwners.length) {
      conflicts.push("DUPLICATE_FINGERPRINT");
      result.duplicates += 1;
    }
    const existing = candidate.existingState;
    const decision = decideMaterialLifecycle({
      currentState: existing.lifecycleState,
      operationalStatus: existing.operationalStatus,
      hasTags: candidate.tags.length > 0,
      conflicts
    });
    const lifecycleState = decision.lifecycleState;
    const operationalStatus = decision.operationalStatus;
    const record = {
      ...candidate.saved,
      folderHash: candidate.hash,
      entryPath: candidate.post.path,
      name: candidate.post.name,
      categoryName: candidate.category.name,
      mainTag: candidate.mainTag,
      mainTagSource: candidate.localMainTag
        ? "manual-local"
        : candidate.savedMainTag
          ? "manual-ledger"
          : "automatic",
      tags: candidate.tags,
      usageCount: candidate.usageCount,
      usageSource: candidate.archiveUsage === null
        ? (candidate.saved.usageSource || "初次扫描推断")
        : "目录次数",
      contentFingerprint: candidate.fingerprint,
      lifecycleState,
      operationalStatus,
      conflicts: uniqueConflicts(conflicts),
      taggedAt: candidate.saved.taggedAt || now,
      tagVersion: 1,
      updatedAt: now
    };
    const stateRecord = {
      ...existing,
      ...record,
      lock: existing.lock || null,
      archiveEvents: Array.isArray(existing.archiveEvents) ? existing.archiveEvents : [],
      updatedAt: now
    };
    if (!previewOnly) {
      metadata.entries = { ...(metadata.entries || {}), [candidate.hash]: record };
      lifecycle.entries = { ...(lifecycle.entries || {}), [candidate.hash]: stateRecord };
      writeMaterialTagDocument(candidate.post.path, lifecycleTagsForEntry(candidate.post.path, record));
    }
    result.tagged += 1;
    if (candidate.tagDocument && Object.keys(candidate.tagDocument).length) result.preservedTagFiles += 1;
    else result.createdTagFiles += 1;
    if (conflicts.length) result.conflicts += 1;
    result.stateCounts[lifecycleState] = Number(result.stateCounts[lifecycleState] || 0) + 1;
    conflicts.forEach((code) => {
      result.conflictCounts[code] = Number(result.conflictCounts[code] || 0) + 1;
    });
    result.items.push({
      path: candidate.post.path,
      name: candidate.post.name,
      folderHash: candidate.hash,
      usageCount: candidate.usageCount,
      lifecycleState,
      operationalStatus,
      conflicts: uniqueConflicts(conflicts)
    });
  });
  if (!previewOnly) {
    metadata.updatedAt = now;
    lifecycle.updatedAt = now;
    fs.mkdirSync(path.dirname(metadataFile), { recursive: true });
    writeJson(metadataFile, metadata);
    writeMaterialLifecycleLedger(lifecycle, stateFile);
    if (hashCacheChanged) writeJson(hashCacheFile, hashCache);
    invalidateMaterialCache();
    if (options.refreshIndex !== false) {
      setImmediate(() => queueMaterialGlobalIndexRefresh({
        force: true,
        materialRoot,
        ledgerFile: metadataFile,
        cacheFile: hashCacheFile,
        indexFile
      }));
    }
  }
  return result;
}

function getMaterialLifecycleSnapshot(options = {}) {
  const file = options.lifecycleLedgerFile || MATERIAL_LIFECYCLE_LEDGER_FILE;
  const ledger = getMaterialLifecycleLedger(file);
  const entries = Object.values(ledger.entries || {});
  const stateCounts = Object.fromEntries(MATERIAL_LIFECYCLE_STATES.map((state) => [state, 0]));
  const operationCounts = Object.fromEntries(MATERIAL_OPERATION_STATUSES.map((status) => [status, 0]));
  let conflictCount = 0;
  entries.forEach((entry) => {
    const state = normalizeLifecycleState(entry.lifecycleState);
    const status = normalizeOperationalStatus(entry.operationalStatus);
    stateCounts[state] += 1;
    operationCounts[status] += 1;
    if (uniqueConflicts(entry.conflicts).length) conflictCount += 1;
  });
  return {
    ok: true,
    generatedAt: ledger.updatedAt || "",
    count: entries.length,
    conflictCount,
    stateCounts,
    operationCounts,
    entries
  };
}

function claimMaterialLifecycleUnlocked(body = {}, options = {}) {
  const settings = getWorkspaceSettings();
  const materialRoot = path.resolve(options.materialRoot || settings.materialRoot);
  const entryPath = path.resolve(String(body.entryPath || "").trim());
  if (!String(body.entryPath || "").trim() || !isPathInside(materialRoot, entryPath) || !exists(entryPath)) {
    const error = new Error("只能锁定当前素材库中真实存在的素材");
    error.code = "MATERIAL_PATH_INVALID";
    throw error;
  }
  const hashResult = materialFolderHash(entryPath, { cacheFile: options.hashCacheFile || MATERIAL_HASH_CACHE_FILE });
  const stateFile = options.lifecycleLedgerFile || MATERIAL_LIFECYCLE_LEDGER_FILE;
  const lifecycle = getMaterialLifecycleLedger(stateFile);
  const entry = lifecycle.entries?.[hashResult.hash] || {};
  const owner = String(body.owner || body.accountId || "").trim();
  const allowed = canClaimMaterial(entry, { owner, now: Date.now(), lockTtlMs: options.lockTtlMs });
  if (!allowed.ok) {
    const error = new Error(allowed.reason);
    error.code = allowed.code;
    throw error;
  }
  const now = new Date().toISOString();
  const lock = {
    owner,
    requestId: String(body.requestId || "").trim(),
    claimedAt: entry.lock?.owner === owner ? String(entry.lock.claimedAt || now) : now,
    heartbeatAt: now
  };
  const result = updateMaterialLifecycleFiles(entryPath, hashResult.hash, {
    lifecycleState: "生产中",
    operationalStatus: "正常",
    lock,
    updatedAt: now
  }, { ...options, lifecycleLedgerFile: stateFile });
  return { ok: true, folderHash: hashResult.hash, lock, ...result.lifecycle };
}

function markMaterialAwaitingArchiveUnlocked(body = {}, options = {}) {
  const entryPath = path.resolve(String(body.entryPath || "").trim());
  const materialRoot = path.resolve(options.materialRoot || getWorkspaceSettings().materialRoot);
  if (!entryPath || !isPathInside(materialRoot, entryPath) || !exists(entryPath)) {
    throw new Error("只能更新当前素材库中真实存在的素材");
  }
  const hashResult = materialFolderHash(entryPath, { cacheFile: options.hashCacheFile || MATERIAL_HASH_CACHE_FILE });
  return updateMaterialLifecycleFiles(entryPath, hashResult.hash, {
    lifecycleState: "作品已完成待归档",
    operationalStatus: "正常",
    updatedAt: new Date().toISOString()
  }, options);
}

function releaseMaterialLifecycleFailureUnlocked(body = {}, options = {}) {
  const entryPath = path.resolve(String(body.entryPath || "").trim());
  const materialRoot = path.resolve(options.materialRoot || getWorkspaceSettings().materialRoot);
  if (!entryPath || !isPathInside(materialRoot, entryPath) || !exists(entryPath)) {
    throw new Error("只能更新当前素材库中真实存在的素材");
  }
  const hashResult = materialFolderHash(entryPath, { cacheFile: options.hashCacheFile || MATERIAL_HASH_CACHE_FILE });
  const state = getMaterialLifecycleLedger(options.lifecycleLedgerFile || MATERIAL_LIFECYCLE_LEDGER_FILE);
  const previous = state.entries?.[hashResult.hash] || {};
  const owner = String(body.owner || body.accountId || "").trim();
  const lock = previous.lock?.owner && previous.lock.owner !== owner ? previous.lock : null;
  const patch = {
    lifecycleState: normalizeLifecycleState(previous.lifecycleState) === "归档完成"
      ? "归档完成"
      : normalizeLifecycleState(previous.lifecycleState),
    operationalStatus: operationalStatusForFailure(body),
    lock,
    lastError: String(body.error || body.message || "").slice(0, 500),
    updatedAt: new Date().toISOString()
  };
  return updateMaterialLifecycleFiles(entryPath, hashResult.hash, patch, options);
}

function archiveMaterialAfterProduction(body = {}, options = {}) {
  return withMaterialLedgerLock(() => archiveMaterialAfterProductionUnlocked(body, options));
}

function claimMaterialLifecycle(body = {}, options = {}) {
  return withMaterialLedgerLock(() => claimMaterialLifecycleUnlocked(body, options));
}

function markMaterialAwaitingArchive(body = {}, options = {}) {
  return withMaterialLedgerLock(() => markMaterialAwaitingArchiveUnlocked(body, options));
}

function releaseMaterialLifecycleFailure(body = {}, options = {}) {
  return withMaterialLedgerLock(() => releaseMaterialLifecycleFailureUnlocked(body, options));
}

function startDistributionTask(body = {}) {
  if (body.action !== "device-restock") {
    throw new Error("这个任务入口只用于手机作品包分发");
  }
  const trustedDevice = assertDiscoveredDeviceTarget(body.device, {
    approveDevice: body.approveDevice === true,
    deviceModel: String(body.deviceModel || "")
  });
  const transportDevice = resolveDeviceTransportTarget(
    body.device,
    String(body.deviceModel || ""),
    trustedDevice
  );
  const selected = resolveDistributionCollectionSource(body.collection, {
    automatic: body.automatic === true,
    manualResendConfirmed: body.manualResendConfirmed === true
  });
  const taskId = `distribution-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const distributionClaims = acquireWorkDistributionClaims(
    WORK_DISTRIBUTION_CLAIMS_ROOT,
    selected.collection.works,
    {
      ledgerFile: WORK_DISTRIBUTION_LEDGER_FILE,
      collection: selected.collection.name,
      deviceId: trustedDevice.id,
      device: trustedDevice.note || trustedDevice.displayName || transportDevice,
      taskId,
      claimTtlMs: DEFAULT_WORK_DISTRIBUTION_CLAIM_TTL_MS,
      allowStaleClaimRecovery: body.automatic === true,
      isTaskActive: (existingTaskId) => {
        const active = distributionTasks.get(String(existingTaskId || ""));
        return Boolean(active && ["running", "cancelling"].includes(active.state));
      }
    }
  );
  const args = ["--source", selected.source, "--device", transportDevice];
  trimCompletedTasks(distributionTasks);
  const record = {
    id: taskId,
    kind: "distribution",
    action: body.action,
    device: String(body.device || "").trim(),
    deviceLabel: String(body.deviceLabel || "").trim()
      || String(trustedDevice.note || trustedDevice.displayName || body.device || "").trim(),
    transportDevice,
    deviceId: trustedDevice.id,
    collection: String(body.collection || "").trim(),
    source: selected.source,
    managedSource: selected.managedSource,
    fileCount: selected.collection.fileCount || 0,
    bytes: selected.collection.bytes || 0,
    contentType: body.type === "conversion" ? "精准流量" : "泛流量",
    sourceType: body.automatic === true ? "auto_distribution" : "manual",
    automaticAttempt: Number(body.automaticAttempt || 0),
    automaticMaxAttempts: Number(body.automaticMaxAttempts || 0),
    manualResend: body.manualResendConfirmed === true,
    claimWorkIds: distributionClaims.workIds,
    works: selected.collection.works || [],
    state: "running",
    stage: "queued",
    stageLabel: "准备开始发送",
    progress: 0,
    message: "任务已经建立",
    output: "",
    remoteTaskId: "",
    startedAt: new Date().toISOString(),
    child: null
  };
  // The workbench is the source-of-truth for the current no-Junction
  // distribution stages. Send the exact validated collection source instead
  // of asking the legacy random-restock scanner to rediscover old platform
  // entries, then move it only after the receiver commit succeeds.
  const script = path.join(DEVICE_TRANSFER_ROOT, "scripts", "send_to_device.py");
  let child;
  try {
    child = childProcess.spawn(pythonExe(), [script, ...args], {
      cwd: DEVICE_TRANSFER_ROOT,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        TRAE_TASK_ID: taskId
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    releaseWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, record.claimWorkIds, { taskId });
    throw error;
  }
  record.child = child;
  distributionTasks.set(taskId, record);
  startDistributionClaimHeartbeat(taskId, record.claimWorkIds);
  child.stdout.on("data", (chunk) => updateTransferProgress(record, chunk));
  child.stderr.on("data", (chunk) => updateTransferProgress(record, chunk, true));
  child.on("error", (error) => {
    stopDistributionClaimHeartbeat(taskId);
    record.state = "failed";
    record.stage = "failed";
    record.stageLabel = "发送未完成";
    record.message = error.message;
    record.finishedAt = new Date().toISOString();
    releaseWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, record.claimWorkIds, { taskId });
  });
  child.on("close", (code) => {
    stopDistributionClaimHeartbeat(taskId);
    if (record.state === "cancelling") {
      record.state = "cancelled";
      record.stage = "cancelled";
      record.stageLabel = "已停止发送";
      record.message = "已停止；为防止重复发送，请先核对手机接收情况";
      releaseWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, record.claimWorkIds, { taskId });
    } else if (code === 0) {
      record.state = "completed";
      record.stage = "completed";
      record.stageLabel = "发送完成并已记录";
      record.progress = 100;
      record.message = "作品包已发送，已自动进入公众号";
      let recordError = null;
      try {
        recordDeviceDistribution({
          publishRoot: PUBLISH_ROOT,
          taskId: record.id,
          device: record.deviceLabel || record.device,
          deviceModel: trustedDevice.displayName || trustedDevice.id,
          collection: record.collection,
          sourcePath: record.source,
          fileCount: record.fileCount,
          bytes: record.bytes,
          transport: "LAN",
          confirmation: "接收端已提交确认"
        });
        (record.works || []).forEach((work) => recordSuccessfulWorkDistribution(
          WORK_DISTRIBUTION_LEDGER_FILE,
          {
            work,
            collection: record.collection,
            deviceId: record.deviceId,
            device: record.deviceLabel || record.device,
            taskId: record.id,
            manualResend: record.manualResend === true
          }
        ));
        (record.works || []).forEach((work) => recordWorkPlatformUsage(
          WORK_TAG_LEDGER_FILE,
          {
            work,
            platform: "douyin_xiaohongshu",
            source: "device_distribution",
            collection: record.collection,
            usedAt: new Date().toISOString()
          }
        ));
        invalidateLiveDistributionSnapshot();
      } catch (error) {
        recordError = error;
      }
      if (record.managedSource !== false) {
        try {
          const libraryRoot = getWorkspaceSettings().workPackage.libraryPath;
          const moved = moveCollectionSourceToStage({
            publishRoot: PUBLISH_ROOT,
            libraryRoot,
            collection: record.collection,
            stage: "official"
          });
          rebaseSuccessfulWorkDistributionPaths(WORK_DISTRIBUTION_LEDGER_FILE, {
            collection: record.collection,
            fromRoot: moved.sourcePath,
            toRoot: moved.targetPath,
            reason: "managed_collection_stage_move"
          });
        } catch (error) {
          record.stageLabel = "发送完成，文件待整理";
          record.message = `手机已确认接收；自动移动失败：${error.message}`;
        }
      }
      if (recordError) {
        record.stageLabel = "发送完成，记录待修复";
        record.message = `手机已确认接收；分发记录写入失败：${recordError.message}`;
      } else {
        releaseWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, record.claimWorkIds, { taskId });
      }
    } else {
      record.state = "failed";
      record.stage = "failed";
      record.stageLabel = "发送未完成";
      record.message = record.error || record.message || `分发进程退出码 ${code}`;
      releaseWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, record.claimWorkIds, { taskId });
    }
    record.finishedAt = new Date().toISOString();
    record.child = null;
  });
  return publicTransferTask(record);
}

function cancelDistributionTask(taskId) {
  const record = distributionTasks.get(String(taskId || ""));
  if (!record) throw new Error("分发任务不存在");
  if (record.state !== "running") return publicTransferTask(record);
  record.state = "cancelling";
  record.stage = "cancelling";
  record.stageLabel = "正在安全停止";
  record.message = "正在停止发送";
  if (record.child && !record.child.killed) record.child.kill();
  if (record.remoteTaskId) {
    const script = path.join(DEVICE_TRANSFER_ROOT, "scripts", "send_to_device.py");
    childProcess.spawn(pythonExe(), [
      script,
      "--cancel-task",
      record.remoteTaskId,
      "--device",
      record.transportDevice || record.device
    ], {
      cwd: DEVICE_TRANSFER_ROOT,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
      detached: true,
      stdio: "ignore"
    }).unref();
  }
  return publicTransferTask(record);
}

function startGenericTransfer(source, device, options = {}) {
  const rawSource = String(source || "").trim();
  if (!rawSource) throw new Error("请选择要传送的文件或文件夹");
  const resolvedSource = path.resolve(rawSource);
  const deviceName = String(device || "").trim();
  const trustedDevice = assertDiscoveredDeviceTarget(deviceName, options);
  if (!resolvedSource || !exists(resolvedSource)) throw new Error("选择的文件或文件夹不存在");
  if (path.parse(resolvedSource).root === resolvedSource) {
    throw new Error("不能直接传送整个磁盘，请选择具体文件或文件夹");
  }
  if (!deviceName || deviceName.length > 80 || deviceName.startsWith("-") || /[\r\n\0]/.test(deviceName)) {
    throw new Error("设备名称无效");
  }
  const transportDevice = resolveDeviceTransportTarget(
    deviceName,
    String(options.deviceModel || ""),
    trustedDevice
  );
  const taskId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const libraryRoot = path.resolve(getWorkspaceSettings().workPackage.libraryPath);
  const stageRoots = getWorkflowStageRoots(libraryRoot);
  const configuredSendRoots = configuredDistributionSendRoots(getPageSettings().distribution || {});
  const managedRoots = [
    libraryRoot,
    stageRoots.workflowRoot,
    stageRoots.mobile,
    stageRoots.official,
    ...configuredSendRoots.map((entry) => entry.root)
  ].filter(Boolean).map((root) => path.resolve(root));
  const managedWorkSource = managedRoots.some((root) => isPathInside(root, resolvedSource));
  const genericWorks = managedWorkSource ? inspectWorks(resolvedSource) : [];
  if (managedWorkSource && !genericWorks.length) {
    throw new Error("受管作品目录必须选择包含图片和 TXT 的完整作品文件夹，不能只传单个文件或空目录");
  }
  const genericCollection = genericWorks.length
    ? (path.basename(resolvedSource).match(/^作品集[_-]?\d+/i)
      ? path.basename(resolvedSource)
      : path.basename(path.dirname(resolvedSource)))
    : "";
  const genericClaims = genericWorks.length
    ? acquireWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, genericWorks, {
      ledgerFile: WORK_DISTRIBUTION_LEDGER_FILE,
      collection: genericCollection,
      deviceId: trustedDevice.id,
      device: trustedDevice.note || trustedDevice.displayName || transportDevice,
      taskId,
      isTaskActive: (existingTaskId) => {
        const active = genericTransferTasks.get(String(existingTaskId || ""));
        return Boolean(active && ["running", "cancelling"].includes(active.state));
      }
    })
    : { workIds: [] };
  trimCompletedTasks(genericTransferTasks);
  const record = {
    id: taskId,
    device: deviceName,
    deviceLabel: String(options.deviceLabel || "").trim()
      || String(trustedDevice.note || trustedDevice.displayName || deviceName).trim(),
    transportDevice,
    deviceId: trustedDevice.id,
    source: resolvedSource,
    managedWorkSource,
    collection: genericCollection,
    works: genericWorks,
    claimWorkIds: genericClaims.workIds,
    state: "running",
    stage: "queued",
    stageLabel: "准备开始发送",
    progress: 0,
    message: "准备传送",
    output: "",
    remoteTaskId: "",
    startedAt: new Date().toISOString(),
    child: null
  };
  const script = path.join(DEVICE_TRANSFER_ROOT, "scripts", "send_to_device.py");
  let child;
  try {
    child = childProcess.spawn(pythonExe(), [script, "--source", resolvedSource, "--device", transportDevice], {
      cwd: DEVICE_TRANSFER_ROOT,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    releaseWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, record.claimWorkIds, { taskId });
    throw error;
  }
  record.child = child;
  genericTransferTasks.set(taskId, record);
  startDistributionClaimHeartbeat(taskId, record.claimWorkIds);
  child.stdout.on("data", (chunk) => updateTransferProgress(record, chunk));
  child.stderr.on("data", (chunk) => updateTransferProgress(record, chunk, true));
  child.on("error", (error) => {
    stopDistributionClaimHeartbeat(taskId);
    record.state = "failed";
    record.stage = "failed";
    record.stageLabel = "发送未完成";
    record.message = error.message;
    record.finishedAt = new Date().toISOString();
    releaseWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, record.claimWorkIds, { taskId });
  });
  child.on("close", (code) => {
    stopDistributionClaimHeartbeat(taskId);
    if (record.state === "cancelling") {
      record.state = "cancelled";
      record.stage = "cancelled";
      record.stageLabel = "已停止发送";
      record.message = "已取消传送";
      releaseWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, record.claimWorkIds, { taskId });
    } else if (code === 0) {
      record.state = "completed";
      record.stage = "completed";
      record.stageLabel = "发送完成并确认接收";
      record.progress = 100;
      record.message = "发送完成";
      let recordError = null;
      if (record.works.length) {
        try {
          recordDeviceDistribution({
            publishRoot: PUBLISH_ROOT,
            taskId: record.id,
            device: record.deviceLabel || record.device,
            deviceModel: trustedDevice.displayName || trustedDevice.id,
            collection: record.collection,
            sourcePath: record.source,
            transport: "LAN",
            confirmation: "接收端已提交确认"
          });
          record.works.forEach((work) => recordSuccessfulWorkDistribution(
            WORK_DISTRIBUTION_LEDGER_FILE,
            {
              work,
              collection: record.collection,
              deviceId: record.deviceId,
              device: record.deviceLabel || record.device,
              taskId: record.id
            }
          ));
          record.works.forEach((work) => recordWorkPlatformUsage(
            WORK_TAG_LEDGER_FILE,
            {
              work,
              platform: "douyin_xiaohongshu",
              source: "generic_device_transfer",
              collection: record.collection,
              usedAt: new Date().toISOString()
            }
          ));
          invalidateLiveDistributionSnapshot();
        } catch (error) {
          recordError = error;
        }
      }
      if (recordError) {
        record.stageLabel = "发送完成，记录待修复";
        record.message = `手机已确认接收；分发记录写入失败：${recordError.message}`;
      } else {
        releaseWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, record.claimWorkIds, { taskId });
      }
    } else {
      record.state = "failed";
      record.stage = "failed";
      record.stageLabel = "发送未完成";
      record.message = record.error || record.message || `传送进程退出码 ${code}`;
      releaseWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, record.claimWorkIds, { taskId });
    }
    record.finishedAt = new Date().toISOString();
    record.child = null;
  });
  return publicTransferTask(record);
}

function cancelGenericTransfer(taskId) {
  const record = genericTransferTasks.get(String(taskId || ""));
  if (!record) throw new Error("传送任务不存在");
  if (record.state !== "running") return publicTransferTask(record);
  record.state = "cancelling";
  record.stage = "cancelling";
  record.stageLabel = "正在安全停止";
  record.message = "正在取消";
  if (record.child && !record.child.killed) record.child.kill();
  if (record.remoteTaskId) {
    const script = path.join(DEVICE_TRANSFER_ROOT, "scripts", "send_to_device.py");
    childProcess.spawn(pythonExe(), [
      script,
      "--cancel-task",
      record.remoteTaskId,
      "--device",
      record.transportDevice || record.device
    ], {
      cwd: DEVICE_TRANSFER_ROOT,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
      detached: true,
      stdio: "ignore"
    }).unref();
  }
  return publicTransferTask(record);
}

function deviceStatusScanArgs(mode = "background") {
  const scanFlag = mode === "fast"
    ? "--status-fast"
    : mode === "udp-only"
      ? "--status-udp-only"
      : "--status-background";
  return ["--status-json", scanFlag];
}

function runDeviceStatus({ mode = "background", timeoutMs = DEVICE_STATUS_SCAN_TIMEOUT_MS } = {}) {
  const script = path.join(DEVICE_TRANSFER_ROOT, "scripts", "send_to_device.py");
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(pythonExe(), [script, ...deviceStatusScanArgs(mode)], {
      cwd: DEVICE_TRANSFER_ROOT,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8"
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("设备在线状态扫描超时"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 64 * 1024) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, output: stdout.trim() });
      else reject(new Error((stderr || stdout || `设备扫描退出码 ${code}`).trim()));
    });
  });
}

function decodeDeviceBeaconPart(value, maxLength = 160) {
  const encoded = String(value || "").trim();
  if (!encoded) return "";
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/")
      + "=".repeat((4 - (encoded.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8").trim().slice(0, maxLength);
  } catch {
    return "";
  }
}

function parseDevicePresenceBeacon(packet) {
  const parts = String(packet || "").trim().split("|");
  if (parts.length < 8 || parts[0] !== "ZWMDS2_HERE" || parts[1] !== "2") return null;
  const state = decodeDeviceBeaconPart(parts[6], 48).toLowerCase();
  const onlineStates = new Set(["online", "receiving", "transferring", "transmitting", "busy"]);
  if (!onlineStates.has(state)) return null;
  const deviceId = String(parts[2] || "").trim().slice(0, 128);
  const name = decodeDeviceBeaconPart(parts[4], 160);
  const model = decodeDeviceBeaconPart(parts[5], 160);
  if (!deviceId || !name) return null;
  const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
  };
  const workCount = integer(parts[8]);
  const workCounts = {};
  if (parts.length >= 15) {
    [["conversion", parts[12]], ["traffic", parts[13]], ["uncategorized", parts[14]]]
      .forEach(([key, value]) => {
        const parsed = integer(value);
        if (parsed !== null) workCounts[key] = parsed;
      });
    if (workCount !== null) workCounts.total = workCount;
  }
  const result = {
    deviceId,
    name,
    model,
    protocol: 2,
    port: integer(parts[3], 1, 65535),
    taskId: String(parts[7] || "").trim().slice(0, 160),
    online: true,
    state,
    transferState: state === "online" ? "idle" : state,
    transport: "wifi",
    workCount,
    workCounts: Object.keys(workCounts).length ? workCounts : null
  };
  const appVersion = decodeDeviceBeaconPart(parts[9], 64);
  const versionCode = integer(parts[10]);
  const updateCapability = decodeDeviceBeaconPart(parts[11], 96);
  if (appVersion) result.appVersion = appVersion;
  if (versionCode !== null) result.versionCode = versionCode;
  if (updateCapability) result.updateCapability = updateCapability;
  return result;
}

function decorateDevicePresenceRecords(records = []) {
  const savedNotes = readJson(DEVICE_NOTES_FILE, { version: 1, notes: {} });
  const notes = savedNotes && typeof savedNotes.notes === "object" ? savedNotes.notes : {};
  return (Array.isArray(records) ? records : []).map((record) => {
    const id = `discovered-${normalizeDeviceTarget(record.model || record.name)}`;
    const hasSavedNote = Object.prototype.hasOwnProperty.call(notes, id);
    return {
      ...record,
      id,
      note: hasSavedNote ? String(notes[id] || "").trim() : "",
      noteIsCustom: hasSavedNote
    };
  });
}

function activeDevicePresenceBeacons(now = Date.now()) {
  for (const [key, record] of devicePresenceEventRecords.entries()) {
    if (now - Number(record.lastSeenAt || 0) > DEVICE_BEACON_TTL_MS) {
      devicePresenceEventRecords.delete(key);
    }
  }
  return Array.from(devicePresenceEventRecords.values()).map((record) => ({
    ...record,
    current: true,
    recentlySeen: false
  }));
}

function handleDevicePresenceBeacon(packet, receivedAt = Date.now()) {
  const record = parseDevicePresenceBeacon(packet);
  if (!record) return null;
  const key = devicePresenceKey(record);
  devicePresenceEventRecords.set(key, {
    ...record,
    current: true,
    recentlySeen: false,
    lastSeenAt: receivedAt
  });
  const active = activeDevicePresenceBeacons(receivedAt);
  const presence = mergeDevicePresence(active, deviceStatusCache.onlineDevices, receivedAt, DEVICE_BEACON_TTL_MS);
  const onlineDevices = decorateDevicePresenceRecords(presence);
  deviceStatusCache = {
    checkedAt: receivedAt,
    output: "",
    onlineDevices
  };
  writeDevicePresenceSnapshot(deviceStatusCache);
  automaticDistributionMonitorState = {
    ...automaticDistributionMonitorState,
    lastEventAt: new Date(receivedAt).toISOString(),
    lastEventDevice: record.name,
    eventCount: Number(automaticDistributionMonitorState.eventCount || 0) + 1,
    eventError: ""
  };
  const triggered = maybeStartAutomaticDistribution(onlineDevices);
  return { record, onlineDevices, triggered: Array.isArray(triggered) ? triggered : [] };
}

function scheduleDevicePresenceEventRetry() {
  if (devicePresenceEventRetryTimer) return;
  devicePresenceEventRetryTimer = setTimeout(() => {
    devicePresenceEventRetryTimer = null;
    startDevicePresenceEventListener();
  }, 30_000);
  devicePresenceEventRetryTimer.unref?.();
}

function startDevicePresenceEventListener() {
  if (devicePresenceEventSocket) return devicePresenceEventSocket;
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  devicePresenceEventSocket = socket;
  socket.on("message", (message) => {
    try {
      handleDevicePresenceBeacon(message.toString("utf8"));
    } catch (error) {
      automaticDistributionMonitorState = {
        ...automaticDistributionMonitorState,
        eventError: error.message || String(error)
      };
      appendAutomationLog({ event: "beacon-handler-failed", message: `手机事件处理失败：${error.message || error}` });
    }
  });
  socket.on("listening", () => {
    automaticDistributionMonitorState = {
      ...automaticDistributionMonitorState,
      eventMode: "手机 UDP 事件优先（扫描兜底）",
      eventPort: DEVICE_DISCOVERY_PORT,
      eventError: ""
    };
  });
  socket.on("error", (error) => {
    if (devicePresenceEventSocket !== socket) return;
    devicePresenceEventSocket = null;
    automaticDistributionMonitorState = {
      ...automaticDistributionMonitorState,
      eventMode: "扫描兜底（手机事件端口不可用）",
      eventPort: DEVICE_DISCOVERY_PORT,
      eventError: error.message || String(error)
    };
    appendAutomationLog({ event: "beacon-listener-fallback", message: `手机事件监听不可用，保留扫描兜底：${error.message || error}` });
    try { socket.close(); } catch {}
    scheduleDevicePresenceEventRetry();
  });
  socket.bind(DEVICE_DISCOVERY_PORT, "0.0.0.0");
  return socket;
}

function getDeviceStatus(force = false) {
  const fresh = Date.now() - deviceStatusCache.checkedAt < 15_000;
  if (!force && fresh) return Promise.resolve(deviceStatusCache);
  if (deviceStatusPromise) return deviceStatusPromise;
  deviceStatusPromise = runDeviceStatus()
    .then((result) => {
      const checkedAt = Date.now();
      const presence = mergeDevicePresence(
        parseOnlineDeviceStatus(result.output),
        deviceStatusCache.onlineDevices,
        checkedAt
      );
      const onlineDevices = decorateDevicePresenceRecords(presence);
      deviceStatusCache = {
        checkedAt,
        output: result.output || "",
        onlineDevices
      };
      writeDevicePresenceSnapshot(deviceStatusCache);
      return deviceStatusCache;
    })
    .catch((error) => {
      // Device discovery is auxiliary to production and distribution. A
      // transient Python/ADB/UDP timeout must not turn the whole local API
      // into a 500 or make the workbench appear frozen. Keep the last known
      // presence, expose the diagnostic, and let the next scheduled scan try
      // again.
      const fallback = {
        ...deviceStatusCache,
        stale: true,
        scanError: String(error?.message || error || "设备在线状态扫描失败"),
        scanErrorAt: new Date().toISOString()
      };
      appendAutomationLog({
        event: "scan-fallback",
        message: `设备在线状态扫描失败，继续使用上次结果：${fallback.scanError}`
      });
      writeDevicePresenceSnapshot(fallback);
      return fallback;
    })
    .finally(() => {
      deviceStatusPromise = null;
    });
  return deviceStatusPromise;
}

function startAutomaticDistributionMonitor() {
  if (automaticDistributionTimer) return automaticDistributionTimer;
  automaticDistributionMonitorState = {
    ...automaticDistributionMonitorState,
    enabled: true,
    startedAt: automaticDistributionMonitorState.startedAt || new Date().toISOString(),
    lastScanError: ""
  };
  automaticDistributionTimer = setInterval(() => {
    const settings = getPageSettings().distribution;
    automaticDistributionMonitorState = {
      ...automaticDistributionMonitorState,
      enabled: Boolean(settings.autoDistributionEnabled && settings.detectOnConnection)
    };
    if (!settings.autoDistributionEnabled || !settings.detectOnConnection) return;
    if (automaticDistributionScanInFlight) return;
    automaticDistributionScanInFlight = true;
    const startedAt = Date.now();
    automaticDistributionMonitorState = {
      ...automaticDistributionMonitorState,
      lastScanStartedAt: new Date(startedAt).toISOString(),
      lastScanError: "",
      scanInFlight: true
    };
    getDeviceStatus(true)
      .then((snapshot) => {
        const onlineDevices = snapshot.onlineDevices || parseOnlineDeviceStatus(snapshot.output);
        automaticDistributionMonitorState = {
          ...automaticDistributionMonitorState,
          lastScanCompletedAt: new Date().toISOString(),
          lastScanDurationMs: Date.now() - startedAt,
          lastScanDeviceCount: onlineDevices.filter((device) => device.current !== false).length,
          lastScanError: "",
          scanInFlight: false
        };
        return maybeStartAutomaticDistribution(onlineDevices);
      })
      .catch((error) => {
        automaticDistributionMonitorState = {
          ...automaticDistributionMonitorState,
          lastScanCompletedAt: new Date().toISOString(),
          lastScanDurationMs: Date.now() - startedAt,
          lastScanDeviceCount: 0,
          lastScanError: error.message || String(error),
          scanInFlight: false
        };
        appendAutomationLog({
          event: "scan-failed",
          message: `后台设备扫描失败：${error.message}`
        });
      })
      .finally(() => {
        automaticDistributionScanInFlight = false;
        automaticDistributionMonitorState = {
          ...automaticDistributionMonitorState,
          scanInFlight: false
        };
      });
  }, AUTOMATIC_DISTRIBUTION_SCAN_INTERVAL_MS);
  automaticDistributionTimer.unref?.();
  return automaticDistributionTimer;
}

function getAutomaticDistributionMonitorState() {
  return { ...automaticDistributionMonitorState };
}

function devicePresenceKey(device = {}) {
  const model = String(device.model || "").trim().toLowerCase();
  if (model) return `model:${model}`;
  return `name:${String(device.name || "")
    .toLowerCase()
    .replace(/[（(][^）)]*作品数[^）)]*[）)]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "")}`;
}

function mergeDevicePresence(currentRecords, previousRecords, now = Date.now(), ttlMs = 10 * 60_000) {
  const current = Array.isArray(currentRecords) ? currentRecords : [];
  const previous = Array.isArray(previousRecords) ? previousRecords : [];
  const merged = new Map();
  previous.forEach((record) => {
    const lastSeenAt = Number(record.lastSeenAt || 0);
    if (lastSeenAt && now - lastSeenAt <= ttlMs) {
      merged.set(devicePresenceKey(record), { ...record, current: false, recentlySeen: true });
    }
  });
  current.forEach((record) => {
    merged.set(devicePresenceKey(record), {
      ...record,
      transport: record.transport || "wifi",
      current: true,
      recentlySeen: false,
      lastSeenAt: now
    });
  });
  return Array.from(merged.values());
}

function waitForDistributionTask(taskId) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const record = distributionTasks.get(taskId);
      if (!record || !["running", "cancelling"].includes(record.state)) {
        clearInterval(timer);
        resolve(record || null);
      }
    }, 500);
  });
}

function automationDeviceIdentityFields(device = {}, liveRecord = {}) {
  return {
    deviceName: String(liveRecord.name || device.liveName || device.name || device.syncedName || device.displayName || "").trim(),
    deviceModel: String(liveRecord.model || device.syncedModel || device.model || device.models?.[0] || "").trim(),
    deviceNote: String(device.note || device.localRemark || "").trim(),
    deviceDisplayName: String(device.displayName || device.name || "").trim(),
    deviceId: String(liveRecord.deviceId || "").trim(),
    deviceProtocol: Number.isSafeInteger(Number(liveRecord.protocol)) ? Number(liveRecord.protocol) : null,
    deviceAppVersion: String(liveRecord.appVersion || "").trim(),
    deviceVersionCode: Number.isSafeInteger(Number(liveRecord.versionCode)) ? Number(liveRecord.versionCode) : null,
    deviceAndroidVersion: String(liveRecord.androidVersion || "").trim(),
    devicePackageName: String(liveRecord.packageName || "").trim(),
    deviceUpdateCapability: String(liveRecord.updateCapability || "").trim(),
    deviceTaskId: String(liveRecord.taskId || "").trim()
  };
}

function receiverVersionInfo(device = {}) {
  return {
    appVersion: String(device.appVersion || "").trim(),
    versionCode: Number.isSafeInteger(Number(device.versionCode)) ? Number(device.versionCode) : null,
    packageName: String(device.packageName || "").trim()
  };
}

function receiverVersionChanged(device = {}, blocked = {}) {
  const current = receiverVersionInfo(device);
  const previous = receiverVersionInfo(blocked);
  if ((current.versionCode !== null || current.appVersion)
      && previous.versionCode === null && !previous.appVersion) {
    // Older block records were written before the workbench persisted phone
    // version fields. The first complete heartbeat is enough to re-evaluate
    // the old format error once; a failing retry will create a new versioned
    // block record.
    return true;
  }
  if (current.versionCode !== null && previous.versionCode !== null) {
    return current.versionCode !== previous.versionCode;
  }
  return Boolean(current.appVersion && previous.appVersion && current.appVersion !== previous.appVersion);
}

async function runAutomaticDistributionBatch(device, liveRecord, collections, settings) {
  const target = deviceTransportTarget(liveRecord, device.aliases?.[0] || device.displayName);
  const candidateCategory = String(settings.autoCategory || "conversion");
  const selectedInventory = selectDeviceInventory(liveRecord, candidateCategory);
  const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const deviceIdentity = automationDeviceIdentityFields(device, liveRecord);
  appendAutomationLog({
    event: "started",
    batchId,
    deviceId: device.id,
    device: device.note || device.displayName,
    ...deviceIdentity,
    phoneReserve: selectedInventory.value,
    inventoryCategory: selectedInventory.category,
    category: candidateCategory,
    candidateCategory,
    requested: collections.length,
    message: "检测到手机作品集储备不足，开始自动分发"
  });
  let completed = 0;
  for (const collection of collections) {
    if (!automaticDistributionCandidateEligible(collection, candidateCategory)) {
      const error = new Error(
        `自动分发候选分类不匹配：设置为${candidateCategory}，收到${collection.type || "未分类"}作品集 ${collection.name || "未命名"}`
      );
      error.code = "AUTOMATIC_CATEGORY_MISMATCH";
      throw error;
    }
    const maxAttempts = Math.max(1, Math.min(5, Number(settings.autoRetryLimit || 3)));
    let lastError = null;
    let lastClassification = null;
    let attemptsUsed = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsUsed = attempt;
      try {
        const task = startDistributionTask({
          action: "device-restock",
          device: target,
          collection: collection.name,
          collectionType: collection.type,
          candidateCategory,
          type: collection.type === "conversion" ? "conversion" : "traffic",
          automatic: true,
          automaticAttempt: attempt,
          automaticMaxAttempts: maxAttempts
        });
        const result = await waitForDistributionTask(task.id);
        if (!result || result.state !== "completed") throw new Error(result?.message || "自动分发未完成");
        lastError = null;
        completed += 1;
        appendAutomationLog({
          event: "item-completed",
          batchId,
          taskId: task.id,
          deviceId: device.id,
          device: device.note || device.displayName,
          ...deviceIdentity,
      collection: collection.name,
      collectionType: collection.type,
      candidateCategory,
          attempt,
          progress: Math.round((completed / collections.length) * 100),
          message: attempt > 1 ? `第 ${attempt} 次尝试成功` : "作品集已完成自动分发"
        });
        break;
      } catch (error) {
        lastError = error;
        lastClassification = classifyAutomaticDistributionError(error);
        if (!lastClassification.retryable) break;
        if (attempt < maxAttempts) {
          appendAutomationLog({
            event: "retrying",
            batchId,
            deviceId: device.id,
            device: device.note || device.displayName,
            ...deviceIdentity,
            collection: collection.name,
            attempt,
            maxAttempts,
            message: `自动分发失败，准备第 ${attempt + 1} 次尝试：${error.message}`
          });
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }
    if (lastError) {
      const retryOnReconnect = lastClassification?.retryable !== false;
      appendAutomationLog({
        event: retryOnReconnect ? "failed" : "blocked",
        batchId,
        deviceId: device.id,
        device: device.note || device.displayName,
        ...deviceIdentity,
        collection: collection.name,
        completed,
        attempts: attemptsUsed,
        retryOnReconnect,
        reasonCode: lastClassification?.code || "AUTOMATIC_TRANSFER_RETRYABLE",
        message: retryOnReconnect
          ? `连续 ${attemptsUsed} 次失败，本轮已暂停；设备重新连接后可再次尝试：${lastError.message}`
          : automaticDistributionBlockedMessage(lastClassification?.code, lastError.message)
      });
      return {
        ok: false,
        completed,
        error: lastError.message,
        retryOnReconnect,
        blockReason: retryOnReconnect ? null : lastClassification
      };
    }
  }
  appendAutomationLog({
    event: "completed",
    batchId,
    deviceId: device.id,
    device: device.note || device.displayName,
    ...deviceIdentity,
    completed,
    candidateCategory,
    progress: 100,
    message: `自动分发完成，共发送 ${completed} 个作品集`
  });
  return { ok: true, completed };
}

function maybeStartAutomaticDistribution(onlineDevices = []) {
  const settings = getPageSettings().distribution;
  hydrateAutomaticDistributionBlockedDevices();
  const currentRecords = onlineDevices.filter((record) => record.current !== false);
  const currentKeys = new Set(currentRecords.map(devicePresenceKey));
  Array.from(automaticDistributionSessions.keys()).forEach((key) => {
    if (!currentKeys.has(key)) automaticDistributionSessions.delete(key);
  });
  Array.from(automaticDistributionBlockedDevices.keys()).forEach((key) => {
    if (!currentKeys.has(key)) automaticDistributionBlockedDevices.delete(key);
  });
  if (!settings.autoDistributionEnabled || !settings.detectOnConnection) return [];

  const workspaceSettings = getWorkspaceSettings();
  const distribution = getLiveDistributionSnapshot({
    workspaceSettings,
    distributionSettings: settings
  });
  const candidatePool = (distribution.collections || []).filter((collection) =>
    automaticDistributionCandidateEligible(collection, settings.autoCategory)
  );
  const isTaskActive = (taskId) => {
    const active = distributionTasks.get(String(taskId || ""));
    return Boolean(active && ["running", "cancelling"].includes(active.state));
  };
  const claimCleanup = pruneStaleWorkDistributionClaims(WORK_DISTRIBUTION_CLAIMS_ROOT, {
    claimTtlMs: DEFAULT_WORK_DISTRIBUTION_CLAIM_TTL_MS,
    orphanClaimGraceMs: DEFAULT_WORK_DISTRIBUTION_ORPHAN_CLAIM_GRACE_MS,
    isTaskActive
  });
  if (claimCleanup.archived > 0) {
    appendAutomationLog({
      event: "distribution-claims-pruned",
      archived: claimCleanup.archived,
      inspected: claimCleanup.inspected,
      active: claimCleanup.active,
      unreadable: claimCleanup.unreadable,
      reason: "orphan-or-expired-claim"
    });
  }
  const activeClaimNames = readWorkDistributionClaimNames(WORK_DISTRIBUTION_CLAIMS_ROOT, {
    claimTtlMs: DEFAULT_WORK_DISTRIBUTION_CLAIM_TTL_MS,
    orphanClaimGraceMs: DEFAULT_WORK_DISTRIBUTION_ORPHAN_CLAIM_GRACE_MS,
    isTaskActive
  });
  const blockedCandidates = candidatePool.filter((collection) =>
    (Array.isArray(collection.works) ? collection.works : []).some((work) =>
      hasWorkDistributionClaim(WORK_DISTRIBUTION_CLAIMS_ROOT, work.workId, activeClaimNames)
    )
  );
  const eligible = candidatePool.filter((collection) => !blockedCandidates.includes(collection));
  const triggered = [];
  const approvedKeys = readDeviceDistributionApprovals().keys;
  currentRecords.forEach((liveRecord) => {
    const key = devicePresenceKey(liveRecord);
    if (automaticDistributionActiveDeviceKeys.has(key)) return;
    const registered = findRegisteredDevice(registeredDevices(), liveRecord.name, approvedKeys)
      || findRegisteredDevice(registeredDevices(), liveRecord.model, approvedKeys);
    const device = registered || {
      id: deviceApprovalKey(liveRecord) || key,
      displayName: String(liveRecord.name || liveRecord.model || "已发现设备")
        .replace(/[（(][^）)]*作品数[^）)]*[）)]/g, "").trim(),
      name: liveRecord.name || "",
      model: liveRecord.model || "",
      models: [liveRecord.model].filter(Boolean),
      aliases: [liveRecord.name].filter(Boolean)
    };
    const admission = automaticDistributionAdmission(device, approvedKeys);
    const decisionFingerprint = automaticDistributionDecisionFingerprint(liveRecord, settings, eligible, admission);
    if (automaticDistributionSessions.get(key) === decisionFingerprint) return;
    automaticDistributionSessions.set(key, decisionFingerprint);
    let receiverBlock = automaticDistributionBlockedDevices.get(key);
    if (receiverBlock?.code === "RECEIVER_UPDATE_REQUIRED"
        && receiverVersionChanged(liveRecord, receiverBlock)) {
      automaticDistributionBlockedDevices.delete(key);
      automaticDistributionSessions.delete(key);
      receiverBlock = null;
      appendAutomationLog({
        event: "receiver-updated",
        deviceId: liveRecord.deviceId || device.id,
        device: device.note || device.displayName,
        ...automationDeviceIdentityFields(device, liveRecord),
        message: "检测到手机接收端版本已变化，解除旧格式阻断并立即重新判断"
      });
    }
    // The selected automatic category controls both the phone reserve count
    // and the computer-side candidate pool. Total inventory is used only when
    // the user explicitly selects `all`.
    const inventorySelection = selectDeviceInventory(liveRecord, settings.autoCategory);
    const inventory = inventorySelection.value;
    const threshold = Number(settings.phoneReserveThreshold);
    const inventoryKnown = Number.isFinite(inventory);
    const deviceState = String(liveRecord.transferState || liveRecord.state || "").trim().toLowerCase();
    const deviceBusy = ["receiving", "transferring", "transmitting", "busy"].includes(deviceState);
    const needRefill = inventoryKnown && inventory < threshold;
    // Replenishment sends one standard collection per below-threshold
    // evaluation. A standard collection already clears the current reserve;
    // do not over-send two collections to a phone at zero.
    const sendCount = automaticDistributionSendCount({
      inventory,
      threshold,
      configuredCount: settings.autoSendCount,
      candidateCount: eligible.length
    });
    const skipReason = receiverBlock
      ? receiverBlock.code === "RECEIVER_BUSY"
        ? "receiver_busy"
        : receiverBlock.code === "RECEIVER_UNAVAILABLE"
          ? "receiver_unavailable"
          : "receiver_update_required"
      : !admission.approved
      ? "first_confirmation_required"
      : deviceBusy
        ? "device_busy"
      : !inventoryKnown
        ? "inventory_unknown"
        : !needRefill
          ? "inventory_sufficient"
          : eligible.length === 0
            ? blockedCandidates.length > 0 ? "candidate_in_flight" : "no_candidate_package"
            : sendCount === 0
              ? "send_count_zero"
              : null;
    appendAutomationLog({
      event: "evaluated",
      deviceId: device?.id || null,
      ...automationDeviceIdentityFields(device, liveRecord),
      rawDeviceName: liveRecord.name || "",
      resolvedDeviceName: device ? deviceTransportTarget(liveRecord, device.displayName) : "",
      businessAlias: device?.note || device?.displayName || "",
      online: liveRecord.online !== false,
      reachable: liveRecord.current !== false,
      deviceState,
      deviceBusy,
      inventorySource: inventorySelection.source,
      inventoryCategory: inventorySelection.category,
      candidateCategory: settings.autoCategory,
      inventoryCount: inventoryKnown ? inventory : null,
      inventoryUpdatedAt: liveRecord.lastSeenAt ? new Date(liveRecord.lastSeenAt).toISOString() : null,
      conversionCount: inventorySelection.category === "conversion" && inventoryKnown ? inventory : null,
      trafficCount: inventorySelection.category === "traffic" && inventoryKnown ? inventory : null,
      totalCount: liveRecord.workCount === null || liveRecord.workCount === undefined || liveRecord.workCount === ""
        ? null
        : (Number.isFinite(Number(liveRecord.workCount)) ? Number(liveRecord.workCount) : null),
      configuredThreshold: threshold,
      thresholdSource: "pageSettings.distribution.phoneReserveThreshold",
      comparisonResult: inventoryKnown ? `${inventory}<${threshold}=${needRefill}` : "unknown",
      needRefill,
      candidatePackageCount: eligible.length,
      candidateBlockedPackageCount: blockedCandidates.length,
      candidatePackages: eligible.map((collection) => collection.name).slice(0, 20),
      skipReason,
      sendAttempted: !skipReason && sendCount > 0,
      retryCount: 0,
      cooldownUntil: null,
      activeTaskId: null,
      message: skipReason
        ? automaticDistributionSkipMessage(skipReason, {
          category: inventorySelection.category,
          inventory,
          threshold,
          deviceLabel: device?.note || device?.displayName || liveRecord.name || liveRecord.model,
          deviceName: liveRecord.name || device?.name,
          deviceModel: liveRecord.model || device?.model,
          reason: receiverBlock?.message || "接收端提交格式不兼容"
        })
        : `库存 ${inventory} 低于阈值 ${threshold}，准备自动补充 ${sendCount} 个作品集`
    });
    if (skipReason || !sendCount) return;
    const collections = eligible.splice(0, sendCount);
    triggered.push({
      deviceId: device.id,
      device: device.note || device.displayName,
      phoneReserve: inventory,
      count: collections.length
    });
    automaticDistributionActiveDeviceKeys.add(key);
    runAutomaticDistributionBatch(device, liveRecord, collections, settings)
      .then((result) => {
        // A failed batch releases its work claims.  Forget the decision so the
        // next 10-second inventory poll can retry once the receiver is idle or
        // the network has recovered.  Successful batches keep the fingerprint
        // and therefore cannot be sent a second time without a real decision
        // change (inventory/category/candidate/state).
        if (result?.ok === false) {
          if (result.retryOnReconnect === false) {
            automaticDistributionBlockedDevices.set(key, {
              code: result.blockReason?.code || "RECEIVER_UPDATE_REQUIRED",
              message: result.error || "接收端提交格式不兼容",
              blockedAt: Date.now(),
              ...receiverVersionInfo(liveRecord)
            });
          } else {
            automaticDistributionSessions.delete(key);
          }
        }
      })
      .catch((error) => {
        const classification = classifyAutomaticDistributionError(error);
        if (classification.retryable) automaticDistributionSessions.delete(key);
        else automaticDistributionBlockedDevices.set(key, {
          code: classification.code,
          message: classification.message,
          blockedAt: Date.now(),
          ...receiverVersionInfo(liveRecord)
        });
        appendAutomationLog({
          event: classification.retryable ? "failed" : "blocked",
          deviceId: device.id,
          device: device.note || device.displayName,
          ...automationDeviceIdentityFields(device, liveRecord),
          reasonCode: classification.code,
          retryOnReconnect: classification.retryable,
          message: classification.retryable
            ? error.message
            : automaticDistributionBlockedMessage(classification.code, error.message)
        });
      })
      .finally(() => automaticDistributionActiveDeviceKeys.delete(key));
  });
  return triggered;
}

function parseOnlineDeviceStatus(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("{")) {
        try {
          const payload = JSON.parse(line);
          const state = String(payload.state || "").trim().toLowerCase();
          const onlineStates = new Set(["online", "receiving", "transferring", "transmitting", "busy"]);
          if (!onlineStates.has(state)) return null;
          const workCount = Number(payload.workCount);
          const counts = payload.workCounts;
          const parsedCounts = counts && typeof counts === "object"
            ? Object.fromEntries(["total", "conversion", "traffic", "uncategorized"]
              .filter((key) => Number.isFinite(Number(counts[key])) && Number(counts[key]) >= 0)
              .map((key) => [key, Number(counts[key])]))
            : null;
          const details = {};
          const stringFields = [
            ["deviceId", 128], ["taskId", 160], ["androidVersion", 64],
            ["appVersion", 64], ["packageName", 160], ["updateCapability", 96]
          ];
          stringFields.forEach(([key, maxLength]) => {
            const value = String(payload[key] || "").trim();
            if (value && value.length <= maxLength) details[key] = value;
          });
          const integerFields = [["protocol", 0], ["port", 1], ["versionCode", 0]];
          integerFields.forEach(([key, minimum]) => {
            const value = Number(payload[key]);
            if (Number.isSafeInteger(value) && value >= minimum) details[key] = value;
          });
          if (typeof payload.relayEnabled === "boolean") details.relayEnabled = payload.relayEnabled;
          return {
            ...details,
            name: String(payload.name || "").trim(),
            model: String(payload.model || "").trim(),
            online: true,
            state,
            transferState: state === "online" ? "idle" : state,
            transport: "wifi",
            workCount: Number.isFinite(workCount) && workCount >= 0 ? workCount : null,
            workCounts: parsedCounts && Object.keys(parsedCounts).length ? parsedCounts : null
          };
        } catch {
          return null;
        }
      }
      const parts = line.split("\t").map((part) => part.trim());
      if (parts.length < 3 || !["online", "receiving", "transferring", "transmitting", "busy"].includes(parts[parts.length - 1].toLowerCase())) return null;
      const state = parts[parts.length - 1].toLowerCase();
      const match = parts[0].match(/作品数\s*(\d+)/);
      return {
        name: parts[0],
        model: parts[1],
        online: true,
        state,
        transferState: state === "online" ? "idle" : state,
        transport: "wifi",
        workCount: match ? Number(match[1]) : null,
        workCounts: null
      };
    })
    .filter(Boolean);
}

function pickFolderWithWindowsDialog(description = "选择文件夹") {
  const safeDescription = String(description).replace(/'/g, "''");
  const command = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.TopMost = $true",
    "$owner.ShowInTaskbar = $false",
    "$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
    "$owner.Width = 1",
    "$owner.Height = 1",
    "$owner.Opacity = 0",
    "$owner.Show()",
    "$owner.Activate()",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    `$dialog.Title = '${safeDescription}'`,
    "$dialog.CheckFileExists = $false",
    "$dialog.CheckPathExists = $true",
    "$dialog.ValidateNames = $false",
    "$dialog.DereferenceLinks = $true",
    "$dialog.RestoreDirectory = $true",
    "$dialog.FileName = '选择当前文件夹'",
    "$dialog.Filter = '文件夹|*.folder'",
    "$result = $dialog.ShowDialog($owner)",
    "$owner.Close()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  $selected = Split-Path -Parent $dialog.FileName",
    "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "  Write-Output $selected",
    "}"
  ].join("; ");
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("powershell.exe", [
      "-NoProfile",
      "-STA",
      "-Command",
      command
    ], {
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || "目录选择器打开失败"));
      resolve(stdout.trim());
    });
  });
}

function pickFileWithWindowsDialog(title = "选择要传送的文件") {
  const safeTitle = String(title).replace(/'/g, "''");
  const command = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    `$dialog.Title = '${safeTitle}'`,
    "$dialog.Multiselect = $false",
    "$dialog.CheckFileExists = $true",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "  Write-Output $dialog.FileName",
    "}"
  ].join("; ");
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("powershell.exe", [
      "-NoProfile", "-STA", "-Command", command
    ], { windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || "文件选择器打开失败"));
      resolve(stdout.trim());
    });
  });
}

function saveWorkspaceSettings(body) {
  const current = getWorkspaceSettings();
  const materialRoot = path.resolve(String(body.materialRoot || current.materialRoot).trim());
  if (!exists(materialRoot) || !fs.statSync(materialRoot).isDirectory()) {
    throw new Error("素材目录不存在或不是文件夹");
  }
  const localPrevious = readJson(APP_SETTINGS_FILE, {});
  const imageApi = body.imageApi ? {
    provider: ["local-openai", "bytecat", "minimax"].includes(String(body.imageApi.provider))
      ? String(body.imageApi.provider) : "local-openai",
    baseUrl: String(body.imageApi.baseUrl || "").trim().slice(0, 500),
    model: String(body.imageApi.model || "").trim().slice(0, 200)
  } : localPrevious.imageApi;
  if (imageApi?.baseUrl) {
    let parsed;
    try { parsed = new URL(imageApi.baseUrl); } catch { throw new Error("生图 API 地址格式不正确"); }
    if (parsed.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
      throw new Error("生图 API 必须使用 HTTPS；本机接口可使用 localhost");
    }
  }
  writeJson(APP_SETTINGS_FILE, { ...localPrevious, materialRoot, imageApi });

  if (body.workPackage) {
    const previous = readJson(WORKPKG_CONFIG_FILE, {});
    const libraryPath = path.resolve(String(
      body.workPackage.libraryPath || current.workPackage.libraryPath
    ).trim());
    if (!exists(libraryPath) || !fs.statSync(libraryPath).isDirectory()) {
      throw new Error("作品集存放目录不存在或不是文件夹");
    }
    const batchSize = Math.max(1, Math.min(100, Number(body.workPackage.batchSize || 14)));
    const next = {
      ...previous,
      library_path: libraryPath,
      portfolio_batch_size: batchSize,
      portfolio_auto_group: body.workPackage.autoGroup !== false,
      portfolio_auto_zip: body.workPackage.autoZip !== false
    };
    if (exists(WORKPKG_CONFIG_FILE)) {
      fs.copyFileSync(WORKPKG_CONFIG_FILE, `${WORKPKG_CONFIG_FILE}.bak`);
    }
    writeJson(WORKPKG_CONFIG_FILE, next);
  }
  materialCategoryCache.clear();
  materialPostCache = null;
  materialLibraryCache = null;
  return getWorkspaceSettings();
}

function getBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      data += chunk;
      if (data.length > maxBytes) {
        settled = true;
        const error = new Error("request body too large");
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!settled) resolve(data);
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

function resolvePublicFile(requestPath) {
  const index = path.join(PUBLIC_ROOT, "index.html");
  let decoded = String(requestPath || "/");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return index;
  }
  const relative = decoded.replace(/^[/\\]+/, "");
  const candidate = path.resolve(PUBLIC_ROOT, relative || "index.html");
  return isPathInside(PUBLIC_ROOT, candidate) && exists(candidate) ? candidate : index;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function readWorkbenchContextLines(file, start = 1, limit = 120) {
  if (!file || !exists(file)) return { path: file || "", start, limit, total: 0, lines: [] };
  const safeStart = Math.max(1, Number(start) || 1);
  const safeLimit = Math.max(1, Math.min(240, Number(limit) || 120));
  const text = fs.readFileSync(file, "utf8");
  const allLines = text.split(/\r?\n/);
  return {
    path: file,
    start: safeStart,
    limit: safeLimit,
    total: allLines.length,
    lines: allLines.slice(safeStart - 1, safeStart - 1 + safeLimit).map((line, index) => ({
      line: safeStart + index,
      text: line.slice(0, 2000)
    }))
  };
}

function readWorkbenchControlContext(kind = "status", name = "", start = 1, limit = 120) {
  const normalizedKind = ["status", "logs", "source"].includes(String(kind || "")) ? String(kind) : "status";
  if (normalizedKind === "source") {
    const sourceName = String(name || "app").trim().toLowerCase();
    const file = WORKBENCH_CONTEXT_SOURCE_FILES[sourceName];
    if (!file) throw new Error(`不允许读取该源码入口：${sourceName || "空"}`);
    return {
      ok: true,
      kind: normalizedKind,
      name: sourceName,
      generatedAt: new Date().toISOString(),
      ...readWorkbenchContextLines(file, start, limit)
    };
  }
  if (normalizedKind === "logs") {
    const logName = String(name || "runtime").trim().toLowerCase();
    const file = WORKBENCH_CONTEXT_LOG_FILES[logName];
    if (!file) throw new Error(`不允许读取该日志入口：${logName || "空"}`);
    return {
      ok: true,
      kind: normalizedKind,
      name: logName,
      generatedAt: new Date().toISOString(),
      ...readWorkbenchContextLines(file, start, limit)
    };
  }
  return {
    ok: true,
    kind: normalizedKind,
    generatedAt: new Date().toISOString(),
    runtime: readJson(GPT_RUNTIME_STATE_FILE, {}),
    files: {
      logs: Object.keys(WORKBENCH_CONTEXT_LOG_FILES),
      sources: Object.keys(WORKBENCH_CONTEXT_SOURCE_FILES)
    }
  };
}

function recordPlatformUsageForRoute(body = {}) {
  const workKey = String(body.workId || body.path || "").trim();
  if (!workKey) throw new Error("缺少作品标识，不能记录平台使用");
  const allCollections = decorateCollectionsWithWorks(mergeCollectionLedger(getDistributionSnapshot({
    publishRoot: PUBLISH_ROOT,
    libraryRoot: getWorkspaceSettings().workPackage.libraryPath
  }).collections || []));
  const normalizedKey = path.resolve(workKey);
  const work = allCollections
    .flatMap((collection) => collection.works || [])
    .find((item) => item.workId === workKey || path.resolve(String(item.path || "")) === normalizedKey);
  if (!work) throw new Error("作品不存在，请刷新作品库后重试");
  const result = recordWorkPlatformUsage(WORK_TAG_LEDGER_FILE, {
    work,
    platform: body.platform,
    source: body.source || "manual_confirmation",
    collection: body.sourceCollection || body.collection || ""
  });
  invalidateLiveDistributionSnapshot();
  return result;
}

// 分模块路由共享上下文（只构造一次，各路由模块按需取用）
const routeCtx = {
  // 工具函数
  send, sendJson, sendExtensionJson, extensionCorsHeaders, getBody,
  isLoopbackAddress, isAllowedFile, isAllowedExternalTarget, isPathInside,
  assertContentAccount, isContentAccountAssigned,
  contentType, resolvePublicFile, getWorkspaceSettings,
  getCloudBackupStatus, runCloudBackupNow, inspectLatestCloudBackup,
  restoreLatestCloudBackup, getPageSettings, startLargeCloudBackup, readJson,
  getLargeCloudBackupTask: () => largeCloudBackupTask,
  saveWorkspaceSettings, savePageSettings, buildCloudBackupPayload, restoreBackupPayload,
  updateCollectionLedger, collectionLedgerCsv, pickFolderWithWindowsDialog,
  updateWorkTags: (body) => {
    const workId = String(body.workId || "").trim();
    const allCollections = decorateCollectionsWithWorks(mergeCollectionLedger(getDistributionSnapshot({
      publishRoot: PUBLISH_ROOT,
      libraryRoot: getWorkspaceSettings().workPackage.libraryPath
    }).collections || []));
    const work = allCollections.flatMap((collection) => collection.works || []).find((item) => item.workId === workId);
    if (!work) throw new Error("作品不存在，请刷新作品库后重试");
    return updateWorkTagLedger(WORK_TAG_LEDGER_FILE, {
      workId,
      name: work.name,
      path: work.path,
      automatic: work.tagSources?.automatic || inferWorkTagGroups(work),
      manual: body.manual || {}
    });
  },
  recordPlatformUsage: recordPlatformUsageForRoute,
  pickFileWithWindowsDialog, recentPublicTasks, startGenericTransfer,
  cancelGenericTransfer, startDistributionTask, cancelDistributionTask,
  runDistributionAction, buildDistributionArgs, exists, updateDeviceNote,
  approveDistributionDevice,
  assertDiscoveredDeviceTarget, resolveDeviceTransportTarget,
  getDeviceStatus, parseOnlineDeviceStatus, deviceStatusScanArgs, registeredDevices,
  maybeStartAutomaticDistribution, recentAutomationLogs, getAutomaticDistributionMonitorState,
  startAutomaticDistributionMonitor,
  // 路径常量
  PROJECT_ROOT, DATA_ROOT, PUBLIC_ROOT, APP_ROOT, SKILL_ROOT, SKILLS_LIBRARY_ROOT,
  CONTENT_INSTANCE_ID, CONTENT_INSTANCE_LABEL, CONTENT_ONLY_MODE,
  ASSIGNED_ACCOUNT_IDS: [...ASSIGNED_ACCOUNT_IDS],
  INSTANCE_PORT: PORT,
  INSTANCE_REMOTE_DEBUGGING_PORT: Number(process.env.TB_REMOTE_DEBUGGING_PORT || CONTENT_INSTANCE_CONFIG.remoteDebuggingPort),
  CONVERSION_SERVICE_ORIGIN, CONVERSION_ASSISTANT_ROOT, CONVERSION_ASSISTANT_LAUNCHER,
  RELEASE_ROOT, DEVICE_TRANSFER_ROOT, DEVICE_REGISTRY_FILE,
  // 数据文件
  STATE_FILE, PROMPTS_FILE, TASK_INDEX_FILE, APP_SETTINGS_FILE,
  IMAGE_API_SECRET_FILE, WEBDAV_CONFIG_FILE, CLOUD_BACKUP_META_FILE,
  CLOUD_LARGE_BACKUP_MANIFEST_FILE, IMAGE_REVIEW_ROOT, PRODUCTION_JOB_ROOT,
  COLLECTION_LEDGER_FILE, DEVICE_PRESENCE_FILE, DEVICE_NOTES_FILE,
  DEVICE_DISTRIBUTION_APPROVALS_FILE, DISTRIBUTION_AUTOMATION_LOG_FILE, MOBILE_CONVERSION_TOKEN_FILE,
  MATERIAL_SCAN_CACHE_FILE, MATERIAL_LIBRARY_CACHE_FILE,
  DEDUP_LEDGER_FILE, EXTENSION_DOWNLOAD_LOG_FILE,
  MATERIAL_USAGE_LEDGER_FILE, MATERIAL_METADATA_LEDGER_FILE,
  WORK_TAG_LEDGER_FILE,
  MATERIAL_HASH_CACHE_FILE, MATERIAL_GLOBAL_INDEX_FILE,
  MATERIAL_LIFECYCLE_LEDGER_FILE,
  GPT_QUOTA_LEDGER_FILE, GPT_PRODUCTION_CHECKPOINT_FILE, GPT_RUNTIME_STATE_FILE,
  GPT_PRODUCTION_ARCHIVE_LOG_FILE, GPT_CONVERSATION_LOG_FILE, WORKPKG_SCRIPT_ROOT, WORKPKG_CONFIG_FILE,
  readRecentGptConversationEntries,
  DOWNLOAD_ROOT, PUBLISH_ROOT,
  // 运行时状态（引用类型，各路由模块可通过引用操作）
  genericTransferTasks, distributionTasks, automaticDistributionSessions,
  pendingProductionPlans, materialCategoryCache, deviceStatusCache,
  deviceStatusPromise, materialGlobalIndexJob,
  // 生产域函数与状态
  productionJobs, productionAbortControllers,
  createProductionPlans, publicProductionJob, safeProductionOptions,
  productionResumeScope, saveProductionJob, updateProductionJob,
  runProductionJob, productionWorkbenchProducts, packProductionWorks,
  saveImageApiSecret, saveTextApiSecret,
  publicImageApiSettings, publicTextApiSettings,
  imageApiCredential, textApiCredential,
  interpretWorkbenchAssistantCommand,
  readWorkbenchControlContext,
  collectReferenceImages, materialFacts, buildProductionPrompt,
  safeOutputName, generateImages, networkFetch,
  normalizeImageApiConfig, normalizeTextApiConfig,
  writeJson,
  // GPT+扩展+去重域函数与状态
  PORT,
  pythonExe,
  readOnlineTemplates, updateOnlineTemplate,
  extensionProductSnapshot, extensionProductTreeSnapshot,
  runExtensionWorkPackage, saveExtensionCopyText,
  readGptProductionCheckpoint, writeGptProductionCheckpoint,
  readGptRuntimeState, writeGptRuntimeState, writeGptRuntimeStateAsync,
  findRecoverableImageBatch, gptQuotaSnapshot, appendGptQuotaEvent,
  archiveMaterialAfterProduction, inspectGptWorkPackage,
  getWorkPackageDirectoryIndex, getWorkPackageHistoryIndex, resolveWorkPackagePath,
  recordMaterialUsage, checkMaterialUsage, updateMaterialMetadata,
  getMaterialLifecycleSnapshot, initializeMaterialLifecycle,
  claimMaterialLifecycle, markMaterialAwaitingArchive,
  releaseMaterialLifecycleFailure,
  getMaterialGlobalIndex,
  publicDedupStatus, syncHistoricalDedupLedger, getDedupLedger,
  isDownloadedText, registerDownloadedText,
  // 转化域函数与状态
  LISTEN_HOST,
  hasMobileConversionAccess, mobileConversionToken, mobileConversionLink,
  localIPv4Addresses, proxyIntegratedConversion,
  isIntegratedConversionCompatibilityPath,
  requestConversionService, getConversionSnapshot, ensureConversionService,
};

async function route(req, res) {
  // Keep the small parsed-request contract used by the route modules, but use
  // WHATWG URL instead of the deprecated legacy url.parse API. Electron logs
  // this deprecation on every desktop restart, which hides real failures.
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const parsed = {
    pathname: requestUrl.pathname,
    search: requestUrl.search,
    href: requestUrl.href,
    query: Object.fromEntries(requestUrl.searchParams.entries())
  };
  const pathname = decodeURIComponent(parsed.pathname);
  const remoteRequest = !isLoopbackAddress(req.socket.remoteAddress);

  // Keep the version probe ahead of the optional conversion and skills
  // routers. It must remain a genuinely cheap local health check even while
  // one of those routers is waiting on an external helper.
  if (pathname === "/api/runtime-info" && req.method === "GET") {
    return sendExtensionJson(req, res, {
      ok: true,
      version: APP_VERSION,
      generatedAt: new Date().toISOString()
    });
  }

  // The runtime mirror is another local read-only health surface. Keep its
  // GET probe beside /api/runtime-info so an optional conversion/skills
  // helper cannot make the workbench appear frozen while the queue is still
  // recoverable from its persisted state.
  if (pathname === "/api/gpt-production/runtime-state" && req.method === "GET") {
    return sendExtensionJson(req, res, {
      ok: true,
      state: readGptRuntimeState(GPT_RUNTIME_STATE_FILE)
    });
  }

  // Conversation evidence is a local recovery input. Keep its bounded read
  // beside the cheap runtime probes so an optional conversion/skills helper
  // cannot hold the automatic GPT worker before it reaches its own queue.
  if (pathname === "/api/gpt-production/conversation-ownership" && req.method === "GET") {
    try {
      const requestIds = String(parsed.query.requestIds || "").split(",").map((value) => decodeURIComponent(value));
      return sendExtensionJson(req, res, {
        ok: true,
        ownership: readGptConversationOwnership(requestIds)
      });
    } catch (error) {
      return sendExtensionJson(req, res, { ok: false, error: error.message }, 500);
    }
  }

  if (pathname === "/api/gpt-production/conversation-log" && req.method === "GET") {
    try {
      return sendExtensionJson(req, res, {
        ok: true,
        entries: readRecentGptConversationEntries(parsed.query.limit)
      });
    } catch (error) {
      return sendExtensionJson(req, res, { ok: false, error: error.message }, 500);
    }
  }

  if (await conversionRoute.handleEarly(req, res, pathname, parsed, routeCtx)) return;

  if (remoteRequest) {
    return send(res, 403, "此入口仅供本机使用。", "text/plain; charset=utf-8");
  }

  if (await conversionRoute.handle(req, res, pathname, parsed, routeCtx)) return;

  if (await skillsRoute.handle(req, res, pathname, parsed, routeCtx)) return;

  if (req.method === "OPTIONS") {
    res.writeHead(204, extensionCorsHeaders(req));
    return res.end();
  }

  if (pathname === "/api/dashboard") {
    const libraryPath = parsed.query.library ? decodeURIComponent(parsed.query.library) : "";
    return sendExtensionJson(req, res, getDashboard(parsed.query.refresh === "materials", libraryPath, {
      lite: parsed.query.lite === "1"
    }));
  }

  if (pathname === "/api/workbench-control/context" && req.method === "GET") {
    try {
      return sendExtensionJson(req, res, readWorkbenchControlContext(
        parsed.query.kind,
        parsed.query.name,
        parsed.query.start,
        parsed.query.limit
      ));
    } catch (error) {
      return sendExtensionJson(req, res, { ok: false, error: error.message }, 400);
    }
  }

  if (pathname === "/api/moments/collect" && req.method === "POST") {
    if (!momentsFeatureEnabled()) return sendExtensionJson(req, res, { ok: false, error: "朋友圈模块已在技能中心的朋友圈设置中关闭" }, 409);
    const body = JSON.parse(await getBody(req, 32_000) || "{}");
    const friend = String(body.friend || "").trim().slice(0, 160);
    const requestedWxid = String(body.wxid || "").trim().slice(0, 160);
    const source = body.source === "pyweixin" ? "pyweixin" : "weflow";
    const limit = Math.max(1, Math.min(100, Number(body.limit) || 10));
    const fullHistory = body.fullHistory === true;
    const resumeOnly = body.resumeOnly === true;
    const targetMonth = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(body.targetMonth || "").trim())
      ? String(body.targetMonth).trim()
      : "";
    if (!friend) return sendExtensionJson(req, res, { ok: false, error: "请提供朋友圈账号备注名或显示名" }, 400);
    let wxid = "";
    try {
      wxid = resolveMomentsTargetWxid(friend, requestedWxid);
    } catch (error) {
      return sendExtensionJson(req, res, { ok: false, error: error.message, code: "MOMENTS_ACCOUNT_AMBIGUOUS" }, 409);
    }
    if (source === "weflow" && !wxid) return sendExtensionJson(req, res, { ok: false, error: "WeFlow 采集必须提供目标账号 UID" }, 400);
    const result = await runMomentsCollect({ friend, wxid, source, limit, fullHistory, resumeOnly, targetMonth });
    return sendExtensionJson(req, res, {
      ok: result.ok,
      result: result.result || null,
      libraryRoot: momentsLibraryRoot(),
      stdout: result.stdout,
      stderr: result.stderr,
      message: result.ok ? "朋友圈采集完成，已按条落盘并执行去重" : "朋友圈采集已停止；原始暂存和日志已保留"
    }, result.ok ? 200 : 500);
  }

  if (pathname === "/api/moments/library" && req.method === "GET") {
    if (!momentsFeatureEnabled()) return sendExtensionJson(req, res, { ok: false, error: "朋友圈模块已在技能中心的朋友圈设置中关闭" }, 409);
    return sendExtensionJson(req, res, getMomentsLibrary());
  }

  if (pathname === "/api/moments/media" && req.method === "GET") {
    if (!momentsFeatureEnabled()) return sendExtensionJson(req, res, { ok: false, error: "朋友圈模块已在技能中心的朋友圈设置中关闭" }, 409);
    const workId = String(parsed.query.workId || "").trim();
    const fileName = String(parsed.query.file || "").trim();
    const directory = momentsWorkDirectory(workId, "ready");
    const target = directory ? path.resolve(directory, fileName) : "";
    if (!directory || !fileName || path.basename(fileName) !== fileName || !imageExts.has(path.extname(fileName).toLowerCase())
      || !isPathInside(directory, target) || !exists(target)) {
      return send(res, 404, "not found", "text/plain; charset=utf-8");
    }
    res.writeHead(200, {
      "Content-Type": contentType(target),
      "Cache-Control": "no-store",
      ...extensionCorsHeaders(req)
    });
    return fs.createReadStream(target).pipe(res);
  }

  if (pathname === "/api/moments/preflight" && req.method === "POST") {
    if (!momentsFeatureEnabled()) return sendExtensionJson(req, res, { ok: false, error: "朋友圈模块已在技能中心的朋友圈设置中关闭" }, 409);
    const body = JSON.parse(await getBody(req, 16_000) || "{}");
    const workId = String(body.workId || "").trim();
    const requestedPolicy = String(body.selectionPolicy || "").trim();
    const policy = ["current-year", "last-year-day", "historical-day", "last-year-month", "anniversary", "random", "all"].includes(requestedPolicy)
      ? requestedPolicy
      : "last-year-day";
    if (!workId) return sendExtensionJson(req, res, { ok: false, error: "发送前自检需要先选择一条朋友圈素材" }, 400);
    const item = getMomentsLibrary().items.find((candidate) => candidate.workId === workId);
    if (!item) return sendExtensionJson(req, res, { ok: false, error: "朋友圈作品不存在，请先刷新作品库" }, 404);
    const result = await runMomentsPreflight(workId, { policy });
    const diagnostic = momentsDiagnostic(result.stderr);
    return sendExtensionJson(req, res, {
      ok: result.ok,
      workId,
      stage: result.ok ? "PREFLIGHT_OK" : "PREFLIGHT_FAILED",
      result: result.result || null,
      libraryRoot: momentsLibraryRoot(),
      stdout: result.stdout,
      stderr: result.stderr,
      diagnostic,
      timedOut: Boolean(result.timedOut),
      message: result.ok
        ? "发送前自检通过；没有打开微信、写入状态或修改原素材"
        : "发送前自检未通过；没有打开微信、写入状态或修改原素材"
    }, result.ok ? 200 : 409);
  }

  if (pathname === "/api/moments/prepare" && req.method === "POST") {
    if (!momentsFeatureEnabled()) return sendExtensionJson(req, res, { ok: false, error: "朋友圈模块已在技能中心的朋友圈设置中关闭" }, 409);
    const body = JSON.parse(await getBody(req, 32_000) || "{}");
    const workId = String(body.workId || "").trim();
    const retryFailed = body.retryFailed === true;
    const requestedPolicy = String(body.selectionPolicy || "").trim();
    const policy = ["current-year", "last-year-day", "historical-day", "last-year-month", "anniversary", "random", "all"].includes(requestedPolicy)
      ? requestedPolicy
      : "";
    const item = getMomentsLibrary().items.find((candidate) => candidate.workId === workId);
    if (!item) return sendExtensionJson(req, res, { ok: false, error: "朋友圈作品不存在，请先刷新作品库" }, 404);
    if (!item.selectionEnabled && !(retryFailed && item.status === "FAILED")) {
      return sendExtensionJson(req, res, {
        ok: false,
      error: item.status === "FAILED"
          ? "该作品上次准备失败；请在面板中明确点击“手动重试该作品”，系统不会自动重试"
          : item.selectionBlockReason
            ? item.selectionBlockReason
          : `作品当前状态为 ${item.status}，没有进入可发送队列；系统不会自动重试或换下一条`,
        item
      }, 409);
    }
    const processResult = await runMomentsPrepare(workId, { retryFailed, policy, source: "manual" });
    const workflowStatus = String(
      processResult.result?.record?.status
        || processResult.result?.status
        || ""
    );
    const waitingForLogin = workflowStatus === "WAITING_FOR_HUMAN_LOGIN";
    const waitingForHumanConfirm = workflowStatus === "PREPARED_FOR_HUMAN_CONFIRM"
      && processResult.result?.blocked === true;
    return sendExtensionJson(req, res, {
      ok: processResult.ok,
      workId,
      stage: processResult.ok
        ? "PREPARED_FOR_HUMAN_CONFIRM"
        : waitingForLogin
          ? "WAITING_FOR_HUMAN_LOGIN"
          : waitingForHumanConfirm
            ? "WAITING_FOR_HUMAN_CONFIRM"
          : "FAILED",
      code: waitingForHumanConfirm ? "MOMENTS_HUMAN_CONFIRM_REQUIRED" : "",
      result: processResult.result || null,
      libraryRoot: momentsLibraryRoot(),
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      diagnostic: momentsDiagnostic(processResult.stderr),
      timedOut: Boolean(processResult.timedOut),
      message: processResult.ok
        ? "已填入微信朋友圈发表界面；最终发表仍需你手动点击"
        : waitingForLogin
          ? "微信已打开但尚未完成登录；请在微信窗口完成登录后，重新点击同一条素材，不会自动换下一条"
          : waitingForHumanConfirm
            ? "已有一条朋友圈停在微信人工发表确认，请先处理当前微信窗口；不会自动换下一条"
          : "朋友圈准备失败，已停止；请查看日志和当前微信窗口，不会自动换下一条"
    }, processResult.ok ? 200 : (waitingForLogin || waitingForHumanConfirm) ? 409 : 500);
  }

  if (pathname === "/api/moments/open" && req.method === "POST") {
    if (!momentsFeatureEnabled()) return sendExtensionJson(req, res, { ok: false, error: "朋友圈模块已在技能中心的朋友圈设置中关闭" }, 409);
    const body = JSON.parse(await getBody(req, 16_000) || "{}");
    const workId = String(body.workId || "").trim();
    const directory = momentsWorkDirectory(workId, "ready");
    if (!directory || !exists(directory)) {
      return sendExtensionJson(req, res, { ok: false, error: "朋友圈作品目录不存在，请先刷新作品库" }, 404);
    }
    childProcess.spawn("explorer.exe", [directory], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return sendExtensionJson(req, res, { ok: true });
  }

  if (pathname === "/api/moments/organize" && req.method === "POST") {
    if (!momentsFeatureEnabled()) return sendExtensionJson(req, res, { ok: false, error: "朋友圈模块已在技能中心的朋友圈设置中关闭" }, 409);
    const result = await runMomentsOrganize();
    return sendExtensionJson(req, res, {
      ok: result.ok,
      result: result.result || null,
      libraryRoot: momentsLibraryRoot(),
      stdout: result.stdout,
      stderr: result.stderr,
      message: result.ok ? "素材标签已整理并写回 asset.json" : "素材标签整理失败；原素材未移动"
    }, result.ok ? 200 : 500);
  }

  if (pathname === "/api/distribution/live" && req.method === "GET") {
    ensureDataFiles();
    // GPT production only needs to know whether the material index changed.
    // Returning a full distribution snapshot here makes a busy native GPT
    // view parse/render ~2.5 MB every poll for no visual benefit.
    if (parsed.query.summary === "1") {
      return sendExtensionJson(req, res, {
        ok: true,
        summary: true,
        generatedAt: new Date().toISOString(),
        materialCacheStaleTime
      });
    }
    const workspaceSettings = getWorkspaceSettings();
    const distributionSettings = workspaceSettings.pageSettings?.distribution || {};
    return sendExtensionJson(req, res, {
      ok: true,
      generatedAt: new Date().toISOString(),
      materialCacheStaleTime,
      distribution: getLiveDistributionSnapshot({
        workspaceSettings,
        distributionSettings,
        force: parsed.query.refresh === "1"
      })
    });
  }

  if (pathname === "/api/materials/all") {
    return sendExtensionJson(req, res, getMaterialLibrary(parsed.query.refresh === "1", "", { loadAll: true }));
  }

  if (pathname === "/api/materials/find" && req.method === "GET") {
    const folderName = decodeURIComponent(String(parsed.query.name || ""));
    const item = findMaterialGlobalIndexEntry(folderName);
    return sendExtensionJson(req, res, item
      ? { ok: true, item, category: { name: item.categoryName || "", path: item.categoryId || "", loaded: true, items: [item] } }
      : { ok: false, error: "素材索引中没有找到这个作品文件夹" }, item ? 200 : 404);
  }

  if (pathname === "/api/materials/auto-select" && req.method === "GET") {
    const rawExcluded = parsed.query.exclude;
    const excludedPaths = Array.isArray(rawExcluded) ? rawExcluded : [rawExcluded || ""];
    const requestedCount = Math.max(1, Math.min(30, Number(parsed.query.count || 8)));
    return sendExtensionJson(req, res, {
      ok: true,
      source: "material-global-index",
      generatedAt: new Date().toISOString(),
      entries: getFastAutomaticMaterialEntries(requestedCount, excludedPaths, {
        owner: String(parsed.query.accountId || "")
      })
    });
  }

  if (pathname === "/api/materials") {
    const libraryPath = parsed.query.library ? decodeURIComponent(parsed.query.library) : "";
    if (libraryPath) {
      return sendExtensionJson(req, res, getMaterialLibrary(parsed.query.refresh === "1", libraryPath, {
        includeDiagnostics: parsed.query.diagnostics === "1"
      }));
    }
    // 不带 library 参数时只返回分类索引（不加载帖子），避免一次性扫描所有分类阻塞服务器
    return sendExtensionJson(req, res, getMaterialLibrary(parsed.query.refresh === "1", "", {
      loadAll: false,
      loadDefault: false
    }));
  }

  if (await gptExtensionRoute.handle(req, res, pathname, parsed, routeCtx)) return;

  if (pathname === "/api/materials" && req.method === "GET") {
    ensureDataFiles();
    const libraryPath = parsed.query.library ? decodeURIComponent(parsed.query.library) : "";
    const categoryId = parsed.query.category ? decodeURIComponent(parsed.query.category) : "";
    const selectedPath = categoryId || libraryPath;
    const materials = getMaterialLibrary(
      parsed.query.refresh === "true",
      selectedPath,
      { loadDefault: Boolean(selectedPath) }
    );
    return sendExtensionJson(req, res, {
      generatedAt: new Date().toISOString(),
      materials: compactMaterialIndex(materials, categoryId)
    });
  }

  if (await juguangRoute.handle(req, res, pathname, parsed, routeCtx)) return;

  if (pathname === "/api/state" && req.method === "POST") {
    const body = JSON.parse(await getBody(req) || "{}");
    const previous = readJson(STATE_FILE, {});
    const next = sanitizeState({ ...previous, ...body, updatedAt: new Date().toISOString() });
    writeJson(STATE_FILE, next);
    return sendJson(res, next);
  }

  if (pathname === "/api/prompts" && req.method === "POST") {
    const body = JSON.parse(await getBody(req) || "{}");
    const data = readJson(PROMPTS_FILE, { prompts: [] });
    const prompt = data.prompts.find((item) => item.id === body.id);
    if (!prompt) return send(res, 404, JSON.stringify({ error: "prompt not found" }));
    const version = body.version || `V${prompt.versions.length + 1}`;
    prompt.versions.unshift({
      version,
      createdAt: new Date().toISOString().slice(0, 10),
      sourceFile: "workflow-dashboard",
      content: body.content || ""
    });
    prompt.activeVersion = version;
    data.updatedAt = new Date().toISOString();
    writeJson(PROMPTS_FILE, data);
    return sendJson(res, data);
  }

  if (pathname === "/api/rename" && req.method === "POST") {
    const body = JSON.parse(await getBody(req) || "{}");
    const target = body.path || "";
    const newName = String(body.newName || "").trim();
    if (!target || !isAllowedFile(target) || !exists(target)) return send(res, 403, JSON.stringify({ error: "path not allowed" }));
    if (!newName || /[\\/:*?"<>|]/.test(newName)) return send(res, 400, JSON.stringify({ error: "invalid name" }));
    const next = path.join(path.dirname(target), newName);
    if (!isAllowedFile(next) || exists(next)) return send(res, 400, JSON.stringify({ error: "target exists or not allowed" }));
    fs.renameSync(target, next);
    return sendJson(res, { ok: true, path: next });
  }

  if (pathname === "/api/trash-workspace-folder" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    try {
      return sendJson(res, trashEditableWorkspaceDirectory(body.path));
    } catch (error) {
      return send(res, 400, JSON.stringify({ error: error.message }));
    }
  }


  if (pathname === "/api/collect-materials" && req.method === "POST") {
    const body = JSON.parse(await getBody(req) || "{}");
    const items = Array.isArray(body.items) ? body.items.slice(0, 300) : [];
    if (!items.length) return send(res, 400, JSON.stringify({ error: "no items" }));
    const result = collectMaterialLinks(body.libraryPath, items, body.filterSummary || "");
    return sendJson(res, result);
  }

  if (await settingsRoute.handle(req, res, pathname, parsed, routeCtx)) return;

  if (await productionRoute.handle(req, res, pathname, parsed, routeCtx)) return;

  if (await backupRoute.handle(req, res, pathname, parsed, routeCtx)) return;

  if (await distributionRoute.handle(req, res, pathname, parsed, routeCtx)) return;

  if (await platformPublishingRoute.handle(req, res, pathname, parsed, routeCtx)) return;



  if (await wechatDraftRoute.handle(req, res, pathname, parsed, routeCtx)) return;

  if (pathname === "/api/open" && req.method === "POST") {
    const body = JSON.parse(await getBody(req) || "{}");
    const target = body.path;
    if (!target || !isAllowedFile(target)) return send(res, 403, JSON.stringify({ error: "path not allowed" }));
    childProcess.spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
    return sendJson(res, { ok: true });
  }
  if (pathname === "/api/open-url" && req.method === "POST") {
    const body = JSON.parse(await getBody(req) || "{}");
    const target = body.target;
    if (!isAllowedExternalTarget(target)) return send(res, 403, JSON.stringify({ error: "external target not allowed" }));
    childProcess.spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
    return sendJson(res, { ok: true });
  }

  if (pathname === "/file") {
    if (res.headersSent) return;
    const target = parsed.query.path ? decodeURIComponent(parsed.query.path) : "";
    if (!target || !isAllowedFile(target) || !exists(target)) return send(res, 404, "not found", "text/plain; charset=utf-8");
    res.writeHead(200, {
      "Content-Type": contentType(target),
      "Cache-Control": "no-store",
      ...extensionCorsHeaders(req)
    });
    return fs.createReadStream(target).pipe(res);
  }

  if (res.headersSent) return;
  if (pathname.startsWith("/api/")) {
    return send(res, 404, JSON.stringify({ error: "api not found" }), "application/json; charset=utf-8");
  }
  const file = resolvePublicFile(pathname);
  if (!file) return send(res, 404, "not found", "text/plain; charset=utf-8");
  res.writeHead(200, { "Content-Type": contentType(file), "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

const httpServer = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    if (res.headersSent) return;
    send(res, 500, JSON.stringify({ error: error.message }));
  });
});

httpServer.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(formatPortInUseMessage(PORT));
    process.exitCode = 1;
    return;
  }
  throw error;
});

if (require.main === module) {
  const contentOnlyMode = String(process.env.CONTENT_ONLY_MODE || "") === "1";
  ensureDataFiles();
  httpServer.listen(PORT, LISTEN_HOST, () => {
    console.log(`内容生产: http://localhost:${PORT}`);
    if (LISTEN_HOST !== "127.0.0.1") console.log(`手机转化入口已开启: ${mobileConversionLink()}`);
    console.log(`项目根目录: ${PROJECT_ROOT}`);
    if (!contentOnlyMode) {
      cloudBackupTimer = setInterval(runScheduledCloudBackup, 15 * 60 * 1000);
      cloudBackupTimer.unref?.();
      setTimeout(runScheduledCloudBackup, 60_000).unref?.();
      startAutomaticDistributionMonitor();
      startDevicePresenceEventListener();
      startMomentsScheduler();
    }
    if (!contentOnlyMode) startMaterialWatcher();
  });
}

module.exports = {
  buildDistributionArgs,
  createConversionServiceSupervisor,
  collectMaterialLinks,
  extensionCorsHeaders,
  extensionProductTreeSnapshot,
  findCompletedWorkPackageByBatchId,
  getBody,
  httpServer,
  isAllowedFile,
  isAllowedExternalTarget,
  isIntegratedConversionCompatibilityPath,
  isPathInside,
  isLoopbackAddress,
  localIPv4Addresses,
  mobileConversionLink,
  materialCategoryIndex,
  materialCategoryCountMap,
  materialTreeSignature,
  normalizeOnlineTemplateUrl,
  readOnlineTemplates,
  getMaterialUsageLedger,
  getTemplateLibrary,
  getLiveDistributionSnapshot,
  getMaterialMetadataLedger,
  getMomentsLibrary,
  parseMomentsProcessOutput,
  runMomentsPreflight,
  getMomentsSchedulerStatus,
  tickMomentsCollectionScheduler,
  startMomentsScheduler,
  tickMomentsScheduler,
  checkMaterialUsage,
  moveWorkspaceEntry,
  materialUsageFingerprint,
  materialUsageDirectoryName,
  materialFolderHash,
  materialMetadataProfile,
  getMaterialLifecycleLedger,
  getMaterialLifecycleSnapshot,
  initializeMaterialLifecycle,
  claimMaterialLifecycle,
  markMaterialAwaitingArchive,
  releaseMaterialLifecycleFailure,
  archiveMaterialAfterProduction,
  inferMaterialMainTag,
  inferMaterialTags,
  inferMaterialUsageCountFromPath,
  readMaterialTagText,
  inspectGptWorkPackage,
  validateGptWorkPackageImageCount,
  getLegacyMaterialEvidence,
  matchLegacyMaterialEvidence,
  applyLegacyMaterialEvidence,
  materialIndexStats,
  queueMaterialGlobalIndexRefresh,
  runMaterialGlobalIndexRefresh,
  getMaterialGlobalIndexJobStatus,
  getMaterialGlobalIndex,
  readWorkbenchControlContext,
  recordMaterialUsage,
  updateMaterialMetadata,
  updateOnlineTemplate,
  resolvePublicFile,
  rewriteIntegratedConversionContent,
  rewriteIntegratedConversionDocument,
  decodeDeviceBeaconPart,
  parseDevicePresenceBeacon,
  handleDevicePresenceBeacon,
  startDevicePresenceEventListener,
  getAutomaticDistributionMonitorState,
  parseOnlineDeviceStatus,
  deviceStatusScanArgs,
  readDevicePresenceSnapshot,
  writeDevicePresenceSnapshot,
  mergeDevicePresence,
  hasCurrentDevicePresence,
  resolveDeviceTransportTarget,
  productionPageAllowed,
  productionResumeScope,
  publicDedupStatus,
  runExtensionWorkPackage,
  scanMaterialFolderDiagnostics,
  scanPostFolders,
  syncHistoricalDedupLedger,
  safeName
};
