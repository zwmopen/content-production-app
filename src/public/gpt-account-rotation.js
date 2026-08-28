(function exposeGptAccountRotation(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TBGptAccountRotation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGptAccountRotation() {
  function effectiveProductionMode(configuredMode = "manual", runState = null) {
    const mode = String(configuredMode || "manual");
    const runStatus = String(runState?.status || "");
    const unfinishedRotation = (runState?.rotation === true || runState?.mode === "rotate")
      && runState?.suspendedByModeSwitch !== true
      && ["running", "paused", "paused-integrity-boundary", "waiting-quota"].includes(runStatus);
    return unfinishedRotation ? "rotate" : mode;
  }

  function rotationRunAfterModeSwitch(runState = null, targetMode = "manual") {
    if (!runState || (runState.rotation !== true && runState.mode !== "rotate")) return runState;
    const mode = String(targetMode || "manual");
    if (mode === "rotate") {
      return {
        ...runState,
        status: runState.status === "paused-mode-switch" ? "paused" : runState.status,
        suspendedByModeSwitch: false,
        suspendedForMode: null
      };
    }
    return {
      ...runState,
      status: "paused-mode-switch",
      suspendedByModeSwitch: true,
      suspendedForMode: mode
    };
  }

  function shouldInitializeTemplate(task = {}, templateReady = false) {
    return task.taskType === "material"
      && Boolean(task.templateId)
      && task._submittedToGpt !== true
      && templateReady !== true;
  }

  function rotationResumeCheckpoint(task = {}) {
    const resuming = task.taskType === "material" && task._submittedToGpt === true;
    if (!resuming) return { resuming: false, stage: "", percent: 0 };
    const savedStage = String(task._stage || task.retryFromStage || "");
    const uploadLikeStage = !savedStage || /排队|准备|上传|附件/i.test(savedStage);
    return {
      resuming: true,
      stage: uploadLikeStage ? "等待迁移计划" : savedStage,
      percent: uploadLikeStage ? 24 : Math.max(1, Number(task._percent || task.retryFromPercent || 24))
    };
  }

  function selectMaterialAttachments(attachments = [], maxAttachments = 20) {
    const limit = Math.max(1, Number(maxAttachments || 20));
    const unique = [...new Set((Array.isArray(attachments) ? attachments : []).filter(Boolean))];
    if (unique.length <= limit) return unique;
    const copyFilePattern = /\.(?:txt|md|markdown|csv|json)$/i;
    const requiredCopyFiles = unique.filter((filePath) => copyFilePattern.test(String(filePath)));
    const selected = [
      ...requiredCopyFiles.slice(0, limit),
      ...unique.filter((filePath) => !copyFilePattern.test(String(filePath)))
    ].slice(0, limit);
    const selectedSet = new Set(selected);
    return unique.filter((filePath) => selectedSet.has(filePath));
  }

  // A renderer restart can preserve the durable "submitted" marker while an
  // older queue record has no serialized workflow object. Rebuild only the
  // minimum web-stage flags from the checkpoint so the extension resumes the
  // current conversation instead of treating it as a fresh upload.
  function resumedWorkflowState(task = {}, checkpoint = {}, runtime = {}) {
    const previous = task.workflow && typeof task.workflow === "object" ? task.workflow : {};
    const durableCopyBoundary = Boolean(
      String(previous.copyText || "").trim()
      || String(previous.copyTextPath || "").trim()
      || String(previous.packageResult?.packagePath || task._result?.packagePath || "").trim()
      || Number(task._result?.copyTextLength || 0) > 0
    );
    // The visible stage can temporarily be a generic delay while the durable
    // retry stage still carries the real boundary (for example, "补齐缺少图片").
    // Treat all persisted stage evidence as one signal.
    const stageEvidence = [checkpoint.stage, task.retryFromStage, task._stage, runtime.currentStage, runtime.lastError]
      .map((value) => String(value || ""))
      .filter(Boolean)
      .join(" ");
    const laterStage = /等待图片|生成图片|补齐缺少图片|下载图片|小红书文案|文案|打包|归档|copy|download|package|archive/i.test(stageEvidence);
    const imageStage = /等待图片|生成图片|补齐缺少图片|下载图片|图片|小红书文案|文案|打包|归档|copy|download|package|archive/i.test(stageEvidence);
    const runtimeHasImages = Number(runtime.generatedImages || 0) > 0;
    // After a renderer restart the queue may retain the plan text and the
    // submitted marker while the generic retry stage falls back to
    // "等待迁移计划". Automatic recovery deferrals are durable evidence that
    // this is no longer a fresh plan boundary: resume the confirmed image
    // turn instead of uploading the same material or sending 1 again.
    const submittedImageRecovery = previous.planSubmitted === true
      && task._submittedToGpt === true
      && Number(task._autoRecoveryDeferrals || 0) > 0;
    const plannedImageCount = Math.max(
      0,
      Number(previous.plannedImageCount || 0),
      Number(task.expectedImages || 0),
      Number(runtime.expectedImages || 0)
    );
    return {
      ...previous,
      planSubmitted: true,
      planDone: Boolean(previous.planDone || previous.imageSubmitted || laterStage || runtimeHasImages || submittedImageRecovery),
      imageSubmitted: Boolean(previous.imageSubmitted || imageStage || runtimeHasImages || submittedImageRecovery),
      ...(previous.textSubmitted || durableCopyBoundary ? { textSubmitted: true } : {}),
      ...(previous.recoveryBoundaryConfirmed || submittedImageRecovery
        ? { recoveryBoundaryConfirmed: true }
        : {}),
      ...(plannedImageCount > 0 ? { plannedImageCount } : {}),
      generatedImageUrls: Array.isArray(previous.generatedImageUrls) ? previous.generatedImageUrls : []
    };
  }

  function rotationTaskBoundAccountId(task = {}) {
    if (task.taskType !== "material" || task._submittedToGpt !== true) return "";
    return String(task.accountId || "").trim();
  }

  function shouldRetryRotationBoundary(task = {}) {
    return task.taskType === "material"
      && ["paused", "failed"].includes(String(task._status || ""))
      && ["COMPOSER_ATTACHMENT_CONFLICT", "COMPOSER_DRAFT_PENDING", "RESTART_INTERRUPTED"].includes(String(task._errorCode || ""))
      && Boolean(String(task.requestId || "").trim());
  }

  function rotationBoundaryRecovery(task = {}, runtime = {}, inspection = {}) {
    if (!shouldRetryRotationBoundary(task)) return { action: "none" };
    const expectedAttachments = Math.max(0, Number(runtime.expectedAttachments || task.attachments?.length || 0));
    const uploadedAttachments = Math.max(0, Number(runtime.uploadedAttachments || 0));
    const sameTask = String(runtime.currentTaskId || "") === String(task.requestId || "");
    const completeUpload = expectedAttachments > 0 && uploadedAttachments >= expectedAttachments;
    const planReady = inspection?.waitingForConfirm === true
      || String(inspection?.stage || "") === "plan-ready"
      || String(inspection?.patrolState?.key || "") === "awaiting-confirm";
    const cleanComposer = Math.max(0, Number(inspection?.attachmentCount || 0)) === 0
      && !String(inspection?.composerDraft || "").trim();
    const durableImageCount = Array.isArray(task.workflow?.generatedImageUrls)
      ? task.workflow.generatedImageUrls.length
      : 0;
    const durableLaterCheckpoint = task._submittedToGpt === true
      && (durableImageCount > 0
        || Boolean(String(task.workflow?.copyText || "").trim())
        || /等待小红书文案|文案|下载|归档/i.test(String(task._stage || task.retryFromStage || "")));
    if (sameTask && cleanComposer && durableLaterCheckpoint) {
      return { action: "resume-checkpoint" };
    }
    return sameTask && completeUpload && planReady && cleanComposer
      ? { action: "resume-plan" }
      : { action: "fresh-retry" };
  }

  function accountParticipatesInRotation(account = {}, runtime = {}) {
    return Boolean(account.id)
      && account.mode === "rotate"
      && account.disabled !== true
      && runtime.pausedByUser !== true
      && runtime.stoppedByUser !== true;
  }

  function accountQuotaBoundary(quota = {}, now = Date.now()) {
    const generated = Math.max(0, Number(quota.generated || 0));
    const limit = Math.max(1, Number(quota.settings?.generationLimit || 45));
    const expiry = Date.parse(String(quota.nextExpiryAt || ""));
    return {
      reached: generated >= limit,
      generated,
      limit,
      nextProbeAt: generated >= limit && Number.isFinite(expiry) && expiry > now ? expiry : 0
    };
  }

  function reconcileAccountQuotaSettings({ profiles = [], settings = [], defaults = {} } = {}) {
    const existing = new Map((Array.isArray(settings) ? settings : [])
      .filter((account) => account?.id)
      .map((account) => [String(account.id), account]));
    const fallback = {
      uploadLimit: Math.max(1, Number(defaults.uploadLimit || 80)),
      generationLimit: Math.max(1, Number(defaults.generationLimit || 45)),
      windowHours: Math.max(1, Number(defaults.windowHours || 3))
    };
    return (Array.isArray(profiles) ? profiles : [])
      .filter((profile) => profile?.id)
      .map((profile, index) => {
        const saved = existing.get(String(profile.id));
        if (saved) return { ...saved };
        return {
          id: String(profile.id),
          name: String(profile.name || `账号 ${index + 1}`),
          ...fallback
        };
      });
  }

  function taskQuotaBoundary(options = {}) {
    const requiredUploads = Math.max(0, Number(options.requiredUploads || 0));
    const requiredGenerations = Math.max(0, Number(options.requiredGenerations || 0));
    const remainingUploads = Math.max(0, Number(options.remainingUploads || 0));
    const remainingGenerations = Math.max(0, Number(options.remainingGenerations || 0));
    if (requiredUploads > remainingUploads) {
      return { reached: true, kind: "upload", required: requiredUploads, remaining: remainingUploads };
    }
    if (requiredGenerations > remainingGenerations) {
      return { reached: true, kind: "generation", required: requiredGenerations, remaining: remainingGenerations };
    }
    return { reached: false, kind: "", required: 0, remaining: 0 };
  }

  function normalizeMaterialPath(value = "") {
    return String(value || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+$/g, "")
      .toLowerCase();
  }

  function materialIdentityKey(value = '') {
    const normalized = normalizeMaterialPath(value);
    if (!normalized) return '';
    const stableId = normalized.match(/[（(]([0-9a-f]{8,64})[）)]$/i)?.[1];
    if (stableId) return `id:${stableId}`;
    const parts = normalized.split('/').filter(Boolean);
    return `name:${parts.at(-1) || normalized}`;
  }

  function materialIdentityVariants(value = '') {
    const normalized = normalizeMaterialPath(value);
    if (!normalized) return [];
    const basename = normalized.split('/').filter(Boolean).at(-1) || normalized;
    const withoutWorkflowPrefix = basename
      .replace(/^当前会话(?:母版|恢复)\s*[×x·:：-]\s*/i, '')
      .replace(/^工作台(?:素材|任务)\s*[×x·:：-]\s*/i, '')
      .trim();
    return [...new Set([basename, withoutWorkflowPrefix]
      .filter((item) => item.length >= 8))];
  }

  function materialIdentityMatches(left = '', right = '') {
    const leftVariants = materialIdentityVariants(left);
    const rightVariants = materialIdentityVariants(right);
    return leftVariants.some((leftValue) => rightVariants.some((rightValue) => (
      leftValue === rightValue
      || leftValue.length >= 8 && rightValue.includes(leftValue)
      || rightValue.length >= 8 && leftValue.includes(rightValue)
    )));
  }

  function recentSuccessfulMaterialKeys(checkpoints = [], now = Date.now(), maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    const keys = new Set();
    (Array.isArray(checkpoints) ? checkpoints : []).forEach((checkpoint) => {
      if (checkpoint?.packageValid !== true) return;
      const updatedAt = Date.parse(String(checkpoint?.updatedAt || checkpoint?.finishedAt || ''));
      const age = Number(now) - updatedAt;
      if (!Number.isFinite(updatedAt) || age < -5 * 60 * 1000 || age > Math.max(0, Number(maxAgeMs || 0))) return;
      const key = materialIdentityKey(checkpoint?.sourceMaterialPath);
      if (key) keys.add(key);
    });
    return [...keys];
  }

  function recoverableMaterialPaths(checkpoints = [], now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000) {
    const paths = new Set();
    (Array.isArray(checkpoints) ? checkpoints : []).forEach((checkpoint) => {
      const sourcePath = normalizeMaterialPath(checkpoint?.sourceMaterialPath);
      if (!sourcePath || checkpoint?.packageValid === true) return;
      const updatedAt = Date.parse(String(checkpoint?.updatedAt || ""));
      const age = Number(now) - updatedAt;
      if (!Number.isFinite(updatedAt) || age < -5 * 60 * 1000 || age > Math.max(0, Number(maxAgeMs || 0))) return;
      const percent = Math.max(0, Number(checkpoint?.percent || 0));
      const hasArtifact = Number(checkpoint?.plannedImageCount || 0) > 0
        || Number(checkpoint?.downloadedImageCount || 0) > 0
        || Number(checkpoint?.copyTextLength || 0) > 0;
      const meaningfulStage = /计划|确认|生图|图片|文案|下载|txt|打包|归档|plan|image|copy|download|package/i
        .test(String(checkpoint?.stage || ""));
      if (percent >= 20 && (meaningfulStage || hasArtifact)) paths.add(sourcePath);
    });
    return [...paths];
  }

  function freshConversationInjectionBoundary(task = {}, inspection = {}) {
    const stage = String(inspection?.stage || "unknown");
    if (task?.taskType !== "material") return { blocked: false, stage };
    const resuming = task?._submittedToGpt === true
      || Boolean(String(task?.retryFromStage || "").trim())
      || task?.forceUpload === false;
    if (resuming) return { blocked: false, stage };
    return {
      blocked: inspection?.canInjectNext === false,
      stage
    };
  }

  // A renderer reload can expose the final copy before lazy image elements
  // have hydrated.  This is still an occupied conversation boundary: the
  // scheduler must wait for the full image evidence instead of injecting the
  // next material into the same thread.  Once the expected image count is
  // present, the normal package recovery may proceed.
  function completedCopyBoundaryStatus(inspection = {}) {
    const stage = String(inspection?.stage || "");
    if (!["images-ready", "waiting-images", "waiting-copy", "completed-copy-pending-package"].includes(stage)) {
      return "none";
    }
    if (inspection?.generating === true || inspection?.hasCopy !== true || inspection?.generated !== true) {
      return "none";
    }
    const imageCount = Math.max(
      0,
      Number(inspection?.latestImageCount || 0),
      Number(inspection?.evidenceDiagnostic?.latestSemanticBatchImages || 0)
    );
    const expectedImageCount = Math.max(0, Number(inspection?.expectedImageCount || 0));
    if (!imageCount) return "none";
    return expectedImageCount > 0 && imageCount < expectedImageCount
      ? "waiting-images"
      : "ready";
  }

  function selectNextRotationAccount({
    accounts = [],
    cursor = 0,
    blocked = new Set(),
    cycleByAccount = {},
    runtimeByAccount = {},
    now = Date.now()
  } = {}) {
    if (!accounts.length) return { account: null, cursor: 0, nextProbeAt: 0 };
    const normalizedCursor = ((Number(cursor || 0) % accounts.length) + accounts.length) % accounts.length;
    let nextProbeAt = 0;
    for (let offset = 0; offset < accounts.length; offset += 1) {
      const index = (normalizedCursor + offset) % accounts.length;
      const account = accounts[index];
      if (!accountParticipatesInRotation(account, runtimeByAccount[account.id] || {})) continue;
      const probeAt = Math.max(0, Number(cycleByAccount[account.id]?.nextProbeAt || 0));
      if (blocked.has(account.id) || probeAt > now) {
        if (probeAt > now && (!nextProbeAt || probeAt < nextProbeAt)) nextProbeAt = probeAt;
        continue;
      }
      return { account, cursor: index, nextProbeAt: 0 };
    }
    return { account: null, cursor: normalizedCursor, nextProbeAt };
  }

  return {
    accountParticipatesInRotation,
    accountQuotaBoundary,
    effectiveProductionMode,
    freshConversationInjectionBoundary,
    completedCopyBoundaryStatus,
    materialIdentityKey,
    materialIdentityVariants,
    materialIdentityMatches,
    recentSuccessfulMaterialKeys,
    recoverableMaterialPaths,
    reconcileAccountQuotaSettings,
    rotationRunAfterModeSwitch,
    rotationBoundaryRecovery,
    rotationResumeCheckpoint,
    resumedWorkflowState,
    rotationTaskBoundAccountId,
    selectMaterialAttachments,
    shouldRetryRotationBoundary,
    shouldInitializeTemplate,
    taskQuotaBoundary,
    selectNextRotationAccount
  };
});
