const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const contract = require("./cdp-pipeline-contract");

const revision = `sha256:${"c".repeat(64)}`;
function dispatch(overrides = {}) {
  return {
    requestId: "cdp-fixed-001",
    templateSelectionMode: "3_fixed_template",
    pipelineConfigMode: "3_fixed_template",
    pipelineConfigRevision: revision,
    pipelineConfigTemplateId: "T-77",
    templateId: "T-77",
    pipelineTemplateReferences: [
      { role: "P1", path: "D:\\templates\\T-77\\P1.png", sha256: "a".repeat(64), bytes: 123 },
      { role: "P2", path: "D:\\templates\\T-77\\P2.png", sha256: "b".repeat(64), bytes: 456 }
    ],
    ...overrides
  };
}

function validProof(overrides = {}) {
  return {
    source: "tb-gpt-production-extension",
    type: "tb-workbench-pipeline-receipt-ready",
    status: "REFERENCES_CONSUMED",
    requestId: "cdp-fixed-001",
    templateSelectionMode: "3_fixed_template",
    pipelineConfigMode: "3_fixed_template",
    pipelineConfigRevision: revision,
    pipelineConfigTemplateId: "T-77",
    nativeFileBytesVerified: true,
    composerPreviewVerified: true,
    references: [
      { role: "P1", fileName: "P1.png", sha256: "a".repeat(64), bytes: 123 },
      { role: "P2", fileName: "P2.png", sha256: "b".repeat(64), bytes: 456 }
    ],
    composerAttachmentNames: ["P1.png", "P2.png"],
    ...overrides
  };
}

test("canonical CDP mode 3 maps to the explicit fixed-template worker and keeps P1/P2 references", () => {
  const mapped = contract.validatePipelineDispatch(dispatch());
  assert.equal(mapped.enabled, true);
  assert.equal(mapped.templateSelectionMode, "3_fixed_template");
  assert.equal(mapped.pipelineConfigMode, "3_fixed_template");
  assert.equal(mapped.pipelineConfigRevision, revision);
  assert.equal(mapped.pipelineConfigTemplateId, "T-77");
  assert.equal(mapped.workerWorkflowVariant, "fresh-session-fixed-template");
  assert.deepEqual(mapped.references.map((item) => item.role), ["P1", "P2"]);
});

test("mode 1/2, missing fields and inconsistent modes fail closed instead of using legacy defaults", () => {
  for (const unsupported of ["1_replica_shuffle", "2_random_template"]) {
    assert.throws(() => contract.validatePipelineDispatch(dispatch({
      templateSelectionMode: unsupported,
      pipelineConfigMode: unsupported
    })), { code: "PIPELINE_MODE_UNSUPPORTED" });
  }
  assert.throws(() => contract.validatePipelineDispatch(dispatch({ pipelineConfigRevision: "" })),
    { code: "PIPELINE_CONFIG_INCOMPLETE" });
  assert.throws(() => contract.validatePipelineDispatch(dispatch({ pipelineConfigRevision: "stale-revision" })),
    { code: "PIPELINE_CONFIG_INCOMPLETE" });
  assert.throws(() => contract.validatePipelineDispatch(dispatch({ pipelineConfigMode: "2_random_template" })),
    { code: "PIPELINE_MODE_MISMATCH" });
  assert.throws(() => contract.validatePipelineDispatch(dispatch({ pipelineTemplateReferences: [{ role: "P1" }] })),
    { code: "PIPELINE_TEMPLATE_REFERENCES_MISSING" });
});

test("fixed-template proof must match the exact request revision, attachment bytes, and both previews", () => {
  const mapped = contract.validatePipelineDispatch(dispatch());
  assert.equal(contract.validateWorkerConsumptionProof(mapped, validProof()), true);
  assert.throws(() => contract.validateWorkerConsumptionProof(mapped, validProof({
    pipelineConfigRevision: `sha256:${"d".repeat(64)}`
  })), { code: "PIPELINE_REFERENCE_RECEIPT_MISMATCH" });
  assert.throws(() => contract.validateWorkerConsumptionProof(mapped, validProof({
    references: [{ role: "P1", fileName: "P1.png", sha256: "f".repeat(64), bytes: 123 }, validProof().references[1]]
  })), { code: "PIPELINE_REFERENCE_RECEIPT_MISMATCH" });
  assert.throws(() => contract.validateWorkerConsumptionProof(mapped, validProof({
    composerAttachmentNames: ["P1.png"]
  })), { code: "PIPELINE_REFERENCE_PREVIEW_MISSING" });
});

test("desktop receipt may update only one queue item with the exact canonical revision", () => {
  const mapped = contract.validatePipelineDispatch(dispatch());
  const proof = validProof();
  const receipt = contract.createMatchedExecutionReceipt(mapped, proof, "2026-10-10T00:00:00.000Z");
  const task = {
    requestId: "cdp-fixed-001",
    templateSelectionMode: "3_fixed_template",
    pipelineConfigMode: "3_fixed_template",
    pipelineConfigRevision: revision,
    pipelineConfigTemplateId: "T-77"
  };
  const state = { queue: { tasks: [task], index: 0, running: true } };
  const written = contract.attachReceiptToRuntimeState(state, task.requestId, receipt);
  assert.equal(written.queue.tasks[0].pipelineDispatchState, "MATCH");
  assert.equal(written.queue.tasks[0].workflowVariant, "fresh-session-fixed-template");
  assert.deepEqual(written.queue.tasks[0].pipelineExecutionReceipt, receipt);
  assert.throws(() => contract.attachReceiptToRuntimeState({ queue: { tasks: [{
    ...task, pipelineConfigRevision: `sha256:${"e".repeat(64)}`
  }] } }, task.requestId, receipt), { code: "PIPELINE_RUNTIME_REVISION_MISMATCH" });
  assert.throws(() => contract.attachReceiptToRuntimeState({ queue: { tasks: [task, { ...task }] } }, task.requestId, receipt),
    { code: "PIPELINE_RUNTIME_TASK_AMBIGUOUS" });
  assert.throws(() => contract.attachReceiptToRuntimeState({ queue: { tasks: [] } }, task.requestId, receipt),
    { code: "PIPELINE_RUNTIME_TASK_NOT_FOUND" });
});

test("desktop and extension load the same fail-closed mode-3 contract and gate worker start on receipt", () => {
  const root = path.resolve(__dirname, "../../..");
  const desktop = fs.readFileSync(path.join(root, "src/desktop/main.js"), "utf8");
  const sidebar = fs.readFileSync(path.join(__dirname, "sidebar.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.indexOf("cdp-pipeline-contract.js") < scripts.indexOf("sidebar.js"));
  assert.match(desktop, /require\("\.\.\/integrations\/gpt-production-extension\/cdp-pipeline-contract"\)/);
  assert.match(desktop, /createHash\("sha256"\)/);
  assert.match(desktop, /pipelineTemplateReferences: verifiedTemplateReferences/);
  assert.match(desktop, /persistCdpPipelineExecutionReceipt/);
  assert.match(sidebar, /validatePipelineDispatch\(entry\)/);
  assert.match(sidebar, /crypto\.subtle\.digest\("SHA-256"/);
  const receiptGate = sidebar.lastIndexOf("requestDesktopPipelineReceipt(task, proof)");
  const workerStart = sidebar.indexOf("workflowResult = await runAutomaticProduction(task)", receiptGate);
  assert.ok(receiptGate >= 0 && workerStart > receiptGate, "the worker path must wait for desktop receipt ACK first");
  const workerUnavailable = sidebar.indexOf('"PIPELINE_WORKER_UNAVAILABLE"', receiptGate);
  const successProjection = sidebar.indexOf('task.status = workflowResult?.duplicateSkipped ? "duplicate" : "success";', receiptGate);
  assert.ok(workerUnavailable > receiptGate && workerUnavailable < workerStart,
    "fixed-template dispatch must stop before invoking the disconnected legacy worker");
  assert.match(sidebar.slice(receiptGate, workerUnavailable), /if \(pipelineContract\.enabled\)\s*\{/,
    "worker availability must gate both manual and automatic fixed-template dispatch");
  assert.ok(workerUnavailable < successProjection,
    "a template MATCH receipt must never be projected as upload or production success when the worker is unavailable");
  assert.match(sidebar.slice(workerUnavailable, successProjection), /本任务未开始.*未启动模型或生成作品/);
  const pausedFailureCode = sidebar.lastIndexOf('"PIPELINE_WORKER_UNAVAILABLE"');
  const pauseAssignment = sidebar.indexOf("state.boundaryPaused = true", successProjection);
  assert.ok(pausedFailureCode > successProjection && pauseAssignment > pausedFailureCode,
    "an unavailable worker must pause this populated composer so the next task cannot mix attachments");
});
