const assert = require("node:assert/strict");
const test = require("node:test");

const {
  TEMPORARY_WEB_CACHE_INTERVAL_MS,
  TEMPORARY_WEB_CACHE_ACTIVE_RETRY_MS,
  TEMPORARY_WEB_CACHE_STARTUP_GRACE_MS,
  planTemporaryWebCacheCleanup
} = require("./temporary-web-cache-schedule");

const at = (hour, minute = 0) => new Date(2026, 7, 18, hour, minute, 0, 0);

test("cache maintenance waits through the startup grace window", () => {
  const now = at(9);
  const plan = planTemporaryWebCacheCleanup({
    now,
    startupGraceUntil: now.getTime() + TEMPORARY_WEB_CACHE_STARTUP_GRACE_MS
  });
  assert.equal(plan.action, "wait");
  assert.equal(plan.reason, "startup-grace");
});

test("cache maintenance waits for the configured work window instead of running after 02:00", () => {
  const plan = planTemporaryWebCacheCleanup({ now: at(2, 1) });
  assert.equal(plan.action, "wait");
  assert.equal(plan.reason, "outside-work-hours");
  assert.equal(new Date(plan.nextAt).getHours(), 7);
});

test("cache maintenance does not clear partitions while production is active", () => {
  const plan = planTemporaryWebCacheCleanup({ now: at(10), activeTaskCount: 1 });
  assert.equal(plan.action, "wait");
  assert.equal(plan.reason, "production-active");
  assert.equal(plan.delayMs, TEMPORARY_WEB_CACHE_ACTIVE_RETRY_MS);
});

test("cache maintenance runs at most once per three hours when idle", () => {
  const now = at(15);
  const plan = planTemporaryWebCacheCleanup({
    now,
    lastRunAt: now.getTime() - TEMPORARY_WEB_CACHE_INTERVAL_MS + 60_000
  });
  assert.equal(plan.action, "wait");
  assert.equal(plan.reason, "interval");
  assert.equal(plan.delayMs, 60_000);
});
