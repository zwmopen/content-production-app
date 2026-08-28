const test = require("node:test");
const assert = require("node:assert/strict");
const {
  combinationCount,
  fitWholeTasks,
  recordQuotaEvent,
  rollingQuotaStatus
} = require("./gpt-production-orchestrator");

test("模板与素材按笛卡尔积计算作品数", () => {
  assert.equal(combinationCount(3, 2), 6);
  assert.equal(combinationCount(3, 0), 3);
});

test("滚动三小时会排除过期事件", () => {
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  const account = {
    settings: { windowHours: 3, uploadLimit: 80, generationLimit: 50 },
    events: [
      { kind: "uploaded", count: 20, recordedAt: "2026-07-30T10:00:00.000Z" },
      { kind: "uploaded", count: 10, recordedAt: "2026-07-30T08:00:00.000Z" },
      { kind: "generated", count: 5, recordedAt: "2026-07-30T11:00:00.000Z" }
    ]
  };
  const status = rollingQuotaStatus(account, now);
  assert.equal(status.uploaded, 20);
  assert.equal(status.generated, 5);
  assert.equal(status.remainingUploads, 60);
});

test("额度事件按账号独立记录", () => {
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  let ledger = recordQuotaEvent({}, "account-1", {
    kind: "uploaded",
    count: 12,
    requestId: "task-1"
  }, now);
  ledger = recordQuotaEvent(ledger, "account-2", {
    kind: "generated",
    count: 6,
    requestId: "task-2"
  }, now);
  assert.equal(rollingQuotaStatus(ledger.accounts["account-1"], now).uploaded, 12);
  assert.equal(rollingQuotaStatus(ledger.accounts["account-2"], now).generated, 6);
});

test("同一请求的重复额度事件只计一次", () => {
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  const status = rollingQuotaStatus({
    settings: { windowHours: 3, uploadLimit: 80, generationLimit: 50 },
    events: [
      { kind: "uploaded", count: 12, recordedAt: "2026-07-30T10:00:00.000Z", requestId: "task-1" },
      { kind: "uploaded", count: 12, recordedAt: "2026-07-30T10:05:00.000Z", requestId: "task-1" },
      { kind: "uploaded", count: 8, recordedAt: "2026-07-30T11:00:00.000Z", requestId: "task-2" }
    ]
  }, now);
  assert.equal(status.uploaded, 20);
  assert.equal(status.events.length, 2);
  assert.equal(status.nextExpiryAt, "2026-07-30T13:00:00.000Z");
});

test("写入同一请求的额度事件保持幂等", () => {
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  let ledger = recordQuotaEvent({}, "account-1", {
    kind: "uploaded",
    count: 12,
    requestId: "task-1"
  }, now);
  ledger = recordQuotaEvent(ledger, "account-1", {
    kind: "uploaded",
    count: 12,
    requestId: "task-1"
  }, now + 60_000);
  assert.equal(ledger.accounts["account-1"].events.length, 1);
  assert.equal(rollingQuotaStatus(ledger.accounts["account-1"], now + 60_000).uploaded, 12);
});

test("只安排完整放得下的作品", () => {
  const result = fitWholeTasks([
    { id: "a", uploadImages: 30, expectedGeneratedImages: 5 },
    { id: "b", uploadImages: 30, expectedGeneratedImages: 5 },
    { id: "c", uploadImages: 25, expectedGeneratedImages: 5 }
  ], { remainingUploads: 70, remainingGenerations: 50 });
  assert.deepEqual(result.runnable.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(result.waiting.map((item) => item.id), ["c"]);
});
