const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_RETENTION_MS,
  appendDistinctTask,
  clampPercent,
  filterBatchMaterialTasks,
  isBatchMaterialTask,
  resolveProgressIdentity,
  resolveMonotonicPercent,
  shouldRetainProgress
} = require("./gpt-progress-display");

test("progress display clamps invalid percentages without inventing movement", () => {
  assert.equal(clampPercent(-4), 0);
  assert.equal(clampPercent(48.6), 49);
  assert.equal(clampPercent(140), 100);
  assert.equal(clampPercent("not-a-number", 35), 35);
});

test("the same work item never regresses when a stale status arrives", () => {
  const identity = resolveProgressIdentity({ requestId: "run-1" });
  assert.equal(resolveMonotonicPercent({ identity, previousIdentity: identity, previousPercent: 62, percent: 35 }), 62);
  assert.equal(resolveMonotonicPercent({ identity, previousIdentity: identity, previousPercent: 62, percent: 74 }), 74);
  assert.equal(resolveMonotonicPercent({ identity: "run-2", previousIdentity: identity, previousPercent: 62, percent: 10 }), 10);
});

test("progress counts do not duplicate a serialized last-failed task", () => {
  const queued = { requestId: "task-1", _status: "failed" };
  const restoredLastFailed = { requestId: "task-1", _status: "failed" };
  const tasks = appendDistinctTask([queued], restoredLastFailed);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0], queued);
});

test("batch progress excludes template initialization from material counts", () => {
  const tasks = filterBatchMaterialTasks([
    { requestId: "material-1", taskType: "material" },
    { requestId: "gpt-template-1", taskType: "template-init" }
  ]);
  assert.equal(tasks.length, 1);
  assert.equal(isBatchMaterialTask({ taskType: "template-init" }), false);
  assert.equal(isBatchMaterialTask({ taskType: "material" }), true);
});

test("progress retention is time bounded", () => {
  assert.equal(DEFAULT_RETENTION_MS, 15_000);
  assert.equal(shouldRetainProgress(1_000, 1_001), true);
  assert.equal(shouldRetainProgress(1_001, 1_001), false);
});
