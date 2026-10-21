"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createQuotaViewModel, isExplicitQuotaLimitSignal } = require("./gpt-quota-view");

test("quota panel distinguishes an unsynced local ledger from remaining quota", () => {
  const model = createQuotaViewModel(null, "CDP窗口 B", {
    uploadLimit: 80,
    generationLimit: 45,
    windowHours: 3
  });
  assert.equal(model.state, "unknown");
  assert.match(model.uploadLabel, /本地记录未同步/);
  assert.doesNotMatch(model.uploadLabel, /本地账面余 80/);
  assert.match(model.note, /网页内其他操作未补录/);
});

test("quota panel renders account-scoped rolling upload and generation boundaries", () => {
  const model = createQuotaViewModel({
    settings: { enabled: true, uploadLimit: 80, generationLimit: 45, windowHours: 3 },
    uploaded: 80,
    generated: 45,
    nextExpiryAt: "2026-10-09T12:00:00.000Z"
  }, "CDP窗口 A", {}, Date.parse("2026-10-09T11:00:00.000Z"));
  assert.equal(model.state, "blocked");
  assert.equal(model.remainingUploads, 0);
  assert.equal(model.remainingGenerations, 0);
  assert.match(model.uploadLabel, /80\/80/);
  assert.match(model.note, /只暂停当前 CDP 账号窗口/);
  assert.match(model.nextExpiryLabel, /本地最早释放/);
});

test("generic HTTP and network throttles do not prove an exhausted account quota", () => {
  assert.equal(isExplicitQuotaLimitSignal("HTTP 429 Too Many Requests"), false);
  assert.equal(isExplicitQuotaLimitSignal("rate limit exceeded; retry later"), false);
  assert.equal(isExplicitQuotaLimitSignal("网络请求超时，请稍后重试"), false);
  assert.equal(isExplicitQuotaLimitSignal("HTTP 429: individual quota reached; image generation unavailable"), true);
  assert.equal(isExplicitQuotaLimitSignal("已达到3小时上传附件上限"), true);
});
