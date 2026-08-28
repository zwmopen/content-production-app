const { normalizeChatConversationUrl } = require("./gpt-session-guard");

const GPT_PAGE_LOAD_STALL_TIMEOUT_MS = 30_000;
const GPT_PAGE_LOAD_RECOVERY_MAX_ATTEMPTS = 2;

function isGptPageDocumentStable({
  readyState = "",
  url = "",
  authenticationRequired = false,
  freshRootReady = false
} = {}) {
  if (!["interactive", "complete"].includes(String(readyState || ""))) return false;
  if (authenticationRequired === true) return true;
  // The fresh-session workflow intentionally starts at ChatGPT's root page
  // before its first user message creates a /c/... conversation.  A ready
  // composer plus the production extension is a stable, actionable page at
  // that boundary; requiring /c/... here makes the native watchdog reload a
  // healthy root page and abort the upload worker in a loop.
  if (freshRootReady === true) {
    return /^https:\/\/(?:chatgpt\.com|www\.chatgpt\.com)\/?$/i.test(String(url || "").trim());
  }
  // ChatGPT's root page can have a ready composer and the production
  // extension marker, but it has no durable conversation context. Treating
  // it as stable would suppress the exact /c/... navigation that a queued
  // checkpoint owns. Only a real conversation is a stable production page.
  return Boolean(normalizeChatConversationUrl(url));
}

/**
 * Decide the bounded action for a stalled embedded ChatGPT page.
 *
 * A conversation URL can retain a bad renderer/network cache entry. The
 * first recovery therefore bypasses HTTP cache, while a second recovery is
 * an ordinary reload. Credentials and storage are deliberately untouched.
 */
function planGptPageRecovery({ attempts = 0, targetUrl = "" } = {}) {
  const count = Math.max(0, Number(attempts) || 0);
  if (count >= GPT_PAGE_LOAD_RECOVERY_MAX_ATTEMPTS) {
    return {
      action: "wait",
      timeoutMs: Math.max(60_000, GPT_PAGE_LOAD_STALL_TIMEOUT_MS * 2),
      maxAttempts: GPT_PAGE_LOAD_RECOVERY_MAX_ATTEMPTS
    };
  }
  const hasConversationCheckpoint = Boolean(normalizeChatConversationUrl(targetUrl));
  return {
    action: count === 0 && hasConversationCheckpoint ? "reloadIgnoringCache" : "reload",
    timeoutMs: GPT_PAGE_LOAD_STALL_TIMEOUT_MS,
    maxAttempts: GPT_PAGE_LOAD_RECOVERY_MAX_ATTEMPTS
  };
}

function shouldDeferGptPageRecovery({ pendingRequest = false, userHold = false } = {}) {
  return pendingRequest === true || userHold === true;
}

// A native executeJavaScript read can time out while the embedded ChatGPT
// document is still usable. If Electron already observed a completed DOM for
// the same conversation, preserve that page instead of treating the read
// timeout as proof that a reload is needed.
function shouldPreserveGptPageAfterReadTimeout({
  readTimedOut = false,
  knownDomReady = false,
  knownFinished = false,
  targetUrl = ""
} = {}) {
  return readTimedOut === true
    && knownDomReady === true
    && knownFinished === true
    && Boolean(normalizeChatConversationUrl(targetUrl));
}

function shouldAbortPendingGptTask({ pendingRequestId = "", requestId = "" } = {}) {
  const activeId = String(pendingRequestId || "").trim();
  const requestedId = String(requestId || "").trim();
  return Boolean(activeId) && (!requestedId || activeId === requestedId);
}

function shouldEscalateGptBridgeTimeout({
  consecutiveTimeouts = 0,
  pendingRequest = false,
  productionTaskActive = false,
  userHold = false
} = {}) {
  if (userHold === true || pendingRequest === true || productionTaskActive === true) return false;
  return Math.max(0, Number(consecutiveTimeouts) || 0) >= 3;
}

module.exports = {
  GPT_PAGE_LOAD_STALL_TIMEOUT_MS,
  GPT_PAGE_LOAD_RECOVERY_MAX_ATTEMPTS,
  isGptPageDocumentStable,
  planGptPageRecovery,
  shouldDeferGptPageRecovery,
  shouldPreserveGptPageAfterReadTimeout,
  shouldAbortPendingGptTask,
  shouldEscalateGptBridgeTimeout
};
