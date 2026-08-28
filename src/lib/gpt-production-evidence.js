const PRODUCTION_STEPS = Object.freeze({
  SESSION_INIT: "session-init",
  TEMPLATE_LEARNING: "template-learning",
  SESSION_READY: "session-ready",
  MATERIAL_UPLOADED: "material-uploaded",
  PLAN_READY: "plan-ready",
  CONFIRM_SENT: "confirm-sent",
  IMAGES_GENERATING: "images-generating",
  IMAGES_READY: "images-ready",
  COPY_REQUESTED: "copy-requested",
  COPY_READY: "copy-ready",
  DOWNLOADED: "downloaded",
  PACKAGED: "packaged",
  ARCHIVED: "archived"
});

const STEP_ORDER = Object.freeze([
  PRODUCTION_STEPS.SESSION_INIT,
  PRODUCTION_STEPS.TEMPLATE_LEARNING,
  PRODUCTION_STEPS.SESSION_READY,
  PRODUCTION_STEPS.MATERIAL_UPLOADED,
  PRODUCTION_STEPS.PLAN_READY,
  PRODUCTION_STEPS.CONFIRM_SENT,
  PRODUCTION_STEPS.IMAGES_GENERATING,
  PRODUCTION_STEPS.IMAGES_READY,
  PRODUCTION_STEPS.COPY_REQUESTED,
  PRODUCTION_STEPS.COPY_READY,
  PRODUCTION_STEPS.DOWNLOADED,
  PRODUCTION_STEPS.PACKAGED,
  PRODUCTION_STEPS.ARCHIVED
]);

const STEP_INDEX = new Map(STEP_ORDER.map((step, index) => [step, index]));
const IDENTITY_FIELDS = ["accountId", "browserId", "taskId", "conversationUrl", "templateId"];
const CONFIDENCE_STATES = new Set(["HIGH_CONFIDENCE", "MEDIUM_CONFIDENCE", "LOW_CONFIDENCE", "STATE_CONFLICT"]);

function normalizeDetectedState(value) {
  if (!value || typeof value !== "object") return null;
  const step = String(value.step || "").trim();
  if (!STEP_INDEX.has(step)) return null;
  return {
    step,
    visibility: value.visibility === "unavailable" ? "unavailable" : "visible",
    observedAt: String(value.observedAt || "").slice(0, 40),
    confidence: CONFIDENCE_STATES.has(String(value.confidence || "")) ? String(value.confidence) : "",
    signals: Array.isArray(value.signals)
      ? value.signals.map((item) => String(item || "").slice(0, 120)).filter(Boolean).slice(0, 32)
      : [],
    summary: String(value.summary || "").slice(0, 500)
  };
}

function normalizeEvidenceSnapshot(value = {}) {
  const currentStep = STEP_INDEX.has(String(value.currentStep || "")) ? String(value.currentStep) : "";
  const lastCompletedStep = STEP_INDEX.has(String(value.lastCompletedStep || "")) ? String(value.lastCompletedStep) : "";
  const evidenceHistory = (Array.isArray(value.evidenceHistory) ? value.evidenceHistory : []).slice(-64).map((item) => ({
    source: ["page", "checkpoint", "log", "archive", "filesystem"].includes(String(item?.source || ""))
      ? String(item.source)
      : "unknown",
    step: STEP_INDEX.has(String(item?.step || "")) ? String(item.step) : "",
    visibility: item?.visibility === "unavailable" ? "unavailable" : "visible",
    observedAt: String(item?.observedAt || "").slice(0, 40),
    confidence: CONFIDENCE_STATES.has(String(item?.confidence || "")) ? String(item.confidence) : "",
    summary: String(item?.summary || "").slice(0, 500)
  })).filter((item) => item.step);
  return {
    currentStep,
    lastCompletedStep,
    pageDetectedState: normalizeDetectedState(value.pageDetectedState),
    checkpointDetectedState: normalizeDetectedState(value.checkpointDetectedState),
    logDetectedState: normalizeDetectedState(value.logDetectedState),
    stateConfidence: CONFIDENCE_STATES.has(String(value.stateConfidence || ""))
      ? String(value.stateConfidence)
      : "LOW_CONFIDENCE",
    stateConflictReason: String(value.stateConflictReason || "").slice(0, 500),
    lastSafeAction: String(value.lastSafeAction || "").slice(0, 80),
    evidenceHistory
  };
}

function cleanEvidence(items = []) {
  const bySource = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const source = String(item?.source || "").trim();
    const step = String(item?.step || "").trim();
    if (!source || !STEP_INDEX.has(step)) continue;
    const previous = bySource.get(source);
    const observedAt = Date.parse(String(item?.observedAt || "")) || 0;
    const previousAt = Date.parse(String(previous?.observedAt || "")) || 0;
    if (!previous || observedAt >= previousAt) bySource.set(source, { ...item, source, step });
  }
  return [...bySource.values()];
}

function identityConflict(items) {
  for (const field of IDENTITY_FIELDS) {
    const values = new Set(items.map((item) => String(item?.identity?.[field] || "").trim()).filter(Boolean));
    if (values.size > 1) return field;
  }
  return "";
}

function stepGroups(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.step)) groups.set(item.step, []);
    groups.get(item.step).push(item);
  }
  return groups;
}

function evaluateProductionEvidence(items = [], options = {}) {
  const evidence = cleanEvidence(items);
  if (!evidence.length) {
    return {
      state: "LOW_CONFIDENCE",
      resolvedStep: null,
      rollbackPrevented: false,
      reason: "no-valid-evidence",
      evidence: [],
      productionMode: String(options.productionMode || "single")
    };
  }

  const conflictingField = identityConflict(evidence);
  if (conflictingField) {
    return {
      state: "STATE_CONFLICT",
      resolvedStep: null,
      rollbackPrevented: false,
      reason: `identity-conflict:${conflictingField}`,
      evidence,
      productionMode: String(options.productionMode || "single")
    };
  }

  const groups = stepGroups(evidence);
  const corroborated = [...groups.entries()]
    .filter(([, group]) => new Set(group.map((item) => item.source)).size >= 2)
    .sort((left, right) => STEP_INDEX.get(right[0]) - STEP_INDEX.get(left[0]));
  const durable = evidence
    .filter((item) => item.durable === true || item.source === "checkpoint" || item.source === "log")
    .sort((left, right) => STEP_INDEX.get(right.step) - STEP_INDEX.get(left.step));

  if (corroborated.length) {
    const resolvedStep = corroborated[0][0];
    const pageStep = evidence.find((item) => item.source === "page")?.step;
    return {
      state: "HIGH_CONFIDENCE",
      resolvedStep,
      rollbackPrevented: Boolean(pageStep && STEP_INDEX.get(pageStep) < STEP_INDEX.get(resolvedStep)),
      reason: "corroborated",
      evidence,
      productionMode: String(options.productionMode || "single")
    };
  }

  if (evidence.length === 1) {
    return {
      state: "LOW_CONFIDENCE",
      resolvedStep: evidence[0].step,
      rollbackPrevented: false,
      reason: "single-source",
      evidence,
      productionMode: String(options.productionMode || "single")
    };
  }

  const highestDurable = durable[0]?.step || null;
  return {
    state: "STATE_CONFLICT",
    resolvedStep: highestDurable,
    rollbackPrevented: Boolean(highestDurable),
    reason: "stage-conflict",
    evidence,
    productionMode: String(options.productionMode || "single")
  };
}

function nextSafeAction(result = {}) {
  if (result.state !== "HIGH_CONFIDENCE") return null;
  return ({
    [PRODUCTION_STEPS.SESSION_INIT]: "learn-template",
    [PRODUCTION_STEPS.TEMPLATE_LEARNING]: "inspect-template-learning",
    [PRODUCTION_STEPS.SESSION_READY]: "upload-material",
    [PRODUCTION_STEPS.MATERIAL_UPLOADED]: "inspect-plan",
    [PRODUCTION_STEPS.PLAN_READY]: "send-confirm",
    [PRODUCTION_STEPS.CONFIRM_SENT]: "inspect-images",
    [PRODUCTION_STEPS.IMAGES_GENERATING]: "inspect-images",
    [PRODUCTION_STEPS.IMAGES_READY]: "request-copy",
    [PRODUCTION_STEPS.COPY_REQUESTED]: "inspect-copy",
    [PRODUCTION_STEPS.COPY_READY]: "download-and-package",
    [PRODUCTION_STEPS.DOWNLOADED]: "package",
    [PRODUCTION_STEPS.PACKAGED]: "archive",
    [PRODUCTION_STEPS.ARCHIVED]: "advance-queue"
  })[result.resolvedStep] || null;
}

module.exports = {
  PRODUCTION_STEPS,
  STEP_ORDER,
  evaluateProductionEvidence,
  nextSafeAction,
  normalizeEvidenceSnapshot
};
