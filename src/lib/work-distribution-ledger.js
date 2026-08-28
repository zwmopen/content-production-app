const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const TEXT_EXTENSIONS = new Set([".txt"]);
const DEFAULT_WORK_DISTRIBUTION_CLAIM_TTL_MS = 6 * 60 * 60 * 1000;
// A claim from a task that is no longer present in the current workbench
// process must not block automatic replenishment for the full safety TTL.
// Keep a short grace period for a normal process handoff, while retaining the
// six-hour lease for a task that is still genuinely running.
const DEFAULT_WORK_DISTRIBUTION_ORPHAN_CLAIM_GRACE_MS = 30 * 60 * 1000;

function stableWorkId(directory) {
  return crypto.createHash("sha256")
    .update(path.basename(String(directory || "")).normalize("NFKC").trim().toLowerCase())
    .digest("hex").slice(0, 32);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

function inspectWorkDirectory(directory) {
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return null; }
  const images = entries.filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
  const texts = entries.filter((entry) => entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
  if (!images.length || !texts.length) return null;
  const manifest = readJson(path.join(directory, "GPT作品记录.json"), {});
  let textPreview = "";
  try { textPreview = fs.readFileSync(path.join(directory, texts[0].name), "utf8").slice(0, 4000); } catch { /* optional */ }
  let createdAt = "";
  try { createdAt = fs.statSync(directory).birthtime.toISOString(); } catch { /* optional */ }
  return {
    workId: String(manifest.id || manifest.workId || stableWorkId(directory)),
    name: path.basename(directory),
    path: path.resolve(directory),
    imageCount: images.length,
    textCount: texts.length,
    textComplete: texts.length > 0,
    previewPath: path.join(directory, images[0].name),
    textPath: path.join(directory, texts[0].name),
    textPreview,
    contentType: String(manifest.contentType || manifest.type || ""),
    tags: Array.isArray(manifest.tags) ? manifest.tags.map(String) : [],
    platformUsage: manifest.platformUsage && typeof manifest.platformUsage === "object" && !Array.isArray(manifest.platformUsage)
      ? manifest.platformUsage
      : {},
    createdAt
  };
}

function inspectWorks(source, options = {}) {
  const root = path.resolve(String(source || ""));
  const maximumDepth = Math.max(0, Math.min(8, Number(options.maximumDepth ?? 4)));
  const maximumDirectories = Math.max(1, Math.min(50_000, Number(options.maximumDirectories ?? 10_000)));
  const direct = inspectWorkDirectory(root);
  if (direct) return [direct];
  const works = [];
  const queue = [{ directory: root, depth: 0 }];
  let inspected = 0;
  const visited = new Set();
  while (queue.length && inspected < maximumDirectories) {
    const current = queue.shift();
    let real = "";
    try { real = fs.realpathSync.native(current.directory).toLowerCase(); } catch { continue; }
    if (visited.has(real)) continue;
    visited.add(real);
    inspected += 1;
    const work = inspectWorkDirectory(current.directory);
    if (work) {
      works.push(work);
      continue;
    }
    if (current.depth >= maximumDepth) continue;
    let entries = [];
    try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); } catch { continue; }
    entries.forEach((entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) return;
      queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
    });
  }
  return works.sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"));
}

function readWorkDistributionLedger(file) {
  const data = readJson(file, { version: 1, successes: {} });
  return {
    version: 1,
    updatedAt: String(data.updatedAt || ""),
    successes: data.successes && typeof data.successes === "object" ? data.successes : {}
  };
}

function recordSuccessfulWorkDistribution(file, detail = {}) {
  const work = detail.work || {};
  const workId = String(work.workId || "").trim();
  if (!workId) throw new Error("作品缺少稳定 workId，不能写入成功分发状态");
  const ledger = readWorkDistributionLedger(file);
  const now = String(detail.succeededAt || new Date().toISOString());
  const attempt = {
    taskId: String(detail.taskId || ""),
    deviceId: String(detail.deviceId || ""),
    device: String(detail.device || ""),
    succeededAt: now,
    manualResend: detail.manualResend === true
  };
  const previous = ledger.successes[workId];
  if (previous) {
    const error = new Error(`作品已成功分发，禁止再次写入成功记录：${work.name || previous.name || workId}`);
    error.code = "DUPLICATE_DISTRIBUTION_BLOCKED";
    error.workId = workId;
    error.record = previous;
    throw error;
  }
  ledger.successes[workId] = {
    workId,
    name: String(work.name || previous?.name || ""),
    path: String(work.path || previous?.path || ""),
    collection: String(detail.collection || previous?.collection || ""),
    distributed: true,
    firstDistributedAt: String(previous?.firstDistributedAt || now),
    firstDeviceId: String(previous?.firstDeviceId || attempt.deviceId),
    firstDevice: String(previous?.firstDevice || attempt.device),
    successfulAttempts: [...(Array.isArray(previous?.successfulAttempts) ? previous.successfulAttempts : []), attempt]
  };
  ledger.updatedAt = now;
  writeJsonAtomic(file, ledger);
  return ledger.successes[workId];
}

function workDistributionClaimPath(claimRoot, workId) {
  const digest = crypto.createHash("sha256")
    .update(String(workId || "").trim())
    .digest("hex");
  return path.join(path.resolve(String(claimRoot || "")), `${digest}.json`);
}

function normalizeClaimWorks(works = []) {
  const seen = new Set();
  return (Array.isArray(works) ? works : [])
    .map((work) => ({
      workId: String(work?.workId || "").trim(),
      name: String(work?.name || "").trim()
    }))
    .filter((work) => work.workId && !seen.has(work.workId) && seen.add(work.workId));
}

function parseClaimTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function claimIsStale(claim = {}, options = {}) {
  const ttlMs = Number(options.claimTtlMs ?? DEFAULT_WORK_DISTRIBUTION_CLAIM_TTL_MS);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  const lastActivityAt = parseClaimTimestamp(claim.heartbeatAt || claim.createdAt);
  if (lastActivityAt === null) return false;
  const now = parseClaimTimestamp(options.now) ?? Date.now();
  return now - lastActivityAt >= ttlMs;
}

function claimTaskIsActive(claim = {}, options = {}) {
  const taskId = String(claim.taskId || "").trim();
  if (!taskId || typeof options.isTaskActive !== "function") return false;
  try {
    return options.isTaskActive(taskId) === true;
  } catch {
    // If the task registry cannot be inspected, keep the claim occupied. A
    // false negative here is safer than releasing a live transfer.
    return true;
  }
}

function claimIsOrphaned(claim = {}, options = {}) {
  const graceMs = Number(
    options.orphanClaimGraceMs ?? DEFAULT_WORK_DISTRIBUTION_ORPHAN_CLAIM_GRACE_MS
  );
  if (!Number.isFinite(graceMs) || graceMs <= 0) return false;
  if (!String(claim.taskId || "").trim() || claimTaskIsActive(claim, options)) return false;
  const lastActivityAt = parseClaimTimestamp(claim.heartbeatAt || claim.createdAt);
  if (lastActivityAt === null) return false;
  const now = parseClaimTimestamp(options.now) ?? Date.now();
  return now - lastActivityAt >= graceMs;
}

function archiveStaleWorkDistributionClaim(claimRoot, claimPath, now = Date.now()) {
  const archiveRoot = path.join(path.resolve(String(claimRoot || "")), "stale");
  fs.mkdirSync(archiveRoot, { recursive: true });
  const base = path.basename(claimPath, ".json");
  const stamp = new Date(now).toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const archivePath = path.join(
    archiveRoot,
    `${base}.${stamp}.${Math.random().toString(36).slice(2, 8)}.json`
  );
  try {
    fs.renameSync(claimPath, archivePath);
    return archivePath;
  } catch {
    return "";
  }
}

/**
 * Move claims that can no longer belong to a live task into the audit area.
 * Active tasks remain protected by the regular six-hour lease and heartbeat;
 * only claims whose task disappeared from the current process are subject to
 * the shorter orphan grace period.
 */
function pruneStaleWorkDistributionClaims(claimRoot, options = {}) {
  const root = path.resolve(String(claimRoot || ""));
  const now = parseClaimTimestamp(options.now) ?? Date.now();
  const result = { inspected: 0, archived: 0, active: 0, unreadable: 0, paths: [] };
  let names = [];
  try { names = fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".json")); } catch {
    return result;
  }
  names.forEach((name) => {
    result.inspected += 1;
    const claimPath = path.join(root, name);
    const claim = readJson(claimPath, null);
    if (!claim) {
      result.unreadable += 1;
      return;
    }
    if (claimTaskIsActive(claim, options)) {
      result.active += 1;
      return;
    }
    const stale = claimIsStale(claim, { ...options, now });
    const orphaned = claimIsOrphaned(claim, { ...options, now });
    if (!stale && !orphaned) return;
    const archivePath = archiveStaleWorkDistributionClaim(root, claimPath, now);
    if (!archivePath) return;
    result.archived += 1;
    result.paths.push(archivePath);
  });
  return result;
}

/**
 * Reserve every work before a transfer starts. A claim deliberately survives
 * an unknown/interrupted transfer; refusing a possible duplicate is safer
 * than sending the same material to another account.
 */
function acquireWorkDistributionClaims(claimRoot, works, detail = {}) {
  const entries = normalizeClaimWorks(works);
  if (!entries.length) {
    const error = new Error("作品包没有可锁定的作品，已停止发送");
    error.code = "WORK_DISTRIBUTION_WORKS_MISSING";
    throw error;
  }
  const ledger = readWorkDistributionLedger(detail.ledgerFile || "");
  const created = [];
  const claimTtlMs = Number(detail.claimTtlMs ?? DEFAULT_WORK_DISTRIBUTION_CLAIM_TTL_MS);
  const claimNow = parseClaimTimestamp(detail.now) ?? Date.now();
  fs.mkdirSync(claimRoot, { recursive: true });
  try {
    entries.forEach((entry) => {
      const previous = ledger.successes[entry.workId];
      if (previous) {
        const error = new Error(`作品已成功分发，禁止再次发送：${entry.name || entry.workId}`);
        error.code = "DUPLICATE_DISTRIBUTION_BLOCKED";
        error.workId = entry.workId;
        error.record = previous;
        throw error;
      }
      const claimPath = workDistributionClaimPath(claimRoot, entry.workId);
      let descriptor;
      for (let attempt = 0; attempt < 2 && !descriptor; attempt += 1) {
        try {
          descriptor = fs.openSync(claimPath, "wx");
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
          const existing = readJson(claimPath, {});
          const activeTask = typeof detail.isTaskActive === "function"
            && detail.isTaskActive(String(existing.taskId || ""));
          const canRecover = detail.allowStaleClaimRecovery === true
            && claimIsStale(existing, { now: claimNow, claimTtlMs })
            && !activeTask;
          if (!canRecover || attempt > 0 || !archiveStaleWorkDistributionClaim(claimRoot, claimPath, claimNow)) {
            const duplicate = new Error(`作品正在另一条发送链路中，禁止并发重复发送：${entry.name || entry.workId}`);
            duplicate.code = "DUPLICATE_DISTRIBUTION_IN_FLIGHT";
            duplicate.workId = entry.workId;
            duplicate.claim = existing;
            throw duplicate;
          }
        }
      }
      try {
        if (!descriptor) throw new Error("无法建立作品发送占用");
        const createdAt = new Date(claimNow).toISOString();
        const payload = {
          version: 1,
          workId: entry.workId,
          name: entry.name,
          collection: String(detail.collection || ""),
          deviceId: String(detail.deviceId || ""),
          device: String(detail.device || ""),
          taskId: String(detail.taskId || ""),
          state: "sending",
          createdAt,
          heartbeatAt: createdAt
        };
        fs.writeSync(descriptor, JSON.stringify(payload, null, 2), null, "utf8");
        fs.fsyncSync(descriptor);
        created.push(claimPath);
      } finally {
        fs.closeSync(descriptor);
      }
    });
  } catch (error) {
    created.forEach((claimPath) => {
      try { fs.unlinkSync(claimPath); } catch { /* keep any external claim */ }
    });
    throw error;
  }
  return { claimRoot: path.resolve(claimRoot), workIds: entries.map((entry) => entry.workId), paths: created };
}

function touchWorkDistributionClaims(claimRoot, worksOrIds, detail = {}) {
  const ids = (Array.isArray(worksOrIds) ? worksOrIds : [])
    .map((entry) => typeof entry === "string" ? entry : entry?.workId)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const heartbeatAt = new Date(parseClaimTimestamp(detail.now) ?? Date.now()).toISOString();
  let touched = 0;
  ids.forEach((workId) => {
    const claimPath = workDistributionClaimPath(claimRoot, workId);
    const claim = readJson(claimPath, null);
    if (!claim || (detail.taskId && claim.taskId && String(claim.taskId) !== String(detail.taskId))) return;
    claim.heartbeatAt = heartbeatAt;
    writeJsonAtomic(claimPath, claim);
    touched += 1;
  });
  return { touched, workIds: ids };
}

function releaseWorkDistributionClaims(claimRoot, worksOrIds, detail = {}) {
  const ids = (Array.isArray(worksOrIds) ? worksOrIds : [])
    .map((entry) => typeof entry === "string" ? entry : entry?.workId)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  let released = 0;
  ids.forEach((workId) => {
    const claimPath = workDistributionClaimPath(claimRoot, workId);
    try {
      const claim = readJson(claimPath, {});
      if (detail.taskId && claim.taskId && String(claim.taskId) !== String(detail.taskId)) return;
      fs.unlinkSync(claimPath);
      released += 1;
    } catch {
      // Missing claims are already released; unreadable claims remain blocked.
    }
  });
  return { released, workIds: ids };
}

function readWorkDistributionClaimNames(claimRoot, options = {}) {
  try {
    return new Set(fs.readdirSync(path.resolve(String(claimRoot || "")))
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .filter((name) => {
        const claim = readJson(path.join(path.resolve(String(claimRoot || "")), name), null);
        if (!claim) return true;
        return !claimIsStale(claim, options) && !claimIsOrphaned(claim, options);
      }));
  } catch {
    return new Set();
  }
}

function hasWorkDistributionClaim(claimRoot, workId, claimNames = null, options = {}) {
  try {
    if (claimNames instanceof Set) {
      return claimNames.has(path.basename(workDistributionClaimPath(claimRoot, workId)));
    }
    const claim = readJson(workDistributionClaimPath(claimRoot, workId), null);
    return Boolean(claim && !claimIsStale(claim, options));
  } catch {
    // An unreadable claim path is treated as occupied by the caller's safety
    // boundary; refusing is safer than guessing that a duplicate is free.
    return true;
  }
}

function rebasePathWithinRoot(value, fromRoot, toRoot) {
  const original = String(value || "").trim();
  if (!original || !fromRoot || !toRoot) return original;
  const absoluteOriginal = path.resolve(original);
  const absoluteFromRoot = path.resolve(String(fromRoot));
  const relative = path.relative(absoluteFromRoot, absoluteOriginal);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return original;
  }
  return path.join(path.resolve(String(toRoot)), relative);
}

/**
 * A successful phone transfer moves the managed collection after receiver
 * commit. Rebase the current ledger paths to the new stage while retaining
 * the original path for diagnostics and recovery.
 */
function rebaseSuccessfulWorkDistributionPaths(file, options = {}) {
  const fromRoot = String(options.fromRoot || "").trim();
  const toRoot = String(options.toRoot || "").trim();
  const collection = String(options.collection || "").trim();
  if (!fromRoot || !toRoot) return { updatedCount: 0, collection };
  const ledger = readWorkDistributionLedger(file);
  const now = String(options.updatedAt || new Date().toISOString());
  let updatedCount = 0;
  Object.values(ledger.successes).forEach((record) => {
    if (collection && String(record.collection || "") !== collection) return;
    const currentPath = String(record.path || "");
    const rebasedPath = rebasePathWithinRoot(currentPath, fromRoot, toRoot);
    if (!rebasedPath || rebasedPath === currentPath) return;
    const history = Array.isArray(record.pathHistory) ? record.pathHistory.slice() : [];
    if (!history.includes(currentPath)) history.push(currentPath);
    record.path = rebasedPath;
    record.pathHistory = history;
    record.lastPathUpdateAt = now;
    record.lastPathUpdateReason = String(options.reason || "managed_collection_stage_move");
    updatedCount += 1;
  });
  if (updatedCount) {
    ledger.updatedAt = now;
    writeJsonAtomic(file, ledger);
  }
  return { updatedCount, collection, fromRoot: path.resolve(fromRoot), toRoot: path.resolve(toRoot) };
}

function workDistributionEligibility(ledger, workId) {
  const success = ledger?.successes?.[String(workId || "")] || null;
  return {
    automaticEligible: !success,
    manualResendRequiresConfirmation: Boolean(success),
    duplicateBlocked: Boolean(success),
    firstDistribution: success ? {
      distributedAt: success.firstDistributedAt,
      deviceId: success.firstDeviceId,
      device: success.firstDevice
    } : null
  };
}

module.exports = {
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
};
