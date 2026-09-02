(function exposeGptRuntimeReconcile(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TBGptRuntimeReconcile = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGptRuntimeReconcileApi() {
  function accountIds(value) {
    if (!Array.isArray(value) || !value.length) return null;
    return new Set(value.map((accountId) => String(accountId || "").trim()).filter(Boolean));
  }

  const STAGE_RANKS = Object.freeze({
    unknown: 0,
    "material-uploaded": 1,
    "plan-ready": 2,
    "waiting-images": 3,
    "images-ready": 4,
    "waiting-copy": 5,
    "completed-copy-pending-package": 6,
    archived: 7
  });

  function normalizeConversationUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text);
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return text.split(/[?#]/)[0].replace(/\/$/, "");
    }
  }

  function normalizeStage(value) {
    const text = String(value || "").trim();
    if (!text) return "unknown";
    if (/completed-copy-pending-package|等待归档|文案完成|copy-ready/i.test(text)) {
      return "completed-copy-pending-package";
    }
    if (/archiv|归档|已完成|completed/i.test(text)) return "archived";
    if (/waiting-copy|等待文案|文案|copy/i.test(text)) return "waiting-copy";
    if (/images-ready|图片完成|出图完毕|图片已完成/i.test(text)) return "images-ready";
    if (/waiting-images|等待图片|生图|生成图片|生成中|image/i.test(text)) return "waiting-images";
    if (/plan-ready|计划完成|等待确认|迁移计划/i.test(text)) return "plan-ready";
    if (/material-uploaded|附件已确认|上传附件|上传素材/i.test(text)) return "material-uploaded";
    return "unknown";
  }

  function firstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
  }

  function numberValue(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return 0;
  }

  function booleanValue(...values) {
    return values.some((value) => value === true);
  }

  function stableHash(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  // Keep only state that can prove a real workflow transition. Do not include
  // timestamps, dynamic status labels, signed image URLs, or polling counters:
  // those values changed on every old recovery pass and made the same page look
  // like progress. This snapshot is intentionally safe to persist in the
  // runtime mirror and is not a copy of conversation content.
  function normalizePageEvidence(input = {}) {
    const inspection = input.inspection && typeof input.inspection === "object" ? input.inspection : {};
    const status = input.status && typeof input.status === "object" ? input.status : {};
    const runtime = input.runtime && typeof input.runtime === "object" ? input.runtime : {};
    const task = input.task && typeof input.task === "object" ? input.task : {};
    const workflow = task.workflow && typeof task.workflow === "object" ? task.workflow : {};
    const stage = normalizeStage(firstValue(
      input.stage,
      inspection.stage,
      inspection.patrolState?.stage,
      status.stage,
      runtime.currentStage,
      task._stage,
      workflow.stage,
      workflow.currentStage
    ));
    const packagePath = String(firstValue(
      input.packagePath,
      inspection.packagePath,
      inspection.archiveResult?.packagePath,
      status.packagePath,
      status.archiveResult?.packagePath,
      runtime.packagePath,
      task._result?.packagePath,
      task.packagePath
    ) || "").trim();
    const archiveEventKey = String(firstValue(
      input.archiveEventKey,
      inspection.archiveEventKey,
      inspection.archiveResult?.archiveEventKey,
      status.archiveEventKey,
      status.archiveResult?.archiveEventKey,
      runtime.archiveEventKey,
      task.archiveEventKey,
      task._result?.archiveEventKey
    ) || "").trim();
    const evidence = {
      requestId: String(input.requestId || task.requestId || runtime.currentTaskId || status.requestId || "").trim(),
      stage,
      stageRank: STAGE_RANKS[stage] || 0,
      conversationUrl: normalizeConversationUrl(firstValue(
        inspection.conversationUrl,
        inspection.url,
        status.conversationUrl,
        runtime.conversationUrl,
        task.conversationUrl,
        task.browserConversationUrl
      )),
      uploadedAttachments: numberValue(
        input.uploadedAttachments,
        inspection.uploadedAttachments,
        inspection.uploadedFiles,
        status.uploadedAttachments,
        status.uploadedFiles,
        runtime.uploadedAttachments,
        task.uploadedAttachments
      ),
      expectedAttachments: numberValue(
        input.expectedAttachments,
        inspection.expectedAttachments,
        status.expectedAttachments,
        runtime.expectedAttachments,
        task.attachments?.length
      ),
      generatedImages: numberValue(
        input.generatedImages,
        inspection.latestImageCount,
        inspection.detectedImageCount,
        inspection.actualImages,
        status.generatedImages,
        status.actualImages,
        runtime.generatedImages,
        workflow.generatedImages
      ),
      expectedImages: numberValue(
        input.expectedImages,
        inspection.expectedImageCount,
        status.expectedImages,
        runtime.expectedImages,
        workflow.plannedImageCount,
        task.expectedImages
      ),
      submittedToGpt: booleanValue(
        input.submittedToGpt,
        inspection.submittedToGpt,
        status.submittedToGpt,
        status.planSubmitted,
        runtime.submittedToGpt,
        task._submittedToGpt,
        workflow.planSubmitted
      ),
      textSubmitted: booleanValue(
        input.textSubmitted,
        inspection.textSubmitted,
        status.textSubmitted,
        runtime.textSubmitted,
        workflow.textSubmitted
      ),
      packagePath,
      archiveEventKey,
      archiveRequestId: String(firstValue(
        input.archiveRequestId,
        inspection.archiveRequestId,
        status.archiveRequestId,
        runtime.archiveRequestId,
        task._result?.requestId,
        task.requestId
      ) || "").trim()
    };
    return evidence;
  }

  function pageEvidenceFingerprint(evidence = {}) {
    const normalized = normalizePageEvidence(evidence);
    return `gpt-page-${stableHash(JSON.stringify(normalized))}`;
  }

  function comparePageEvidence(previous = {}, current = {}) {
    const before = normalizePageEvidence(previous);
    const after = normalizePageEvidence(current);
    const requestChanged = Boolean(before.requestId && after.requestId && before.requestId !== after.requestId);
    const progressed = requestChanged
      || after.stageRank > before.stageRank
      || after.uploadedAttachments > before.uploadedAttachments
      || after.generatedImages > before.generatedImages
      || (!before.submittedToGpt && after.submittedToGpt)
      || (!before.textSubmitted && after.textSubmitted)
      || (!before.packagePath && Boolean(after.packagePath))
      || (!before.archiveEventKey && Boolean(after.archiveEventKey));
    const sameFingerprint = pageEvidenceFingerprint(before) === pageEvidenceFingerprint(after);
    return {
      requestChanged,
      progressed,
      sameFingerprint,
      previous: before,
      current: after,
      previousFingerprint: pageEvidenceFingerprint(before),
      currentFingerprint: pageEvidenceFingerprint(after)
    };
  }

  function shouldBlockStagnantRecovery({
    requestId = "",
    previousRequestId = "",
    previousEvidence = {},
    currentEvidence = {},
    previousFingerprint = "",
    currentFingerprint = ""
  } = {}) {
    const currentKey = String(requestId || currentEvidence.requestId || "").trim();
    const previousKey = String(previousRequestId || previousEvidence.requestId || "").trim();
    if (!currentKey || !previousKey || currentKey !== previousKey) {
      return { blocked: false, reason: "new-request-boundary" };
    }
    if (!previousFingerprint && !Object.keys(previousEvidence || {}).length) {
      return { blocked: false, reason: "no-recovery-evidence-baseline" };
    }
    const comparison = comparePageEvidence(previousEvidence, currentEvidence);
    const same = Boolean(
      previousFingerprint
      && currentFingerprint
      && String(previousFingerprint) === String(currentFingerprint)
    ) || comparison.sameFingerprint;
    if (comparison.progressed) {
      return { blocked: false, progressed: true, reason: "new-page-evidence", comparison };
    }
    if (same) return { blocked: true, reason: "same-request-page-fingerprint", comparison };
    // A changed fingerprint that only reflects a rollback or a different
    // volatile page label is not proof of progress. Hold it as well.
    return { blocked: true, reason: "same-request-without-forward-evidence", comparison };
  }

  // Upgrade only an unsent material task to the account's fresh-session
  // contract. The rebuilt task supplies the new template attachments and
  // prompt, while the original request id, material lock, workflow checkpoint
  // and error/retry evidence remain authoritative. A stale conversation URL
  // is deliberately cleared: an unsent task has no permission to inherit an
  // older GPT conversation.
  function normalizeUnsubmittedFreshTask(task = {}, rebuilt = {}, {
    accountId = "",
    templateId = "",
    workflowProfileId = "fresh-template-v1",
    workflowVariantVersion = "1"
  } = {}) {
    if (!task || task.taskType !== "material" || task._submittedToGpt === true) {
      return { changed: false, task };
    }
    const original = task;
    const next = {
      ...original,
      ...(rebuilt && typeof rebuilt === "object" ? rebuilt : {})
    };
    const preservedFields = [
      "requestId",
      "materialPath",
      "_status",
      "_stage",
      "_percent",
      "_submittedToGpt",
      "_dispatchingToGpt",
      "forceUpload",
      "retryFromStage",
      "retryFromPercent",
      "_error",
      "_errorCode",
      "_autoRecoveryAttempts",
      "_autoRecoveryDeferrals",
      "_autoRecoveryStartedAt",
      "_autoRecoveryDeadlineAt",
      "_startedAt",
      "_endedAt",
      "_result",
      "workflow",
      "stageHistory",
      "recoveryAttemptId",
      "recoveryAttemptCount",
      "_materialLifecycleClaim"
    ];
    for (const field of preservedFields) {
      if (Object.prototype.hasOwnProperty.call(original, field)) next[field] = original[field];
    }
    const key = String(accountId || next.accountId || "").trim();
    const selectedTemplate = String(templateId || next.selectedTemplateId || next.templateId || "").trim();
    Object.assign(next, {
      requestId: String(original.requestId || next.requestId || "").trim(),
      materialPath: String(original.materialPath || next.materialPath || "").trim(),
      accountId: key || String(next.accountId || "").trim(),
      accountWindowId: String(next.accountWindowId || key),
      browserIdentityId: String(next.browserIdentityId || key),
      quotaAccountId: String(next.quotaAccountId || key),
      workflowVariant: "fresh-session-fixed-template",
      workflowVariantVersion: String(workflowVariantVersion || next.workflowVariantVersion || "1"),
      sessionPolicy: "fresh-session",
      selectedTemplateId: selectedTemplate,
      workflowProfileId: String(workflowProfileId || next.workflowProfileId || "fresh-template-v1"),
      navigation: "new-chat",
      navigationUrl: "",
      conversationUrl: "",
      browserConversationUrl: "",
      patrolConversationUrl: "",
      templateConversationUrl: "",
      preferredAccountId: key,
      _freshConversationBootstrap: true,
      _submittedToGpt: false,
      _status: String(original._status || next._status || "queued")
    });
    return { changed: true, task: next };
  }

  function relevantWindowEntries(control, assignedAccountIds) {
    const windows = control && typeof control.windowRuntime === "object"
      ? control.windowRuntime
      : {};
    const assigned = accountIds(assignedAccountIds);
    return Object.entries(windows).filter(([accountId]) => !assigned || assigned.has(String(accountId)));
  }

  function explicitHoldAccountIds(control, assignedAccountIds) {
    return relevantWindowEntries(control, assignedAccountIds)
      .filter(([, runtime]) => runtime && (
        runtime.pausedByUser === true
        || runtime.stoppedByUser === true
        || runtime.boundaryPaused === true
      ))
      .map(([accountId]) => String(accountId));
  }

  function allAssignedAccountsHeld(control, assignedAccountIds) {
    const assigned = accountIds(assignedAccountIds);
    if (!assigned) return false;
    const windows = control && typeof control.windowRuntime === "object" ? control.windowRuntime : {};
    return [...assigned].every((accountId) => {
      const runtime = windows[accountId];
      return runtime && (
        runtime.pausedByUser === true
        || runtime.stoppedByUser === true
        || runtime.boundaryPaused === true
      );
    });
  }

  // A local explicit hold is an operator decision. It outranks a stale global
  // compatibility mirror, even when the mirror has a higher server revision.
  // Preserve the local queue object as-is so its account cursor and checkpoint
  // cannot jump back to an older server queue during startup.
  function protectLocalExplicitHold(local = {}, remote = {}, assignedAccountIds) {
    const heldAccountIds = explicitHoldAccountIds(local.control, assignedAccountIds);
    if (!heldAccountIds.length) return { preserve: false, state: local, heldAccountIds };
    const remoteControl = remote && typeof remote.control === "object" ? remote.control : {};
    const remoteQueueAccountId = String(remote?.queue?.activeAccountId || "").trim();
    const remoteArmed = remoteControl.armed === true;
    const remoteQueueTargetsHeldAccount = heldAccountIds.includes(remoteQueueAccountId);
    if (!remoteArmed && !remoteQueueTargetsHeldAccount) {
      return { preserve: false, state: local, heldAccountIds };
    }
    return {
      preserve: true,
      reason: "local-explicit-hold",
      heldAccountIds,
      state: {
        ...local,
        control: local.control && typeof local.control === "object"
          ? { ...local.control, armed: false }
          : local.control
      }
    };
  }

  return {
    allAssignedAccountsHeld,
    explicitHoldAccountIds,
    normalizePageEvidence,
    pageEvidenceFingerprint,
    comparePageEvidence,
    shouldBlockStagnantRecovery,
    normalizeUnsubmittedFreshTask,
    protectLocalExplicitHold
  };
});
