const test = require("node:test");
const assert = require("node:assert/strict");

const {
  accountParticipatesInRotation,
  accountQuotaBoundary,
  effectiveProductionMode,
  completedCopyBoundaryStatus,
  freshConversationInjectionBoundary,
  materialIdentityKey,
  materialIdentityMatches,
  materialIdentityVariants,
  recentSuccessfulMaterialKeys,
  recoverableMaterialPaths,
  rotationRunAfterModeSwitch,
  rotationBoundaryRecovery,
  shouldRetryRotationBoundary,
  reconcileAccountQuotaSettings,
  rotationResumeCheckpoint,
  resumedWorkflowState,
  rotationTaskBoundAccountId,
  selectMaterialAttachments,
  shouldInitializeTemplate,
  taskQuotaBoundary,
  selectNextRotationAccount
} = require("./gpt-account-rotation");

test("material attachment selection respects the web limit and preserves copy files", () => {
  const images = Array.from({ length: 25 }, (_, index) => `D:\\material\\image-${index + 1}.jpg`);
  const selected = selectMaterialAttachments([...images, "D:\\material\\文案.txt", images[0]], 20);

  assert.equal(selected.length, 20);
  assert.equal(new Set(selected).size, 20);
  assert.equal(selected.includes("D:\\material\\文案.txt"), true);
  assert.deepEqual(selected.filter((filePath) => /\.jpg$/i.test(filePath)), images.slice(0, 19));
});

test("submitted material stays bound to the account that owns its conversation", () => {
  assert.equal(rotationTaskBoundAccountId({
    taskType: "material",
    _submittedToGpt: true,
    accountId: "account-4"
  }), "account-4");
  assert.equal(rotationTaskBoundAccountId({
    taskType: "material",
    _submittedToGpt: false,
    accountId: "account-4"
  }), "");
});

test("a fresh material cannot overwrite an unfinished conversation after restart", () => {
  assert.deepEqual(freshConversationInjectionBoundary({
    taskType: "material",
    _submittedToGpt: false,
    forceUpload: true
  }, {
    stage: "completed-copy-pending-package",
    canInjectNext: false,
    hasCopy: true
  }), {
    blocked: true,
    stage: "completed-copy-pending-package"
  });

  assert.deepEqual(freshConversationInjectionBoundary({
    taskType: "material",
    _submittedToGpt: true,
    retryFromStage: "等待小红书文案",
    forceUpload: false
  }, {
    stage: "completed-copy-pending-package",
    canInjectNext: false
  }), { blocked: false, stage: "completed-copy-pending-package" });

  assert.deepEqual(freshConversationInjectionBoundary({
    taskType: "material",
    _submittedToGpt: false
  }, {
    stage: "archived",
    canInjectNext: true
  }), { blocked: false, stage: "archived" });
});

test("restarting rotation converts a paused composer conflict into an explicit retry", () => {
  assert.equal(shouldRetryRotationBoundary({
    taskType: "material",
    _status: "paused",
    _errorCode: "COMPOSER_ATTACHMENT_CONFLICT",
    requestId: "request-before-conflict"
  }), true);
  assert.equal(shouldRetryRotationBoundary({
    taskType: "material",
    _status: "paused",
    _errorCode: "PLAN_NOT_COMPLETE",
    requestId: "request-with-plan"
  }), false);
  assert.equal(shouldRetryRotationBoundary({
    taskType: "material",
    _status: "completed",
    _errorCode: "COMPOSER_ATTACHMENT_CONFLICT",
    requestId: "completed-request"
  }), false);
});

test("restart and composer-draft boundaries enter inspection-first rotation recovery", () => {
  for (const code of ["COMPOSER_DRAFT_PENDING", "RESTART_INTERRUPTED"]) {
    assert.equal(shouldRetryRotationBoundary({
      taskType: "material",
      _status: "paused",
      _errorCode: code,
      requestId: `request-${code}`
    }), true);
  }
});

test("a composer conflict resumes the existing plan only with matching durable and page evidence", () => {
  const task = {
    taskType: "material",
    _status: "paused",
    _errorCode: "COMPOSER_ATTACHMENT_CONFLICT",
    requestId: "request-with-uploaded-plan",
    attachments: Array.from({ length: 8 }, (_, index) => `P${index + 1}.jpg`)
  };
  assert.deepEqual(rotationBoundaryRecovery(task, {
    currentTaskId: "request-with-uploaded-plan",
    uploadedAttachments: 8,
    expectedAttachments: 8
  }, {
    stage: "plan-ready",
    patrolState: { key: "awaiting-confirm" },
    waitingForConfirm: true,
    attachmentCount: 0,
    composerDraft: ""
  }), { action: "resume-plan" });
  assert.deepEqual(rotationBoundaryRecovery(task, {
    currentTaskId: "another-request",
    uploadedAttachments: 8,
    expectedAttachments: 8
  }, {
    stage: "plan-ready",
    patrolState: { key: "awaiting-confirm" },
    waitingForConfirm: true
  }), { action: "fresh-retry" });
});

test("a copy reply keeps a partially hydrated image batch occupied", () => {
  const base = {
    stage: "images-ready",
    generated: true,
    hasCopy: true,
    latestImageCount: 3,
    expectedImageCount: 9,
    generating: false
  };
  assert.equal(completedCopyBoundaryStatus(base), "waiting-images");
  assert.equal(completedCopyBoundaryStatus({ ...base, latestImageCount: 9 }), "ready");
  assert.equal(completedCopyBoundaryStatus({ ...base, latestImageCount: 3, evidenceDiagnostic: { latestSemanticBatchImages: 9 } }), "ready");
  assert.equal(completedCopyBoundaryStatus({ ...base, hasCopy: false }), "none");
});

test("a restart interrupted task with durable images resumes the same request and workflow", () => {
  const task = {
    taskType: "material",
    _status: "paused",
    _errorCode: "RESTART_INTERRUPTED",
    _submittedToGpt: true,
    requestId: "request-with-eight-images",
    workflow: {
      plannedImageCount: 8,
      generatedImageUrls: Array.from({ length: 8 }, (_, index) => `https://example.test/file-${index + 1}.png`)
    }
  };
  assert.deepEqual(rotationBoundaryRecovery(task, {
    currentTaskId: "request-with-eight-images"
  }, {
    stage: "completed-copy-pending-package",
    canInjectNext: false,
    attachmentCount: 0,
    composerDraft: ""
  }), { action: "resume-checkpoint" });
});

test('successful materials remain deduplicated after their usage folder changes', () => {
  const now = Date.parse('2026-08-09T00:00:00.000Z');
  const before = 'D:\\\\materials\\\\1\\\\post-name（607ae3f8）';
  const after = 'D:\\\\materials\\\\2\\\\post-name（607ae3f8）';
  assert.equal(materialIdentityKey(before), materialIdentityKey(after));
  assert.deepEqual(recentSuccessfulMaterialKeys([{
    sourceMaterialPath: before,
    packageValid: true,
    updatedAt: '2026-08-08T23:00:00.000Z'
  }], now), [materialIdentityKey(after)]);
});

test("recent incomplete checkpoints reserve their source material across accounts and restarts", () => {
  const now = Date.parse("2026-08-08T15:10:00.000Z");
  assert.deepEqual(recoverableMaterialPaths([
    {
      sourceMaterialPath: "D:\\materials\\work-a",
      stage: "等待小红书文案",
      percent: 66,
      plannedImageCount: 9,
      packageValid: false,
      updatedAt: "2026-08-08T15:04:00.000Z"
    },
    {
      sourceMaterialPath: "D:\\materials\\completed",
      stage: "已归档",
      percent: 100,
      packageValid: true,
      updatedAt: "2026-08-08T15:05:00.000Z"
    },
    {
      sourceMaterialPath: "D:\\materials\\stale",
      stage: "等待图片",
      percent: 50,
      packageValid: false,
      updatedAt: "2026-08-06T12:00:00.000Z"
    },
    {
      sourceMaterialPath: "D:\\materials\\not-started",
      stage: "已排队",
      percent: 0,
      packageValid: false,
      updatedAt: "2026-08-08T15:06:00.000Z"
    }
  ], now), ["d:/materials/work-a"]);
});

test("an unfinished rotation run stays authoritative across pause and restart", () => {
  assert.equal(effectiveProductionMode("single", { mode: "rotate", status: "running" }), "rotate");
  assert.equal(effectiveProductionMode("single", { rotation: true, status: "paused" }), "rotate");
  assert.equal(effectiveProductionMode("single", { mode: "rotate", status: "waiting-quota" }), "rotate");
  assert.equal(effectiveProductionMode("single", { mode: "rotate", status: "completed" }), "single");
  assert.equal(effectiveProductionMode("manual", null), "manual");
});

test("an explicit user mode switch suspends rotation without deleting its resumable run", () => {
  const paused = { mode: "rotate", rotation: true, status: "paused", runId: "run-1" };
  const suspended = rotationRunAfterModeSwitch(paused, "manual");
  assert.equal(suspended.status, "paused-mode-switch");
  assert.equal(suspended.suspendedByModeSwitch, true);
  assert.equal(suspended.runId, "run-1");
  assert.equal(effectiveProductionMode("manual", suspended), "manual");

  const resumed = rotationRunAfterModeSwitch(suspended, "rotate");
  assert.equal(resumed.status, "paused");
  assert.equal(resumed.suspendedByModeSwitch, false);
  assert.equal(resumed.suspendedForMode, null);
  assert.equal(effectiveProductionMode("rotate", resumed), "rotate");
});

test("a submitted material resumes its existing conversation without template reinitialization", () => {
  assert.equal(shouldInitializeTemplate({ taskType: "material", templateId: "T03", _submittedToGpt: true }, false), false);
  assert.equal(shouldInitializeTemplate({ taskType: "material", templateId: "T03" }, true), false);
  assert.equal(shouldInitializeTemplate({ taskType: "material", templateId: "T03" }, false), true);
  assert.equal(shouldInitializeTemplate({ taskType: "material" }, false), false);
});

test("a submitted rotation task resumes the web checkpoint without charging or uploading again", () => {
  assert.deepEqual(rotationResumeCheckpoint({
    taskType: "material",
    _submittedToGpt: true,
    _stage: "等待图片",
    _percent: 64
  }), { resuming: true, stage: "等待图片", percent: 64 });
  assert.deepEqual(rotationResumeCheckpoint({
    taskType: "material",
    _submittedToGpt: true,
    _stage: "等待附件就绪",
    _percent: 16
  }), { resuming: true, stage: "等待迁移计划", percent: 24 });
  assert.deepEqual(rotationResumeCheckpoint({ taskType: "material", _submittedToGpt: false }), {
    resuming: false,
    stage: "",
    percent: 0
  });
});

test("restart recovery matches the same material across workflow display prefixes", () => {
  const folder = "评0赞1西山岛山野民宿，团建避暑优选";
  assert.equal(materialIdentityMatches(
    `当前会话母版 × ${folder}`,
    `当前会话恢复 · ${folder}`
  ), true);
  assert.equal(materialIdentityMatches(
    `D:\\materials\\0\\${folder}`,
    `当前会话恢复 · ${folder}`
  ), true);
  assert.deepEqual(materialIdentityVariants(`当前会话恢复 · ${folder}`).at(-1), folder.toLowerCase());
  assert.equal(materialIdentityMatches("评0赞1西山岛山野民宿", "另一套素材"), false);
});

test("restart recovery rebuilds the minimum workflow flags without inventing a new upload", () => {
  assert.deepEqual(resumedWorkflowState({
    taskType: "material",
    _submittedToGpt: true,
    expectedImages: 8,
    _stage: "随机等待",
    retryFromStage: "补齐缺少图片",
    workflow: null
  }, { stage: "随机等待", percent: 48 }, { expectedImages: 9 }), {
    planSubmitted: true,
    planDone: true,
    imageSubmitted: true,
    plannedImageCount: 9,
    generatedImageUrls: []
  });
  assert.equal(resumedWorkflowState({ taskType: "material", workflow: {} }, {
    stage: "等待迁移计划"
  }).planDone, false);
  assert.equal(resumedWorkflowState({ taskType: "material", workflow: { imageSubmitted: true } }, {
    stage: "恢复迁移计划"
  }).planDone, true);
});

test("a submitted post-image checkpoint stays after a generic renderer restart stage", () => {
  const resumed = resumedWorkflowState({
    taskType: "material",
    _submittedToGpt: true,
    _stage: "网页检查点丢失",
    retryFromStage: "网页检查点丢失",
    workflow: {
      planSubmitted: true,
      imageSubmitted: true,
      plannedImageCount: 5
    }
  }, {
    stage: "网页检查点丢失",
    percent: 20
  }, {
    currentStage: "网页检查点丢失",
    expectedImages: 5,
    generatedImages: 7
  });
  assert.equal(resumed.planDone, true);
  assert.equal(resumed.imageSubmitted, true);
  assert.equal(resumed.plannedImageCount, 5);
});

test("durable copy or package evidence never resumes behind the copy boundary", () => {
  const fromCopy = resumedWorkflowState({
    taskType: "material",
    _submittedToGpt: true,
    _stage: "等待迁移计划",
    workflow: {
      planSubmitted: true,
      imageSubmitted: true,
      copyText: "<<<COPY_FORMAT:2>>>" + "完整发布文案".repeat(80)
    }
  }, { stage: "等待迁移计划", percent: 24 }, {});
  assert.equal(fromCopy.planDone, true);
  assert.equal(fromCopy.imageSubmitted, true);
  assert.equal(fromCopy.textSubmitted, true);

  const fromPackage = resumedWorkflowState({
    taskType: "material",
    _submittedToGpt: true,
    workflow: {},
    _result: { packagePath: "D:\\products\\作品集_001", copyTextLength: 680 }
  }, { stage: "等待图片", percent: 48 }, {});
  assert.equal(fromPackage.textSubmitted, true);
});

test("automatic recovery deferrals keep a submitted plan in the image stage", () => {
  const resumed = resumedWorkflowState({
    taskType: "material",
    _submittedToGpt: true,
    _autoRecoveryDeferrals: 3,
    _stage: "等待迁移计划",
    retryFromStage: "等待迁移计划",
    workflow: { planSubmitted: true, planDone: false, planText: "P1-P8 迁移计划", plannedImageCount: 8 }
  }, { stage: "重启后恢复原对话" }, {});
  assert.equal(resumed.planDone, true);
  assert.equal(resumed.imageSubmitted, true);
  assert.equal(resumed.recoveryBoundaryConfirmed, true);
});

test("later-added account inherits current quota defaults without overwriting existing settings", () => {
  assert.deepEqual(reconcileAccountQuotaSettings({
    profiles: [
      { id: "account-1", name: "primary" },
      { id: "account-6", name: "new account" }
    ],
    settings: [
      { id: "account-1", name: "primary", uploadLimit: 60, generationLimit: 40, windowHours: 4 }
    ],
    defaults: { uploadLimit: 80, generationLimit: 45, windowHours: 3 }
  }), [
    { id: "account-1", name: "primary", uploadLimit: 60, generationLimit: 40, windowHours: 4 },
    { id: "account-6", name: "new account", uploadLimit: 80, generationLimit: 45, windowHours: 3 }
  ]);
});

test("a new work starts only when all attachments and the complete image set fit quota", () => {
  assert.deepEqual(taskQuotaBoundary({
    requiredUploads: 6,
    requiredGenerations: 5,
    remainingUploads: 7,
    remainingGenerations: 1
  }), { reached: true, kind: "generation", required: 5, remaining: 1 });
  assert.deepEqual(taskQuotaBoundary({
    requiredUploads: 6,
    requiredGenerations: 5,
    remainingUploads: 5,
    remainingGenerations: 20
  }), { reached: true, kind: "upload", required: 6, remaining: 5 });
  assert.deepEqual(taskQuotaBoundary({
    requiredUploads: 6,
    requiredGenerations: 5,
    remainingUploads: 6,
    remainingGenerations: 5
  }), { reached: false, kind: "", required: 0, remaining: 0 });
});

test("全局轮换只接纳启用且模式为 rotate 的账号", () => {
  assert.equal(accountParticipatesInRotation({ id: "a", mode: "rotate" }), true);
  assert.equal(accountParticipatesInRotation({ id: "b", mode: "manual" }), false);
  assert.equal(accountParticipatesInRotation({ id: "c", mode: "single" }), false);
  assert.equal(accountParticipatesInRotation({ id: "d", mode: "rotate", disabled: true }), false);
  assert.equal(accountParticipatesInRotation({ id: "e", mode: "rotate", hidden: true }), true);
  assert.equal(accountParticipatesInRotation({ id: "f", mode: "rotate" }, { pausedByUser: true }), false);
  assert.equal(accountParticipatesInRotation({ id: "g", mode: "rotate" }, { stoppedByUser: true }), false);
});

test("安全线只在完整作品结束后触发冷却并使用最早滚动恢复时间", () => {
  const now = Date.parse("2026-08-07T12:00:00.000Z");
  assert.deepEqual(accountQuotaBoundary({ generated: 44, settings: { generationLimit: 45 } }, now), {
    reached: false,
    generated: 44,
    limit: 45,
    nextProbeAt: 0
  });
  assert.deepEqual(accountQuotaBoundary({
    generated: 49,
    nextExpiryAt: "2026-08-07T14:15:00.000Z",
    settings: { generationLimit: 45 }
  }, now), {
    reached: true,
    generated: 49,
    limit: 45,
    nextProbeAt: Date.parse("2026-08-07T14:15:00.000Z")
  });
});

test("轮换从当前游标向后循环，跳过冷却和不参与账号", () => {
  const now = Date.parse("2026-08-07T12:00:00.000Z");
  const accounts = [
    { id: "a", mode: "rotate" },
    { id: "b", mode: "manual" },
    { id: "c", mode: "rotate" }
  ];
  const selected = selectNextRotationAccount({
    accounts,
    cursor: 0,
    now,
    cycleByAccount: {
      a: { nextProbeAt: now + 60_000 },
      c: { nextProbeAt: 0 }
    }
  });
  assert.equal(selected.account.id, "c");
  assert.equal(selected.cursor, 2);

  const wrapped = selectNextRotationAccount({
    accounts,
    cursor: 3,
    now,
    cycleByAccount: { a: {}, c: {} }
  });
  assert.equal(wrapped.account.id, "a");
  assert.equal(wrapped.cursor, 0);
});

test("全部轮换账号冷却时返回最早恢复时间", () => {
  const now = Date.parse("2026-08-07T12:00:00.000Z");
  const first = now + 30 * 60_000;
  const second = now + 90 * 60_000;
  const selected = selectNextRotationAccount({
    accounts: [{ id: "a", mode: "rotate" }, { id: "b", mode: "rotate" }],
    cursor: 0,
    now,
    cycleByAccount: {
      a: { nextProbeAt: second },
      b: { nextProbeAt: first }
    }
  });
  assert.equal(selected.account, null);
  assert.equal(selected.nextProbeAt, first);
});
