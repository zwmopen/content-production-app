const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hasPendingQueue,
  shouldKeepGptAccountView
} = require("./gpt-view-continuity.js");

test("continuous accounts keep a recoverable browser view alive", () => {
  assert.equal(hasPendingQueue([{ requestId: "task-1", _status: "queued" }]), true);
  assert.equal(shouldKeepGptAccountView({
    accountId: "account-2",
    activeAccountId: "account-4",
    profile: { mode: "single", disabled: false },
    settings: { mode: "single", continuousAutoStart: true },
    runtime: { status: "idle" },
    queue: [{ requestId: "task-1", _status: "queued" }]
  }), true);
});

test("user-stopped accounts are never kept alive by the automatic queue", () => {
  assert.equal(shouldKeepGptAccountView({
    accountId: "account-3",
    activeAccountId: "account-4",
    profile: { mode: "single", disabled: false },
    settings: { mode: "single", continuousAutoStart: true },
    runtime: { status: "retry-wait", stoppedByUser: true },
    queue: [{ requestId: "task-1", _status: "queued" }]
  }), false);
});

test("manual and disabled accounts do not get continuous keep-alive", () => {
  assert.equal(shouldKeepGptAccountView({
    accountId: "account-6",
    activeAccountId: "account-4",
    profile: { mode: "manual", disabled: true },
    settings: { mode: "single", continuousAutoStart: true },
    runtime: { status: "idle" },
    queue: [{ requestId: "task-1", _status: "queued" }]
  }), false);
});
