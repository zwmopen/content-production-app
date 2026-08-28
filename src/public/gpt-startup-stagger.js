(function exposeGptStartupStagger(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GptStartupStagger = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGptStartupStagger() {
  const DEFAULT_MIN_DELAY_MS = 5 * 60_000;
  const DEFAULT_MAX_DELAY_MS = 10 * 60_000;
  const DEFAULT_MAX_WAIT_MS = DEFAULT_MAX_DELAY_MS + 30_000;

  function normalizeIds(accountIds = []) {
    return [...new Set((Array.isArray(accountIds) ? accountIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean))];
  }

  function create(accountIds = [], options = {}) {
    const bootAt = Number(options.bootAt || Date.now());
    return {
      bootAt: Number.isFinite(bootAt) ? bootAt : Date.now(),
      minDelayMs: Math.max(0, Number(options.minDelayMs ?? DEFAULT_MIN_DELAY_MS) || DEFAULT_MIN_DELAY_MS),
      maxDelayMs: Math.max(
        Math.max(0, Number(options.minDelayMs ?? DEFAULT_MIN_DELAY_MS) || DEFAULT_MIN_DELAY_MS),
        Number(options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS) || DEFAULT_MAX_DELAY_MS
      ),
      maxWaitMs: Math.max(0, Number(options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS) || DEFAULT_MAX_WAIT_MS),
      random: typeof options.random === "function" ? options.random : null,
      order: normalizeIds(accountIds),
      launched: new Set(),
      launchAt: {},
      delayMs: {},
      firstOutput: new Set(),
      released: new Set()
    };
  }

  function syncOrder(state, accountIds = []) {
    if (!state || typeof state !== "object") return state;
    const next = normalizeIds(accountIds);
    const current = Array.isArray(state.order) ? state.order : [];
    // Keep the operator's current tab order for accounts that already existed
    // at boot, then append a newly-added eligible account. This prevents a
    // late browser tab from reordering the four startup lanes unexpectedly.
    state.order = [
      ...next.filter((id) => current.includes(id)),
      ...next.filter((id) => !current.includes(id))
    ];
    return state;
  }

  function markFirstOutput(state, accountId) {
    const key = String(accountId || "").trim();
    if (!state || !key) return state;
    state.firstOutput ||= new Set();
    state.released ||= new Set();
    state.firstOutput.add(key);
    return state;
  }

  function markReleased(state, accountId) {
    const key = String(accountId || "").trim();
    if (!state || !key) return state;
    state.released ||= new Set();
    state.released.add(key);
    return state;
  }

  function markLaunched(state, accountId, now = Date.now()) {
    const key = String(accountId || "").trim();
    if (!state || !key) return state;
    state.launched ||= new Set();
    state.launchAt ||= {};
    state.delayMs ||= {};
    const timestamp = Number(now);
    if (!state.launched.has(key)) {
      state.launchAt[key] = Number.isFinite(timestamp) ? timestamp : Date.now();
      const minDelayMs = Math.max(0, Number(state.minDelayMs ?? DEFAULT_MIN_DELAY_MS) || DEFAULT_MIN_DELAY_MS);
      const maxDelayMs = Math.max(minDelayMs, Number(state.maxDelayMs ?? DEFAULT_MAX_DELAY_MS) || DEFAULT_MAX_DELAY_MS);
      const random = typeof state.random === "function" ? state.random() : Math.random();
      state.delayMs[key] = minDelayMs + Math.floor(Math.max(0, Math.min(0.999999, Number(random) || 0)) * (maxDelayMs - minDelayMs + 1));
    }
    state.launched.add(key);
    return state;
  }

  // A renderer can be started before the configured work window. In that
  // case the bounded fallback may release the predecessor while no browser
  // has actually launched yet. Do not carry that synthetic release into the
  // next work window: the first lane must still launch first, then the next
  // lanes keep their 5-10 minute spacing. If a lane really launched during
  // the previous window, preserve the live rhythm instead of restarting it.
  function resetForWorkWindow(state, workWindowKey = "", options = {}) {
    if (!state || typeof state !== "object") return false;
    const key = String(workWindowKey || "").trim();
    if (!key || String(state.workWindowKey || "") === key) return false;
    const launched = state.launched instanceof Set
      ? state.launched
      : new Set(state.launched || []);
    state.workWindowKey = key;
    if (launched.size > 0 && options.preserveLaunched !== false) return false;
    state.bootAt = Number(options.bootAt || Date.now());
    state.launched = new Set();
    state.launchAt = {};
    state.delayMs = {};
    state.firstOutput = new Set();
    state.released = new Set();
    return true;
  }

  function gate(state, accountId, options = {}) {
    const key = String(accountId || "").trim();
    if (!state || !key || !Array.isArray(state.order)) {
      return { allowed: true, reason: "startup-stagger-uninitialized" };
    }
    const index = state.order.indexOf(key);
    if (index <= 0) return { allowed: true, reason: "first-startup-window" };
    const previousAccountId = state.order[index - 1];
    const released = state.released instanceof Set ? state.released : new Set(state.released || []);
    const heldIds = new Set((Array.isArray(options.heldIds) ? options.heldIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean));
    if (released.has(previousAccountId)) {
      return { allowed: true, reason: "previous-window-released", previousAccountId };
    }
    if (heldIds.has(previousAccountId)) {
      markReleased(state, previousAccountId);
      return { allowed: true, reason: "previous-window-user-held", previousAccountId };
    }
    const now = Number(options.now || Date.now());
    const launchAt = Number(state.launchAt?.[previousAccountId] || 0);
    const maxWaitMs = Math.max(0, Number(state.maxWaitMs || DEFAULT_MAX_WAIT_MS));
    if (!launchAt) {
      const bootAt = Number(state.bootAt || now);
      const bootElapsedMs = Math.max(0, now - bootAt);
      if (bootElapsedMs >= maxWaitMs) {
        markReleased(state, previousAccountId);
        return {
          allowed: true,
          reason: "startup-stagger-timeout",
          previousAccountId,
          waitedMs: bootElapsedMs
        };
      }
      return {
        allowed: false,
        reason: "waiting-previous-window-launch",
        previousAccountId,
        waitedMs: bootElapsedMs,
        remainingMs: Math.max(1, maxWaitMs - bootElapsedMs)
      };
    }
    const delayMs = Math.max(0, Number(state.delayMs?.[previousAccountId] || DEFAULT_MAX_DELAY_MS));
    const elapsedMs = Math.max(0, now - launchAt);
    if (elapsedMs >= delayMs) {
      return {
        allowed: true,
        reason: "startup-stagger-delay-elapsed",
        previousAccountId,
        waitedMs: elapsedMs,
        delayMs
      };
    }
    if (elapsedMs >= maxWaitMs) {
      markReleased(state, previousAccountId);
      return {
        allowed: true,
        reason: "startup-stagger-timeout",
        previousAccountId,
        waitedMs: elapsedMs
      };
    }
    return {
      allowed: false,
      reason: "waiting-startup-stagger",
      previousAccountId,
      waitedMs: elapsedMs,
      delayMs,
      remainingMs: Math.max(1, Math.min(delayMs - elapsedMs, maxWaitMs - elapsedMs))
    };
  }

  function diagnostics(state) {
    return {
      bootAt: Number(state?.bootAt || 0),
      minDelayMs: Number(state?.minDelayMs || DEFAULT_MIN_DELAY_MS),
      maxDelayMs: Number(state?.maxDelayMs || DEFAULT_MAX_DELAY_MS),
      maxWaitMs: Number(state?.maxWaitMs || DEFAULT_MAX_WAIT_MS),
      order: Array.isArray(state?.order) ? [...state.order] : [],
      launched: [...(state?.launched instanceof Set ? state.launched : new Set(state?.launched || []))],
      launchAt: { ...(state?.launchAt || {}) },
      delayMs: { ...(state?.delayMs || {}) },
      firstOutput: [...(state?.firstOutput instanceof Set ? state.firstOutput : new Set(state?.firstOutput || []))],
      released: [...(state?.released instanceof Set ? state.released : new Set(state?.released || []))],
      workWindowKey: String(state?.workWindowKey || "")
    };
  }

  return {
    DEFAULT_MAX_WAIT_MS,
    DEFAULT_MIN_DELAY_MS,
    DEFAULT_MAX_DELAY_MS,
    normalizeIds,
    create,
    syncOrder,
    markFirstOutput,
    markReleased,
    markLaunched,
    resetForWorkWindow,
    gate,
    diagnostics
  };
});
