const DEFAULT_WINDOW_HOURS = 3;
const DEFAULT_UPLOAD_LIMIT = 80;
const DEFAULT_GENERATION_LIMIT = 50;

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function normalizeQuotaSettings(value = {}) {
  return {
    enabled: value.enabled !== false,
    windowHours: clampInteger(value.windowHours, DEFAULT_WINDOW_HOURS, 1, 24),
    uploadLimit: clampInteger(value.uploadLimit, DEFAULT_UPLOAD_LIMIT, 1, 1000),
    generationLimit: clampInteger(value.generationLimit, DEFAULT_GENERATION_LIMIT, 1, 1000)
  };
}

function normalizeQuotaLedger(value = {}) {
  const accounts = value && typeof value.accounts === "object" ? value.accounts : {};
  return {
    version: 1,
    updatedAt: String(value.updatedAt || ""),
    accounts: Object.fromEntries(Object.entries(accounts).map(([accountId, account]) => [
      accountId,
      {
        settings: normalizeQuotaSettings(account?.settings),
        events: Array.isArray(account?.events)
          ? account.events.map((event) => ({
            kind: event?.kind === "generated" ? "generated" : "uploaded",
            count: clampInteger(event?.count, 0, 0, 1000),
            recordedAt: String(event?.recordedAt || ""),
            requestId: String(event?.requestId || "")
          })).filter((event) => event.count > 0 && Number.isFinite(Date.parse(event.recordedAt)))
          : []
      }
    ]))
  };
}

function dedupeQuotaEvents(events = []) {
  const result = [];
  const keyedIndexes = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const requestId = String(event?.requestId || "").trim();
    const key = requestId ? `${event.kind}\u0000${requestId}` : "";
    if (!key) {
      result.push(event);
      continue;
    }
    const existingIndex = keyedIndexes.get(key);
    if (existingIndex === undefined) {
      keyedIndexes.set(key, result.length);
      result.push(event);
      continue;
    }
    // A retry may report the same request more than once. Keep one event,
    // retaining the largest observed count and the first timestamp so a
    // retry cannot consume the rolling window multiple times or extend it.
    const existing = result[existingIndex];
    if (Number(event.count || 0) > Number(existing.count || 0)) {
      result[existingIndex] = { ...existing, count: event.count };
    }
  }
  return result;
}

function rollingQuotaStatus(account = {}, now = Date.now()) {
  const settings = normalizeQuotaSettings(account.settings);
  const windowMs = settings.windowHours * 60 * 60 * 1000;
  const events = (Array.isArray(account.events) ? account.events : [])
    .filter((event) => Number.isFinite(Date.parse(event.recordedAt))
      && now - Date.parse(event.recordedAt) < windowMs
      && now >= Date.parse(event.recordedAt));
  const effectiveEvents = dedupeQuotaEvents(events);
  const uploaded = effectiveEvents.filter((event) => event.kind === "uploaded")
    .reduce((sum, event) => sum + Math.max(0, Number(event.count || 0)), 0);
  const generated = effectiveEvents.filter((event) => event.kind === "generated")
    .reduce((sum, event) => sum + Math.max(0, Number(event.count || 0)), 0);
  const nextExpiryAt = effectiveEvents.length
    ? new Date(Math.min(...effectiveEvents.map((event) => Date.parse(event.recordedAt) + windowMs))).toISOString()
    : "";
  return {
    settings,
    uploaded,
    generated,
    remainingUploads: Math.max(0, settings.uploadLimit - uploaded),
    remainingGenerations: Math.max(0, settings.generationLimit - generated),
    nextExpiryAt,
    events: effectiveEvents
  };
}

function recordQuotaEvent(ledgerInput = {}, accountId, eventInput = {}, now = Date.now()) {
  const id = String(accountId || "").trim();
  if (!id) throw new Error("GPT 账号标识不能为空");
  const ledger = normalizeQuotaLedger(ledgerInput);
  const account = ledger.accounts[id] || { settings: normalizeQuotaSettings(), events: [] };
  const kind = eventInput.kind === "generated" ? "generated" : "uploaded";
  const count = clampInteger(eventInput.count, 0, 0, 1000);
  if (!count) return ledger;
  const status = rollingQuotaStatus(account, now);
  const requestId = String(eventInput.requestId || "").trim();
  const existingIndex = requestId
    ? status.events.findIndex((event) => event.kind === kind && String(event.requestId || "").trim() === requestId)
    : -1;
  if (existingIndex >= 0) {
    const existing = status.events[existingIndex];
    if (count <= Number(existing.count || 0)) return ledger;
    const events = status.events.slice();
    events[existingIndex] = { ...existing, count };
    ledger.accounts[id] = { settings: status.settings, events };
    ledger.updatedAt = new Date(now).toISOString();
    return ledger;
  }
  ledger.accounts[id] = {
    settings: status.settings,
    events: [...status.events, {
      kind,
      count,
      recordedAt: new Date(now).toISOString(),
      requestId
    }].slice(-3000)
  };
  ledger.updatedAt = new Date(now).toISOString();
  return ledger;
}

function combinationCount(materialCount, templateCount) {
  const materials = Math.max(0, Number(materialCount || 0));
  const templates = Math.max(0, Number(templateCount || 0));
  return materials * Math.max(1, templates);
}

function fitWholeTasks(tasks = [], quota = {}) {
  const remainingUploads = Math.max(0, Number(quota.remainingUploads ?? Infinity));
  const remainingGenerations = Math.max(0, Number(quota.remainingGenerations ?? Infinity));
  let uploads = 0;
  let generations = 0;
  const runnable = [];
  const waiting = [];
  for (const task of tasks) {
    const taskUploads = Math.max(0, Number(task.uploadImages || 0));
    const taskGenerations = Math.max(0, Number(task.expectedGeneratedImages || 0));
    if (uploads + taskUploads <= remainingUploads
      && generations + taskGenerations <= remainingGenerations) {
      runnable.push(task);
      uploads += taskUploads;
      generations += taskGenerations;
    } else {
      waiting.push(task);
    }
  }
  return { runnable, waiting, uploads, generations };
}

module.exports = {
  combinationCount,
  fitWholeTasks,
  normalizeQuotaLedger,
  normalizeQuotaSettings,
  recordQuotaEvent,
  rollingQuotaStatus
};
