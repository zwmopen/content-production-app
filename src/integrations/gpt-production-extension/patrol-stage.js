(function initTeambuildingPatrolStage(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TeambuildingGptPatrolStage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function result(key, label, nextActionKey, safeToAct, detail = "") {
    return { key, label, nextActionKey, safeToAct, detail };
  }

  function isAutomationMaterialPrompt(text = "") {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    const hasMaterialLabel = /当前素材文件夹\s*[：:]\s*\S+/.test(value);
    const hasWorkflowEnvelope = /本次附件全部是待迁移素材|请(?:完整)?读取全部附件/.test(value);
    // A restored/direct upload can display only attachment labels plus the
    // material folder. Require that file evidence so ordinary discussion of
    // a folder is not mistaken for a production boundary.
    const hasAttachmentLabel = /(?:\.(?:txt|jpe?g|png|webp|gif|avif)\b|\b文档\b|\b图片\b)/i.test(value);
    return hasMaterialLabel && (hasWorkflowEnvelope || hasAttachmentLabel);
  }

  // A complete dual-platform copy is a durable workflow boundary.  Keep this
  // detector independent from the DOM so the sidebar can distinguish an old
  // finished post from a new plan prompt after a renderer reload.
  function findCompletedCopyBoundary(texts = [], minimumLength = 300) {
    const values = Array.isArray(texts)
      ? texts.map((value) => String(value || "").trim())
      : [];
    const minimum = Math.max(1, Number(minimumLength || 300));
    const header = "<<<COPY_FORMAT:2>>>";
    const xhsStartMarker = "<<<XHS_START>>>";
    const xhsEndMarker = "<<<XHS_END>>>";
    const douyinStartMarker = "<<<DOUYIN_START>>>";
    const douyinEndMarker = "<<<DOUYIN_END>>>";
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const text = values[index];
      if (text.length < minimum) continue;
      const headerIndex = text.indexOf(header);
      const xhsStartIndex = text.indexOf(xhsStartMarker, headerIndex + header.length);
      const xhsEndIndex = text.indexOf(xhsEndMarker, xhsStartIndex + xhsStartMarker.length);
      const douyinStartIndex = text.indexOf(douyinStartMarker, xhsEndIndex + xhsEndMarker.length);
      let douyinEndIndex = douyinStartIndex >= 0 ? text.indexOf(douyinEndMarker, douyinStartIndex + douyinStartMarker.length) : -1;
      if (douyinStartIndex >= 0 && douyinEndIndex < 0) {
        douyinEndIndex = text.length; // 语义容错放行：末尾标签若缺失直接容错放行
      }
      if (headerIndex < 0 || xhsStartIndex < 0 || xhsEndIndex <= xhsStartIndex
        || douyinStartIndex < 0 || douyinEndIndex <= douyinStartIndex) continue;
      const xhsText = text.slice(xhsStartIndex + xhsStartMarker.length, xhsEndIndex).trim();
      const douyinText = text.slice(douyinStartIndex + douyinStartMarker.length, douyinEndIndex).trim();
      if (xhsText.length < 20 || douyinText.length < 20) continue;
      return { found: true, index, text, xhsText, douyinText };
    }
    return { found: false, index: -1, text: "", xhsText: "", douyinText: "" };
  }

  function preferredRecoveryImageUrls(pageUrls = [], checkpointUrls = []) {
    const unique = (values) => [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
    const page = unique(pageUrls);
    const checkpoint = unique(checkpointUrls);
    return checkpoint.length > page.length ? checkpoint : page;
  }

  // A duplicate package can legitimately have no packagePath: the packager
  // has already created the exact work package and the archive endpoint may
  // only return the moved source-material path.  Treat the archive path,
  // downloaded image count, and saved copy as the durable completion proof.
  // Without this boundary, a lazy page thumbnail can make a completed 8/8
  // work look like 7/8 and trigger a second generation request.
  function hasDurablePatrolPackageEvidence(options = {}) {
    const archivePath = String(options.archivePath || "").trim();
    const packagePath = String(options.packagePath || "").trim();
    const copyText = String(options.copyText || "").replace(/\s/g, "");
    const downloadedImages = Math.max(
      0,
      Number(options.downloadedImages || options.downloadedImageCount || 0),
      Number(options.packageImageCount || 0)
    );
    const expectedImages = Math.max(
      0,
      Number(options.expectedImageCount || options.plannedImageCount || 0)
    );
    const hasArchiveBoundary = Boolean(archivePath || packagePath);
    return hasArchiveBoundary
      && downloadedImages > 0
      && (!expectedImages || downloadedImages >= expectedImages)
      && copyText.length >= Math.max(1, Number(options.minimumCopyLength || 300));
  }

  // A completed copy reply is a stronger workflow boundary than a stale
  // "waiting-images" label left by a renderer reload.  Never turn that
  // boundary into another image-generation request.  When the visible image
  // count is still below the expected count, keep the work read-only until a
  // later probe can reconcile the image evidence; when the counts match,
  // continue through the normal download/package step.
  function resolvePatrolCopyBoundary(options = {}) {
    const stage = String(options.stage || options.boundaryStage || "").trim();
    const copyText = String(options.copyText || "").replace(/\s/g, "");
    const hasCopy = options.hasCopy === true || copyText.length >= Math.max(1, Number(options.minimumCopyLength || 300));
    const imageCount = Math.max(
      0,
      Number(options.imageCount || 0),
      Number(options.imageEvidenceCount || 0),
      Array.isArray(options.imageUrls) ? options.imageUrls.length : 0
    );
    const expectedImageCount = Math.max(0, Number(options.expectedImageCount || options.plannedImageCount || 0));
    if (!hasCopy || options.generating === true || imageCount <= 0) {
      return { protected: false, complete: false, stage, reason: "copy-boundary-not-proven" };
    }
    if (!["images-ready", "waiting-images", "waiting-copy", "completed-copy-pending-package"].includes(stage)) {
      return { protected: false, complete: false, stage, reason: "copy-boundary-stage-not-eligible" };
    }
    if (expectedImageCount > 0 && imageCount < expectedImageCount) {
      return {
        protected: true,
        complete: false,
        stage: "waiting-copy",
        reason: "copy-boundary-image-count-uncertain",
        imageCount,
        expectedImageCount
      };
    }
    return {
      protected: true,
      complete: true,
      stage: "completed-copy-pending-package",
      reason: "copy-boundary-ready",
      imageCount,
      expectedImageCount
    };
  }

  // Once the workflow has entered the copy phase, an incomplete visible image
  // count is a hydration/evidence problem, not permission to generate again.
  // This is deliberately independent of imageCount: after a reload ChatGPT
  // may expose one lazy thumbnail while the copy reply is already complete.
  function shouldProtectCopyBoundaryFromImageRecovery(options = {}) {
    const stage = String(options.stage || options.boundaryStage || "").trim();
    const copyText = String(options.copyText || "").replace(/\s/g, "");
    const hasCopy = options.hasCopy === true
      || options.textSubmitted === true
      || copyText.length >= Math.max(1, Number(options.minimumCopyLength || 300));
    const copyStage = ["waiting-copy", "completed-copy-pending-package", "completed", "archived"]
      .includes(stage);
    if (!hasCopy && !copyStage) {
      return { protected: false, reason: "copy-boundary-not-entered", stage };
    }
    return {
      protected: true,
      reason: hasCopy ? "copy-request-or-result-already-observed" : "copy-stage-already-entered",
      stage
    };
  }

  function patrolMaterialCopyIdentity(options = {}) {
    const materialSource = String(
      options.materialName
      || options.sourceMaterialPath
      || options.materialText
      || ""
    ).trim();
    const copyText = String(options.copyText || "").trim();
    const folderName = materialSource.split(/[\\/]+/).filter(Boolean).at(-1) || materialSource;
    const stopTokens = new Set([
      "当前会话", "母版", "恢复", "团建", "攻略", "周边游", "一日游",
      "两天一夜", "一天", "人均", "新开业", "后悔没早点刷到", "说点大实话",
      // These are title/emotion decorations, not material identity. Keeping
      // them in a required token made a valid copy such as
      // “莫干山独栋轰趴｜小预算也能玩上一整天” fail to match the source
      // folder “藏不住啦！莫干山独栋轰趴小预算玩上一整天”.
      "藏不住啦", "小预算", "玩上一整天", "一整天", "天花板", "宝藏",
      "救命", "真的", "别再", "全包", "全安排", "来啦", "不踩雷"
    ]);
    const cleaned = folderName
      .replace(/^当前会话(?:母版|恢复)\s*[×x·:：-]\s*/i, "")
      .replace(/^评\d+\s*赞\d+\s*/u, "")
      .replace(/[0-9０-９]+/gu, " ")
      .replace(/[^\p{Script=Han}A-Za-z]+/gu, " ");
    const tokenFreeText = [...stopTokens].reduce(
      (text, token) => text.split(token).join(" "),
      cleaned
    );
    const tokens = [...tokenFreeText.matchAll(/[\p{Script=Han}]{2,}/gu)]
      .map((match) => match[0])
      .filter((token) => token.length >= 2 && !stopTokens.has(token))
      .sort((left, right) => right.length - left.length);
    if (!materialSource || !copyText || !tokens.length) {
      return { required: false, matched: false, reason: "material-copy-identity-not-conclusive", tokens: [] };
    }
    const matchedTokens = tokens.filter((token) => copyText.includes(token));
    // A publish-ready copy often rewrites title decoration and inserts a
    // route word between the source title tokens, e.g. source
    // “宁波周末温柔…慢节奏路线” becomes “宁波周末一日游…慢节奏路线”.
    // Requiring one unchanged long token falsely rejects that same-material
    // copy after a reload. Keep exact matches strongest, then accept partial
    // evidence only when two separate source tokens each contribute a
    // distinctive contiguous fragment; a single common word never releases
    // the archive boundary.
    const partialMatches = tokens.map((token) => {
      const fragments = [];
      for (let length = Math.min(8, token.length); length >= 2; length -= 1) {
        for (let start = 0; start + length <= token.length; start += 1) {
          const fragment = token.slice(start, start + length);
          if (copyText.includes(fragment)) fragments.push(fragment);
        }
      }
      return [...new Set(fragments)].sort((left, right) => right.length - left.length)[0] || "";
    }).filter(Boolean);
    const partialIdentityMatched = new Set(partialMatches).size >= 2;
    const matched = matchedTokens.length > 0 || partialIdentityMatched;
    return {
      required: true,
      matched,
      reason: matched ? "material-copy-identity-matched" : "material-copy-identity-mismatch",
      tokens: tokens.slice(0, 12),
      matchedTokens,
      matchedFragments: partialMatches.slice(0, 12)
    };
  }

  function classifyPatrolStage(options = {}) {
    const stage = String(options.stage || "").trim();
    const imageCount = Math.max(0, Number(options.imageCount || 0));
    const expectedImageCount = Math.max(0, Number(options.expectedImageCount || 0));
    const generating = Boolean(options.generating);

    if (!stage || stage === "unknown") {
      return options.hasMaterialBoundary
        ? result("uncertain", "阶段证据不足", "inspect", false, "保留只读，禁止猜测下一步")
        : result("awaiting-material", "待上传素材", "upload-material", true);
    }
    if (stage === "waiting-plan") return result("waiting-plan", "已发素材，等待逐页计划", "wait", false);
    if (stage === "plan-ready") return result("awaiting-confirm", "计划完成，待回复 1", "send-confirm", true);
    if (stage === "generation-limit-or-script") {
      return result("limit-or-script", "疑似触顶或脚本兜底", "pause", false, "等待额度恢复或人工复核")
    }
    // A valid copy reply closes the image-generation boundary.  A stale
    // waiting-images label or a lazy thumbnail count must never turn this
    // state back into a regeneration request.
    if (options.hasCopy === true && !generating) {
      return result("awaiting-package", "图片和文案完成，待下载归档", "download-and-package", true, "文案边界已完成，禁止再次补图");
    }
    if (stage === "waiting-images") {
      if (generating) return result("generating-images", "正在生成图片", "wait", false);
      if (imageCount > 0 && expectedImageCount > imageCount) {
        return result("partial-images", `图片不足（${imageCount}/${expectedImageCount}）`, "regenerate-batch", true, "只能整批重做，不能补单张混批");
      }
      return result("waiting-images", "已回复 1，等待图片", "wait", false);
    }
    if (stage === "images-ready") {
      if (generating) return result("generating-images", "正在重新生成完整图片批次", "wait", false);
      if (imageCount > 0 && expectedImageCount > imageCount) {
        return result("partial-images", `图片不足（${imageCount}/${expectedImageCount}）`, "regenerate-batch", true, "只能整批重做，不能把补图混进旧批次");
      }
      return result("awaiting-copy", `图片完成（${imageCount} 张），待文案`, "request-copy", true);
    }
    if (stage === "waiting-copy") return result("waiting-copy", "已请求文案，等待成稿", "wait", false);
    if (stage === "completed-copy-pending-package") {
      return result("awaiting-package", "图片和文案完成，待下载归档", "download-and-package", true);
    }
    if (stage === "completed" || stage === "archived") return result("completed", "作品已闭环", "none", false);
    return result("uncertain", "阶段证据不足", "inspect", false, "保留只读，禁止猜测下一步");
  }

  function decidePatrolSingleStep(options = {}) {
    const candidate = options.candidate || {};
    const patrolState = options.patrolState || {};
    // A queue-bound task is already an exact material owner.  When its
    // conversation has reached the package boundary, the conversation title
    // is not a safe identity check: users can rename the chat or the title
    // can come from the template conversation.  Keep the escape hatch narrow
    // to this exact package stage and a known owner (or the explicit recovery
    // flag from the workbench).
    const untitledPackageRecovery = (options.allowUntitledRecovery === true
      || options.hasKnownMaterialOwner === true)
      && patrolState.nextActionKey === "download-and-package";
    if (candidate.excluded || ((!candidate.titleMatched || !candidate.eligible) && !untitledPackageRecovery)) {
      return { allowed: false, action: "none", reason: candidate.excluded ? "conversation-excluded" : "production-title-required" };
    }
    if (options.generating) return { allowed: false, action: "none", reason: "generation-in-progress" };
    if (!options.composerReady) return { allowed: false, action: "none", reason: "composer-not-ready" };
    // A known queue-owned package boundary is already complete.  A draft left
    // behind by a renderer restart must not prevent downloading/archiving that
    // verified work; the caller clears that stale draft immediately before
    // executing the package action.  Other patrol actions still require an
    // empty composer so an uncertain user draft is never overwritten.
    const packageBoundaryCanClearComposer = patrolState.nextActionKey === "download-and-package"
      && options.allowStaleComposerRecovery === true;
    if (!options.composerEmpty && !packageBoundaryCanClearComposer) {
      return { allowed: false, action: "none", reason: "composer-not-empty" };
    }
    if (!patrolState.safeToAct) return { allowed: false, action: "none", reason: "stage-read-only" };

    const action = String(patrolState.nextActionKey || "none");
    if (action === "send-confirm" || action === "regenerate-batch") {
      const used = Math.max(0, Number(options.generationRequestCount || 0));
      const maximum = Math.max(1, Number(options.maximumGenerationRequests || 5));
      if (used >= maximum) return { allowed: false, action: "none", reason: "generation-cap-reached" };
    }
    if (!["send-confirm", "regenerate-batch", "request-copy", "download-and-package"].includes(action)) {
      return { allowed: false, action: "none", reason: "unsupported-action" };
    }
    return { allowed: true, action, reason: "ready" };
  }

  function decidePatrolCopyRecovery(options = {}) {
    const attempts = Math.max(0, Number(options.attempts || 0));
    const maxAttempts = Math.max(0, Number(options.maxAttempts ?? 2));
    if (attempts >= maxAttempts) return { action: "pause", nextAttempt: attempts };
    return { action: "retry", nextAttempt: attempts + 1 };
  }

  return {
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
  };
});
