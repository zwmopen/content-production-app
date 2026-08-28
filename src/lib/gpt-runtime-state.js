const fs = require("fs");
const path = require("path");

const RUNTIME_STATE_VERSION = 3;
const MAX_QUEUE_TASKS = 500;
const MAX_CONTROL_ACCOUNTS = 20;
const MAX_CONTROL_DEPTH = 8;
const MAX_CONTROL_STRING = 100_000;
const BLOCKED_CONTROL_KEY = /(?:password|passwd|secret|token|cookie|authorization|credential)/i;
const RUNTIME_RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RUNTIME_RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400];
const runtimeWriteQueues = new Map();

function waitForRuntimeRenameRetry(delayMs) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, delayMs);
}

function replaceRuntimeStateFile(temporary, file) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(temporary, file);
      return;
    } catch (error) {
      const delayMs = RUNTIME_RENAME_RETRY_DELAYS_MS[attempt];
      if (!RUNTIME_RENAME_RETRY_CODES.has(error?.code) || delayMs === undefined) throw error;
      waitForRuntimeRenameRetry(delayMs);
    }
  }
}

async function replaceRuntimeStateFileAsync(temporary, file) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.promises.rename(temporary, file);
      return;
    } catch (error) {
      const delayMs = RUNTIME_RENAME_RETRY_DELAYS_MS[attempt];
      if (!RUNTIME_RENAME_RETRY_CODES.has(error?.code) || delayMs === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function normalizePlainValue(value, depth = 0) {
  if (depth > MAX_CONTROL_DEPTH || value === undefined || typeof value === "function") return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return value.slice(0, MAX_CONTROL_STRING);
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((item) => normalizePlainValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const normalized = {};
  Object.entries(value).slice(0, 500).forEach(([key, item]) => {
    if (!/^[A-Za-z0-9_\-]+$/.test(key) || BLOCKED_CONTROL_KEY.test(key)) return;
    const safe = normalizePlainValue(item, depth + 1);
    if (safe !== undefined) normalized[key] = safe;
  });
  return normalized;
}

function normalizeRuntimeControl(control) {
  if (!control || typeof control !== "object") return null;
  const settings = normalizePlainValue(control.settings) || {};
  const modeProfiles = normalizePlainValue(control.modeProfiles) || {};
  const multiRun = normalizePlainValue(control.multiRun) || null;
  const windowRuntimeEntries = Object.entries(control.windowRuntime || {}).slice(0, MAX_CONTROL_ACCOUNTS);
  const windowRuntime = Object.fromEntries(windowRuntimeEntries.map(([accountId, runtime]) => [
    String(accountId).slice(0, 80),
    normalizePlainValue(runtime) || {}
  ]));
  return {
    armed: control.armed === true,
    settings,
    modeProfiles,
    multiRun,
    windowRuntime
  };
}

function validIso(value, fallback) {
  const text = String(value || "").trim();
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : fallback;
}

function normalizeQueue(queue) {
  if (!queue || typeof queue !== "object" || !Array.isArray(queue.tasks) || !queue.tasks.length) return null;
  const tasks = queue.tasks.slice(0, MAX_QUEUE_TASKS);
  return {
    version: RUNTIME_STATE_VERSION,
    index: Math.max(0, Math.min(tasks.length, Number(queue.index || 0))),
    paused: Boolean(queue.paused),
    running: Boolean(queue.running),
    mode: String(queue.mode || "").slice(0, 40),
    activeAccountId: String(queue.activeAccountId || "").slice(0, 80),
    tasks
  };
}

function normalizeRuntimeState(input = {}, now = new Date().toISOString()) {
  const updatedAt = validIso(input.updatedAt || input.savedAt, now);
  return {
    version: RUNTIME_STATE_VERSION,
    revision: Math.max(0, Number(input.revision || 0)),
    updatedAt,
    queue: normalizeQueue(input.queue),
    control: normalizeRuntimeControl(input.control)
  };
}

function runtimeEntryUpdatedAt(entry) {
  const numeric = Number(entry?.updatedAt || 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return Date.parse(String(entry?.updatedAt || "")) || 0;
}

function runtimeEntryStageEvidenceAt(entry) {
  const currentSetStartedAt = Number(entry?.currentSetStartedAt || 0);
  const stageStartedAt = Date.parse(String(entry?.stageStartedAt || "")) || 0;
  const lastProgressAt = Date.parse(String(entry?.lastProgressAt || "")) || 0;
  return Math.max(
    Number.isFinite(currentSetStartedAt) ? currentSetStartedAt : 0,
    stageStartedAt,
    lastProgressAt
  );
}

function mergeWindowRuntime(current = {}, incoming = {}) {
  const merged = {};
  for (const accountId of new Set([...Object.keys(current || {}), ...Object.keys(incoming || {})])) {
    const currentEntry = current?.[accountId];
    const incomingEntry = incoming?.[accountId];
    if (!currentEntry) {
      merged[accountId] = incomingEntry;
      continue;
    }
    if (!incomingEntry) {
      merged[accountId] = currentEntry;
      continue;
    }
    // A second renderer can still flush an older checkpoint after the
    // authoritative worker has completed a package. Never downgrade that
    // completed boundary back to retry/failed/paused for the same old task;
    // only a clearly newer task may replace it. Without this guard the API
    // and the visible workbench alternated between “已完成” and “恢复中”.
    if (String(currentEntry.status || "") === "completed"
      && String(incomingEntry.status || "") !== "completed") {
      const currentTaskId = String(currentEntry.currentTaskId || "");
      const incomingTaskId = String(incomingEntry.currentTaskId || "");
      const incomingStartedAt = Number(incomingEntry.currentSetStartedAt || 0);
      const currentUpdatedAt = runtimeEntryUpdatedAt(currentEntry);
      const incomingStageEvidenceAt = runtimeEntryStageEvidenceAt(incomingEntry);
      const clearlyNewTask = Boolean(
        incomingTaskId
        && incomingTaskId !== currentTaskId
        && (incomingStartedAt > currentUpdatedAt || incomingStageEvidenceAt > currentUpdatedAt)
      );
      if (!clearlyNewTask) {
        merged[accountId] = currentEntry;
        continue;
      }
    }
    merged[accountId] = runtimeEntryUpdatedAt(incomingEntry) >= runtimeEntryUpdatedAt(currentEntry)
      ? incomingEntry
      : currentEntry;
  }
  return merged;
}

function mergeRuntimeInput(current, input, now) {
  const incoming = normalizeRuntimeState(input, now);
  if (!input || typeof input !== "object" || !Object.prototype.hasOwnProperty.call(input, "control")) {
    return incoming;
  }
  const existing = normalizeRuntimeState(current || {}, now);
  if (!existing.control || !incoming.control) return incoming;
  incoming.control = {
    ...incoming.control,
    windowRuntime: mergeWindowRuntime(existing.control.windowRuntime, incoming.control.windowRuntime)
  };
  return incoming;
}

function readRuntimeState(file) {
  try {
    return normalizeRuntimeState(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return normalizeRuntimeState({ updatedAt: "1970-01-01T00:00:00.000Z" }, "1970-01-01T00:00:00.000Z");
  }
}

function writeRuntimeState(file, input = {}, now = new Date().toISOString()) {
  const current = readRuntimeState(file);
  const next = mergeRuntimeInput(current, input, now);
  next.revision = Math.max(current.revision + 1, next.revision);
  next.updatedAt = validIso(now, new Date().toISOString());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), "utf8");
  replaceRuntimeStateFile(temporary, file);
  return next;
}

async function readRuntimeStateAsync(file) {
  try {
    const contents = await fs.promises.readFile(file, "utf8");
    return normalizeRuntimeState(JSON.parse(contents));
  } catch {
    return normalizeRuntimeState({ updatedAt: "1970-01-01T00:00:00.000Z" }, "1970-01-01T00:00:00.000Z");
  }
}

function writeRuntimeStateAsync(file, input = {}, now = new Date().toISOString()) {
  const previous = runtimeWriteQueues.get(file) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    const current = await readRuntimeStateAsync(file);
    const next = mergeRuntimeInput(current, input, now);
    next.revision = Math.max(current.revision + 1, next.revision);
    next.updatedAt = validIso(now, new Date().toISOString());
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
      await replaceRuntimeStateFileAsync(temporary, file);
    } finally {
      await fs.promises.unlink(temporary).catch(() => {});
    }
    return next;
  });
  runtimeWriteQueues.set(file, write);
  write.finally(() => {
    if (runtimeWriteQueues.get(file) === write) runtimeWriteQueues.delete(file);
  }).catch(() => {});
  return write;
}

function newerRuntimeState(left, right) {
  const leftState = normalizeRuntimeState(left || {});
  const rightState = normalizeRuntimeState(right || {});
  const leftTime = Date.parse(leftState.updatedAt) || 0;
  const rightTime = Date.parse(rightState.updatedAt) || 0;
  if (leftTime !== rightTime) return leftTime > rightTime ? leftState : rightState;
  return leftState.revision >= rightState.revision ? leftState : rightState;
}

module.exports = {
  RUNTIME_STATE_VERSION,
  normalizeRuntimeControl,
  normalizeRuntimeState,
  newerRuntimeState,
  readRuntimeState,
  readRuntimeStateAsync,
  writeRuntimeState,
  writeRuntimeStateAsync
};
