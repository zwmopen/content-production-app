(function exposeGptWindowWorkerState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GptWindowWorkerState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGptWindowWorkerState() {
  const TERMINAL_STATUSES = new Set(["completed", "skipped"]);
  const AUTOMATIC_RECOVERY_RETRY_LIMIT = 3;
  // Every automatic recovery round has a finite environment budget. A page or
  // bridge outage may be retried for a bounded period, then the current task
  // is deferred/quarantined so the account window cannot be occupied forever.
  const AUTOMATIC_RECOVERY_STAGNATION_LIMIT = 8;
  const AUTOMATIC_RECOVERY_BASE_DELAY_MS = 5_000;
  const AUTOMATIC_RECOVERY_MAX_DELAY_MS = 10_000;
  const AUTOMATIC_RECOVERY_ENVIRONMENT_WAIT_LIMIT_MS = 30_000;
  // A transient bridge/read failure must not refresh a page that is visibly
  // still producing the current image batch. Give the native GPT response a
  // finite grace period, then let the normal bounded recovery chain resume.
  const ACTIVE_GENERATION_RECOVERY_GRACE_MS = 5 * 60_000;
  // Once GPT has accepted a request, the native sendTask promise can remain
  // pending even though the page/bridge stopped producing new state. Keep a
  // generous stage-specific bound so normal image generation is not cut off,
  // while a dead post-submit bridge cannot hold an account forever.
  const POST_SUBMIT_IDLE_STALL_LIMIT_MS = 10 * 60_000;
  const POST_SUBMIT_GENERATION_STALL_LIMIT_MS = 15 * 60_000;
  const WORKFLOW_ATTENTION_LINE_MS = 20 * 60_000;
  const NO_PROGRESS_RECOVERY_LINE_MS = 10 * 60_000;
  const STAGE_TIMEOUTS_MS = Object.freeze({
    "upload-material": 2 * 60_000,
    "wait-plan": 8 * 60_000,
    "wait-images": 15 * 60_000,
    "wait-copy": 8 * 60_000,
    "download-images": 10 * 60_000,
    "save-text": 3 * 60_000,
    "move-archive": 3 * 60_000,
    "package-archive": 3 * 60_000
  });

  function normalizeAccountId(accountId) {
    return String(accountId || "account-1").trim() || "account-1";
  }

  function create(accountId, seed = {}) {
    const key = normalizeAccountId(accountId);
    return {
      accountId: key,
      queue: Array.isArray(seed.queue) ? seed.queue : [],
      queueIndex: Math.max(0, Number(seed.queueIndex || 0)),
      selectedMaterials: new Set(Array.isArray(seed.selectedMaterials) ? seed.selectedMaterials : []),
      selectedTemplates: new Set(Array.isArray(seed.selectedTemplates) ? seed.selectedTemplates : []),
      extraPrompt: String(seed.extraPrompt || ""),
      armed: Boolean(seed.armed),
      pausedByUser: Boolean(seed.pausedByUser),
      stoppedByUser: Boolean(seed.stoppedByUser),
      autoRunning: Boolean(seed.autoRunning),
      autoPaused: Boolean(seed.autoPaused),
      queuePaused: Boolean(seed.queuePaused),
      currentManualTask: seed.currentManualTask || null,
      semiAutoPendingTask: seed.semiAutoPendingTask || null,
      lastFailedTask: seed.lastFailedTask || null,
      lastFailedStage: String(seed.lastFailedStage || ""),
      lastFailedPercent: Number(seed.lastFailedPercent || 0),
      quotaPauseStatus: String(seed.quotaPauseStatus || ""),
      successfulOutputs: Math.max(0, Number(seed.successfulOutputs || 0)),
      firstValidOutputAt: String(seed.firstValidOutputAt || ""),
      lastValidOutputAt: String(seed.lastValidOutputAt || ""),
      updatedAt: Number(seed.updatedAt || Date.now())
    };
  }

  // A renderer restart or a late archive callback can persist the durable
  // result before it flips the in-memory status from `queued`. The package
  // result and completion timestamp are stronger terminal evidence than that
  // stale transient status; otherwise the queue points back to an already
  // archived task and continuous mode never refills the next material.
  function isTerminalTask(task) {
    if (!task) return false;
    if (TERMINAL_STATUSES.has(String(task._status || ""))) return true;
    if (String(task._completedAt || "").trim()) return true;
    return Boolean(String(task._result?.packagePath || "").trim());
  }

  function nextPendingIndex(state) {
    const queue = Array.isArray(state?.queue) ? state.queue : [];
    let index = Math.max(0, Math.min(queue.length, Number(state?.queueIndex || 0)));
    while (index < queue.length && isTerminalTask(queue[index])) index += 1;
    return index;
  }

  function hasPending(state) {
    const queue = Array.isArray(state?.queue) ? state.queue : [];
    const start = Math.max(0, Math.min(queue.length, Number(state?.queueIndex || 0)));
    return queue.slice(start).some((task) => task && !isTerminalTask(task));
  }

  // A single-account lane is serial.  A late recovery callback may still hold
  // an older task object after the durable cursor has moved on; that callback
  // must never be allowed to send, mutate the active stage, or advance the
  // queue for a different material.
  function isCurrentTask(state, task) {
    const queue = Array.isArray(state?.queue) ? state.queue : [];
    const current = queue[Math.max(0, Number(state?.queueIndex || 0))];
    return Boolean(
      current
      && task
      && String(current.requestId || "")
      && String(current.requestId) === String(task.requestId || "")
    );
  }

  // `queuePaused` is a recoverable checkpoint: it can be set by a failed
  // bridge call, a renderer restart, a quota probe, or an old global queue.
  // Only the explicit user flags are allowed to suppress continuous startup.
  // Keeping this policy here makes the distinction testable and prevents the
  // renderer from accidentally treating a safety checkpoint as a user stop.
  function hasExplicitUserHold(state = {}, runtime = {}, settings = {}) {
    if (settings.continuousAutoStart === false) return true;
    return Boolean(
      state.pausedByUser
      || state.stoppedByUser
      || runtime.pausedByUser
      || runtime.stoppedByUser
    );
  }

  function shouldAutoArm(state = {}, runtime = {}, settings = {}) {
    return !hasExplicitUserHold(state, runtime, settings);
  }

  // Some pre-0.19.173 inspection jobs persisted their own safety isolation as
  // `pausedByUser`. That transport/recovery hold must not survive forever as
  // an operator decision. Migrate only the explicit legacy signature, and
  // never release a stopped/disabled/manual lane or a genuine user pause.
  function shouldReleaseLegacyInspectionHold(state = {}, runtime = {}, settings = {}, account = {}) {
    if (account.disabled === true || settings.continuousAutoStart === false) return false;
    if (String(settings.mode || "") !== "single") return false;
    if (state.stoppedByUser === true || runtime.stoppedByUser === true) return false;
    if (!String(runtime.reason || "").startsWith("inspection-safety-hold:")) return false;
    const stage = String(runtime.currentStage || "");
    const status = String(runtime.status || "");
    return stage === "手动模式，不参与自动生产"
      || (status === "idle" && (state.pausedByUser === true || runtime.pausedByUser === true));
  }

  // A worker promise can outlive the page-side workflow after a bridge timeout.
  // Only interrupt that stale promise when the live conversation itself is at
  // a safe, material-matching boundary. Never use this for an actively
  // generating response or an ambiguous/unknown page.
  function shouldInterruptStuckWorker({
    workerRunning = false,
    liveWorker = false,
    taskDispatching = false,
    inspection = {},
    taskMatches = false,
    now = Date.now(),
    lastProbeAt = 0,
    cooldownMs = 15_000,
    lastProgressAt = 0,
    noProgressMs = 30_000
  } = {}) {
    if (!workerRunning || !liveWorker || !taskMatches) return false;
    // A live sendTask call may briefly expose the durable plan-ready boundary
    // before the confirmation turn is reflected by the page bridge. Releasing
    // that request here races the normal send-confirm step and creates an
    // endless abort/retry loop. The workflow heartbeat owns genuine dispatch
    // stalls; this probe is only for an already-released native bridge lock.
    if (taskDispatching === true) return false;
    if (Number(now) - Number(lastProbeAt || 0) < Math.max(0, Number(cooldownMs) || 0)) return false;
    const progressAt = Number.isFinite(Number(lastProgressAt))
      ? Number(lastProgressAt)
      : Date.parse(String(lastProgressAt || ""));
    if (progressAt > 0 && Number(now) - progressAt < Math.max(0, Number(noProgressMs) || 0)) return false;
    if (inspection.generating === true || inspection.responseInFlight === true) return false;
    if (inspection.patrolState?.generating === true || inspection.patrolState?.responseInFlight === true) return false;
    const stage = String(inspection.stage || inspection.patrolState?.stage || "").trim();
    if ((stage === "archived" || stage === "completed") && inspection.canInjectNext === true) return true;
    return stage === "plan-ready"
      && inspection.patrolState?.safeToAct === true
      && String(inspection.patrolState?.nextActionKey || "") === "send-confirm";
  }

  function shouldRebindSubmittedTaskAtFreeBoundary({
    task = {},
    inspection = {},
    taskMatches = false
  } = {}) {
    // Once a material has been submitted, the visible page being a different
    // archived work is evidence that we are looking at the wrong conversation,
    // not permission to erase the task identity and upload it again. Recovery
    // must navigate back to the task-owned /c/... URL or wait for that evidence.
    if (task?._submittedToGpt === true && task?.taskType === "material") return false;
    return false;
  }

  // The page, checkpoint and runtime can disagree for a short period after a
  // reload.  This is the one shared ordering used by every recovery caller:
  // durable archive/copy evidence wins over image/plan labels, and an
  // uncertain page never authorizes a new prompt.
  function resolveWorkflowStage({
    archived = false,
    copyReady = false,
    imageCount = 0,
    expectedImageCount = 0,
    planReady = false,
    generating = false
  } = {}) {
    if (archived) return "archived";
    if (copyReady) return "copy-ready";
    const images = Math.max(0, Number(imageCount || 0));
    const expected = Math.max(0, Number(expectedImageCount || 0));
    if (expected > 0 && images >= expected) return "images-ready";
    if (planReady) return "plan-ready";
    if (generating) return "generating";
    return "unknown";
  }

  function nextWorkflowAction(stage = "unknown") {
    return ({
      archived: "none",
      "copy-ready": "download-and-package",
      "images-ready": "request-copy",
      "plan-ready": "send-confirm",
      generating: "wait",
      unknown: "inspect"
    })[String(stage || "unknown")] || "inspect";
  }

  function shouldEscalateNoProgress({
    lastProgressAt = 0,
    stageStartedAt = 0,
    now = Date.now(),
    hasRealProgress = false,
    userHold = false,
    quotaWait = false
  } = {}) {
    if (userHold || quotaWait || hasRealProgress) return false;
    const baseline = Number(lastProgressAt || stageStartedAt || 0);
    return Number.isFinite(baseline)
      && baseline > 0
      && Number(now) - baseline >= NO_PROGRESS_RECOVERY_LINE_MS;
  }

  function nextWindowRecoveryAction({
    refreshesInWindow = 0,
    recreateAttempted = false,
    recreateSucceeded = false,
    generating = false,
    userHold = false,
    quotaWait = false,
    allEligibleWindowsUnavailable = false,
    globalRestartAt = 0,
    now = Date.now()
  } = {}) {
    if (userHold) return { action: "hold", reason: "user-hold" };
    if (quotaWait) return { action: "wait-quota", reason: "real-quota-boundary" };
    if (generating) return { action: "wait", reason: "generation-in-progress" };
    if (Number(refreshesInWindow || 0) < 2) {
      return { action: "refresh-conversation", maxInWindow: 2 };
    }
    if (!recreateAttempted) return { action: "recreate-browser", maxRefreshes: 2 };
    if (recreateSucceeded) return { action: "reconcile-checkpoint" };
    if (allEligibleWindowsUnavailable
      && (!globalRestartAt || Number(now) - Number(globalRestartAt) >= WORKFLOW_ATTENTION_LINE_MS)) {
      return { action: "restart-workbench", reason: "all-eligible-windows-unavailable" };
    }
    return { action: "isolate-window", reason: "bounded-recovery-exhausted" };
  }

  function shouldRestartAllWindows({
    eligibleWindows = [],
    unavailableWindows = [],
    userHeldWindows = [],
    quotaWaitingWindows = [],
    now = Date.now(),
    lastRestartAt = 0,
    cooldownMs = WORKFLOW_ATTENTION_LINE_MS
  } = {}) {
    const eligible = new Set((Array.isArray(eligibleWindows) ? eligibleWindows : []).map(normalizeAccountId));
    const unavailable = new Set((Array.isArray(unavailableWindows) ? unavailableWindows : []).map(normalizeAccountId));
    const excluded = new Set([
      ...(Array.isArray(userHeldWindows) ? userHeldWindows : []),
      ...(Array.isArray(quotaWaitingWindows) ? quotaWaitingWindows : [])
    ].map(normalizeAccountId));
    const activeEligible = [...eligible].filter((id) => !excluded.has(id));
    if (!activeEligible.length || activeEligible.some((id) => !unavailable.has(id))) return false;
    return !lastRestartAt || Number(now) - Number(lastRestartAt) >= Math.max(0, Number(cooldownMs) || 0);
  }

  function shouldWaitForActiveGenerationRecovery({
    currentStage = "",
    taskStage = "",
    status = "",
    lastProgressAt = 0,
    now = Date.now(),
    graceMs = ACTIVE_GENERATION_RECOVERY_GRACE_MS
  } = {}) {
    if (String(status || "") !== "retry-wait") return false;
    const stageText = `${String(currentStage || "")} ${String(taskStage || "")}`;
    if (!/生图|生成图片|等待图片|生成中|image/i.test(stageText)) return false;
    const progressAt = Number(lastProgressAt || 0);
    return progressAt > 0
      && Number(now) - progressAt >= 0
      && Number(now) - progressAt < Math.max(0, Number(graceMs) || 0);
  }

  function isQuotaConsumingAction(action = "") {
    return ["send-confirm", "regenerate-batch", "generate-images"].includes(String(action || ""));
  }

  function nextAutomaticRecoveryAction({
    state = {},
    runtime = {},
    settings = {},
    task = {},
    result = {},
    transient = false,
    now = Date.now()
  } = {}) {
    if (hasExplicitUserHold(state, runtime, settings) || result.reason === "stopped") {
      return { action: "hold", attempts: Math.max(0, Number(task._autoRecoveryAttempts || 0)) };
    }
    if (result.reason === "quota" || result.gptLimit === true || task._quotaLimit === true) {
      return { action: "wait-quota", attempts: Math.max(0, Number(task._autoRecoveryAttempts || 0)) };
    }
    const attempts = Math.max(0, Number(task._autoRecoveryAttempts || 0)) + 1;
    const delayMs = Math.min(
      AUTOMATIC_RECOVERY_MAX_DELAY_MS,
      AUTOMATIC_RECOVERY_BASE_DELAY_MS * (2 ** Math.min(4, attempts - 1))
    );
    // A transient bridge/page failure is an account environment condition,
    // not a bad material. Retry a few times, then keep the same checkpoint in
    // a bounded environment hold so the browser/application recovery chain can
    // escalate it. Never advance through and quarantine every material merely
    // because one account URL or bridge is unavailable.
    if (attempts <= AUTOMATIC_RECOVERY_RETRY_LIMIT) {
      return { action: "retry", attempts, delayMs, unlimited: false };
    }
    if (transient) {
      const recoveryStartedAt = Math.max(0, Number(task._autoRecoveryStartedAt || now) || now);
      const recoveryDeadlineAt = Math.max(
        recoveryStartedAt,
        Number(task._autoRecoveryDeadlineAt || recoveryStartedAt + AUTOMATIC_RECOVERY_ENVIRONMENT_WAIT_LIMIT_MS)
          || recoveryStartedAt + AUTOMATIC_RECOVERY_ENVIRONMENT_WAIT_LIMIT_MS
      );
      const remainingMs = Math.max(0, recoveryDeadlineAt - now);
      if (remainingMs <= 0 || attempts >= AUTOMATIC_RECOVERY_STAGNATION_LIMIT) {
        return {
          action: "hold-environment",
          attempts,
          delayMs: 1_500,
          unlimited: false,
          exceeded: true,
          recoveryStartedAt,
          recoveryDeadlineAt,
          remainingMs: 0
        };
      }
      return {
        action: "wait-environment",
        attempts,
        delayMs: Math.min(AUTOMATIC_RECOVERY_MAX_DELAY_MS, remainingMs),
        unlimited: false,
        recoveryStartedAt,
        recoveryDeadlineAt,
        remainingMs
      };
    }
    return { action: "defer", attempts, delayMs: 1_500 };
  }

  function shouldDeferStagnantRecovery({ task = {}, result = {}, inspection = {} } = {}) {
    const attempts = Math.max(0, Number(task._autoRecoveryAttempts || 0));
    if (attempts < AUTOMATIC_RECOVERY_STAGNATION_LIMIT) return false;
    if (task._quotaLimit === true || result.reason === "quota" || result.gptLimit === true) return false;
    if (result.reason === "hold" || result.reason === "stopped") return false;
    if (inspection.generating === true || inspection.responseInFlight === true) return false;
    if (inspection.patrolState?.generating === true || inspection.patrolState?.responseInFlight === true) return false;
    const code = String(result.errorCode || task._errorCode || "");
    const safeTransportCodes = new Set([
      "GPT_PAGE_NOT_READY",
      "GPT_PAGE_RELOADED",
      "GPT_AUTOMATIC_RECOVERY_ABORTED",
      "GPT_WORKFLOW_POST_SUBMIT_STALLED",
      "GPT_ORIGINAL_CONVERSATION_BOUNDARY_PENDING",
      "GPT_INSPECTION_UNAVAILABLE",
      "GPT_NAVIGATION_FAILED",
      "EXTENSION_NOT_READY",
      "LOCAL_BRIDGE_FETCH_FAILED"
    ]);
    return safeTransportCodes.has(code) || result.reason === "transient-retry-wait" || result.reason === "heartbeat-retry-wait";
  }

  function shouldRecoverStalledSubmittedWorkflow({
    task = {},
    status = {},
    startedAt = 0,
    lastProgressAt = 0,
    now = Date.now()
  } = {}) {
    const submitted = task._submittedToGpt === true
      || status.submittedToGpt === true
      || status.planSubmitted === true;
    if (!submitted) return false;
    const bridgeStatus = String(status.status || "").trim().toLowerCase();
    if (["completed", "failed", "cancelled", "canceled"].includes(bridgeStatus)) return false;
    const stage = String(status.stage || task._stage || "").trim();
    if (/下载|打包|归档/.test(stage)) return false;
    const generating = status.generating === true
      || status.responseInFlight === true
      || status.patrolState?.generating === true
      || status.patrolState?.responseInFlight === true
      || /生图|生成图片|等待图片/.test(stage);
    const limit = generating
      ? POST_SUBMIT_GENERATION_STALL_LIMIT_MS
      : POST_SUBMIT_IDLE_STALL_LIMIT_MS;
    const baseline = Number(lastProgressAt || startedAt || 0);
    if (!Number.isFinite(baseline) || baseline <= 0) return false;
    return Number(now) - baseline >= limit;
  }

  function serialize(state = {}) {
    const queue = Array.isArray(state.queue) ? state.queue : [];
    return {
      version: 1,
      accountId: normalizeAccountId(state.accountId),
      queue,
      queueIndex: Math.max(0, Math.min(queue.length, Number(state.queueIndex || 0))),
      selectedMaterials: [...(state.selectedMaterials instanceof Set ? state.selectedMaterials : new Set(state.selectedMaterials || []))],
      selectedTemplates: [...(state.selectedTemplates instanceof Set ? state.selectedTemplates : new Set(state.selectedTemplates || []))],
      extraPrompt: String(state.extraPrompt || ""),
      armed: Boolean(state.armed),
      pausedByUser: Boolean(state.pausedByUser),
      stoppedByUser: Boolean(state.stoppedByUser),
      autoRunning: Boolean(state.autoRunning),
      autoPaused: Boolean(state.autoPaused),
      queuePaused: Boolean(state.queuePaused),
      currentManualTask: state.currentManualTask || null,
      semiAutoPendingTask: state.semiAutoPendingTask || null,
      lastFailedTask: state.lastFailedTask || null,
      lastFailedStage: String(state.lastFailedStage || ""),
      lastFailedPercent: Number(state.lastFailedPercent || 0),
      quotaPauseStatus: String(state.quotaPauseStatus || ""),
      successfulOutputs: Math.max(0, Number(state.successfulOutputs || 0)),
      firstValidOutputAt: String(state.firstValidOutputAt || ""),
      lastValidOutputAt: String(state.lastValidOutputAt || ""),
      updatedAt: Date.now()
    };
  }

  function restore(accountId, saved = {}) {
    const state = create(accountId, saved);
    // A pre-0.19.66 renderer could quarantine a task after repeated GPT page
    // readiness failures. That was a transport problem, not a bad material:
    // revive only that unambiguous legacy signature so the queue can resume
    // after the page becomes healthy. Real image-boundary quarantines remain
    // terminal and still require review.
    let firstRevivedIndex = -1;
    state.queue.forEach((task, index) => {
      const error = String(task?._error || "");
      if (task?._status !== "skipped"
        || task?._errorCode !== "AUTO_RECOVERY_QUARANTINED"
        || !/GPT 网页状态尚未确认|GPT 网页重接后仍未就绪|网页\/桥接暂态/.test(error)) return;
      task._status = "queued";
      task._stage = String(task._stage || task.retryFromStage || "恢复中");
      task._percent = Number(task.retryFromPercent || task._percent || 0);
      task._errorCode = "GPT_PAGE_NOT_READY";
      task._error = "GPT 网页暂态未就绪；保留当前检查点并等待自动续接";
      task._autoRecoveryAttempts = 0;
      task._autoRecoveryDeferrals = 0;
      delete task._endedAt;
      if (firstRevivedIndex < 0) firstRevivedIndex = index;
    });
    if (firstRevivedIndex >= 0) state.queueIndex = Math.min(state.queueIndex, firstRevivedIndex);
    const savedWasRunning = Boolean(saved.autoRunning)
      || String(state.queue?.[state.queueIndex]?._status || "") === "running";
    state.queueIndex = nextPendingIndex(state);
    // `autoRunning` and `autoPaused` describe the old renderer process, not a
    // durable operator choice. A renderer/app restart must release that
    // ephemeral lock so a fresh worker can reclaim the same checkpoint.
    state.autoRunning = false;
    state.autoPaused = false;
    if (savedWasRunning) {
      const task = state.queue[state.queueIndex];
      if (task && !TERMINAL_STATUSES.has(String(task._status || ""))) {
        task._status = "queued";
        task._errorCode = "RESTART_INTERRUPTED";
        task._error = "工作台重启中断了当前执行";
        state.lastFailedTask = task;
        state.lastFailedStage = String(task._stage || state.lastFailedStage || "");
        state.lastFailedPercent = Number(task._percent || state.lastFailedPercent || 0);
      }
    }
    return state;
  }

  return {
    TERMINAL_STATUSES,
    AUTOMATIC_RECOVERY_RETRY_LIMIT,
    AUTOMATIC_RECOVERY_STAGNATION_LIMIT,
    POST_SUBMIT_IDLE_STALL_LIMIT_MS,
    POST_SUBMIT_GENERATION_STALL_LIMIT_MS,
    WORKFLOW_ATTENTION_LINE_MS,
    NO_PROGRESS_RECOVERY_LINE_MS,
    STAGE_TIMEOUTS_MS,
    AUTOMATIC_RECOVERY_ENVIRONMENT_WAIT_LIMIT_MS,
    ACTIVE_GENERATION_RECOVERY_GRACE_MS,
    normalizeAccountId,
    create,
    shouldWaitForActiveGenerationRecovery,
    restore,
    serialize,
    nextPendingIndex,
    isTerminalTask,
    isCurrentTask,
    hasPending,
    hasExplicitUserHold,
    shouldAutoArm,
    shouldReleaseLegacyInspectionHold,
    shouldInterruptStuckWorker,
    shouldRebindSubmittedTaskAtFreeBoundary,
    resolveWorkflowStage,
    nextWorkflowAction,
    shouldEscalateNoProgress,
    nextWindowRecoveryAction,
    shouldRestartAllWindows,
    isQuotaConsumingAction,
    nextAutomaticRecoveryAction,
    shouldDeferStagnantRecovery,
    shouldRecoverStalledSubmittedWorkflow
  };
});
