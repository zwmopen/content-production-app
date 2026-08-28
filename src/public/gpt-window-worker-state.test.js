const test = require("node:test");
const assert = require("node:assert/strict");
const WorkerState = require("./gpt-window-worker-state.js");

test("GPT worker state keeps two account windows independent", () => {
  const first = WorkerState.create("account-a", {
    queue: [{ requestId: "a-1", _status: "queued" }],
    selectedMaterials: ["material-a"],
    selectedTemplates: ["template-a"]
  });
  const second = WorkerState.create("account-b", {
    queue: [{ requestId: "b-1", _status: "queued" }],
    selectedMaterials: ["material-b"],
    selectedTemplates: ["template-b"]
  });

  first.autoRunning = true;
  first.queue[0]._status = "completed";
  first.queueIndex = 1;

  assert.equal(first.autoRunning, true);
  assert.equal(second.autoRunning, false);
  assert.deepEqual([...first.selectedMaterials], ["material-a"]);
  assert.deepEqual([...second.selectedMaterials], ["material-b"]);
  assert.equal(WorkerState.hasPending(first), false);
  assert.equal(WorkerState.hasPending(second), true);
});

test("GPT worker state ignores stale tasks before the current queue index", () => {
  const state = WorkerState.create("account-a", {
    queue: [
      { requestId: "legacy-task" },
      { requestId: "completed-task", _status: "completed" }
    ],
    queueIndex: 2
  });

  assert.equal(WorkerState.hasPending(state), false);
  state.queueIndex = 0;
  assert.equal(WorkerState.hasPending(state), true);
});

test("durable archive result is terminal even if a late callback left queued status", () => {
  const state = WorkerState.create("account-a", {
    queue: [
      {
        requestId: "archived-task",
        _status: "queued",
        _completedAt: "2026-08-24T03:31:48.036Z",
        _result: { packagePath: "D:/archive/package" }
      },
      { requestId: "next-task", _status: "queued" }
    ],
    queueIndex: 0
  });

  assert.equal(WorkerState.isTerminalTask(state.queue[0]), true);
  assert.equal(WorkerState.nextPendingIndex(state), 1);
  assert.equal(WorkerState.hasPending(state), true);
  state.queueIndex = 1;
  assert.equal(WorkerState.hasPending(state), true);
});

test("late recovery callbacks cannot own a task after the serial cursor moves", () => {
  const state = WorkerState.create("account-a", {
    queue: [
      { requestId: "old-task", _status: "skipped" },
      { requestId: "current-task", _status: "running" }
    ],
    queueIndex: 1
  });

  assert.equal(WorkerState.isCurrentTask(state, state.queue[0]), false);
  assert.equal(WorkerState.isCurrentTask(state, state.queue[1]), true);
  assert.equal(WorkerState.isCurrentTask(state, { requestId: "current-task" }), true);
});

test("GPT worker state restores a paused checkpoint without changing another window", () => {
  const saved = WorkerState.serialize(WorkerState.create("account-a", {
    queue: [
      { requestId: "a-1", _status: "completed" },
      { requestId: "a-2", _status: "paused", _stage: "等待归档" }
    ],
    queueIndex: 0,
    queuePaused: true,
    lastFailedStage: "等待归档"
  }));
  const restored = WorkerState.restore("account-a", saved);
  const other = WorkerState.create("account-b", { queue: [{ requestId: "b-1", _status: "queued" }] });

  assert.equal(restored.queueIndex, 1);
  assert.equal(restored.queuePaused, true);
  assert.equal(restored.lastFailedStage, "等待归档");
  assert.equal(other.queueIndex, 0);
  assert.equal(other.queue[0].requestId, "b-1");
});

test("automatic startup ignores recoverable queue pauses but respects an explicit user hold", () => {
  const automaticCheckpoint = WorkerState.create("account-a", {
    queue: [{ requestId: "a-1", _status: "paused" }],
    queuePaused: true,
    armed: false
  });
  const runtime = { status: "failed", pausedByUser: false, stoppedByUser: false };

  assert.equal(WorkerState.hasExplicitUserHold(automaticCheckpoint, runtime, { continuousAutoStart: true }), false);
  assert.equal(WorkerState.shouldAutoArm(automaticCheckpoint, runtime, { continuousAutoStart: true }), true);

  const userPaused = WorkerState.create("account-a", { queuePaused: true, pausedByUser: true });
  assert.equal(WorkerState.shouldAutoArm(userPaused, runtime, { continuousAutoStart: true }), false);
  assert.equal(WorkerState.shouldAutoArm(automaticCheckpoint, runtime, { continuousAutoStart: false }), false);
});

test("startup releases only legacy inspection safety holds for enabled automatic lanes", () => {
  const state = WorkerState.create("account-a", { pausedByUser: true, queuePaused: true });
  const runtime = {
    status: "idle",
    currentStage: "手动模式，不参与自动生产",
    pausedByUser: false,
    stoppedByUser: false,
    reason: "inspection-safety-hold: bridge/auth loop"
  };
  const settings = { mode: "single", continuousAutoStart: true };

  assert.equal(WorkerState.shouldReleaseLegacyInspectionHold(state, runtime, settings, { disabled: false }), true);
  assert.equal(WorkerState.shouldReleaseLegacyInspectionHold(state, { ...runtime, reason: "" }, settings, { disabled: false }), false);
  assert.equal(WorkerState.shouldReleaseLegacyInspectionHold(state, runtime, settings, { disabled: true }), false);
  assert.equal(WorkerState.shouldReleaseLegacyInspectionHold({ ...state, stoppedByUser: true }, runtime, settings, { disabled: false }), false);
  assert.equal(WorkerState.shouldReleaseLegacyInspectionHold(state, runtime, { ...settings, mode: "manual" }, { disabled: false }), false);
});

test("stuck worker is released only at a matching safe live conversation boundary", () => {
  const base = {
    workerRunning: true,
    liveWorker: true,
    taskMatches: true,
    now: 20_000,
    lastProbeAt: 0
  };
  assert.equal(WorkerState.shouldInterruptStuckWorker({
    ...base,
    inspection: { stage: "archived", canInjectNext: true }
  }), true);
  assert.equal(WorkerState.shouldInterruptStuckWorker({
    ...base,
    inspection: {
      stage: "plan-ready",
      patrolState: { safeToAct: true, nextActionKey: "send-confirm" }
    }
  }), true);
  assert.equal(WorkerState.shouldInterruptStuckWorker({
    ...base,
    taskDispatching: true,
    inspection: {
      stage: "plan-ready",
      patrolState: { safeToAct: true, nextActionKey: "send-confirm" }
    }
  }), false);
  assert.equal(WorkerState.shouldInterruptStuckWorker({
    ...base,
    inspection: { stage: "archived", canInjectNext: true, generating: true }
  }), false);
  assert.equal(WorkerState.shouldInterruptStuckWorker({
    ...base,
    taskMatches: false,
    inspection: { stage: "archived", canInjectNext: true }
  }), false);
  assert.equal(WorkerState.shouldInterruptStuckWorker({
    ...base,
    lastProbeAt: 10_000,
    inspection: { stage: "archived", canInjectNext: true }
  }), false);
  assert.equal(WorkerState.shouldInterruptStuckWorker({
    ...base,
    now: 40_000,
    lastProgressAt: 25_000,
    inspection: { stage: "archived", canInjectNext: true }
  }), false);
});

test("a submitted unfinished task keeps its identity when another archived material is visible", () => {
  const task = {
    taskType: "material",
    _submittedToGpt: true,
    _status: "queued",
    conversationUrl: "https://chatgpt.com/c/current-work",
    workflow: { planSubmitted: true, imageSubmitted: true }
  };
  const freeArchive = { stage: "archived", canInjectNext: true, generating: false };
  assert.equal(WorkerState.shouldRebindSubmittedTaskAtFreeBoundary({ task, inspection: freeArchive, taskMatches: false }), false);
  assert.equal(WorkerState.shouldRebindSubmittedTaskAtFreeBoundary({ task, inspection: freeArchive, taskMatches: true }), false);
  assert.equal(WorkerState.shouldRebindSubmittedTaskAtFreeBoundary({ task: { ...task, _submittedToGpt: false }, inspection: freeArchive, taskMatches: false }), false);
  assert.equal(WorkerState.shouldRebindSubmittedTaskAtFreeBoundary({ task, inspection: { ...freeArchive, generating: true }, taskMatches: false }), false);
  assert.equal(WorkerState.shouldRebindSubmittedTaskAtFreeBoundary({ task, inspection: { stage: "plan-ready", canInjectNext: false }, taskMatches: false }), false);
});

test("restoring a running worker releases the old renderer lock and marks its checkpoint", () => {
  const restored = WorkerState.restore("account-a", {
    autoRunning: true,
    queueIndex: 0,
    queue: [{ requestId: "a-1", _status: "running", _submittedToGpt: true, _stage: "等待图片", _percent: 48 }]
  });

  assert.equal(restored.autoRunning, false);
  assert.equal(restored.autoPaused, false);
  assert.equal(restored.queueIndex, 0);
  assert.equal(restored.queue[0]._status, "queued");
  assert.equal(restored.queue[0]._errorCode, "RESTART_INTERRUPTED");
  assert.equal(restored.lastFailedTask, restored.queue[0]);
});

test("automatic recovery retries ordinary failures, but eventually defers a bad task", () => {
  const retry = WorkerState.nextAutomaticRecoveryAction({
    task: { _autoRecoveryAttempts: 0 },
    result: { reason: "production-failed" },
    transient: false,
    settings: { continuousAutoStart: true }
  });
  assert.equal(retry.action, "retry");
  assert.equal(retry.attempts, 1);
  assert.ok(retry.delayMs >= 5_000);

  const defer = WorkerState.nextAutomaticRecoveryAction({
    task: { _autoRecoveryAttempts: 3 },
    result: { reason: "production-failed" },
    transient: false,
    settings: { continuousAutoStart: true }
  });
  assert.equal(defer.action, "defer");
  assert.equal(defer.attempts, 4);
});

test("automatic recovery waits for a transient bridge failure only within a finite budget", () => {
  const wait = WorkerState.nextAutomaticRecoveryAction({
    task: { _autoRecoveryAttempts: 3 },
    result: { reason: "网页/桥接临时失败" },
    transient: true,
    settings: { continuousAutoStart: true },
    now: 1_000
  });
  assert.equal(wait.action, "wait-environment");
  assert.equal(wait.attempts, 4);
  assert.equal(wait.unlimited, false);
  assert.equal(wait.recoveryDeadlineAt, 901_000);
  assert.equal(wait.delayMs, 2 * 60_000);
  const expired = WorkerState.nextAutomaticRecoveryAction({
    task: { _autoRecoveryAttempts: 4, _autoRecoveryStartedAt: 1_000, _autoRecoveryDeadlineAt: 10_000 },
    result: { reason: "网页/桥接临时失败" },
    transient: true,
    settings: { continuousAutoStart: true },
    now: 10_000
  });
  assert.equal(expired.action, "hold-environment");
  assert.equal(expired.exceeded, true);
});

test("stagnant transient recovery is deferred only after repeated no-progress rounds", () => {
  const base = {
    result: { errorCode: "GPT_PAGE_NOT_READY", reason: "transient-retry-wait" },
    inspection: {}
  };
  assert.equal(WorkerState.shouldDeferStagnantRecovery({
    ...base,
    task: { _autoRecoveryAttempts: 7 }
  }), false);
  assert.equal(WorkerState.shouldDeferStagnantRecovery({
    ...base,
    task: { _autoRecoveryAttempts: 8 }
  }), true);
  assert.equal(WorkerState.shouldDeferStagnantRecovery({
    ...base,
    task: { _autoRecoveryAttempts: 8 },
    inspection: { generating: true }
  }), false);
  assert.equal(WorkerState.shouldDeferStagnantRecovery({
    ...base,
    task: { _autoRecoveryAttempts: 8, _quotaLimit: true },
    result: { errorCode: "GPT_PAGE_NOT_READY", reason: "quota" }
  }), false);
});

test("submitted workflow is recovered only after a bounded post-submit stall", () => {
  const now = 1_000_000;
  const idleLimit = WorkerState.POST_SUBMIT_IDLE_STALL_LIMIT_MS;
  const generationLimit = WorkerState.POST_SUBMIT_GENERATION_STALL_LIMIT_MS;
  assert.equal(WorkerState.shouldRecoverStalledSubmittedWorkflow({
    task: { _submittedToGpt: false, _stage: "等待文案" },
    startedAt: now - idleLimit - 1,
    now
  }), false);
  assert.equal(WorkerState.shouldRecoverStalledSubmittedWorkflow({
    task: { _submittedToGpt: true, _stage: "等待文案" },
    startedAt: now - idleLimit + 1,
    now
  }), false);
  assert.equal(WorkerState.shouldRecoverStalledSubmittedWorkflow({
    task: { _submittedToGpt: true, _stage: "等待文案" },
    startedAt: now - idleLimit - 1,
    now
  }), true);
  assert.equal(WorkerState.shouldRecoverStalledSubmittedWorkflow({
    task: { _submittedToGpt: true, _stage: "等待图片" },
    status: { generating: true },
    startedAt: now - generationLimit + 1,
    now
  }), false);
  assert.equal(WorkerState.shouldRecoverStalledSubmittedWorkflow({
    task: { _submittedToGpt: true, _stage: "等待图片" },
    status: { generating: true },
    startedAt: now - generationLimit - 1,
    now
  }), true);
  assert.equal(WorkerState.shouldRecoverStalledSubmittedWorkflow({
    task: { _submittedToGpt: true, _stage: "下载图片" },
    startedAt: now - idleLimit * 2,
    now
  }), false);
});

test("restore revives only legacy page-readiness quarantines", () => {
  const restored = WorkerState.restore("account-a", {
    queueIndex: 2,
    queue: [
      { requestId: "image-boundary", _status: "skipped", _errorCode: "AUTO_RECOVERY_QUARANTINED", _error: "图片边界无法确认" },
      { requestId: "page-quarantine", _status: "skipped", _errorCode: "AUTO_RECOVERY_QUARANTINED", _error: "GPT 网页状态尚未确认；已暂缓发送" },
      { requestId: "next", _status: "queued" }
    ]
  });

  assert.equal(restored.queue[0]._status, "skipped");
  assert.equal(restored.queue[1]._status, "queued");
  assert.equal(restored.queue[1]._errorCode, "GPT_PAGE_NOT_READY");
  assert.equal(restored.queueIndex, 1);
});

test("automatic recovery waits for quota and never overrides an explicit user hold", () => {
  const quota = WorkerState.nextAutomaticRecoveryAction({
    task: { _autoRecoveryAttempts: 2, _quotaLimit: true },
    result: { reason: "quota", gptLimit: true },
    settings: { continuousAutoStart: true }
  });
  assert.equal(quota.action, "wait-quota");

  const held = WorkerState.nextAutomaticRecoveryAction({
    state: { pausedByUser: true },
    runtime: {},
    task: { _autoRecoveryAttempts: 0 },
    result: { reason: "production-failed" },
    settings: { continuousAutoStart: true }
  });
  assert.equal(held.action, "hold");
});

test("workflow evidence uses archive, copy, image, plan, generation priority", () => {
  assert.equal(WorkerState.resolveWorkflowStage({ archived: true, copyReady: true, imageCount: 1, expectedImageCount: 10, planReady: true }), "archived");
  assert.equal(WorkerState.resolveWorkflowStage({ copyReady: true, imageCount: 1, expectedImageCount: 10, planReady: true }), "copy-ready");
  assert.equal(WorkerState.resolveWorkflowStage({ copyReady: false, imageCount: 10, expectedImageCount: 10, planReady: true }), "images-ready");
  assert.equal(WorkerState.resolveWorkflowStage({ imageCount: 1, expectedImageCount: 10, planReady: true }), "plan-ready");
  assert.equal(WorkerState.resolveWorkflowStage({ generating: true }), "generating");
  assert.equal(WorkerState.nextWorkflowAction("copy-ready"), "download-and-package");
  assert.equal(WorkerState.nextWorkflowAction("images-ready"), "request-copy");
  assert.equal(WorkerState.nextWorkflowAction("plan-ready"), "send-confirm");
});

test("no progress escalates after ten minutes but not during real progress, quota wait, or user hold", () => {
  const now = 1_000_000;
  assert.equal(WorkerState.shouldEscalateNoProgress({ lastProgressAt: now - WorkerState.NO_PROGRESS_RECOVERY_LINE_MS - 1, now }), true);
  assert.equal(WorkerState.shouldEscalateNoProgress({ lastProgressAt: now - WorkerState.NO_PROGRESS_RECOVERY_LINE_MS - 1, hasRealProgress: true, now }), false);
  assert.equal(WorkerState.shouldEscalateNoProgress({ lastProgressAt: now - WorkerState.NO_PROGRESS_RECOVERY_LINE_MS - 1, quotaWait: true, now }), false);
  assert.equal(WorkerState.shouldEscalateNoProgress({ lastProgressAt: now - WorkerState.NO_PROGRESS_RECOVERY_LINE_MS - 1, userHold: true, now }), false);
});

test("window recovery escalates from two refreshes to browser recreation and one bounded app restart", () => {
  assert.equal(WorkerState.nextWindowRecoveryAction({ refreshesInWindow: 0 }).action, "refresh-conversation");
  assert.equal(WorkerState.nextWindowRecoveryAction({ refreshesInWindow: 2 }).action, "recreate-browser");
  assert.equal(WorkerState.nextWindowRecoveryAction({ refreshesInWindow: 2, recreateAttempted: true, recreateSucceeded: true }).action, "reconcile-checkpoint");
  assert.equal(WorkerState.nextWindowRecoveryAction({ refreshesInWindow: 2, recreateAttempted: true, allEligibleWindowsUnavailable: true }).action, "restart-workbench");
  assert.equal(WorkerState.nextWindowRecoveryAction({ refreshesInWindow: 2, recreateAttempted: true, allEligibleWindowsUnavailable: true, globalRestartAt: Date.now() }).action, "isolate-window");
});

test("active image generation gets finite grace before bridge recovery refresh", () => {
  assert.equal(WorkerState.shouldWaitForActiveGenerationRecovery({
    currentStage: "等待图片",
    status: "retry-wait",
    lastProgressAt: 1000,
    now: 1000 + 60_000
  }), true);
  assert.equal(WorkerState.shouldWaitForActiveGenerationRecovery({
    currentStage: "网页/桥接临时失败",
    taskStage: "等待图片",
    status: "retry-wait",
    lastProgressAt: 1000,
    now: 1000 + 60_000
  }), true);
  assert.equal(WorkerState.shouldWaitForActiveGenerationRecovery({
    currentStage: "等待图片",
    status: "retry-wait",
    lastProgressAt: 1000,
    now: 1000 + WorkerState.ACTIVE_GENERATION_RECOVERY_GRACE_MS + 1
  }), false);
  assert.equal(WorkerState.shouldWaitForActiveGenerationRecovery({
    currentStage: "等待文案",
    status: "retry-wait",
    lastProgressAt: 1000,
    now: 1000 + 60_000
  }), false);
});

test("global restart only applies when every eligible automatic window is unavailable", () => {
  assert.equal(WorkerState.shouldRestartAllWindows({ eligibleWindows: ["a", "b"], unavailableWindows: ["a", "b"] }), true);
  assert.equal(WorkerState.shouldRestartAllWindows({ eligibleWindows: ["a", "b"], unavailableWindows: ["a"], userHeldWindows: ["b"] }), true);
  assert.equal(WorkerState.shouldRestartAllWindows({ eligibleWindows: ["a", "b"], unavailableWindows: ["a"], quotaWaitingWindows: ["b"] }), true);
  assert.equal(WorkerState.shouldRestartAllWindows({ eligibleWindows: ["a", "b"], unavailableWindows: ["a"] }), false);
});

test("refresh, recreation, and restart never count as image quota actions", () => {
  assert.equal(WorkerState.isQuotaConsumingAction("refresh-conversation"), false);
  assert.equal(WorkerState.isQuotaConsumingAction("recreate-browser"), false);
  assert.equal(WorkerState.isQuotaConsumingAction("restart-workbench"), false);
  assert.equal(WorkerState.isQuotaConsumingAction("request-copy"), false);
  assert.equal(WorkerState.isQuotaConsumingAction("send-confirm"), true);
});
