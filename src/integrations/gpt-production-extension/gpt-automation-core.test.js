const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parsePlannedImageCount,
  defaultKeywordPattern,
  keywordPatternMatches,
  completionKeywordDetected,
  classifyAttachmentUploadResult,
  isActiveGenerationControl,
  detectPyScriptFallbackSignal,
  detectScriptOutputLimitSignal,
  detectLowImageLimit,
  classifyAutomationBoundaryPause,
  shouldAutoClearComposerBoundary,
  shouldAutoResumeWorkflowBoundary,
  classifyPlanDetectionResult,
  decidePlanRecovery,
  decideCopyRecovery,
  decidePartialImageRecovery,
  classifyExhaustedImageRecovery,
  isRetryableNoImageResponseEvidence,
  mergePartialImageRecovery,
  partialImageRecoverySignature,
  imageUrlsFromLatestConfirmedBatch,
  isFreshAutomationTurnKey,
  requiresPlannedImageCount,
  clampExpectedImageCount,
  completedPlannedImageCount,
  resolveRecoveredPlannedImageCount,
  effectiveGeneratedImageCount,
  shouldRecoverSilentAssistant,
  shouldRecoverSilentImageGeneration,
  shouldStopStalledSilentGeneration,
  lastAssistantIndexAfterPrompt,
  isPostImageRecoveryStage,
  shouldBypassImageRecovery,
  shouldBlockImageRecoveryAfterCopyBoundary,
  shouldReenterConfirmAtPlanBoundary,
  shouldReconcilePlanConfirmationBoundary,
  resolveDurableWorkflowStep,
  shouldAdoptPlanReadyBoundary,
  shouldAdoptCompletedCopyBoundary,
  isConfirmUserTurnText,
  shouldStopStalledNativeImageGeneration,
  shouldStopStalledEmptyImageGeneration,
  parsePlatformCopy,
  formatPlatformCopy,
  validatePlatformCopy,
  countCopyHashtags,
  isLikelyPublishCopy,
  nextContinuousImageIdleSince,
  detectRejectedImageDraftLoop,
  shouldRetryThreadError,
  detectRepetitiveAssistantLoop,
  detectCopyMetaNarration,
  isArchivedAutomationBoundary,
  patrolActionLedgerKey,
  firstBatchChoice,
  validatePlanPageCap,
  resolveEntryInstruction,
  completedHistoryMatchesAutomationBoundary,
  shouldAdoptCurrentMaterialWorkflowBoundary,
  generatedImageIdentity,
  uniqueGeneratedImageUrls,
  preferCurrentBatchImageUrls,
  newGeneratedImageUrls,
  limitGeneratedImageUrls,
  resolveDurableImageBoundary,
  workflowStepExecutionTimeoutMs,
  shouldTrustCompletedPlanCheckpoint
} = require("./gpt-automation-core");

test("inner wait budgets receive an outer settlement grace window", () => {
  assert.equal(workflowStepExecutionTimeoutMs("wait-images", 900_000), 915_000);
  assert.equal(workflowStepExecutionTimeoutMs("wait-plan", 480_000), 495_000);
  assert.equal(workflowStepExecutionTimeoutMs("wait-copy", 480_000), 495_000);
  assert.equal(workflowStepExecutionTimeoutMs("send-confirm", 20_000), 20_000);
});

test("a completed plan checkpoint is trusted only for the current material", () => {
  const planText = "本轮输出页数：7页\nP1｜封面\nP7｜收尾";
  assert.equal(shouldTrustCompletedPlanCheckpoint({
    planDone: true,
    materialMatched: true,
    planText,
    requiresPlannedImageCount: true
  }), true);
  assert.equal(shouldTrustCompletedPlanCheckpoint({
    planDone: true,
    materialMatched: false,
    planText,
    requiresPlannedImageCount: true
  }), false);
  assert.equal(shouldTrustCompletedPlanCheckpoint({
    planDone: true,
    materialMatched: true,
    planText: "旧回复，没有逐页数量",
    requiresPlannedImageCount: true
  }), false);
});

test("confirmation detection accepts an attachment turn whose final typed line is 1", () => {
  assert.equal(isConfirmUserTurnText("1"), true);
  assert.equal(isConfirmUserTurnText("文案(20260827-065606).txt\n文档\n1", { attachmentCount: 19 }), true);
  assert.equal(isConfirmUserTurnText("文案(20260827-065606).txt\n文档\n1"), false);
  assert.equal(isConfirmUserTurnText("路线 1"), false);
});

test("stalled empty image responses enter bounded same-task recovery", () => {
  assert.equal(isRetryableNoImageResponseEvidence("silent-image-response"), true);
  assert.equal(isRetryableNoImageResponseEvidence("stalled-image-response"), true);
  assert.equal(isRetryableNoImageResponseEvidence("failed-image-response"), true);
  assert.equal(isRetryableNoImageResponseEvidence("images-ready"), false);
});

test("same-turn semantic image evidence wins over a lazy one-thumbnail read", () => {
  const roleBased = ["https://chatgpt.com/backend-api/estuary/content?id=file-1"];
  const semantic = [
    "https://chatgpt.com/backend-api/estuary/content?id=file-1",
    "https://chatgpt.com/backend-api/estuary/content?id=file-2",
    "https://chatgpt.com/backend-api/estuary/content?id=file-3",
    "https://chatgpt.com/backend-api/estuary/content?id=file-4"
  ];
  assert.deepEqual(preferCurrentBatchImageUrls(roleBased, semantic), semantic);
  assert.deepEqual(
    preferCurrentBatchImageUrls(semantic, roleBased),
    semantic
  );
});

function hashtags(prefix, count) {
  return Array.from({ length: count }, (_, index) => `#${prefix}${index + 1}`).join(" ");
}

test("双平台文案协议严格分区并核对 10/5 个话题", () => {
  const xhs = `杭州周边团建玩法参考\n${"适合收藏的真实玩法与天气提醒。".repeat(8)}\n${hashtags("小红书", 10)}`;
  const douyin = `杭州周边怎么玩\n${"漂流和森林项目的体验差异、装备和体力提醒。".repeat(8)}\n${hashtags("抖音", 5)}`;
  const formatted = formatPlatformCopy({ xhs, douyin });
  const parsed = parsePlatformCopy(formatted);
  const validation = validatePlatformCopy(formatted, { minimumSectionLength: 30 });
  assert.equal(parsed.formatVersion, 2);
  assert.equal(parsed.strict, true);
  assert.equal(parsed.xhs, xhs);
  assert.equal(parsed.douyin, douyin);
  assert.deepEqual(validation.issues, []);
  assert.equal(validation.xhsHashtags, 10);
  assert.equal(validation.douyinHashtags, 5);
  assert.equal(countCopyHashtags(parsed.xhs), 10);
  assert.equal(isLikelyPublishCopy(formatted, 100), true);
});

test("双平台文案协议拒绝标记外的解释和缺失区段", () => {
  const invalid = [
    "以下是两个版本\n<<<COPY_FORMAT:2>>>\n<<<XHS_START>>>\n标题\n正文\n<<<XHS_END>>>\n<<<DOUYIN_START>>>\n抖音\n<<<DOUYIN_END>>>",
    "<<<COPY_FORMAT:2>>>\n<<<XHS_START>>>\n只有小红书\n<<<XHS_END>>>"
  ];
  for (const value of invalid) {
    const validation = validatePlatformCopy(value, { minimumSectionLength: 1 });
    assert.equal(validation.valid, false);
  }
});

test("抖音区段硬拦截起接人数和交易承接话术", () => {
  const xhs = `杭州周边团建分享\n${"真实路线与执行提醒。".repeat(12)}\n${hashtags("小红书", 10)}`;
  const douyin = `杭州周边玩法\n${"10人起接，欢迎咨询报价，承接企业定制。".repeat(12)}\n${hashtags("抖音", 5)}`;
  const validation = validatePlatformCopy(formatPlatformCopy({ xhs, douyin }), { minimumSectionLength: 30 });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.includes("DOUYIN_FORBIDDEN_PHRASES"));
  assert.ok(validation.douyinForbiddenPhrases.includes("10人起接"));
  assert.ok(validation.douyinForbiddenPhrases.includes("咨询"));
  assert.ok(validation.douyinForbiddenPhrases.includes("报价"));
});

test("旧版单篇文案仍可识别，但不会冒充双平台协议", () => {
  const parsed = parsePlatformCopy("杭州团建路线参考。".repeat(40));
  const validation = validatePlatformCopy(parsed.xhs, { minimumSectionLength: 30 });
  assert.equal(parsed.legacy, true);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.includes("COPY_FORMAT_VERSION_LEGACY"));
});

test("copy recovery selects the last assistant fragment before the next user turn", () => {
  assert.equal(lastAssistantIndexAfterPrompt(["user", "assistant", "assistant"], 0), 2);
  assert.equal(lastAssistantIndexAfterPrompt(["user", "assistant", "assistant", "user", "assistant"], 0), 2);
  assert.equal(lastAssistantIndexAfterPrompt(["user", "user"], 0), -1);
});

test("post-image retry stages preserve the original planned image count", () => {
  assert.equal(isPostImageRecoveryStage("恢复小红书文案"), true);
  assert.equal(isPostImageRecoveryStage("生成小红书文案"), true);
  assert.equal(isPostImageRecoveryStage("下载图片"), true);
  assert.equal(isPostImageRecoveryStage("等待图片"), false);
});

test("copy boundary only bypasses image recovery after the same batch has image evidence", () => {
  assert.deepEqual(shouldBypassImageRecovery({
    liveConversationStage: "waiting-copy",
    retryStage: "已请求补齐缺少图片",
    textSubmitted: false
  }), { bypass: false, reason: "image-evidence-missing" });
  assert.deepEqual(shouldBypassImageRecovery({
    liveConversationStage: "waiting-copy",
    expectedImageCount: 7,
    imageEvidenceCount: 7,
    retryStage: "已请求补齐缺少图片",
    textSubmitted: false
  }), { bypass: true, reason: "live-copy-boundary" });
  assert.deepEqual(shouldBypassImageRecovery({
    copyText: "<<<COPY_FORMAT:2>>>完整文案",
    expectedImageCount: 7,
    imageEvidenceCount: 6,
    retryStage: "已请求补齐缺少图片",
    textSubmitted: false
  }), { bypass: false, reason: "image-evidence-missing" });
  assert.deepEqual(shouldBypassImageRecovery({
    copyText: "<<<COPY_FORMAT:2>>>完整文案",
    expectedImageCount: 7,
    imageEvidenceCount: 7,
    retryStage: "已请求补齐缺少图片",
    textSubmitted: false
  }), { bypass: true, reason: "copy-or-archive-boundary" });
  assert.deepEqual(shouldBypassImageRecovery({
    retryStage: "恢复小红书文案",
    textSubmitted: true,
    imageEvidenceCount: 4
  }), { bypass: true, reason: "post-image-recovery-stage" });
  assert.deepEqual(shouldBypassImageRecovery({
    retryStage: "等待图片",
    textSubmitted: false
  }), { bypass: false, reason: "" });
});

test("completed copy blocks image recovery even while image evidence is hydrating", () => {
  assert.deepEqual(shouldBlockImageRecoveryAfterCopyBoundary({
    liveConversationStage: "completed-copy-pending-package",
    copyText: "<<<COPY_FORMAT:2>>>完整双平台文案",
    materialIdentityRequired: true,
    materialIdentityMatched: true,
    imageEvidenceCount: 0
  }), {
    blocked: true,
    safeToAdopt: true,
    reason: "copy-boundary-observed",
    stage: "completed-copy-pending-package"
  });
  assert.deepEqual(shouldBlockImageRecoveryAfterCopyBoundary({
    liveConversationStage: "waiting-copy",
    textSubmitted: true,
    materialIdentityRequired: true,
    materialIdentityMatched: true,
    imageEvidenceCount: 0
  }), {
    blocked: true,
    safeToAdopt: false,
    reason: "copy-boundary-awaiting-copy-evidence",
    stage: "waiting-copy"
  });
  assert.deepEqual(shouldBlockImageRecoveryAfterCopyBoundary({
    liveConversationStage: "completed-copy-pending-package",
    copyText: "旧作品文案",
    materialIdentityRequired: true,
    materialIdentityMatched: false
  }), {
    blocked: true,
    safeToAdopt: false,
    reason: "copy-boundary-material-mismatch",
    stage: "completed-copy-pending-package"
  });
  assert.deepEqual(shouldBlockImageRecoveryAfterCopyBoundary({
    liveConversationStage: "waiting-images",
    imageEvidenceCount: 0
  }), {
    blocked: false,
    reason: "copy-boundary-not-observed",
    stage: "waiting-images"
  });
});

test("stale image submission is reset only at a plan boundary with no confirm or image evidence", () => {
  assert.equal(shouldReenterConfirmAtPlanBoundary({
    liveConversationStage: "plan-ready",
    imageSubmitted: true
  }), true);
  assert.equal(shouldReenterConfirmAtPlanBoundary({
    liveConversationStage: "waiting-images",
    imageSubmitted: true
  }), false);
  assert.equal(shouldReenterConfirmAtPlanBoundary({
    liveConversationStage: "plan-ready",
    imageSubmitted: true,
    confirmTurnKey: "conversation-turn-12"
  }), false);
  assert.equal(shouldReenterConfirmAtPlanBoundary({
    liveConversationStage: "plan-ready",
    imageSubmitted: true,
    liveImageEvidenceCount: 8
  }), false);
});

test("durable confirmation wins over a stale plan-ready DOM snapshot", () => {
  assert.equal(shouldReconcilePlanConfirmationBoundary({
    liveConversationStage: "plan-ready",
    imageSubmitted: true,
    confirmTurnKey: "conversation-turn-11"
  }), false);
  assert.equal(shouldReconcilePlanConfirmationBoundary({
    liveConversationStage: "plan-ready",
    imageSubmitted: true,
    recoveryBoundaryConfirmed: true
  }), false);
  assert.equal(shouldReconcilePlanConfirmationBoundary({
    liveConversationStage: "plan-ready",
    imageSubmitted: true
  }), true);
  for (const laterBoundary of [
    { textSubmitted: true },
    { copyText: "已完成的小红书文案" },
    { copyTextPath: "D:\\成品\\copy.txt" },
    { packagePath: "D:\\成品\\作品集_001" },
    { downloadedImageCount: 8 },
    { durableStage: "copy-ready" },
    { durableStage: "archived" }
  ]) {
    assert.equal(shouldReconcilePlanConfirmationBoundary({
      liveConversationStage: "plan-ready",
      imageSubmitted: true,
      ...laterBoundary
    }), false, `later boundary must win: ${JSON.stringify(laterBoundary)}`);
  }
});

test("durable workflow step is monotonic across a stale or unavailable page", () => {
  assert.equal(resolveDurableWorkflowStep({
    currentStep: "copy-ready",
    pageStage: "plan-ready"
  }), "copy-ready");
  assert.equal(resolveDurableWorkflowStep({
    pageStage: "plan-ready",
    textSubmitted: true,
    copyText: "已完成可发布文案"
  }), "copy-ready");
  assert.equal(resolveDurableWorkflowStep({
    currentStep: "images-ready",
    packagePath: "D:\\成品\\作品集_001"
  }), "packaged");
  assert.equal(resolveDurableWorkflowStep({
    currentStep: "packaged",
    archived: true
  }), "archived");
});

test("recovery adopts an already completed plan instead of waiting for a duplicate assistant turn", () => {
  const plan = "迁移计划\nP1｜封面\nP2｜路线\nP3｜项目\nP4｜休闲\nP5｜住宿\nP6｜餐饮\nP7｜团建\nP8｜返程\n完成后等待我回复 1，暂时不要出图。";
  assert.equal(shouldAdoptPlanReadyBoundary({
    workflowPlanSubmitted: true,
    liveConversationStage: "plan-ready",
    materialText: "当前素材文件夹：千岛湖团建",
    planText: plan
  }), true);
  assert.equal(shouldAdoptPlanReadyBoundary({
    workflowPlanSubmitted: true,
    liveConversationStage: "plan-ready",
    materialText: "当前素材文件夹：千岛湖团建",
    planText: plan,
    liveImageEvidenceCount: 1
  }), false);
  assert.equal(shouldAdoptPlanReadyBoundary({
    workflowPlanSubmitted: true,
    liveConversationStage: "waiting-plan",
    materialText: "当前素材文件夹：千岛湖团建",
    planText: plan
  }), false);
});

test("recovery adopts a copy reply that arrived after the current image boundary", () => {
  assert.equal(shouldAdoptCompletedCopyBoundary({
    boundaryStage: "images-ready",
    latestAssistantAfterImage: true,
    latestAssistantHasCopy: true,
    imageEvidenceCount: 9,
    expectedImageCount: 9
  }), true);
  assert.equal(shouldAdoptCompletedCopyBoundary({
    boundaryStage: "images-ready",
    latestAssistantAfterImage: false,
    latestAssistantHasCopy: true,
    imageEvidenceCount: 9,
    expectedImageCount: 9
  }), false);
  assert.equal(shouldAdoptCompletedCopyBoundary({
    boundaryStage: "images-ready",
    latestAssistantAfterImage: true,
    latestAssistantHasCopy: true,
    imageEvidenceCount: 8,
    expectedImageCount: 9
  }), false);
});

test("publish copy quality rejects source-review narration without blocking normal copy", () => {
  const blocked = [
    "TXT里提到这里适合30人团建。",
    "根据图片素材，这里有露营草坪。",
    "从你提供的图片中可以看到竹林。",
    "参考文案里写了第二天安排徒步。",
    "结合TXT和图片，建议安排两天一夜。"
  ];
  const allowed = [
    "这里很适合30人左右的团队安排团建。",
    "草坪区域可以安排露营和轻团建游戏。",
    "竹林徒步很适合春季团队出游。",
    "两天一夜的节奏不会太赶。",
    "拍出来的图片很有春日氛围。"
  ];
  blocked.forEach((copy) => assert.equal(detectCopyMetaNarration(copy).matched, true, copy));
  allowed.forEach((copy) => assert.equal(detectCopyMetaNarration(copy).matched, false, copy));
});

test("all task and recovery estimates share the ten-image hard cap", () => {
  assert.equal(clampExpectedImageCount(14), 10);
  assert.equal(clampExpectedImageCount(8), 8);
  assert.equal(clampExpectedImageCount(-1), 0);
});

test("completed work uses downloaded image truth when the recovered plan estimate was stale", () => {
  assert.equal(completedPlannedImageCount({ plannedImageCount: 2, downloadedImageCount: 8 }), 8);
  assert.equal(completedPlannedImageCount({ plannedImageCount: 8, downloadedImageCount: 8 }), 8);
  assert.equal(completedPlannedImageCount({ plannedImageCount: 10, downloadedImageCount: 8 }), 10);
  assert.equal(completedPlannedImageCount({ plannedImageCount: 14, downloadedImageCount: 12 }), 10);
});

test("restart recovery keeps the current web plan above the attachment-count estimate", () => {
  assert.equal(resolveRecoveredPlannedImageCount({
    planText: "P1｜封面\nP2｜徒步\nP3｜庾村\nP4｜烧烤\nP5｜农场\nP6｜探索\nP7｜民宿\nP8｜温泉\nP9｜篝火\nP10｜行程",
    checkpointCount: 5,
    taskExpectedCount: 5,
    recoveredImageCount: 5
  }), 10);
  assert.equal(resolveRecoveredPlannedImageCount({
    planText: "P1｜封面\nP2｜项目\nP3｜餐饮\nP4｜住宿\nP5｜行程",
    checkpointCount: 4,
    taskExpectedCount: 4
  }), 5);
});

test("observed unique image URLs cannot be downgraded by stale declared metadata", () => {
  const urlVariants = Array.from({ length: 10 }, (_, index) => `https://chatgpt.com/image?variant=${index + 1}`);
  assert.equal(effectiveGeneratedImageCount({ urls: urlVariants, declaredCount: 5 }), 10);
  assert.equal(effectiveGeneratedImageCount({ urls: urlVariants, declaredCount: 1 }), 10);
  assert.equal(effectiveGeneratedImageCount({ urls: urlVariants, declaredCount: 0 }), 10);
  assert.equal(effectiveGeneratedImageCount({ urls: [], declaredCount: 10 }), 0);
  const partial = mergePartialImageRecovery({
    accumulated: [],
    detected: urlVariants,
    detectedCount: 5,
    expected: 10,
    attempts: 0,
    maxAttempts: 2
  });
  assert.equal(partial.action, "continue-missing");
  assert.equal(partial.detectedCount, 5);
});

test("signed URL refreshes do not count the same ChatGPT file as a new image", () => {
  const first = "https://chatgpt.com/backend-api/estuary/content?id=file_same&ts=1&sig=old";
  const refreshed = "https://chatgpt.com/backend-api/estuary/content?id=file_same&ts=2&sig=new";
  const second = "https://chatgpt.com/backend-api/estuary/content?id=file_second&ts=2&sig=new";
  assert.equal(generatedImageIdentity(first), generatedImageIdentity(refreshed));
  assert.equal(uniqueGeneratedImageUrls([first, refreshed, second]).length, 2);
  assert.deepEqual(newGeneratedImageUrls([refreshed, second], [first]), [second]);
  assert.equal(limitGeneratedImageUrls([first, second], 1).length, 1);
});

test("partial image recovery waits while the current assistant reply is still in flight", () => {
  const decision = decidePartialImageRecovery({
    detected: 7,
    expected: 10,
    attempts: 0,
    maxAttempts: 2,
    currentReplyInFlight: true
  });
  assert.deepEqual(decision, { action: "wait-current", nextAttempt: 0 });
  assert.equal(mergePartialImageRecovery({
    accumulated: [],
    detected: ["https://chatgpt.com/image?file=1"],
    detectedCount: 1,
    expected: 10,
    attempts: 0,
    currentReplyInFlight: true
  }).action, "wait-current");
});

test("same partial image snapshot has a stable idempotency signature regardless of order", () => {
  assert.equal(partialImageRecoverySignature({
    urls: ["https://chatgpt.com/image?file=2", "https://chatgpt.com/image?file=1"]
  }), "https://chatgpt.com/image?file=1|https://chatgpt.com/image?file=2");
});

test("attachment preview accounting cannot add tile and nested remove button counts", () => {
  const sidebar = require("node:fs").readFileSync(require("node:path").join(__dirname, "sidebar.js"), "utf8");
  assert.match(sidebar, /const count = removeButtons\.size \|\| previews\.size/);
  assert.doesNotMatch(sidebar, /previews\.add\(el\);\s*matchedDetails\.push\(\{ src: "aria"/);
});

test("a visible completed plan is reread before any recovery prompt is sent", () => {
  const sidebar = require("node:fs").readFileSync(require("node:path").join(__dirname, "sidebar.js"), "utf8");
  assert.match(sidebar, /const visiblePlanTurns = assistantTurnsAfter\(currentPlanPromptTurn\)/);
  assert.match(sidebar, /plan-visible-race-adopted/);
  assert.match(sidebar, /if \(planDetection\.ready \|\| templateInitialization\) break/);
});

test("material ownership is checked before upload and foreign automation drafts are never submitted", () => {
  const sidebar = require("node:fs").readFileSync(require("node:path").join(__dirname, "sidebar.js"), "utf8");
  const ownershipCheck = sidebar.indexOf("const latestLiveMaterialPrompt = latestAutomationMaterialPrompt()");
  const fileLoad = sidebar.indexOf("const loaded = await Promise.all([loadFiles(paths, task), findFileInput()]");
  assert.ok(ownershipCheck >= 0 && fileLoad > ownershipCheck);
  assert.match(sidebar, /pendingPlanLooksAutomation && !pendingPlanBelongsToTask/);
  assert.match(sidebar, /清理其他队列任务遗留的自动提示词/);
});

test("patrol package ledger is isolated per material inside one conversation", () => {
  const conversationUrl = "https://chatgpt.com/c/shared-thread?temporary=1";
  const legacyKey = patrolActionLedgerKey({ conversationUrl });
  const first = patrolActionLedgerKey({ conversationUrl, materialText: "当前素材文件夹：上海室内团建" });
  const sameNormalized = patrolActionLedgerKey({ conversationUrl, materialText: "  当前素材文件夹：上海室内团建  " });
  const second = patrolActionLedgerKey({ conversationUrl, materialText: "当前素材文件夹：杭州农庄团建" });
  assert.equal(legacyKey, "https://chatgpt.com/c/shared-thread");
  assert.equal(first, sameNormalized);
  assert.notEqual(first, second);
  assert.notEqual(first, legacyKey);
});

test("image long-quiet fallback requires one continuous non-generating window", () => {
  assert.equal(nextContinuousImageIdleSince({ previous: 1_000, now: 20_000, generating: true }), 0);
  assert.equal(nextContinuousImageIdleSince({ previous: 0, now: 21_000, generating: false }), 21_000);
  assert.equal(nextContinuousImageIdleSince({ previous: 21_000, now: 22_000, generating: false }), 21_000);
  assert.equal(nextContinuousImageIdleSince({ previous: 21_000, now: 23_000, generating: false, signatureChanged: true }), 23_000);
});

test("multiple rejected drafts of the same page cannot count as a complete carousel", () => {
  assert.equal(detectRejectedImageDraftLoop({
    nativeImages: 4,
    text: "刚才这张总览不合格，立即返工。再次返工：这次只生成一张图——P1。"
  }).detected, true);
  assert.equal(detectRejectedImageDraftLoop({
    nativeImages: 9,
    text: "P1-P9 已全部生成完成。"
  }).detected, false);
  assert.equal(detectRejectedImageDraftLoop({
    nativeImages: 1,
    text: "P1 不合格，重新绘制这一页。"
  }).detected, false);
});

test("patrol candidates auto-join by template or master title and exclude games", () => {
  const { classifyPatrolConversationCandidate } = require("./gpt-automation-core");
  const url = "https://chatgpt.com/c/template-123";
  assert.equal(classifyPatrolConversationCandidate({ title: "团建模板", url }).eligible, true);
  assert.equal(classifyPatrolConversationCandidate({ title: "轮播母版", url }).eligible, true);
  assert.equal(classifyPatrolConversationCandidate({ title: "日常聊天", url }).eligible, false);
  assert.equal(classifyPatrolConversationCandidate({ title: "团建游戏模板", url }).eligible, false);
  assert.equal(classifyPatrolConversationCandidate({ title: "游戏母版", url }).excluded, true);
  assert.equal(classifyPatrolConversationCandidate({ title: "团建模板", url, denylist: [url] }).eligible, false);
});

test("a successfully archived material boundary no longer blocks the next post", () => {
  const marker = {
    conversationUrl: "https://chatgpt.com/c/example",
    materialText: "请读取全部附件\n当前素材文件夹：上一套"
  };
  assert.equal(isArchivedAutomationBoundary({
    currentUrl: "https://chatgpt.com/c/example",
    materialText: "  请读取全部附件 \n 当前素材文件夹：上一套  ",
    marker
  }), true);
  assert.equal(isArchivedAutomationBoundary({
    currentUrl: "https://chatgpt.com/c/example",
    materialText: "请读取全部附件\n当前素材文件夹：下一套",
    marker
  }), false);
  assert.equal(isArchivedAutomationBoundary({
    currentUrl: "https://chatgpt.com/c/another",
    materialText: marker.materialText,
    marker
  }), false);
});

test("a validated completed history record recovers a lost browser archive marker", () => {
  const boundary = {
    materialText: "请完整读取全部附件。当前素材文件夹：2_.人均100+轻松拿下桐洲岛一日团建"
  };
  const matching = {
    conversationUrl: "https://chatgpt.com/c/example",
    sourceMaterialPath: "D:\\素材库\\1\\2_.人均100+轻松拿下桐洲岛一日团建——这是磁盘上的完整长文件夹名",
    stage: "作品归档完成",
    packagePath: "D:\\成品库\\作品A",
    packageValid: true,
    downloadedImageCount: 8
  };
  assert.equal(completedHistoryMatchesAutomationBoundary({
    currentUrl: "https://chatgpt.com/c/example?model=gpt-5",
    materialText: boundary.materialText,
    historyItems: [matching]
  }), true);
  assert.equal(completedHistoryMatchesAutomationBoundary({
    currentUrl: "https://chatgpt.com/c/example",
    materialText: "当前素材文件夹：下一套素材",
    historyItems: [matching]
  }), false);
  assert.equal(completedHistoryMatchesAutomationBoundary({
    currentUrl: "https://chatgpt.com/c/example",
    materialText: boundary.materialText,
    historyItems: [{ ...matching, packageValid: false }]
  }), false);
});

test("an archived or mismatched conversation boundary cannot be adopted for a new task", () => {
  const planText = "本轮输出页数：8页\nP1｜封面\nP8｜收尾";
  assert.equal(shouldAdoptCurrentMaterialWorkflowBoundary({
    materialMatched: false,
    liveBoundaryStage: "archived",
    boundaryPlanText: planText,
    boundaryExpectedImageCount: 8
  }), false);
  assert.equal(shouldAdoptCurrentMaterialWorkflowBoundary({
    materialMatched: false,
    liveBoundaryStage: "waiting-images",
    boundaryPlanText: planText,
    boundaryExpectedImageCount: 8
  }), false);
  assert.equal(shouldAdoptCurrentMaterialWorkflowBoundary({
    materialMatched: true,
    liveBoundaryStage: "waiting-images",
    boundaryPlanText: planText,
    boundaryExpectedImageCount: 8
  }), true);
  assert.equal(shouldAdoptCurrentMaterialWorkflowBoundary({
    forceFreshWorkflow: true,
    materialMatched: true,
    liveBoundaryStage: "images-ready",
    boundaryPlanText: planText,
    boundaryExpectedImageCount: 8
  }), false);
});

test("a validated move-archive history stage also releases the lost browser marker", () => {
  const materialText = "请完整读取全部附件。当前素材文件夹：2_.人均100+轻松拿下桐洲岛一日团建";
  const matching = {
    conversationUrl: "https://chatgpt.com/c/example",
    sourceMaterialPath: "D:\\素材库\\1\\2_.人均100+轻松拿下桐洲岛一日团建",
    stage: "步骤完成：move-archive",
    packagePath: "D:\\成品库\\作品A",
    packageValid: true,
    downloadedImageCount: 8
  };
  assert.equal(completedHistoryMatchesAutomationBoundary({
    currentUrl: "https://chatgpt.com/c/example",
    materialText,
    historyItems: [matching]
  }), true);
});

test("a material completed by a rotation successor releases stale boundaries in prior accounts", () => {
  const materialText = "请完整读取全部附件。当前素材文件夹：评0赞0莫干山两天一夜秋日团建";
  const completedElsewhere = {
    conversationUrl: "https://chatgpt.com/c/account-4",
    sourceMaterialPath: "D:\\素材库\\0\\评0赞0莫干山两天一夜秋日团建",
    stage: "作品归档完成",
    packagePath: "D:\\成品库\\莫干山秋日团建",
    packageValid: true,
    downloadedImageCount: 10
  };
  assert.equal(completedHistoryMatchesAutomationBoundary({
    currentUrl: "https://chatgpt.com/c/account-2",
    materialText,
    historyItems: [completedElsewhere],
    allowCrossConversation: true
  }), true);
  assert.equal(completedHistoryMatchesAutomationBoundary({
    currentUrl: "https://chatgpt.com/c/account-2",
    materialText: "当前素材文件夹：另一套莫干山素材",
    historyItems: [completedElsewhere],
    allowCrossConversation: true
  }), false);
});

test("plans above the ChatGPT batch cap select P1-P10 and expect only that batch", () => {
  assert.deepEqual(firstBatchChoice({ plannedImageCount: 12, maximum: 10 }), {
    reply: "先出 P1-P10",
    expectedImageCount: 10
  });
  assert.deepEqual(firstBatchChoice({ plannedImageCount: 7, maximum: 10 }), {
    reply: "先出 P1-P7",
    expectedImageCount: 7
  });
});

test("material plans must stay within ten pages and must never split into a second batch", () => {
  assert.deepEqual(validatePlanPageCap({
    plannedImageCount: 10,
    text: "计划输出 P1-P10，共10张独立成品图。"
  }), { valid: true, code: "" });
  assert.equal(validatePlanPageCap({
    plannedImageCount: 12,
    text: "第一批 P1-P10，第二批 P11-P12"
  }).code, "PLAN_PAGE_CAP_EXCEEDED");
  assert.equal(validatePlanPageCap({
    plannedImageCount: 10,
    text: "先出 P1-P10，第二批继续剩余内容"
  }).code, "PLAN_BATCHING_FORBIDDEN");
  assert.deepEqual(validatePlanPageCap({
    plannedImageCount: 10,
    text: "最终规划 P1-P10。禁止第 11 页，不做 P11，不会开启第二批。"
  }), { valid: true, code: "" });
  assert.deepEqual(validatePlanPageCap({
    plannedImageCount: 10,
    text: "没有第11页，也不会开启第二批；全部素材已筛选合并。"
  }), { valid: true, code: "" });
});

test("negative P11 guardrails in a valid ten-page plan do not trigger another rewrite", () => {
  assert.equal(parsePlannedImageCount([
    "P1｜封面", "P2｜采茶", "P3｜炒茶", "P4｜点茶", "P5｜露营",
    "P6｜徒步", "P7｜运动会", "P8｜音乐会", "P9｜收尾", "P10｜总结",
    "P11", "不存在需要外溢到第11页的内容。", "绝不生成 P11。"
  ].join("\n")), 10);
  assert.deepEqual(validatePlanPageCap({
    plannedImageCount: 10,
    maximum: 10,
    text: "最终严格控制在 P1-P10，共 10 张，不存在 P11、第二批或遗留素材。禁止第 11 页，禁止第二批。"
  }), { valid: true, code: "" });
});

test("a P10 page may cite original material P11 without proposing an output P11", () => {
  assert.deepEqual(validatePlanPageCap({
    plannedImageCount: 10,
    maximum: 10,
    text: "P10｜早春收尾｜原 P11\n素材来源：原素材 P11 草莓采摘。\n最终只有 P1-P10。"
  }), { valid: true, code: "" });
  assert.deepEqual(validatePlanPageCap({
    plannedImageCount: 11,
    maximum: 10,
    text: "P11｜第二批补充页"
  }), { valid: false, code: "PLAN_PAGE_CAP_EXCEEDED" });
});

test("the instruction actually sent uses the editable task prompt", () => {
  assert.equal(resolveEntryInstruction({
    name: "素材A",
    prompt: "用户在工作台保存的上传提示词"
  }), "用户在工作台保存的上传提示词");
  assert.equal(resolveEntryInstruction({
    name: "素材A",
    prompt: "默认提示词",
    customPrompt: "本任务临时覆盖提示词"
  }), "本任务临时覆盖提示词");
  assert.match(resolveEntryInstruction({ name: "素材A" }), /素材A/);
});

test("template initialization completion does not require a planned image count", () => {
  assert.equal(requiresPlannedImageCount("template-init"), false);
  assert.equal(requiresPlannedImageCount("material"), true);
});

test("a submitted plan with no assistant response recovers after a stable idle minute", () => {
  assert.equal(shouldRecoverSilentAssistant({
    elapsedMs: 59_999,
    thresholdMs: 60_000,
    freshTurnCount: 0,
    generating: false,
    composerEmpty: true
  }), false);
  assert.equal(shouldRecoverSilentAssistant({
    elapsedMs: 60_000,
    thresholdMs: 60_000,
    freshTurnCount: 0,
    generating: false,
    composerEmpty: true
  }), true);
  assert.equal(shouldRecoverSilentAssistant({
    elapsedMs: 90_000,
    thresholdMs: 60_000,
    freshTurnCount: 0,
    generating: true,
    composerEmpty: true
  }), false);
  assert.equal(shouldRecoverSilentAssistant({
    elapsedMs: 90_000,
    thresholdMs: 60_000,
    freshTurnCount: 1,
    generating: false,
    composerEmpty: true
  }), false);
});

test("a confirmed image request with no assistant turn or image recovers after generation stops", () => {
  assert.equal(shouldRecoverSilentImageGeneration({
    elapsedMs: 59_999,
    freshTurnCount: 0,
    freshImageCount: 0,
    generating: false
  }), false);
  assert.equal(shouldRecoverSilentImageGeneration({
    elapsedMs: 60_000,
    freshTurnCount: 0,
    freshImageCount: 0,
    generating: false
  }), true);
  assert.equal(shouldRecoverSilentImageGeneration({
    elapsedMs: 60_000,
    freshTurnCount: 0,
    freshImageCount: 0,
    generating: true
  }), false);
  assert.equal(shouldRecoverSilentImageGeneration({
    elapsedMs: 60_000,
    freshTurnCount: 1,
    freshImageCount: 0,
    generating: false
  }), false);
  assert.equal(shouldRecoverSilentImageGeneration({
    elapsedMs: 60_000,
    freshTurnCount: 0,
    freshImageCount: 1,
    generating: false
  }), false);
});

test("a native image response is stopped only after a long stable partial generation", () => {
  assert.equal(shouldStopStalledNativeImageGeneration({
    generating: true,
    stableForMs: 299_999,
    detected: 3,
    expected: 8
  }), false);
  assert.equal(shouldStopStalledNativeImageGeneration({
    generating: true,
    stableForMs: 300_000,
    detected: 3,
    expected: 8
  }), true);
  assert.equal(shouldStopStalledNativeImageGeneration({
    generating: true,
    stableForMs: 300_000,
    detected: 0,
    expected: 8
  }), false);
  assert.equal(shouldStopStalledNativeImageGeneration({
    generating: true,
    stableForMs: 300_000,
    detected: 8,
    expected: 8
  }), false);
  assert.equal(shouldStopStalledNativeImageGeneration({
    generating: false,
    stableForMs: 300_000,
    detected: 3,
    expected: 8
  }), false);
});

test("a native image response with zero images is also stopped after a long stable stall", () => {
  assert.equal(shouldStopStalledEmptyImageGeneration({
    generating: true,
    stableForMs: 299_999,
    detected: 0,
    expected: 8
  }), false);
  assert.equal(shouldStopStalledEmptyImageGeneration({
    generating: true,
    stableForMs: 300_000,
    detected: 0,
    expected: 8
  }), true);
  assert.equal(shouldStopStalledEmptyImageGeneration({
    generating: true,
    stableForMs: 300_000,
    detected: 1,
    expected: 8
  }), false);
  assert.equal(shouldStopStalledEmptyImageGeneration({
    generating: false,
    stableForMs: 300_000,
    detected: 0,
    expected: 8
  }), false);
});

test("a native text response is stopped only after five minutes of stable empty thinking", () => {
  assert.equal(shouldStopStalledSilentGeneration({
    generating: true,
    stableForMs: 300_000,
    meaningfulTurnCount: 0
  }), true);
  assert.equal(shouldStopStalledSilentGeneration({
    generating: true,
    stableForMs: 299_999,
    meaningfulTurnCount: 0
  }), false);
  assert.equal(shouldStopStalledSilentGeneration({
    generating: true,
    stableForMs: 600_000,
    meaningfulTurnCount: 1
  }), false);
  assert.equal(shouldStopStalledSilentGeneration({
    generating: false,
    stableForMs: 600_000,
    meaningfulTurnCount: 0
  }), false);
});

test("a native thread error retries once even when ChatGPT leaves a stop button visible", () => {
  assert.equal(shouldRetryThreadError({
    elapsedMs: 14_999,
    thresholdMs: 15_000,
    retryVisible: true,
    freshTurnCount: 0,
    alreadyRetried: false
  }), false);
  assert.equal(shouldRetryThreadError({
    elapsedMs: 15_000,
    thresholdMs: 15_000,
    retryVisible: true,
    freshTurnCount: 0,
    alreadyRetried: false
  }), true);
  assert.equal(shouldRetryThreadError({
    elapsedMs: 30_000,
    thresholdMs: 15_000,
    retryVisible: true,
    freshTurnCount: 0,
    alreadyRetried: true
  }), false);
  assert.equal(shouldRetryThreadError({
    elapsedMs: 30_000,
    thresholdMs: 15_000,
    retryVisible: true,
    freshTurnCount: 1,
    alreadyRetried: false
  }), false);
});

test("a settled short copy retries twice before becoming an integrity boundary", () => {
  assert.deepEqual(decideCopyRecovery({
    attempts: 0,
    hasCandidate: false,
    promptMissing: true,
    generating: false,
    valid: false
  }), { action: "retry-current", nextAttempt: 1 });
  assert.deepEqual(decideCopyRecovery({
    attempts: 0,
    hasCandidate: true,
    generating: false,
    valid: false
  }), { action: "retry-current", nextAttempt: 1 });
  assert.deepEqual(decideCopyRecovery({
    attempts: 1,
    hasCandidate: true,
    generating: false,
    valid: false
  }), { action: "retry-current", nextAttempt: 2 });
  assert.deepEqual(decideCopyRecovery({
    attempts: 2,
    hasCandidate: true,
    generating: false,
    valid: false
  }), { action: "pause", nextAttempt: 2 });
  assert.deepEqual(decideCopyRecovery({
    attempts: 0,
    hasCandidate: true,
    generating: true,
    valid: false
  }), { action: "wait", nextAttempt: 0 });
});

test("unpaired copy recovery only accepts a turn created after the copy request", () => {
  assert.equal(isFreshAutomationTurnKey({ key: "old-copy", baselineKeys: ["old-copy", "old-plan"] }), false);
  assert.equal(isFreshAutomationTurnKey({ key: "new-copy", baselineKeys: ["old-copy", "old-plan"] }), true);
  assert.equal(isFreshAutomationTurnKey({ key: "unknown", baselineKeys: [] }), false);
});

test("a streaming reply that repeats one placeholder line eight times is a recoverable loop", () => {
  assert.deepEqual(detectRepetitiveAssistantLoop([
    "已重新",
    "文案", "文案", "文案", "文案", "文案", "文案", "文案", "文案"
  ].join("\n\n")), {
    detected: true,
    token: "文案",
    repeats: 8
  });
  assert.equal(detectRepetitiveAssistantLoop([
    "P1｜封面", "页面角色：路线封面", "P2｜漂流", "页面角色：玩法页",
    "P3｜溯溪", "页面角色：玩法页", "P4｜住宿", "页面角色：场景页"
  ].join("\n")).detected, false);
});

test("计划只渲染标题时不能提前通过，完整规划总页数可以恢复当前帖子", () => {
  const partialPlan = "【显性逐页迁移计划｜待确认】\n当前任务名称";
  const plan = [
    "【显性逐页迁移计划｜待确认】",
    "本轮规划总页数：5页",
    "P1 苏州·西山岛国庆团建",
    "P2 私享庭院",
    "P3 包栋公区",
    "P4 星空派对",
    "P5 围炉煮茶",
    "逐页迁移计划已经完成。回复 1 后直接进入5页整套批量出图。"
  ].join("\n");

  assert.deepEqual(classifyPlanDetectionResult({
    validPlan: true,
    planComplete: true,
    plannedImageCount: parsePlannedImageCount(partialPlan)
  }), {
    ready: false,
    code: "PLAN_NOT_COMPLETE"
  });
  assert.equal(parsePlannedImageCount(plan), 5);
});

test("计划未返回时必须暂停当前帖子，不能跳过并上传下一套", () => {
  assert.deepEqual(classifyPlanDetectionResult({ validPlan: false, planComplete: false }), {
    ready: false,
    code: "PLAN_NOT_READY"
  });
  assert.deepEqual(classifyPlanDetectionResult({ validPlan: true, planComplete: false }), {
    ready: false,
    code: "PLAN_NOT_COMPLETE"
  });
  assert.deepEqual(classifyPlanDetectionResult({ validPlan: true, planComplete: true }), {
    ready: true,
    code: ""
  });
});

test("计划未返回时先恢复当前附件消息，连续失败后才暂停", () => {
  assert.deepEqual(decidePlanRecovery({ attempts: 0, maxAttempts: 2, generating: true }), {
    action: "wait-current",
    nextAttempt: 0
  });
  assert.deepEqual(decidePlanRecovery({ attempts: 0, maxAttempts: 2 }), {
    action: "retry-current",
    nextAttempt: 1
  });
  assert.deepEqual(decidePlanRecovery({ attempts: 1, maxAttempts: 2 }), {
    action: "retry-current",
    nextAttempt: 2
  });
  assert.deepEqual(decidePlanRecovery({ attempts: 2, maxAttempts: 2 }), {
    action: "pause",
    nextAttempt: 2
  });
});

test("实际图片少于计划数时先补齐，重试耗尽后暂停而不是进入文案", () => {
  assert.deepEqual(decidePartialImageRecovery({ detected: 5, expected: 10, attempts: 0, maxAttempts: 2 }), {
    action: "continue-missing",
    nextAttempt: 1
  });
  assert.deepEqual(decidePartialImageRecovery({ detected: 9, expected: 10, attempts: 2, maxAttempts: 2 }), {
    action: "pause-partial",
    nextAttempt: 2
  });
  assert.deepEqual(decidePartialImageRecovery({ detected: 10, expected: 10, attempts: 1, maxAttempts: 2 }), {
    action: "complete",
    nextAttempt: 1
  });
});

test("明确的生图失败在原地重试耗尽后切换账号而不是停成图片数量不确定", () => {
  assert.deepEqual(classifyExhaustedImageRecovery({
    evidence: "failed-image-response",
    attempts: 2,
    maxAttempts: 2,
    detected: 0
  }), {
    action: "rotate-account",
    code: "IMAGE_GENERATION_UNAVAILABLE"
  });
  assert.deepEqual(classifyExhaustedImageRecovery({
    evidence: "silent-image-response",
    attempts: 2,
    maxAttempts: 2,
    detected: 0
  }), {
    action: "pause-uncertain",
    code: "IMAGE_COUNT_UNCERTAIN"
  });
});

test("补图回复只包含缺少页时会和前序图片累计后完成", () => {
  const firstSeven = Array.from({ length: 7 }, (_, index) => `https://chatgpt.com/image?id=page-${index + 1}`);
  const recovery = mergePartialImageRecovery({
    accumulated: firstSeven,
    detected: ["https://chatgpt.com/image?id=page-8"],
    expected: 8,
    attempts: 2,
    maxAttempts: 2
  });
  assert.equal(recovery.action, "complete");
  assert.equal(recovery.urls.length, 8);
});

test("重启恢复会合并最近一次确认 1 之后分散在多条回复里的图片", () => {
  const oldBatch = Array.from({ length: 10 }, (_, index) => `https://chatgpt.com/image?id=old-${index + 1}`);
  const firstSeven = Array.from({ length: 7 }, (_, index) => `https://chatgpt.com/image?id=page-${index + 1}`);
  const pageEight = "https://chatgpt.com/image?id=page-8";
  const urls = imageUrlsFromLatestConfirmedBatch([
    { role: "user", text: "1" },
    { role: "assistant", urls: oldBatch },
    { role: "user", text: "请写文案" },
    { role: "assistant", urls: [] },
    { role: "user", text: " 1 " },
    { role: "assistant", urls: firstSeven },
    { role: "user", text: "继续补齐到 8 张" },
    { role: "assistant", urls: [pageEight] }
  ]);
  assert.deepEqual(urls, [...firstSeven, pageEight]);
});

test("a completed copy that finishes after streaming retries is adopted before the exhausted guard", () => {
  const sidebar = require("node:fs").readFileSync(require("node:path").join(__dirname, "sidebar.js"), "utf8");
  assert.match(sidebar, /if \(!publishResult && workflow\.textSubmitted === true && !generatingNow\(\)\)/);
  assert.match(sidebar, /durableRecoveryConversationMatchesEntry\(task\.entry\)/);
  assert.match(sidebar, /latestCopyTurnAfterPrompt\(baseCopyPrompt,[\s\S]*?baselineKeys: \[\]/);
  assert.match(sidebar, /completed-copy-adopted-before-exhaustion/);
  assert.ok(sidebar.indexOf("completed-copy-adopted-before-exhaustion") < sidebar.indexOf("workflow.copyRecoveryExhausted === true && !publishResult"));
});

test("网页暂时没有图片 DOM 时可采用同一确认任务保存的完整图片边界", () => {
  const baseline = Array.from({ length: 10 }, (_, index) => `https://chatgpt.com/image?id=old-${index + 1}`);
  const current = Array.from({ length: 10 }, (_, index) => `https://chatgpt.com/image?id=current-${index + 1}`);
  const result = resolveDurableImageBoundary({
    expectedImageCount: 10,
    imageSubmitted: true,
    confirmTurnKey: "conversation-turn-11",
    generatedImageUrls: current,
    generatedBaselineUrls: baseline,
    generatedImageActualCount: 10
  });
  assert.equal(result.ready, true);
  assert.equal(result.reason, "submitted-task-complete-image-boundary");
  assert.equal(result.urls.length, 10);
  assert.equal(result.freshUrls.length, 10);
});

test("只有 10/10 计数但没有同任务图片边界时不能误判完成", () => {
  const result = resolveDurableImageBoundary({
    expectedImageCount: 10,
    imageSubmitted: true,
    generatedImages: 10,
    generatedImageActualCount: 10,
    generatedImageUrls: []
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "task-image-boundary-missing");
});

test("持久图片集合与确认前基线重叠时不能当作当前批次", () => {
  const shared = Array.from({ length: 10 }, (_, index) => `https://chatgpt.com/image?id=old-${index + 1}`);
  const result = resolveDurableImageBoundary({
    expectedImageCount: 10,
    imageSubmitted: true,
    confirmTurnKey: "conversation-turn-11",
    generatedImageUrls: shared,
    generatedBaselineUrls: shared,
    generatedImageActualCount: 10
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "durable-image-set-overlaps-baseline");
});

test("附件全部出现时允许进入自动处理", () => {
  assert.deepEqual(classifyAttachmentUploadResult({ expected: 7, observed: 7 }), {
    status: "complete",
    expected: 7,
    observed: 7
  });
});

test("附件只出现一部分时判定上传上限并停止发送", () => {
  assert.deepEqual(classifyAttachmentUploadResult({ expected: 7, observed: 3 }), {
    status: "partial",
    expected: 7,
    observed: 3,
    code: "UPLOAD_LIMIT_SIGNAL"
  });
});

test("附件一个都没出现时保留普通上传失败", () => {
  assert.deepEqual(classifyAttachmentUploadResult({ expected: 7, observed: 0 }), {
    status: "missing",
    expected: 7,
    observed: 0,
    code: "ATTACHMENT_UPLOAD_NOT_READY"
  });
});

test("禁用的停止回答按钮不再被判定为生成中", () => {
  assert.equal(isActiveGenerationControl({ visible: true, disabled: true, label: "停止回答" }), false);
  assert.equal(isActiveGenerationControl({ visible: true, disabled: false, label: "停止回答" }), true);
  assert.equal(isActiveGenerationControl({ visible: false, disabled: false, label: "停止回答" }), false);
});

test("历史里的已停止思考按钮不再被判定为正在生成", () => {
  assert.equal(isActiveGenerationControl({ visible: true, disabled: false, label: "已停止思考" }), false);
  assert.equal(isActiveGenerationControl({ visible: true, disabled: false, label: "停止回答" }), true);
});

test("关键词正则可检测计划、图片、文案完成信号", () => {
  const replies = {
    plan: "P1｜封面迁移\nP2｜内页迁移\n计划完成，等待你回复 1。",
    images: "本轮图片已经全部生成。\n出图完毕",
    copy: "适合 HR 收藏的团建攻略正文...\n#团建 #公司团建\n文案完成"
  };

  assert.equal(keywordPatternMatches(replies.plan, "计划完成"), true);
  assert.equal(keywordPatternMatches(replies.images, "出图完毕"), true);
  assert.equal(keywordPatternMatches(replies.copy, "文案完成"), true);
});

test("等待模块空关键词会使用可编辑默认值", () => {
  assert.equal(defaultKeywordPattern("wait-plan"), "迁移计划|逐页|P\\s*1|计划完成");
  assert.equal(defaultKeywordPattern("wait-images"), "出图完毕|图片完成|生成完成");
  assert.equal(defaultKeywordPattern("wait-copy"), "文案完成|文案已完成|复制文案完成");
});

test("完成关键词检测返回命中状态和来源", () => {
  const result = completionKeywordDetected("图片都好了，出图完毕。", {
    action: "wait-images",
    keywordPattern: ""
  });

  assert.deepEqual(result, {
    matched: true,
    pattern: "出图完毕|图片完成|生成完成"
  });
});

test("无效正则不抛异常并按普通文本匹配", () => {
  assert.equal(keywordPatternMatches("计划完成", "["), false);
  assert.equal(keywordPatternMatches("请输出 [完成] 标记", "[完成]"), true);
});

// ── PY 脚本兜底拼图检测 ──

test("PY脚本兜底拼图:有图+脚本特征+大量文字 → 检测到", () => {
  const result = detectPyScriptFallbackSignal({
    text: "我已用Python脚本为你生成了图片。以下是图片的详细描述：这张图片展示了团建活动的场景..." + "x".repeat(600),
    nativeImages: 3,
    hasCodeSignal: true,
    hasScriptArtifact: false
  });
  assert.equal(result.detected, true);
  assert.equal(result.reason, "py-script-fallback");
});

test("PY脚本兜底拼图:有图+脚本文件附件 → 检测到(无论文字量)", () => {
  const result = detectPyScriptFallbackSignal({
    text: "图片已生成",
    nativeImages: 2,
    hasCodeSignal: false,
    hasScriptArtifact: true
  });
  assert.equal(result.detected, true);
});

test("PY脚本兜底拼图:有图+无脚本特征+大量文字 → 不检测到(文字多不等于脚本)", () => {
  const result = detectPyScriptFallbackSignal({
    text: "这是一段非常长的文案描述" + "y".repeat(800),
    nativeImages: 4,
    hasCodeSignal: false,
    hasScriptArtifact: false
  });
  assert.equal(result.detected, false);
});

test("PY脚本兜底拼图:无图 → 不检测到(没有图片不判PY拼图)", () => {
  const result = detectPyScriptFallbackSignal({
    text: "Python脚本输出" + "z".repeat(600),
    nativeImages: 0,
    hasCodeSignal: true,
    hasScriptArtifact: true
  });
  assert.equal(result.detected, false);
});

test("PY脚本兜底拼图:有图+脚本特征+少量文字 → 检测到(脚本特征本身足够)", () => {
  const result = detectPyScriptFallbackSignal({
    text: "已用代码解释器生成图片",
    nativeImages: 4,
    hasCodeSignal: true,
    hasScriptArtifact: false
  });
  assert.equal(result.detected, true);
});

// ── 纯脚本/沙盒输出触顶检测 ──

test("纯脚本/沙盒输出:无原生图+脚本文件 → 判定为生图触顶", () => {
  const result = detectScriptOutputLimitSignal({
    nativeImages: 0,
    artifactCount: 1,
    hasCodeSignal: false,
    hasScriptArtifact: true,
    hasArchiveSignal: false
  });
  assert.deepEqual(result, {
    detected: true,
    reason: "script-output-limit"
  });
});

test("纯脚本/沙盒输出:无原生图+压缩包/批量下载产物 → 判定为生图触顶", () => {
  const result = detectScriptOutputLimitSignal({
    nativeImages: 0,
    artifactCount: 1,
    hasCodeSignal: false,
    hasScriptArtifact: false,
    hasArchiveSignal: true
  });
  assert.equal(result.detected, true);
  assert.equal(result.reason, "script-output-limit");
});

test("纯脚本/沙盒输出:已有原生图时不走纯脚本触顶", () => {
  const result = detectScriptOutputLimitSignal({
    nativeImages: 2,
    artifactCount: 1,
    hasCodeSignal: true,
    hasScriptArtifact: true,
    hasArchiveSignal: true
  });
  assert.equal(result.detected, false);
});

test("纯脚本/沙盒输出:无产物时不判触顶", () => {
  const result = detectScriptOutputLimitSignal({
    nativeImages: 0,
    artifactCount: 0,
    hasCodeSignal: true,
    hasScriptArtifact: false,
    hasArchiveSignal: false
  });
  assert.equal(result.detected, false);
});

test("mock工作流:纯脚本/沙盒输出会返回触顶暂停决策", () => {
  const decision = classifyAutomationBoundaryPause({
    scriptOutputLimitSignal: true,
    latestImageCount: 0,
    stage: "generation-limit-or-script"
  });
  assert.deepEqual(decision, {
    shouldPause: true,
    boundaryPaused: true,
    code: "GENERATION_LIMIT_SIGNAL",
    riskReason: "script-output-limit",
    message: "检测到纯脚本/沙盒产物输出，按生图触顶处理，停止当前帖子"
  });
});

test("连续自动模式可以自动清理输入框边界，但人工模式仍保留门禁", () => {
  assert.equal(shouldAutoClearComposerBoundary({
    autoRun: true,
    mode: "single",
    continuousAutoStart: true,
    errorCode: "COMPOSER_ATTACHMENT_CONFLICT"
  }), true);
  assert.equal(shouldAutoClearComposerBoundary({
    autoRun: false,
    mode: "manual",
    errorCode: "COMPOSER_ATTACHMENT_CONFLICT",
    errorDetail: "当前 GPT 输入框需要先清理未发送内容"
  }), false);
  assert.equal(shouldAutoClearComposerBoundary({
    autoRun: true,
    mode: "single",
    continuousAutoStart: true,
    errorCode: "GENERATION_LIMIT_SIGNAL"
  }), false);
});

test("连续自动模式可以释放已提交作品的计划恢复边界，但不释放真实触顶", () => {
  assert.equal(shouldAutoResumeWorkflowBoundary({
    autoRun: true,
    autoRecovery: true,
    mode: "single",
    continuousAutoStart: true,
    errorCode: "PLAN_NOT_READY"
  }), true);
  assert.equal(shouldAutoResumeWorkflowBoundary({
    autoRun: true,
    autoRecovery: true,
    mode: "single",
    continuousAutoStart: true,
    errorCode: "GENERATION_LIMIT_SIGNAL"
  }), false);
  assert.equal(shouldAutoResumeWorkflowBoundary({
    autoRun: true,
    autoRecovery: true,
    mode: "single",
    continuousAutoStart: true,
    errorCode: "PLAN_NOT_READY",
    userHold: true
  }), false);
});

// ── 低图触顶检测 ──

test("低图触顶:4张图 → 检测到", () => {
  const result = detectLowImageLimit({ nativeImages: 4, threshold: 4 });
  assert.equal(result.detected, true);
  assert.equal(result.count, 4);
  assert.equal(result.threshold, 4);
});

test("低图触顶:3张图 → 检测到", () => {
  const result = detectLowImageLimit({ nativeImages: 3, threshold: 4 });
  assert.equal(result.detected, true);
});

test("低图触顶:5张图 → 不检测到", () => {
  const result = detectLowImageLimit({ nativeImages: 5, threshold: 4 });
  assert.equal(result.detected, false);
});

test("低图触顶:0张图 → 不检测到(无图不判低产出)", () => {
  const result = detectLowImageLimit({ nativeImages: 0, threshold: 4 });
  assert.equal(result.detected, false);
});

test("低图触顶:默认阈值4", () => {
  const result = detectLowImageLimit({ nativeImages: 4 });
  assert.equal(result.detected, true);
  assert.equal(result.threshold, 4);
});
