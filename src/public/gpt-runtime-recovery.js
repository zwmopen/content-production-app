(function exposeGptRuntimeRecovery(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TBGptRuntimeRecovery = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGptRuntimeRecoveryApi() {
  function createController(deps = {}) {
    const delay = deps.delay || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

    function isImageCompletionReady(task = {}, inspection = {}) {
      if (!inspection || inspection.generating === true || inspection.responseInFlight === true) return false;
      const expected = Math.max(1, Number(
        task.workflow?.plannedImageCount
        || task.expectedImages
        || inspection.expectedImageCount
        || 1
      ));
      const actual = Math.max(0, Number(
        inspection.latestImageCount
        || inspection.detectedImageCount
        || inspection.actualImages
        || 0
      ));
      const stage = String(inspection.stage || "");
      const patrolKey = String(inspection.patrolState?.key || "");
      const readyStage = stage === "images-ready"
        || patrolKey === "awaiting-copy"
        || patrolKey === "complete";
      return inspection.safeToAct !== false && (actual >= expected || readyStage);
    }

    async function checkImageUncertainty(state) {
      const task = state.currentTask;
      if (!task || String(task._errorCode || "") !== "IMAGE_COUNT_UNCERTAIN") return false;
      if (task._submittedToGpt !== true || !String(task.requestId || "").trim()) return false;
      if (Number(task._imageUncertainRecoveryCount || 0) >= 3) return false;
      if (!state.continuousMode || !state.continuousArmed || state.retryPending) return false;
      if (state.windowStopped || state.windowPaused || state.autoRunning) return false;

      const accountId = String(task.accountId || deps.getActiveAccountId?.() || "");
      const firstInspection = await deps.inspect?.(accountId).catch(() => null);
      if (!isImageCompletionReady(task, firstInspection)) return false;

      await delay(3000);
      const latestState = deps.getState?.() || {};
      const latestTask = latestState.currentTask;
      if (!latestState.queuePaused || latestState.autoRunning) return false;
      if (latestState.windowStopped || latestState.windowPaused) return false;
      if (String(latestTask?.requestId || "") !== String(task.requestId || "")) return false;
      if (String(latestTask?._errorCode || "") !== "IMAGE_COUNT_UNCERTAIN") return false;

      const confirmed = await deps.inspect?.(accountId).catch(() => null);
      if (!isImageCompletionReady(task, confirmed)) return false;
      await deps.resumeImageUncertainty?.({ task, accountId, inspection: confirmed });
      return true;
    }

    async function checkRestartInterruptedCheckpoint(state) {
      const task = state.currentTask;
      if (!task || String(task._errorCode || "") !== "RESTART_INTERRUPTED") return false;
      if (task._submittedToGpt !== true || !String(task.requestId || "").trim()) return false;
      if (!/等待图片|图片/i.test(String(task._stage || task.retryFromStage || ""))) return false;
      // A renderer restart deliberately clears the armed flag. Recovery is
      // still safe here because it is limited to the already-submitted task;
      // explicit user pause/stop flags remain hard boundaries below.
      if (!state.continuousMode || state.retryPending) return false;
      if (state.windowStopped || state.windowPaused || state.autoRunning) return false;

      const accountId = String(task.accountId || deps.getActiveAccountId?.() || "");
      const firstInspection = await deps.inspect?.(accountId).catch(() => null);
      if (!isImageCompletionReady(task, firstInspection)) return false;

      await delay(3000);
      const latestState = deps.getState?.() || {};
      const latestTask = latestState.currentTask;
      if (!latestState.queuePaused || latestState.autoRunning) return false;
      if (latestState.windowStopped || latestState.windowPaused) return false;
      if (String(latestTask?.requestId || "") !== String(task.requestId || "")) return false;
      if (String(latestTask?._errorCode || "") !== "RESTART_INTERRUPTED") return false;

      const confirmed = await deps.inspect?.(accountId).catch(() => null);
      if (!isImageCompletionReady(task, confirmed)) return false;
      await deps.resumeRestartCheckpoint?.({ task, accountId, inspection: confirmed });
      return true;
    }

    async function checkPausedQueue() {
      const state = deps.getState?.() || {};
      const integrityCode = String(state.currentTask?._errorCode || "");
      if (state.queuePaused && integrityCode) {
        if (integrityCode === "IMAGE_COUNT_UNCERTAIN") return checkImageUncertainty(state);
        if (integrityCode === "RESTART_INTERRUPTED") return checkRestartInterruptedCheckpoint(state);
        return false;
      }
      if (!state.queuePaused || state.autoRunning || state.autoPaused) return false;
      if (!state.continuousMode || !state.continuousArmed || state.retryPending) return false;
      if (state.windowStopped || state.windowPaused) return false;

      const accountId = deps.getActiveAccountId?.();
      const firstCheck = await deps.status?.(accountId).catch(() => null);
      if (!firstCheck?.productionReady) return false;

      await delay(3000);
      const latestState = deps.getState?.() || {};
      if (!latestState.queuePaused || latestState.autoRunning) return false;
      const confirmed = await deps.status?.(accountId).catch(() => null);
      if (!confirmed?.productionReady) return false;

      deps.showBubble?.("检测到 GPT 已就绪，自动恢复暂停的队列。", { duration: 4000, tone: "success" });
      deps.setQueuePaused?.(false);
      deps.resetRetryCount?.();
      deps.persistQueue?.();
      await deps.sendNext?.({ userInitiated: false, continuousResume: true });
      return true;
    }

    return { checkPausedQueue, isImageCompletionReady };
  }

  return { createController };
});
