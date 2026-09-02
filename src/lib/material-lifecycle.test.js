const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decideMaterialLifecycle,
  canClaimMaterial,
  archiveEventKey,
  hasArchiveEvent,
  appendArchiveEvent,
  operationalStatusForFailure
} = require("./material-lifecycle");

test("material lifecycle sends clean tagged material to production", () => {
  const result = decideMaterialLifecycle({ hasTags: true });
  assert.equal(result.lifecycleState, "已打标待生产");
  assert.equal(result.canProduce, true);
  assert.deepEqual(result.conflicts, []);
});

test("material conflicts go to review without blocking unrelated material", () => {
  const result = decideMaterialLifecycle({
    hasTags: true,
    conflicts: ["TAG_SOURCE_CONFLICT", "USAGE_COUNT_CONFLICT"]
  });
  assert.equal(result.lifecycleState, "待复核");
  assert.equal(result.canProduce, false);
  assert.deepEqual(result.conflicts, ["TAG_SOURCE_CONFLICT", "USAGE_COUNT_CONFLICT"]);
});

test("material claim respects another live browser lock but allows the same owner to resume", () => {
  const claimedAt = new Date("2026-08-17T10:00:00.000Z").toISOString();
  const entry = {
    lifecycleState: "已打标待生产",
    lock: { owner: "account-a", claimedAt, heartbeatAt: claimedAt }
  };
  assert.equal(canClaimMaterial(entry, {
    owner: "account-b",
    now: Date.parse("2026-08-17T10:01:00.000Z")
  }).code, "MATERIAL_LOCKED");
  assert.equal(canClaimMaterial(entry, {
    owner: "account-a",
    now: Date.parse("2026-08-17T10:01:00.000Z")
  }).ok, true);
});

test("archive event keys are stable, package-path independent, and duplicate archive events are idempotent", () => {
  const input = { folderHash: "folder-1", requestId: "req-1", packagePath: "D:/pkg-a" };
  const first = archiveEventKey(input);
  const second = archiveEventKey({ ...input, packagePath: "D:/pkg-b" });
  assert.equal(first, second);
  assert.notEqual(first, archiveEventKey({ ...input, requestId: "req-2" }));
  assert.equal(
    archiveEventKey({ folderHash: "folder-1", packagePath: "D:/pkg-a" }),
    archiveEventKey({ folderHash: "folder-1", packagePath: "D:/pkg-b" })
  );
  let state = appendArchiveEvent({}, first, "2026-08-17T10:00:00.000Z");
  assert.equal(hasArchiveEvent(state, first), true);
  state = appendArchiveEvent(state, first, "2026-08-17T10:01:00.000Z");
  assert.deepEqual(state.archiveEvents, [first]);
});

test("failure status keeps quota, pause and web failures distinguishable", () => {
  assert.equal(operationalStatusForFailure({ code: "GPT_QUOTA_LIMIT" }), "等待额度");
  assert.equal(operationalStatusForFailure({ code: "USER_PAUSED_BY_USER" }), "已暂停");
  assert.equal(operationalStatusForFailure({ code: "GPT_WORKFLOW_HEARTBEAT_LOST" }), "网页异常");
  assert.equal(operationalStatusForFailure({ code: "UNKNOWN" }), "失败待恢复");
});
