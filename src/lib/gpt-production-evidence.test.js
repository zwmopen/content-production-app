const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PRODUCTION_STEPS,
  evaluateProductionEvidence,
  nextSafeAction,
  normalizeEvidenceSnapshot
} = require("./gpt-production-evidence");

function evidence(source, step, extra = {}) {
  return {
    source,
    step,
    observedAt: "2026-08-25T03:20:00.000Z",
    identity: {
      accountId: "account-4",
      browserId: "browser-1",
      taskId: "task-1",
      conversationUrl: "https://chatgpt.com/c/conversation-1"
    },
    ...extra
  };
}

test("three matching sources produce high confidence and one forward action", () => {
  const result = evaluateProductionEvidence([
    evidence("page", PRODUCTION_STEPS.PLAN_READY),
    evidence("checkpoint", PRODUCTION_STEPS.PLAN_READY),
    evidence("log", PRODUCTION_STEPS.PLAN_READY)
  ]);

  assert.equal(result.state, "HIGH_CONFIDENCE");
  assert.equal(result.resolvedStep, PRODUCTION_STEPS.PLAN_READY);
  assert.equal(nextSafeAction(result), "send-confirm");
});

test("durable copy completion prevents a stale page from rolling back to images", () => {
  const result = evaluateProductionEvidence([
    evidence("page", PRODUCTION_STEPS.IMAGES_READY),
    evidence("checkpoint", PRODUCTION_STEPS.COPY_READY, { durable: true }),
    evidence("log", PRODUCTION_STEPS.COPY_READY, { durable: true })
  ]);

  assert.equal(result.state, "HIGH_CONFIDENCE");
  assert.equal(result.resolvedStep, PRODUCTION_STEPS.COPY_READY);
  assert.equal(result.rollbackPrevented, true);
  assert.equal(nextSafeAction(result), "download-and-package");
});

test("identity mismatch is a state conflict and forbids every mutating action", () => {
  const otherTask = evidence("page", PRODUCTION_STEPS.PLAN_READY);
  otherTask.identity.taskId = "task-other";
  const result = evaluateProductionEvidence([
    otherTask,
    evidence("checkpoint", PRODUCTION_STEPS.MATERIAL_UPLOADED),
    evidence("log", PRODUCTION_STEPS.MATERIAL_UPLOADED)
  ]);

  assert.equal(result.state, "STATE_CONFLICT");
  assert.equal(nextSafeAction(result), null);
  assert.match(result.reason, /identity/i);
});

test("one visible source without durable corroboration remains low confidence", () => {
  const result = evaluateProductionEvidence([
    evidence("page", PRODUCTION_STEPS.IMAGES_READY)
  ]);

  assert.equal(result.state, "LOW_CONFIDENCE");
  assert.equal(nextSafeAction(result), null);
});

test("archive evidence is terminal even when the page becomes unavailable", () => {
  const result = evaluateProductionEvidence([
    evidence("checkpoint", PRODUCTION_STEPS.ARCHIVED, { durable: true }),
    evidence("log", PRODUCTION_STEPS.ARCHIVED, { durable: true })
  ]);

  assert.equal(result.state, "HIGH_CONFIDENCE");
  assert.equal(result.resolvedStep, PRODUCTION_STEPS.ARCHIVED);
  assert.equal(nextSafeAction(result), "advance-queue");
});

test("fresh-session mode exposes template learning before material upload", () => {
  assert.ok(PRODUCTION_STEPS.TEMPLATE_LEARNING);
  assert.ok(PRODUCTION_STEPS.SESSION_READY);
  const result = evaluateProductionEvidence([
    evidence("page", PRODUCTION_STEPS.SESSION_READY),
    evidence("checkpoint", PRODUCTION_STEPS.SESSION_READY, { durable: true })
  ], { productionMode: "fresh-session-fixed-template" });

  assert.equal(result.state, "HIGH_CONFIDENCE");
  assert.equal(nextSafeAction(result), "upload-material");
});

test("checkpoint evidence snapshot keeps visible and unavailable observations with bounded history", () => {
  const snapshot = normalizeEvidenceSnapshot({
    currentStep: PRODUCTION_STEPS.COPY_READY,
    lastCompletedStep: PRODUCTION_STEPS.COPY_READY,
    stateConfidence: "HIGH_CONFIDENCE",
    stateConflictReason: "",
    lastSafeAction: "download-and-package",
    pageDetectedState: {
      step: PRODUCTION_STEPS.COPY_READY,
      visibility: "visible",
      observedAt: "2026-08-25T03:20:00.000Z",
      signals: ["assistant-copy", "copy-button"]
    },
    evidenceHistory: Array.from({ length: 80 }, (_, index) => ({
      source: "page",
      step: index % 2 ? PRODUCTION_STEPS.COPY_READY : PRODUCTION_STEPS.IMAGES_READY,
      visibility: index % 2 ? "visible" : "unavailable",
      observedAt: new Date(1787628000000 + index * 1000).toISOString(),
      summary: `observation-${index}`
    }))
  });

  assert.equal(snapshot.currentStep, PRODUCTION_STEPS.COPY_READY);
  assert.equal(snapshot.pageDetectedState.visibility, "visible");
  assert.deepEqual(snapshot.pageDetectedState.signals, ["assistant-copy", "copy-button"]);
  assert.equal(snapshot.evidenceHistory.length, 64);
  assert.equal(snapshot.evidenceHistory[0].summary, "observation-16");
});
