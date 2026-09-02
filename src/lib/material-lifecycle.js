const crypto = require("crypto");

const MATERIAL_LIFECYCLE_STATES = Object.freeze([
  "待初次打标",
  "已打标待生产",
  "生产中",
  "作品已完成待归档",
  "归档完成",
  "待复核"
]);

const MATERIAL_OPERATION_STATUSES = Object.freeze([
  "正常",
  "失败待恢复",
  "已暂停",
  "等待额度",
  "网页异常"
]);

const MATERIAL_CONFLICT_CODES = Object.freeze([
  "FOLDER_NOT_COMPLETE",
  "TAG_SOURCE_CONFLICT",
  "USAGE_COUNT_CONFLICT",
  "DUPLICATE_FINGERPRINT",
  "MATERIAL_LOCKED"
]);

function normalizeLifecycleState(value) {
  const state = String(value || "").trim();
  return MATERIAL_LIFECYCLE_STATES.includes(state) ? state : "待初次打标";
}

function normalizeOperationalStatus(value) {
  const status = String(value || "").trim();
  return MATERIAL_OPERATION_STATUSES.includes(status) ? status : "正常";
}

function uniqueConflicts(conflicts = []) {
  return Array.from(new Set((Array.isArray(conflicts) ? conflicts : [conflicts])
    .map((value) => String(value || "").trim())
    .filter((value) => MATERIAL_CONFLICT_CODES.includes(value))));
}

function decideMaterialLifecycle(observation = {}) {
  const conflicts = uniqueConflicts(observation.conflicts);
  const current = normalizeLifecycleState(observation.currentState);
  const hasTags = observation.hasTags === true || Number(observation.tagCount || 0) > 0;
  const activeProduction = current === "生产中" || current === "作品已完成待归档";
  const completed = current === "归档完成";
  if (conflicts.length) {
    return {
      lifecycleState: "待复核",
      operationalStatus: normalizeOperationalStatus(observation.operationalStatus),
      conflicts,
      canProduce: false,
      reason: "素材存在标签、次数或指纹冲突"
    };
  }
  if (completed) {
    return {
      lifecycleState: "归档完成",
      operationalStatus: "正常",
      conflicts: [],
      canProduce: false,
      reason: "素材已经完成归档"
    };
  }
  if (activeProduction) {
    return {
      lifecycleState: current,
      operationalStatus: normalizeOperationalStatus(observation.operationalStatus),
      conflicts: [],
      canProduce: true,
      reason: "保留当前生产检查点"
    };
  }
  if (!hasTags) {
    return {
      lifecycleState: "待初次打标",
      operationalStatus: normalizeOperationalStatus(observation.operationalStatus),
      conflicts: [],
      canProduce: false,
      reason: "尚未完成初次打标"
    };
  }
  return {
    lifecycleState: "已打标待生产",
    operationalStatus: normalizeOperationalStatus(observation.operationalStatus),
    conflicts: [],
    canProduce: true,
    reason: "标签和次数已确认，可进入生产队列"
  };
}

function canClaimMaterial(entry = {}, options = {}) {
  const owner = String(options.owner || "").trim();
  const now = Number(options.now || Date.now());
  const lockTtlMs = Math.max(30_000, Number(options.lockTtlMs || 15 * 60 * 1000));
  const conflicts = uniqueConflicts(entry.conflicts);
  const state = normalizeLifecycleState(entry.lifecycleState);
  if (!String(entry.lifecycleState || "").trim()) {
    return { ok: false, code: "MATERIAL_NOT_INITIALIZED", reason: "素材尚未完成初次打标" };
  }
  if (state === "待初次打标") {
    return { ok: false, code: "MATERIAL_TAGGING_REQUIRED", reason: "素材尚未完成初次打标" };
  }
  if (conflicts.length || normalizeLifecycleState(entry.lifecycleState) === "待复核") {
    return { ok: false, code: "MATERIAL_REVIEW_REQUIRED", reason: "素材冲突待复核" };
  }
  if (normalizeLifecycleState(entry.lifecycleState) === "归档完成") {
    return { ok: false, code: "MATERIAL_ALREADY_ARCHIVED", reason: "素材已经归档完成" };
  }
  const lock = entry.lock && typeof entry.lock === "object" ? entry.lock : null;
  const lockedAt = Date.parse(String(lock?.heartbeatAt || lock?.claimedAt || ""));
  const lockActive = lock?.owner && lockedAt > 0 && now - lockedAt < lockTtlMs;
  if (lockActive && lock.owner !== owner) {
    return { ok: false, code: "MATERIAL_LOCKED", reason: "素材正在被其他生产窗口使用" };
  }
  if (!owner) return { ok: false, code: "MATERIAL_OWNER_REQUIRED", reason: "生产窗口缺少 owner" };
  return { ok: true, code: "MATERIAL_CLAIM_ALLOWED" };
}

function archiveEventKey(event = {}) {
  if (String(event.archiveEventKey || "").trim()) return String(event.archiveEventKey).trim();
  const material = String(event.folderHash || event.entryPath || "").trim().toLowerCase();
  const request = String(event.requestId || "").trim();
  // packagePath is an output location, not an event identity. It can be
  // empty on a late callback or differ after a package/library move. Keep the
  // request boundary ahead of the stable material fallback, and never let
  // that incidental path manufacture a second archive event.
  const identity = request
    ? ["material-archive-request-v2", material, request]
    : ["material-archive-fallback-v2", material];
  return crypto.createHash("sha256")
    .update(identity.join("\u0000"))
    .digest("hex");
}

function hasArchiveEvent(entry = {}, key = "") {
  const eventKey = String(key || "").trim();
  if (!eventKey) return false;
  return String(entry.lastArchiveEventKey || "") === eventKey
    || (Array.isArray(entry.archiveEvents) && entry.archiveEvents.includes(eventKey));
}

function appendArchiveEvent(entry = {}, key = "", now = new Date().toISOString()) {
  const eventKey = String(key || "").trim();
  const previous = Array.isArray(entry.archiveEvents) ? entry.archiveEvents : [];
  return {
    ...entry,
    lastArchiveEventKey: eventKey || String(entry.lastArchiveEventKey || ""),
    archiveEvents: eventKey
      ? Array.from(new Set([...previous, eventKey])).slice(-50)
      : previous,
    archiveEventAt: now
  };
}

function operationalStatusForFailure(error = {}) {
  const code = String(error.code || error.errorCode || "").toUpperCase();
  const text = String(error.message || error.error || error.detail || "");
  if (/QUOTA|LIMIT|额度|安全线|触顶/i.test(`${code} ${text}`)) return "等待额度";
  if (/PAUSE|STOP|USER_PAUSED|已暂停|停止/i.test(`${code} ${text}`)) return "已暂停";
  if (/PAGE|WEB|BRIDGE|HEARTBEAT|网页|浏览器|检查点/i.test(`${code} ${text}`)) return "网页异常";
  return "失败待恢复";
}

module.exports = {
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
};
