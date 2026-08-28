const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GPT_PAGE_LOAD_STALL_TIMEOUT_MS,
  GPT_PAGE_LOAD_RECOVERY_MAX_ATTEMPTS,
  isGptPageDocumentStable,
  planGptPageRecovery,
  shouldDeferGptPageRecovery,
  shouldPreserveGptPageAfterReadTimeout,
  shouldAbortPendingGptTask,
  shouldEscalateGptBridgeTimeout
} = require("./gpt-page-recovery");

test("a stalled conversation checkpoint bypasses cache on the first recovery", () => {
  const plan = planGptPageRecovery({
    attempts: 0,
    targetUrl: "https://chatgpt.com/c/account-2-checkpoint"
  });
  assert.equal(plan.action, "reloadIgnoringCache");
  assert.equal(plan.timeoutMs, GPT_PAGE_LOAD_STALL_TIMEOUT_MS);
  assert.equal(plan.maxAttempts, GPT_PAGE_LOAD_RECOVERY_MAX_ATTEMPTS);
});

test("the second recovery uses one ordinary bounded reload", () => {
  assert.equal(planGptPageRecovery({
    attempts: 1,
    targetUrl: "https://chatgpt.com/c/account-2-checkpoint"
  }).action, "reload");
});

test("recovery enters passive automatic wait after the configured maximum", () => {
  const plan = planGptPageRecovery({
    attempts: GPT_PAGE_LOAD_RECOVERY_MAX_ATTEMPTS,
    targetUrl: "https://chatgpt.com/c/account-2-checkpoint"
  });
  assert.equal(plan.action, "wait");
  assert.ok(plan.timeoutMs >= 60_000);
});

test("a loaded web document is stable even when the production bridge is not ready", () => {
  assert.equal(isGptPageDocumentStable({
    readyState: "complete",
    url: "https://chatgpt.com/c/account-2-checkpoint",
    extensionReady: false,
    composerReady: false,
    chatConversation: true
  }), true);
  assert.equal(isGptPageDocumentStable({
    readyState: "complete",
    url: "https://auth.openai.com/mfa-challenge/example",
    authenticationRequired: true
  }), true);
  assert.equal(isGptPageDocumentStable({
    readyState: "loading",
    url: "https://chatgpt.com/c/account-2-checkpoint"
  }), false);
  assert.equal(isGptPageDocumentStable({
    readyState: "complete",
    url: "chrome-error://chromewebdata/"
  }), false);
  assert.equal(isGptPageDocumentStable({
    readyState: "complete",
    url: "https://chatgpt.com/",
    extensionReady: true,
    composerReady: true,
    chatConversation: true
  }), false);
  assert.equal(isGptPageDocumentStable({
    readyState: "complete",
    url: "https://chatgpt.com/",
    extensionReady: true,
    composerReady: true,
    authenticationRequired: false,
    freshRootReady: true
  }), true);
});

test("non-conversation pages do not get cache-bypass recovery", () => {
  assert.equal(planGptPageRecovery({
    attempts: 0,
    targetUrl: "https://chatgpt.com/"
  }).action, "reload");
});

test("page recovery defers while a manual upload request owns the account", () => {
  assert.equal(shouldDeferGptPageRecovery({ pendingRequest: true }), true);
  assert.equal(shouldDeferGptPageRecovery({ pendingRequest: false }), false);
});

test("page recovery defers while the user has stopped the account window", () => {
  assert.equal(shouldDeferGptPageRecovery({ userHold: true }), true);
  assert.equal(shouldDeferGptPageRecovery({ pendingRequest: false, userHold: false }), false);
});

test("a bridge read timeout preserves a previously usable ChatGPT conversation", () => {
  assert.equal(shouldPreserveGptPageAfterReadTimeout({
    readTimedOut: true,
    knownDomReady: true,
    knownFinished: true,
    targetUrl: "https://chatgpt.com/c/account-4-checkpoint"
  }), true);
  assert.equal(shouldPreserveGptPageAfterReadTimeout({
    readTimedOut: true,
    knownDomReady: false,
    knownFinished: true,
    targetUrl: "https://chatgpt.com/c/account-4-checkpoint"
  }), false);
  assert.equal(shouldPreserveGptPageAfterReadTimeout({
    readTimedOut: true,
    knownDomReady: true,
    knownFinished: true,
    targetUrl: "https://chatgpt.com/"
  }), false);
});

test("stopping a GPT window only cancels its matching pending request", () => {
  assert.equal(shouldAbortPendingGptTask({ pendingRequestId: "gpt-task-1", requestId: "gpt-task-1" }), true);
  assert.equal(shouldAbortPendingGptTask({ pendingRequestId: "gpt-task-1", requestId: "gpt-task-2" }), false);
  assert.equal(shouldAbortPendingGptTask({ pendingRequestId: "gpt-task-1" }), true);
  assert.equal(shouldAbortPendingGptTask({ pendingRequestId: "", requestId: "gpt-task-1" }), false);
});

test("bridge timeout escalation never interrupts an active production request", () => {
  assert.equal(shouldEscalateGptBridgeTimeout({
    consecutiveTimeouts: 3,
    pendingRequest: true
  }), false);
  assert.equal(shouldEscalateGptBridgeTimeout({
    consecutiveTimeouts: 8,
    productionTaskActive: true
  }), false);
  assert.equal(shouldEscalateGptBridgeTimeout({
    consecutiveTimeouts: 3
  }), true);
});
