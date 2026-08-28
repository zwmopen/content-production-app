"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  classifyPatrolStage,
  decidePatrolSingleStep,
  decidePatrolCopyRecovery,
  isAutomationMaterialPrompt,
  findCompletedCopyBoundary,
  preferredRecoveryImageUrls,
  hasDurablePatrolPackageEvidence,
  resolvePatrolCopyBoundary,
  shouldProtectCopyBoundaryFromImageRecovery,
  patrolMaterialCopyIdentity
} = require("./patrol-stage");

test("patrol recognizes both legacy and current complete-attachment material prompts", () => {
  assert.equal(isAutomationMaterialPrompt("请完整读取全部附件，不要省略 TXT。\n当前素材文件夹：作品 A"), true);
  assert.equal(isAutomationMaterialPrompt("请读取全部附件。\n当前素材文件夹：作品 B"), true);
  assert.equal(isAutomationMaterialPrompt("文案(20260824-122252).txt 文档\n当前素材文件夹：作品 C"), true);
  assert.equal(isAutomationMaterialPrompt("当前素材文件夹：只是讨论这个目录"), false);
  assert.equal(isAutomationMaterialPrompt("日常聊天，请看看附件"), false);
});

test("restart recovery prefers the more complete checkpoint image set over a partially hydrated page", () => {
  assert.deepEqual(preferredRecoveryImageUrls(["page-1"], ["saved-1", "saved-2", "saved-3"]), ["saved-1", "saved-2", "saved-3"]);
  assert.deepEqual(preferredRecoveryImageUrls(["page-1", "page-2"], ["saved-1"]), ["page-1", "page-2"]);
});

test("complete dual-platform copy is detected as one durable boundary", () => {
  const copy = [
    "<<<COPY_FORMAT:2>>>",
    "<<<XHS_START>>>",
    "苏州西山岛团建攻略。".repeat(20),
    "<<<XHS_END>>>",
    "<<<DOUYIN_START>>>",
    "苏州西山岛玩法分享。".repeat(20),
    "<<<DOUYIN_END>>>"
  ].join("\n");
  const found = findCompletedCopyBoundary(["不完整回复", copy]);
  assert.equal(found.found, true);
  assert.equal(found.index, 1);
  assert.match(found.xhsText, /苏州西山岛/);
  assert.match(found.douyinText, /玩法分享/);
  assert.equal(findCompletedCopyBoundary([copy.replace("<<<DOUYIN_END>>>", "")]).found, false);
});

test("duplicate package without packagePath still has durable archive evidence", () => {
  assert.equal(hasDurablePatrolPackageEvidence({
    archivePath: "D:\\素材库\\1\\作品 A",
    packagePath: "",
    downloadedImages: 8,
    expectedImageCount: 8,
    copyText: "x".repeat(300)
  }), true);
  assert.equal(hasDurablePatrolPackageEvidence({
    archivePath: "D:\\素材库\\1\\作品 A",
    packagePath: "",
    downloadedImages: 7,
    expectedImageCount: 8,
    copyText: "x".repeat(300)
  }), false);
  assert.equal(hasDurablePatrolPackageEvidence({
    archivePath: "",
    packagePath: "",
    downloadedImages: 8,
    expectedImageCount: 8,
    copyText: "x".repeat(300)
  }), false);
});

test("a completed copy boundary overrides a stale waiting-images label without regenerating", () => {
  assert.deepEqual(resolvePatrolCopyBoundary({
    stage: "waiting-images",
    hasCopy: true,
    copyText: "x".repeat(300),
    imageCount: 6,
    expectedImageCount: 6,
    generating: false
  }), {
    protected: true,
    complete: true,
    stage: "completed-copy-pending-package",
    reason: "copy-boundary-ready",
    imageCount: 6,
    expectedImageCount: 6
  });
  assert.deepEqual(resolvePatrolCopyBoundary({
    stage: "waiting-images",
    hasCopy: true,
    copyText: "x".repeat(300),
    imageCount: 6,
    expectedImageCount: 10,
    generating: false
  }), {
    protected: true,
    complete: false,
    stage: "waiting-copy",
    reason: "copy-boundary-image-count-uncertain",
    imageCount: 6,
    expectedImageCount: 10
  });
  assert.equal(resolvePatrolCopyBoundary({
    stage: "waiting-images",
    hasCopy: false,
    imageCount: 6,
    expectedImageCount: 10,
    generating: false
  }).protected, false);
});

test("copy evidence must belong to the current material before packaging", () => {
  assert.equal(patrolMaterialCopyIdentity({
    materialName: "评11赞1莫干山两天一夜团建攻略🔥后悔没早点刷到",
    copyText: "莫干山两天一夜团建，适合安排轻徒步和露营。#莫干山团建"
  }).matched, true);
  const mismatch = patrolMaterialCopyIdentity({
    materialName: "评11赞1莫干山两天一夜团建攻略🔥后悔没早点刷到",
    copyText: "苏州西山岛一日团建，骑行采摘露营烧烤全安排。#西山岛"
  });
  assert.equal(mismatch.required, true);
  assert.equal(mismatch.matched, false);
  assert.equal(mismatch.reason, "material-copy-identity-mismatch");
});

test("copy phase is a hard no-regeneration boundary even when only one thumbnail is visible", () => {
  assert.deepEqual(shouldProtectCopyBoundaryFromImageRecovery({
    stage: "completed-copy-pending-package",
    hasCopy: true,
    imageCount: 1,
    expectedImageCount: 10
  }), {
    protected: true,
    reason: "copy-request-or-result-already-observed",
    stage: "completed-copy-pending-package"
  });
  assert.deepEqual(shouldProtectCopyBoundaryFromImageRecovery({
    stage: "waiting-copy",
    textSubmitted: true,
    imageCount: 1,
    expectedImageCount: 8
  }), {
    protected: true,
    reason: "copy-request-or-result-already-observed",
    stage: "waiting-copy"
  });
  assert.equal(shouldProtectCopyBoundaryFromImageRecovery({
    stage: "images-ready",
    hasCopy: false,
    imageCount: 1,
    expectedImageCount: 8
  }).protected, false);
});

test("copy identity ignores title decoration while retaining the material anchor", () => {
  const recovered = patrolMaterialCopyIdentity({
    materialName: "当前会话恢复 · 评14赞1藏不住啦！莫干山独栋轰趴小预算玩上一整天",
    copyText: "莫干山独栋轰趴｜小预算也能玩上一整天的团建玩法\n适合周末在山里住一晚。"
  });
  assert.equal(recovered.required, true);
  assert.equal(recovered.matched, true);
  assert.equal(recovered.reason, "material-copy-identity-matched");
  assert.ok(recovered.matchedTokens.includes("莫干山独栋轰趴"));
});

test("copy identity accepts rewritten same-material titles using two source fragments", () => {
  const recovered = patrolMaterialCopyIdentity({
    materialName: "评1赞6宁波周末温柔一日游✨慢节奏路线太舒服了猫猫子20260502",
    copyText: "宁波周末一日游✨东钱湖Citywalk慢节奏路线\n沿湖散步、鄞州公园和南商水街，最后安排宁波特色美食。"
  });
  assert.equal(recovered.required, true);
  assert.equal(recovered.matched, true);
  assert.equal(recovered.reason, "material-copy-identity-matched");
  assert.ok(recovered.matchedFragments.length >= 2);
});

test("patrol stage classifier maps the production evidence chain without taking action", () => {
  assert.equal(classifyPatrolStage({}).key, "awaiting-material");
  assert.equal(classifyPatrolStage({ stage: "waiting-plan", hasMaterialBoundary: true }).safeToAct, false);
  assert.deepEqual(
    classifyPatrolStage({ stage: "plan-ready", hasMaterialBoundary: true }),
    { key: "awaiting-confirm", label: "计划完成，待回复 1", nextActionKey: "send-confirm", safeToAct: true, detail: "" }
  );
  assert.equal(classifyPatrolStage({ stage: "images-ready", imageCount: 8 }).nextActionKey, "request-copy");
  assert.equal(classifyPatrolStage({ stage: "completed-copy-pending-package", imageCount: 8 }).nextActionKey, "download-and-package");
});

test("a settled partial image batch is identified for whole-batch regeneration", () => {
  const partial = classifyPatrolStage({
    stage: "waiting-images",
    hasMaterialBoundary: true,
    imageCount: 3,
    expectedImageCount: 10,
    generating: false
  });

  assert.equal(partial.key, "partial-images");
  assert.equal(partial.nextActionKey, "regenerate-batch");
  assert.equal(partial.safeToAct, true);
  const settledPartial = classifyPatrolStage({
    stage: "images-ready",
    imageCount: 8,
    expectedImageCount: 10,
    generating: false
  });
  assert.equal(settledPartial.key, "partial-images");
  assert.equal(settledPartial.nextActionKey, "regenerate-batch");
  assert.equal(settledPartial.safeToAct, true);
  assert.equal(classifyPatrolStage({ stage: "images-ready", imageCount: 8, expectedImageCount: 10, generating: true }).key, "generating-images");
  assert.match(partial.detail, /整批重做/);
  assert.equal(classifyPatrolStage({ stage: "waiting-images", imageCount: 3, expectedImageCount: 10, generating: true }).key, "generating-images");
});

test("copy evidence wins over a stale partial-image label and never regenerates", () => {
  const state = classifyPatrolStage({
    stage: "waiting-images",
    imageCount: 1,
    expectedImageCount: 10,
    hasCopy: true,
    generating: false
  });
  assert.equal(state.key, "awaiting-package");
  assert.equal(state.nextActionKey, "download-and-package");
  assert.equal(state.safeToAct, true);
  assert.match(state.detail, /禁止再次补图/);
});

test("uncertain and limit states remain read-only", () => {
  assert.equal(classifyPatrolStage({ stage: "unknown", hasMaterialBoundary: true }).safeToAct, false);
  assert.equal(classifyPatrolStage({ stage: "generation-limit-or-script" }).nextActionKey, "pause");
});

test("patrol single-step requires an automatically eligible non-excluded title", () => {
  const state = classifyPatrolStage({ stage: "plan-ready", hasMaterialBoundary: true });
  assert.equal(decidePatrolSingleStep({ candidate: { titleMatched: false, eligible: false }, patrolState: state }).allowed, false);
  assert.equal(decidePatrolSingleStep({ candidate: { titleMatched: true, excluded: true, eligible: false }, patrolState: state }).allowed, false);
  assert.deepEqual(
    decidePatrolSingleStep({
      candidate: { titleMatched: true, excluded: false, eligible: true },
      patrolState: state,
      composerReady: true,
      composerEmpty: true
    }),
    { allowed: true, action: "send-confirm", reason: "ready" }
  );
});

test("patrol single-step never acts while generating, drafting, uncertain, or over the generation cap", () => {
  const candidate = { titleMatched: true, excluded: false, eligible: true };
  const confirm = classifyPatrolStage({ stage: "plan-ready", hasMaterialBoundary: true });
  assert.equal(decidePatrolSingleStep({ candidate, patrolState: confirm, generating: true, composerReady: true, composerEmpty: true }).allowed, false);
  assert.equal(decidePatrolSingleStep({ candidate, patrolState: confirm, composerReady: true, composerEmpty: false }).allowed, false);
  assert.equal(decidePatrolSingleStep({ candidate, patrolState: confirm, composerReady: true, composerEmpty: true, generationRequestCount: 5, maximumGenerationRequests: 5 }).reason, "generation-cap-reached");
  assert.equal(decidePatrolSingleStep({ candidate, patrolState: classifyPatrolStage({ stage: "unknown", hasMaterialBoundary: true }), composerReady: true, composerEmpty: true }).allowed, false);
});

test("verified automatic package recovery may clear a stale composer", () => {
  const candidate = { titleMatched: false, excluded: false, eligible: false };
  const packageState = classifyPatrolStage({ stage: "completed-copy-pending-package", imageCount: 8 });
  assert.deepEqual(
    decidePatrolSingleStep({
      candidate,
      patrolState: packageState,
      composerReady: true,
      composerEmpty: false,
      hasKnownMaterialOwner: true,
      allowUntitledRecovery: true,
      allowStaleComposerRecovery: true
    }),
    { allowed: true, action: "download-and-package", reason: "ready" }
  );
  assert.equal(
    decidePatrolSingleStep({
      candidate,
      patrolState: packageState,
      composerReady: true,
      composerEmpty: false,
      hasKnownMaterialOwner: true,
      allowUntitledRecovery: true
    }).reason,
    "composer-not-empty"
  );
});

test("patrol single-step permits deterministic text actions and verified packaging", () => {
  const candidate = { titleMatched: true, excluded: false, eligible: true };
  const copy = classifyPatrolStage({ stage: "images-ready", imageCount: 8 });
  const packageState = classifyPatrolStage({ stage: "completed-copy-pending-package", imageCount: 8 });
  assert.equal(decidePatrolSingleStep({ candidate, patrolState: copy, composerReady: true, composerEmpty: true }).action, "request-copy");
  const regenerate = { key: "partial-images", safeToAct: true, nextActionKey: "regenerate-batch" };
  assert.equal(decidePatrolSingleStep({
    candidate,
    patrolState: regenerate,
    composerReady: true,
    composerEmpty: true,
    generationRequestCount: 1,
    maximumGenerationRequests: 5
  }).action, "regenerate-batch");
  assert.equal(decidePatrolSingleStep({ candidate, patrolState: packageState, composerReady: true, composerEmpty: true }).action, "download-and-package");
});

test("known production recovery can package an untitled conversation without opening a new task", () => {
  const packageState = classifyPatrolStage({ stage: "completed-copy-pending-package", imageCount: 8 });
  assert.equal(decidePatrolSingleStep({
    candidate: { titleMatched: false, excluded: false, eligible: false },
    patrolState: packageState,
    composerReady: true,
    composerEmpty: true,
    allowUntitledRecovery: true
  }).action, "download-and-package");
});

test("a queue-bound material owner can recover a renamed conversation at the package boundary", () => {
  const packageState = classifyPatrolStage({ stage: "completed-copy-pending-package", imageCount: 10 });
  assert.equal(decidePatrolSingleStep({
    candidate: { titleMatched: false, excluded: false, eligible: false },
    patrolState: packageState,
    composerReady: true,
    composerEmpty: true,
    hasKnownMaterialOwner: true
  }).action, "download-and-package");
});

test("patrol retries a short copy twice with an explicit rewrite and then stops", () => {
  assert.deepEqual(decidePatrolCopyRecovery({ attempts: 0, maxAttempts: 2 }), { action: "retry", nextAttempt: 1 });
  assert.deepEqual(decidePatrolCopyRecovery({ attempts: 1, maxAttempts: 2 }), { action: "retry", nextAttempt: 2 });
  assert.deepEqual(decidePatrolCopyRecovery({ attempts: 2, maxAttempts: 2 }), { action: "pause", nextAttempt: 2 });
});
