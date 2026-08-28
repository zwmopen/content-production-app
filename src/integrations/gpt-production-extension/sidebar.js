(() => {
  const embeddedVersion = chrome.runtime.getManifest().version;
  const markEmbeddedExtensionReady = () => {
    document.documentElement.dataset.tbGptProductionExtension = "ready";
    document.documentElement.dataset.tbGptProductionExtensionVersion = embeddedVersion;
    document.documentElement.dataset.tbGptProductionExtensionSource = "embedded-extension";
    let marker = document.getElementById("tb-gpt-production-extension-marker");
    if (!marker) {
      marker = document.createElement("meta");
      marker.id = "tb-gpt-production-extension-marker";
      document.head?.append(marker);
    }
    if (marker) marker.content = embeddedVersion;
  };
  globalThis.__TB_GPT_PRODUCTION_SIDEBAR_READY__ = embeddedVersion;
  markEmbeddedExtensionReady();
  window.setInterval(markEmbeddedExtensionReady, 2000);
  const DEFAULT_API_ROOT = "http://127.0.0.1:4327";
  const ROOT_ID = "tb-gpt-production-studio";
  const LAUNCHER_ID = "tb-gpt-production-launcher";
  const DROP_OVERLAY_ID = "tb-gpt-production-drop-overlay";
  const EMBEDDED_STORAGE_KEY = "tb-workbench-embedded";
  const API_ROOT_STORAGE_KEY = "tb-workbench-api-root";
  const PATH_STORAGE_KEY = "tb-production-paths";
  const ACTION_STORAGE_KEY = "tb-material-action-settings";
  const ARCHIVED_BOUNDARY_KEY = "tb-gpt-last-archived-boundary-v1";
  const PATROL_ACTION_LEDGER_KEY = "tb-gpt-patrol-action-ledger-v1";
  const liveImageEvidenceCache = new Map();
  const COPY_SOURCE_NARRATION_GUARD = "不得提及 TXT、图片、附件、素材、参考文案、出图计划、提示词、AI、模型或读取过程；不得使用“根据资料”“从图中可以看到”等来源旁白。所有事实直接写成自然、可发布的成品内容。";
  const COPY_FORMAT_HEADER = "<<<COPY_FORMAT:2>>>";
  const COPY_FORMAT_PROTOCOL = `本轮一次生成两个平台版本，但只输出一个 TXT 机器协议。小红书版与抖音版必须基于同一套最终图片、TXT事实和项目事实；最终成稿必须严格按以下标记输出，标记原样保留，不得加代码围栏、平台说明或其他前后文字：
${COPY_FORMAT_HEADER}

<<<XHS_START>>>
完整小红书成稿
<<<XHS_END>>>

<<<DOUYIN_START>>>
完整抖音成稿
<<<DOUYIN_END>>>

小红书版继续完整执行当前窗口已经生效的最新版小红书团建、周边游、本地生活规则：最终成品图优先于原始TXT；只写已确认事实；标题、正文和最后一行话题自然覆盖地域、目的地、团建、玩法、路线和搜索决策价值；固定输出10个与内容高度相关的话题标签；不得输出标题/正文/标签栏目名，不得暴露素材来源或制作过程。
抖音版必须根据同一事实重新写，定位为目的地攻略、玩法分享、体验参考和避坑内容，不是团建服务销售页。讲清楚项目差异、怎么玩、适合什么体力、天气季节、装备、开放情况和取舍建议；自然保留必要地域/团建关键词，但控制企业客户、HR、行政、完整行程、住宿、用车、餐饮和项目组合的密度。默认禁止价格、报价、费用、10人起接、人数起接、任何“数字＋人起接”表达、承接、接单、定制、咨询、联系我们、留言城市+人数、方案获客、报名、预约、下单及其他交易/获客/服务承接表达；不得用谐音、符号或错别字规避审核；固定输出5个相关话题标签。
两版不得互相矛盾。生成前先完整读取最终图片、原始图片、TXT、项目名称和已有事实，建立统一事实层；先写小红书，再基于同一事实重写抖音；分别自检后再输出协议。若抖音仍像商业旅游/团建服务营销，自动重写后再输出。`;
  const DEFAULT_PUBLISH_COPY_PROMPT = `请只输出一份可直接复制发布的双平台完整文案。${COPY_FORMAT_PROTOCOL}${COPY_SOURCE_NARRATION_GUARD}`;
  const COPY_META_NARRATION_REWRITE_PROMPT = `刚才的双平台文案出现了素材来源或制作过程旁白。请完整重写小红书和抖音两个区段，严格按 ${COPY_FORMAT_HEADER}、<<<XHS_START>>>、<<<XHS_END>>>、<<<DOUYIN_START>>>、<<<DOUYIN_END>>> 输出；${COPY_SOURCE_NARRATION_GUARD}只输出最终协议成品，不要解释修改过程。`;
  const DEFAULT_MATERIAL_PLAN_PROMPT = "请完整读取全部附件，不要省略 TXT。本套迁移计划和最终成品都最多 10 张；素材超过 10 张时，必须先全部读取，再自行筛选、聚类、合并和取舍，只规划 P1-P10 以内。禁止第 11 页，禁止分批，禁止第二批，禁止把剩余素材留到下一批。先严格按既定格式输出最多 10 页的逐页迁移计划，并在结尾等待我回复 1，暂时不要出图。";
  const normalizePublishCopyPrompt = (value) => {
    const prompt = String(value || "").trim();
    const normalized = !prompt || prompt === "给我一份小红书文案" ? DEFAULT_PUBLISH_COPY_PROMPT : prompt;
    const withProtocol = normalized.includes(COPY_FORMAT_HEADER)
      ? normalized
      : `${normalized}\n\n硬性双平台成品协议：${COPY_FORMAT_PROTOCOL}`;
    return withProtocol.includes("不得提及 TXT、图片、附件、素材、参考文案、出图计划、提示词、AI、模型或读取过程")
      ? withProtocol
      : `${withProtocol}\n\n硬性成品规则：${COPY_SOURCE_NARRATION_GUARD}`;
  };
  const automationCore = globalThis.TeambuildingGptAutomationCore || {};
  const parsePlatformCopy = automationCore.parsePlatformCopy || (() => ({ formatVersion: 1, legacy: true, valid: true, xhs: "", douyin: "", issues: [] }));
  const validatePlatformCopy = automationCore.validatePlatformCopy || (() => ({ valid: false, parsed: parsePlatformCopy(""), issues: ["COPY_PARSER_UNAVAILABLE"] }));
  const parsePlannedImageCount = automationCore.parsePlannedImageCount || (() => 0);
  const workflowStepExecutionTimeoutMs = automationCore.workflowStepExecutionTimeoutMs
    || ((action, timeoutMs) => ["wait-plan", "wait-images", "wait-copy"].includes(String(action || ""))
      ? Math.max(1, Number(timeoutMs || 0)) + 15_000
      : Math.max(1, Number(timeoutMs || 0)));
  const shouldTrustCompletedPlanCheckpoint = automationCore.shouldTrustCompletedPlanCheckpoint
    || ((values = {}) => values.planDone === true && values.materialMatched === true);
  const isConfirmUserTurnText = automationCore.isConfirmUserTurnText || ((value = "", options = {}) => {
    const text = String(value || "").replace(/\r/g, "").trim();
    if (/^1\s*$/.test(text)) return true;
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    return Number(options.attachmentCount || 0) > 0 && lines.length > 1 && lines.at(-1) === "1";
  });
  const requiresPlannedImageCount = automationCore.requiresPlannedImageCount || ((taskType) => taskType !== "template-init");
  const isArchivedAutomationBoundary = automationCore.isArchivedAutomationBoundary || ((options = {}) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    return Boolean(options.marker
      && normalize(options.currentUrl) === normalize(options.marker.conversationUrl)
      && normalize(options.materialText)
      && normalize(options.materialText) === normalize(options.marker.materialText));
  });
  const completedHistoryMatchesAutomationBoundary = automationCore.completedHistoryMatchesAutomationBoundary || (() => false);
  const patrolActionLedgerKey = automationCore.patrolActionLedgerKey || ((options = {}) => {
    const conversationUrl = String(options.conversationUrl || "").split(/[?#]/)[0].trim();
    const materialText = String(options.materialText || "").replace(/\s+/g, " ").trim();
    if (!materialText) return conversationUrl;
    let hash = 0x811c9dc5;
    for (let index = 0; index < materialText.length; index += 1) {
      hash ^= materialText.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${conversationUrl}::material:${materialText.length}:${hash.toString(16).padStart(8, "0")}`;
  });
  const firstBatchChoice = automationCore.firstBatchChoice || ((options = {}) => {
    const maximum = Math.max(1, Number(options.maximum || 10));
    const expectedImageCount = Math.min(Math.max(1, Number(options.plannedImageCount || maximum)), maximum);
    return { reply: `先出 P1-P${expectedImageCount}`, expectedImageCount };
  });
  const clampExpectedImageCount = automationCore.clampExpectedImageCount
    || ((value, maximum = 10) => Math.max(0, Math.min(Math.max(1, Number(maximum || 10)), Number(value || 0))));
  const completedPlannedImageCount = automationCore.completedPlannedImageCount
    || ((values = {}) => clampExpectedImageCount(Math.max(
      Number(values.plannedImageCount || 0),
      Number(values.downloadedImageCount || 0)
    )));
  const resolveRecoveredPlannedImageCount = automationCore.resolveRecoveredPlannedImageCount
    || ((values = {}) => clampExpectedImageCount(Math.max(
      parsePlannedImageCount(values.planText || ""),
      Number(values.checkpointCount || 0),
      Number(values.taskExpectedCount || 0),
      Number(values.recoveredImageCount || 0)
    )));
  const lastAssistantIndexAfterPrompt = automationCore.lastAssistantIndexAfterPrompt || ((roles = [], promptIndex = -1) => {
    let assistantIndex = -1;
    for (let index = Math.max(-1, Number(promptIndex || 0)) + 1; index < roles.length; index += 1) {
      if (roles[index] === "user") break;
      if (roles[index] === "assistant") assistantIndex = index;
    }
    return assistantIndex;
  });
  const isPostImageRecoveryStage = automationCore.isPostImageRecoveryStage
    || ((stage = "") => /下载图片|生成小红书文案|恢复小红书文案|纠正文案|保存小红书文案|请求小红书文案|文案已生成|打包作品|clipboard|剪贴板/i.test(String(stage || "")));
  const shouldBypassImageRecovery = automationCore.shouldBypassImageRecovery
    || ((options = {}) => {
      const liveConversationStage = String(options.liveConversationStage || "").trim();
      const expectedImageCount = Math.max(0, Number(options.expectedImageCount || options.plannedImageCount || 0));
      const imageEvidenceCount = Math.max(
        0,
        Number(options.imageEvidenceCount || 0),
        Number(options.generatedImageCount || 0),
        Number(options.downloadedImageCount || 0),
        Array.isArray(options.imageUrls) ? options.imageUrls.length : 0
      );
      const hasImageEvidence = imageEvidenceCount > 0
        && (expectedImageCount === 0 || imageEvidenceCount >= expectedImageCount);
      const evidenceMissing = { bypass: false, reason: "image-evidence-missing" };
      if (["waiting-copy", "completed-copy-pending-package"].includes(liveConversationStage)) {
        return hasImageEvidence ? { bypass: true, reason: "live-copy-boundary" } : evidenceMissing;
      }
      const hasCopyBoundary = Boolean(
        String(options.copyText || "").trim()
        || String(options.copyTextPath || "").trim()
        || String(options.packagePath || "").trim()
        || Number(options.downloadedImageCount || 0) > 0
      );
      if (hasCopyBoundary) return hasImageEvidence
        ? { bypass: true, reason: "copy-or-archive-boundary" }
        : evidenceMissing;
      const retryStage = String(options.retryStage || "").trim();
      if (Boolean(options.textSubmitted) && isPostImageRecoveryStage(retryStage)) {
        return hasImageEvidence ? { bypass: true, reason: "post-image-recovery-stage" } : evidenceMissing;
      }
      return { bypass: false, reason: "" };
    });
  const shouldBlockImageRecoveryAfterCopyBoundary = automationCore.shouldBlockImageRecoveryAfterCopyBoundary
    || ((options = {}) => {
      const stage = String(options.liveConversationStage || options.stage || "").trim();
      const copyText = String(options.copyText || "").trim();
      const hasCopyBoundary = Boolean(
        options.hasCopy === true
        || options.textSubmitted === true
        || copyText.length >= Math.max(1, Number(options.minimumCopyLength || 300))
        || String(options.copyTextPath || "").trim()
        || String(options.packagePath || "").trim()
      );
      const copyStage = ["waiting-copy", "completed-copy-pending-package", "completed", "archived"].includes(stage);
      if (!hasCopyBoundary && !copyStage) return { blocked: false, reason: "copy-boundary-not-observed", stage };
      const identityKnown = options.materialIdentityRequired !== true || options.materialIdentityMatched === true;
      if (!identityKnown) return { blocked: true, safeToAdopt: false, reason: "copy-boundary-material-mismatch", stage };
      return { blocked: true, safeToAdopt: Boolean(copyText), reason: copyText ? "copy-boundary-observed" : "copy-boundary-awaiting-copy-evidence", stage };
    });
  const shouldReenterConfirmAtPlanBoundary = automationCore.shouldReenterConfirmAtPlanBoundary
    || (() => false);
  const shouldReconcilePlanConfirmationBoundary = automationCore.shouldReconcilePlanConfirmationBoundary
    || (() => false);
  const shouldAdoptPlanReadyBoundary = automationCore.shouldAdoptPlanReadyBoundary
    || (() => false);
  const shouldAdoptCompletedCopyBoundary = automationCore.shouldAdoptCompletedCopyBoundary
    || (() => false);
  const resolveDurableWorkflowStep = automationCore.resolveDurableWorkflowStep
    || ((options = {}) => String(options.currentStep || "session-init"));
  const validatePlanPageCap = automationCore.validatePlanPageCap || ((options = {}) => {
    const maximum = Math.max(1, Number(options.maximum || 10));
    const planned = Math.max(0, Number(options.plannedImageCount || 0));
    const text = String(options.text || "");
    if (planned > maximum) return { valid: false, code: "PLAN_PAGE_CAP_EXCEEDED" };
    if (/P\s*11\b|第二批\s*[:：]?\s*P|第二批.{0,24}(?:继续|生成|出图|剩余)|(?:继续|再出).{0,24}P\s*11/iu.test(text)) {
      return { valid: false, code: "PLAN_BATCHING_FORBIDDEN" };
    }
    return { valid: true, code: "" };
  });
  const resolveEntryInstruction = automationCore.resolveEntryInstruction || ((entry = {}) => {
    if (String(entry.customPrompt || "").trim()) return String(entry.customPrompt).trim();
    if (String(entry.prompt || "").trim()) return String(entry.prompt).trim();
    return [
      "请沿用当前对话已经确定的母版与规则，处理刚上传的这组团建素材。",
      `内容名称：${String(entry.name || "").trim()}`
    ].filter(Boolean).join("\n");
  });
  const shouldRecoverSilentAssistant = automationCore.shouldRecoverSilentAssistant || ((options = {}) => (
    Number(options.elapsedMs || 0) >= Number(options.thresholdMs || 60_000)
      && Number(options.freshTurnCount || 0) === 0
      && !options.generating
      && Boolean(options.composerEmpty)
  ));
  const shouldRecoverSilentImageGeneration = automationCore.shouldRecoverSilentImageGeneration || ((options = {}) => (
    Number(options.elapsedMs || 0) >= Number(options.thresholdMs || 60_000)
      && Number(options.freshTurnCount || 0) === 0
      && Number(options.freshImageCount || 0) === 0
      && !options.generating
  ));
  const shouldStopStalledSilentGeneration = automationCore.shouldStopStalledSilentGeneration || ((options = {}) => (
    Boolean(options.generating)
      && Math.max(0, Number(options.stableForMs || 0)) >= Math.max(1, Number(options.thresholdMs || 300_000))
      && Math.max(0, Number(options.meaningfulTurnCount || 0)) === 0
  ));
  const shouldStopStalledNativeImageGeneration = automationCore.shouldStopStalledNativeImageGeneration || ((options = {}) => (
    Boolean(options.generating)
      && Math.max(0, Number(options.stableForMs || 0)) >= Math.max(1, Number(options.thresholdMs || 300_000))
      && Math.max(0, Number(options.detected || 0)) > 0
      && Math.max(0, Number(options.expected || 0)) > Math.max(0, Number(options.detected || 0))
  ));
  const shouldStopStalledEmptyImageGeneration = automationCore.shouldStopStalledEmptyImageGeneration || ((options = {}) => (
    Boolean(options.generating)
      && Math.max(0, Number(options.stableForMs || 0)) >= Math.max(1, Number(options.thresholdMs || 300_000))
      && Math.max(0, Number(options.detected || 0)) === 0
      && Math.max(0, Number(options.expected || 0)) > 0
  ));
  const nextContinuousImageIdleSince = automationCore.nextContinuousImageIdleSince || ((options = {}) => {
    const now = Math.max(0, Number(options.now || Date.now()));
    const previous = Math.max(0, Number(options.previous || 0));
    if (options.generating) return 0;
    if (options.signatureChanged || !previous) return now;
    return previous;
  });
  const detectRejectedImageDraftLoop = automationCore.detectRejectedImageDraftLoop || ((options = {}) => {
    const text = String(options.text || "");
    const nativeImages = Math.max(0, Number(options.nativeImages || 0));
    const rejectionMarkers = [...text.matchAll(/不合格|返工|重新绘制|重新生成这一页|再次重做/gu)].length;
    const samePageConstraint = /只(?:生成|做)(?:一张图|单页)|只保留.{0,30}P\s*\d+|只参考.{0,30}P\s*\d+/iu.test(text);
    return { detected: nativeImages >= 2 && rejectionMarkers >= 2 && samePageConstraint, rejectionMarkers, nativeImages };
  });
  const shouldRetryThreadError = automationCore.shouldRetryThreadError || ((options = {}) => (
    Number(options.elapsedMs || 0) >= Number(options.thresholdMs || 15_000)
      && Boolean(options.retryVisible)
      && Number(options.freshTurnCount || 0) === 0
      && !options.alreadyRetried
  ));
  const detectRepetitiveAssistantLoop = automationCore.detectRepetitiveAssistantLoop || ((text, minimumRepeats = 8) => {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const token = lines.at(-1) || "";
    let repeats = 0;
    for (let index = lines.length - 1; token && index >= 0 && lines[index] === token; index -= 1) repeats += 1;
    return { detected: Boolean(token && token.length <= 40 && repeats >= minimumRepeats), token, repeats };
  });
  const classifyPatrolConversationCandidate = automationCore.classifyPatrolConversationCandidate || ((options = {}) => {
    const title = String(options.title || "").replace(/\s+/g, " ").trim();
    const url = String(options.url || "").trim();
    const denylist = (Array.isArray(options.denylist) ? options.denylist : []).map((value) => String(value || "").trim());
    const titleMatched = /模板|母版/i.test(title);
    const excludedByKeyword = /游戏/i.test(title);
    const explicitlyExcluded = denylist.includes(url) || denylist.includes(title);
    const excluded = excludedByKeyword || explicitlyExcluded;
    return { title, url, titleMatched, excludedByKeyword, explicitlyExcluded, excluded, eligible: titleMatched && !excluded };
  });
  const classifyPatrolStage = globalThis.TeambuildingGptPatrolStage?.classifyPatrolStage || ((options = {}) => ({
    key: options.stage || "unknown",
    label: options.stage || "阶段证据不足",
    nextActionKey: "inspect",
    safeToAct: false,
    detail: ""
  }));
  const decidePatrolSingleStep = globalThis.TeambuildingGptPatrolStage?.decidePatrolSingleStep || (() => ({
    allowed: false,
    action: "none",
    reason: "patrol-decision-module-unavailable"
  }));
  const decidePatrolCopyRecovery = globalThis.TeambuildingGptPatrolStage?.decidePatrolCopyRecovery || ((options = {}) => {
    const attempts = Math.max(0, Number(options.attempts || 0));
    const maxAttempts = Math.max(0, Number(options.maxAttempts ?? 2));
    return attempts >= maxAttempts
      ? { action: "pause", nextAttempt: attempts }
      : { action: "retry", nextAttempt: attempts + 1 };
  });
  const isAutomationMaterialPrompt = globalThis.TeambuildingGptPatrolStage?.isAutomationMaterialPrompt
    || ((text = "") => /当前素材文件夹\s*[：:]\s*\S+/.test(String(text || ""))
      && /本次附件全部是待迁移素材|请(?:完整)?读取全部附件|\.(?:txt|jpe?g|png|webp|gif|avif)\b|\b文档\b|\b图片\b/i.test(String(text || "")));
  const preferredRecoveryImageUrls = globalThis.TeambuildingGptPatrolStage?.preferredRecoveryImageUrls
    || ((pageUrls = [], checkpointUrls = []) => checkpointUrls.length > pageUrls.length ? checkpointUrls : pageUrls);
  const hasDurablePatrolPackageEvidence = globalThis.TeambuildingGptPatrolStage?.hasDurablePatrolPackageEvidence
    || ((options = {}) => {
      const archivePath = String(options.archivePath || "").trim();
      const packagePath = String(options.packagePath || "").trim();
      const copyText = String(options.copyText || "").replace(/\s/g, "");
      const downloadedImages = Math.max(0, Number(options.downloadedImages || options.downloadedImageCount || 0), Number(options.packageImageCount || 0));
      const expectedImages = Math.max(0, Number(options.expectedImageCount || options.plannedImageCount || 0));
      return Boolean(archivePath || packagePath)
        && downloadedImages > 0
        && (!expectedImages || downloadedImages >= expectedImages)
        && copyText.length >= Math.max(1, Number(options.minimumCopyLength || 300));
    });
  const resolvePatrolCopyBoundary = globalThis.TeambuildingGptPatrolStage?.resolvePatrolCopyBoundary
    || ((options = {}) => {
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
    });
  const shouldProtectCopyBoundaryFromImageRecovery = globalThis.TeambuildingGptPatrolStage?.shouldProtectCopyBoundaryFromImageRecovery
    || ((options = {}) => {
      const stage = String(options.stage || options.boundaryStage || "").trim();
      const copyText = String(options.copyText || "").replace(/\s/g, "");
      const hasCopy = options.hasCopy === true
        || options.textSubmitted === true
        || copyText.length >= Math.max(1, Number(options.minimumCopyLength || 300));
      const copyStage = ["waiting-copy", "completed-copy-pending-package", "completed", "archived"]
        .includes(stage);
      return hasCopy || copyStage
        ? { protected: true, reason: hasCopy ? "copy-request-or-result-already-observed" : "copy-stage-already-entered", stage }
        : { protected: false, reason: "copy-boundary-not-entered", stage };
    });
  const patrolMaterialCopyIdentity = globalThis.TeambuildingGptPatrolStage?.patrolMaterialCopyIdentity
    || ((options = {}) => {
      const materialSource = String(options.materialName || options.sourceMaterialPath || options.materialText || "").trim();
      const copyText = String(options.copyText || "").trim();
      const folderName = materialSource.split(/[\\/]+/).filter(Boolean).at(-1) || materialSource;
      const stopTokens = new Set([
        "当前会话", "母版", "恢复", "团建", "攻略", "周边游", "一日游",
        "两天一夜", "一天", "人均", "新开业", "后悔没早点刷到", "说点大实话",
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
      return {
        required: true,
        matched: matchedTokens.length > 0,
        reason: matchedTokens.length ? "material-copy-identity-matched" : "material-copy-identity-mismatch",
        tokens: tokens.slice(0, 12),
        matchedTokens
      };
    });
  const findCompletedCopyBoundary = globalThis.TeambuildingGptPatrolStage?.findCompletedCopyBoundary
    || ((texts = [], minimumLength = 300) => ({
      found: false,
      index: -1,
      text: "",
      xhsText: "",
      douyinText: ""
    }));
  const generatedImageIdentity = automationCore.generatedImageIdentity || ((value) => String(value || "").trim());
  const uniqueGeneratedImageUrls = automationCore.uniqueGeneratedImageUrls || ((values) => [...new Set(values)]);
  const preferCurrentBatchImageUrls = automationCore.preferCurrentBatchImageUrls
    || ((roleBasedUrls = [], semanticUrls = []) => {
      const roleBased = uniqueGeneratedImageUrls(roleBasedUrls);
      const semantic = uniqueGeneratedImageUrls(semanticUrls);
      return semantic.length > roleBased.length ? semantic : roleBased;
    });
  const newGeneratedImageUrls = automationCore.newGeneratedImageUrls || ((values, baselineValues = []) => {
    const baseline = new Set((Array.isArray(baselineValues) ? baselineValues : []).map(generatedImageIdentity));
    return uniqueGeneratedImageUrls(values).filter((url) => !baseline.has(generatedImageIdentity(url)));
  });
  const limitGeneratedImageUrls = automationCore.limitGeneratedImageUrls
    || ((values, maximum = 0) => {
      const unique = uniqueGeneratedImageUrls(values);
      const cap = Math.max(0, Number(maximum || 0));
      return cap > 0 ? unique.slice(0, cap) : unique;
    });
  const isCompleteCopy = automationCore.isCompleteCopy || ((text, minimum = 300) => String(text || "").replace(/\s/g, "").length >= minimum);
  const isLikelyPublishCopy = automationCore.isLikelyPublishCopy || isCompleteCopy;
  const detectCopyMetaNarration = automationCore.detectCopyMetaNarration || (() => ({ matched: false, matches: [] }));
  const isPublishCopyReady = (text, minimum = 300) => isLikelyPublishCopy(text, minimum) && !detectCopyMetaNarration(text).matched;
  const defaultKeywordPattern = automationCore.defaultKeywordPattern || (() => "");
  const completionKeywordDetected = automationCore.completionKeywordDetected || ((text, options = {}) => {
    const pattern = String(options.keywordPattern || options.pattern || "").trim();
    if (!pattern || !text) return { matched: false, pattern };
    try {
      return { matched: new RegExp(pattern, "i").test(String(text || "")), pattern };
    } catch {
      return { matched: String(text || "").includes(pattern), pattern };
    }
  });
  const classifyAttachmentUploadResult = automationCore.classifyAttachmentUploadResult || ((options = {}) => {
    const expected = Math.max(0, Number(options.expected || 0));
    const observed = Math.max(0, Math.min(expected, Number(options.observed || 0)));
    if (expected > 0 && observed >= expected) return { status: "complete", expected, observed };
    if (observed > 0) return { status: "partial", expected, observed, code: "UPLOAD_LIMIT_SIGNAL" };
    return { status: "missing", expected, observed, code: "ATTACHMENT_UPLOAD_NOT_READY" };
  });
  const classifyPlanDetectionResult = automationCore.classifyPlanDetectionResult || ((options = {}) => {
    if (!options.validPlan) return { ready: false, code: "PLAN_NOT_READY" };
    if (!options.planComplete) return { ready: false, code: "PLAN_NOT_COMPLETE" };
    if (Object.prototype.hasOwnProperty.call(options, "plannedImageCount")
      && Math.max(0, Number(options.plannedImageCount || 0)) === 0) {
      return { ready: false, code: "PLAN_NOT_COMPLETE" };
    }
    return { ready: true, code: "" };
  });
  const decidePlanRecovery = automationCore.decidePlanRecovery || ((options = {}) => {
    const attempts = Math.max(0, Number(options.attempts || 0));
    const maxAttempts = Math.max(0, Number(options.maxAttempts ?? 2));
    if (options.generating) return { action: "wait-current", nextAttempt: attempts };
    if (attempts < maxAttempts) return { action: "retry-current", nextAttempt: attempts + 1 };
    return { action: "pause", nextAttempt: attempts };
  });
  const decideCopyRecovery = automationCore.decideCopyRecovery || ((options = {}) => {
    const attempts = Math.max(0, Number(options.attempts || 0));
    const maxAttempts = Math.max(0, Number(options.maxAttempts ?? 2));
    if (options.valid) return { action: "complete", nextAttempt: attempts };
    if (!options.hasCandidate || options.generating) return { action: "wait", nextAttempt: attempts };
    if (attempts < maxAttempts) return { action: "retry-current", nextAttempt: attempts + 1 };
    return { action: "pause", nextAttempt: attempts };
  });
  const decidePartialImageRecovery = automationCore.decidePartialImageRecovery || ((options = {}) => {
    const detected = Math.max(0, Number(options.detected || 0));
    const expected = Math.max(0, Number(options.expected || 0));
    const attempts = Math.max(0, Number(options.attempts || 0));
    const maxAttempts = Math.max(0, Number(options.maxAttempts ?? 2));
    if (expected > 0 && detected >= expected) return { action: "complete", nextAttempt: attempts };
    if (options.currentReplyInFlight || options.generating) return { action: "wait-current", nextAttempt: attempts };
    if (detected > 0 && expected > detected && attempts < maxAttempts) return { action: "continue-missing", nextAttempt: attempts + 1 };
    if (detected > 0 && expected > detected) return { action: "pause-partial", nextAttempt: attempts };
    return { action: "none", nextAttempt: attempts };
  });
  const classifyExhaustedImageRecovery = automationCore.classifyExhaustedImageRecovery || ((options = {}) => {
    const attempts = Math.max(0, Number(options.attempts || 0));
    const maxAttempts = Math.max(0, Number(options.maxAttempts ?? 2));
    const detected = Math.max(0, Number(options.detected || 0));
    if (detected === 0 && String(options.evidence || "") === "failed-image-response" && attempts >= maxAttempts) {
      return { action: "rotate-account", code: "IMAGE_GENERATION_UNAVAILABLE" };
    }
    return { action: "pause-uncertain", code: "IMAGE_COUNT_UNCERTAIN" };
  });
  const isRetryableNoImageResponseEvidence = automationCore.isRetryableNoImageResponseEvidence
    || ((evidence = "") => ["silent-image-response", "stalled-image-response", "failed-image-response"]
      .includes(String(evidence || "")));
  const mergePartialImageRecovery = automationCore.mergePartialImageRecovery || ((options = {}) => {
    const urls = uniqueGeneratedImageUrls([
      ...(Array.isArray(options.accumulated) ? options.accumulated : []),
      ...(Array.isArray(options.detected) ? options.detected : [])
    ]);
    return {
      ...decidePartialImageRecovery({
        ...options,
        detected: urls.length,
        currentReplyInFlight: options.currentReplyInFlight,
        generating: options.generating
      }),
      urls
    };
  });
  const partialImageRecoverySignature = automationCore.partialImageRecoverySignature || ((options = {}) => uniqueGeneratedImageUrls(
    Array.isArray(options.urls) ? options.urls : []
  ).map((url) => String(url || "").trim()).filter(Boolean).sort().join("|"));
  const effectiveGeneratedImageCount = automationCore.effectiveGeneratedImageCount || ((options = {}) => {
    const urls = uniqueGeneratedImageUrls(Array.isArray(options.urls) ? options.urls : []);
    // Keep the fallback aligned with the core helper: stale download-button
    // metadata must not lower the unique native-image URL count.
    return urls.length;
  });
  const imageUrlsFromLatestConfirmedBatch = automationCore.imageUrlsFromLatestConfirmedBatch || (() => []);
  const resolveDurableImageBoundary = automationCore.resolveDurableImageBoundary || ((options = {}) => ({
    ready: false,
    reason: "durable-image-boundary-helper-unavailable",
    expected: Math.max(0, Number(options.expectedImageCount || options.plannedImageCount || 0)),
    actual: Math.max(0, Number(options.generatedImageActualCount || options.generatedImages || 0)),
    urls: uniqueGeneratedImageUrls(options.generatedImageUrls || []),
    freshUrls: []
  }));
  const isFreshAutomationTurnKey = automationCore.isFreshAutomationTurnKey || ((options = {}) => {
    const key = String(options.key || "").trim();
    const baselineKeys = Array.isArray(options.baselineKeys) ? options.baselineKeys.map(String) : [];
    return Boolean(key && baselineKeys.length && !baselineKeys.includes(key));
  });
  const isActiveGenerationControl = automationCore.isActiveGenerationControl || ((options = {}) => {
    if (!options.visible || options.disabled) return false;
    const label = String(options.label || "");
    return /stop-(?:button|generating|streaming|response)|stop\s+(?:generating|streaming|response)|停止(?:生成|回答|响应|流式|思考)/i.test(label)
      || /(?:^|[\s:_-])stop(?:[\s:_-]|$)/i.test(label)
      || /(?:^|[\s:_-])停止(?:[\s:_-]|$)/i.test(label);
  });
  const detectPyScriptFallbackSignal = automationCore.detectPyScriptFallbackSignal || ((options = {}) => {
    const nativeImages = Math.max(0, Number(options.nativeImages || 0));
    if (nativeImages <= 0) return { detected: false, reason: "" };
    if (options.hasCodeSignal || options.hasScriptArtifact) return { detected: true, reason: "py-script-fallback" };
    return { detected: false, reason: "" };
  });
  const detectScriptOutputLimitSignal = automationCore.detectScriptOutputLimitSignal || ((options = {}) => {
    const nativeImages = Math.max(0, Number(options.nativeImages || 0));
    const artifactCount = Math.max(0, Number(options.artifactCount || 0));
    if (nativeImages > 0 || artifactCount <= 0) return { detected: false, reason: "" };
    if (options.hasCodeSignal || options.hasScriptArtifact || options.hasArchiveSignal) return { detected: true, reason: "script-output-limit" };
    return { detected: false, reason: "" };
  });
  const detectLowImageLimit = automationCore.detectLowImageLimit || ((options = {}) => {
    const nativeImages = Math.max(0, Number(options.nativeImages || 0));
    const threshold = Math.max(1, Number(options.threshold || 4));
    return { detected: nativeImages > 0 && nativeImages <= threshold, count: nativeImages, threshold };
  });
  const classifyAutomationBoundaryPause = automationCore.classifyAutomationBoundaryPause || ((snapshot = {}) => {
    if (snapshot.scriptOutputLimitSignal) return {
      shouldPause: true,
      boundaryPaused: true,
      code: "GENERATION_LIMIT_SIGNAL",
      riskReason: "script-output-limit",
      message: "检测到纯脚本/沙盒产物输出，按生图触顶处理，停止当前帖子"
    };
    if (snapshot.pyScriptFallbackSignal) return {
      shouldPause: true,
      boundaryPaused: true,
      code: "GENERATION_LIMIT_SIGNAL",
      riskReason: "py-script-fallback",
      message: "检测到 GPT 使用 PY 代码兜底拼接垃圾图，停止当前帖子，疑似撞到生图上限"
    };
    if (snapshot.limitSignal) return {
      shouldPause: true,
      boundaryPaused: true,
      code: "GENERATION_LIMIT_SIGNAL",
      riskReason: "retry-or-limit-signal",
      message: "检测到 GPT 重试或额度限制信号，停止当前帖子，等待下一个时间点"
    };
    if (snapshot.scriptOutput) return {
      shouldPause: true,
      boundaryPaused: true,
      code: "SCRIPT_GENERATED_OUTPUT",
      riskReason: "script-output",
      message: "检测到代码解释器或脚本输出，停止当前帖子，不把脚本拼图当作正常生图"
    };
    return { shouldPause: false, boundaryPaused: false, code: "", riskReason: "", message: "" };
  });
  function logGptLimitDebug(event, payload = {}) {
    const detail = {
      event,
      at: new Date().toISOString(),
      ...payload
    };
    try {
      console.warn("[TB_GPT_LIMIT]", detail);
    } catch {
      // ignore logging failures
    }
    return detail;
  }
  const SEASON_TAGS = Object.freeze({
    春季: ["春季", "春天", "春日"],
    夏季: ["夏季", "夏天", "夏日", "夏季团建"],
    秋季: ["秋季", "秋天", "秋日"],
    冬季: ["冬季", "冬天", "冬日"]
  });
  const HOLIDAY_TAGS = Object.freeze({
    元旦: ["元旦", "跨年"],
    春节: ["春节", "过年", "除夕"],
    元宵节: ["元宵节", "元宵"],
    情人节: ["情人节"],
    妇女节: ["妇女节", "女神节", "三八"],
    清明节: ["清明节", "清明"],
    劳动节: ["劳动节", "五一"],
    青年节: ["青年节", "五四"],
    儿童节: ["儿童节", "六一"],
    端午节: ["端午节", "端午"],
    七夕: ["七夕"],
    中秋节: ["中秋节", "中秋"],
    重阳节: ["重阳节", "重阳"],
    国庆节: ["国庆节", "国庆"],
    圣诞节: ["圣诞节", "圣诞"]
  });
  const DEFAULT_ACTION_SETTINGS = Object.freeze({
    game: { enabled: true, label: "游戏" },
    conversion: { enabled: true, label: "转化" },
    guide: { enabled: true, label: "合集" },
    increment: { enabled: true, label: "+1" },
    move: { enabled: false, label: "收纳", targetPath: "" }
  });
  const DEFAULT_PATHS = Object.freeze({
    productRoot: "D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目\\成品库（GPT+本地脚本制作）",
    materialRoot: "D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目\\01-素材库"
  });
  const state = {
    workspace: null,
    materials: null,
    materialIndex: null,
    paths: { ...DEFAULT_PATHS },
    productTree: null,
    productChildren: {},
    openProducts: new Set(),
    openMaterials: new Set(),
    materialFilter: { mainTag: "全部", season: "全部", holiday: "全部", usage: "all", query: "" },
    actionSettings: JSON.parse(JSON.stringify(DEFAULT_ACTION_SETTINGS)),
    settingsOpen: false,
    busy: false,
    // Stop after an unsent-composer boundary failure.  The next post must not
    // be started until the current composer is cleaned and explicitly retried.
    boundaryPaused: false,
    boundaryErrorCode: "",
    boundaryErrorDetail: "",
    uploadTasks: [],
    uploadSequence: 0,
    acceptedWorkbenchRequestIds: new Set(),
    activeTask: null,
    lastStopRequestKey: "",
    lastStopRequestAt: 0,
    internalComposerMutationUntil: 0,
    internalComposerMutationRequestId: "",
    observedAutomationComposerContent: false,
    composerClearReportedRequestId: "",
    health: {
      local: false,
      gptUpload: false,
      dedup: false
    },
    connected: false,
    collapsed: false,
    dragging: null,
    moveTarget: null,
    pendingMove: null,
    pendingUsage: null,
    usageCommitTimer: null
  };
  let remountQueued = false;
  let refreshTimer = null;
  let materialIndexTimer = null;
  localStorage.removeItem("tb-studio-collapsed");

  function isEmbeddedWorkbench() {
    return localStorage.getItem(EMBEDDED_STORAGE_KEY) === "1"
      || /TeambuildingWorkbenchGPT/i.test(navigator.userAgent || "");
  }

  function currentApiRoot() {
    const candidate = String(localStorage.getItem(API_ROOT_STORAGE_KEY) || "").trim();
    return /^http:\/\/127\.0\.0\.1:\d+$/.test(candidate) ? candidate : DEFAULT_API_ROOT;
  }

  function canUseExtensionBridge() {
    return Boolean(globalThis.chrome?.runtime?.id && typeof globalThis.chrome.runtime.sendMessage === "function");
  }

  function taskAbortError() {
    return new DOMException("当前账号窗口已停止", "AbortError");
  }

  function activeTaskSignal() {
    return state.activeTask?.controller?.signal || null;
  }

  function throwIfTaskAborted(task = state.activeTask) {
    if (task?.controller?.signal?.aborted) throw taskAbortError();
  }

  function waitForTaskDelay(delayMs, signal = activeTaskSignal()) {
    const delay = Math.max(0, Number(delayMs || 0));
    if (!signal) return new Promise((resolve) => setTimeout(resolve, delay));
    if (signal.aborted) return Promise.reject(taskAbortError());
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        reject(taskAbortError());
      };
      timer = setTimeout(finish, delay);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const fileName = (filePath) => String(filePath || "").split(/[\\/]/).pop() || "本地文件";

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  async function fetchImageWithTimeout(url, timeoutMs = 45_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(5_000, Number(timeoutMs) || 45_000));
    try {
      return await fetch(url, { credentials: "include", signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error("图片读取超时，准备刷新同一文件链接");
        timeoutError.code = "GPT_IMAGE_DOWNLOAD_TIMEOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function directLocalRequest(pathname, options = {}, responseType = "json", signal = null) {
    const timeoutController = new AbortController();
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs || 60_000));
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const onAbort = () => timeoutController.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(new URL(pathname, currentApiRoot()).href, {
        method: options.method || "GET",
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        body: options.body,
        signal: timeoutController.signal
      });
      if (!response.ok) throw new Error(await response.text().catch(() => `HTTP ${response.status}`));
      const contentType = response.headers.get("content-type") || "";
      if (responseType === "base64") return { ok: true, contentType, data: bufferToBase64(await response.arrayBuffer()) };
      if (responseType === "text") return { ok: true, contentType, data: await response.text() };
      return { ok: true, contentType, data: await response.json() };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function api(pathname, options = {}) {
    // ChatGPT wraps/filters page-world fetch, and Chromium may also apply
    // private-network checks to https://chatgpt.com -> localhost. A loaded
    // extension has host permissions and is the stable transport even when
    // the page is embedded in Electron; direct fetch is only a fallback.
    if (!canUseExtensionBridge()) {
      const result = await directLocalRequest(pathname, options);
      return result.data;
    }
    const result = await chrome.runtime.sendMessage({
      type: "tb-local-request",
      baseUrl: currentApiRoot(),
      path: pathname,
      method: options.method || "GET",
      body: options.body ? JSON.parse(options.body) : undefined
    });
    if (!result?.ok) throw new Error(result?.error || "本地工作台连接失败");
    return result.data;
  }

  async function readLocalFile(filePath, responseType = "base64", signal = null) {
    if (!canUseExtensionBridge()) {
      return directLocalRequest(`/file?path=${encodeURIComponent(filePath)}`, {}, responseType, signal);
    }
    if (signal?.aborted) throw new DOMException("上传已取消", "AbortError");
    const request = chrome.runtime.sendMessage({
      type: "tb-local-request",
      baseUrl: currentApiRoot(),
      path: `/file?path=${encodeURIComponent(filePath)}`,
      responseType
    });
    const abort = new Promise((_, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("上传已取消", "AbortError")), { once: true });
    });
    const result = signal ? await Promise.race([request, abort]) : await request;
    if (!result?.ok) throw new Error(result?.error || `无法读取 ${fileName(filePath)}`);
    return result;
  }

  async function recordWorkbenchQuota(entry, kind, count) {
    if (!entry?.externalRequestId || !entry?.accountId || Number(count || 0) < 1) return null;
    const result = await api("/api/gpt-production/quota-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: entry.accountId,
        requestId: entry.externalRequestId,
        kind,
        count: Number(count)
      })
    });
    // The workbench renderer may be waiting while GPT is generating.  Push
    // the authoritative ledger snapshot immediately instead of waiting for a
    // page switch or a full task completion.
    window.postMessage({
      source: "tb-gpt-production-extension",
      type: "tb-workbench-quota-updated",
      accountId: entry.accountId,
      quota: result?.quota || null,
      kind,
      count: Number(count)
    }, "*");
    return result;
  }

  // ── 对话日志：记录工作流每一步发送和接收的完整内容，写入服务端 jsonl 文件 ──
  // 非阻塞：日志写入失败不影响生产流程
  function logConversationEvent(event, data = {}) {
    const numberValue = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
    };
    const payload = {
      event,
      requestId: String(data.requestId || "").slice(0, 120),
      account: String(data.account || localStorage.getItem("tb-workbench-account-id") || "").slice(0, 60),
      conversationUrl: String(data.conversationUrl || location.href || "").slice(0, 500),
      materialName: String(data.materialName || "").slice(0, 300),
      step: String(data.step || "").slice(0, 60),
      sentText: typeof data.sentText === "string" ? data.sentText : "",
      receivedText: typeof data.receivedText === "string" ? data.receivedText : "",
      imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : [],
      downloadedFiles: Array.isArray(data.downloadedFiles) ? data.downloadedFiles : [],
      copyTextPath: String(data.copyTextPath || "").slice(0, 500),
      packagePath: String(data.packagePath || "").slice(0, 500),
      // 每个步骤的时间线字段：用于判断到底卡在等待、网页响应还是本地动作。
      status: String(data.status || "").slice(0, 40),
      startedAt: String(data.startedAt || "").slice(0, 40),
      endedAt: String(data.endedAt || "").slice(0, 40),
      elapsedMs: numberValue(data.elapsedMs),
      stageStartedAt: String(data.stageStartedAt || "").slice(0, 40),
      stageElapsedMs: numberValue(data.stageElapsedMs),
      deadlineAt: String(data.deadlineAt || "").slice(0, 40),
      waitLimitMs: numberValue(data.waitLimitMs),
      attempt: Math.max(0, Math.min(99, Math.floor(numberValue(data.attempt)))),
      meta: data.meta || {}
    };
    api("/api/gpt-production/conversation-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => { /* 日志写入失败不影响生产 */ });
  }
  globalThis.TeambuildingLogConversationEvent = logConversationEvent;

  function readStoredPaths() {
    return new Promise((resolve) => {
      chrome.storage.local.get(PATH_STORAGE_KEY, (result) => {
        const saved = result?.[PATH_STORAGE_KEY] || {};
        resolve({
          productRoot: saved.productRoot || DEFAULT_PATHS.productRoot,
          materialRoot: saved.materialRoot || DEFAULT_PATHS.materialRoot
        });
      });
    });
  }

  function storePaths(paths = state.paths) {
    const next = {
      productRoot: paths.productRoot || DEFAULT_PATHS.productRoot,
      materialRoot: paths.materialRoot || DEFAULT_PATHS.materialRoot
    };
    state.paths = next;
    chrome.storage.local.set({ [PATH_STORAGE_KEY]: next });
  }

  function normalizeActionSettings(raw = {}) {
    return Object.fromEntries(Object.entries(DEFAULT_ACTION_SETTINGS).map(([key, defaults]) => {
      const saved = raw?.[key] || {};
      return [key, {
        ...defaults,
        enabled: saved.enabled !== undefined ? Boolean(saved.enabled) : defaults.enabled,
        label: String(saved.label || defaults.label).trim().slice(0, 8) || defaults.label,
        ...(key === "move" ? { targetPath: String(saved.targetPath || "").trim() } : {})
      }];
    }));
  }

  function readActionSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(ACTION_STORAGE_KEY, (result) => {
        resolve(normalizeActionSettings(result?.[ACTION_STORAGE_KEY] || {}));
      });
    });
  }

  function storeActionSettings(settings = state.actionSettings) {
    state.actionSettings = normalizeActionSettings(settings);
    chrome.storage.local.set({ [ACTION_STORAGE_KEY]: state.actionSettings });
  }

  function setStatus(message, tone = "") {
    const node = document.querySelector(`#${ROOT_ID} [data-status]`);
    if (!node) return;
    node.textContent = message;
    node.dataset.tone = tone;
  }

  function setBusy(entry, message = "") {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.dataset.busy = String(Boolean(entry));
    root.querySelectorAll("[data-entry-kind]").forEach((row) => {
      row.classList.toggle("is-uploading", Boolean(entry) && row.dataset.entryId === entry.id);
    });
    if (message) setStatus(message);
  }

  function renderHealth() {
    const host = document.querySelector(`#${ROOT_ID} [data-health]`);
    if (!host) return;
    const checks = [
      ["local", "本地目录"],
      ["gptUpload", "GPT 上传"],
      ["dedup", "历史去重"]
    ];
    host.innerHTML = checks.map(([key, label]) => (
      `<i data-ok="${String(Boolean(state.health[key]))}" title="${label}${state.health[key] ? "正常" : "未就绪"}"></i>`
    )).join("");
    host.title = checks.map(([key, label]) => `${label}：${state.health[key] ? "正常" : "未就绪"}`).join("\n");
  }

  function renderQueue() {
    const host = document.querySelector(`#${ROOT_ID} [data-upload-queue]`);
    if (!host) return;
    const tasks = state.uploadTasks.slice(-4).reverse();
    host.hidden = tasks.length === 0;
    host.innerHTML = tasks.map((task) => {
      const progress = task.total
        ? Math.min(100, Math.round((task.completed / task.total) * 100))
        : 0;
      const label = {
        queued: "等待上传",
        checking: "检查历史去重",
        reading: `读取 ${task.completed}/${task.total}`,
        attaching: "放入 GPT",
        success: "已进入附件区",
        duplicate: "已拦截重复",
        failed: "上传失败",
        cancelled: "已取消"
      }[task.status] || task.status;
      return `
        <article class="tb-queue-row" data-queue-status="${escapeHtml(task.status)}">
          <div class="tb-queue-copy">
            <b title="${escapeHtml(task.entry.name)}">${escapeHtml(task.entry.name)}</b>
            <small>${escapeHtml(label)}${task.error ? ` · ${escapeHtml(task.error)}` : ""}</small>
          </div>
          <div class="tb-queue-progress"><i style="width:${progress}%"></i></div>
          ${["queued", "checking", "reading"].includes(task.status)
            ? `<button type="button" data-cancel-upload="${task.id}">取消</button>`
            : task.status === "failed"
              ? `<button type="button" data-retry-upload="${task.id}">重试</button>`
              : `<span class="tb-queue-result">${task.status === "success" ? "✓" : "—"}</span>`}
        </article>
      `;
    }).join("");
  }

  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, delay);
  }

  function applyLayout() {
    document.documentElement.classList.toggle("tb-production-studio-open", !state.collapsed);
    const root = document.getElementById(ROOT_ID);
    if (root) root.dataset.collapsed = String(state.collapsed);
    const launcher = document.getElementById(LAUNCHER_ID);
    if (launcher) launcher.hidden = !state.collapsed;
  }

  function showDropOverlay(visible) {
    const overlay = document.getElementById(DROP_OVERLAY_ID);
    if (overlay) overlay.hidden = !visible;
  }

  function isChatDropTarget(target) {
    return Boolean(
      target?.closest?.("main")
      && !target.closest?.(`#${ROOT_ID}`)
      && !target.closest?.("nav, aside, [role='navigation']")
    );
  }

  function clearMoveTarget() {
    document.querySelectorAll(`#${ROOT_ID} .is-move-target`)
      .forEach((node) => node.classList.remove("is-move-target"));
    state.moveTarget = null;
  }

  function renderMoveDialog() {
    const dialog = document.querySelector(`#${ROOT_ID} [data-move-dialog]`);
    if (!dialog) return;
    const pending = state.pendingMove;
    dialog.hidden = !pending;
    if (!pending) return;
    dialog.querySelector("[data-move-source-name]").textContent = pending.entry.name;
    dialog.querySelector("[data-move-target-name]").textContent = fileName(pending.targetPath);
  }

  async function confirmMove() {
    const pending = state.pendingMove;
    if (!pending) return;
    state.pendingMove = null;
    renderMoveDialog();
    setStatus(`正在移动“${pending.entry.name}”…`);
    try {
      await api("/api/extension/move-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: pending.entry.path,
          targetPath: pending.targetPath
        })
      });
      state.productChildren = {};
      state.openProducts.clear();
      state.openMaterials.clear();
      await refresh();
      setStatus(`已移动到“${fileName(pending.targetPath)}”`, "success");
    } catch (error) {
      setStatus(`移动失败：${error.message}`, "danger");
    }
  }

  function productRows(entries = state.productTree?.entries || [], depth = 0) {
    return entries.map((item) => {
      if (item.kind === "file") {
        return `
          <article class="tb-work-row tb-file-row" style="--tree-depth:${depth}" draggable="${item.uploadable ? "true" : "false"}"
            ${item.uploadable ? `data-entry-kind="product" data-entry-id="${escapeHtml(item.id)}"` : ""}>
            <span class="tb-file-icon" aria-hidden="true"></span>
            <span class="tb-work-name" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</span>
            ${item.uploadable ? `<button type="button" data-upload-product="${escapeHtml(item.id)}">传 GPT</button>` : ""}
          </article>
        `;
      }
      const loaded = Object.prototype.hasOwnProperty.call(state.productChildren, item.path);
      const children = state.productChildren[item.path]?.entries || [];
      const directCount = Number(item.imageCount || 0) + Number(item.textCount || 0);
      return `
          <details class="tb-tree-group tb-product-group" style="--tree-depth:${depth}" data-product-path="${escapeHtml(item.path)}"
            ${state.openProducts.has(item.path) ? "open" : ""}>
          <summary draggable="true" data-move-source-kind="product" data-move-source-id="${escapeHtml(item.id)}"
            data-move-target-path="${escapeHtml(item.path)}">
            <span class="tb-folder-icon"></span>
            <span class="tb-library-copy">
              <b title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</b>
              <small>${Number(item.folderCount || 0)} 个文件夹 · ${Number(item.fileCount || 0)} 个文件</small>
            </span>
            <span class="tb-library-count">${Number(item.folderCount || 0) + Number(item.fileCount || 0)}</span>
          </summary>
          <div class="tb-tree-items">
            ${directCount ? `
              <article class="tb-work-row tb-folder-upload" draggable="true" data-entry-kind="product" data-entry-id="${escapeHtml(item.id)}"
                data-move-source-kind="product" data-move-source-id="${escapeHtml(item.id)}">
                <span class="tb-image-count"><b>${Number(item.imageCount || 0)}</b><small>图</small></span>
                <span class="tb-work-copy"><span class="tb-work-name">上传这个文件夹</span><small>${Number(item.textCount || 0)} 个文档</small></span>
                <button type="button" data-upload-product="${escapeHtml(item.id)}">传 GPT</button>
              </article>
            ` : ""}
            ${loaded ? productRows(children, depth + 1) || `<div class="tb-empty compact">这个文件夹是空的</div>`
              : `<div class="tb-empty compact">展开后读取这个文件夹</div>`}
          </div>
        </details>
      `;
    }).join("") || `<div class="tb-empty">成品目录是空的</div>`;
  }

  function materialMatchesFilter(item) {
    const { mainTag, season, holiday, usage, query } = state.materialFilter;
    if (mainTag !== "全部" && item.mainTag !== mainTag) return false;
    if (season !== "全部" && !materialHasGroupedTag(item, SEASON_TAGS, season)) return false;
    if (holiday !== "全部" && !materialHasGroupedTag(item, HOLIDAY_TAGS, holiday)) return false;
    const count = Number(item.usageCount || 0);
    if (usage === "0" && count !== 0) return false;
    if (usage === "1" && count !== 1) return false;
    if (usage === "2" && count !== 2) return false;
    if (usage === "3+" && count < 3) return false;
    const needle = String(query || "").trim().toLowerCase();
    if (needle) {
      const haystack = `${item.name || ""} ${item.mainTag || ""} ${(item.tags || []).join(" ")} ${item.folderHash || ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }

  function materialHasGroupedTag(item, groups, value) {
    const aliases = groups[value] || [];
    const tags = new Set((item.tags || []).map((tag) => String(tag).trim()));
    return aliases.some((alias) => tags.has(alias));
  }

  function groupedTagCounts(groups) {
    const items = state.materialIndex?.items || [];
    return Object.fromEntries(Object.keys(groups).map((value) => [
      value,
      items.filter((item) => materialHasGroupedTag(item, groups, value)).length
    ]));
  }

  function materialActionButtons(item) {
    const settings = state.actionSettings;
    const buttons = [];
    if (settings.game.enabled) buttons.push(`<button type="button" data-material-main-tag="团建游戏" data-material-id="${escapeHtml(item.id)}">${escapeHtml(settings.game.label)}</button>`);
    if (settings.conversion.enabled) buttons.push(`<button type="button" data-material-main-tag="团建转化" data-material-id="${escapeHtml(item.id)}">${escapeHtml(settings.conversion.label)}</button>`);
    if (settings.guide.enabled) buttons.push(`<button type="button" data-material-main-tag="合集攻略" data-material-id="${escapeHtml(item.id)}">${escapeHtml(settings.guide.label)}</button>`);
    if (settings.increment.enabled) buttons.push(`<button type="button" data-material-increment="${escapeHtml(item.id)}">${escapeHtml(settings.increment.label)}</button>`);
    if (settings.move.enabled && settings.move.targetPath) buttons.push(`<button type="button" data-material-move="${escapeHtml(item.id)}">${escapeHtml(settings.move.label)}</button>`);
    return buttons.join("");
  }

  function materialRow(item, indexed = false) {
    return `
      <article class="tb-work-row" draggable="${indexed ? "false" : "true"}"
        data-entry-kind="material" data-entry-id="${escapeHtml(item.id)}"
        data-index-category="${escapeHtml(item.categoryId || "")}"
        data-indexed="${String(indexed)}"
        data-move-source-kind="material" data-move-source-id="${escapeHtml(item.id)}">
        <span class="tb-post-folder" aria-hidden="true"><i class="tb-folder-icon"></i></span>
        <span class="tb-work-copy">
          <span class="tb-work-name" title="${escapeHtml(item.path || item.name)}">${escapeHtml(item.name)}</span>
          <span class="tb-material-meta"><i>${escapeHtml(item.mainTag || "团建转化")}</i><em>${Number(item.usageCount || 0)} 次</em><code title="文件夹哈希 ${escapeHtml(item.folderHash || "")}">${escapeHtml((item.folderHash || "").slice(0, 8))}</code></span>
          <small>${Number(item.imageCount || 0)} 张图 · ${Number(item.textCount || 0)} 个文档${item.mainTagSource === "manual" ? " · 人工标签" : " · 自动识别"}${item.usageSource ? ` · ${escapeHtml(item.usageSource)}` : ""}</small>
        </span>
        <span class="tb-material-actions">${materialActionButtons(item)}<button type="button" class="tb-primary-action" data-upload-material="${escapeHtml(item.id)}" data-index-category="${escapeHtml(item.categoryId || "")}">传 GPT</button></span>
      </article>`;
  }

  function materialFilterActive() {
    return state.materialFilter.mainTag !== "全部"
      || state.materialFilter.season !== "全部"
      || state.materialFilter.holiday !== "全部"
      || state.materialFilter.usage !== "all"
      || Boolean(String(state.materialFilter.query || "").trim());
  }

  function globalMaterialRows() {
    const index = state.materialIndex;
    if (!index?.items?.length) {
      const progress = index?.status === "running"
        ? `正在建立全库索引：${Number(index.processedCategories || 0)}/${Number(index.totalCategories || 0)} 个分类，已识别 ${Number(index.indexedItems || 0)} 条`
        : "全库索引尚未完成";
      return `<div class="tb-empty">${progress}</div>`;
    }
    const filtered = index.items.filter(materialMatchesFilter);
    const visible = filtered
      .slice()
      .sort((left, right) => Number(right.usageCount || 0) - Number(left.usageCount || 0)
        || String(left.name || "").localeCompare(String(right.name || ""), "zh-Hans-CN"))
      .slice(0, 240);
    const groups = new Map();
    visible.forEach((item) => {
      const key = item.categoryId || item.categoryName || "其他";
      if (!groups.has(key)) groups.set(key, { id: key, name: item.categoryName || "其他", items: [] });
      groups.get(key).items.push(item);
    });
    const rows = Array.from(groups.values()).map((category) => `
      <details class="tb-tree-group tb-index-results" open>
        <summary><span class="tb-folder-icon"></span><b>${escapeHtml(category.name)}</b><small>${category.items.length}</small></summary>
        <div class="tb-tree-items">${category.items.map((item) => materialRow(item, true)).join("")}</div>
      </details>
    `).join("");
    if (!rows) return `<div class="tb-empty">全库筛选下没有匹配素材</div>`;
    return `<div class="tb-index-result-note">全库匹配 ${filtered.length} 条${filtered.length > visible.length ? `，当前显示前 ${visible.length} 条，请继续输入关键词缩小范围` : ""}</div>${rows}`;
  }

  function materialRows() {
    if (materialFilterActive()) return globalMaterialRows();
    const categories = state.materials?.categories || [];
    return categories.map((category) => `
      <details class="tb-tree-group" data-category="${escapeHtml(category.id)}"
        ${state.openMaterials.has(category.id) ? "open" : ""}>
        <summary data-move-target-path="${escapeHtml(category.path)}"><span class="tb-folder-icon"></span><b title="${escapeHtml(category.name)}">${escapeHtml(category.name)}</b><small>${Number(category.count || 0)}</small></summary>
        <div class="tb-tree-items">
          ${category.loaded ? (category.items || []).map((item) => materialRow(item)).join("")
            || `<div class="tb-empty compact">这个分类没有素材</div>`
            : `<div class="tb-empty compact">展开后读取这个文件夹并生成哈希</div>`}
        </div>
      </details>
    `).join("") || `<div class="tb-empty">素材目录中还没有识别到“图片 + 文案”帖子</div>`;
  }

  function materialFilterBar() {
    const stats = state.materialIndex?.stats;
    const tagButtons = ["全部", "团建游戏", "团建转化", "合集攻略"].map((tag) => (
      `<button type="button" data-filter-main-tag="${tag}" data-active="${String(state.materialFilter.mainTag === tag)}">${tag}<small>${tag === "全部" ? Number(stats?.total || 0) : Number(stats?.byMainTag?.[tag] || 0)}</small></button>`
    )).join("");
    const seasonCounts = groupedTagCounts(SEASON_TAGS);
    const holidayCounts = groupedTagCounts(HOLIDAY_TAGS);
    const groupedButtons = (dimension, groups, counts) => ["全部", ...Object.keys(groups)]
      .filter((value) => value === "全部" || Number(counts[value] || 0) > 0)
      .map((value) => `<button type="button" data-filter-dimension="${dimension}" data-filter-value="${value}" data-active="${String(state.materialFilter[dimension] === value)}">${value}<small>${value === "全部" ? "" : Number(counts[value] || 0)}</small></button>`)
      .join("");
    const progress = state.materialIndex?.status === "running"
      ? `索引 ${Number(state.materialIndex.processedCategories || 0)}/${Number(state.materialIndex.totalCategories || 0)}`
      : state.materialIndex?.generatedAt
        ? `已索引 ${Number(stats?.total || 0)} · 待核对 ${Number(stats?.review || 0)}`
        : "准备建立全库索引";
    return `
      <div class="tb-material-filter">
        <div class="tb-main-filter-row">${tagButtons}</div>
        <div class="tb-filter-dimensions">
          <details class="tb-filter-group" ${state.materialFilter.season !== "全部" ? "open" : ""}>
            <summary>季节${state.materialFilter.season !== "全部" ? ` · ${escapeHtml(state.materialFilter.season)}` : ""}</summary>
            <div>${groupedButtons("season", SEASON_TAGS, seasonCounts)}</div>
          </details>
          <details class="tb-filter-group" ${state.materialFilter.holiday !== "全部" ? "open" : ""}>
            <summary>节日${state.materialFilter.holiday !== "全部" ? ` · ${escapeHtml(state.materialFilter.holiday)}` : ""}</summary>
            <div>${groupedButtons("holiday", HOLIDAY_TAGS, holidayCounts)}</div>
          </details>
        </div>
        <select data-filter-usage aria-label="按使用次数筛选">
          <option value="all" ${state.materialFilter.usage === "all" ? "selected" : ""}>全部次数 ${Number(stats?.total || 0)}</option>
          <option value="0" ${state.materialFilter.usage === "0" ? "selected" : ""}>未使用 ${Number(stats?.byUsage?.unused || 0)}</option>
          <option value="1" ${state.materialFilter.usage === "1" ? "selected" : ""}>使用 1 次 ${Number(stats?.byUsage?.once || 0)}</option>
          <option value="2" ${state.materialFilter.usage === "2" ? "selected" : ""}>使用 2 次 ${Number(stats?.byUsage?.twice || 0)}</option>
          <option value="3+" ${state.materialFilter.usage === "3+" ? "selected" : ""}>使用 3 次以上 ${Number(stats?.byUsage?.threePlus || 0)}</option>
        </select>
        <input data-filter-query value="${escapeHtml(state.materialFilter.query)}" placeholder="搜索名称、标签或哈希">
        <button type="button" data-open-material-settings title="设置文件夹按钮">⚙</button>
        <small class="tb-index-status">${progress}</small>
      </div>`;
  }

  function materialSettingsFields() {
    const rows = [
      ["game", "团建游戏"],
      ["conversion", "团建转化"],
      ["guide", "合集攻略"],
      ["increment", "使用次数 +1"],
      ["move", "移动到固定目录"]
    ];
    return rows.map(([key, title]) => {
      const setting = state.actionSettings[key];
      return `<label class="tb-setting-row">
        <input type="checkbox" data-action-enabled="${key}" ${setting.enabled ? "checked" : ""}>
        <span>${title}</span>
        <input data-action-label="${key}" value="${escapeHtml(setting.label)}" maxlength="8" aria-label="${title}按钮名称">
      </label>`;
    }).join("");
  }

  function renderMaterialSettings() {
    const root = document.getElementById(ROOT_ID);
    const dialog = root?.querySelector("[data-material-settings]");
    if (!dialog) return;
    dialog.hidden = !state.settingsOpen;
    if (!state.settingsOpen) return;
    dialog.querySelector("[data-action-fields]").innerHTML = materialSettingsFields();
    dialog.querySelector("[data-action-move-target]").value = state.actionSettings.move.targetPath || "";
  }

  function renderBody() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const settings = state.workspace?.settings;
    const production = state.workspace?.dedup?.production;
    root.querySelector("[data-product-path]").value = settings?.workPackage?.libraryPath || state.paths.productRoot;
    root.querySelector("[data-material-path]").value = settings?.materialRoot || state.paths.materialRoot;
    root.querySelector("[data-dedup]").innerHTML = production?.available
      ? `<b>${Number(production.uniqueImageGroups || 0)}</b> 组历史 · 精确 ${Number(production.exactHashGroups || 0)} · 视觉 ${Number(production.perceptualHashGroups || 0)}`
      : "历史去重库尚未连接";
    root.querySelector("[data-products]").innerHTML = productRows();
    root.querySelector("[data-material-filter]").innerHTML = materialFilterBar();
    root.querySelector("[data-materials]").innerHTML = materialRows();
    renderMaterialSettings();
  }

  function render() {
    const host = document.body || document.documentElement;
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("aside");
      root.id = ROOT_ID;
      root.innerHTML = `
        <header class="tb-studio-header">
          <div><span>本地生产</span><b>团建创作</b></div>
          <button type="button" data-collapse title="收起右侧生产舱">×</button>
        </header>
        <form class="tb-path-bar" data-product-form>
          <label>成品库</label>
          <input data-product-path aria-label="成品库路径" placeholder="粘贴成品文件夹路径，回车读取">
          <button type="submit">读取</button>
        </form>
        <div class="tb-dedup-strip"><i></i><span data-dedup>正在读取历史去重库…</span></div>
        <section class="tb-studio-zone tb-products-zone">
          <div class="tb-zone-title"><div><span>01</span><b>成品区</b></div><small>成品包与已完成作品</small></div>
          <div class="tb-zone-scroll" data-products></div>
        </section>
        <section class="tb-studio-zone tb-materials-zone">
          <div class="tb-zone-title"><div><span>02</span><b>素材区</b></div><small>图片 + 文案帖子</small></div>
          <form class="tb-mini-path" data-material-form>
            <input data-material-path aria-label="素材库路径" placeholder="粘贴素材文件夹路径">
            <button type="submit" title="读取素材目录">↻</button>
          </form>
          <div data-material-filter></div>
          <div class="tb-zone-scroll" data-materials></div>
        </section>
        <section class="tb-upload-queue" data-upload-queue hidden></section>
        <section class="tb-move-confirm" data-move-dialog hidden role="dialog" aria-modal="true" aria-label="确认移动文件夹">
          <div>
            <b>移动本地文件夹？</b>
            <p>“<span data-move-source-name></span>”将真实移动到“<span data-move-target-name></span>”。原位置会消失。</p>
            <footer>
              <button type="button" data-cancel-move>取消</button>
              <button type="button" data-confirm-move>确认移动</button>
            </footer>
          </div>
        </section>
        <section class="tb-material-settings" data-material-settings hidden role="dialog" aria-modal="true" aria-label="素材文件夹按钮设置">
          <form data-material-settings-form>
            <header><b>素材文件夹按钮</b><button type="button" data-close-material-settings aria-label="关闭设置">×</button></header>
            <p>每个文件夹只保留一个母标签；同义游戏分类统一归入“团建游戏”。</p>
            <div data-action-fields></div>
            <label class="tb-move-target"><span>固定移动目录</span><input data-action-move-target placeholder="例如 D:\\素材库\\已处理"></label>
            <footer><button type="button" data-reset-material-settings>恢复默认</button><button type="submit">保存设置</button></footer>
          </form>
        </section>
        <footer class="tb-studio-footer"><span data-status>正在连接本地工作台…</span><span class="tb-health" data-health></span><b>拖入对话或点“传 GPT”</b></footer>
      `;
      host.appendChild(root);
      root.querySelector("[data-product-path]").value = state.paths.productRoot;
      root.querySelector("[data-material-path]").value = state.paths.materialRoot;
    }
    let launcher = document.getElementById(LAUNCHER_ID);
    if (!launcher) {
      launcher = document.createElement("button");
      launcher.id = LAUNCHER_ID;
      launcher.className = "tb-studio-reopen";
      launcher.type = "button";
      launcher.dataset.studioLauncher = "";
      launcher.title = "展开团建创作生产舱";
      launcher.setAttribute("aria-label", "展开团建创作生产舱");
      launcher.innerHTML = `<span>创作舱</span><b>‹</b>`;
      host.appendChild(launcher);
    }
    let dropOverlay = document.getElementById(DROP_OVERLAY_ID);
    if (!dropOverlay) {
      dropOverlay = document.createElement("div");
      dropOverlay.id = DROP_OVERLAY_ID;
      dropOverlay.hidden = true;
      dropOverlay.innerHTML = "<b>松开放入当前 GPT</b><span>将自动读取文件、上传附件并填入生产指令</span>";
      host.appendChild(dropOverlay);
    }
    applyLayout();
    if (state.workspace) renderBody();
    renderQueue();
    renderHealth();
  }

  function composer() {
    return document.querySelector("#prompt-textarea")
      || document.querySelector('div[contenteditable="true"][id*="prompt"]')
      || document.querySelector('form [contenteditable="true"]')
      || document.querySelector('[data-testid*="composer"] [contenteditable="true"]')
      || document.querySelector('div[contenteditable="true"][role="textbox"]')
      || document.querySelector('textarea[placeholder*="Message"]')
      || document.querySelector('form [data-lexical-editor="true"][contenteditable="true"]')
      || document.querySelector('#composer-textarea')
      || document.querySelector('[data-testid="composer-text-input"]');
  }

  async function ensureEditableConversation() {
    if (composer()) return true;
    if (!/^\/share\//i.test(location.pathname)) return false;
    const continueButton = [...document.querySelectorAll("button, a")].find((node) => {
      const text = String(node.innerText || node.textContent || "").trim();
      return /继续(?:此|该)?对话|继续聊天|Continue (?:this )?conversation/i.test(text);
    });
    if (!continueButton) return false;
    continueButton.click();
    return waitFor(() => Boolean(composer()), 20_000);
  }

  function mergeComposerText(existing, addition) {
    const current = String(existing || "");
    if (!current.trim()) return addition;
    if (current.includes(addition)) return current;
    return `${current.replace(/\s+$/, "")}\n\n${addition}`;
  }

  function fillComposer(text) {
    const target = composer();
    if (!target) throw new Error("没有找到当前 GPT 输入框");
    target.focus();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const existingText = target.value || "";
      const nextText = mergeComposerText(existingText, text);
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value")?.set;
      if (setter) setter.call(target, nextText);
      else target.value = nextText;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const existingText = target.innerText || target.textContent || "";
    const nextText = mergeComposerText(existingText, text);
    const addition = existingText.trim() ? `\n\n${text}` : text;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (typeof document.execCommand === "function") {
      document.execCommand("insertText", false, addition);
    } else {
      target.textContent = nextText;
    }
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: addition }));
  }

  // Automated workflow controls must always be sent as fresh messages. GPT can
  // retain an unsent draft after a programmatic submit, and merging "1" or the
  // copy prompt into that draft corrupts the workflow turn.
  function setComposerText(text) {
    const target = composer();
    if (!target) throw new Error("没有找到当前 GPT 输入框");
    const next = String(text || "");
    target.focus();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value")?.set;
      if (setter) setter.call(target, next);
      else target.value = next;
    } else {
      // ProseMirror: select all existing content, then insert replacement text
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection?.removeAllRanges();
      selection?.addRange(range);
      let inserted = false;
      if (typeof document.execCommand === "function") {
        try { inserted = document.execCommand("insertText", false, next); } catch {}
      }
      // Fallback 1: direct textContent + InputEvent (for when execCommand fails)
      if (!inserted || !composerDraftText()) {
        target.textContent = next;
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: next }));
      }
      // Fallback 2: paste via ClipboardEvent (ProseMirror intercepts paste)
      if (!composerDraftText()) {
        try {
          const clipboardData = new DataTransfer();
          clipboardData.setData("text/plain", next);
          target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
        } catch {}
      }
    }
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: next }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clearComposerDraft() {
    const target = composer();
    if (!target) return false;
    const existingDraft = composerDraftText();
    if (!existingDraft) {
      clearAutomationDraftMarker();
      return true;
    }
    target.focus();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value")?.set;
      if (setter) setter.call(target, "");
      else target.value = "";
    } else if (existingDraft.length > 12000) {
      // ChatGPT can restore a very large unsent production prompt after a
      // renderer/app restart. Selecting the entire ProseMirror document and
      // executing a delete transaction can monopolize (or wedge) the renderer
      // before Electron has even acknowledged the workbench dispatch. Clear
      // the DOM in one operation and notify the editor instead; the normal
      // prompt replacement path below will verify the resulting draft.
      target.textContent = "";
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection?.removeAllRanges();
      selection?.addRange(range);
      // insertText with an empty string is a no-op in Chromium. Delete the
      // selected ProseMirror transaction explicitly, then notify React.
      if (typeof document.execCommand === "function") document.execCommand("delete", false);
      if (composerDraftText()) target.textContent = "";
    }
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    clearAutomationDraftMarker();
    return !composerDraftText();
  }

  function clearComposerAttachments() {
    const target = composer();
    const scope = target?.closest('[data-composer-surface]')
      || target?.closest("form")
      || target?.closest('[data-testid*="composer"]')
      || target?.parentElement;
    if (!scope) return 0;
    const removeButtons = [...new Set([
      ...scope.querySelectorAll('button[aria-label*="Remove attachment"]'),
      ...scope.querySelectorAll('button[aria-label*="移除附件"]'),
      ...scope.querySelectorAll('button[aria-label*="移除文件"]'),
      ...scope.querySelectorAll('[data-testid*="attachment"] button[aria-label*="Remove"]'),
      ...scope.querySelectorAll('[data-testid*="attachment"] button[aria-label*="移除"]')
    ])].filter((btn) => btn.offsetParent !== null);
    removeButtons.forEach((btn) => {
      try { btn.click(); } catch {}
    });
    return removeButtons.length;
  }

  function forceClearComposer() {
    const activeRequestId = String(state.activeTask?.entry?.externalRequestId || "");
    state.internalComposerMutationUntil = Date.now() + 5_000;
    state.internalComposerMutationRequestId = activeRequestId;
    let cleared = 0;
    try { cleared = clearComposerAttachments(); } catch {}
    try { clearComposerDraft(); } catch {}
    return cleared;
  }

  function reportManualComposerClear() {
    const task = state.activeTask;
    const requestId = String(task?.entry?.externalRequestId || "");
    if (!task || !requestId || task.workflow?.planSubmitted === true
      || task.stopRequested === true || state.composerClearReportedRequestId === requestId) return;
    task.userClearedComposer = true;
    task.stopRequested = true;
    state.composerClearReportedRequestId = requestId;
    state.boundaryPaused = true;
    state.boundaryErrorCode = "USER_CLEARED_UNSENT_COMPOSER";
    state.boundaryErrorDetail = "检测到用户手动清空了尚未发送的素材和提示词；已暂停当前窗口，不自动回填";
    setStatus(state.boundaryErrorDetail, "danger");
    try { task.controller?.abort(); } catch {}
    renderQueue();
  }

  function installComposerClearObserver() {
    let lastAttachmentCount = 0;
    let lastDraft = "";
    let scheduled = false;
    const probe = () => {
      scheduled = false;
      const task = state.activeTask;
      const currentAttachmentCount = attachmentPreviewCount();
      const currentDraft = normalizeDraft(composerDraftText());
      if (currentAttachmentCount > 0 || currentDraft) state.observedAutomationComposerContent = true;
      const internalMutation = Date.now() < Number(state.internalComposerMutationUntil || 0)
        && (!state.internalComposerMutationRequestId
          || state.internalComposerMutationRequestId === String(task?.entry?.externalRequestId || ""));
      if (currentAttachmentCount > 0 || currentDraft) {
        state.internalComposerMutationUntil = 0;
        state.internalComposerMutationRequestId = "";
      }
      const unsentTask = task
        && task.workflow?.planSubmitted !== true
        && ["queued", "reading", "attaching"].includes(String(task.status || ""));
      const contentWasCleared = state.observedAutomationComposerContent
        && lastAttachmentCount + (lastDraft ? 1 : 0) > 0
        && currentAttachmentCount === 0
        && !currentDraft;
      if (!internalMutation && unsentTask && contentWasCleared) reportManualComposerClear();
      if (!task || task.workflow?.planSubmitted === true || task.status === "success") {
        state.observedAutomationComposerContent = false;
        state.composerClearReportedRequestId = "";
      }
      lastAttachmentCount = currentAttachmentCount;
      lastDraft = currentDraft;
    };
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(probe, 80);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    probe();
  }

  async function replaceComposerText(text, owner = null) {
    clearComposerDraft();
    setComposerText(text);
    const expected = String(text || "").trim();
    const expectedNormalized = normalizeDraft(expected);
    const composerMatchesExpected = () => {
      const currentNormalized = normalizeDraft(composerDraftText());
      return Boolean(expectedNormalized && currentNormalized
        && (currentNormalized === expectedNormalized
          || currentNormalized.includes(expectedNormalized)
          || expectedNormalized.includes(currentNormalized)));
    };
    // ProseMirror/React applies the input transaction on the next microtask.
    // Checking synchronously made a valid prompt look missing and stopped the
    // task after attachments had already been uploaded.  Wait briefly for the
    // DOM-backed composer value to settle before declaring a boundary error.
    let applied = !expected || await waitFor(composerMatchesExpected, 15_000);
    if (!applied && expected) {
      // ProseMirror may ignore the first synthetic transaction while the GPT
      // page is restoring focus. Re-apply once before treating this as a
      // boundary failure; never continue with attachments and no prompt.
      setComposerText(expected);
      applied = await waitFor(composerMatchesExpected, 15_000);
    }
    if (!applied) {
      throw productionBoundaryError("COMPOSER_DRAFT_NOT_SET", "GPT 输入框没有接收到本轮提示词，已停止发送，避免只上传附件或把下一轮混入当前帖");
    }
    rememberAutomationDraft(expected, owner);
    return true;
  }

  function waitFor(check, timeout = 4000, signal = activeTaskSignal()) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        resolve(value);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        reject(taskAbortError());
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const tick = () => {
        if (signal?.aborted) return onAbort();
        const value = check();
        if (value || Date.now() - started > timeout) return finish(value || null);
        timer = setTimeout(tick, 90);
      };
      tick();
    });
  }

  async function findFileInput() {
    const locate = () => document.querySelector('#upload-files:not(:disabled)')
      || document.querySelector('input[data-testid="upload-files-input"]:not(:disabled)');
    const existing = locate();
    if (existing) return existing;
    const attachmentButton = [...document.querySelectorAll("button")].find((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""}`;
      return /attach|add (?:photos|files)|upload|附件|添加文件|上传/i.test(label) && !button.disabled;
    });
    attachmentButton?.click();
    return waitFor(locate, 2500);
  }

  function attachmentPreviewCount() {
    const target = composer();
    // Narrow scope to the composer surface only — searching the entire form
    // picks up unrelated elements that appear after a DataTransfer assignment
    // but are not real attachment previews (caused 35 false positives for 7 files).
    const scope = target?.closest('[data-composer-surface]')
      || target?.closest("form")
      || target?.parentElement
      || document;
    const searchRoot = scope || document;
    // Only count elements with data-testid attributes that explicitly identify
    // attachment tiles/previews AND are visible in the DOM.
    // Class-based matching was removed because ChatGPT creates intermediate
    // elements during upload that match class patterns but aren't real previews.
    const previews = new Set();
    const removeButtons = new Set();
    const matchedDetails = [];
    for (const el of searchRoot.querySelectorAll('[data-testid*="attachment-tile"], [data-testid*="file-tile"], [data-testid*="attachment-preview"]')) {
      if (el.offsetParent !== null || el.getClientRects().length > 0) {
        previews.add(el);
        matchedDetails.push({ src: "testid", testid: el.getAttribute("data-testid"), tag: el.tagName, cls: String(el.className || "").slice(0, 60) });
      }
    }
    // ChatGPT's new composer uses Tailwind group/file-tile class for attachment
    // tiles without data-testid attributes. This selector is specific enough to
    // avoid the false positives that plagued broader class-based matching.
    for (const el of searchRoot.querySelectorAll('[class*="group/file-tile"]')) {
      if (el.offsetParent !== null || el.getClientRects().length > 0) {
        previews.add(el);
        matchedDetails.push({ src: "class-file-tile", tag: el.tagName, cls: String(el.className || "").slice(0, 60) });
      }
    }
    for (const el of searchRoot.querySelectorAll('button[aria-label*="Remove attachment"], button[aria-label*="移除附件"], button[aria-label*="移除文件"], button[aria-label*="Remove file"]')) {
      if (el.offsetParent !== null || el.getClientRects().length > 0) {
        removeButtons.add(el);
        matchedDetails.push({ src: "aria", aria: el.getAttribute("aria-label"), tag: el.tagName });
      }
    }
    // A remove button lives inside each attachment tile. Counting the union of
    // tiles and their buttons doubled every real upload (9 files appeared as
    // 18) and could trigger another upload attempt. Prefer the one-button-per-
    // attachment signal; only fall back to visible tiles when those buttons
    // are absent in a future ChatGPT layout.
    const count = removeButtons.size || previews.size;
    // Diagnostic: log when count > 0 to help identify false positives
    if (count > 0) {
      console.log("[TB attachmentPreviewCount]", { count, tileCount: previews.size, removeButtonCount: removeButtons.size, details: matchedDetails.slice(0, 8) });
    }
    return count;
  }

  function normalizeLocalAttachmentPath(value = "") {
    return String(value || "").trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  }

  function composerDraftText() {
    const target = composer();
    if (!target) return "";
    return String(target.value ?? target.innerText ?? target.textContent ?? "").trim();
  }

  // Mark drafts inserted by this extension so a restart/submit race does not
  // get mistaken for a user's unrelated unsent text.
  const AUTOMATION_DRAFT_KEY = "tb-gpt-automation-draft-v1";
  function normalizeDraft(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  function rememberAutomationDraft(text, owner = null) {
    const normalized = normalizeDraft(text);
    try {
      if (!normalized) sessionStorage.removeItem(AUTOMATION_DRAFT_KEY);
      else sessionStorage.setItem(AUTOMATION_DRAFT_KEY, JSON.stringify({
        text: normalized,
        ownerId: String(owner?.id || ""),
        ownerName: String(owner?.name || ""),
        at: Date.now()
      }));
    } catch (_) { /* sessionStorage can be unavailable in strict profiles */ }
  }
  function readAutomationDraft() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(AUTOMATION_DRAFT_KEY) || "null");
      if (!saved?.text) return null;
      if (Date.now() - Number(saved.at || 0) > 60 * 60 * 1000) {
        sessionStorage.removeItem(AUTOMATION_DRAFT_KEY);
        return null;
      }
      return saved;
    } catch (_) {
      return null;
    }
  }
  function clearAutomationDraftMarker() {
    try { sessionStorage.removeItem(AUTOMATION_DRAFT_KEY); } catch (_) { /* noop */ }
  }
  function isAutomationDraft(text, entry = null) {
    const current = normalizeDraft(text);
    if (!current) return false;
    const remembered = readAutomationDraft();
    const ownerMatches = Boolean(remembered && (!entry
      || (!remembered.ownerId && !remembered.ownerName)
      || (remembered.ownerId && remembered.ownerId === String(entry.id || ""))
      || (remembered.ownerName && remembered.ownerName === String(entry.name || ""))));
    if (ownerMatches) {
      const rememberedText = normalizeDraft(remembered.text);
      if (rememberedText && (current === rememberedText || current.includes(rememberedText) || rememberedText.includes(current))) return true;
    }
    // A failed send can happen after the DOM text was inserted but before the
    // sessionStorage marker is written.  The queue entry itself is the source
    // of truth then: a matching task prompt/material label is ours and may be
    // submitted.  Unrelated human drafts remain a hard boundary.
    const currentInstruction = entry
      ? normalizeDraft(entry.prompt || instruction(entry))
      : "";
    const materialLabel = entry ? String(entry.name || "").split(" × ").pop().trim() : "";
    return Boolean(entry?.externalRequestId && currentInstruction && (
      current.includes(normalizeDraft(currentInstruction.slice(0, 120)))
      || (materialLabel && current.includes(normalizeDraft(materialLabel.slice(0, 80))))
    ));
  }

  function looksLikeAutomationDraft(text = "") {
    const current = normalizeDraft(text);
    if (!current) return false;
    // A previous workbench task can leave its prompt in the ProseMirror
    // editor after a reload. Clear only our unmistakable workflow envelope;
    // arbitrary user text remains a hard queue boundary.
    return /(?:请按当前对话已经确定的母版和网页脚本处理这份团建内容|本地文件夹：|当前素材文件夹|本次附件全部是待迁移素材|请读取全部附件|继续使用当前 GPT 会话里已经沉淀好的母版环境|给我一份小红书文案)/.test(current);
  }

  function latestAutomationMaterialPrompt() {
    const turns = conversationRoleTurns();
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (conversationTurnRole(turn) !== "user") continue;
      const text = normalizeDraft(turn.innerText || turn.textContent || "");
      if (isAutomationMaterialPrompt(text)) return text;
    }
    return "";
  }

  function readArchivedAutomationBoundary() {
    try {
      const value = JSON.parse(localStorage.getItem(ARCHIVED_BOUNDARY_KEY) || "null");
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  function shouldPreserveAutomationDraftForAttachmentResume(input = {}) {
    return input.forceUpload === true
      && input.draftBelongsToTask === true
      && Number(input.attachmentCount || 0) <= 0
      && input.currentPlanTurnAlreadySent !== true;
  }

  function archivedAutomationLiveEvidence() {
    const turns = conversationRoleTurns();
    const latestUser = [...turns].reverse().find((turn) => conversationTurnRole(turn) === "user") || null;
    const latestAssistant = [...turns].reverse().find((turn) => conversationTurnRole(turn) === "assistant") || null;
    return {
      turnCount: turns.length,
      latestUserText: normalizeDraft(latestUser?.innerText || latestUser?.textContent || "").slice(-4000),
      latestAssistantText: cleanAssistantText(latestAssistant).slice(-4000)
    };
  }

  function archivedAutomationBoundaryMatchesLive(marker, materialText = "") {
    if (!isArchivedAutomationBoundary({
      currentUrl: String(location.href || ""),
      materialText,
      marker
    })) return false;
    // Older markers only keyed by URL + material. They cannot distinguish a
    // later retry of the same material, so they are intentionally rechecked
    // against durable history instead of being trusted as a live boundary.
    const markerTurnCount = Number(marker?.turnCount || 0);
    if (!Number.isFinite(markerTurnCount) || markerTurnCount < 1) return false;
    const live = archivedAutomationLiveEvidence();
    return live.turnCount === markerTurnCount
      && normalizeDraft(live.latestUserText) === normalizeDraft(marker.latestUserText)
      && normalizeDraft(live.latestAssistantText) === normalizeDraft(marker.latestAssistantText);
  }

  function markArchivedAutomationBoundary(materialText = "") {
    const normalizedMaterial = normalizeDraft(materialText || latestAutomationMaterialPrompt());
    if (!normalizedMaterial) return;
    try {
      const live = archivedAutomationLiveEvidence();
      localStorage.setItem(ARCHIVED_BOUNDARY_KEY, JSON.stringify({
        conversationUrl: String(location.href || ""),
        materialText: normalizedMaterial,
        turnCount: live.turnCount,
        latestUserText: live.latestUserText,
        latestAssistantText: live.latestAssistantText,
        archivedAt: new Date().toISOString()
      }));
    } catch (_) { /* storage is best-effort; server history remains the second boundary */ }
  }

  async function reconcileArchivedAutomationBoundary(boundary) {
    if (!boundary?.materialText) return false;
    const activeStage = String(boundary.stage || "");
    const activeStages = new Set([
      "waiting-images",
      "images-ready",
      "waiting-copy",
      "completed-copy-pending-package",
      "generation-limit-or-script"
    ]);
    const history = await api("/api/gpt-production/history").catch(() => null);
    const matched = completedHistoryMatchesAutomationBoundary({
      currentUrl: String(location.href || ""),
      materialText: boundary.materialText,
      historyItems: Array.isArray(history?.items) ? history.items : [],
      // Rotation can hand one material to a successor account after a native
      // image failure. A validated package for that exact material releases
      // the abandoned partial boundary in every prior account conversation.
      allowCrossConversation: true
    });
    if (!matched) return false;
    // An active image/copy boundary may be a newer retry of the same material;
    // do not let an older package release it. The exact archived marker is the
    // safe exception: if its latest user/assistant evidence is still the live
    // evidence, only harmless DOM/turn wrappers changed after the archive.
    const marker = readArchivedAutomationBoundary();
    const live = archivedAutomationLiveEvidence();
    const markerEvidenceMatches = Boolean(marker
      && isArchivedAutomationBoundary({
        currentUrl: String(location.href || ""),
        materialText: boundary.materialText,
        marker
      })
      && normalizeDraft(live.latestUserText) === normalizeDraft(marker.latestUserText)
      && normalizeDraft(live.latestAssistantText) === normalizeDraft(marker.latestAssistantText));
    if ((activeStages.has(activeStage)
      || Boolean(String(boundary.copyText || "").trim())
      || (Array.isArray(boundary.imageUrls) && boundary.imageUrls.length > 0))
      && !markerEvidenceMatches) {
      return false;
    }
    markArchivedAutomationBoundary(boundary.materialText);
    return matched;
  }

  async function reconcileCurrentAutomationBoundaryFromHistory() {
    const boundary = currentAutomationBoundarySnapshot();
    if (!boundary) return false;
    return reconcileArchivedAutomationBoundary(boundary);
  }
  globalThis.TeambuildingGptReconcileArchivedBoundary = reconcileCurrentAutomationBoundaryFromHistory;

  function currentAutomationBoundarySnapshot() {
    const turns = conversationRoleTurns();
    let materialIndex = -1;
    let materialText = "";
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (conversationTurnRole(turn) !== "user") continue;
      const text = normalizeDraft(turn.innerText || turn.textContent || "");
      if (isAutomationMaterialPrompt(text)) {
        materialIndex = index;
        materialText = text;
        break;
      }
    }
    if (materialIndex < 0) return null;
    if (archivedAutomationBoundaryMatchesLive(readArchivedAutomationBoundary(), materialText)) return null;
    const after = turns.slice(materialIndex + 1);
    const userAfter = after
      .map((turn, index) => ({ turn, index }))
      .filter(({ turn }) => conversationTurnRole(turn) === "user");
    const copyRequest = userAfter.find(({ turn }) => /给我一份小红书文案|小红书文案/.test(normalizeDraft(turn.innerText || turn.textContent || "")));
    if (copyRequest) {
      const priorPlan = [...after.slice(0, copyRequest.index)].reverse().find((turn) => (
        conversationTurnRole(turn) === "assistant"
        && parsePlannedImageCount(cleanAssistantText(turn)) > 0
      ));
      const planText = priorPlan ? cleanAssistantText(priorPlan) : "";
      const expectedImageCount = parsePlannedImageCount(planText);
      // Keep image evidence scoped to the current material boundary. A
      // conversation can contain a perfectly valid copy request while the
      // current task's images are still missing; DOM stage alone is not enough
      // to skip wait-images. Role-based discovery may expose only one lazy
      // thumbnail, though, while the same generated turn already exposes the
      // complete semantic image set. Prefer that larger same-turn evidence;
      // never merge image URLs from older turns.
      const imageTurns = after.slice(0, copyRequest.index + 1)
        .filter((turn) => conversationTurnRole(turn) === "assistant");
      const latestImageTurn = [...imageTurns].reverse().find((turn) => {
        const wrapper = turn?.closest?.('[data-testid^="conversation-turn"]') || turn;
        return freshImageUrls([turn]).length > 0 || semanticGeneratedImageUrlsIn(wrapper).length > 0;
      });
      const roleBasedImageUrls = latestImageTurn ? freshImageUrls([latestImageTurn]) : [];
      const latestImageWrapper = latestImageTurn?.closest?.('[data-testid^="conversation-turn"]') || latestImageTurn;
      const confirmForCopy = [...userAfter.slice(0, copyRequest.index)]
        .reverse()
        .find(({ turn }) => /^1\s*$/.test(normalizeDraft(turn.innerText || turn.textContent || "")));
      const semanticImageUrls = uniqueGeneratedImageUrls([
        ...(latestImageWrapper ? semanticGeneratedImageUrlsIn(latestImageWrapper) : []),
        ...(confirmForCopy ? semanticGeneratedImageUrlsBetweenTurns(confirmForCopy.turn, copyRequest.turn) : [])
      ]);
      const imageUrls = preferCurrentBatchImageUrls(roleBasedImageUrls, semanticImageUrls);
      const laterAssistants = after.slice(copyRequest.index + 1)
        .filter((turn) => conversationTurnRole(turn) === "assistant");
      // A historical/renderer-recovery turn may append an old image prompt
      // after the copy has already been returned.  The last assistant turn is
      // therefore not necessarily the copy turn.  Keep the latest assistant
      // reply that actually satisfies the publish-copy protocol; later image
      // replies must never erase this durable copy boundary or send the task
      // back to image generation.
      const latestCopyTurn = [...laterAssistants].reverse().find((turn) => (
        isPublishCopyReady(cleanAssistantText(turn), 300)
      ));
      const latestCopy = latestCopyTurn ? cleanAssistantText(latestCopyTurn) : "";
      if (isPublishCopyReady(latestCopy, 300) && !generatingNow()) {
        return {
          stage: "completed-copy-pending-package",
          materialText,
          materialIndex,
          copyText: latestCopy,
          planText,
          expectedImageCount,
          imageUrls
        };
      }
      return {
        stage: "waiting-copy",
        materialText,
        materialIndex,
        copyText: "",
        planText,
        expectedImageCount,
        imageUrls
      };
    }
    const confirm = userAfter.find(({ turn }) => isConfirmUserTurnText(
      normalizeDraft(turn.innerText || turn.textContent || ""),
      { attachmentCount: turn.querySelectorAll?.("img").length || 0 }
    ));
    if (confirm) {
      const priorPlan = [...after.slice(0, confirm.index)].reverse().find((turn) => (
        conversationTurnRole(turn) === "assistant"
        && parsePlannedImageCount(cleanAssistantText(turn)) > 0
      ));
      const planText = priorPlan ? cleanAssistantText(priorPlan) : "";
      const expectedImageCount = parsePlannedImageCount(planText);
      const laterAssistants = after.slice(confirm.index + 1)
        .filter((turn) => conversationTurnRole(turn) === "assistant");
      const roleBasedImageUrls = freshImageUrls(laterAssistants);
      const latestSemanticImageTurn = [...laterAssistants].reverse().find((turn) => {
        const wrapper = turn?.closest?.('[data-testid^="conversation-turn"]') || turn;
        return semanticGeneratedImageUrlsIn(wrapper).length > 0;
      });
      const semanticImageUrls = latestSemanticImageTurn
        ? semanticGeneratedImageUrlsIn(latestSemanticImageTurn.closest?.('[data-testid^="conversation-turn"]') || latestSemanticImageTurn)
        : [];
      const boundarySemanticImageUrls = semanticGeneratedImageUrlsBetweenTurns(confirm.turn);
      const imageUrls = semanticImageUrls.length > roleBasedImageUrls.length
        ? uniqueGeneratedImageUrls([...semanticImageUrls, ...boundarySemanticImageUrls])
        : preferCurrentBatchImageUrls(roleBasedImageUrls, boundarySemanticImageUrls);
      const latestAssistant = laterAssistants.at(-1);
      const risk = generatedOutputRisk(latestAssistant);
      if (risk.hardFailure) return { stage: "generation-limit-or-script", materialText, materialIndex, imageUrls, risk };
      if (imageUrls.length) {
        const evidence = generatedImageCompletionEvidence(imageUrls);
        return {
          stage: evidence?.responseComplete ? "images-ready" : "waiting-images",
          materialText,
          materialIndex,
          planText,
          expectedImageCount,
          imageUrls,
          evidence
        };
      }
      return { stage: "waiting-images", materialText, materialIndex, planText, expectedImageCount, imageUrls: [] };
    }
    const latestPlan = [...after].reverse().find((turn) => {
      if (conversationTurnRole(turn) !== "assistant") return false;
      const text = cleanAssistantText(turn);
      return text.length >= 80 && /迁移计划|逐页|P\s*1|第\s*1\s*页/i.test(text);
    });
    if (latestPlan) return { stage: "plan-ready", materialText, materialIndex, planText: cleanAssistantText(latestPlan) };
    return { stage: "waiting-plan", materialText, materialIndex };
  }

  function patrolConversationLinks() {
    const seen = new Map();
    for (const anchor of document.querySelectorAll('a[href^="/c/"], a[href*="chatgpt.com/c/"]')) {
      const rawHref = String(anchor.getAttribute("href") || "").trim();
      let url = "";
      try { url = new URL(rawHref, location.origin).href.split(/[?#]/)[0]; } catch { continue; }
      if (!/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/c\//i.test(url)) continue;
      const title = String(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || anchor.innerText || anchor.textContent || "")
        .replace(/\s+/g, " ").trim();
      if (!title || seen.has(url)) continue;
      seen.set(url, {
        title,
        url,
        current: anchor.getAttribute("aria-current") === "page" || url === String(location.href || "").split(/[?#]/)[0]
      });
    }
    return [...seen.values()];
  }

  function patrolSidebarScrollContainers() {
    const containers = new Set();
    for (const anchor of document.querySelectorAll('a[href^="/c/"], a[href*="chatgpt.com/c/"]')) {
      let node = anchor.parentElement;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (/(?:auto|scroll)/.test(`${style.overflowY} ${style.overflow}`) && node.scrollHeight > node.clientHeight + 8) {
          containers.add(node);
          break;
        }
        node = node.parentElement;
      }
    }
    return [...containers];
  }

  async function discoverPatrolConversations(options = {}) {
    const denylist = Array.isArray(options.denylist) ? options.denylist : [];
    const maximumScrolls = Math.max(0, Math.min(40, Number(options.maximumScrolls ?? 16)));
    const settleMs = Math.max(100, Math.min(1500, Number(options.settleMs ?? 350)));
    const found = new Map();
    const remember = () => patrolConversationLinks().forEach((item) => found.set(item.url, item));
    remember();
    const containers = patrolSidebarScrollContainers();
    const originalPositions = containers.map((node) => ({ node, top: node.scrollTop }));
    let scrollPasses = 0;
    try {
      for (; scrollPasses < maximumScrolls; scrollPasses += 1) {
        const before = found.size;
        let moved = false;
        for (const node of containers) {
          const next = Math.min(node.scrollHeight, node.scrollTop + Math.max(node.clientHeight * 0.85, 320));
          if (next > node.scrollTop + 2) {
            node.scrollTop = next;
            node.dispatchEvent(new Event("scroll", { bubbles: true }));
            moved = true;
          }
        }
        if (!moved) break;
        await new Promise((resolve) => setTimeout(resolve, settleMs));
        remember();
        const allAtBottom = containers.every((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 8);
        if (allAtBottom && found.size === before) break;
      }
    } finally {
      originalPositions.forEach(({ node, top }) => {
        node.scrollTop = top;
        node.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
    }
    // The extension-ready marker is installed before ChatGPT has restored a
    // long conversation after desktop restart. Do not classify an empty DOM
    // as "awaiting material"; wait for the real conversation turns first.
    if (/\/c\//.test(String(location.pathname || "")) && conversationRoleTurns().length === 0) {
      const turnDeadline = Date.now() + 20_000;
      while (Date.now() < turnDeadline && conversationRoleTurns().length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    const latestRestoredAssistant = [...conversationRoleTurns()].reverse()
      .find((turn) => conversationTurnRole(turn) === "assistant") || null;
    if (/Worked for|已完成|处理完成/i.test(String(latestRestoredAssistant?.innerText || ""))
      && latestRestoredAssistant?.querySelectorAll?.("img")?.length === 0) {
      const imageHydrationDeadline = Date.now() + 20_000;
      while (Date.now() < imageHydrationDeadline
        && latestRestoredAssistant.isConnected
        && latestRestoredAssistant.querySelectorAll("img").length === 0
        && latestRestoredAssistant.querySelectorAll(".cgpt-conversation-tree-image-download-all").length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    const currentState = conversationStateSnapshot();
    const conversations = [...found.values()].map((item) => ({
      ...classifyPatrolConversationCandidate({ ...item, denylist }),
      current: item.current,
      currentState: item.current ? currentState : null
    }));
    return {
      readOnly: true,
      scannedAt: new Date().toISOString(),
      scrollPasses,
      discoveredCount: conversations.length,
      templateCount: conversations.filter((item) => item.titleMatched).length,
      eligibleCount: conversations.filter((item) => item.eligible).length,
      conversations
    };
  }
  globalThis.TeambuildingGptPatrolDiscover = discoverPatrolConversations;

  // A small, side-effect-free state probe shared by the workbench scheduler
  // and the visible production log. It deliberately reports evidence instead
  // of guessing a next action: the queue may only advance when the caller has
  // a matching material turn and the current stage is complete.
  function conversationStateSnapshot() {
    const turns = conversationRoleTurns();
    const assistantTurns = turns.filter((turn) => conversationTurnRole(turn) === "assistant");
    const latestAssistant = assistantTurns.at(-1) || null;
    const latestAssistantText = latestAssistant ? cleanAssistantText(latestAssistant) : "";
    const latestImageAssistant = [...assistantTurns].reverse()
      .find((turn) => freshImageUrls([turn]).length > 0) || null;
    const latestHistoricalImages = latestImageAssistant ? freshImageUrls([latestImageAssistant]) : [];
    // Image-generation turns may be rendered as a semantic conversation-turn
    // without data-message-author-role after a reload. Keep the latest such
    // batch as the fallback for a following publish-copy reply; never scan all
    // generated images across the long conversation as one mixed batch.
    const latestGeneratedTurn = [...document.querySelectorAll('[data-testid^="conversation-turn"]')]
      .filter((turn) => semanticGeneratedImageUrlsIn(turn).length > 0).at(-1) || null;
    const latestSemanticBatchImages = latestHistoricalImages.length
      ? latestHistoricalImages
      : latestGeneratedTurn ? semanticGeneratedImageUrlsIn(latestGeneratedTurn) : [];
    const boundary = currentAutomationBoundarySnapshot();
    const currentLink = patrolConversationLinks().find((item) => item.current);
    const conversationLabel = String(currentLink?.title || document.title || "")
      .replace(/\s+-\s+ChatGPT\s*$/i, "").trim();
    const latestAssistantImages = latestAssistant ? freshImageUrls([latestAssistant]) : [];
    const historicalImagesBelongToCopy = Boolean(!boundary
      && latestSemanticBatchImages.length
      && latestImageAssistant !== latestAssistant
      && isPublishCopyReady(latestAssistantText, 300));
    const latestAssistantAfterImage = Boolean(
      latestAssistant
      && latestImageAssistant
      && latestAssistant !== latestImageAssistant
    );
    const latestAssistantHasCopy = Boolean(
      latestAssistantText
      && isPublishCopyReady(latestAssistantText, 300)
    );
    const liveCopyReplyBoundary = Boolean(
      boundary
      && ["images-ready", "waiting-images", "waiting-copy", "completed-copy-pending-package"].includes(String(boundary.stage || ""))
      && latestAssistantAfterImage
      && latestAssistantHasCopy
      && !generatingNow()
      && !/当前(?:实际)?只完成了\s*\d+\s*\/\s*\d+\s*张|请从缺少的页面|重新生成(?:到|完整)/iu.test(latestAssistantText)
    );
    // A reload can leave the durable boundary at images-ready even though the
    // same conversation has already returned the complete copy afterward.
    // Treat that ordered, evidence-backed reply as the copy boundary so the
    // worker packages it instead of sending the copy prompt again.
    const completedCopyBoundary = shouldAdoptCompletedCopyBoundary({
      boundaryStage: boundary?.stage,
      latestAssistantAfterImage,
      latestAssistantHasCopy,
      imageEvidenceCount: boundary?.imageUrls?.length || latestSemanticBatchImages.length,
      imageUrls: boundary?.imageUrls || latestSemanticBatchImages,
      expectedImageCount: boundary?.expectedImageCount || parsePlannedImageCount(boundary?.planText || latestAssistantText),
      generating: Boolean(generatingNow())
    });
    const observedLatestImages = boundary?.imageUrls?.length
      ? boundary.imageUrls
      : latestAssistantImages.length
        ? latestAssistantImages
        : historicalImagesBelongToCopy ? latestSemanticBatchImages : [];
    const copyText = String(
      boundary?.copyText
      || (completedCopyBoundary || liveCopyReplyBoundary || historicalImagesBelongToCopy ? latestAssistantText : "")
    ).trim();
    const hasCopy = Boolean(copyText && isPublishCopyReady(copyText, 300));
    const hasPlan = Boolean(boundary?.stage === "plan-ready" || /\u8fc1\u79fb\u8ba1\u5212|\u9010\u9875|\bP\s*1\b/i.test(latestAssistantText));
    const waitingForConfirm = Boolean(boundary?.stage === "plan-ready"
      || /(?:\u56de\u590d|\u8f93\u5165|reply|respond)[^\n]{0,18}\b1\b/i.test(latestAssistantText));
    const risk = generatedOutputRisk(latestAssistant);
    const templateConversation = /\u6a21\u677f|\u6bcd\u7248/i.test(conversationLabel) && !/\u6e38\u620f/i.test(conversationLabel);
    const currentUrl = String(location.href || "").split(/[?#]/)[0];
    const patrolLedgerKey = patrolActionLedgerKey({ conversationUrl: currentUrl, materialText: boundary?.materialText || "" });
    const patrolRecord = readPatrolActionLedger()[patrolLedgerKey] || {};
    const archivedByPatrol = !boundary
      && hasDurablePatrolPackageEvidence({
        archivePath: patrolRecord.archivePath,
        packagePath: patrolRecord.packagePath,
        downloadedImages: patrolRecord.downloadedImages,
        expectedImageCount: patrolRecord.expectedImageCount,
        copyText: patrolRecord.copyText
      });
    const archivedByAutomation = !boundary && archivedAutomationBoundaryMatchesLive(
      readArchivedAutomationBoundary(),
      latestAutomationMaterialPrompt()
    );
    const expectedImageCount = Math.max(
      0,
      Number(boundary?.expectedImageCount || 0),
      parsePlannedImageCount(boundary?.planText || latestAssistantText)
    );
    const stableImageEvidenceKey = boundary?.materialText
      ? `${patrolLedgerKey}::image-evidence`
      : "";
    let latestImages = observedLatestImages;
    if (stableImageEvidenceKey) {
      const previousImages = liveImageEvidenceCache.get(stableImageEvidenceKey) || [];
      latestImages = uniqueGeneratedImageUrls([...previousImages, ...observedLatestImages]);
      // Keep this cache bounded to a single normal production batch. The
      // material-scoped key prevents a later post from inheriting old images.
      latestImages = latestImages.slice(0, Math.max(10, expectedImageCount || 10));
      if (latestImages.length) liveImageEvidenceCache.set(stableImageEvidenceKey, latestImages);
    }
    const generated = latestImages.length > 0;
    const effectiveBoundaryStage = completedCopyBoundary
      ? "completed-copy-pending-package"
      : boundary?.stage;
    const copyEvidenceWins = !generatingNow() && Boolean(
      hasCopy
      && (completedCopyBoundary || liveCopyReplyBoundary || historicalImagesBelongToCopy || boundary?.copyText)
    );
    const stage = (archivedByPatrol || archivedByAutomation) ? "archived" : copyEvidenceWins
      ? "completed-copy-pending-package"
      : effectiveBoundaryStage
        || (hasCopy ? "completed-copy-pending-package" : waitingForConfirm ? "plan-ready" : generated ? "images-ready" : "unknown");
    const patrolState = classifyPatrolStage({
      stage,
      hasMaterialBoundary: Boolean(boundary),
      imageCount: latestImages.length,
      expectedImageCount,
      generating: Boolean(generatingNow()),
      hasCopy
    });
    const evidenceDiagnostic = {
      turnCount: turns.length,
      roles: turns.slice(-6).map((turn) => conversationTurnRole(turn)),
      boundaryStage: String(boundary?.stage || ""),
      latestAssistantCandidateImages: latestAssistant ? freshImageUrls([latestAssistant]).length : 0,
      latestAssistantDomImages: latestAssistant?.querySelectorAll?.("img")?.length || 0,
      latestAssistantBatchButtons: latestAssistant?.querySelectorAll?.(".cgpt-conversation-tree-image-download-all")?.length || 0
      ,latestSemanticBatchImages: latestSemanticBatchImages.length
    };
    return {
      stage,
      patrolState,
      conversationLabel,
      templateConversation,
      materialText: String(boundary?.materialText || latestAutomationMaterialPrompt() || ""),
      latestAssistantText,
      latestImageUrls: latestImages,
      copyText,
      latestImageCount: latestImages.length,
      expectedImageCount,
      hasPlan,
      waitingForConfirm,
      generated,
      hasCopy,
      scriptOutput: Boolean(risk.scriptOutput),
      scriptOutputLimitSignal: Boolean(risk.scriptOutputLimitSignal),
      limitSignal: Boolean(risk.hasRetrySignal),
      pyScriptFallbackSignal: Boolean(risk.pyScriptFallbackSignal),
      lowImageLimit: Boolean(risk.lowImageLimit),
      canInjectNext: stage === "archived" || (stage === "unknown" && !generated && !waitingForConfirm),
      patrolLedgerKey,
      evidenceDiagnostic
    };
  }
  globalThis.TeambuildingGptConversationStateSnapshot = conversationStateSnapshot;

  function readPatrolActionLedger() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PATROL_ACTION_LEDGER_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writePatrolActionLedger(ledger) {
    try { localStorage.setItem(PATROL_ACTION_LEDGER_KEY, JSON.stringify(ledger || {})); } catch { /* private mode */ }
  }

  async function reportPatrolPackageCompletion(packageTask, details = {}) {
    const packagePath = String(details.packagePath || "").trim();
    const downloadedImages = Math.max(0, Number(details.downloadedImages || 0));
    const copyTextLength = String(details.copyText || "").trim().length;
    const archivePath = String(details.archivePath || "").trim();
    const productionRequestId = String(packageTask?.entry?.externalRequestId || "").trim();
    const downloadedFiles = Array.isArray(details.downloadedFiles) ? details.downloadedFiles.filter(Boolean) : [];
    if (productionRequestId && packagePath) {
      const saved = await api(`/api/gpt-production/checkpoint?requestId=${encodeURIComponent(productionRequestId)}`).catch(() => null);
      await api("/api/gpt-production/checkpoint", {
        method: "POST",
        body: JSON.stringify({
          requestId: productionRequestId,
          checkpoint: {
            ...(saved?.checkpoint || {}),
            stage: "作品归档完成",
            percent: 100,
            plannedImageCount: Math.max(downloadedImages, Number(packageTask?.workflow?.plannedImageCount || 0)),
            generatedImageUrls: packageTask?.workflow?.generatedImageUrls || saved?.checkpoint?.generatedImageUrls || [],
            downloadedFiles,
            downloadRoot: String(details.downloadRoot || packageTask?.entry?.autoOptions?.downloadRoot || ""),
            copyText: String(details.copyText || ""),
            packagePath
          }
        })
      }).catch(() => null);
    }
    reportWorkbenchProgress(
      packageTask,
      "作品归档完成",
      100,
      packagePath ? `巡检续接作品已核对并保存到 ${packagePath}` : "巡检续接作品已完成",
      "completed"
    );
    reportWorkbenchTask(packageTask, "success", "巡检续接作品已完成下载、打包和素材归档", {
      taskType: "material",
      downloadedImages,
      plannedImageCount: Math.max(downloadedImages, Number(packageTask?.workflow?.plannedImageCount || 0)),
      batchId: String(details.batchId || packageTask?.workflow?.batchId || ""),
      packagePath,
      packageValid: Boolean(packagePath),
      downloadRoot: String(details.downloadRoot || packageTask?.entry?.autoOptions?.downloadRoot || ""),
      copyTextLength,
      archivePath,
      conversationUrl: String(details.conversationUrl || location.href)
    });
  }

  async function hydrateCurrentCopyBoundaryImageUrls(expectedImageCount = 0, snapshot = {}, seedUrls = []) {
    const expected = Math.max(0, Number(expectedImageCount || 0));
    let best = uniqueGeneratedImageUrls(seedUrls);
    if (!expected || best.length >= expected || !isPublishCopyReady(snapshot?.copyText || snapshot?.latestAssistantText, 300)) {
      return best;
    }
    const scrollHosts = [...document.querySelectorAll("*")].filter((node) => (
      node instanceof HTMLElement
      && node.clientHeight > 200
      && node.scrollHeight > node.clientHeight + 200
    ));
    if (!scrollHosts.length) return best;
    const originalPositions = scrollHosts.map((node) => node.scrollTop);
    const maximumScroll = Math.max(...scrollHosts.map((node) => node.scrollHeight));
    const seedIdentities = new Set(best.map(generatedImageIdentity).filter(Boolean));
    const seedImage = [...document.querySelectorAll('img')].find((image) => (
      seedIdentities.has(generatedImageIdentity(image.currentSrc || image.src || ""))
    ));
    const seedTurnKey = seedImage
      ?.closest?.('[data-testid^="conversation-turn"]')
      ?.getAttribute?.("data-testid") || "";
    if (!seedTurnKey) return best;
    try {
      for (let offset = 0; offset <= maximumScroll; offset += 800) {
        scrollHosts.forEach((node) => { node.scrollTop = offset; });
        await new Promise((resolve) => setTimeout(resolve, 140));
        // ChatGPT can keep duplicate virtualized wrappers with the same turn
        // key. Querying the first wrapper can therefore see an empty shell.
        // Collect only images whose closest live turn is the seed turn.
        const directUrls = [...document.querySelectorAll("img")]
          .filter((image) => image
            .closest?.('[data-testid^="conversation-turn"]')
            ?.getAttribute?.("data-testid") === seedTurnKey)
          .map((image) => image.currentSrc || image.src || "");
        const scopedUrls = uniqueGeneratedImageUrls([...best, ...directUrls]);
        if (scopedUrls.length > best.length) best = scopedUrls;
        if (best.length >= expected) break;
      }
    } finally {
      scrollHosts.forEach((node, index) => { node.scrollTop = originalPositions[index] || 0; });
    }
    return best;
  }
  globalThis.TeambuildingGptHydrateCurrentCopyImages = hydrateCurrentCopyBoundaryImageUrls;

  async function executePatrolSingleStep(options = {}) {
    const currentUrl = String(location.href || "").split(/[?#]/)[0];
    const targetUrl = String(options.targetUrl || currentUrl).split(/[?#]/)[0];
    if (!/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/c\//i.test(currentUrl) || currentUrl !== targetUrl) {
      return { ok: false, acted: false, reason: "target-conversation-not-current", currentUrl, targetUrl };
    }

    // Electron considers the page loaded before ChatGPT has restored the
    // conversation title and semantic turns. Acting against that short empty
    // window produces a harmless but confusing "production-title-required"
    // result, so continuation waits for the real conversation boundary too.
    if (conversationRoleTurns().length === 0) {
      const restoreDeadline = Date.now() + 20_000;
      while (Date.now() < restoreDeadline && conversationRoleTurns().length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    let snapshot = conversationStateSnapshot();
    const candidate = classifyPatrolConversationCandidate({
      title: snapshot.conversationLabel,
      url: currentUrl,
      denylist: Array.isArray(options.denylist) ? options.denylist : []
    });
    // After a renderer reload ChatGPT may expose only one lazy thumbnail in
    // the live DOM even though the workbench checkpoint already recorded the
    // complete same-material batch. Use only the scoped durable URLs supplied
    // by the workbench; never merge images from another conversation or older
    // turns. This lets the normal idempotent download/archive step finish.
    const durableImageUrls = uniqueGeneratedImageUrls(
      Array.isArray(options.durableImageUrls) ? options.durableImageUrls : []
    );
    const durableImageCount = Math.max(
      durableImageUrls.length,
      Number(options.durableImageCount || 0)
    );
    const copyBoundaryStage = ["images-ready", "waiting-images", "waiting-copy", "completed-copy-pending-package"]
      .includes(String(snapshot.stage || ""));
    const durableCopyBoundary = Boolean(
      copyBoundaryStage
      && snapshot.hasCopy === true
      && durableImageUrls.length > Number(snapshot.latestImageCount || 0)
      && durableImageCount >= Math.max(1, Number(snapshot.expectedImageCount || 0))
    );
    if (durableCopyBoundary) {
      const imageCount = Math.max(durableImageUrls.length, durableImageCount);
      snapshot = {
        ...snapshot,
        latestImageUrls: durableImageUrls,
        latestImageCount: imageCount,
        expectedImageCount: Math.max(Number(snapshot.expectedImageCount || 0), imageCount),
        generated: true,
        evidenceDiagnostic: {
          ...(snapshot.evidenceDiagnostic || {}),
          durableImageEvidence: imageCount
        }
      };
    }
    const copyMaterialIdentity = patrolMaterialCopyIdentity({
      materialName: options.materialName || "",
      sourceMaterialPath: options.sourceMaterialPath || "",
      materialText: snapshot.materialText,
      copyText: snapshot.copyText
    });
    if (copyMaterialIdentity.required && !copyMaterialIdentity.matched) {
      // A stale conversation can contain a perfectly valid copy and image
      // batch for another material.  Do not let that old boundary satisfy the
      // current queue item or create a wrong archive package.
      snapshot = {
        ...snapshot,
        stage: "waiting-copy",
        hasCopy: false,
        copyText: "",
        patrolState: classifyPatrolStage({
          stage: "waiting-copy",
          hasMaterialBoundary: true,
          imageCount: Number(snapshot.latestImageCount || 0),
          expectedImageCount: Number(snapshot.expectedImageCount || 0),
          generating: Boolean(generatingNow()),
          hasCopy: false
        }),
        evidenceDiagnostic: {
          ...(snapshot.evidenceDiagnostic || {}),
          copyBoundaryResolution: "material-copy-identity-mismatch",
          copyBoundaryTokens: copyMaterialIdentity.tokens
        }
      };
    }
    // A renderer reload can leave the persisted stage at waiting-images even
    // after the same material already received a complete copy reply. Protect
    // that boundary from the partial-image recovery branch. A complete image
    // count proceeds to package; an incomplete/uncertain count remains
    // read-only until a later evidence probe reconciles it.
    const copyBoundaryResolution = resolvePatrolCopyBoundary({
      stage: snapshot.stage,
      hasCopy: snapshot.hasCopy,
      copyText: snapshot.copyText,
      imageCount: snapshot.latestImageCount,
      expectedImageCount: snapshot.expectedImageCount,
      generating: Boolean(generatingNow())
    });
    const copyPhaseProtection = shouldProtectCopyBoundaryFromImageRecovery({
      stage: snapshot.stage,
      hasCopy: snapshot.hasCopy,
      copyText: snapshot.copyText
    });
    if (copyMaterialIdentity.required && !copyMaterialIdentity.matched) {
      return {
        ok: true,
        acted: false,
        reason: "copy-boundary-material-mismatch",
        candidate,
        snapshot,
        generationRequestCount: 0,
        materialIdentity: copyMaterialIdentity
      };
    }
    if (copyBoundaryResolution.complete) {
      snapshot = {
        ...snapshot,
        stage: copyBoundaryResolution.stage,
        patrolState: classifyPatrolStage({
          stage: copyBoundaryResolution.stage,
          hasMaterialBoundary: true,
          imageCount: copyBoundaryResolution.imageCount,
          expectedImageCount: copyBoundaryResolution.expectedImageCount,
          generating: Boolean(generatingNow()),
          hasCopy: true
        }),
        evidenceDiagnostic: {
          ...(snapshot.evidenceDiagnostic || {}),
          copyBoundaryResolution: copyBoundaryResolution.reason
        }
      };
    } else if (copyBoundaryResolution.protected) {
      snapshot = {
        ...snapshot,
        stage: copyBoundaryResolution.stage,
        patrolState: classifyPatrolStage({
          stage: copyBoundaryResolution.stage,
          hasMaterialBoundary: true,
          imageCount: copyBoundaryResolution.imageCount,
          expectedImageCount: copyBoundaryResolution.expectedImageCount,
          generating: Boolean(generatingNow()),
          hasCopy: true
        }),
        evidenceDiagnostic: {
          ...(snapshot.evidenceDiagnostic || {}),
          copyBoundaryResolution: copyBoundaryResolution.reason
        }
      };
    }
    if (options.inspectOnly) {
      return { ok: true, acted: false, reason: "inspection-only", candidate, snapshot };
    }
    const ledger = readPatrolActionLedger();
    const ledgerKey = String(snapshot.patrolLedgerKey || currentUrl);
    const record = ledger[ledgerKey] && typeof ledger[ledgerKey] === "object" ? ledger[ledgerKey] : {};
    const generationRequestCount = Math.max(
      0,
      Number(record.generationRequestCount || 0),
      Number(options.generationRequestCount || 0)
    );
    const existingPackagePath = String(options.existingPackagePath || "").trim();
    const existingPackageImages = Math.max(0, Number(options.existingPackageImages || 0));
    const liveMaterialText = normalizeDraft(snapshot.materialText || latestAutomationMaterialPrompt());
    const sourceMaterialName = String(options.sourceMaterialPath || "")
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() || "";
    const existingPackageMatchesLiveBoundary = Boolean(
      options.allowExistingPackageRelease
      && existingPackagePath
      && sourceMaterialName.length >= 8
      && liveMaterialText
      && liveMaterialText.includes(normalizeDraft(sourceMaterialName))
      && snapshot.canInjectNext === false
      && !generatingNow()
      && ["images-ready", "waiting-images", "waiting-copy", "completed-copy-pending-package"].includes(String(snapshot.stage || ""))
    );
    if (existingPackageMatchesLiveBoundary) {
      // The durable production log has already proved this exact package.
      // Release only the matching live material boundary; do not download,
      // archive, or send anything again.
      markArchivedAutomationBoundary(liveMaterialText);
      return {
        ok: true,
        acted: false,
        reason: "already-packaged",
        action: "release-boundary",
        releaseBoundary: true,
        packagePath: existingPackagePath,
        downloadedImages: existingPackageImages,
        candidate,
        snapshot,
        generationRequestCount
      };
    }
    const durableLedgerPackage = hasDurablePatrolPackageEvidence({
      archivePath: record.archivePath,
      packagePath: record.packagePath,
      downloadedImages: record.downloadedImages,
      expectedImageCount: Math.max(
        Number(record.expectedImageCount || 0),
        Number(snapshot.expectedImageCount || 0)
      ),
      copyText: record.copyText || snapshot.copyText
    });
    const durableLedgerMatchesLiveBoundary = Boolean(
      options.allowExistingPackageRelease
      && durableLedgerPackage
      && sourceMaterialName.length >= 8
      && liveMaterialText
      && liveMaterialText.includes(normalizeDraft(sourceMaterialName))
      && snapshot.hasCopy === true
      && !generatingNow()
      && ["images-ready", "waiting-copy", "completed-copy-pending-package"].includes(String(snapshot.stage || ""))
    );
    if (durableLedgerMatchesLiveBoundary) {
      // Duplicate packages may have packagePath="".  The archive path,
      // complete image count and saved copy are enough to release this exact
      // material boundary without sending another image-recovery prompt.
      markArchivedAutomationBoundary(liveMaterialText);
      return {
        ok: true,
        acted: false,
        reason: "already-packaged",
        action: "release-boundary",
        releaseBoundary: true,
        packagePath: String(record.packagePath || ""),
        archivePath: String(record.archivePath || ""),
        downloadedImages: Number(record.downloadedImages || 0),
        candidate,
        snapshot,
        generationRequestCount
      };
    }
    if (record.packagePath && options.requestId) {
      // The durable package can outlive the renderer's current boundary
      // marker (for example after a restart). Replaying an idempotent package
      // checkpoint must also release this exact live conversation, otherwise
      // the next queue item is still rejected as "pending archive".
      markArchivedAutomationBoundary(String(snapshot.materialText || latestAutomationMaterialPrompt()));
      const replayImageCount = Math.max(0, Number(record.downloadedImages || snapshot.latestImageCount || 0));
      const replayTask = {
        status: "success",
        entry: {
          externalRequestId: String(options.requestId),
          name: String(options.materialName || snapshot.conversationLabel || "巡检续接作品"),
          materialPath: String(options.sourceMaterialPath || ""),
          autoOptions: { downloadRoot: String(options.downloadRoot || "") }
        },
        workflow: {
          batchId: String(record.batchId || ""),
          plannedImageCount: replayImageCount,
          generatedImageUrls: Array.from({ length: replayImageCount }, (_, index) => `replayed-${index + 1}`)
        }
      };
      await reportPatrolPackageCompletion(replayTask, {
        packagePath: record.packagePath,
        downloadedImages: replayImageCount,
        copyText: String(record.copyText || snapshot.latestAssistantText || ""),
        batchId: String(record.batchId || ""),
        downloadRoot: String(options.downloadRoot || ""),
        archivePath: String(record.archivePath || ""),
        conversationUrl: currentUrl
      });
      return {
        ok: true,
        acted: false,
        reason: "already-packaged",
        productionRequestId: String(options.requestId || ""),
        candidate,
        snapshot,
        generationRequestCount,
        packagePath: String(record.packagePath),
        downloadedImages: replayImageCount,
        copyTextLength: String(record.copyText || snapshot.latestAssistantText || "").trim().length
      };
    }
    const silentImageRetry = record.lastAction === "send-confirm"
      && snapshot.stage === "waiting-images"
      && Number(snapshot.latestImageCount || 0) === 0
      && !String(snapshot.latestAssistantText || "").trim()
      && !generatingNow()
      && Date.now() - Number(record.lastActionAt || 0) >= 60_000;
    const silentCopyRetry = record.lastAction === "request-copy"
      && snapshot.stage === "waiting-copy"
      && !isPublishCopyReady(snapshot.latestAssistantText, 300)
      && !generatingNow()
      && Date.now() - Number(record.lastActionAt || 0) >= 60_000;
    const copyRecovery = silentCopyRetry
      ? decidePatrolCopyRecovery({ attempts: Number(record.copyRecoveryAttempts || 0), maxAttempts: 2 })
      : { action: "none", nextAttempt: Number(record.copyRecoveryAttempts || 0) };
    if (silentCopyRetry && copyRecovery.action === "pause") {
      return {
        ok: false,
        acted: false,
        code: "COPY_INCOMPLETE",
        reason: "copy-recovery-exhausted",
        error: "文案连续两次恢复后仍不完整；当前对话已安全暂停，图片不会下载或归档",
        candidate,
        snapshot,
        generationRequestCount
      };
    }
    const patrolNarrationResult = detectCopyMetaNarration(snapshot.latestAssistantText);
    if (patrolNarrationResult.matched
      && record.copyMetaNarrationRewriteAttempted
      && !generatingNow()) {
      return {
        ok: false,
        acted: false,
        code: "COPY_META_NARRATION",
        reason: "copy-meta-narration-still-present",
        error: "文案自动纠正后仍含素材来源或制作过程旁白；当前对话已硬暂停，未保存、下载、打包或归档",
        candidate,
        snapshot,
        generationRequestCount
      };
    }
    const decision = decidePatrolSingleStep({
      candidate,
      patrolState: silentImageRetry
        ? { ...snapshot.patrolState, safeToAct: true, nextActionKey: "send-confirm" }
        : silentCopyRetry
          ? { ...snapshot.patrolState, safeToAct: true, nextActionKey: "request-copy" }
        : snapshot.patrolState,
      generating: Boolean(generatingNow()),
      composerReady: Boolean(composer()),
      composerEmpty: !normalizeDraft(composerDraftText()),
      generationRequestCount,
      maximumGenerationRequests: Number(options.maximumGenerationRequests || 5),
      allowUntitledRecovery: Boolean(options.allowUntitledRecovery),
      hasKnownMaterialOwner: Boolean(String(options.sourceMaterialPath || "").trim()),
      allowStaleComposerRecovery: Boolean(options.allowStaleComposerRecovery)
    });
    if (!decision.allowed) {
      return { ok: true, acted: false, reason: decision.reason, decision, candidate, snapshot, generationRequestCount };
    }
    if (record.lastAction === decision.action
      && record.lastStage === snapshot.stage
      && Date.now() - Number(record.lastActionAt || 0) < 60_000) {
      return { ok: true, acted: false, reason: "duplicate-action-guard", decision, candidate, snapshot, generationRequestCount };
    }

    if (decision.action === "download-and-package") {
      if (options.allowStaleComposerRecovery
        && (Boolean(normalizeDraft(composerDraftText())) || attachmentPreviewCount() > 0)) {
        // This is a verified, queue-owned completed work.  Clear only the
        // stale composer/attachments before packaging; never clear an
        // arbitrary draft during manual or uncertain patrol recovery.
        forceClearComposer();
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      const boundary = currentAutomationBoundarySnapshot();
      const copyText = String(boundary?.copyText || snapshot?.copyText || "").trim();
      const liveBoundaryImageUrls = uniqueGeneratedImageUrls(
        Array.isArray(boundary?.imageUrls) ? boundary.imageUrls : []
      );
      const hasLiveImageBoundary = Boolean(
        boundary
        && ["waiting-images", "images-ready", "waiting-copy", "completed-copy-pending-package"].includes(String(boundary.stage || ""))
        && liveBoundaryImageUrls.length
      );
      let imageUrls = liveBoundaryImageUrls.length
        ? liveBoundaryImageUrls
        : Array.isArray(snapshot?.latestImageUrls) ? snapshot.latestImageUrls : [];
      // A live material/confirm boundary is authoritative. Never merge an
      // older patrol ledger or checkpoint into it: that was the path that
      // turned a previous task's image count into a new "补图" prompt.
      if (!hasLiveImageBoundary) {
        imageUrls = preferredRecoveryImageUrls(imageUrls, record.generatedImageUrls || []);
      }
      let recoveryCheckpoint = null;
      if (options.requestId) {
        const saved = await api(`/api/gpt-production/checkpoint?requestId=${encodeURIComponent(options.requestId)}`).catch(() => null);
        recoveryCheckpoint = saved?.checkpoint || null;
        if (!hasLiveImageBoundary) {
          imageUrls = preferredRecoveryImageUrls(imageUrls, recoveryCheckpoint?.generatedImageUrls || []);
        }
      }
      const expectedRecoveryImages = Math.max(
        0,
        Number(options.expectedImageCount || 0),
        Number(record.expectedImageCount || 0),
        Number(snapshot?.expectedImageCount || 0),
        Number(recoveryCheckpoint?.plannedImageCount || 0),
        Number(recoveryCheckpoint?.detectedImageCount || 0)
      );
      if (expectedRecoveryImages
        && imageUrls.length < expectedRecoveryImages
        && (copyPhaseProtection.protected || copyBoundaryResolution.protected)) {
        imageUrls = await hydrateCurrentCopyBoundaryImageUrls(expectedRecoveryImages, snapshot, imageUrls);
      }
      if (expectedRecoveryImages && imageUrls.length < expectedRecoveryImages) {
        if (copyPhaseProtection.protected || copyBoundaryResolution.protected) {
          const detail = `文案边界已确认，但当前网页只显示 ${imageUrls.length}/${expectedRecoveryImages} 张图片；等待同一作品的图片证据恢复，禁止再次发起生图`;
          return {
            ok: false,
            acted: false,
            code: "COPY_IMAGE_HYDRATION_WAIT",
            recoveryReason: "completed-copy-awaiting-image-hydration",
            reason: "copy-boundary-image-evidence-incomplete",
            error: detail,
            decision,
            candidate,
            snapshot,
            generationRequestCount,
            detectedImages: imageUrls.length,
            expectedImages: expectedRecoveryImages
          };
        }
        if (!hasLiveImageBoundary) {
          return {
            ok: false,
            acted: false,
            code: "IMAGE_RECOVERY_BOUNDARY_MISSING",
            reason: "recovery-image-boundary-missing",
            error: "当前网页没有可确认的生图回复边界；已暂停巡检续接，未使用旧检查点补图或发送提示",
            decision,
            candidate,
            snapshot,
            generationRequestCount,
            detectedImages: imageUrls.length,
            expectedImages: expectedRecoveryImages
          };
        }
        const maximumRecoveryRequests = Math.max(1, Number(options.maximumGenerationRequests || 5));
        if (generationRequestCount >= maximumRecoveryRequests) {
          return {
            ok: false,
            acted: false,
            code: "IMAGE_RECOVERY_CAP_REACHED",
            reason: "recovery-image-set-incomplete",
            error: `当前只检测到 ${imageUrls.length}/${expectedRecoveryImages} 张图片，自动补齐次数已用尽；已暂停当前作品`,
            decision,
            candidate,
            snapshot,
            generationRequestCount,
            detectedImages: imageUrls.length,
            expectedImages: expectedRecoveryImages
          };
        }
        const recoveryPrompt = `当前只完成了 ${imageUrls.length}/${expectedRecoveryImages} 张独立图片。请严格按已经确认的 P1-P${expectedRecoveryImages} 计划，把完整批次重新生成到 ${expectedRecoveryImages} 张；不要重新输出计划，不要做合集总览，不要补单张混批。直接生成全部独立 3:4 成品图，完成后明确回复“出图完毕”。`;
        await replaceComposerText(recoveryPrompt);
        await submitComposer();
        clearComposerDraft();
        const nextGenerationRequestCount = generationRequestCount + 1;
        ledger[ledgerKey] = {
          ...record,
          generationRequestCount: nextGenerationRequestCount,
          lastAction: "regenerate-batch",
          lastStage: snapshot.stage,
          lastActionAt: Date.now(),
          expectedImageCount: expectedRecoveryImages,
          generatedImageUrls: imageUrls
        };
        writePatrolActionLedger(ledger);
        logConversationEvent("partial-image-recovery-sent", {
          requestId: String(options.requestId || ""),
          materialName: String(options.materialName || snapshot.conversationLabel || ""),
          step: "patrol/recover-images",
          sentText: recoveryPrompt,
          meta: { attempt: nextGenerationRequestCount, detected: imageUrls.length, expected: expectedRecoveryImages }
        });
        return {
          ok: true,
          acted: true,
          action: "regenerate-batch",
          reason: "recovery-images-requested",
          decision,
          candidate,
          snapshot,
          generationRequestCount: nextGenerationRequestCount,
          detectedImages: imageUrls.length,
          expectedImages: expectedRecoveryImages
        };
      }
      if (!isPublishCopyReady(copyText, 300)) {
        return { ok: true, acted: false, reason: "publish-copy-not-ready", decision, candidate, snapshot, generationRequestCount };
      }
      if (!imageUrls.length) {
        return { ok: true, acted: false, reason: "generated-images-not-ready", decision, candidate, snapshot, generationRequestCount };
      }
      const sourceMaterialPath = String(options.sourceMaterialPath || "").trim();
      const materialName = String(options.materialName || sourceMaterialPath.split(/[\\/]/).pop() || snapshot.conversationLabel || "巡检续接作品").trim();
      const batchId = workPackageBatchId();
      const downloadRoot = String(options.downloadRoot || "").trim();
      const packageTask = {
        status: "running",
        entry: {
          externalRequestId: String(options.requestId || `patrol-${batchId}`),
          name: materialName,
          materialPath: sourceMaterialPath,
          autoOptions: { downloadRoot }
        },
        workflow: {
          batchId,
          textSubmitted: true,
          plannedImageCount: expectedRecoveryImages || imageUrls.length,
          generatedImageUrls: imageUrls
        }
      };
      const downloadResult = await downloadFreshImages(imageUrls, packageTask);
      if (expectedRecoveryImages && Number(downloadResult?.count || 0) < expectedRecoveryImages) {
        return {
          ok: true,
          acted: false,
          reason: "downloaded-image-set-incomplete",
          decision,
          candidate,
          snapshot,
          generationRequestCount,
          downloadedImages: Number(downloadResult?.count || 0),
          expectedImages: expectedRecoveryImages
        };
      }
      const copyFile = await globalThis.TeambuildingGptProductionSaveCopyText({ copyText, batchId, downloadRoot });
      const packageResult = await packageDownloadedReply({
        clipboardText: copyText,
        title: materialName,
        conversationUrl: currentUrl,
        accountName: localStorage.getItem("tb-workbench-account-id") || "",
        sourceMaterialPath,
        batchId: downloadResult.batchId,
        expectedImageCount: expectedRecoveryImages || downloadResult.count,
        downloadRoot: String(downloadResult.files?.[0] || "").replace(/[\\/][^\\/]+$/, "") || downloadRoot,
        productRoot: String(options.productRoot || "").trim()
      });
      let archiveResult = null;
      // A duplicate package means the exact image set already exists in the
      // work library; it does not mean the source material was archived.
      // Always run the source archive boundary when an owner is known, even
      // when the packager returns packagePath="" for that duplicate.
      if (options.autoArchive !== false && sourceMaterialPath) {
        const archiveResponse = await api("/api/gpt-production/archive-material", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryPath: sourceMaterialPath,
            requestId: String(options.requestId || `patrol-${batchId}`),
            templateId: String(options.templateId || ""),
            conversationUrl: currentUrl,
            packagePath: String(packageResult?.packagePath || ""),
            expectedImageCount: expectedRecoveryImages || Number(downloadResult?.count || 0),
            downloadedImageCount: Number(downloadResult?.count || 0)
          })
        });
        if (!archiveResponse?.ok) throw new Error(archiveResponse?.error || "作品已生成，但素材归档失败");
        archiveResult = archiveResponse.archive || null;
        if (archiveResult?.skipped) {
          logConversationEvent("archive-source-skipped", {
            requestId: String(options.requestId || ""),
            materialName,
            step: "patrol-package/archive-source-skipped",
            meta: {
              reason: String(archiveResult.reason || "source-material-missing-or-already-archived"),
              sourceMaterialPath,
              packagePath: String(packageResult?.packagePath || "")
            }
          });
        }
      }
      markArchivedAutomationBoundary(String(
        boundary?.materialText || snapshot.materialText || latestAutomationMaterialPrompt()
      ));
      const archivePath = String(archiveResult?.to || "");
      ledger[ledgerKey] = {
        generationRequestCount,
        lastAction: decision.action,
        lastStage: snapshot.stage,
        lastActionAt: Date.now(),
        packagePath: String(packageResult?.packagePath || ""),
        batchId: String(downloadResult.batchId || batchId),
        downloadedImages: Number(downloadResult.count || 0),
        copyText,
        copyTextPath: String(copyFile?.filename || ""),
        archivePath
      };
      writePatrolActionLedger(ledger);
      logConversationEvent("text-saved", {
        requestId: String(options.requestId || ""),
        materialName,
        step: "patrol-package/save-text",
        copyTextPath: String(copyFile?.filename || ""),
        meta: { copyLength: copyText.length }
      });
      logConversationEvent("images-downloaded", {
        requestId: String(options.requestId || ""),
        materialName,
        step: "patrol-package/download-images",
        imageUrls,
        downloadedFiles: Array.isArray(downloadResult.files) ? downloadResult.files : [],
        meta: { count: Number(downloadResult.count || 0), downloadRoot }
      });
      logConversationEvent("archived", {
        requestId: String(options.requestId || ""),
        materialName,
        step: "patrol-package/archive",
        copyTextPath: String(copyFile?.filename || ""),
        packagePath: String(packageResult?.packagePath || ""),
        meta: {
          imageCount: Number(downloadResult.count || 0),
          batchId: downloadResult.batchId || batchId,
          duplicatePackage: Boolean(packageResult?.duplicate)
        }
      });
      await reportPatrolPackageCompletion(packageTask, {
        packagePath: String(packageResult?.packagePath || ""),
        downloadedImages: Number(downloadResult.count || 0),
        copyText,
        downloadedFiles: Array.isArray(downloadResult.files) ? downloadResult.files : [],
        batchId: String(downloadResult.batchId || batchId),
        downloadRoot,
        archivePath,
        conversationUrl: currentUrl
      });
      return {
        ok: true,
        acted: true,
        action: decision.action,
        reason: "completed",
        productionRequestId: String(options.requestId || ""),
        candidate,
        snapshot,
        generationRequestCount,
        downloadedImages: downloadResult.count,
        copyTextPath: String(copyFile?.filename || ""),
        packageResult,
        archiveResult
      };
    }

    const correctingMetaNarration = decision.action === "request-copy" && patrolNarrationResult.matched;
    const text = decision.action === "send-confirm"
      ? String(options.confirmText || "1").trim() || "1"
      : decision.action === "regenerate-batch"
        ? `当前只完成了 ${Number(snapshot.latestImageCount || 0)}/${Number(snapshot.expectedImageCount || 0)} 张，不能进入文案。请严格按已经确认的 P1-P${Number(snapshot.expectedImageCount || 10)} 计划，把全部图片作为一个完整批次重新生成；不要补单张，不要沿用刚才的不完整批次，不要重写计划。完成后必须一次得到 ${Number(snapshot.expectedImageCount || 10)} 张独立 3:4 成品图。`
      : silentCopyRetry
        ? `你刚才只返回了不完整的短文案“${String(snapshot.latestAssistantText || "").trim().slice(0, 80)}”。请从头重写并一次性输出完整、可直接发布的小红书文案。${normalizePublishCopyPrompt(options.copyPrompt || DEFAULT_PUBLISH_COPY_PROMPT)}`
      : correctingMetaNarration
        ? COPY_META_NARRATION_REWRITE_PROMPT
        : normalizePublishCopyPrompt(options.copyPrompt || DEFAULT_PUBLISH_COPY_PROMPT);
    await replaceComposerText(text);
    await submitComposer();
    clearComposerDraft();

    const nextGenerationRequestCount = generationRequestCount + (["send-confirm", "regenerate-batch"].includes(decision.action) ? 1 : 0);
    ledger[ledgerKey] = {
      ...record,
      generationRequestCount: nextGenerationRequestCount,
      lastAction: decision.action,
      lastStage: snapshot.stage,
      lastActionAt: Date.now(),
      copyRecoveryAttempts: decision.action === "request-copy"
        ? (silentCopyRetry ? Number(copyRecovery.nextAttempt || 0) : 0)
        : Number(record.copyRecoveryAttempts || 0),
      expectedImageCount: decision.action === "request-copy"
        ? Math.max(Number(record.expectedImageCount || 0), Number(snapshot.expectedImageCount || 0), Number(snapshot.latestImageCount || 0))
        : Number(record.expectedImageCount || 0),
      generatedImageUrls: decision.action === "request-copy"
        ? preferredRecoveryImageUrls(snapshot.latestImageUrls || [], record.generatedImageUrls || [])
        : (Array.isArray(record.generatedImageUrls) ? record.generatedImageUrls : []),
      copyMetaNarrationRewriteAttempted: Boolean(record.copyMetaNarrationRewriteAttempted || correctingMetaNarration)
    };
    writePatrolActionLedger(ledger);
    if (correctingMetaNarration) {
      logConversationEvent("copy-meta-narration-rewrite", {
        requestId: String(options.requestId || ""),
        step: "patrol/request-copy",
        sentText: text,
        receivedText: String(snapshot.latestAssistantText || ""),
        meta: { matches: patrolNarrationResult.matches }
      });
    }
    return {
      ok: true,
      acted: true,
      action: decision.action,
      reason: "completed",
      candidate,
      snapshot,
      generationRequestCount: nextGenerationRequestCount
    };
  }
  globalThis.TeambuildingGptPatrolContinue = executePatrolSingleStep;

  async function findPendingRemoteProduction() {
    // The append-only checkpoint can lag behind the browser boundary when a
    // duplicate package was previously short-circuited.  The live conversation
    // snapshot is authoritative here: an archived page is safe to receive the
    // next post even if an old history row still says "TXT saved".
    const liveConversation = conversationStateSnapshot();
    if (liveConversation?.stage === "archived" && liveConversation.canInjectNext === true) return null;
    const history = await api("/api/gpt-production/history").catch(() => null);
    const items = Array.isArray(history?.items) ? history.items : [];
    const currentUrl = String(location.href || "");
    return items.find((item) => String(item?.conversationUrl || "") === currentUrl
      && !String(item?.packagePath || "").trim()
      && Number(item?.downloadedImageCount || 0) > 0
      && !/作品打包完成|完成$/.test(String(item?.stage || ""))) || null;
  }

  function automationPromptMatchesEntry(promptText, entry) {
    const prompt = normalizeDraft(promptText);
    if (!prompt || !entry?.externalRequestId) return false;
    const expected = normalizeDraft(entry.prompt || instruction(entry));
    const materialName = String(entry.materialPath || entry.name || "").split(/[\\/]/).pop().trim();
    return Boolean((expected && (prompt === expected || prompt.includes(expected.slice(0, 120))))
      || (materialName && prompt.includes(normalizeDraft(materialName))));
  }

  function canonicalConversationUrl(value = "") {
    try {
      const parsed = new URL(String(value || "").trim());
      if (!/^chatgpt\.com$/i.test(parsed.hostname) || !/^\/c\/[a-z0-9-]+\/?$/i.test(parsed.pathname)) return "";
      parsed.hash = "";
      parsed.search = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  function durableRecoveryConversationMatchesEntry(entry) {
    const entryAccountId = String(entry?.accountId || "").trim();
    const liveAccountId = String(localStorage.getItem("tb-workbench-account-id") || "").trim();
    const entryUrl = canonicalConversationUrl(entry?.conversationUrl);
    const liveUrl = canonicalConversationUrl(location.href);
    return Boolean(entry?.externalRequestId
      && entry?.conversationOwnerConfirmed === true
      && entryAccountId
      && entryAccountId === liveAccountId
      && entryUrl
      && entryUrl === liveUrl);
  }

  function assertLiveAutomationBoundaryMatchesEntry(boundary, entry, step = "workflow", options = {}) {
    if (!boundary?.materialText || !entry?.externalRequestId) return;
    if (automationPromptMatchesEntry(boundary.materialText, entry)) return;
    // ChatGPT can rewrite the visible post title after planning.  Exact title
    // matching is therefore only a secondary signal during a durable restart.
    // Permit the changed label solely when the renderer has already proved the
    // request belongs to this account and this exact /c/<id> conversation.
    if (options.allowDurableLabelDrift !== false && durableRecoveryConversationMatchesEntry(entry)) return;
    const liveMaterial = String(boundary.materialText)
      .match(/当前素材文件夹：([^\r\n]+)/)?.[1]?.trim() || "未知作品";
    const expectedMaterial = String(entry.materialPath || entry.name || "")
      .split(/[\\/]/).pop().trim() || "当前作品";
    const error = new Error(
      `当前 GPT 对话属于“${liveMaterial}”，不是当前作品“${expectedMaterial}”；已阻止${step}继续，避免混用旧图片或文案`
    );
    error.code = "CONVERSATION_OWNER_MISMATCH";
    error.ownerMismatch = true;
    error.liveMaterial = liveMaterial;
    error.expectedMaterial = expectedMaterial;
    throw error;
  }

  function productionBoundaryError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function assertSinglePostAttachmentBoundary(entry, paths = []) {
    if (entry?.taskType !== "material" && entry?.entryKind !== "material") return;
    const materialRoot = normalizeLocalAttachmentPath(entry.materialPath || entry.path);
    if (!materialRoot) throw productionBoundaryError("MATERIAL_ROOT_MISSING", "当前素材任务缺少帖子文件夹路径，已阻止上传");
    const prefix = `${materialRoot}\\`;
    const approvedTemplateFiles = new Set((Array.isArray(entry.templateAttachments) ? entry.templateAttachments : [])
      .map(normalizeLocalAttachmentPath)
      .filter(Boolean));
    const outside = paths.filter((filePath) => {
      const normalized = normalizeLocalAttachmentPath(filePath);
      return normalized !== materialRoot
        && !normalized.startsWith(prefix)
        && !approvedTemplateFiles.has(normalized);
    });
    if (outside.length) {
      throw productionBoundaryError("MIXED_POST_ATTACHMENTS", `检测到 ${outside.length} 个文件不属于当前帖子文件夹，已阻止混合上传`);
    }
  }

  async function decodeBase64FileInResponsiveChunks(base64, signal) {
    const source = String(base64 || "");
    const parts = [];
    // Keep the chunk aligned to four Base64 characters. Decoding a whole
    // multi-megabyte image and copying every byte in one synchronous loop can
    // monopolize ChatGPT's renderer long enough for every Electron health
    // probe to time out.
    const chunkCharacters = 256 * 1024;
    for (let offset = 0; offset < source.length; offset += chunkCharacters) {
      if (signal?.aborted) throw new DOMException("上传已取消", "AbortError");
      const binary = atob(source.slice(offset, offset + chunkCharacters));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      parts.push(bytes);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return parts;
  }

  async function loadFiles(paths, task) {
    const files = [];
    task.status = "reading";
    task.total = paths.length;
    task.completed = 0;
    renderQueue();
    for (let index = 0; index < paths.length; index += 1) {
      if (task.controller.signal.aborted) throw new DOMException("上传已取消", "AbortError");
      setStatus(`正在读取 ${index + 1}/${paths.length}`);
      const response = await readLocalFile(paths[index], "base64", task.controller.signal);
      const parts = await decodeBase64FileInResponsiveChunks(response.data, task.controller.signal);
      const blob = new Blob(parts, { type: response.contentType || "application/octet-stream" });
      files.push(new File([blob], fileName(paths[index]), { type: blob.type || "application/octet-stream" }));
      task.completed = index + 1;
      renderQueue();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return files;
  }

  async function attachFilesInResponsiveBatches(files, task, attachBatch, options = {}) {
    const batchSize = Math.max(1, Math.min(3, Number(options.batchSize || 2)));
    const previewBaseline = Math.max(0, Number(options.previewBaseline ?? attachmentPreviewCount()));
    let acceptedPreviewCount = previewBaseline;
    let acceptedFiles = 0;
    for (let offset = 0; offset < files.length; offset += batchSize) {
      if (task?.controller?.signal?.aborted) throw new DOMException("上传已取消", "AbortError");
      const batch = files.slice(offset, offset + batchSize);
      await attachBatch(batch, offset);
      const expectedPreviewCount = acceptedPreviewCount + batch.length;
      const settledPreviewCount = await waitFor(() => {
        const current = attachmentPreviewCount();
        return current >= expectedPreviewCount ? current : null;
      }, Math.max(12_000, Number(options.batchTimeoutMs || 15_000)), task?.controller?.signal);
      if (!settledPreviewCount) {
        return {
          ok: false,
          acceptedFiles,
          previewCount: attachmentPreviewCount(),
          previewBaseline
        };
      }
      acceptedPreviewCount = Math.max(expectedPreviewCount, Number(settledPreviewCount || 0));
      acceptedFiles += batch.length;
      if (task?.entry) task.entry.uploadedAttachments = acceptedFiles;
      reportWorkbenchProgress(
        task,
        "上传附件",
        8,
        `已放入 ${acceptedFiles}/${files.length} 个附件；分批等待页面恢复后继续`
      );
      // ChatGPT's React attachment handler performs image inspection after
      // the change event. Yield between tiny batches so health probes and the
      // next native input transaction are not starved by one 15-file commit.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return {
      ok: acceptedFiles === files.length,
      acceptedFiles,
      previewCount: acceptedPreviewCount,
      previewBaseline
    };
  }

  function instruction(entry) {
    return resolveEntryInstruction(entry);
  }

  async function checkEntryDuplicate(entry, task) {
    const textPath = (entry.attachments || []).find((filePath) => /\.(txt|md)$/i.test(filePath));
    if (!textPath) return null;
    task.status = "checking";
    renderQueue();
    const source = await readLocalFile(textPath, "text", task.controller.signal);
    const text = source.data;
    if (!text.trim()) return null;
    return api("/api/dedup/check-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
  }

  async function checkMaterialUsage(entry, task) {
    if (entry.entryKind !== "material") return null;
    task.status = "checking";
    renderQueue();
    return api("/api/extension/material-usage-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryPath: entry.path })
    });
  }

  async function recordMaterialUsage(entry, status) {
    if (entry.entryKind !== "material") return null;
    const payload = await api("/api/extension/material-use", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryPath: entry.path,
        name: entry.name,
        status,
        conversationUrl: location.href
      })
    });
    entry.usage = payload.record;
    if (status === "used") {
      entry.usageCount = Math.max(0, Number(entry.usageCount || 0)) + 1;
      entry.usageSource = "历史日志 + 扩展实时记录";
      const indexed = (state.materialIndex?.items || []).find((item) => item.id === entry.id);
      if (indexed && indexed !== entry) {
        indexed.usageCount = entry.usageCount;
        indexed.usageSource = entry.usageSource;
      }
      recalculateLocalIndexStats();
    }
    renderBody();
    return payload.record;
  }

  function composerContainsEntry(entry) {
    const target = composer();
    const value = target?.value || target?.innerText || target?.textContent || "";
    return Boolean(entry && value && (value.includes(entry.path) || value.includes(entry.name)));
  }

  function commitPendingMaterialUsage() {
    const entry = state.pendingUsage;
    if (!entry || !composerContainsEntry(entry)) return;
    clearTimeout(state.usageCommitTimer);
    state.usageCommitTimer = setTimeout(async () => {
      try {
        await recordMaterialUsage(entry, "used");
        state.pendingUsage = null;
        setStatus(`已登记使用：${entry.name}`, "success");
      } catch (error) {
        setStatus(`素材已发送，但台账登记失败：${error.message}`, "danger");
      }
    }, 700);
  }

  function reportWorkbenchTask(task, status, detail = "", extra = {}) {
    const requestId = task?.entry?.externalRequestId;
    if (!requestId) return;
    document.documentElement.dataset.tbGptLastTask = `${requestId}:${status}`;
    const now = Date.now();
    const metrics = task.metrics || {};
    if (metrics.current && !metrics.current.endedAt) {
      metrics.current.endedAt = new Date(now).toISOString();
      metrics.current.durationMs = now - metrics.current.startedMs;
    }
    const result = {
      source: "tb-gpt-production-extension",
      type: "tb-workbench-task-result",
      requestId,
      status,
      detail: String(detail || ""),
      startedAt: metrics.startedAt || "",
      endedAt: new Date(now).toISOString(),
      elapsedMs: metrics.startedMs ? now - metrics.startedMs : 0,
      stageHistory: Array.isArray(metrics.history) ? metrics.history : [],
      workflowStepHistory: Array.isArray(task.workflowStepHistory) ? task.workflowStepHistory : [],
      stepTiming: task.stepTiming && typeof task.stepTiming === "object" ? task.stepTiming : null,
      submittedToGpt: Boolean(task.workflow?.planSubmitted || task.workflow?.imageSubmitted || task.workflow?.textSubmitted),
      planSubmitted: Boolean(task.workflow?.planSubmitted),
      ...(extra && typeof extra === "object" ? extra : {})
    };
    let bridge = document.getElementById("tb-workbench-bridge-result");
    if (!bridge) {
      bridge = document.createElement("script");
      bridge.id = "tb-workbench-bridge-result";
      bridge.type = "application/json";
      document.documentElement.appendChild(bridge);
    }
    bridge.textContent = JSON.stringify(result);
    document.dispatchEvent(new Event("tb-workbench-task-result"));
    window.postMessage(result, "*");
  }

const GPT_WORKFLOW_PROGRESS_RANGES = Object.freeze([
  { key: "archive", label: "归档完成", start: 95, end: 100, match: /归档|登记使用次数|^完成$|查重跳过/i, complete: /作品归档完成|^完成$|查重跳过/i },
  { key: "package", label: "打包校验", start: 87, end: 95, match: /打包|校验|查重/i, complete: /打包完成|校验完成/i },
  { key: "download", label: "下载图片", start: 75, end: 87, match: /下载/i, complete: /图片已下载|下载完成/i },
  { key: "copy", label: "生成文案", start: 65, end: 75, match: /文案/i, complete: /文案已完成|文案已保存/i },
  { key: "images", label: "生图", start: 35, end: 65, match: /图片|出图|生成图片|补齐缺少/i, complete: /图片已完成|出图完成/i },
  { key: "plan", label: "生成并确认计划", start: 20, end: 35, match: /迁移计划|计划|确认出图/i, complete: /迁移计划已完成|计划已生成|确认出图$/i },
  { key: "upload", label: "上传素材", start: 10, end: 20, match: /上传|附件|composer/i, complete: /附件上传完成|素材上传完成/i },
  { key: "prepare", label: "准备会话", start: 0, end: 10, match: /打开在线模板|等待 GPT composer|waiting for GPT composer|页面就绪|准备生产|恢复归档边界|模板初始化|模板已就绪/i, complete: /页面就绪|模板已就绪|恢复归档边界/i },
]);

  function resolveWorkbenchProgress(task, stage, progressStatus = "running") {
    const stageName = String(stage || "");
    const workflow = task?.workflow && typeof task.workflow === "object" ? task.workflow : {};
    const entry = task?.entry && typeof task.entry === "object" ? task.entry : {};
    const range = GPT_WORKFLOW_PROGRESS_RANGES.find((item) => item.match.test(stageName))
      || GPT_WORKFLOW_PROGRESS_RANGES.find((item) => item.key === "prepare");
    const attachments = Array.isArray(entry.attachments) ? entry.attachments.length : 0;
    const uploaded = Math.max(0, Number(entry.uploadedAttachments || task?.uploadedAttachments || 0));
    const expectedImages = Math.max(0, Number(workflow.plannedImageCount || entry.expectedImages || 0));
    const generatedImages = Math.max(
      0,
      Number(workflow.generatedImageActualCount || workflow.generatedImageUrls?.length || entry.generatedImages || 0)
    );
    const downloadedImages = Math.max(
      0,
      Number(workflow.downloadResult?.count || entry.downloadedImages || 0)
    );
    let current = 0;
    let expected = 0;
    let countLabel = "";
    if (range.key === "upload" && (attachments || uploaded)) {
      current = uploaded;
      expected = Math.max(attachments, Number(entry.expectedAttachments || 0));
      countLabel = expected ? `已上传 ${Math.min(current, expected)}/${expected} 个文件` : `已上传 ${current} 个文件`;
    } else if (range.key === "images" && (expectedImages || generatedImages)) {
      current = generatedImages;
      expected = expectedImages;
      countLabel = expected ? `已识别 ${Math.min(current, expected)}/${expected} 张` : `已识别 ${current} 张`;
    } else if (range.key === "download" && (expectedImages || downloadedImages)) {
      current = downloadedImages;
      expected = expectedImages;
      countLabel = expected ? `已下载 ${Math.min(current, expected)}/${expected} 张` : `已下载 ${current} 张`;
    } else if (range.key === "copy") {
      countLabel = workflow.copyText || entry.copyText ? "已生成，等待保存" : "等待文案生成";
    } else if (range.key === "archive") {
      countLabel = /归档素材|校验/i.test(stageName) ? "已校验，正在登记使用次数" : "已完成归档";
    }
    const ratio = expected > 0 ? Math.max(0, Math.min(1, current / expected)) : null;
    const completed = progressStatus === "completed" || range.complete.test(stageName);
    const percent = completed
      ? range.end
      : ratio === null
        ? range.start
        : Math.round(range.start + (range.end - range.start) * ratio);
    const waiting = /等待|恢复|重试|不确定|未知|探测/i.test(stageName)
      || progressStatus !== "running";
    return {
      stageKey: range.key,
      stageLabel: range.label,
      stageStartPercent: range.start,
      stageEndPercent: range.end,
      stagePercent: Math.max(0, Math.min(100, percent)),
      progressMode: waiting ? "indeterminate" : "determinate",
      progressCount: current,
      progressExpected: expected,
      progressCountLabel: countLabel
    };
  }

  function reportWorkbenchProgress(task, stage, percent, detail = "", progressStatus = "running") {
    const requestId = task?.entry?.externalRequestId;
    if (!requestId) return;
    const now = Date.now();
    const stageName = String(stage || "");
    if (!task.metrics) task.metrics = { startedMs: now, startedAt: new Date(now).toISOString(), history: [], current: null };
    const stageChanged = !task.metrics.current || task.metrics.current.stage !== stageName;
    const stepTiming = task.stepTiming && typeof task.stepTiming === "object" ? task.stepTiming : null;
    if (stageChanged) {
      if (task.metrics.current && !task.metrics.current.endedAt) {
        // A stage transition is a real terminal boundary for the previous
        // stage.  Leaving its status as "running" makes the persisted history
        // look like the task is stuck even though the next stage has started.
        // Keep an already terminal status (failed/timeout/cancelled) intact;
        // only close an ordinary running stage as completed.
        if (task.metrics.current.status === "running") {
          task.metrics.current.status = "completed";
        }
        task.metrics.current.endedAt = new Date(now).toISOString();
        task.metrics.current.durationMs = now - task.metrics.current.startedMs;
        task.metrics.current.endedBy = "stage-transition";
      }
      task.metrics.current = {
        stage: stageName,
        status: "running",
        startedMs: now,
        startedAt: new Date(now).toISOString(),
        waiting: /等待|生成图片|生成小红书文案/i.test(stageName),
        deadlineAt: String(stepTiming?.deadlineAt || ""),
        waitLimitMs: Number(stepTiming?.timeoutMs || 0),
        attempt: Number(stepTiming?.attempt || 0)
      };
      task.metrics.history.push(task.metrics.current);
    }
    const terminal = progressStatus !== "running";
    const previousPercent = Number(task.lastPercent || 0);
    const progress = resolveWorkbenchProgress(task, stageName, progressStatus);
    task.lastStage = stageName;
    // A failed/cancelled task must not jump to 100%; 100 means the work was
    // actually archived. Keep the last authoritative stage boundary visible.
    task.lastPercent = progressStatus === "completed"
      ? 100
      : terminal
        ? Math.min(99, Math.max(previousPercent, progress.stagePercent))
        : progress.stagePercent;
    if (terminal && task.metrics.current && !task.metrics.current.endedAt) {
      task.metrics.current.status = progressStatus;
      task.metrics.current.endedAt = new Date(now).toISOString();
      task.metrics.current.durationMs = now - task.metrics.current.startedMs;
    }
    const stageElapsedMs = task.metrics.current?.startedMs ? now - task.metrics.current.startedMs : 0;
    const stepRemainingMs = stepTiming?.deadlineAt
      ? Math.max(0, Date.parse(stepTiming.deadlineAt) - now)
      : 0;
    if (stageChanged || terminal) {
      logConversationEvent("stage-progress", {
        requestId,
        account: String(task.entry.accountId || localStorage.getItem("tb-workbench-account-id") || ""),
        materialName: task.entry.name || "",
        conversationUrl: location.href,
        step: String(stepTiming?.action || stageName),
        status: progressStatus,
        startedAt: task.metrics.startedAt,
        stageStartedAt: task.metrics.current?.startedAt || "",
        elapsedMs: now - task.metrics.startedMs,
        stageElapsedMs,
        deadlineAt: String(stepTiming?.deadlineAt || ""),
        waitLimitMs: Number(stepTiming?.timeoutMs || 0),
        attempt: Number(stepTiming?.attempt || 0),
        meta: {
          stage: stageName,
          percent: task.lastPercent,
          detail: String(detail || ""),
          progressCount: progress.progressCount,
          progressExpected: progress.progressExpected,
          stepRemainingMs
        }
      });
    }
    const result = {
      source: "tb-gpt-production-extension",
      type: "tb-workbench-task-progress",
      requestId,
      runId: String(task.entry.runId || requestId.split(":")[0] || requestId),
      taskId: requestId,
      browserId: String(task.entry.accountId || localStorage.getItem("tb-workbench-account-id") || ""),
      material: String(task.entry.name || ""),
      stage: stageName,
      status: progressStatus,
      percent: task.lastPercent,
      stageKey: progress.stageKey,
      stageLabel: progress.stageLabel,
      stageStartPercent: progress.stageStartPercent,
      stageEndPercent: progress.stageEndPercent,
      stagePercent: progress.stagePercent,
      progressMode: progress.progressMode,
      progressCount: progress.progressCount,
      progressExpected: progress.progressExpected,
      progressCountLabel: progress.progressCountLabel,
      detail: String(detail || ""),
      submittedToGpt: Boolean(task.workflow?.planSubmitted || task.workflow?.imageSubmitted || task.workflow?.textSubmitted),
      planSubmitted: Boolean(task.workflow?.planSubmitted),
      uploadedAttachments: Number(task.entry.uploadedAttachments || 0),
      generatedImages: Number(task.workflow?.generatedImageActualCount || task.workflow?.generatedImageUrls?.length || task.entry.generatedImages || 0),
      downloadedImages: Number(task.workflow?.downloadResult?.count || task.entry.downloadedImages || 0),
      expectedImages: clampExpectedImageCount(task.workflow?.plannedImageCount || task.entry.expectedImages || 0),
      startedAt: task.metrics.startedAt,
      workflowStartedAt: String(task.workflowStartedAt || task.metrics.startedAt || ""),
      workflowDeadlineAt: String(task.workflowDeadlineAt || ""),
      workflowElapsedMs: task.workflowStartedMs ? Math.max(0, now - Number(task.workflowStartedMs)) : 0,
      workflowRemainingMs: task.workflowDeadlineMs ? Math.max(0, Number(task.workflowDeadlineMs) - now) : 0,
      stageStartedAt: task.metrics.current.startedAt,
      elapsedMs: now - task.metrics.startedMs,
      stageElapsedMs,
      deadlineAt: String(stepTiming?.deadlineAt || ""),
      waitLimitMs: Number(stepTiming?.timeoutMs || 0),
      stepAttempt: Number(stepTiming?.attempt || 0),
      stepStatus: String(stepTiming?.status || ""),
      stepRemainingMs,
      retryCount: Number(task.entry.retryCount || 0)
    };
    let bridge = document.getElementById("tb-workbench-bridge-progress");
    if (!bridge) {
      bridge = document.createElement("script");
      bridge.id = "tb-workbench-bridge-progress";
      bridge.type = "application/json";
      document.documentElement.appendChild(bridge);
    }
    bridge.textContent = JSON.stringify(result);
    document.dispatchEvent(new Event("tb-workbench-task-progress"));
    window.postMessage(result, "*");
  }

  function assistantTurns() {
    const semanticTurns = [...document.querySelectorAll('[data-turn="assistant"]')]
      .filter((turn) => !turn.parentElement?.closest?.('[data-turn]'));
    const outerTurns = [...document.querySelectorAll('[data-testid^="conversation-turn"]')];
    if (outerTurns.length) {
      return outerTurns
        .filter((turn) => !turn.querySelector('[data-message-author-role="user"]'))
        .map((turn) => turn.querySelector('[data-message-author-role="assistant"], article[data-turn="assistant"]') || turn);
    }
    if (semanticTurns.length) return semanticTurns;

    const roleTurns = [...document.querySelectorAll('[data-message-author-role="assistant"]')]
      .filter((turn) => !turn.parentElement?.closest?.('[data-message-author-role]'));
    if (roleTurns.length) return roleTurns;
    return [...document.querySelectorAll('[data-turn="assistant"]')];
  }

  function latestUserTurnWrapper() {
    const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
    return users.at(-1)?.closest?.('[data-testid^="conversation-turn"]') || users.at(-1) || null;
  }

  function latestConfirmationUserTurn(confirmText = "1") {
    const expected = String(confirmText || "1").replace(/\s+/g, "");
    const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
    for (let index = users.length - 1; index >= 0; index -= 1) {
      const user = users[index];
      const text = String(user.innerText || user.textContent || "").replace(/\s+/g, "");
      if (text === expected) {
        return user.closest?.('[data-testid^="conversation-turn"]') || user;
      }
    }
    return null;
  }

  function assistantTurnsAfter(afterTurn) {
    if (!afterTurn?.isConnected) return [];
    const outerTurns = [...document.querySelectorAll('[data-testid^="conversation-turn"]')];
    const anchorIndex = outerTurns.indexOf(afterTurn.closest?.('[data-testid^="conversation-turn"]') || afterTurn);
    if (anchorIndex < 0) return [];
    return outerTurns.slice(anchorIndex + 1)
      .filter((turn) => !turn.querySelector('[data-message-author-role="user"]'))
      .map((turn) => turn.querySelector('[data-message-author-role="assistant"], article[data-turn="assistant"]') || turn);
  }

  function conversationRoleTurns() {
    const semanticTurns = [...document.querySelectorAll('[data-turn="user"], [data-turn="assistant"]')]
      .filter((turn) => !turn.parentElement?.closest?.('[data-turn]'));
    if (semanticTurns.length) return semanticTurns;
    return [...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')]
      .filter((turn) => !turn.parentElement?.closest?.('[data-message-author-role]'));
  }

  function conversationTurnRole(turn) {
    return String(turn?.getAttribute?.("data-turn") || turn?.getAttribute?.("data-message-author-role") || "").trim();
  }

  function latestCopyTurnAfterPrompt(copyPrompt = DEFAULT_PUBLISH_COPY_PROMPT, options = {}) {
    const turns = conversationRoleTurns();
    const promptNeedle = normalizePublishCopyPrompt(copyPrompt).replace(/\s/g, "");
    const minimum = Math.max(1, Number(options.minimum || 300));
    const keywordPattern = String(options.keywordPattern || "").trim();
    const baselineKeys = Array.isArray(options.baselineKeys) ? options.baselineKeys : [];
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (conversationTurnRole(turn) !== "user") continue;
      const userText = String(turn.innerText || turn.textContent || "").replace(/\s/g, "");
      if (!userText.includes(promptNeedle) && !/小红书文案/.test(userText)) continue;
      for (let cursor = index + 1; cursor < turns.length; cursor += 1) {
        const candidate = turns[cursor];
        const role = conversationTurnRole(candidate);
        if (role === "user") break;
        const text = cleanAssistantText(candidate);
        if (role === "assistant"
          && (!baselineKeys.length || isFreshAutomationTurnKey({ key: assistantTurnKey(candidate, cursor), baselineKeys }))
          && (isLikelyPublishCopy(text, minimum) || completionKeywordDetected(text, { action: "wait-copy", keywordPattern }).matched)) return candidate;
      }
    }
    // ChatGPT can compact or virtualize the paired user turn after a reload.
    // The fallback is safe only for assistant turns that were not present when
    // this copy request began; otherwise a long-lived template chat can package
    // an older post as the current material's copy.
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const candidate = turns[index];
      if (conversationTurnRole(candidate) !== "assistant") continue;
      if (!isFreshAutomationTurnKey({ key: assistantTurnKey(candidate, index), baselineKeys })) continue;
      const text = cleanAssistantText(candidate);
      if (isLikelyPublishCopy(text, minimum) || completionKeywordDetected(text, { action: "wait-copy", keywordPattern }).matched) return candidate;
    }
    return null;
  }

  function latestAssistantTurnPairedWithCopyPrompt(copyPrompt = DEFAULT_PUBLISH_COPY_PROMPT, options = {}) {
    const turns = conversationRoleTurns();
    const promptNeedle = normalizePublishCopyPrompt(copyPrompt).replace(/\s/g, "");
    const baselineKeys = Array.isArray(options.baselineKeys) ? options.baselineKeys : [];
    let promptIndex = -1;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (conversationTurnRole(turn) !== "user") continue;
      const userText = String(turn.innerText || turn.textContent || "").replace(/\s/g, "");
      if (userText.includes(promptNeedle) || /小红书.{0,8}文案|文案.{0,8}小红书/.test(userText)) {
        promptIndex = index;
        break;
      }
    }
    if (promptIndex < 0) return null;
    const candidateIndex = lastAssistantIndexAfterPrompt(turns.map(conversationTurnRole), promptIndex);
    if (candidateIndex < 0) return null;
    const candidate = turns[candidateIndex];
    return !baselineKeys.length || isFreshAutomationTurnKey({ key: assistantTurnKey(candidate, candidateIndex), baselineKeys })
      ? candidate
      : null;
  }

  function latestPairedCopyTurn(copyPrompt = DEFAULT_PUBLISH_COPY_PROMPT, options = {}) {
    const minimum = Math.max(1, Number(options.minimum || 300));
    const keywordPattern = String(options.keywordPattern || "").trim();
    const baselineKeys = Array.isArray(options.baselineKeys) ? options.baselineKeys : [];
    const candidate = latestAssistantTurnPairedWithCopyPrompt(copyPrompt, { baselineKeys });
    const text = cleanAssistantText(candidate);
    return isLikelyPublishCopy(text, minimum)
      || completionKeywordDetected(text, { action: "wait-copy", keywordPattern }).matched
      ? candidate
      : null;
  }

  function currentConversationHasCopyPrompt(copyPrompt = DEFAULT_PUBLISH_COPY_PROMPT) {
    const promptNeedle = String(copyPrompt || "").trim().slice(0, 80);
    return conversationRoleTurns().some((turn) => {
      if (conversationTurnRole(turn) !== "user") return false;
      const text = String(turn.innerText || turn.textContent || "");
      return Boolean(promptNeedle && text.includes(promptNeedle))
        || /小红书.{0,8}文案|文案.{0,8}小红书/.test(text);
    });
  }

  async function waitForPublishCopy(copyPrompt, timeout = 90_000, options = {}) {
    const started = Date.now();
    const minimum = Math.max(1, Number(options.minimum || 300));
    const keywordPattern = String(options.keywordPattern || "").trim();
    let lastSignature = "";
    let stableSince = 0;
    let generatingStableSince = 0;
    let lastGeneratingSignature = "";
    let stalledGenerationStopped = false;
    const stalledGenerationThresholdMs = Math.max(30_000, Number(options.stalledGenerationThresholdMs || 60_000));
    while (Date.now() - started < timeout) {
      const pauseReason = platformPauseReason();
      if (pauseReason) throw new Error(pauseReason);
      // Only accept a publishable reply paired with the latest copy request.
      // Reusing an older post from the same long-running template chat would
      // silently package the wrong material.
      const turn = latestPairedCopyTurn(copyPrompt, {
        minimum,
        keywordPattern,
        baselineKeys: options.baselineKeys
      });
      const text = cleanAssistantText(turn);
      const signature = `${text.length}:${text.slice(-120)}`;
      const keywordHit = completionKeywordDetected(text, { action: "wait-copy", keywordPattern }).matched;
      const generating = generatingNow();
      if (generating) {
        if (signature === lastGeneratingSignature) {
          if (!generatingStableSince) generatingStableSince = Date.now();
        } else {
          lastGeneratingSignature = signature;
          generatingStableSince = Date.now();
        }
      } else {
        generatingStableSince = 0;
        lastGeneratingSignature = "";
      }
      if (!stalledGenerationStopped && generating && generatingStableSince
        && Date.now() - generatingStableSince >= stalledGenerationThresholdMs) {
        const stopButton = visibleGenerationStopButton();
        if (stopButton && !stopButton.disabled) {
          stalledGenerationStopped = true;
          logGptLimitDebug("stalled-copy-generation", {
            stableForMs: Date.now() - generatingStableSince,
            textLength: text.length,
            minimum
          });
          stopButton.click();
        }
      }
      if ((isLikelyPublishCopy(text, minimum) || keywordHit) && signature === lastSignature && !generating) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 2_500) return { turn, text };
      } else {
        stableSince = 0;
        lastSignature = signature;
      }
      await waitForTaskDelay(1_000);
    }
    // ChatGPT may virtualize the user turn while keeping the finished copy
    // reply in the DOM.  The paired lookup is intentionally strict during
    // polling, but a timeout must get one last post-prompt recovery attempt
    // before declaring the task incomplete; otherwise a valid copy can be
    // discarded merely because the conversation scrolled or re-rendered.
    const recoveredTurn = latestCopyTurnAfterPrompt(copyPrompt, {
      minimum,
      keywordPattern,
      baselineKeys: options.baselineKeys
    });
    const recoveredText = cleanAssistantText(recoveredTurn);
    if ((isLikelyPublishCopy(recoveredText, minimum) || completionKeywordDetected(recoveredText, { action: "wait-copy", keywordPattern }).matched) && !generatingNow()) {
      return { turn: recoveredTurn, text: recoveredText, recovered: true };
    }
    return null;
  }

  function replyScopes(scope = document) {
    const roots = [scope];
    const wrapper = scope?.closest?.('[data-testid^="conversation-turn"]');
    if (wrapper && wrapper !== scope) roots.push(wrapper);
    return [...new Set(roots.filter(Boolean))];
  }

  function generatedImageNodes(scope = document) {
    const nodes = replyScopes(scope).flatMap((root) => [
      ...root.querySelectorAll([
      'img[alt^="已生成图片"]',
      'img[alt="输出图片"]',
      'img[alt^="\u5df2\u751f\u6210\u56fe\u7247"]',
      'img[alt="\u8f93\u51fa\u56fe\u7247"]',
      'img[alt*="generated image" i]',
      '[data-testid*="imagegen" i] img',
      '[data-testid*="generated-image" i] img'
      ].join(","))
    ]);
    return [...new Set(nodes)].filter((image) => {
      if (image.closest('[data-message-author-role="user"]')) return false;
      return Boolean(imageUrl(image, { allowSmall: true }));
    });
  }

  function reactFiberForNode(node) {
    if (!node) return null;
    const key = Object.keys(node).find((name) => name.startsWith("__reactFiber$"));
    return key ? node[key] : null;
  }

  function sandboxImageArtifact(button) {
    const visibleName = String(button?.getAttribute?.("aria-label") || button?.textContent || "").trim();
    if (!/\.(?:png|jpe?g|webp|gif|avif)$/i.test(visibleName)) return null;
    let fiber = reactFiberForNode(button);
    let fileName = visibleName;
    let filepath = "";
    let messageId = "";
    for (let depth = 0; fiber && depth < 12; depth += 1, fiber = fiber.return) {
      const props = fiber.memoizedProps || fiber.pendingProps || {};
      fileName = String(props.fileName || fileName).trim();
      filepath = String(props.filepath || filepath).trim();
      messageId = String(props.messageId || messageId).trim();
      if (filepath && messageId) break;
    }
    if (!/^\/mnt\/data\//i.test(filepath) || !messageId) return null;
    const conversationId = String(location.pathname.match(/\/c\/([^/?#]+)/)?.[1] || "").trim();
    if (!conversationId) return null;
    const url = new URL(
      `/backend-api/conversation/${encodeURIComponent(conversationId)}/interpreter/download`,
      location.origin
    );
    url.searchParams.set("message_id", messageId);
    url.searchParams.set("sandbox_path", filepath);
    return { url: url.href, fileName, filepath, messageId };
  }

  function sandboxArtifactPlaceholder(button, fileName) {
    const outerTurn = button?.closest?.('[data-testid^="conversation-turn"]');
    const assistantTurn = button?.closest?.('[data-message-author-role="assistant"], article[data-turn="assistant"]')
      || outerTurn;
    const turns = assistantTurns();
    const index = Math.max(0, turns.indexOf(assistantTurn));
    const turnKey = assistantTurnKey(assistantTurn, index);
    return `https://tb-workbench.invalid/sandbox-artifact/${encodeURIComponent(turnKey)}?file=${encodeURIComponent(fileName)}`;
  }

  function generatedImageArtifacts(scope = document) {
    return [...new Set(replyScopes(scope).flatMap((root) => [...root.querySelectorAll("button[aria-label]")]))]
      .filter((button) => !button.closest('[data-message-author-role="user"]'))
      .map((button) => {
        const fileName = String(button.getAttribute("aria-label") || button.textContent || "").trim();
        if (!/\.(?:png|jpe?g|webp|gif|avif)$/i.test(fileName)) return null;
        return sandboxImageArtifact(button) || {
          url: sandboxArtifactPlaceholder(button, fileName),
          fileName,
          button
        };
      })
      .filter(Boolean);
  }

  function parseSandboxArtifactPlaceholder(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.hostname !== "tb-workbench.invalid" || !url.pathname.startsWith("/sandbox-artifact/")) return null;
      return {
        turnKey: decodeURIComponent(url.pathname.slice("/sandbox-artifact/".length)),
        fileName: String(url.searchParams.get("file") || "")
      };
    } catch {
      return null;
    }
  }

  async function resolveSandboxArtifactUrl(value, timeout = 20_000) {
    const target = parseSandboxArtifactPlaceholder(value);
    if (!target) return value;
    const turns = assistantTurns();
    const keyedWrapper = document.querySelector(`[data-testid="${CSS.escape(target.turnKey)}"]`);
    const turn = keyedWrapper
      || turns.find((candidate, index) => assistantTurnKey(candidate, index) === target.turnKey);
    const button = [...(turn?.querySelectorAll?.("button[aria-label]") || [])]
      .find((candidate) => String(candidate.getAttribute("aria-label") || "").trim() === target.fileName);
    if (!button) throw new Error(`没有找到本轮图片文件：${target.fileName}`);
    button.click();
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      const dialog = dialogs.find((candidate) => candidate.querySelector(`img[alt="${CSS.escape(target.fileName)}"]`));
      const image = dialog?.querySelector(`img[alt="${CSS.escape(target.fileName)}"]`);
      const url = imageUrl(image);
      if (url) {
        const closeButton = [...dialog.querySelectorAll("button")].find((candidate) => {
          const label = `${candidate.getAttribute("aria-label") || ""} ${candidate.title || ""}`;
          return /退出全屏|关闭|exit fullscreen|close/i.test(label);
        });
        closeButton?.click();
        return url;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`图片预览地址读取超时：${target.fileName}`);
  }

  function generatedImageUrlsIn(scope = document) {
    return uniqueGeneratedImageUrls([
      ...generatedImageNodes(scope).map((image) => imageUrl(image, { allowSmall: true })),
      ...generatedImageArtifacts(scope).map((artifact) => artifact.url),
      // Native image turns can survive a reload without the assistant-role
      // marker. Keep the stable semantic alt marker as a scoped fallback so
      // the same current reply is still countable and downloadable.
      ...semanticGeneratedImageUrlsIn(scope)
    ]);
  }

  function semanticGeneratedImageUrlsIn(scope = document) {
    if (!scope?.querySelectorAll) return [];
    // ChatGPT's native image-generation turn can have no assistant role after
    // a reload. Read its stable Chinese/English alt marker directly so the
    // patrol recovery path does not depend on the role-based reply helpers.
    const urls = [
      ...scope.querySelectorAll('img[alt^="\u5df2\u751f\u6210\u56fe\u7247"], img[alt="\u8f93\u51fa\u56fe\u7247"], img[alt*="generated image" i]')
    ].map((image) => imageUrl(image, { allowSmall: true })).filter(Boolean);
    const seen = new Set();
    return urls.filter((url) => {
      let identity = url;
      try {
        const parsed = new URL(url);
        identity = parsed.searchParams.get("id") || url;
      } catch { /* blob/data URLs keep their full identity */ }
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }

  function semanticGeneratedImageUrlsBetweenTurns(startTurn, endTurn = null) {
    const outerTurns = [...document.querySelectorAll('[data-testid^="conversation-turn"]')];
    if (!outerTurns.length) return [];
    const startWrapper = startTurn?.closest?.('[data-testid^="conversation-turn"]') || startTurn;
    const startIndex = outerTurns.indexOf(startWrapper);
    if (startIndex < 0) return [];
    const endWrapper = endTurn?.closest?.('[data-testid^="conversation-turn"]') || endTurn;
    const endIndex = endWrapper ? outerTurns.indexOf(endWrapper) : outerTurns.length;
    const upperBound = endIndex < 0 ? outerTurns.length : endIndex;
    if (upperBound <= startIndex) return [];
    const urls = [];
    for (const wrapper of outerTurns.slice(startIndex + 1, upperBound)) {
      const userTurns = [
        ...wrapper.querySelectorAll('[data-message-author-role="user"], [data-turn="user"]')
      ];
      // A later material prompt begins a new production boundary. Do not let
      // a previous batch's semantic image markers leak into the next one.
      if (userTurns.some((turn) => isAutomationMaterialPrompt(normalizeDraft(turn.innerText || turn.textContent || "")))) break;
      if (userTurns.length) continue;
      urls.push(...semanticGeneratedImageUrlsIn(wrapper));
    }
    return uniqueGeneratedImageUrls(urls);
  }

  function generatedImageUrls() {
    return generatedImageUrlsIn(document);
  }

  function generatedOutputRisk(scope) {
    const text = String(scope?.innerText || scope?.textContent || "");
    const artifacts = generatedImageArtifacts(scope);
    const artifactNames = artifacts.map((item) => String(item.fileName || ""));
    // One native GPT image is rendered as several DOM nodes (large preview,
    // thumbnail and lazy-loaded copy). Count stable backend file identities,
    // otherwise a two-image limit response can look like six images and slip
    // past the low-output stop rule.
    const nativeImageUrls = uniqueGeneratedImageUrls(
      [
        ...generatedImageNodes(scope).map((image) => imageUrl(image, { allowSmall: true })),
        ...semanticGeneratedImageUrlsIn(scope)
      ]
    );
    const nativeImages = nativeImageUrls.length;
    const hasCodeSignal = /(?:\bpython\b\s*(?:script|code|file|output)|python脚本|python代码|代码解释器|运行代码|inspect(?:ing)?\s+composite|analy(?:s|z)ing\s+image|image\s+dimensions)/i.test(text);
    const hasArchiveSignal = /(?:\bzip\b|download\s+all|一次下载|下载全部|压缩包|批量下载)/i.test(text)
      || artifactNames.some((name) => /\.(?:zip|py|ipynb|html|json)$/i.test(name));
    const hasScriptArtifact = artifactNames.some((name) => /\.(?:py|ipynb|html|json)$/i.test(name));
    const scriptOutput = hasCodeSignal || hasScriptArtifact;
    const retryButton = [...replyScopes(scope).flatMap((root) => [...root.querySelectorAll("button")])]
      .some((button) => /^(?:重试|retry|try again|regenerate)$/i.test(String(button.innerText || button.textContent || button.getAttribute("aria-label") || "").trim()));
    const hasRetrySignal = /(?:达到(?:图片|生成|上传)?(?:数量)?上限|额度(?:已|不足|用尽)|图片生成.*(?:失败|受限)|无法继续生成|请稍后再试|rate\s*limit|usage\s*limit|too\s*many\s*requests|try\s+again\s+later|generation\s+(?:limit|failed))/i.test(text)
      || (retryButton && nativeImages <= 3);
    // PY脚本兜底拼图:GPT 撞到生图上限后用 py/代码解释器拼接垃圾图,而非 DALL-E 原生出图。
    // 判定:有图片(>0) 且有脚本特征 → 兜底拼图,视为触顶。
    const pyScriptFallback = detectPyScriptFallbackSignal({ nativeImages, hasCodeSignal, hasScriptArtifact });
    // 纯脚本/沙盒输出:没有原生图但出现代码解释器、脚本文件、压缩包等产物。
    // 用户确认这也是生图触顶特征,按限额信号处理。
    const scriptOutputLimit = detectScriptOutputLimitSignal({
      nativeImages,
      artifactCount: artifacts.length,
      hasCodeSignal,
      hasScriptArtifact,
      hasArchiveSignal
    });
    // 低图触顶:只出 4 张及以下也是撞上限的补充特征(不单独触发 hardFailure,
    // 在图片检测完成后与其他信号组合判断)。
    const lowImage = detectLowImageLimit({ nativeImages, threshold: 4 });
    const rejectedDraftLoop = detectRejectedImageDraftLoop({ text, nativeImages });
    if (scriptOutputLimit.detected || pyScriptFallback.detected || hasRetrySignal || lowImage.detected || rejectedDraftLoop.detected) {
      logGptLimitDebug("generated-output-risk", {
        nativeImages,
        artifactCount: artifacts.length,
        artifactNames,
        hasCodeSignal,
        hasScriptArtifact,
        hasArchiveSignal,
        hasRetrySignal,
        scriptOutputLimitSignal: scriptOutputLimit.detected,
        pyScriptFallbackSignal: pyScriptFallback.detected,
        lowImageLimit: lowImage.detected,
        lowImageCount: lowImage.count,
        rejectedDraftLoop: rejectedDraftLoop.detected,
        rejectedDraftMarkers: rejectedDraftLoop.rejectionMarkers,
        textSample: text.slice(0, 500)
      });
    }
    return {
      nativeImages,
      hasCodeSignal,
      hasArchiveSignal,
      hasRetrySignal,
      scriptOnly: nativeImages === 0 && artifacts.length > 0 && (scriptOutput || hasArchiveSignal),
      pyScriptFallbackSignal: pyScriptFallback.detected,
      scriptOutputLimitSignal: scriptOutputLimit.detected,
      lowImageLimit: lowImage.detected,
      lowImageCount: lowImage.count,
      rejectedDraftLoop: rejectedDraftLoop.detected,
      hardFailure: hasRetrySignal || scriptOutput || pyScriptFallback.detected
        || rejectedDraftLoop.detected
        || (nativeImages === 0 && artifacts.length > 0 && hasArchiveSignal)
    };
  }

  globalThis.TeambuildingGptProductionDebug = {
    generatedImageUrls,
    generatedImageArtifacts: () => generatedImageArtifacts(document).map(({ url, fileName }) => ({ url, fileName })),
    resolveSandboxArtifactUrl
  };

  const GPT_IMAGE_DETECTION_RECENT_TURN_LIMIT = 12;

  function isFreshImageTurn(turn, options = {}, allTurns = assistantTurns(), index = allTurns.indexOf(turn)) {
    const baselineKeys = new Set(
      Array.isArray(options.baselineAssistantTurnKeys)
        ? options.baselineAssistantTurnKeys.map((value) => String(value || "").trim()).filter(Boolean)
        : []
    );
    if (baselineKeys.size) return !baselineKeys.has(assistantTurnKey(turn, index));
    const baselineCount = Math.max(0, Number(options.baselineAssistantTurns || 0));
    return index < 0 || index >= baselineCount;
  }

  function recentImageDetectionTurns(options = {}) {
    const limit = Math.max(1, Number(options.limit || GPT_IMAGE_DETECTION_RECENT_TURN_LIMIT));
    const allAssistantTurns = options.afterTurn?.isConnected
      ? assistantTurnsAfter(options.afterTurn)
      : assistantTurns();
    const keepFresh = (turn) => isFreshImageTurn(
      turn,
      options,
      allAssistantTurns,
      allAssistantTurns.indexOf(turn)
    );
    if (options.fullDocumentFallback === true) return allAssistantTurns.filter(keepFresh);
    const allOuterTurns = [...document.querySelectorAll('[data-testid^="conversation-turn"]')];
    const anchor = options.afterTurn?.closest?.('[data-testid^="conversation-turn"]') || options.afterTurn;
    const anchorIndex = anchor ? allOuterTurns.indexOf(anchor) : -1;
    const outerTurns = anchorIndex >= 0 ? allOuterTurns.slice(anchorIndex + 1) : allOuterTurns;
    if (outerTurns.length) {
      return outerTurns
        .slice(-limit)
        .filter((turn) => !turn.querySelector('[data-message-author-role="user"]'))
        .map((turn) => turn.querySelector('[data-message-author-role="assistant"], article[data-turn="assistant"]') || turn)
        .filter(keepFresh);
    }
    const semanticTurns = [...document.querySelectorAll('[data-turn="assistant"]')]
      .filter((turn) => !turn.parentElement?.closest?.('[data-turn]'));
    if (semanticTurns.length) return allAssistantTurns.slice(-limit).filter(keepFresh);
    return allAssistantTurns.slice(-limit).filter(keepFresh);
  }

  function freshGeneratedImageUrls(baselineUrls = [], options = {}) {
    // Bind detection to the fresh assistant replies after the saved baseline.
    // A long-running template chat can contain old Python/sandbox files and
    // old native previews; the baseline turn keys keep them out while allowing
    // one current batch to span an initial reply plus later correction replies.
    const turns = recentImageDetectionTurns(options).slice().reverse();
    const nativeUrls = [];
    const artifactUrls = [];
    const semanticUrls = [];
    for (const turn of turns) {
      nativeUrls.push(...generatedImageNodes(turn).map((image) => imageUrl(image, { allowSmall: true })));
      artifactUrls.push(...generatedImageArtifacts(turn).map((artifact) => artifact.url));
      semanticUrls.push(...semanticGeneratedImageUrlsIn(turn));
    }
    const freshNativeUrls = newGeneratedImageUrls(nativeUrls, baselineUrls);
    const freshArtifactUrls = newGeneratedImageUrls(artifactUrls, baselineUrls);
    const freshSemanticUrls = newGeneratedImageUrls(semanticUrls, baselineUrls);
    const freshRoleUrls = uniqueGeneratedImageUrls([...freshNativeUrls, ...freshArtifactUrls]);
    const freshCurrentBatchUrls = preferCurrentBatchImageUrls(freshRoleUrls, freshSemanticUrls);
    if (freshCurrentBatchUrls.length) {
      // One production batch can span several assistant replies: the initial
      // reply may contain the first pages and a later correction reply the
      // remaining pages. Aggregate all fresh native files after the saved
      // baseline instead of returning only the newest reply (which caused
      // real 9/10 batches to be reported as 1/10).
      return freshCurrentBatchUrls;
    }
    return options.fullDocumentFallback === false
      ? []
      : newGeneratedImageUrls(generatedImageUrls(), baselineUrls);
  }

  function generatedImageCompletionEvidence(urls, options = {}) {
    const wanted = new Set(uniqueGeneratedImageUrls(urls || []).map(generatedImageIdentity));
    if (!wanted.size) return null;
    const turns = recentImageDetectionTurns(options);
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      const turnUrls = generatedImageUrlsIn(turn);
      const matched = turnUrls.filter((url) => wanted.has(generatedImageIdentity(url)));
      if (!matched.length) continue;
      const risk = generatedOutputRisk(turn);
      // ChatGPT adds the native copy-reply action only after the whole
      // assistant response has settled. This is substantially safer than
      // treating a short pause after the first generated image as completion.
      const responseRoot = replyScopes(turn).at(-1) || turn;
      const responseComplete = Boolean(responseRoot.querySelector([
        '[data-testid="copy-turn-action-button"]',
        'button[aria-label*="复制回复"]',
        'button[aria-label*="Copy response" i]',
        'button[aria-label*="下载本组"]',
        'button[aria-label*="Download group" i]'
      ].join(",")));
      const declaredCounts = [...turn.querySelectorAll('button')]
        .flatMap((button) => {
          const ariaCount = String(button.getAttribute("aria-label") || "").match(/(?:共|of)\s*(\d{1,3})\s*(?:张)?/i);
          return [
            Number(button.dataset?.cgptImageTotal || 0),
            Number(button.dataset?.cgptImageCount || 0),
            Number(ariaCount?.[1] || 0)
          ];
        })
        .filter((count) => count > 0 && count < 100);
      return {
        responseComplete,
        turnKey: assistantTurnKey(turn, index),
        turnImageCount: turnUrls.length,
        declaredCount: declaredCounts.length ? Math.max(...declaredCounts) : 0,
        nativeImages: risk.nativeImages,
        scriptOnly: risk.scriptOnly,
        scriptOutput: risk.scriptOutput,
        pyScriptFallbackSignal: risk.pyScriptFallbackSignal,
        scriptOutputLimitSignal: risk.scriptOutputLimitSignal,
        lowImageLimit: risk.lowImageLimit,
        lowImageCount: risk.lowImageCount,
        hardFailure: risk.hardFailure,
        riskReason: risk.scriptOutputLimitSignal ? "script-output-limit"
          : risk.scriptOutput ? "script-output"
          : risk.pyScriptFallbackSignal ? "py-script-fallback"
          : risk.rejectedDraftLoop ? "rejected-draft-loop"
          : risk.hasRetrySignal ? "retry-or-limit-signal"
          : ""
      };
    }
    return null;
  }

  function dismissImageComparison() {
    const buttons = [...document.querySelectorAll("button")].filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && /^\s*跳过\s*$/.test(button.textContent || "");
    });
    buttons.at(-1)?.click();
  }

  function currentBatchChoicePrompt() {
    const latest = [...assistantTurns()].at(-1);
    const text = cleanAssistantText(latest);
    return /(?:单次最多只能出\s*10\s*张|你回复一个选项|先出\s*P\s*1\s*[-—]\s*P\s*10)/i.test(text);
  }

  async function waitForGeneratedImageGrowth(baselineUrls, previousCount, timeout, expectedCount = 0, onTick = null, options = {}) {
    const baseline = new Set(baselineUrls || []);
    const started = Date.now();
    const keywordPattern = String(options.keywordPattern || "").trim();
    const keywordQuietMs = Math.max(1_000, Number(options.keywordQuietMs || 3_000));
    // After a renderer restart the durable checkpoint may no longer contain
    // the assistant-turn baseline captured before confirmation.  Anchor this
    // read to the latest exact confirmation turn (normally "1") so an older
    // plan/copy reply cannot make a silent image response look active forever.
    const confirmationAnchor = options.afterTurn?.isConnected
      ? options.afterTurn
      : latestConfirmationUserTurn(options.confirmText || "1");
    // A native image reply can reveal a few thumbnails before the remaining
    // images are attached to the same assistant turn.  Do not classify a
    // below-expected snapshot as a completed partial reply until it has been
    // quiet for a full grace window.  The incident that motivated this guard
    // exposed 7/10 first and the last 3 images about 74 seconds later.
    const partialQuietMs = Math.max(90_000, Number(options.partialQuietMs || 120_000));
    let stableSince = 0;
    let quietWithoutCompletionSince = 0;
    let silentImageIdleSince = 0;
    let lastSignature = "";
    let activeImageSignature = "";
    let activeImageSignatureSince = 0;
    // Keep a second timer that is independent of the transient streaming
    // marker.  ChatGPT can leave that marker stuck after a renderer/bridge
    // restart even though the native image set has not changed for hours.
    // The active-generation timer below is intentionally tied to the live
    // marker; this timer is the durable no-growth guard for that stale case.
    let stalledImageSignature = "";
    let stalledImageSignatureSince = 0;
    let emptyGenerationSince = 0;
    let stalledGenerationStopped = false;
    // ChatGPT virtualizes image thumbnails while a reply is streaming. A
    // later DOM read may therefore expose 2 images after an earlier read saw
    // 7. Keep the union for this exact confirmation boundary so a transient
    // lazy-load snapshot can never make progress go backwards.
    let observedImageUrls = [];
    while (Date.now() - started < timeout) {
      const pauseReason = platformPauseReason();
      if (pauseReason) throw new Error(pauseReason);
      if (typeof onTick === "function") await onTick();
      dismissImageComparison();
      const detectionOptions = {
        fullDocumentFallback: false,
        baselineAssistantTurnKeys: options.baselineAssistantTurnKeys,
        baselineAssistantTurns: options.baselineAssistantTurns,
        afterTurn: confirmationAnchor
      };
      const detectedImageUrls = freshGeneratedImageUrls(baselineUrls, detectionOptions);
      observedImageUrls = uniqueGeneratedImageUrls([...observedImageUrls, ...detectedImageUrls]);
      const urls = limitGeneratedImageUrls(observedImageUrls, expectedCount);
      const signature = urls.join("|");
      const completion = generatedImageCompletionEvidence(urls, detectionOptions);
      const pageGenerating = generatingNow();
      if (urls.length > previousCount) {
        if (signature !== stalledImageSignature) {
          stalledImageSignature = signature;
          stalledImageSignatureSince = Date.now();
        }
      } else if (urls.length === 0) {
        stalledImageSignature = "";
        stalledImageSignatureSince = 0;
      }
      if (pageGenerating && urls.length === 0) {
        if (!emptyGenerationSince) emptyGenerationSince = Date.now();
      } else {
        emptyGenerationSince = 0;
      }
      if (pageGenerating && urls.length > previousCount) {
        if (signature !== activeImageSignature) {
          activeImageSignature = signature;
          activeImageSignatureSince = Date.now();
        }
      } else {
        activeImageSignature = "";
        activeImageSignatureSince = 0;
      }
      const stalledPartialImage = shouldStopStalledNativeImageGeneration({
        generating: pageGenerating,
        stableForMs: Math.max(
          activeImageSignatureSince ? Date.now() - activeImageSignatureSince : 0,
          stalledImageSignatureSince ? Date.now() - stalledImageSignatureSince : 0
        ),
        thresholdMs: Number(options.stalledGenerationThresholdMs || 300_000),
        detected: urls.length,
        expected: expectedCount
      });
      if (!stalledGenerationStopped && stalledPartialImage) {
        const stopButton = visibleGenerationStopButton();
        if (stopButton && !stopButton.disabled) {
          stalledGenerationStopped = true;
          stopButton.click();
        }
        logGptLimitDebug("stalled-native-image-generation", {
          detectedImages: urls.length,
          expectedCount,
          stableForMs: Math.max(
            activeImageSignatureSince ? Date.now() - activeImageSignatureSince : 0,
            stalledImageSignatureSince ? Date.now() - stalledImageSignatureSince : 0
          ),
          stopButtonFound: Boolean(stopButton)
        });
        // A stuck native marker must not keep mergePartialImageRecovery in
        // wait-current forever.  Treat the response as released after the
        // bounded no-growth window; the caller will use its existing limited
        // missing-page recovery and never resend the already observed URLs.
        return {
          urls,
          confident: false,
          settled: false,
          generating: false,
          stableFor: Math.max(
            activeImageSignatureSince ? Date.now() - activeImageSignatureSince : 0,
            stalledImageSignatureSince ? Date.now() - stalledImageSignatureSince : 0
          ),
          evidence: "stalled-image-response",
          completion
        };
      }
      if (!stalledGenerationStopped && shouldStopStalledEmptyImageGeneration({
        generating: pageGenerating,
        stableForMs: emptyGenerationSince ? Date.now() - emptyGenerationSince : 0,
        thresholdMs: Number(options.stalledGenerationThresholdMs || 300_000),
        detected: urls.length,
        expected: expectedCount
      })) {
        const stopButton = visibleGenerationStopButton();
        if (stopButton && !stopButton.disabled) {
          stalledGenerationStopped = true;
          logGptLimitDebug("stalled-empty-image-generation", {
            detectedImages: urls.length,
            expectedCount,
            stableForMs: Date.now() - emptyGenerationSince
          });
          stopButton.click();
        }
        // Do not require the stop control to still be present: after a page
        // reload the bridge may report a stale generating marker while the
        // actual control has disappeared.  The five-minute empty stall is a
        // safe bounded recovery boundary in that case as well.
        return { urls, confident: false, settled: false, generating: false, stableFor: emptyGenerationSince ? Date.now() - emptyGenerationSince : 0, evidence: "stalled-image-response", completion };
      }
      const freshTurnCount = confirmationAnchor?.isConnected
        ? assistantTurnsAfter(confirmationAnchor).length
        : Math.max(0, assistantTurns().length - Math.max(0, Number(options.baselineAssistantTurns || 0)));
      const silentImageCandidate = urls.length === 0 && freshTurnCount === 0 && !pageGenerating;
      if (silentImageCandidate && !silentImageIdleSince) silentImageIdleSince = Date.now();
      if (!silentImageCandidate) silentImageIdleSince = 0;
      if (shouldRecoverSilentImageGeneration({
        elapsedMs: silentImageIdleSince ? Date.now() - silentImageIdleSince : 0,
        thresholdMs: Number(options.silentThresholdMs || 60_000),
        freshTurnCount,
        freshImageCount: urls.length,
        generating: pageGenerating
      })) {
        return { urls, confident: false, settled: false, generating: pageGenerating, stableFor: 0, evidence: "silent-image-response", completion };
      }
      const latestText = cleanAssistantText([...assistantTurns()].at(-1));
      const explicitImageFailure = urls.length === 0
        && freshTurnCount > 0
        && !pageGenerating
        && /(?:something went wrong while generating (?:your|the) image|(?:image|images) generation failed|\u751f\u6210\u56fe\u7247(?:\u65f6)?\u51fa\u4e86\u70b9\u95ee\u9898|\u56fe\u7247\u751f\u6210\u5931\u8d25|\u51fa\u56fe(?:\u65f6)?\u53d1\u751f\u4e86?\u751f\u6210\u9519\u8bef|\u751f\u6210\u9519\u8bef)/i.test(latestText);
      if (explicitImageFailure) {
        return { urls, confident: false, settled: false, generating: pageGenerating, stableFor: 0, evidence: "failed-image-response", completion };
      }
      const keywordHit = completionKeywordDetected(latestText, { action: "wait-images", keywordPattern }).matched;
      if (completion?.hardFailure && urls.length > previousCount) {
        const reason = completion.riskReason;
        const isScriptLimit = reason === "script-output-limit";
        const isScript = reason === "script-output" || reason === "script-output-only";
        const isPyScriptFallback = reason === "py-script-fallback";
        const isRejectedDraftLoop = reason === "rejected-draft-loop";
        const error = new Error(isScriptLimit
          ? "检测到纯脚本/沙盒产物输出而非原生生图，已按生图触顶处理并停止本帖"
          : isScript
          ? "检测到代码解释器/脚本文件输出而非原生生图，已停止本帖"
          : isPyScriptFallback
          ? `检测到 GPT 使用 PY 代码兜底拼接垃圾图(不是大模型原生生图)，疑似撞到生图上限；已停止本帖(本轮 ${urls.length} 张)`
          : "检测到重试、限额或生成失败信号，已停止本帖");
        if (isRejectedDraftLoop) {
          error.message = `检测到 GPT 连续否定并返工同一页，当前 ${urls.length} 张包含废稿，不能当作完整作品；已停止并保留当前素材`;
        }
        error.code = isRejectedDraftLoop
          ? "IMAGE_DRAFT_REJECTED"
          : isScript && !isScriptLimit ? "SCRIPT_GENERATED_OUTPUT" : "GENERATION_LIMIT_SIGNAL";
        error.detectedImages = urls.length;
        error.riskReason = reason;
        logGptLimitDebug("wait-images-hard-failure", {
          code: error.code,
          riskReason: reason,
          detectedImages: urls.length,
          previousCount,
          expectedCount,
          evidence: completion?.responseComplete ? "response-complete" : "risk-signal",
          completion
        });
        throw error;
      }
      const signatureChanged = signature !== lastSignature;
      quietWithoutCompletionSince = nextContinuousImageIdleSince({
        previous: quietWithoutCompletionSince,
        now: Date.now(),
        generating: pageGenerating,
        signatureChanged
      });
      if (urls.length > previousCount && signature === lastSignature && !pageGenerating) {
        if (!stableSince) stableSince = Date.now();
      } else {
        stableSince = 0;
        lastSignature = signature;
      }
      const stableFor = stableSince ? Date.now() - stableSince : 0;
      const requiredCount = Math.max(
        Math.max(0, Number(expectedCount || 0)),
        Math.max(0, Number(completion?.declaredCount || 0))
      );
      const reachedExpected = requiredCount > 0 && urls.length >= requiredCount;
      const responseQuietComplete = Boolean(completion?.responseComplete) && stableFor >= 45_000;
      // For a partial result, the normal 45-second toolbar/keyword quiet
      // period is not enough: the page may have rendered only the first
      // thumbnails while the same reply is still receiving the rest.  Full
      // batches keep the fast path; partial batches require the longer grace
      // window before recovery is even considered.
      const partialResponseQuietComplete = !reachedExpected
        && stableFor >= partialQuietMs
        && Boolean(completion?.responseComplete || keywordHit);
      const completeEvidence = reachedExpected
        ? ((reachedExpected && stableFor >= 8_000) || responseQuietComplete || (keywordHit && stableFor >= keywordQuietMs))
        : partialResponseQuietComplete;
      if (urls.length > previousCount && completeEvidence) {
        return {
          urls,
          confident: reachedExpected || Boolean(completion?.responseComplete || keywordHit),
          settled: true,
          generating: false,
          stableFor,
          evidence: reachedExpected
            ? (keywordHit ? "keyword-complete" : "expected-and-declared-count")
            : "assistant-response-quiet-complete-partial",
          completion
        };
      }
      // Compatibility fallback for a future ChatGPT DOM change: wait three
      // full minutes of no URL changes. The caller may continue with a safe
      // image count, but a low count without completion evidence must never
      // be promoted to an account-limit signal.
      if (urls.length > previousCount && !pageGenerating && quietWithoutCompletionSince
        && Date.now() - quietWithoutCompletionSince >= 180_000) {
        return { urls, confident: false, settled: true, generating: false, stableFor, evidence: "long-quiet-fallback", completion };
      }
      await waitForTaskDelay(1_000);
    }
    const detectionOptions = {
      fullDocumentFallback: true,
      baselineAssistantTurnKeys: options.baselineAssistantTurnKeys,
      baselineAssistantTurns: options.baselineAssistantTurns
    };
    observedImageUrls = uniqueGeneratedImageUrls([
      ...observedImageUrls,
      ...freshGeneratedImageUrls(baselineUrls, detectionOptions)
    ]);
    const urls = limitGeneratedImageUrls(observedImageUrls, expectedCount);
    return {
      urls,
      confident: false,
      settled: false,
      generating: generatingNow(),
      stableFor: 0,
      evidence: "timeout",
      completion: generatedImageCompletionEvidence(urls, detectionOptions)
    };
  }

  function generatingNow() {
    // Only trust a visible, explicit stop/stream control or an actual streaming
    // marker. Historical replies often contain words such as “生成/停止” in
    // their toolbar text; matching arbitrary button text made a fresh task wait
    // forever even though the composer was idle.
    const streamingMarker = [...document.querySelectorAll(
      '[data-message-author-role="assistant"][data-is-streaming="true"]',
      '.result-streaming',
      '[data-testid*="streaming" i]'
    )].some((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (streamingMarker) return true;
    return [...document.querySelectorAll("button")].some((button) => {
      const rect = button.getBoundingClientRect();
      const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.getAttribute("data-testid") || ""}`;
      if (/composer|voice|microphone|dictation|语音|听写/i.test(label)) return false;
      const inViewport = rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.right > 0
        && rect.top < window.innerHeight && rect.left < window.innerWidth;
      const currentComposerStop = button.id === "composer-submit-button"
        || button.getAttribute("data-testid") === "stop-button";
      return isActiveGenerationControl({
        visible: inViewport || currentComposerStop,
        disabled: button.disabled,
        label
      });
    });
  }

  const PREVIOUS_POST_IDLE_WAIT_LIMIT_MS = 3 * 60_000;

  async function persistFiniteWaitCheckpoint(task, timing, stage, percent = 2) {
    const requestId = String(task?.entry?.externalRequestId || "").trim();
    if (!requestId) return null;
    const saved = await api(`/api/gpt-production/checkpoint?requestId=${encodeURIComponent(requestId)}`).catch(() => null);
    return api("/api/gpt-production/checkpoint", {
      method: "POST",
      body: JSON.stringify({
        requestId,
        checkpoint: {
          ...(saved?.checkpoint || {}),
          stage,
          percent,
          conversationUrl: location.href,
          sourceMaterialPath: String(task.entry.materialPath || task.entry.path || ""),
          workflowStepHistory: Array.isArray(task.workflowStepHistory) ? task.workflowStepHistory.slice(-64) : [],
          workflowStepAttempts: task.workflowStepAttempts && typeof task.workflowStepAttempts === "object" ? task.workflowStepAttempts : {},
          stepTiming: timing && typeof timing === "object" ? { ...timing } : null
        }
      })
    }).catch(() => null);
  }

  function startFiniteWaitTiming(task, action, timeoutMs) {
    const startedMs = Date.now();
    task.workflowStepAttempts = task.workflowStepAttempts && typeof task.workflowStepAttempts === "object"
      ? task.workflowStepAttempts
      : {};
    task.workflowStepHistory = Array.isArray(task.workflowStepHistory) ? task.workflowStepHistory : [];
    const attempt = Math.max(1, Number(task.workflowStepAttempts[action] || 0) + 1);
    task.workflowStepAttempts[action] = attempt;
    const timing = {
      action,
      status: "running",
      attempt,
      startedMs,
      startedAt: new Date(startedMs).toISOString(),
      timeoutMs,
      deadlineAt: new Date(startedMs + timeoutMs).toISOString(),
      endedAt: "",
      elapsedMs: 0,
      timeoutTriggered: false
    };
    task.stepTiming = timing;
    task.workflowStepHistory.push({ ...timing });
    if (task.workflowStepHistory.length > 64) task.workflowStepHistory = task.workflowStepHistory.slice(-64);
    return timing;
  }

  async function finishFiniteWaitTiming(task, timing, status, error = null) {
    if (!timing) return;
    timing.status = status;
    timing.endedAt = new Date().toISOString();
    timing.elapsedMs = Math.max(0, Date.now() - Number(timing.startedMs || Date.now()));
    if (status === "timeout") timing.timeoutTriggered = true;
    if (Array.isArray(task.workflowStepHistory) && task.workflowStepHistory.length) {
      task.workflowStepHistory[task.workflowStepHistory.length - 1] = { ...timing };
    }
    logConversationEvent(status === "completed" ? "step-completed" : status === "timeout" ? "step-timeout" : "step-failed", {
      requestId: task?.entry?.externalRequestId || "",
      account: task?.entry?.accountId || "",
      conversationUrl: location.href,
      materialName: task?.entry?.name || "",
      step: timing.action,
      status,
      startedAt: timing.startedAt,
      endedAt: timing.endedAt,
      elapsedMs: timing.elapsedMs,
      deadlineAt: timing.deadlineAt,
      waitLimitMs: timing.timeoutMs,
      attempt: timing.attempt,
      meta: { reason: error?.code || error?.message || "" }
    });
    await persistFiniteWaitCheckpoint(task, timing, status === "completed" ? "网页已空闲" : "等待上一帖完成超时", 2);
  }

  async function waitForPageIdleBeforeFreshUpload(task, timeout = 10 * 60_000) {
    if (!generatingNow()) return true;
    // This gate runs before the regular upload-material workflow wrapper. It
    // therefore needs its own durable deadline; otherwise the generic
    // heartbeat sees a frozen pre-submit stage and cancels it first.
    const timeoutMs = Math.min(
      PREVIOUS_POST_IDLE_WAIT_LIMIT_MS,
      Math.max(30_000, Number(timeout || PREVIOUS_POST_IDLE_WAIT_LIMIT_MS))
    );
    const timing = startFiniteWaitTiming(task, "wait-previous-post-idle", timeoutMs);
    reportWorkbenchProgress(
      task,
      "等待上一帖完成",
      2,
      `当前 GPT 仍在生成上一条回复；本帖尚未上传，最多等待 ${Math.ceil(timeoutMs / 1000)} 秒`
    );
    logConversationEvent("step-started", {
      requestId: task?.entry?.externalRequestId || "",
      account: task?.entry?.accountId || "",
      conversationUrl: location.href,
      materialName: task?.entry?.name || "",
      step: timing.action,
      status: "running",
      startedAt: timing.startedAt,
      deadlineAt: timing.deadlineAt,
      waitLimitMs: timeoutMs,
      attempt: timing.attempt,
      meta: { gate: "previous-post-idle", recovery: "bounded" }
    });
    await persistFiniteWaitCheckpoint(task, timing, "等待上一帖完成", 2);
    const started = Date.now();
    let idleSince = 0;
    try {
      while (Date.now() - started < timeoutMs) {
        const pauseReason = platformPauseReason();
        if (pauseReason) throw new Error(pauseReason);
        if (!generatingNow()) {
          if (!idleSince) idleSince = Date.now();
          if (Date.now() - idleSince >= 3_000) {
            await finishFiniteWaitTiming(task, timing, "completed");
            return true;
          }
        } else {
          idleSince = 0;
        }
        await waitForTaskDelay(1_000);
      }
      const error = new Error(`上一帖在 ${Math.ceil(timeoutMs / 1000)} 秒内仍未完成，本帖没有上传；已保留检查点并进入受控恢复`);
      error.code = "WEB_RESPONSE_IN_FLIGHT";
      error.waitLimitMs = timeoutMs;
      error.deadlineAt = timing.deadlineAt;
      await finishFiniteWaitTiming(task, timing, "timeout", error);
      reportWorkbenchProgress(task, "等待上一帖完成", 2, error.message, "failed");
      throw error;
    } catch (error) {
      if (timing.status === "running") await finishFiniteWaitTiming(task, timing, "failed", error);
      throw error;
    }
  }

  function platformPauseReason() {
    if (/\/auth\/(?:login|signup)|\/login(?:[/?#]|$)/i.test(location.href)) {
      return "GPT 登录状态已失效，请重新登录后继续";
    }
    const visibleAlerts = [...document.querySelectorAll(
      '[role="alert"], [role="dialog"], [data-sonner-toast], [data-testid*="modal"], [data-testid*="dialog"]'
    )].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const message = visibleAlerts.map((node) => String(node.innerText || node.textContent || "")).join("\n");
    if (/too many requests|rate limit|usage limit|try again later|请求过多|达到.*上限|稍后再试/i.test(message)) {
      return "GPT 当前出现频率或额度限制，队列已暂停";
    }
    if (/verify you are human|security check|验证码|安全验证|完成验证/i.test(message)) {
      return "GPT 需要完成登录或安全验证，队列已暂停";
    }
    return "";
  }

  function sendButton() {
    const target = composer();
    const scope = target?.closest('[data-composer-surface]')
      || target?.closest("form")
      || target?.parentElement
      || document;
    const selectors = [
      '#composer-submit-button:not(:disabled)',
      '[data-testid="send-button"]:not(:disabled)',
      '[data-testid="composer-send-button"]:not(:disabled)',
      '[data-testid="composer-submit-button"]:not(:disabled)',
      '[data-testid*="send-button"]:not(:disabled)',
      '[data-testid*="submit-button"]:not(:disabled)',
      'button[aria-label="Send prompt"]:not(:disabled)',
      'button[aria-label="发送提示词"]:not(:disabled)',
      'button[aria-label="发送"]:not(:disabled)',
      'button[aria-label*="Send" i]:not(:disabled)',
      'button[aria-label*="发送"]:not(:disabled)',
      'button[type="submit"]:not(:disabled)'
    ];
    for (const sel of selectors) {
      const btn = scope.querySelector(sel) || document.querySelector(sel);
      if (btn) return btn;
    }
    // ChatGPT new unified composer: the submit button shares position with voice button.
    // Detect by class but exclude voice-mode buttons (aria-label contains 语音/voice).
    const composerSubmitBtn = [...scope.querySelectorAll("button:not(:disabled)")].find((button) => {
      const className = String(button.className || "");
      const ariaLabel = String(button.getAttribute("aria-label") || "");
      const style = button.getAttribute("style") || "";
      if (!className.includes("composer-submit-button")) return false;
      // Exclude voice buttons
      if (/语音|voice|speech/i.test(ariaLabel)) return false;
      if (/--vt-composer-speech-button/i.test(style)) return false;
      // Also check SVG: voice buttons have microphone/voice icons, send buttons have arrow/send icons
      const svgHref = button.querySelector("use")?.getAttribute("href") || "";
      if (/voice|microphone|speech/i.test(svgHref)) return false;
      return true;
    });
    if (composerSubmitBtn) return composerSubmitBtn;
    return [...scope.querySelectorAll("button:not(:disabled)")].find((button) => {
        const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.getAttribute("data-testid") || ""}`;
        return /send|submit|发送|提交/i.test(label);
      })
      || [...document.querySelectorAll("button:not(:disabled)")].find((button) => {
        const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.getAttribute("data-testid") || ""}`;
        return /send|submit|发送|提交/i.test(label);
      });
  }

  async function submitComposer() {
    const target = composer();
    if (!target) throw new Error("没有找到当前 GPT 输入框");
    const beforeUserCount = document.querySelectorAll('[data-message-author-role="user"]').length;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const button = await waitFor(() => sendButton(), 15_000);
      if (button) button.click();
      else {
        target.focus();
        target.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
        }));
      }
      const submitted = await waitFor(
        () => document.querySelectorAll('[data-message-author-role="user"]').length > beforeUserCount
          || (!composerDraftText() && attachmentPreviewCount() === 0),
        12_000
      );
      if (submitted) return true;
      await waitForTaskDelay(2_000);
    }
    throw new Error("GPT 发送按钮已出现，但没有检测到新消息；任务已暂停，避免重复发送");
  }

  function turnSignature(turns = []) {
    return turns.map((turn) => {
      const text = String(turn.innerText || turn.textContent || "").trim();
      return `${text.length}:${turn.querySelectorAll("img").length}`;
    }).join("|");
  }

  function assistantTurnKey(turn, index = 0) {
    const wrapper = turn?.closest?.('[data-testid^="conversation-turn"]');
    const stableId = wrapper?.getAttribute?.("data-testid")
      || turn?.getAttribute?.("data-message-id")
      || turn?.id;
    if (stableId) return String(stableId);
    const text = String(turn?.innerText || turn?.textContent || "").trim();
    return `fallback-${index}-${text.slice(0, 80)}-${text.length}`;
  }

  function assistantTurnKeys(turns = assistantTurns()) {
    return turns.map(assistantTurnKey);
  }

  function replyHasCompletionAction(turn) {
    const root = replyScopes(turn).at(-1) || turn;
    return Boolean(root?.querySelector?.([
      '[data-testid="copy-turn-action-button"]',
      'button[aria-label*="复制回复"]',
      'button[aria-label*="Copy response" i]'
    ].join(",")));
  }

  function migrationPlanHasCompletionMarker(text) {
    return /(?:暂不出图|等待(?:你|您)?(?:回复|输入|确认)\s*[“"']?1|请(?:回复|输入|发送)\s*[“"']?1|回复\s*[“"']?1)/i.test(String(text || ""));
  }

  async function waitForAssistantCompletion(beforeCount, options = {}) {
    const timeout = Math.max(30_000, Number(options.timeout || 15 * 60_000));
    const needImages = Boolean(options.needImages);
    const minTextLength = Math.max(1, Number(options.minTextLength ?? 20));
    // Plans are long and GPT can briefly expose the copy action before the
    // final page headings/constraints have finished rendering. Callers may
    // request a longer quiet window for this boundary; the production plan
    // uses 8s so a partial plan cannot trigger "1" or the next upload.
    const completionQuietMs = Math.max(2_500, Number(options.completionQuietMs || 2_500));
    const keywordAction = String(options.keywordAction || "").trim();
    const keywordPattern = String(options.keywordPattern || "").trim();
    const keywordQuietMs = Math.max(1_000, Number(options.keywordQuietMs || completionQuietMs));
    const started = Date.now();
    const baselineKeys = new Set(Array.isArray(options.baselineKeys) ? options.baselineKeys : []);
    let stableSince = 0;
    let lastSignature = "";
    let generatingStableSince = 0;
    let lastGeneratingSignature = "";
    let threadErrorRetried = false;
    while (Date.now() - started < timeout) {
      const pauseReason = platformPauseReason();
      if (pauseReason) throw new Error(pauseReason);
      const anchoredTurns = assistantTurnsAfter(options.afterTurn);
      const turns = options.afterTurn?.isConnected ? anchoredTurns : assistantTurns();
      const freshTurns = options.afterTurn?.isConnected
        ? turns
        : baselineKeys.size
        ? turns.filter((turn, index) => !baselineKeys.has(assistantTurnKey(turn, index)))
        : turns.slice(beforeCount);
      const signature = turnSignature(freshTurns);
      const imageCount = freshTurns.reduce((sum, turn) => sum + turn.querySelectorAll("img").length, 0);
      const hasContent = freshTurns.length > 0 && freshTurns.some((turn) =>
        String(turn.innerText || turn.textContent || "").trim().length >= minTextLength || turn.querySelector("img")
      );
      if (signature && signature === lastSignature && !generatingNow()) {
        if (!stableSince) stableSince = Date.now();
      } else {
        stableSince = 0;
        lastSignature = signature;
      }
      const latestFreshTurn = freshTurns.at(-1);
      const freshText = freshTurns.map(cleanAssistantText).join("\n").trim();
      const meaningfulFreshTurnCount = freshTurns.filter((turn) =>
        String(cleanAssistantText(turn) || "").trim().length >= minTextLength
        || Boolean(turn.querySelector("img"))
      ).length;
      const generating = generatingNow();
      if (generating) {
        if (signature && signature === lastGeneratingSignature) {
          if (!generatingStableSince) generatingStableSince = Date.now();
        } else {
          lastGeneratingSignature = signature;
          generatingStableSince = Date.now();
        }
      } else {
        generatingStableSince = 0;
        lastGeneratingSignature = "";
      }
      const stalledGeneratingRecoveryMs = Math.max(0, Number(options.stalledGeneratingRecoveryMs || 0));
      if (stalledGeneratingRecoveryMs > 0 && shouldStopStalledSilentGeneration({
        generating,
        stableForMs: generatingStableSince ? Date.now() - generatingStableSince : 0,
        thresholdMs: stalledGeneratingRecoveryMs,
        meaningfulTurnCount: meaningfulFreshTurnCount
      })) {
        const stopButton = visibleGenerationStopButton();
        if (stopButton && !stopButton.disabled) stopButton.click();
        api("/api/gpt-production/dom-snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "stalled-silent-generation-stopped", elapsedMs: Date.now() - started })
        }).catch(() => {});
        await waitFor(() => !generatingNow(), 10_000);
        return { turns: [], imageCount: 0, responseComplete: false, stableFor: 0, keywordHit: false, silentResponse: true, stalledSilentGeneration: true };
      }
      const repetitiveLoop = options.repetitiveLoopRecovery === false
        ? { detected: false, token: "", repeats: 0 }
        : detectRepetitiveAssistantLoop(freshText, 8);
      if (repetitiveLoop.detected && generatingNow()) {
        const stopButton = visibleGenerationStopButton();
        if (stopButton && !stopButton.disabled) stopButton.click();
        api("/api/gpt-production/dom-snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "repetitive-assistant-loop-stopped", ...repetitiveLoop })
        }).catch(() => {});
        await waitFor(() => !generatingNow(), 10_000);
        return { turns: freshTurns, imageCount, responseComplete: true, stableFor: 0, keywordHit: false, repetitiveLoop };
      }
      const threadErrorRetryButton = document.querySelector('[data-testid="regenerate-thread-error-button"]');
      const threadErrorRetryMs = Math.max(0, Number(options.threadErrorRetryMs || 0));
      if (threadErrorRetryMs > 0 && shouldRetryThreadError({
        elapsedMs: Date.now() - started,
        thresholdMs: threadErrorRetryMs,
        retryVisible: Boolean(threadErrorRetryButton && !threadErrorRetryButton.disabled),
        freshTurnCount: meaningfulFreshTurnCount,
        alreadyRetried: threadErrorRetried
      })) {
        threadErrorRetried = true;
        threadErrorRetryButton.click();
        api("/api/gpt-production/dom-snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "native-thread-error-retry", elapsedMs: Date.now() - started })
        }).catch(() => {});
        await waitForTaskDelay(1_000);
        continue;
      }
      const keywordHit = keywordAction
        ? completionKeywordDetected(freshText, { action: keywordAction, keywordPattern }).matched
        : false;
      const responseComplete = replyHasCompletionAction(latestFreshTurn);
      const stableFor = stableSince ? Date.now() - stableSince : 0;
      if (shouldRecoverSilentAssistant({
        elapsedMs: Date.now() - started,
        thresholdMs: Number(options.silentResponseRecoveryMs || 0),
        freshTurnCount: meaningfulFreshTurnCount,
        generating: generatingNow(),
        composerEmpty: !composerDraftText() && attachmentPreviewCount() === 0
      }) && Number(options.silentResponseRecoveryMs || 0) > 0) {
        return { turns: [], imageCount: 0, responseComplete: false, stableFor: 0, keywordHit: false, silentResponse: true };
      }
      const plannedImageCountReady = !options.requirePlannedImageCount
        || parsePlannedImageCount(freshText) > 0;
      // A completed but malformed/short plan must be returned to the plan
      // classifier after the same quiet window. Otherwise the missing page
      // count keeps this generic waiter asleep for the full eight-minute
      // timeout before the existing current-post recovery can run.
      const incompletePlanSettled = Boolean(
        options.requirePlannedImageCount
        && responseComplete
        && stableFor >= Math.max(8_000, completionQuietMs)
      );
      if (hasContent && (!needImages || imageCount > 0) && stableSince
        && (plannedImageCountReady || incompletePlanSettled)
        && ((responseComplete && stableFor >= completionQuietMs)
          || (keywordHit && stableFor >= keywordQuietMs)
          || stableFor >= Math.max(8_000, completionQuietMs))) {
        return { turns: freshTurns, imageCount, responseComplete: responseComplete || keywordHit, stableFor, keywordHit };
      }
      await waitForTaskDelay(1_000);
    }
    throw new Error(needImages ? "等待套图完成超时，尚未检测到稳定图片结果" : "等待 GPT 回复完成超时");
  }

  function workPackageBatchId() {
    const now = new Date();
    const digits = (value) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}${digits(now.getMonth() + 1)}${digits(now.getDate())}-${digits(now.getHours())}${digits(now.getMinutes())}${digits(now.getSeconds())}`;
    return `${stamp}-${Math.random().toString(36).slice(2, 6).padEnd(4, "0")}`;
  }

  function imageUrl(image, options = {}) {
    if (!image) return "";
    const candidate = String(image.currentSrc || image.src || image.getAttribute?.("src") || "").trim();
    if (!/^(?:https?:|blob:|data:image\/)/i.test(candidate)) return "";
    if (/data:image\/svg/i.test(candidate)) return "";
    const width = Number(image.naturalWidth || image.width || image.getBoundingClientRect?.().width || 0);
    const height = Number(image.naturalHeight || image.height || image.getBoundingClientRect?.().height || 0);
    if (!options.allowSmall && width && height && (width < 160 || height < 160)) return "";
    return candidate;
  }

  function freshImageUrls(turns) {
    // ChatGPT currently renders generated sandbox files beside the inner
    // assistant message node, inside the outer conversation-turn wrapper.
    // Recovery is scoped to a single reply, so scan that wrapper as well as
    // the inner message.  A document-wide fallback would risk binding images
    // from an older reply in the same long conversation.
    const scopes = [...new Set(turns.flatMap((turn) => {
      const wrapper = turn?.closest?.('[data-testid^="conversation-turn"]');
      return wrapper && wrapper !== turn ? [turn, wrapper] : [turn];
    }).filter(Boolean))];
    const buttons = [...new Set(scopes.flatMap((scope) => [
      ...scope.querySelectorAll(".cgpt-conversation-tree-image-download-all")
    ]))];
    const imagesFromDownloadButtons = buttons.flatMap((button) => {
      const containers = [...new Set([
        button.__cgptImageDownloadContainer,
        button.closest("[data-cgpt-image-download-container]"),
        button.closest('[data-message-author-role="assistant"]'),
        button.closest('[data-turn="assistant"]'),
        button.parentElement
      ].filter(Boolean))];
      // The vendor helper keeps a best-effort element list, but ChatGPT can
      // replace carousel nodes after the button is injected. Always merge the
      // live container images instead of trusting only that cached list.
      return [
        ...(Array.isArray(button.__cgptImageDownloadImages) ? button.__cgptImageDownloadImages : []),
        ...containers.flatMap((container) => [...container.querySelectorAll("img")])
      ];
    });
    const images = imagesFromDownloadButtons.length
      ? imagesFromDownloadButtons
      : scopes.flatMap((scope) => [...scope.querySelectorAll("img")]);
    return uniqueGeneratedImageUrls([
      // Download-container images are known generated thumbnails, including
      // 48px previews. Keep the conservative size filter only for generic DOM
      // fallback where avatars/icons may be present.
      ...images.map((image) => imageUrl(image, { allowSmall: imagesFromDownloadButtons.length > 0 })).filter(Boolean),
      ...scopes.flatMap((scope) => generatedImageArtifacts(scope).map((artifact) => artifact.url))
    ]);
  }

  // Signed ChatGPT image responses can be labelled application/octet-stream.
  // Verify generic payloads by magic bytes before accepting them as images.
  function sniffImageContentType(bytes) {
    if (!bytes || bytes.length < 4) return "";
    if (bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
    if (bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return "";
  }

  function downloadThroughExtension(url, filename, requestId, downloadRoot = "", timeout = 5 * 60_000) {
    if (isEmbeddedWorkbench()) {
      return (async () => {
        const response = await fetchImageWithTimeout(url);
        if (!response.ok) throw new Error(`图片读取失败：HTTP ${response.status}`);
        const headerType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
        const buffer = await response.arrayBuffer();
        const contentType = /^image\//i.test(headerType) ? headerType : sniffImageContentType(new Uint8Array(buffer));
        if (!/^image\//i.test(contentType)) throw new Error(`图片响应类型无效：${contentType}`);
        const data = bufferToBase64(buffer);
        let result;
        try {
          result = await api("/api/extension/save-generated-image", {
            method: "POST",
            body: JSON.stringify({ filename, requestId, contentType, data, sourceUrl: url, downloadRoot })
          });
        } catch (error) {
          if (/同批次图片已经存在|图片已经存在|already exists/i.test(String(error?.message || ""))) {
            return filename;
          }
          throw error;
        }
        if (!result?.ok || !result.filename) throw new Error(result?.error || "工作台没有保存生成图片");
        return result.filename;
      })();
    }
    return new Promise((resolve, reject) => {
      let timer = null;
      const finish = (callback, value) => {
        if (timer) clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(onMessage);
        callback(value);
      };
      const onMessage = (message) => {
        if (message?.type !== "tb-download-status" || message.requestId !== requestId) return;
        if (message.status === "complete") finish(resolve, message.filename || filename);
        if (message.status === "error") finish(reject, new Error(message.error || "图片下载失败"));
      };
      chrome.runtime.onMessage.addListener(onMessage);
      timer = setTimeout(() => finish(reject, new Error(`图片下载超时：${filename}`)), timeout);
      chrome.runtime.sendMessage({
        type: "tb-download",
        url,
        filename,
        requestId,
        baseUrl: currentApiRoot()
      }).then((result) => {
        if (!result?.ok) finish(reject, new Error(result?.error || "无法启动图片下载"));
      }).catch((error) => finish(reject, error));
    });
  }

  // The visible manual buttons and the automatic state machine must share the
  // same authenticated page-fetch + workbench-save path. Browser downloads of
  // signed ChatGPT image URLs can lose request credentials after a long reply.
  globalThis.TeambuildingGptProductionDownload = ({ url, filename, requestId = "", downloadRoot = "" } = {}) => (
    downloadThroughExtension(
      String(url || ""),
      String(filename || ""),
      String(requestId || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      String(downloadRoot || "")
    )
  );

  async function packageDownloadedReply(options = {}) {
    const clipboardText = String(options.clipboardText || "").trim();
    if (!clipboardText) throw new Error("请先复制或下载本轮文案 TXT，再执行下载并打包");
    const result = await api("/api/extension/work-package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clipboardText,
        title: String(options.title || ""),
        conversationUrl: String(options.conversationUrl || location.href),
        accountName: String(options.accountName || localStorage.getItem("tb-workbench-account-id") || ""),
        sourceMaterialPath: String(options.sourceMaterialPath || ""),
        batchId: String(options.batchId || ""),
        expectedImageCount: Math.max(0, Number(options.expectedImageCount || 0)),
        downloadRoot: String(options.downloadRoot || ""),
        productRoot: String(options.productRoot || "")
      })
    });
    if (!result?.ok) throw new Error(result?.error || "本地打包没有返回成功");
    return result;
  }

  // Manual reply buttons and automatic production intentionally call this
  // single package bridge.  Their only difference is who starts the action.
  globalThis.TeambuildingGptProductionPackage = packageDownloadedReply;

  // Manual packaging follows the same ordering as automatic production:
  // persist the validated copy text locally before image download starts.
  globalThis.TeambuildingGptProductionSaveCopyText = async ({ copyText = "", batchId = "", downloadRoot = "" } = {}) => {
    const result = await api("/api/extension/save-copy-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        copyText: String(copyText || ""),
        batchId: String(batchId || ""),
        downloadRoot: String(downloadRoot || "")
      })
    });
    if (!result?.ok || !result.filename) throw new Error(result?.error || "本轮文案 TXT 保存失败");
    return result;
  };

  async function downloadFreshImages(turnsOrUrls, task) {
    reportWorkbenchProgress(task, "下载图片", 68, "正在核对本轮新生成图片");
    const urls = Array.isArray(turnsOrUrls) && turnsOrUrls.every((item) => typeof item === "string")
      ? uniqueGeneratedImageUrls(turnsOrUrls)
      : freshImageUrls(turnsOrUrls || []);
    if (!urls.length) throw new Error("检测到生成结果，但没有找到本轮可下载图片");
    const batchId = String(task.workflow?.batchId || (task.workflow.batchId = workPackageBatchId()));
    const files = [];
    for (let index = 0; index < urls.length; index += 1) {
      const url = await resolveSandboxArtifactUrl(urls[index]);
      const extensionMatch = url.match(/\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i);
      const extension = extensionMatch ? extensionMatch[1].toLowerCase().replace("jpeg", "jpg") : "png";
      const filename = `chatgpt-workpkg-${batchId}-${index + 1}-of-${urls.length}.${extension}`;
      const requestId = `${task.entry.externalRequestId || batchId}-image-${index + 1}`;
      const backgroundCopyRequested = Boolean(task.workflow?.textSubmitted);
      reportWorkbenchProgress(
        task,
        backgroundCopyRequested ? "图片后台下载" : "下载图片",
        (backgroundCopyRequested ? 76 : 68) + Math.round(index / urls.length * (backgroundCopyRequested ? 4 : 8)),
        backgroundCopyRequested ? `文案请求已发送；图片后台下载 ${index + 1}/${urls.length}` : `正在下载 ${index + 1}/${urls.length}`
      );
      try {
        files.push(await downloadThroughExtension(url, filename, requestId, String(task.entry.autoOptions?.downloadRoot || "")));
      } catch (error) {
        // A restart can leave the durable log with an expired signed URL even
        // though the same ChatGPT file is still visible in the live page.
        // Re-read the current DOM and retry only the same file identity; never
        // substitute an unrelated historical image by position.
        const refreshedUrls = uniqueGeneratedImageUrls(freshGeneratedImageUrls([], {
          fullDocumentFallback: true
        }));
        const refreshedUrl = refreshedUrls.find((candidate) =>
          generatedImageIdentity(candidate) === generatedImageIdentity(url)
          && candidate !== url
        );
        if (!refreshedUrl) throw error;
        logConversationEvent("image-url-refreshed-for-download", {
          requestId: task.entry.externalRequestId || "",
          materialName: task.entry.name || "",
          step: "download-images",
          imageUrls: [refreshedUrl],
          meta: { index: index + 1, total: urls.length, reason: String(error?.message || "") }
        });
        const refreshedArtifactUrl = await resolveSandboxArtifactUrl(refreshedUrl);
        files.push(await downloadThroughExtension(
          refreshedArtifactUrl,
          filename,
          requestId,
          String(task.entry.autoOptions?.downloadRoot || "")
        ));
      }
    }
    if (files.length !== urls.length) throw new Error(`图片下载不完整：${files.length}/${urls.length}`);
    document.dispatchEvent(new CustomEvent("tb-gpt-image-download-complete", {
      detail: {
        urls,
        downloaded: files.length,
        total: Math.max(files.length, Number(task?.workflow?.plannedImageCount || 0)),
        batchId,
        state: "downloaded",
        source: "automatic"
      }
    }));
    return { count: files.length, batchId, files };
  }

  function cleanAssistantText(turn) {
    if (!turn) return "";
    const visibleText = String(turn.innerText || turn.textContent || "").trim();
    const clone = turn.cloneNode(true);
    clone.querySelectorAll("button, svg, img, [aria-hidden='true'], .cgpt-conversation-tree-image-download-slot, .cgpt-conversation-tree-text-download-slot")
      .forEach((node) => node.remove());
    const cleanedText = String(clone.innerText || clone.textContent || "").trim();
    // ChatGPT sometimes wraps the only visible answer inside an aria-hidden
    // subtree while a separate accessibility mirror owns the semantic turn.
    // Removing chrome from a detached clone can therefore erase a perfectly
    // visible long-form reply. Prefer the cleaned clone when it retained real
    // content, otherwise fall back to the connected turn's visible text.
    const sourceText = cleanedText.length >= Math.min(80, Math.ceil(visibleText.length / 3)) ? cleanedText : visibleText;
    return sourceText
      .replace(/^\s*(ChatGPT|助手)\s*/i, "")
      .replace(/^\s*说[：:]\s*/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function completedCopyBoundaryForCurrentMaterial(entry = {}) {
    const turns = conversationRoleTurns();
    let materialIndex = -1;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (conversationTurnRole(turn) !== "user") continue;
      const text = normalizeDraft(turn.innerText || turn.textContent || "");
      if (isAutomationMaterialPrompt(text)) {
        materialIndex = index;
        break;
      }
    }
    if (materialIndex < 0) return null;
    const materialText = normalizeDraft(turns[materialIndex].innerText || turns[materialIndex].textContent || "");
    if (archivedAutomationBoundaryMatchesLive(readArchivedAutomationBoundary(), materialText)) return null;
    const assistantTurnsAfterMaterial = turns
      .slice(materialIndex + 1)
      .filter((turn) => conversationTurnRole(turn) === "assistant");
    const evidence = findCompletedCopyBoundary(
      assistantTurnsAfterMaterial.map(cleanAssistantText),
      300
    );
    if (!evidence.found) return null;
    const identity = patrolMaterialCopyIdentity({
      materialName: entry.name || "",
      sourceMaterialPath: entry.materialPath || entry.path || "",
      copyText: evidence.text
    });
    return { ...evidence, materialIndex, materialText, identity };
  }

  async function runAutomaticProduction(task) {
    throwIfTaskAborted(task);
    const options = task.entry.autoOptions || {};
    // `taskTimeoutMinutes` is retained as a compatibility/attention setting.
    // It must not be used as a hard whole-work timeout: the real workflow is
    // bounded by its stage deadlines and recovery chain, and a slow but
    // progressing image batch must survive a renderer restart.
    const taskAttentionLineMs = Math.max(5, Number(options.workflowAttentionMinutes || options.taskTimeoutMinutes || 20)) * 60_000;
    // A forced upload is an explicit new-post boundary.  After a renderer
    // restart ChatGPT can still expose the previous post's archived DOM while
    // this task is attaching its own files.  Never adopt that stale boundary
    // as this task's plan/image checkpoint, otherwise the runner jumps straight
    // to image recovery and loops on IMAGE_RECOVERY_BOUNDARY_MISSING.
    const forceFreshWorkflow = Boolean(task.entry?.forceUpload);
    const workflow = forceFreshWorkflow
      ? (task.workflow = {})
      : (task.workflow || (task.workflow = {}));
    let currentPlanPromptTurn = null;
    const logTaskConversationEvent = (event, data = {}) => {
      const now = Date.now();
      const metrics = task.metrics || {};
      const current = metrics.current || {};
      const timing = task.stepTiming || {};
      return logConversationEvent(event, {
        requestId: task.entry.externalRequestId || "",
        account: task.entry.accountId || "",
        materialName: task.entry.name || "",
        conversationUrl: location.href,
        step: timing.action || current.stage || "",
        status: timing.status || current.status || "",
        startedAt: metrics.startedAt || "",
        stageStartedAt: timing.startedAt || current.startedAt || "",
        elapsedMs: metrics.startedMs ? now - metrics.startedMs : 0,
        stageElapsedMs: (timing.startedMs || current.startedMs) ? now - (timing.startedMs || current.startedMs) : 0,
        deadlineAt: timing.deadlineAt || current.deadlineAt || "",
        waitLimitMs: timing.timeoutMs || current.waitLimitMs || 0,
        attempt: timing.attempt || current.attempt || 0,
        workflowStartedAt: String(task.workflowStartedAt || ""),
        workflowDeadlineAt: String(task.workflowDeadlineAt || ""),
        workflowElapsedMs: task.workflowStartedMs ? Math.max(0, now - Number(task.workflowStartedMs)) : 0,
        workflowRemainingMs: task.workflowDeadlineMs ? Math.max(0, Number(task.workflowDeadlineMs) - now) : 0,
        ...data
      });
    };
    const stateSnapshot = conversationStateSnapshot();
    workflow.conversationState = stateSnapshot;
    // A restart can leave post-confirmation flags in the durable task while
    // the live conversation is visibly back at a completed plan waiting for
    // "1". The live plan boundary is authoritative: reset only the stale
    // image-recovery markers so the normal send-confirm step runs once.
    const livePlanImageCount = Math.max(
      Number(stateSnapshot.latestImageCount || 0),
      Array.isArray(stateSnapshot.latestImageUrls) ? stateSnapshot.latestImageUrls.length : 0
    );
    const livePlanCopyText = String(
      stateSnapshot.copyText
        || stateSnapshot.latestCopyText
        || stateSnapshot.workflow?.copyText
        || ""
    ).trim();
    const livePlanConfirmationBoundary = Boolean(
      ["plan-ready", "waiting-plan"].includes(String(stateSnapshot.stage || ""))
        && (stateSnapshot.waitingForConfirm === true || stateSnapshot.stage === "plan-ready")
        && livePlanImageCount === 0
        && !livePlanCopyText
    );
    if (livePlanConfirmationBoundary && shouldReconcilePlanConfirmationBoundary({
      liveConversationStage: stateSnapshot.stage,
      imageSubmitted: workflow.imageSubmitted === true,
      confirmTurnKey: workflow.confirmTurnKey,
      recoveryBoundaryConfirmed: workflow.recoveryBoundaryConfirmed === true,
      generatedImageActualCount: workflow.generatedImageActualCount,
      generatedImageUrls: workflow.generatedImageUrls,
      textSubmitted: workflow.textSubmitted === true,
      copyText: workflow.copyText,
      copyTextPath: workflow.copyTextPath,
      packagePath: workflow.packagePath,
      downloadedImageCount: Array.isArray(workflow.downloadedFiles) ? workflow.downloadedFiles.length : 0,
      durableStage: workflow.currentStep || workflow.taskState || task.entry?.checkpoint?.currentStep || "",
      generating: generatingNow(),
      responseInFlight: stateSnapshot.responseInFlight === true
    })) {
      workflow.imageSubmitted = false;
      workflow.confirmTurnKey = "";
      workflow.beforeImagesCount = 0;
      workflow.beforeImageAssistantKeys = [];
      workflow.generatedBaselineUrls = [];
      workflow.generatedImageUrls = [];
      workflow.generatedImageActualCount = 0;
      workflow.generatedImageDetection = null;
      workflow.imageRecoveryAttempts = 0;
      workflow.recoveryBoundaryConfirmed = false;
      task.entry.reconcileAction = "resume-current-plan";
      logTaskConversationEvent("plan-confirmation-boundary-reconciled", {
        step: "reconcile",
        meta: { reason: "live-plan-ready-overrode-stale-image-checkpoint" }
      });
      reportWorkbenchProgress(
        task,
        "恢复确认出图",
        32,
        "网页当前停在计划完成、等待回复 1；已清除过期生图检查点，下一步只发送一次 1"
      );
    }
    // A retry request is rebuilt from the durable desktop checkpoint. Keep a
    // post-plan boundary even if the browser only exposes a virtualized
    // subset of images or the retry wrapper omitted one of the old flags.
    // Otherwise a completed/partly generated work item can fall back into
    // handleWaitPlan and send a duplicate "补迁移计划" prompt.
    if (workflow.imageSubmitted === true && workflow.planDone !== true) {
      workflow.planSubmitted = true;
      workflow.planDone = true;
    }
    const snapshotIsPostPlan = !forceFreshWorkflow && !livePlanConfirmationBoundary && ["images-ready", "waiting-images", "waiting-copy", "completed-copy-pending-package", "archived"]
      .includes(String(stateSnapshot.stage || ""));
    if (!forceFreshWorkflow && !workflow.planDone && (snapshotIsPostPlan || Number(stateSnapshot.expectedImageCount || 0) > 0)) {
      workflow.planSubmitted = true;
      workflow.planDone = true;
      workflow.imageSubmitted = true;
      const snapshotPlanCount = Math.max(0, Math.min(10, Number(stateSnapshot.expectedImageCount || 0)));
      if (snapshotPlanCount > 0) workflow.plannedImageCount = Math.max(
        Number(workflow.plannedImageCount || 0),
        snapshotPlanCount
      );
    }
    // Build workflow step lookup from the configured steps
    // Safety net: if workflowSteps is empty or missing critical steps
    // (send-confirm, request-copy), fall back to default workflow to ensure
    // the complete pipeline executes instead of silently skipping steps.
    const DEFAULT_WF_STEPS = [
      { action: "upload-material", text: DEFAULT_MATERIAL_PLAN_PROMPT, timeoutSeconds: 120, enabled: true, autoDetect: true },
      { action: "wait-random", text: "", enabled: true, minSeconds: 1, maxSeconds: 5 },
      { action: "wait-plan", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true },
      { action: "send-confirm", text: "1", timeoutSeconds: 20, enabled: true, autoDetect: false },
      { action: "wait-random", text: "", enabled: true, minSeconds: 1, maxSeconds: 5 },
      { action: "wait-images", text: "", timeoutSeconds: 900, enabled: true, autoDetect: true },
      { action: "request-copy", text: DEFAULT_PUBLISH_COPY_PROMPT, timeoutSeconds: 20, enabled: true, autoDetect: false },
      { action: "wait-random", text: "", enabled: true, minSeconds: 1, maxSeconds: 5 },
      { action: "wait-copy", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true },
      { action: "download-images", text: "", timeoutSeconds: 600, enabled: true, autoDetect: true },
      { action: "save-text", text: "", timeoutSeconds: 60, enabled: true, autoDetect: true },
      { action: "move-archive", text: "", timeoutSeconds: 180, enabled: true, autoDetect: false }
    ];
    const _rawWfSteps = Array.isArray(options.workflowSteps) ? options.workflowSteps : [];
    const _hasConfirm = _rawWfSteps.some((s) => s.action === "send-confirm");
    const _hasCopy = _rawWfSteps.some((s) => s.action === "request-copy");
    const wfSteps = (!_rawWfSteps.length || !_hasConfirm || !_hasCopy)
      ? DEFAULT_WF_STEPS
      : _rawWfSteps;
    const wfStepMap = new Map(wfSteps.map((s) => [s.action, s]));
    const wfEnabled = (action) => !wfStepMap.has(action) || wfStepMap.get(action)?.enabled !== false;
    const wfText = (action, fallback = "") => String(wfStepMap.get(action)?.text || fallback).trim() || fallback;
    const wfTimeout = (action, fallback = 60) => Math.max(5, Math.min(3600, Number(wfStepMap.get(action)?.timeoutSeconds || fallback))) * 1000;
    const wfAutoDetect = (action) => wfStepMap.get(action)?.autoDetect !== false;
    // 读取步骤中的可调参数（如 quietSeconds, minImages, minCopyLength 等）
    const wfParam = (action, key, fallback) => {
      const step = wfStepMap.get(action);
      if (!step) return fallback;
      const val = step[key];
      if (val === undefined || val === null || val === "") return fallback;
      const num = Number(val);
      return isNaN(num) ? val : num;
    };
    // ── 公共发送助手：替换输入框文字 + 提交 + 清空草稿 ──
    // send-confirm / request-copy / send-text / upload-material 统一调用
    async function sendComposerText(text) {
      throwIfTaskAborted(task);
      await replaceComposerText(text, task.entry);
      throwIfTaskAborted(task);
      await submitComposer();
      throwIfTaskAborted(task);
      clearComposerDraft();
      // 记录发送的完整文字到对话日志
      logTaskConversationEvent("sent", { sentText: text, step: "sendComposerText" });
    }

    // A recovery task can be rebuilt from an old wait-images checkpoint after
    // the browser has already received the copy. Re-read both the live
    // conversation boundary and the durable checkpoint immediately before any
    // image-recovery send. If either proves that this material has entered the
    // copy phase, package/wait for it; never send an old "continue images"
    // prompt. A mismatched copy is also a hard pause, because it belongs to a
    // different material and must not be attached to this task.
    async function guardImageRecoveryAgainstCopyBoundary() {
      const liveBoundary = currentAutomationBoundarySnapshot();
      let durableCheckpoint = null;
      const requestId = String(task.entry.externalRequestId || "").trim();
      if (requestId) {
        const response = await api(`/api/gpt-production/checkpoint?requestId=${encodeURIComponent(requestId)}`).catch(() => null);
        durableCheckpoint = response?.checkpoint || null;
      }
      // The current DOM can be stale or virtualized after a reload and show a
      // single lazy thumbnail even though this exact request already finished
      // the copy/download/archive boundary. The append-only conversation log
      // is the stronger, request-scoped seal. Once it proves a complete
      // archive, an old wait-images recovery must never send another prompt.
      const conversationSnapshot = conversationStateSnapshot();
      const archivedMarker = readArchivedAutomationBoundary();
      const pageText = normalizeDraft(document.body?.innerText || "");
      // After a renderer reload the live boundary can intentionally be null
      // because the archived marker still matches the exact visible turn. In
      // that case the page snapshot/package controls remain valid evidence;
      // never fall back to a stale checkpoint and emit a false "9/10" prompt.
      const packageCountMatch = pageText.match(/(?:已下载|下载完成|下载本组)\s*(\d+)\s*\/\s*(\d+)/);
      const pagePackageCount = packageCountMatch
        && Number(packageCountMatch[1]) === Number(packageCountMatch[2])
        ? Number(packageCountMatch[1])
        : 0;
      let durableLogBoundary = null;
      if (requestId) {
        const logResponse = await api("/api/gpt-production/conversation-log?limit=500").catch(() => null);
        const relatedEntries = (Array.isArray(logResponse?.entries) ? logResponse.entries : [])
          .filter((entry) => String(entry?.requestId || "").trim() === requestId)
          .sort((left, right) => (Date.parse(String(left?.timestamp || "")) || 0)
            - (Date.parse(String(right?.timestamp || "")) || 0));
        const copyEntries = relatedEntries.filter((entry) => ["copy-received", "text-saved"].includes(String(entry?.event || "")));
        const imageEntries = relatedEntries.filter((entry) => ["images-downloaded", "archived"].includes(String(entry?.event || "")));
        const latestCopy = copyEntries.at(-1);
        const latestImage = imageEntries.at(-1);
        const copyLength = Math.max(
          ...copyEntries.map((entry) => Number(entry?.meta?.copyLength || entry?.meta?.copyTextLength || 0)),
          0
        );
        const imageCount = Math.max(
          ...imageEntries.map((entry) => Math.max(
            Number(entry?.meta?.count || 0),
            Number(entry?.meta?.imageCount || 0),
            Array.isArray(entry?.downloadedFiles) ? entry.downloadedFiles.length : 0
          )),
          0
        );
        const expectedImageCount = Math.max(
          0,
          Number(workflow.plannedImageCount || 0),
          Number(durableCheckpoint?.plannedImageCount || 0),
          Number(durableCheckpoint?.expectedImages || 0)
        );
        const archiveEntry = [...relatedEntries].reverse().find((entry) => entry?.event === "archived");
        const archiveImageCount = Number(archiveEntry?.meta?.imageCount || archiveEntry?.imageCount || 0);
        const completeImageCount = Math.max(imageCount, archiveImageCount);
        const copyReady = copyLength >= 300;
        const imageReady = completeImageCount > 0
          && (!expectedImageCount || completeImageCount >= expectedImageCount);
        const archived = Boolean(archiveEntry && copyReady && imageReady);
        const downloadable = [...relatedEntries].reverse().find((entry) => entry?.event === "images-downloaded");
        if (copyReady && imageReady) {
          durableLogBoundary = {
            archived,
            copyText: String(latestCopy?.receivedText || latestCopy?.text || "").trim(),
            copyTextPath: String(latestCopy?.copyTextPath || "").trim(),
            imageCount: completeImageCount,
            expectedImageCount: expectedImageCount || completeImageCount,
            downloadedFiles: Array.isArray(downloadable?.downloadedFiles) ? downloadable.downloadedFiles : [],
            archiveEntry,
            reason: archived ? "durable-archive-log" : "durable-copy-image-log"
          };
        }
      }
      const checkpointCopyText = String(durableCheckpoint?.copyText || "").trim();
      const liveCopyText = String(liveBoundary?.copyText || "").trim();
      const snapshotCopyText = String(conversationSnapshot?.copyText || "").trim();
      const archivedCopyText = String(archivedMarker?.latestAssistantText || archivedMarker?.copyText || "").trim();
      const workflowCopyText = String(workflow.copyText || "").trim();
      const durableCopyText = String(durableLogBoundary?.copyText || "").trim();
      const copyText = liveCopyText
        || snapshotCopyText
        || archivedCopyText
        || workflowCopyText
        || durableCopyText
        || checkpointCopyText;
      const stage = String(
        durableLogBoundary?.archived
          ? "archived"
          : liveBoundary?.stage
        || conversationSnapshot?.stage
        || (durableCheckpoint?.packagePath ? "archived" : durableCheckpoint?.copyText ? "completed-copy-pending-package" : "")
      ).trim();
      const identity = patrolMaterialCopyIdentity({
        materialName: task.entry.name || "",
        sourceMaterialPath: task.entry.materialPath || task.entry.path || "",
        copyText
      });
      const guard = shouldBlockImageRecoveryAfterCopyBoundary({
        liveConversationStage: stage,
        copyText,
        copyTextPath: durableCheckpoint?.copyTextPath,
        packagePath: durableCheckpoint?.packagePath || durableLogBoundary?.archiveEntry?.packagePath,
        textSubmitted: Boolean(workflow.textSubmitted),
        materialIdentityRequired: identity.required,
        materialIdentityMatched: identity.matched
      });
      if (!guard.blocked) return null;

      const imageUrls = uniqueGeneratedImageUrls([
        ...(Array.isArray(liveBoundary?.imageUrls) ? liveBoundary.imageUrls : []),
        ...(Array.isArray(conversationSnapshot?.latestImageUrls) ? conversationSnapshot.latestImageUrls : []),
        ...(Array.isArray(workflow.generatedImageUrls) ? workflow.generatedImageUrls : []),
        ...(Array.isArray(durableCheckpoint?.generatedImageUrls) ? durableCheckpoint.generatedImageUrls : [])
      ]);
      const expectedImages = Math.max(
        0,
        pagePackageCount,
        Number(conversationSnapshot?.expectedImageCount || 0),
        Number(liveBoundary?.expectedImageCount || 0),
        Number(workflow.plannedImageCount || 0),
        Number(durableCheckpoint?.plannedImageCount || 0),
        Number(durableCheckpoint?.detectedImageCount || 0)
      );
      const downloadedImageCount = Math.max(
        imageUrls.length,
        Number(workflow.generatedImageActualCount || 0),
        Number(conversationSnapshot?.latestImageCount || 0),
        Number(durableCheckpoint?.detectedImageCount || 0),
        pagePackageCount,
        Array.isArray(durableCheckpoint?.downloadedFiles) ? durableCheckpoint.downloadedFiles.length : 0,
        Number(durableLogBoundary?.imageCount || 0)
      );
      const copyReady = Boolean(copyText && isPublishCopyReady(copyText, 300));
      const identityMismatch = Boolean(identity.required && !identity.matched);
      logTaskConversationEvent("partial-image-recovery-suppressed", {
        step: "wait-images",
        meta: {
          reason: identityMismatch ? "copy-boundary-material-mismatch" : guard.reason,
          liveStage: stage,
          copyReady,
          imageEvidenceCount: downloadedImageCount,
          expectedImageCount: expectedImages,
          source: liveCopyText
            ? "live-boundary"
            : snapshotCopyText
              ? "conversation-snapshot"
              : archivedCopyText
                ? "archived-marker"
                : checkpointCopyText
                  ? "checkpoint"
                  : "workflow"
        }
      });
      if (identityMismatch) {
        return {
          blocked: true,
          ready: false,
          mismatch: true,
          error: "当前 GPT 会话已有另一套作品的文案边界；已阻止旧生图恢复，等待原作品归档后再进入新素材"
        };
      }
      if (!copyReady || downloadedImageCount <= 0) {
        return {
          blocked: true,
          ready: false,
          mismatch: false,
          error: `已检测到文案边界，但图片证据仍在恢复（${downloadedImageCount}/${expectedImages || "未知"}）；暂停等待，不发送补图提示`
        };
      }
      workflow.textSubmitted = true;
      workflow.expectPlatformCopy = true;
      workflow.copyText = copyText;
      workflow.plannedImageCount = Math.max(Number(workflow.plannedImageCount || 0), expectedImages, downloadedImageCount);
      workflow.generatedImageUrls = imageUrls;
      workflow.generatedImageActualCount = Math.max(Number(workflow.generatedImageActualCount || 0), downloadedImageCount);
      workflow.recoveryBoundaryConfirmed = true;
      if (durableLogBoundary?.archived) {
        workflow.downloadResult = {
          ...(workflow.downloadResult || {}),
          count: Math.max(Number(workflow.downloadResult?.count || 0), downloadedImageCount),
          files: Array.isArray(workflow.downloadResult?.files) && workflow.downloadResult.files.length
            ? workflow.downloadResult.files
            : durableLogBoundary.downloadedFiles,
          batchId: String(durableLogBoundary.archiveEntry?.meta?.batchId || workflow.batchId || "")
        };
        workflow.packageResult = {
          ...(workflow.packageResult || {}),
          packagePath: String(durableLogBoundary.archiveEntry?.packagePath || ""),
          finalPath: String(durableLogBoundary.archiveEntry?.packagePath || ""),
          duplicate: Boolean(durableLogBoundary.archiveEntry?.meta?.duplicatePackage),
          recoveredFromDurableArchive: true
        };
      }
      logTaskConversationEvent("durable-copy-boundary-adopted", {
        step: "wait-images",
        meta: {
          reason: durableLogBoundary?.reason || "live-or-checkpoint-copy-boundary",
          archived: Boolean(durableLogBoundary?.archived),
          copyLength: copyText.length,
          imageEvidenceCount: downloadedImageCount,
          expectedImageCount: expectedImages || downloadedImageCount
        }
      });
      await saveCheckpoint("已识别文案边界，跳过过期补图", 78);
      reportWorkbenchProgress(task, "识别文案边界", 78, `当前作品已出文案，已阻止过期补图提示；继续下载归档（图片证据 ${downloadedImageCount}/${expectedImages || downloadedImageCount}）`);
      return { blocked: true, ready: true, mismatch: false, error: "" };
    }

    // ── 工具模块执行器（单步版本，替代原 executeUtilityStepsBefore 批量模式） ──
    // 按工作流顺序逐个执行工具模块，不再跳过主流程模块
    // 返回 false = 时间窗口外应暂停；true = 正常继续
    async function executeUtilityStep(step) {
      throwIfTaskAborted(task);
      if (step.action === "wait-fixed") {
        const delay = Math.max(1, Number(step.timeoutSeconds || 5)) * 1000;
        reportWorkbenchProgress(task, "固定等待", 0, `等待 ${Math.round(delay / 1000)} 秒`);
        await waitForTaskDelay(delay);
      } else if (step.action === "wait-random") {
        const min = Math.max(1, Number(step.minSeconds || 5));
        const max = Math.max(min, Number(step.maxSeconds || 30));
        const delay = (min + Math.random() * (max - min)) * 1000;
        reportWorkbenchProgress(task, "随机等待", 0, `等待 ${Math.round(delay / 1000)} 秒（${min}-${max}秒随机）`);
        await waitForTaskDelay(delay);
      } else if (step.action === "send-text" && step.text) {
        reportWorkbenchProgress(task, "发送文字", 0, `发送：${step.text.slice(0, 30)}`);
        await sendComposerText(String(step.text));
      } else if (step.action === "clipboard-copy" && workflow.copyText) {
        try { await navigator.clipboard.writeText(workflow.copyText); } catch (e) { /* optional */ }
        reportWorkbenchProgress(task, "已复制到剪贴板", 0, "文案已复制到剪贴板");
      } else if (step.action === "time-window") {
        const start = String(step.startTime || "00:00").trim();
        const end = String(step.endTime || "23:59").trim();
        const now = new Date();
        const currentMin = now.getHours() * 60 + now.getMinutes();
        const [sh, sm] = start.split(":").map(Number);
        const [eh, em] = end.split(":").map(Number);
        const startMin = (sh || 0) * 60 + (sm || 0);
        const endMin = (eh || 23) * 60 + (em || 59);
        if (currentMin < startMin || currentMin > endMin) {
          reportWorkbenchProgress(task, "时间窗口", 0, `当前 ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")} 不在 ${start}-${end} 窗口内，暂停执行`);
          return false;
        }
        reportWorkbenchProgress(task, "时间窗口", 0, `当前在 ${start}-${end} 窗口内，继续执行`);
      } else if (step.action === "retry") {
        reportWorkbenchProgress(task, "失败重试", 0, `重试配置：超时 ${step.timeoutSeconds || 60} 秒`);
      } else if (step.action.startsWith("detect-")) {
        // 纯检测模块：瞬间检测，不等待。检测到=通过，未检测到=报告但继续
        // 等待请用「随机等待」或「固定等待」模块单独组合
        let detected = false;
        let detectLabel = "";
        if (step.action === "detect-plan") {
          detectLabel = "计划";
          const pattern = String(step.pattern || defaultKeywordPattern("detect-plan") || "迁移计划|逐页|P\\s*1").trim();
          detected = workflow.planDone || completionKeywordDetected(cleanAssistantText([...assistantTurns()].pop()), { action: "detect-plan", keywordPattern: pattern }).matched;
        } else if (step.action === "detect-images") {
          detectLabel = "图片";
          const imgs = freshImageUrls(assistantTurns());
          detected = imgs.length > 0;
        } else if (step.action === "detect-copy") {
          detectLabel = "文案";
          detected = Boolean(workflow.copyText) || isLikelyPublishCopy(cleanAssistantText([...assistantTurns()].pop()));
        } else if (step.action === "detect-state") {
          const st = conversationStateSnapshot();
          detectLabel = "会话状态";
          detected = Boolean(st.stage);
          reportWorkbenchProgress(task, `检测·${detectLabel}`, 0, `当前状态：${st.stage || "unknown"}`);
        }
        if (detectLabel && step.action !== "detect-state") {
          reportWorkbenchProgress(task, `检测·${detectLabel}`, 0, detected ? `${detectLabel}已检测到` : `${detectLabel}未检测到，继续`);
        }
      }
      return true;
    }

    // ── 主流程步骤处理器（每个步骤一个独立函数，按 wfSteps 顺序调用） ──
    // 每个 handler 检查自身状态标志，已完成的自动跳过（支持断点恢复）

    // upload-material：上传素材附件并提交
    async function handleUploadMaterial() {
      throwIfTaskAborted(task);
      if (workflow.planDone) return;
      const expectedAttachmentCount = Array.isArray(task.entry.attachments) ? task.entry.attachments.length : 0;
      if (!workflow.planSubmitted) {
        reportWorkbenchProgress(
          task,
          templateInitialization ? "初始化模板" : "提交迁移计划",
          18,
          templateInitialization ? "模板附件完成，正在建立当前会话的母版规则" : "附件完成，正在发送母版迁移要求"
        );
        if (expectedAttachmentCount === 0) {
          // No attachments in the material folder. If planSubmitted is false
          // (plan was never sent), there is nothing to resume — the task was
          // interrupted before any files were uploaded. Sending text-only
          // would cause GPT to generate a plan without seeing reference images,
          // producing inaccurate results. Fail the task with a clear message.
          throw productionBoundaryError("NO_ATTACHMENTS",
            "当前素材文件夹没有可上传的图片或文案，无法启动生产流程。" +
            "请检查素材文件夹是否为空，或跳过此套素材。" +
            `（素材路径：${task.entry.materialPath || task.entry.path || "未知"}）`);
        }
        if (expectedAttachmentCount) {
          // Don't check attachmentPreviewCount() here — it had false positives
          // (35 for 7 files) that masked real upload failures. Instead, wait
          // directly for the send button, which is the ultimate indicator that
          // ChatGPT has processed the files and is ready to send.
          reportWorkbenchProgress(task, "等待附件就绪", 16, `已上传 ${expectedAttachmentCount} 个文件，等待 GPT 发送按钮可用`);

          // ChatGPT's new unified composer shows a VOICE button (not send)
          // when the input is empty, even if attachments are present.
          // The prompt text set by replaceComposerText before runAutomaticProduction
          // can be cleared by React's async re-rendering during file processing.
          // Re-inject the instruction text if the composer is empty, so the
          // voice button transforms into a send button.
          // SAFETY: Only re-inject text when attachments are actually present
          // in the composer. If expectedAttachmentCount > 0 but no attachments
          // are visible, the files need to be re-uploaded, not just text injected.
          const ensureComposerHasPrompt = () => {
            if (!composerDraftText()) {
              // If we expect attachments but none are in the composer, do NOT
              // inject text alone — that would send a message without files.
              // Only inject if there are no expected attachments, or if
              // attachments are actually present in the composer.
              const currentAttachments = attachmentPreviewCount();
              if (expectedAttachmentCount > 0 && currentAttachments === 0) {
                return false;
              }
              const baseInstr = instruction(task.entry);
              const wfStepsForInstr = Array.isArray(task.entry.autoOptions?.workflowSteps) ? task.entry.autoOptions.workflowSteps : [];
              const insertPromptStep = wfStepsForInstr.find((s) => s.action === "insert-prompt" && s.enabled !== false);
              const finalInstr = insertPromptStep?.text
                ? `${baseInstr}\n${String(insertPromptStep.text).trim()}`
                : baseInstr;
              setComposerText(finalInstr);
              return true;
            }
            return false;
          };
          // Initial injection (covers the race condition where React cleared
          // the text between replaceComposerText and handleUploadMaterial).
          ensureComposerHasPrompt();
          await waitForTaskDelay(500);

          let diagTick = 0;
          const sendButtonReady = await waitFor(
            () => {
              // Periodically re-inject text if React clears it during
              // async file processing (every ~3 seconds at 200ms poll interval).
              if (diagTick > 0 && diagTick % 15 === 0) {
                ensureComposerHasPrompt();
              }
              const sb = Boolean(sendButton());
              if (diagTick % 10 === 0) {
                console.log("[TB Upload Diag]", {
                  tick: diagTick,
                  currentAttachments: attachmentPreviewCount(),
                  expectedCount: expectedAttachmentCount,
                  sendButtonFound: sb,
                  composerHasText: Boolean(composerDraftText())
                });
              }
              diagTick++;
              return sb;
            },
            120_000
          );
          if (!sendButtonReady) {
            // DO NOT re-upload files here. The outer processTask already uploaded
            // them via paste/DataTransfer/DnD. Re-uploading causes duplicate
            // uploads ("你已上传过此文件" error). Instead, re-inject the prompt
            // text (React may have cleared it) and wait for the send button.
            ensureComposerHasPrompt();
            await waitForTaskDelay(500);
            reportWorkbenchProgress(task, "等待附件处理", 17, `GPT 正在处理 ${expectedAttachmentCount} 个文件，重新注入提示词并等待发送按钮...`);
            const retryReady = await waitFor(() => {
              if (!composerDraftText()) ensureComposerHasPrompt();
              return Boolean(sendButton());
            }, 60_000);
            if (!retryReady) {
              throw productionBoundaryError("SEND_BUTTON_NOT_READY",
                `GPT 发送按钮未就绪：附件 ${attachmentPreviewCount()}/${expectedAttachmentCount}，` +
                `发送按钮在 150 秒内未出现。可能原因：ChatGPT 文件上传未完成或 DOM 结构变更。` +
                `诊断：composer=${Boolean(composer())}, composerText=${composerDraftText().length}字符, scope=${Boolean(composer()?.closest('form'))}`);
            }
          }
          await waitForTaskDelay(1_500);
        }
        const previousPlanUserTurn = latestUserTurnWrapper();
        // Do not mark the plan as submitted until submitComposer has proved
        // that the user turn was actually sent.  A renderer refresh can leave
        // the automation prompt in the composer; persisting true here makes
        // recovery skip the upload/send branch and wait forever for a plan
        // that was never requested.
        await submitComposer();
        workflow.planSubmitted = true;
        currentPlanPromptTurn = await waitFor(() => {
          const latest = latestUserTurnWrapper();
          return latest && latest !== previousPlanUserTurn ? latest : null;
        }, 15_000) || latestUserTurnWrapper();
        // 只有真正提交了“素材 + 提示词”的用户消息，才计入滚动上传额度。
        // 附件预览出现在输入框不等于上传已经消耗额度；刷新/重启中断时，
        // 预览会被重复记录，最终把本地安全线错误推到 0。
        if (task.entry.autoRun && !workflow.uploadQuotaRecorded) {
          // This handler runs inside runAutomaticProduction, where the
          // processUploadQueue-local `entry` and `files` variables are not in
          // scope. Use the task-owned attachment boundary that was actually
          // submitted with the plan; otherwise a restart fails here with
          // `entry is not defined` after GPT already accepted the files.
          await recordWorkbenchQuota(task.entry, "uploaded", expectedAttachmentCount);
          workflow.uploadQuotaRecorded = true;
        }
        clearComposerDraft();
        // 记录上传素材时发送的提示词
        const uploadPrompt = typeof task.entry.prompt === "string" ? task.entry.prompt : (typeof instruction === "function" ? instruction(task.entry) : "");
        logTaskConversationEvent("upload-sent", { sentText: uploadPrompt, step: "upload-material", meta: { attachmentCount: expectedAttachmentCount } });
        reportWorkbenchProgress(
          task,
          templateInitialization ? "等待模板确认" : "等待迁移计划",
          24,
          templateInitialization ? "GPT 正在读取母版并建立会话环境" : "GPT 正在生成完整逐页迁移计划"
        );
      } else {
        currentPlanPromptTurn = latestUserTurnWrapper();
        reportWorkbenchProgress(task, "继续等待迁移计划", 24, "已恢复当前网页中的计划生成，不重复上传或发送");
      }
    }

    // wait-plan：等待 GPT 返回迁移计划
    async function handleWaitPlan() {
      throwIfTaskAborted(task);
      if (workflow.planDone) {
        const livePlanBoundary = currentAutomationBoundarySnapshot();
        const materialMatched = Boolean(
          livePlanBoundary?.materialText
          && automationPromptMatchesEntry(livePlanBoundary.materialText, task.entry)
        );
        const checkpointTrusted = shouldTrustCompletedPlanCheckpoint({
          planDone: true,
          materialMatched,
          planText: workflow.planText,
          plannedImageCount: workflow.plannedImageCount,
          requiresPlannedImageCount: requiresPlannedImageCount(task.entry.taskType)
        });
        if (!checkpointTrusted || livePlanBoundary?.stage !== "plan-ready") {
          const error = new Error("当前检查点里的迁移计划不属于本素材，或网页尚未形成当前素材的独立计划；已阻止发送 1");
          error.code = "STALE_PLAN_CHECKPOINT";
          throw error;
        }
        assertLiveAutomationBoundaryMatchesEntry(
          livePlanBoundary,
          task.entry,
          "使用迁移计划",
          { allowDurableLabelDrift: false }
        );
        return;
      }
      // 从工作流步骤参数读取静默秒数，wfAutoDetect 控制是否走条件检测
      const planQuietMs = (wfAutoDetect("wait-plan") ? wfParam("wait-plan", "quietSeconds", 8) : 2) * 1000;
      const planKeywordPattern = wfAutoDetect("wait-plan")
        ? String(wfParam("wait-plan", "keywordPattern", defaultKeywordPattern("wait-plan")) || defaultKeywordPattern("wait-plan"))
        : "";
      const planWaitOptions = () => ({
        timeout: wfTimeout("wait-plan", 480),
        minTextLength: 4,
        completionQuietMs: planQuietMs,
        keywordAction: "wait-plan",
        keywordPattern: planKeywordPattern,
        keywordQuietMs: planQuietMs,
        requirePlannedImageCount: requiresPlannedImageCount(task.entry.taskType),
        silentResponseRecoveryMs: templateInitialization ? 0 : 60_000,
        stalledGeneratingRecoveryMs: templateInitialization ? 0 : 300_000,
        threadErrorRetryMs: templateInitialization ? 0 : 15_000,
        repetitiveLoopRecovery: !templateInitialization,
        baselineKeys: initialAssistantKeys,
        afterTurn: currentPlanPromptTurn
      });
      const completedCopyBoundary = completedCopyBoundaryForCurrentMaterial(task.entry);
      if (completedCopyBoundary?.identity?.required && !completedCopyBoundary.identity.matched) {
        reportWorkbenchProgress(
          task,
          "等待原作品归档",
          25,
          "当前 GPT 会话已经存在另一套作品的完整双平台文案；已阻止再次发送迁移计划，等待原作品归档后再继续",
          "paused"
        );
        throw productionBoundaryError(
          "WINDOW_STAGE_PENDING",
          "当前 GPT 会话已有另一套作品的完整双平台文案，已阻止重复发送迁移计划；等待原作品归档并释放会话边界"
        );
      }
      let planResult = null;
      let planDetection = { ready: false, code: "PLAN_NOT_READY" };
      let planText = "";
      // A reload can restore the task checkpoint after the attachment files
      // are back in the composer but before the plan user-turn was actually
      // committed.  The old guard treated those automation-owned files/text
      // as a human draft and stopped the queue forever.  Reconcile this
      // boundary here, before waiting for an assistant plan:
      //   - matching user turn: discard only the duplicate composer residue;
      //   - automation draft + attached files + no matching turn: send once;
      //   - automation draft without files: force the outer upload path;
      //   - anything else remains a real human-input safety boundary.
      const pendingPlanDraft = composerDraftText();
      const pendingPlanBelongsToTask = Boolean(
        pendingPlanDraft && isAutomationDraft(pendingPlanDraft, task.entry)
      );
      const pendingPlanLooksAutomation = Boolean(
        pendingPlanDraft && looksLikeAutomationDraft(pendingPlanDraft)
      );
      if (pendingPlanLooksAutomation && !pendingPlanBelongsToTask) {
        const staleAttachmentCount = attachmentPreviewCount();
        forceClearComposer();
        clearAutomationDraftMarker();
        reportWorkbenchProgress(
          task,
          "清理其他任务残留",
          4,
          `已清理其他队列任务遗留的自动提示词和 ${staleAttachmentCount} 个未发送附件；不会代替当前作品发送`
        );
      }
      const pendingPlanIsAutomation = pendingPlanBelongsToTask;
      const livePlanUserTurn = latestUserTurnWrapper();
      const livePlanAlreadySent = Boolean(
        livePlanUserTurn
        && automationPromptMatchesEntry(cleanAssistantText(livePlanUserTurn), task.entry)
      );
      if (pendingPlanIsAutomation) {
        if (livePlanAlreadySent) {
          forceClearComposer();
          clearAutomationDraftMarker();
          reportWorkbenchProgress(task, "清理已发送计划残留", 24, "已找到对应用户消息；清理输入框残留，不重复发送计划");
        } else if (attachmentPreviewCount() > 0) {
          const previousPlanUserTurn = livePlanUserTurn;
          await submitComposer();
          workflow.planSubmitted = true;
          currentPlanPromptTurn = await waitFor(() => {
            const latest = latestUserTurnWrapper();
            return latest && latest !== previousPlanUserTurn ? latest : null;
          }, 15_000) || latestUserTurnWrapper();
          clearComposerDraft();
          clearAutomationDraftMarker();
          logTaskConversationEvent("plan-resumed-sent", { sentText: pendingPlanDraft, step: "wait-plan", meta: { attachmentCount: attachmentPreviewCount() } });
          reportWorkbenchProgress(task, "恢复迁移计划", 24, "当前任务附件和自动提示词均已在输入框；已真实发送一次，等待 GPT 返回计划");
        } else {
          task.workflow = {};
          task.entry.resumePlanSubmitted = false;
          task.entry.forceUpload = true;
          const error = new Error("检测到未发送的自动计划但附件已脱离输入框；回到上传素材步骤重新发送，不发送空计划");
          error.code = "UNSENT_PLAN_CHECKPOINT";
          throw error;
        }
      }
      while (!planDetection.ready) {
        try {
          planResult = await waitForAssistantCompletion(initialAssistantCount, planWaitOptions());
          planText = planResult.turns.map(cleanAssistantText).join("\n").trim();
          const planKeywordHit = completionKeywordDetected(planText, { action: "wait-plan", keywordPattern: planKeywordPattern }).matched;
          const validPlan = planKeywordHit || (planText.length >= 80 && /迁移计划|逐页|P\s*1|第\s*1\s*页/i.test(planText));
          const planComplete = Boolean(planResult.responseComplete) || migrationPlanHasCompletionMarker(planText) || planKeywordHit;
          const plannedImageCount = parsePlannedImageCount(planText);
          planDetection = classifyPlanDetectionResult({ validPlan, planComplete, plannedImageCount });
          if (planDetection.ready && !templateInitialization) {
            const pageCap = validatePlanPageCap({ plannedImageCount, text: planText, maximum: 10 });
            if (!pageCap.valid) planDetection = { ready: false, code: pageCap.code };
          }
        } catch (error) {
          if (!/等待 GPT 回复完成超时/.test(String(error?.message || ""))) throw error;
          planDetection = { ready: false, code: "PLAN_NOT_READY" };
        }
        // ChatGPT can commit the final assistant turn at the same moment the
        // generic silent-response timer expires. In that race the completed
        // P1-Pn plan is already visible after this material's user turn, but
        // waitForAssistantCompletion has just returned an empty snapshot. Do
        // one synchronous, ownership-anchored reread before sending any
        // recovery prompt. This keeps the workflow monotonic and prevents a
        // valid plan from being followed by duplicate recovery messages.
        if (!planDetection.ready && currentPlanPromptTurn?.isConnected) {
          const visiblePlanTurns = assistantTurnsAfter(currentPlanPromptTurn);
          const visiblePlanText = visiblePlanTurns.map(cleanAssistantText).join("\n").trim();
          const visiblePlanKeywordHit = completionKeywordDetected(visiblePlanText, {
            action: "wait-plan",
            keywordPattern: planKeywordPattern
          }).matched;
          const visiblePlanCount = parsePlannedImageCount(visiblePlanText);
          const visiblePlanValid = visiblePlanKeywordHit
            || (visiblePlanText.length >= 80 && /迁移计划|逐页|P\s*1|第\s*1\s*页/i.test(visiblePlanText));
          const visiblePlanComplete = visiblePlanKeywordHit
            || migrationPlanHasCompletionMarker(visiblePlanText)
            || replyHasCompletionAction(visiblePlanTurns.at(-1));
          const visibleDetection = classifyPlanDetectionResult({
            validPlan: visiblePlanValid,
            planComplete: visiblePlanComplete,
            plannedImageCount: visiblePlanCount
          });
          const visiblePageCap = visibleDetection.ready && !templateInitialization
            ? validatePlanPageCap({ plannedImageCount: visiblePlanCount, text: visiblePlanText, maximum: 10 })
            : { valid: true, code: "" };
          if (visibleDetection.ready && visiblePageCap.valid) {
            planResult = {
              turns: visiblePlanTurns,
              responseComplete: true,
              imageCount: 0,
              stableFor: planQuietMs,
              keywordHit: visiblePlanKeywordHit
            };
            planText = visiblePlanText;
            planDetection = visibleDetection;
            logTaskConversationEvent("plan-visible-race-adopted", {
              receivedText: visiblePlanText,
              step: "wait-plan",
              meta: { plannedImageCount: visiblePlanCount, reason: "visible-before-recovery" }
            });
          } else if (visibleDetection.ready && !visiblePageCap.valid) {
            planText = visiblePlanText;
            planDetection = { ready: false, code: visiblePageCap.code };
          }
        }
        if (planDetection.ready || templateInitialization) break;
        const recovery = decidePlanRecovery({
          attempts: workflow.planRecoveryAttempts,
          maxAttempts: 2,
          generating: generatingNow()
        });
        if (recovery.action === "wait-current") {
          reportWorkbenchProgress(
            task,
            "等待迁移计划生成",
            25,
            "GPT 仍在输出当前迁移计划；保持原帖等待，不追加恢复提示"
          );
          await waitFor(() => !generatingNow(), Math.min(taskAttentionLineMs, 120_000));
          continue;
        }
        workflow.planRecoveryAttempts = recovery.nextAttempt;
        if (recovery.action !== "retry-current") break;
        if (composerDraftText() || (!workflow.planSubmitted && attachmentPreviewCount() > 0)) {
          const error = new Error("恢复迁移计划前输入框仍有未发送内容；当前帖子已暂停，不上传下一帖");
          error.code = "COMPOSER_DRAFT_PENDING";
          throw error;
        }
        const capViolation = /PLAN_PAGE_CAP_EXCEEDED|PLAN_BATCHING_FORBIDDEN/.test(planDetection.code);
        const recoveryText = capViolation
          ? "请重写刚才的迁移计划。本套计划和最终成品都最多 10 张；请先完整读取全部素材，再自行筛选、聚类、合并和取舍，只保留 P1-P10 以内。禁止第 11 页，禁止分批，禁止第二批，禁止把剩余素材留到下一批。重写最多 10 页的完整计划，并在结尾等待我回复 1，暂时不要出图。"
          : "请继续处理我上一条已上传的全部附件。先严格按既定格式输出完整逐页迁移计划，并在结尾等待我回复 1，暂时不要出图。";
        reportWorkbenchProgress(
          task,
          capViolation ? "纠正计划页数" : "恢复迁移计划",
          25,
          capViolation
            ? `检测到计划超过 10 页或提出第二批，正在要求原地重写（第 ${recovery.nextAttempt}/2 次），不会回复 1`
            : `GPT 未返回有效计划，正在恢复当前帖子（第 ${recovery.nextAttempt}/2 次），不会上传下一套`
        );
        const previousRecoveryUserTurn = latestUserTurnWrapper();
        await sendComposerText(recoveryText);
        currentPlanPromptTurn = await waitFor(() => {
          const latest = latestUserTurnWrapper();
          return latest && latest !== previousRecoveryUserTurn ? latest : null;
        }, 15_000) || latestUserTurnWrapper();
        logTaskConversationEvent("plan-recovery-sent", { sentText: recoveryText, step: "wait-plan", meta: { attempt: recovery.nextAttempt } });
      }
      if (!templateInitialization) {
        if (planDetection.code === "PLAN_NOT_READY") {
          const error = new Error("GPT 没有返回可确认的迁移计划；当前帖子已暂停，不发送 1、不上传下一帖");
          error.code = "PLAN_NOT_READY";
          throw error;
        }
        if (planDetection.code === "PLAN_NOT_COMPLETE") {
          const error = new Error("迁移计划正文尚未稳定结束；当前帖子已暂停，不发送 1、不上传下一帖");
          error.code = "PLAN_NOT_COMPLETE";
          throw error;
        }
        if (/PLAN_PAGE_CAP_EXCEEDED|PLAN_BATCHING_FORBIDDEN/.test(planDetection.code)) {
          const error = new Error("GPT 迁移计划仍超过 10 页或提出第二批；当前帖子已暂停，不发送 1、不消耗生图额度、不上传下一套素材");
          error.code = planDetection.code;
          throw error;
        }
        workflow.planText = planText;
        workflow.plannedImageCount = parsePlannedImageCount(planText);
        // 记录 GPT 返回的迁移计划全文
        logTaskConversationEvent("plan-received", { receivedText: planText, step: "wait-plan", meta: { plannedImageCount: workflow.plannedImageCount } });
        if (!workflow.plannedImageCount) {
          const error = new Error("迁移计划已返回，但无法解析预计页数；当前帖子已暂停，不上传下一帖");
          error.code = "PLAN_PARSE_FAILED";
          throw error;
        }
      }
      workflow.planDone = true;
      const livePlanBoundary = currentAutomationBoundarySnapshot();
      if (shouldReenterConfirmAtPlanBoundary({
        liveConversationStage: livePlanBoundary?.stage,
        imageSubmitted: workflow.imageSubmitted,
        confirmTurnKey: workflow.confirmTurnKey,
        textSubmitted: workflow.textSubmitted,
        copyText: workflow.copyText,
        copyTextPath: workflow.copyTextPath,
        packagePath: workflow.packageResult?.packagePath,
        downloadedImageCount: workflow.downloadResult?.count,
        beforeImagesCount: workflow.beforeImagesCount,
        beforeImageAssistantKeys: workflow.beforeImageAssistantKeys,
        generatedBaselineUrls: workflow.generatedBaselineUrls,
        generatedImageActualCount: workflow.generatedImageActualCount,
        generatedImageUrls: workflow.generatedImageUrls,
        liveImageEvidenceCount: Array.isArray(livePlanBoundary?.imageUrls) ? livePlanBoundary.imageUrls.length : 0,
        liveImageUrls: livePlanBoundary?.imageUrls,
        generating: generatingNow()
      })) {
        workflow.imageSubmitted = false;
        workflow.confirmTurnKey = "";
        workflow.beforeImagesCount = 0;
        workflow.beforeImageAssistantKeys = [];
        workflow.generatedBaselineUrls = [];
        workflow.generatedImageUrls = [];
        workflow.generatedImageActualCount = 0;
        workflow.generatedImageDetection = null;
        workflow.imageRecoveryAttempts = 0;
        workflow.imageRecoveryLastSignature = "";
        workflow.recoveryBoundaryConfirmed = false;
        logTaskConversationEvent("stale-image-submission-reset", {
          step: "wait-plan",
          meta: { reason: "plan-ready-without-confirm-or-image-evidence" }
        });
        reportWorkbenchProgress(task, "恢复确认边界", 34, "检测到旧检查点曾标记已确认，但当前对话仍停在计划页；已清理旧生图标记，将只发送一次确认 1");
      }
      await saveCheckpoint("迁移计划完成", 32);
      // 模板初始化：计划完成后提前返回
      if (templateInitialization) {
        reportWorkbenchProgress(task, "模板已就绪", 100, "当前会话已完成母版环境初始化");
        earlyReturn = { templateInitialized: true, conversationUrl: location.href };
        return;
      }
      // autoConfirm 关闭：计划完成后等待人工确认
      if (options.autoConfirm === false) {
        reportWorkbenchProgress(task, "等待人工确认", 30, "迁移计划已完成，自动发送 1 已关闭");
        earlyReturn = { plannedOnly: true };
        return;
      }
    }

    // send-confirm：发送确认文字（如"1"）触发图片生成
    async function handleSendConfirm() {
      throwIfTaskAborted(task);
      if (workflow.imageSubmitted) {
        if (!workflow.downloadResult) {
          reportWorkbenchProgress(task, "继续等待生成图片", 48, "已恢复当前网页中的图片生成，不重复发送 1");
        }
        return;
      }
      const livePlanBoundary = currentAutomationBoundarySnapshot();
      assertLiveAutomationBoundaryMatchesEntry(
        livePlanBoundary,
        task.entry,
        "发送确认 1 前",
        { allowDurableLabelDrift: false }
      );
      if (livePlanBoundary?.stage !== "plan-ready"
        || !automationPromptMatchesEntry(livePlanBoundary.materialText, task.entry)) {
        const error = new Error("当前网页没有本素材独立完成的迁移计划；已阻止发送 1");
        error.code = "CURRENT_PLAN_BOUNDARY_MISSING";
        throw error;
      }
      if (attachmentPreviewCount() > 0) {
        const error = new Error(`发送 1 前输入框仍有 ${attachmentPreviewCount()} 个附件；已暂停，禁止把素材附件与确认 1 合并发送`);
        error.code = "CONFIRM_ATTACHMENTS_PENDING";
        throw error;
      }
      if (composerDraftText()) {
        const error = new Error("发送 1 前输入框仍有未发送文字；已暂停，禁止覆盖或合并当前草稿");
        error.code = "CONFIRM_COMPOSER_DRAFT_PENDING";
        throw error;
      }
      workflow.beforeImagesCount = assistantTurns().length;
      workflow.beforeImageAssistantKeys = assistantTurnKeys();
      workflow.generatedBaselineUrls = generatedImageUrls();
      const confirmDelayMs = 1_000 + Math.floor(Math.random() * 4_001);
      const confirmText = wfText("send-confirm", String(options.confirmText || "1").trim() || "1");
      reportWorkbenchProgress(task, "确认出图", 36, `迁移计划已完成，将在 ${Math.ceil(confirmDelayMs / 1000)} 秒内自动发送 ${confirmText}`);
      await waitForTaskDelay(confirmDelayMs);
      const previousConfirmUserTurn = latestUserTurnWrapper();
      await sendComposerText(confirmText);
      const confirmUserTurn = await waitFor(() => {
        const latest = latestUserTurnWrapper();
        return latest && latest !== previousConfirmUserTurn ? latest : null;
      }, 15_000) || latestUserTurnWrapper();
      workflow.confirmTurnKey = confirmUserTurn ? assistantTurnKey(confirmUserTurn) : "";
      // 记录发送的确认文字（如"1"）
      logTaskConversationEvent("confirm-sent", { sentText: confirmText, step: "send-confirm" });
      workflow.imageSubmitted = true;
      await saveCheckpoint("已发送确认", 38);
    }

    // wait-images：等待本轮图片生成完成
    async function handleWaitImages() {
      throwIfTaskAborted(task);
      if (workflow.downloadResult) return; // 图片已下载，无需再等
      // The live conversation is stronger than a stale checkpoint after a
      // restart. A native image turn may have no assistant-role marker, but
      // currentAutomationBoundarySnapshot now reads its semantic image set
      // within the same confirm-1 boundary. Adopt a complete settled batch
      // before enforcing the old "imageSubmitted needs baseline" guard.
      const liveAutomationBoundary = currentAutomationBoundarySnapshot();
      // A renderer restart can leave the previous material's semantic image
      // set visible while the durable queue has already advanced. Never adopt
      // that set for the current task: doing so turns old images into the next
      // task's checkpoint and can later save the old copy under a new name.
      // This is read-only and lets the normal owner-reconciliation path handle
      // the mismatch without regenerating or sending another recovery prompt.
      assertLiveAutomationBoundaryMatchesEntry(liveAutomationBoundary, task.entry, "生图检查点恢复");
      const liveImageUrls = uniqueGeneratedImageUrls(
        Array.isArray(liveAutomationBoundary?.imageUrls) ? liveAutomationBoundary.imageUrls : []
      );
      const liveExpectedImageCount = Math.max(
        0,
        Number(liveAutomationBoundary?.expectedImageCount || workflow.plannedImageCount || 0)
      );
      const liveImageEvidenceCount = Math.max(
        liveImageUrls.length,
        Number(liveAutomationBoundary?.imageEvidenceCount || 0)
      );
      const liveImagesReady = liveAutomationBoundary?.stage === "images-ready"
        && !generatingNow()
        && liveImageEvidenceCount > 0
        && (liveExpectedImageCount === 0 || liveImageEvidenceCount >= liveExpectedImageCount);
      if (liveImagesReady) {
        workflow.planSubmitted = true;
        workflow.planDone = true;
        workflow.plannedImageCount = Math.max(
          Number(workflow.plannedImageCount || 0),
          liveExpectedImageCount,
          liveImageEvidenceCount
        );
        workflow.imageSubmitted = true;
        workflow.generatedImageUrls = liveImageUrls;
        workflow.generatedImageActualCount = liveImageEvidenceCount;
        workflow.generatedImageDetection = {
          confident: liveAutomationBoundary.evidence?.responseComplete !== false,
          evidence: "live-current-image-boundary",
          detectedAt: new Date().toISOString(),
          turnKey: String(liveAutomationBoundary.evidence?.turnKey || ""),
          declaredCount: Number(liveAutomationBoundary.evidence?.declaredCount || liveImageEvidenceCount)
        };
        workflow.recoveryBoundaryConfirmed = true;
        await saveCheckpoint("已识别网页现有生图", 64);
        logTaskConversationEvent("live-image-boundary-adopted", {
          step: "wait-images",
          imageUrls: liveImageUrls,
          meta: {
            expectedImages: liveExpectedImageCount,
            detectedCount: liveImageEvidenceCount,
            reason: "settled-current-semantic-image-boundary"
          }
        });
        reportWorkbenchProgress(task, "识别已有图片", 64, `当前网页已完成本轮 ${liveImageEvidenceCount}/${liveExpectedImageCount || liveImageEvidenceCount} 张，跳过重复生图，继续文案与归档`);
        return;
      }
      const durableImageBoundary = resolveDurableImageBoundary({
        expectedImageCount: Math.max(
          Number(workflow.plannedImageCount || 0),
          Number(task.entry.expectedImages || 0)
        ),
        plannedImageCount: workflow.plannedImageCount,
        imageSubmitted: workflow.imageSubmitted === true,
        confirmTurnKey: workflow.confirmTurnKey,
        generatedImageUrls: workflow.generatedImageUrls,
        generatedBaselineUrls: workflow.generatedBaselineUrls,
        generatedImageActualCount: workflow.generatedImageActualCount,
        generatedImages: task.entry.generatedImages
      });
      if (durableImageBoundary.ready && !generatingNow()) {
        workflow.planSubmitted = true;
        workflow.planDone = true;
        workflow.imageSubmitted = true;
        workflow.plannedImageCount = durableImageBoundary.expected;
        workflow.generatedImageUrls = durableImageBoundary.urls;
        workflow.generatedImageActualCount = durableImageBoundary.actual;
        workflow.generatedImageDetection = {
          confident: true,
          evidence: "durable-submitted-task-image-boundary",
          detectedAt: new Date().toISOString(),
          turnKey: String(workflow.confirmTurnKey || ""),
          declaredCount: durableImageBoundary.actual
        };
        task.entry.generatedImages = durableImageBoundary.actual;
        workflow.recoveryBoundaryConfirmed = true;
        if (!workflow.generationQuotaRecorded) {
          await recordWorkbenchQuota(task.entry, "generated", durableImageBoundary.actual);
          workflow.generationQuotaRecorded = true;
        }
        await saveCheckpoint("已从持久检查点识别完整生图", 66);
        logTaskConversationEvent("durable-image-boundary-adopted", {
          step: "wait-images",
          imageUrls: durableImageBoundary.urls,
          meta: {
            expectedImages: durableImageBoundary.expected,
            detectedCount: durableImageBoundary.actual,
            freshCount: durableImageBoundary.freshUrls.length,
            reason: durableImageBoundary.reason,
            confirmTurnKey: String(workflow.confirmTurnKey || "")
          }
        });
        reportWorkbenchProgress(task, "识别检查点图片", 66, `已核对同一任务持久化的 ${durableImageBoundary.actual}/${durableImageBoundary.expected} 张图片，跳过网页暂时缺失的缩略图，继续文案与归档`);
        return;
      }
      const imageBoundaryKeys = Array.isArray(workflow.beforeImageAssistantKeys)
        ? workflow.beforeImageAssistantKeys.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      const imageBoundaryCount = Math.max(0, Number(workflow.beforeImagesCount || 0));
      const imageBoundaryUrls = uniqueGeneratedImageUrls(workflow.generatedBaselineUrls || []);
      if (workflow.imageSubmitted
        && !imageBoundaryKeys.length
        && !imageBoundaryCount
        && !imageBoundaryUrls.length
        && workflow.recoveryBoundaryConfirmed !== true) {
        const error = new Error("当前作品缺少生图回复边界证据；已暂停，未混用历史图片或补发提示");
        error.code = "IMAGE_RECOVERY_BOUNDARY_MISSING";
        throw error;
      }
      // A legacy checkpoint can be overwritten by an image-recovery retry and
      // lose textSubmitted/copyText. The live conversation is the stronger
      // boundary: once this material has a copy-request user turn, recovery
      // must continue at wait-copy and must never send another image prompt.
      const liveCopyBoundary = ["waiting-copy", "completed-copy-pending-package"]
        .includes(String(liveAutomationBoundary?.stage || ""));
      const imageRecoveryBoundary = shouldBypassImageRecovery({
        copyText: workflow.copyText,
        copyTextPath: workflow.copyTextPath,
        packagePath: workflow.packageResult?.packagePath,
        downloadedImageCount: liveCopyBoundary ? 0 : workflow.downloadResult?.count,
        imageUrls: liveImageUrls,
        imageEvidenceCount: Math.max(
          liveCopyBoundary ? liveImageEvidenceCount : 0,
          liveCopyBoundary ? 0 : Number(workflow.generatedImageActualCount || 0)
        ),
        expectedImageCount: liveExpectedImageCount,
        retryStage: task.entry.retryFromStage,
        textSubmitted: workflow.textSubmitted,
        liveConversationStage: liveAutomationBoundary?.stage
      });
      const copyPhaseProtection = shouldProtectCopyBoundaryFromImageRecovery({
        stage: liveAutomationBoundary?.stage,
        hasCopy: Boolean(workflow.textSubmitted)
          || Boolean(String(workflow.copyText || "").trim())
          || Boolean(String(liveAutomationBoundary?.copyText || "").trim()),
        textSubmitted: Boolean(workflow.textSubmitted),
        copyText: workflow.copyText || liveAutomationBoundary?.copyText || ""
      });
      const durableCopyEvidence = String(
        workflow.copyText || liveAutomationBoundary?.copyText || ""
      ).trim();
      if (durableCopyEvidence || workflow.copyTextPath) {
        // Copy/closed-work evidence is the highest-priority boundary. A lazy
        // DOM can expose one thumbnail even when the checkpoint already holds
        // the full batch; never throw this back into image regeneration.
        workflow.textSubmitted = true;
        workflow.expectPlatformCopy = true;
        if (!workflow.copyText && durableCopyEvidence) workflow.copyText = durableCopyEvidence;
        if (liveImageUrls.length >= uniqueGeneratedImageUrls(workflow.generatedImageUrls || []).length) {
          workflow.generatedImageUrls = liveImageUrls;
        }
        workflow.generatedImageActualCount = Math.max(
          Number(workflow.generatedImageActualCount || 0),
          liveImageEvidenceCount,
          uniqueGeneratedImageUrls(workflow.generatedImageUrls || []).length
        );
        workflow.recoveryBoundaryConfirmed = true;
        await saveCheckpoint(workflow.copyTextPath ? "已识别归档文案" : "已识别文案完成边界", 78);
        logTaskConversationEvent("copy-boundary-adopted", {
          step: "wait-images",
          meta: {
            reason: "copy-evidence-has-priority-over-lazy-image-count",
            expectedImageCount: liveExpectedImageCount,
            detectedImageCount: liveImageEvidenceCount,
            checkpointImageCount: uniqueGeneratedImageUrls(workflow.generatedImageUrls || []).length
          }
        });
        reportWorkbenchProgress(task, "识别文案完成", 78, "已确认当前作品已出文案，跳过补图，继续下载、打包和归档");
        return;
      }
      if (copyPhaseProtection.protected && !imageRecoveryBoundary.bypass) {
        logTaskConversationEvent("partial-image-recovery-suppressed", {
          step: "wait-images",
          meta: {
            reason: "copy-boundary-image-evidence-incomplete",
            copyBoundaryReason: copyPhaseProtection.reason,
            liveStage: String(liveAutomationBoundary?.stage || ""),
            expectedImageCount: liveExpectedImageCount,
            imageEvidenceCount: liveImageEvidenceCount,
            workflowImageCount: Number(workflow.generatedImageActualCount || 0)
          }
        });
        const error = new Error(
          `文案边界已${workflow.copyText || liveAutomationBoundary?.copyText ? "完成" : "开始"}，但当前网页只显示 ${liveImageEvidenceCount}/${liveExpectedImageCount || "未知"} 张图片；等待同一作品的图片证据恢复，禁止再次发起生图`
        );
        error.code = "COPY_IMAGE_HYDRATION_WAIT";
        error.recoveryReason = "completed-copy-awaiting-image-hydration";
        error.detectedImages = liveImageEvidenceCount;
        throw error;
      }
      if (["waiting-copy", "completed-copy-pending-package"].includes(String(liveAutomationBoundary?.stage || ""))
        && !imageRecoveryBoundary.bypass) {
        logTaskConversationEvent("wait-images-boundary-blocked", {
          step: "wait-images",
          meta: {
            reason: imageRecoveryBoundary.reason,
            expectedImageCount: liveExpectedImageCount,
            imageEvidenceCount: liveImageEvidenceCount,
            workflowImageCount: Number(workflow.generatedImageActualCount || 0),
            liveStage: String(liveAutomationBoundary?.stage || "")
          }
        });
      }
      if (imageRecoveryBoundary.bypass) {
        workflow.textSubmitted = true;
        workflow.expectPlatformCopy = true;
        workflow.plannedImageCount = Math.max(
          Number(workflow.plannedImageCount || 0),
          liveExpectedImageCount
        );
        if (!workflow.copyText && liveAutomationBoundary?.copyText) {
          workflow.copyText = String(liveAutomationBoundary.copyText || "").trim();
        }
        const existingGeneratedImageUrls = uniqueGeneratedImageUrls(workflow.generatedImageUrls || []);
        if (liveImageUrls.length && liveImageUrls.length >= existingGeneratedImageUrls.length) {
          // The live copy boundary contains the complete current material
          // batch. Replace a stale partial URL set (for example 1/7) with it,
          // while never allowing a transient DOM read to downgrade progress.
          workflow.generatedImageUrls = liveImageUrls;
        }
        workflow.generatedImageActualCount = Math.max(
          Number(workflow.generatedImageActualCount || 0),
          liveImageEvidenceCount
        );
        await saveCheckpoint(
          liveAutomationBoundary?.copyText ? "已识别文案边界" : "已识别文案请求边界",
          liveAutomationBoundary?.copyText ? 78 : 72
        );
        if (workflow.copyText) workflow.textSubmitted = true;
        logTaskConversationEvent("wait-images-skipped", {
          step: "wait-images",
          meta: {
            reason: imageRecoveryBoundary.reason,
            copyTextLength: String(workflow.copyText || "").length,
            textSubmitted: Boolean(workflow.textSubmitted),
            expectedImageCount: liveExpectedImageCount,
            imageEvidenceCount: liveImageEvidenceCount,
            retryStage: String(task.entry.retryFromStage || "")
          }
        });
        reportWorkbenchProgress(task, "跳过旧生图恢复", 72, "已到文案/归档边界，不再发送过期的补图提示，继续处理当前作品");
        return;
      }
      let expectedImages = Math.max(1, Number(workflow.plannedImageCount || 0));
      const latestAssistantTurn = [...assistantTurns()].at(-1);
      const latestAssistantText = cleanAssistantText(latestAssistantTurn);
      const explicitFailureCopyGuard = shouldBlockImageRecoveryAfterCopyBoundary({
        liveConversationStage: String(liveAutomationBoundary?.stage || workflow.currentStep || ""),
        textSubmitted: workflow.textSubmitted === true,
        copyText: workflow.copyText,
        copyTextPath: workflow.copyTextPath,
        packagePath: workflow.packageResult?.packagePath,
        minimumCopyLength: 1
      });
      const explicitImageFailure = workflow.imageSubmitted === true
        && workflow.textSubmitted !== true
        && explicitFailureCopyGuard.blocked !== true
        && !generatingNow()
        && /(?:something went wrong while generating (?:your|the) image|(?:image|images) generation failed|\u751f\u6210\u56fe\u7247(?:\u65f6)?\u51fa\u4e86\u70b9\u95ee\u9898|\u56fe\u7247\u751f\u6210\u5931\u8d25|\u51fa\u56fe(?:\u65f6)?\u53d1\u751f\u4e86?\u751f\u6210\u9519\u8bef|\u751f\u6210\u9519\u8bef)/i.test(latestAssistantText);
      const latestFailureTurnKey = latestAssistantTurn ? assistantTurnKey(latestAssistantTurn) : "";
      const imageFailureSignature = `${latestFailureTurnKey}|${latestAssistantText.slice(-800)}`;
      const imageRecoveryAttempts = Math.max(0, Number(workflow.imageRecoveryAttempts || 0));
      if (explicitImageFailure
        && imageRecoveryAttempts < 2
        && imageFailureSignature !== String(workflow.imageRecoveryFailureSignature || "")) {
        const recoveryPrompt = `请继续完成刚才已经确认的全部图片生成。不要重新输出计划，直接按已确认的 P1-P${expectedImages} 生成全部独立 3:4 图片；总数就是 ${expectedImages} 张，不要多生成，也不要分批。`;
        workflow.imageRecoveryAttempts = imageRecoveryAttempts + 1;
        workflow.imageRecoveryFailureSignature = imageFailureSignature;
        reportWorkbenchProgress(task, "恢复图片生成", 50, `检测到 GPT 生图失败，正在原对话续接（${workflow.imageRecoveryAttempts}/2）`);
        await sendComposerText(recoveryPrompt);
        workflow.beforeImagesCount = assistantTurns().length;
        workflow.beforeImageAssistantKeys = assistantTurnKeys();
        workflow.generatedBaselineUrls = generatedImageUrls();
        logTaskConversationEvent("image-failure-recovery-sent", {
          sentText: recoveryPrompt,
          step: "wait-images",
          meta: {
            attempt: workflow.imageRecoveryAttempts,
            failureSignature: imageFailureSignature,
            reason: "explicit-gpt-image-generation-error"
          }
        });
        await saveCheckpoint("已识别生图失败并原地续接", 50);
      }
      // 从工作流步骤参数读取最小图片数，wfAutoDetect 控制是否走条件检测
      const minimumImages = wfAutoDetect("wait-images")
        ? Math.max(1, wfParam("wait-images", "minImages", 4))
        : Math.max(1, Number(options.minimumImageCount || 4));
      const baselineUrls = Array.isArray(workflow.generatedBaselineUrls) ? workflow.generatedBaselineUrls : [];
      const imageKeywordPattern = wfAutoDetect("wait-images")
        ? String(wfParam("wait-images", "keywordPattern", defaultKeywordPattern("wait-images")) || defaultKeywordPattern("wait-images"))
        : "";
      const imageQuietMs = (wfAutoDetect("wait-images") ? wfParam("wait-images", "quietSeconds", 3) : 3) * 1000;
      const partialImageQuietMs = (wfAutoDetect("wait-images")
        ? wfParam("wait-images", "partialQuietSeconds", 120)
        : 120) * 1000;
      let imageUrls = uniqueGeneratedImageUrls(Array.isArray(workflow.generatedImageUrls) ? workflow.generatedImageUrls : []);
      let actualImageCount = Math.min(expectedImages, Math.max(
        0,
        Number(workflow.generatedImageActualCount || 0),
        Number(workflow.generatedImageDetection?.declaredCount || 0),
        Number(workflow.downloadResult?.count || 0)
      ));
      reportWorkbenchProgress(task, "等待图片", 48, `已发送 1，正在等待本轮 ${expectedImages} 张图片生成`);
      let imageDetection;
      const maxSilentRecoveryAttempts = 2;
      while (true) {
        imageDetection = await waitForGeneratedImageGrowth(
          baselineUrls,
          0,
          wfTimeout("wait-images", 900),
          expectedImages,
          async () => {
          if (workflow.batchChoiceSubmitted || !currentBatchChoicePrompt()) return;
          // A plan with more than ten pages can ask the operator which batch
          // to run. The automatic workflow always takes the first batch, then
          // continues with the same post; never inject the next material.
          workflow.batchChoiceSubmitted = true;
          const choice = firstBatchChoice({ plannedImageCount: expectedImages, maximum: 10 });
          expectedImages = choice.expectedImageCount;
          workflow.plannedImageCount = expectedImages;
          reportWorkbenchProgress(task, "确认首批出图", 38, "当前计划超过单轮上限，已自动选择第一批 P1-P10");
          await replaceComposerText(choice.reply, task.entry);
          await submitComposer();
          clearComposerDraft();
          await saveCheckpoint("已确认首批出图", 40);
          },
          {
            keywordPattern: imageKeywordPattern,
            keywordQuietMs: imageQuietMs,
            partialQuietMs: partialImageQuietMs,
            baselineAssistantTurns: Number(workflow.beforeImagesCount || 0),
            baselineAssistantTurnKeys: Array.isArray(workflow.beforeImageAssistantKeys)
              ? workflow.beforeImageAssistantKeys
              : [],
            silentThresholdMs: 60_000
          }
        );
        const recoveryAttempts = Math.max(0, Number(workflow.imageRecoveryAttempts || 0));
        const currentActualCount = effectiveGeneratedImageCount({
          urls: imageDetection.urls,
          declaredCount: imageDetection.completion?.declaredCount
        });
        const hasNewImageUrls = newGeneratedImageUrls(imageDetection.urls, imageUrls).length > 0;
        if (!actualImageCount) actualImageCount = currentActualCount;
        else if (hasNewImageUrls) actualImageCount = Math.min(expectedImages, actualImageCount + currentActualCount);
        // A timeout with no visible generation control is an uncertain, stale
        // boundary—not proof that GPT is still producing. Keeping
        // `settled === false` here made a 1/10 reply wait forever and never
        // reach the bounded missing-page recovery. The live copy/image
        // boundary is checked before this step, so only an actually generating
        // page remains an in-flight reply.
        const staleNonGeneratingTimeout = imageDetection.evidence === "timeout"
          && imageDetection.generating !== true;
        const currentReplyInFlight = Boolean(imageDetection.generating) && !staleNonGeneratingTimeout;
        const partialRecovery = mergePartialImageRecovery({
          accumulated: imageUrls,
          detected: imageDetection.urls,
          detectedCount: actualImageCount,
          expected: expectedImages,
          attempts: recoveryAttempts,
          maxAttempts: maxSilentRecoveryAttempts,
          currentReplyInFlight
        });
        imageUrls = limitGeneratedImageUrls(partialRecovery.urls, expectedImages);
        workflow.generatedImageUrls = imageUrls;
        workflow.generatedImageActualCount = actualImageCount;
        const recoverySignature = partialImageRecoverySignature({ urls: imageDetection.urls });
        const repeatedPartialSnapshot = Boolean(recoverySignature
          && recoverySignature === String(workflow.imageRecoveryLastSignature || ""));
        logTaskConversationEvent("images-detection-decision", {
          step: "wait-images",
          meta: {
            expectedImages,
            snapshotCount: imageDetection.urls.length,
            accumulatedCount: imageUrls.length,
            detectedCount: actualImageCount,
            action: partialRecovery.action,
            evidence: imageDetection.evidence,
            confident: Boolean(imageDetection.confident),
            settled: imageDetection.settled !== false,
            generating: Boolean(imageDetection.generating),
            currentReplyInFlight,
            stableForMs: Number(imageDetection.stableFor || 0),
            turnKey: imageDetection.completion?.turnKey || "",
            declaredCount: Number(imageDetection.completion?.declaredCount || 0),
            responseComplete: Boolean(imageDetection.completion?.responseComplete),
            repeatedPartialSnapshot
          }
        });
        if (partialRecovery.action === "wait-current") {
          reportWorkbenchProgress(task, "等待图片", 50, `网页仍在生成中，暂不按 ${actualImageCount}/${expectedImages} 补发提示`);
          break;
        }
        if (partialRecovery.action === "continue-missing" && repeatedPartialSnapshot) {
          logTaskConversationEvent("partial-image-recovery-suppressed", {
            step: "wait-images",
            meta: {
              detected: actualImageCount,
              expected: expectedImages,
              reason: "same-partial-image-snapshot",
              signature: recoverySignature
            }
          });
          reportWorkbenchProgress(task, "等待图片", 50, `当前仍是同一组 ${actualImageCount}/${expectedImages} 张，已阻止重复补图提示`);
          break;
        }
        if (partialRecovery.action === "continue-missing") {
          const copyBoundaryGuard = await guardImageRecoveryAgainstCopyBoundary();
          if (copyBoundaryGuard?.blocked) {
            if (copyBoundaryGuard.ready) return;
            const error = new Error(copyBoundaryGuard.error || "当前作品已进入文案边界；已暂停，未发送补图提示");
            error.code = copyBoundaryGuard.mismatch ? "WINDOW_STAGE_PENDING" : "COPY_IMAGE_HYDRATION_WAIT";
            throw error;
          }
          workflow.imageRecoveryLastSignature = recoverySignature;
          workflow.imageRecoveryAttempts = partialRecovery.nextAttempt;
          const recoveryPrompt = `当前实际只完成了 ${actualImageCount}/${expectedImages} 张独立图片。请从缺少的页面继续补齐到 ${expectedImages} 张；不要重复已有图片，不要重新输出计划，不要做合集总览，直接生成剩余独立 3:4 成品图。全部完成后明确回复“出图完毕”。`;
          reportWorkbenchProgress(task, "补齐缺少图片", 50, `累计图片 ${actualImageCount}/${expectedImages}，正在原地补齐（${workflow.imageRecoveryAttempts}/${maxSilentRecoveryAttempts}）`);
          await sendComposerText(recoveryPrompt);
          logTaskConversationEvent("partial-image-recovery-sent", {
            sentText: recoveryPrompt,
            step: "wait-images",
            meta: {
              attempt: workflow.imageRecoveryAttempts,
              detected: actualImageCount,
              expected: expectedImages,
              signature: recoverySignature,
              evidence: imageDetection.evidence,
              turnKey: imageDetection.completion?.turnKey || ""
            }
          });
          await saveCheckpoint("已请求补齐缺少图片", 50);
          continue;
        }
        if (partialRecovery.action === "pause-partial") break;
        if (!isRetryableNoImageResponseEvidence(imageDetection.evidence)) break;
        if (recoveryAttempts >= maxSilentRecoveryAttempts) break;
        const copyBoundaryGuard = await guardImageRecoveryAgainstCopyBoundary();
        if (copyBoundaryGuard?.blocked) {
          if (copyBoundaryGuard.ready) return;
          const error = new Error(copyBoundaryGuard.error || "当前作品已进入文案边界；已暂停，未发送续接图片提示");
          error.code = copyBoundaryGuard.mismatch ? "WINDOW_STAGE_PENDING" : "COPY_IMAGE_HYDRATION_WAIT";
          throw error;
        }
        workflow.imageRecoveryAttempts = recoveryAttempts + 1;
        const recoveryPrompt = `请继续完成刚才已经确认的全部图片生成。不要重新输出计划，直接按已确认的 P1-P${expectedImages} 生成全部独立 3:4 图片；总数就是 ${expectedImages} 张，不要多生成，也不要分批。`;
        reportWorkbenchProgress(task, "恢复图片生成", 50, `网页已停止但没有返回图片，正在原地续接（${workflow.imageRecoveryAttempts}/${maxSilentRecoveryAttempts}）`);
        await sendComposerText(recoveryPrompt);
        logTaskConversationEvent("image-recovery-sent", {
          sentText: recoveryPrompt,
          step: "wait-images",
          meta: { attempt: workflow.imageRecoveryAttempts }
        });
        await saveCheckpoint("已续接图片生成", 50);
      }
      let detected = limitGeneratedImageUrls(imageUrls, expectedImages);
      const detectedCount = Math.min(expectedImages, Math.max(0, Number(actualImageCount || effectiveGeneratedImageCount({
        urls: detected,
        declaredCount: imageDetection.completion?.declaredCount
      }))));
      workflow.generatedImageUrls = detected;
      workflow.generatedImageDetection = {
        confident: imageDetection.confident,
        evidence: imageDetection.evidence,
        detectedAt: new Date().toISOString(),
        turnKey: imageDetection.completion?.turnKey || "",
        declaredCount: Number(imageDetection.completion?.declaredCount || 0)
      };
      const exhaustedImageRecovery = classifyExhaustedImageRecovery({
        evidence: imageDetection.evidence,
        attempts: Number(workflow.imageRecoveryAttempts || 0),
        maxAttempts: maxSilentRecoveryAttempts,
        detected: detectedCount
      });
      if (exhaustedImageRecovery.action === "rotate-account") {
        const error = new Error("当前账号连续原生生图失败；已保留当前素材，交给下一个轮换账号继续");
        error.code = exhaustedImageRecovery.code || "IMAGE_GENERATION_UNAVAILABLE";
        error.detectedImages = detected.length;
        throw error;
      }
      // 记录检测到的图片 URL
      logTaskConversationEvent("images-detected", {
        step: "wait-images",
        imageUrls: detected,
        meta: { expectedImages, detectedCount, confident: imageDetection.confident, declaredCount: Number(imageDetection.completion?.declaredCount || 0) }
      });
      reportWorkbenchProgress(
        task,
        "等待图片",
        64,
        `已核对本轮 ${detectedCount} 张新图（计划 ${expectedImages} 张；${imageDetection.confident ? "回复已完整结束" : "检测证据不足"}）`
      );
      if (detectedCount > 0 && detectedCount < expectedImages) {
        const error = new Error(`图片没有补齐：实际检测到 ${detectedCount}/${expectedImages} 张独立图片；已暂停当前素材，不请求文案、不下载、不归档`);
        error.code = "IMAGE_COUNT_UNCERTAIN";
        error.detectedImages = detectedCount;
        throw error;
      }
      if (!imageDetection.confident && detectedCount < minimumImages) {
        const error = new Error(`图片数量检测不确定：当前找到 ${detectedCount} 张，但没有取得"回复完整结束"证据；已暂停当前素材，未判定额度触顶`);
        error.code = "IMAGE_COUNT_UNCERTAIN";
        error.detectedImages = detectedCount;
        throw error;
      }
      // 低图触顶补充检测:本轮只出 4 张及以下,且计划要求更多 → 疑似撞到生图上限。
      // PY脚本兜底拼图已在 waitForGeneratedImageGrowth 中通过 hardFailure 拦截;
      // 这里处理"直接少给图"的情况:计划 10 张但只出 4 张及以下。
      const imgCompletion = imageDetection.completion;
      if (detectedCount > 0 && detectedCount <= 4 && expectedImages > 4) {
        const error = new Error(`检测到 GPT 触顶特征:本轮只生成 ${detectedCount} 张图片(计划 ${expectedImages} 张),疑似撞到生图上限;已停止本帖`);
        error.code = "GENERATION_LIMIT_SIGNAL";
        error.detectedImages = detectedCount;
        error.riskReason = imgCompletion?.pyScriptFallbackSignal ? "py-script-fallback" : "low-image-output";
        throw error;
      }
      if (detectedCount < minimumImages) {
        const error = new Error(`生成结果不足：本轮完整回复只有 ${detectedCount} 张，安全线为 ${minimumImages} 张；本素材已跳过，不补页、不续作、不打包`);
        error.detectedImages = detectedCount;
        throw error;
      }
      workflow.generatedImageUrls = detected;
      task.entry.generatedImages = detectedCount;
      // Count generation when the current GPT reply is confirmed complete,
      // not when the later network download finishes.  This keeps the
      // rolling account usage and cat status current during the wait for TXT.
      if (!workflow.generationQuotaRecorded) {
        await recordWorkbenchQuota(task.entry, "generated", detectedCount);
        workflow.generationQuotaRecorded = true;
        await saveCheckpoint("本轮生图数量已记入账号额度", 66);
      }
    }

    // request-copy：发送小红书文案请求
    async function handleRequestCopy() {
      throwIfTaskAborted(task);
      if (!wfEnabled("request-copy")) {
        const error = new Error("文案请求环节已禁用，未创建 TXT；本轮不下载或打包图片，等待手动完成文案后再继续");
        error.code = "COPY_REQUIRED";
        throw error;
      }
      if (workflow.textSubmitted) {
        if (!workflow.copyText) {
          reportWorkbenchProgress(task, "继续等待小红书文案", 84, "已恢复当前网页中的文案生成，不重复发送请求");
        } else {
          reportWorkbenchProgress(task, "跳过文案请求", 84, "检测到本轮文案已完成（断点恢复），跳过请求小红书文案步骤");
        }
        return;
      }
      workflow.beforeTextCount = assistantTurns().length;
      workflow.beforeTextKeys = assistantTurnKeys();
      const copyPromptText = normalizePublishCopyPrompt(wfText("request-copy", normalizePublishCopyPrompt(options.copyPrompt)));
      reportWorkbenchProgress(task, "生成小红书文案", 72, "图片已完成，正在请求本帖文案；文案完成后才下载图片并打包");
      await sendComposerText(copyPromptText);
      // 记录文案请求发送的文字
      logTaskConversationEvent("copy-requested", { sentText: copyPromptText, step: "request-copy" });
      workflow.expectPlatformCopy = true;
      workflow.textSubmitted = true;
      await saveCheckpoint("已请求小红书文案", 72);
    }

    // wait-copy：等待小红书文案生成完成
    async function handleWaitCopy() {
      throwIfTaskAborted(task);
      const liveCopyBoundary = currentAutomationBoundarySnapshot();
      assertLiveAutomationBoundaryMatchesEntry(liveCopyBoundary, task.entry, "文案检查点恢复");
      reportWorkbenchProgress(task, "等待小红书文案", 72, "图片已生成，先取得本轮文案；文案完成前不下载、不打包");
      const baseCopyPrompt = normalizePublishCopyPrompt(wfText("request-copy", normalizePublishCopyPrompt(options.copyPrompt)));
      let requestedCopyPrompt = baseCopyPrompt;
      // 从工作流步骤参数读取超时和最小字数
      const copyTimeoutMs = wfAutoDetect("wait-copy") ? wfTimeout("wait-copy", 480) : 8 * 60_000;
      const copyMinLength = wfAutoDetect("wait-copy") ? wfParam("wait-copy", "minCopyLength", 300) : 300;
      const copyMinCheck = copyMinLength;
      const copyKeywordPattern = wfAutoDetect("wait-copy")
        ? String(wfParam("wait-copy", "keywordPattern", defaultKeywordPattern("wait-copy")) || defaultKeywordPattern("wait-copy"))
        : "";
      const copyDeadline = Date.now() + copyTimeoutMs;
      let copyRecoveryAttempts = Math.max(0, Number(workflow.copyRecoveryAttempts || 0));
      let publishResult = workflow.copyText ? { text: workflow.copyText } : null;
      // A streaming reply may have been sampled as a short fragment twice and
      // completed only after the retry budget was persisted. On reconnect the
      // finished reply is the strongest evidence and must be adopted before
      // the exhaustion guard. The virtualized DOM may hide the material turn,
      // so the fallback is allowed only for the exact durable account + /c/
      // owner and an already submitted copy step.
      if (!publishResult && workflow.textSubmitted === true && !generatingNow()) {
        const exactLiveOwner = Boolean(
          liveCopyBoundary?.materialText
            ? automationPromptMatchesEntry(liveCopyBoundary.materialText, task.entry)
            : durableRecoveryConversationMatchesEntry(task.entry)
        );
        const recoveredCopyTurn = exactLiveOwner && currentConversationHasCopyPrompt(baseCopyPrompt)
          ? latestCopyTurnAfterPrompt(baseCopyPrompt, {
            minimum: copyMinLength,
            keywordPattern: copyKeywordPattern,
            baselineKeys: []
          })
          : null;
        const recoveredCopyText = cleanAssistantText(recoveredCopyTurn);
        if (isPublishCopyReady(recoveredCopyText, copyMinLength)) {
          publishResult = { turn: recoveredCopyTurn, text: recoveredCopyText, recovered: true };
          workflow.copyRecoveryAttempts = 0;
          workflow.copyRecoveryExhausted = false;
          logTaskConversationEvent("completed-copy-adopted-before-exhaustion", {
            receivedText: recoveredCopyText,
            step: "wait-copy",
            meta: { copyLength: recoveredCopyText.length, reason: "finished-after-streaming-retry" }
          });
          reportWorkbenchProgress(task, "恢复完整文案", 76, "已读取原对话中后来完成的本轮文案，不再重复发送，继续下载和归档");
        }
      }
      // 文案恢复必须是有界的。若上一轮已经在同一检查点耗尽恢复次数，
      // 重新连接/重启只能继续等待人工或新的明确状态，不能再次发送同一份文案请求。
      if (workflow.copyRecoveryExhausted === true && !publishResult) {
        const copyError = new Error("文案等待/恢复已达到上限；已停止重复发送，未下载或归档图片");
        copyError.code = "COPY_REQUIRED";
        copyError.recoveryAttempts = copyRecoveryAttempts;
        throw copyError;
      }
      while (!publishResult && Date.now() < copyDeadline) {
        publishResult = await waitForPublishCopy(requestedCopyPrompt, Math.min(45_000, copyDeadline - Date.now()), {
          minimum: copyMinLength,
          keywordPattern: copyKeywordPattern,
          baselineKeys: workflow.beforeTextKeys
        });
        if (publishResult) break;
        const shortCandidate = latestAssistantTurnPairedWithCopyPrompt(requestedCopyPrompt);
        const shortText = cleanAssistantText(shortCandidate);
        const recovery = decideCopyRecovery({
          attempts: copyRecoveryAttempts,
          maxAttempts: 2,
          hasCandidate: Boolean(shortCandidate && shortText),
          promptMissing: !currentConversationHasCopyPrompt(requestedCopyPrompt),
          generating: generatingNow(),
          valid: isLikelyPublishCopy(shortText, copyMinLength)
        });
        if (recovery.action === "pause") {
          workflow.copyRecoveryExhausted = true;
          await saveCheckpoint("文案恢复达到上限", 74);
          const copyError = new Error(`文案连续 ${copyRecoveryAttempts} 次恢复后仍不完整；已停止自动重复发送，未下载或归档图片`);
          copyError.code = "COPY_REQUIRED";
          copyError.recoveryAttempts = copyRecoveryAttempts;
          throw copyError;
        }
        if (recovery.action !== "retry-current") continue;
        copyRecoveryAttempts = recovery.nextAttempt;
        workflow.copyRecoveryAttempts = copyRecoveryAttempts;
        await saveCheckpoint("恢复小红书文案", 74);
        requestedCopyPrompt = shortCandidate
          ? `${baseCopyPrompt}\n\n上一次回复不完整。请重新一次性输出至少 ${copyMinLength} 个可见字符的完整文案，不能只输出标题或片段。`
          : baseCopyPrompt;
        reportWorkbenchProgress(task, "恢复小红书文案", 74, `检测到短文案，正在重试当前文案请求（${copyRecoveryAttempts}/2）`);
        await sendComposerText(requestedCopyPrompt);
        logTaskConversationEvent("copy-recovery-sent", {
          sentText: requestedCopyPrompt,
          receivedText: shortText,
          step: "wait-copy",
          meta: { attempt: copyRecoveryAttempts, shortLength: shortText.length }
        });
      }
      if (!publishResult) {
        workflow.copyRecoveryExhausted = true;
        await saveCheckpoint("文案等待超时", 74);
        const copyError = new Error("文案等待/恢复已达到上限；已停止重复发送，未下载或归档图片");
        copyError.code = "COPY_REQUIRED";
        copyError.recoveryAttempts = copyRecoveryAttempts;
        throw copyError;
      }
      workflow.copyText = String(publishResult?.text || "").trim();
      workflow.copyRecoveryAttempts = 0;
      workflow.copyRecoveryExhausted = false;
      // 记录 GPT 返回的小红书文案全文
      logTaskConversationEvent("copy-received", { receivedText: workflow.copyText, step: "wait-copy", meta: { copyLength: workflow.copyText.length } });
      let platformValidation = validatePlatformCopy(workflow.copyText, {
        minimumSectionLength: Math.max(80, Math.floor(copyMinCheck / 2))
      });
      if (workflow.expectPlatformCopy && (!platformValidation.valid || platformValidation.parsed.formatVersion !== 2)) {
        const formatRecoveryAttempts = Math.max(0, Number(workflow.copyFormatRecoveryAttempts || 0));
        if (formatRecoveryAttempts < 1) {
          workflow.copyFormatRecoveryAttempts = formatRecoveryAttempts + 1;
          const rewriteBaselineKeys = assistantTurnKeys();
          const rewritePrompt = `${baseCopyPrompt}\n\n上一次回复没有通过双平台机器协议（${platformValidation.issues.join("、") || "格式不完整"}）。请基于同一事实重新一次性输出完整的 XHS 与 DOUYIN 两个区段；严格保留机器标记，XHS 最后一行10个话题标签，DOUYIN 最后一行5个话题标签，不要输出任何标记外文字。`;
          reportWorkbenchProgress(task, "恢复双平台文案", 75, "检测到双平台 TXT 协议或标签数量不完整，正在原地重写一次");
          await sendComposerText(rewritePrompt);
          logTaskConversationEvent("copy-format-recovery-sent", {
            sentText: rewritePrompt,
            receivedText: workflow.copyText,
            step: "wait-copy",
            meta: { attempt: workflow.copyFormatRecoveryAttempts, issues: platformValidation.issues }
          });
          const rewriteResult = await waitForPublishCopy(rewritePrompt, Math.max(1_000, copyDeadline - Date.now()), {
            minimum: copyMinCheck,
            keywordPattern: copyKeywordPattern,
            baselineKeys: rewriteBaselineKeys
          });
          workflow.copyText = String(rewriteResult?.text || "").trim();
          platformValidation = validatePlatformCopy(workflow.copyText, {
            minimumSectionLength: Math.max(80, Math.floor(copyMinCheck / 2))
          });
          logTaskConversationEvent("copy-format-recovery-received", {
            receivedText: workflow.copyText,
            step: "wait-copy",
            meta: { copyLength: workflow.copyText.length, issues: platformValidation.issues }
          });
        }
        if (!platformValidation.valid || platformValidation.parsed.formatVersion !== 2) {
          const copyError = new Error(`双平台文案未通过 TXT 机器协议：${platformValidation.issues.join("、") || "格式不完整"}`);
          copyError.code = "COPY_FORMAT_INVALID";
          copyError.issues = platformValidation.issues;
          throw copyError;
        }
      }
      workflow.platformCopy = platformValidation.parsed;
      workflow.copyFormatRecoveryAttempts = 0;
      // 文案校验
      if (!isLikelyPublishCopy(workflow.copyText, copyMinCheck)) {
        const copyError = new Error(`没有检测到不少于 ${copyMinCheck} 个可见字符的完整小红书文案，未执行图片下载与打包`);
        copyError.code = "COPY_REQUIRED";
        throw copyError;
      }
      let narrationResult = detectCopyMetaNarration(workflow.copyText);
      if (narrationResult.matched) {
        reportWorkbenchProgress(task, "纠正文案", 76, "检测到素材来源旁白，正在自动完整重写一次；纠正完成前不保存、不下载、不打包");
        logTaskConversationEvent("copy-meta-narration-detected", {
          receivedText: workflow.copyText,
          step: "wait-copy",
          meta: { matches: narrationResult.matches }
        });
        const rewriteBaselineKeys = assistantTurnKeys();
        await sendComposerText(COPY_META_NARRATION_REWRITE_PROMPT);
        logTaskConversationEvent("copy-meta-narration-rewrite", {
          sentText: COPY_META_NARRATION_REWRITE_PROMPT,
          step: "wait-copy",
          meta: { matches: narrationResult.matches }
        });
        const rewriteResult = await waitForPublishCopy(COPY_META_NARRATION_REWRITE_PROMPT, Math.max(1_000, copyDeadline - Date.now()), {
          minimum: copyMinCheck,
          keywordPattern: copyKeywordPattern,
          baselineKeys: rewriteBaselineKeys
        });
        workflow.copyText = String(rewriteResult?.text || "").trim();
        narrationResult = detectCopyMetaNarration(workflow.copyText);
        const correctedPlatformValidation = workflow.expectPlatformCopy
          ? validatePlatformCopy(workflow.copyText, { minimumSectionLength: Math.max(80, Math.floor(copyMinCheck / 2)) })
          : { valid: true, issues: [] };
        if (!isLikelyPublishCopy(workflow.copyText, copyMinCheck) || !correctedPlatformValidation.valid || narrationResult.matched) {
          const copyError = new Error("文案自动纠正后仍含素材来源或制作过程旁白；已硬暂停，未保存 TXT、未下载图片、未打包或归档");
          copyError.code = narrationResult.matched ? "COPY_META_NARRATION" : "COPY_FORMAT_INVALID";
          copyError.matches = narrationResult.matches;
          copyError.issues = correctedPlatformValidation.issues;
          throw copyError;
        }
        logTaskConversationEvent("copy-meta-narration-corrected", {
          receivedText: workflow.copyText,
          step: "wait-copy",
          meta: { copyLength: workflow.copyText.length }
        });
      }
      workflow.textSubmitted = true;
      workflow.batchId ||= workPackageBatchId();
      await saveCheckpoint("文案已生成", 78);
    }

    // ── 打包归档公共逻辑：move-archive（分离）和 package-archive（合并）共用 ──
    // clipboard 写入 + packageDownloadedReply 调用 + 查重跳过 + 事件分发
    async function archivePackageReply(copyText, downloadResult, checkpointLabel, dispatchEvent) {
      if (workflow.packageResult) return; // 已归档
      const liveArchiveBoundary = currentAutomationBoundarySnapshot();
      assertLiveAutomationBoundaryMatchesEntry(liveArchiveBoundary, task.entry, "归档");
      const narrationResult = detectCopyMetaNarration(copyText);
      const platformValidation = workflow.expectPlatformCopy
        ? validatePlatformCopy(copyText, { minimumSectionLength: 80 })
        : { valid: true, issues: [] };
      if (!isLikelyPublishCopy(copyText, 300) || !platformValidation.valid || narrationResult.matched) {
        const copyError = new Error("文案未通过成品质量门，禁止打包或归档");
        copyError.code = narrationResult.matched
          ? "COPY_META_NARRATION"
          : !platformValidation.valid
            ? "COPY_FORMAT_INVALID"
            : "COPY_REQUIRED";
        copyError.matches = narrationResult.matches;
        copyError.issues = platformValidation.issues;
        throw copyError;
      }
      try { await navigator.clipboard.writeText(copyText); } catch (e) { /* optional */ }
      const downloadedFileDirectories = [...new Set((downloadResult.files || [])
        .map((file) => String(file || "").replace(/[\\/][^\\/]+$/, ""))
        .filter(Boolean))];
      const packageDownloadRoot = downloadedFileDirectories.length === 1
        ? downloadedFileDirectories[0]
        : String(downloadResult.downloadRoot || options.downloadRoot || "").trim();
      const packageResult = await packageDownloadedReply({
        clipboardText: copyText,
        title: task.entry.name,
        conversationUrl: location.href,
        accountName: localStorage.getItem("tb-workbench-account-id") || "",
             sourceMaterialPath: String(task.entry.materialPath || task.entry.path || ""),
            productionMode: String(options.mode || task.entry.productionMode || ""),
        batchId: downloadResult.batchId,
        expectedImageCount: downloadResult.count,
        downloadRoot: packageDownloadRoot,
        productRoot: String(options.productRoot || "").trim()
      });
      workflow.packageResult = packageResult;
      // Successful packaging closes the latest material turn. Persist that
      // boundary so a same-conversation next post is not blocked as stale.
      const currentArchiveBoundary = currentAutomationBoundarySnapshot();
      markArchivedAutomationBoundary(String(
        currentArchiveBoundary?.materialText || latestAutomationMaterialPrompt()
      ));
      // 记录打包归档结果
      logTaskConversationEvent("archived", {
        step: "archive",
        packagePath: String(packageResult?.packagePath || packageResult?.finalPath || ""),
        copyTextPath: workflow.copyTextPath || "",
        meta: {
          duplicate: Boolean(packageResult.duplicate),
          duplicateReason: packageResult.duplicateReason || "",
          imageCount: downloadResult.count,
          batchId: downloadResult.batchId
        }
      });
      if (packageResult.duplicate) {
        reportWorkbenchProgress(task, "查重跳过", 100,
          `与历史作品图片完全重复，已删除本轮 ${Number(packageResult.deletedImages || downloadResult.count)} 张暂存图片并跳过`);
        // A duplicate image set skips only the second package.  The source
        // material still has to cross the normal archive boundary below;
        // returning here used to leave the production history at "TXT saved"
        // and made the next post look like a stale unfinished conversation.
        workflow.duplicateSkipped = true;
        workflow.duplicateReason = packageResult.duplicateReason || "ExactImageSet";
        return;
      }
      if (checkpointLabel) await saveCheckpoint(checkpointLabel, 96);
      if (dispatchEvent) {
        document.dispatchEvent(new CustomEvent("tb-gpt-image-download-complete", {
          detail: {
            urls: Array.isArray(workflow.generatedImageUrls) ? workflow.generatedImageUrls : [],
            downloaded: downloadResult.count,
            total: Math.max(downloadResult.count, Number(workflow.plannedImageCount || 0)),
            batchId: downloadResult.batchId,
            state: "packaged",
            source: "automatic"
          }
        }));
      }
      reportWorkbenchProgress(task, "完成", 100, `已打包 ${downloadResult.count} 张图片和小红书文案`);
    }

    // ── 统一归档 handler ──
    // save-text / download-images / move-archive（分离模式）和 package-archive（合并模式）共用
    // 由 step.action 决定执行哪个归档子操作，消除 usesSeparatedArchive 分支
    async function handleArchive(step) {
      throwIfTaskAborted(task);
      const action = step.action;

      // save-text：保存文案 TXT（分离模式）
      if (action === "save-text") {
        if (!wfEnabled("save-text")) {
          reportWorkbenchProgress(task, "跳过文案保存", 80, "save-text 环节已禁用");
          return;
        }
        if (workflow.copyTextPath) return; // 已保存
        const narrationResult = detectCopyMetaNarration(workflow.copyText);
        const platformValidation = workflow.expectPlatformCopy
          ? validatePlatformCopy(workflow.copyText, { minimumSectionLength: 80 })
          : { valid: true, issues: [] };
        if (!isLikelyPublishCopy(workflow.copyText, 300) || !platformValidation.valid || narrationResult.matched) {
          const copyError = new Error("文案未通过成品质量门，禁止保存 TXT");
          copyError.code = narrationResult.matched
            ? "COPY_META_NARRATION"
            : !platformValidation.valid
              ? "COPY_FORMAT_INVALID"
              : "COPY_REQUIRED";
          copyError.matches = narrationResult.matches;
          copyError.issues = platformValidation.issues;
          throw copyError;
        }
        const copyFile = await api("/api/extension/save-copy-text", {
          method: "POST",
          body: JSON.stringify({
            batchId: workflow.batchId,
            copyText: workflow.copyText,
            downloadRoot: String(options.downloadRoot || "")
          })
        });
        if (!copyFile?.ok || !copyFile.filename) throw new Error(copyFile?.error || "本轮文案 TXT 保存失败");
        workflow.copyTextPath = String(copyFile.filename);
        // 记录文案保存路径
        logTaskConversationEvent("text-saved", { step: "save-text", copyTextPath: workflow.copyTextPath, meta: { copyLength: workflow.copyText.length } });
        reportWorkbenchProgress(task, "文案已保存", 80, `TXT 已写入：${copyFile.filename}`);
        await saveCheckpoint("文案 TXT 已保存", 80);
        return;
      }

      // download-images：下载图片（分离模式）
      if (action === "download-images") {
        if (!wfEnabled("download-images")) {
          reportWorkbenchProgress(task, "跳过图片下载", 85, "download-images 环节已禁用");
          return;
        }
        if (workflow.downloadResult) return; // 已下载
        const imageUrls = workflow.generatedImageUrls || [];
        workflow.downloadResult = await downloadFreshImages(imageUrls, task);
        workflow.downloadResult.downloadRoot = String(options.downloadRoot || "");
        // 记录下载的图片信息
        logTaskConversationEvent("images-downloaded", {
          step: "download-images",
          imageUrls,
          downloadedFiles: (workflow.downloadResult.files || []).map(f => String(f)),
          meta: { count: workflow.downloadResult.count, downloadRoot: workflow.downloadResult.downloadRoot }
        });
        await saveCheckpoint("图片下载完成", 85);
        const downloadedImages = workflow.downloadResult.count;
        if (!downloadedImages) throw new Error("图片下载数量为 0");
        if (workflow.plannedImageCount && downloadedImages < workflow.plannedImageCount) {
          const error = new Error(`实际只下载 ${downloadedImages}/${workflow.plannedImageCount} 张，禁止打包归档`);
          error.code = "IMAGE_COUNT_UNCERTAIN";
          error.detectedImages = downloadedImages;
          throw error;
        }
        const minimumImages = Math.max(1, Number(options.minimumImageCount || 4));
        if (downloadedImages < minimumImages) {
          throw new Error(`生成图片不足：实际 ${downloadedImages} 张，安全线为 ${minimumImages} 张`);
        }
        reportWorkbenchProgress(task, "图片已下载", 88, `${downloadedImages} 张图片已保存到本地`);
        return;
      }

      // move-archive：移动到成品库（分离模式）
      if (action === "move-archive") {
        if (!wfEnabled("move-archive")) {
          reportWorkbenchProgress(task, "完成", 100, "move-archive 环节已禁用，文件保留在下载目录");
          return;
        }
        await archivePackageReply(workflow.copyText, workflow.downloadResult, "作品归档完成", false);
        return;
      }

        // package-archive：合并模式，一次性完成保存+下载+打包
      if (action === "package-archive") {
        if (!wfEnabled("package-archive")) return;
        if (workflow.packageResult) return; // 已打包
        const copyText = workflow.copyText;
        const narrationResult = detectCopyMetaNarration(copyText);
        const platformValidation = workflow.expectPlatformCopy
          ? validatePlatformCopy(copyText, { minimumSectionLength: 80 })
          : { valid: true, issues: [] };
        if (!isLikelyPublishCopy(copyText, 300) || !platformValidation.valid || narrationResult.matched) {
          const copyError = new Error("文案未通过成品质量门，禁止保存、下载、打包或归档");
          copyError.code = narrationResult.matched
            ? "COPY_META_NARRATION"
            : !platformValidation.valid
              ? "COPY_FORMAT_INVALID"
              : "COPY_REQUIRED";
          copyError.matches = narrationResult.matches;
          copyError.issues = platformValidation.issues;
          throw copyError;
        }

        // 1. 保存文案 TXT
        if (!workflow.copyTextPath) {
          const copyFile = await api("/api/extension/save-copy-text", {
            method: "POST",
            body: JSON.stringify({
              batchId: workflow.batchId,
              copyText,
              downloadRoot: String(options.downloadRoot || "")
            })
          });
          if (!copyFile?.ok || !copyFile.filename) throw new Error(copyFile?.error || "本轮文案 TXT 保存失败，未下载图片");
          workflow.copyTextPath = String(copyFile.filename);
          // 记录文案保存路径（合并模式）
          logTaskConversationEvent("text-saved", { step: "package-archive/save-text", copyTextPath: workflow.copyTextPath, meta: { copyLength: copyText.length } });
          await saveCheckpoint("文案 TXT 已保存", 78);
        }

        // 2. 下载图片
        if (!workflow.downloadResult) {
          const imageUrls = workflow.generatedImageUrls || [];
          workflow.downloadResult = await downloadFreshImages(imageUrls, task);
          workflow.downloadResult.downloadRoot = String(options.downloadRoot || "");
          // 记录下载的图片信息（合并模式）
          logTaskConversationEvent("images-downloaded", {
            step: "package-archive/download-images",
            imageUrls,
            downloadedFiles: (workflow.downloadResult.files || []).map(f => String(f)),
            meta: { count: workflow.downloadResult.count, downloadRoot: workflow.downloadResult.downloadRoot }
          });
          await saveCheckpoint("图片下载完成", 80);
        }
        const downloadResult = workflow.downloadResult;
        const downloadedImages = downloadResult.count;
        if (!downloadedImages) throw new Error("图片下载数量为 0，未执行打包");
        if (workflow.plannedImageCount && downloadedImages < workflow.plannedImageCount) {
          const error = new Error(`实际只下载 ${downloadedImages}/${workflow.plannedImageCount} 张，禁止打包归档`);
          error.code = "IMAGE_COUNT_UNCERTAIN";
          error.detectedImages = downloadedImages;
          throw error;
        }
        const minimumImages = Math.max(1, Number(options.minimumImageCount || 4));
        if (downloadedImages < minimumImages) {
          throw new Error(`生成图片不足：实际 ${downloadedImages} 张，安全线为 ${minimumImages} 张；本素材已跳过，未执行打包`);
        }
        await saveCheckpoint("文案与图片准备完成", 89);
        try {
          await navigator.clipboard.writeText(copyText);
        } catch (error) {
          console.warn("[团建自动生产] 剪贴板不可用，继续直接写入 TXT：", error);
          reportWorkbenchProgress(task, "保存小红书文案", 89, "网页当前不在焦点，已跳过剪贴板并直接写入 TXT");
        }

        // 3. 检查自动打包开关
        reportWorkbenchProgress(task, "打包作品", 92, `已下载 ${downloadedImages} 张图，正在写入 TXT 并打包`);
        if (options.autoPackage === false) {
          reportWorkbenchProgress(task, "完成", 100, `已下载 ${downloadedImages} 张图并复制文案；自动打包已关闭`);
          earlyReturn = { downloadedImages, copyText, packageSkipped: true, batchId: downloadResult.batchId, conversationUrl: location.href };
          return;
        }

        // 4. 打包归档
        await archivePackageReply(copyText, downloadResult, "作品打包完成", true);
      }
    }
    if (task.entry.reconcileAction === "nudge-plan" && stateSnapshot.stage === "waiting-plan" && !generatingNow()) {
      // A refresh can leave the attachment turn in the conversation while
      // GPT never starts its reply.  Reuse the current turn and send a small
      // nudge; do not upload the material again.
      await replaceComposerText("请继续输出当前这份素材的逐页迁移计划，先不要出图，完成后等待我回复 1。", task.entry);
      await submitComposer();
      clearComposerDraft();
      // 记录补发计划请求
      logTaskConversationEvent("nudge-plan-sent", { sentText: "请继续输出当前这份素材的逐页迁移计划，先不要出图，完成后等待我回复 1。", step: "nudge-plan" });
      reportWorkbenchProgress(task, "已重新请求迁移计划", 18, "检测到上传后网页没有继续响应，已在当前对话补发计划请求");
      task.entry.reconcileAction = "";
    }
    const boundaryDecision = classifyAutomationBoundaryPause(stateSnapshot);
    if (boundaryDecision.shouldPause) {
      logGptLimitDebug("state-snapshot-boundary-pause", {
        code: boundaryDecision.code,
        riskReason: boundaryDecision.riskReason,
        message: boundaryDecision.message,
        stage: stateSnapshot.stage,
        latestImageCount: stateSnapshot.latestImageCount,
        scriptOutput: stateSnapshot.scriptOutput,
        scriptOutputLimitSignal: stateSnapshot.scriptOutputLimitSignal,
        pyScriptFallbackSignal: stateSnapshot.pyScriptFallbackSignal,
        limitSignal: stateSnapshot.limitSignal,
        lowImageLimit: stateSnapshot.lowImageLimit,
        latestAssistantTextSample: String(stateSnapshot.latestAssistantText || "").slice(0, 500)
      });
      const error = new Error(boundaryDecision.message);
      error.code = boundaryDecision.code;
      error.riskReason = boundaryDecision.riskReason;
      throw error;
    }
    const retryStage = String(task.entry.retryFromStage || "");
    const checkpointRequestId = String(task.entry.externalRequestId || "");
    const saveCheckpoint = async (stage, percent) => {
      if (!checkpointRequestId) return null;
      const observedAt = new Date().toISOString();
      const pageSnapshot = conversationStateSnapshot();
      const downloadedImageCount = Array.isArray(workflow.downloadResult?.files)
        ? workflow.downloadResult.files.length
        : 0;
      const currentStep = resolveDurableWorkflowStep({
        currentStep: workflow.currentStep,
        pageStage: pageSnapshot.stage,
        planSubmitted: workflow.planSubmitted,
        planDone: workflow.planDone,
        plannedImageCount: workflow.plannedImageCount,
        imageSubmitted: workflow.imageSubmitted,
        confirmTurnKey: workflow.confirmTurnKey,
        generatedImageActualCount: workflow.generatedImageActualCount,
        generatedImageUrls: workflow.generatedImageUrls,
        textSubmitted: workflow.textSubmitted,
        copyText: workflow.copyText,
        copyTextPath: workflow.copyTextPath,
        downloadedImageCount,
        packagePath: workflow.packageResult?.packagePath,
        archived: Number(percent || 0) >= 100 && /归档/.test(String(stage || ""))
      });
      const pageDetectedStep = resolveDurableWorkflowStep({ pageStage: pageSnapshot.stage });
      workflow.currentStep = currentStep;
      workflow.lastCompletedStep = currentStep;
      workflow.evidenceHistory = [
        ...(Array.isArray(workflow.evidenceHistory) ? workflow.evidenceHistory : []),
        {
          source: "page",
          step: pageDetectedStep,
          visibility: pageSnapshot.stage ? "visible" : "unavailable",
          observedAt,
          summary: String(pageSnapshot.stage || "page-stage-unavailable")
        },
        {
          source: "checkpoint",
          step: currentStep,
          visibility: "visible",
          observedAt,
          summary: String(stage || currentStep)
        }
      ].slice(-64);
      const stateConfidence = pageSnapshot.stage && pageDetectedStep === currentStep
        ? "HIGH_CONFIDENCE"
        : "MEDIUM_CONFIDENCE";
      return api("/api/gpt-production/checkpoint", {
        method: "POST",
        body: JSON.stringify({
          requestId: checkpointRequestId,
          checkpoint: {
            stage,
            percent,
            accountWindowId: String(task.entry.accountId || localStorage.getItem("tb-workbench-account-id") || ""),
            accountId: String(task.entry.accountId || localStorage.getItem("tb-workbench-account-id") || ""),
            conversationUrl: location.href,
            sourceMaterialPath: String(task.entry.materialPath || task.entry.path || ""),
            productionMode: String(options.mode || task.entry.productionMode || ""),
            workflowVariant: String(task.entry.workflowVariant || "legacy-v1"),
            workflowVariantVersion: String(task.entry.workflowVariantVersion || "1"),
            experimentId: String(task.entry.experimentId || ""),
            sessionPolicy: String(task.entry.sessionPolicy || "reuse-conversation"),
            templateConversationUrl: String(task.entry.templateConversationUrl || ""),
            workflowProfileId: String(task.entry.workflowProfileId || ""),
            plannedImageCount: workflow.plannedImageCount,
            planSubmitted: workflow.planSubmitted,
            imageSubmitted: workflow.imageSubmitted,
            generatedImageUrls: workflow.generatedImageUrls || [],
            generatedImageActualCount: Number(workflow.generatedImageActualCount || 0),
            generatedImageDetection: workflow.generatedImageDetection || null,
            generatedBaselineUrls: workflow.generatedBaselineUrls || [],
            beforeImagesCount: Number(workflow.beforeImagesCount || 0),
            beforeImageAssistantKeys: workflow.beforeImageAssistantKeys || [],
            confirmTurnKey: workflow.confirmTurnKey || "",
            imageRecoveryAttempts: Number(workflow.imageRecoveryAttempts || 0),
            imageRecoveryFailureSignature: String(workflow.imageRecoveryFailureSignature || ""),
            recoveryBoundaryConfirmed: workflow.recoveryBoundaryConfirmed === true,
             copyRecoveryAttempts: Number(workflow.copyRecoveryAttempts || 0),
             copyRecoveryExhausted: workflow.copyRecoveryExhausted === true,
             textSubmitted: workflow.textSubmitted,
             metricsStartedAt: String(task.metrics?.startedAt || ""),
             stageHistory: Array.isArray(task.metrics?.history) ? task.metrics.history.slice(-64) : [],
             workflowStepHistory: Array.isArray(task.workflowStepHistory) ? task.workflowStepHistory.slice(-64) : [],
             workflowStepAttempts: task.workflowStepAttempts && typeof task.workflowStepAttempts === "object" ? task.workflowStepAttempts : {},
             stepTiming: task.stepTiming && typeof task.stepTiming === "object" ? task.stepTiming : null,
             workflowStartedAt: String(task.workflowStartedAt || ""),
             workflowDeadlineAt: String(task.workflowDeadlineAt || ""),
             workflowTimeoutMs: Math.max(0, Number(task.workflowTimeoutMs || 0)),
             batchId: workflow.downloadResult?.batchId || workflow.batchId,
            downloadRoot: workflow.downloadResult?.downloadRoot || options.downloadRoot,
            downloadedFiles: workflow.downloadResult?.files || [],
            copyText: workflow.copyText || "",
            copyTextPath: workflow.copyTextPath || "",
            packagePath: workflow.packageResult?.packagePath || "",
            currentStep,
            lastCompletedStep: workflow.lastCompletedStep,
            pageDetectedState: {
              step: pageDetectedStep,
              visibility: pageSnapshot.stage ? "visible" : "unavailable",
              observedAt,
              confidence: stateConfidence,
              signals: [String(pageSnapshot.stage || "unknown")]
            },
            checkpointDetectedState: {
              step: currentStep,
              visibility: "visible",
              observedAt,
              confidence: "HIGH_CONFIDENCE",
              signals: [String(stage || currentStep)]
            },
            stateConfidence,
            stateConflictReason: stateConfidence === "HIGH_CONFIDENCE" ? "" : "page-checkpoint-stage-differ",
            lastSafeAction: ({
              "session-ready": "upload-material",
              "plan-ready": "send-confirm",
              "images-ready": "request-copy",
              "copy-ready": "download-and-package",
              packaged: "archive",
              archived: "advance-queue"
            })[currentStep] || "inspect",
            evidenceHistory: workflow.evidenceHistory
          }
        })
      }).catch(() => null);
    };
    if (checkpointRequestId && retryStage) {
      const saved = await api(`/api/gpt-production/checkpoint?requestId=${encodeURIComponent(checkpointRequestId)}`).catch(() => null);
      const checkpoint = saved?.checkpoint;
      if (checkpoint && checkpoint.conversationUrl === location.href) {
        workflow.plannedImageCount ||= Number(checkpoint.plannedImageCount || 0);
        workflow.planSubmitted ||= Boolean(checkpoint.planSubmitted);
        workflow.planDone ||= Boolean(checkpoint.plannedImageCount && checkpoint.planSubmitted);
        workflow.imageSubmitted ||= Boolean(checkpoint.imageSubmitted);
        workflow.generatedImageUrls ||= checkpoint.generatedImageUrls || [];
        workflow.generatedImageActualCount = Math.max(
          Number(workflow.generatedImageActualCount || 0),
          Number(checkpoint.generatedImageActualCount || 0),
          Number(checkpoint.downloadedFiles?.length || 0)
        );
        workflow.generatedImageDetection ||= checkpoint.generatedImageDetection || null;
        if (!Array.isArray(workflow.generatedBaselineUrls) || !workflow.generatedBaselineUrls.length) {
          workflow.generatedBaselineUrls = checkpoint.generatedBaselineUrls || [];
        }
        if (!Number(workflow.beforeImagesCount || 0)) {
          workflow.beforeImagesCount = Number(checkpoint.beforeImagesCount || 0);
        }
        if (!Array.isArray(workflow.beforeImageAssistantKeys) || !workflow.beforeImageAssistantKeys.length) {
          workflow.beforeImageAssistantKeys = checkpoint.beforeImageAssistantKeys || [];
        }
        if (!String(workflow.confirmTurnKey || "").trim()) {
          workflow.confirmTurnKey = String(checkpoint.confirmTurnKey || "");
        }
        workflow.imageRecoveryAttempts ||= Number(checkpoint.imageRecoveryAttempts || 0);
        workflow.imageRecoveryFailureSignature ||= String(checkpoint.imageRecoveryFailureSignature || "");
        workflow.recoveryBoundaryConfirmed ||= checkpoint.recoveryBoundaryConfirmed === true;
        workflow.copyRecoveryAttempts = Math.max(
          Number(workflow.copyRecoveryAttempts || 0),
          Number(checkpoint.copyRecoveryAttempts || 0)
        );
        workflow.copyRecoveryExhausted ||= checkpoint.copyRecoveryExhausted === true;
        workflow.textSubmitted ||= Boolean(checkpoint.textSubmitted);
        workflow.copyText ||= String(checkpoint.copyText || "");
        workflow.copyTextPath ||= String(checkpoint.copyTextPath || "");
        if (!workflow.downloadResult && Array.isArray(checkpoint.downloadedFiles) && checkpoint.downloadedFiles.length) {
          workflow.downloadResult = {
            files: checkpoint.downloadedFiles.slice(),
            downloadRoot: String(checkpoint.downloadRoot || ""),
            batchId: String(checkpoint.batchId || "")
          };
        }
        if (!workflow.packageResult && String(checkpoint.packagePath || "").trim()) {
          workflow.packageResult = { packagePath: String(checkpoint.packagePath) };
        }
        workflow.currentStep = resolveDurableWorkflowStep({
          currentStep: workflow.currentStep || checkpoint.currentStep || checkpoint.lastCompletedStep,
          planSubmitted: workflow.planSubmitted,
          planDone: workflow.planDone,
          plannedImageCount: workflow.plannedImageCount,
          imageSubmitted: workflow.imageSubmitted,
          confirmTurnKey: workflow.confirmTurnKey,
          generatedImageActualCount: workflow.generatedImageActualCount,
          generatedImageUrls: workflow.generatedImageUrls,
          textSubmitted: workflow.textSubmitted,
          copyText: checkpoint.copyText,
          copyTextPath: checkpoint.copyTextPath,
          downloadedImageCount: Array.isArray(checkpoint.downloadedFiles) ? checkpoint.downloadedFiles.length : 0,
          packagePath: checkpoint.packagePath,
          archived: checkpoint.usageUpdated === true
        });
        workflow.lastCompletedStep = workflow.currentStep;
        workflow.evidenceHistory = Array.isArray(checkpoint.evidenceHistory)
          ? checkpoint.evidenceHistory.slice(-64)
          : [];
        if (Array.isArray(checkpoint.workflowStepHistory) && checkpoint.workflowStepHistory.length) {
          task.workflowStepHistory = checkpoint.workflowStepHistory.slice(-64);
        }
        if (checkpoint.workflowStepAttempts && typeof checkpoint.workflowStepAttempts === "object") {
          task.workflowStepAttempts = { ...checkpoint.workflowStepAttempts };
        }
        if (checkpoint.stepTiming && typeof checkpoint.stepTiming === "object") {
          task.stepTiming = { ...checkpoint.stepTiming };
        }
        const checkpointStartedMs = Date.parse(String(checkpoint.workflowStartedAt || ""));
        const checkpointDeadlineMs = Date.parse(String(checkpoint.workflowDeadlineAt || ""));
        if (Number.isFinite(checkpointStartedMs) && checkpointStartedMs > 0) {
          task.workflowStartedMs = checkpointStartedMs;
          task.workflowStartedAt = new Date(checkpointStartedMs).toISOString();
        }
        if (Number.isFinite(checkpointDeadlineMs) && checkpointDeadlineMs > 0) {
          task.workflowDeadlineMs = checkpointDeadlineMs;
          task.workflowDeadlineAt = new Date(checkpointDeadlineMs).toISOString();
        }
        if (Number(checkpoint.workflowTimeoutMs || 0) > 0) {
          task.workflowTimeoutMs = Number(checkpoint.workflowTimeoutMs);
        }
        if (Array.isArray(checkpoint.stageHistory) && checkpoint.stageHistory.length) {
          const restoredHistory = checkpoint.stageHistory.slice(-64);
          task.metrics ||= {
            startedMs: Date.parse(String(checkpoint.metricsStartedAt || restoredHistory[0]?.startedAt || "")) || Date.now(),
            startedAt: String(checkpoint.metricsStartedAt || restoredHistory[0]?.startedAt || new Date().toISOString()),
            history: [],
            current: null
          };
          if (!Array.isArray(task.metrics.history) || !task.metrics.history.length) {
            task.metrics.history = restoredHistory;
            task.metrics.current = restoredHistory.at(-1) || null;
          }
        }
        workflow.copyText ||= String(checkpoint.copyText || "");
        if (workflow.copyText) workflow.textSubmitted = true;
        workflow.batchId ||= String(checkpoint.batchId || "");
        workflow.copyTextPath ||= String(checkpoint.copyTextPath || "");
        workflow.sourceMaterialPath ||= String(checkpoint.sourceMaterialPath || task.entry.materialPath || task.entry.path || "");
        if (!workflow.downloadResult && checkpoint.batchId && checkpoint.downloadedFiles?.length) {
          const checkpointFiles = checkpoint.downloadedFiles.map((file) => String(file || "")).filter(Boolean);
          const checkpointDirectories = [...new Set(checkpointFiles.map((file) => file.replace(/[\\/][^\\/]+$/, "")))];
          workflow.downloadResult = {
            count: checkpointFiles.length,
            batchId: checkpoint.batchId,
            files: checkpointFiles,
            downloadRoot: checkpointDirectories.length === 1
              ? checkpointDirectories[0]
              : (checkpoint.downloadRoot || options.downloadRoot)
          };
        }
        if (checkpoint.packagePath) workflow.packageResult = { ok: true, packagePath: checkpoint.packagePath };
      }
    }
    const latestRecoverablePlanText = () => {
      const latestPlanTurn = [...assistantTurns()].reverse().find((turn) => {
        const text = cleanAssistantText(turn);
        return text.length >= 80
          && /迁移计划|逐页|P\s*1|第\s*1\s*页/i.test(text)
          && /等待.{0,12}(?:回复|输入).{0,6}1|回复\s*1|暂时不出图/i.test(text);
      });
      return cleanAssistantText(latestPlanTurn);
    };
    if (shouldReenterConfirmAtPlanBoundary({
      liveConversationStage: stateSnapshot.stage,
      imageSubmitted: workflow.imageSubmitted === true,
      confirmTurnKey: workflow.confirmTurnKey,
      textSubmitted: workflow.textSubmitted,
      copyText: workflow.copyText,
      copyTextPath: workflow.copyTextPath,
      packagePath: workflow.packageResult?.packagePath,
      downloadedImageCount: workflow.downloadResult?.count,
      beforeImagesCount: workflow.beforeImagesCount,
      beforeImageAssistantKeys: workflow.beforeImageAssistantKeys,
      generatedBaselineUrls: workflow.generatedBaselineUrls,
      generatedImageActualCount: workflow.generatedImageActualCount,
      generatedImageUrls: workflow.generatedImageUrls,
      liveImageEvidenceCount: stateSnapshot.latestImageCount,
      liveImageUrls: stateSnapshot.latestImageUrls,
      generating: generatingNow()
    })) {
      workflow.planDone = true;
      workflow.planText ||= stateSnapshot.latestAssistantText;
      workflow.plannedImageCount = Math.max(
        Number(workflow.plannedImageCount || 0),
        parsePlannedImageCount(stateSnapshot.latestAssistantText)
      );
      workflow.imageSubmitted = false;
      workflow.confirmTurnKey = "";
      workflow.beforeImagesCount = 0;
      workflow.beforeImageAssistantKeys = [];
      workflow.generatedBaselineUrls = [];
      workflow.generatedImageUrls = [];
      workflow.generatedImageActualCount = 0;
      workflow.generatedImageDetection = null;
      workflow.imageRecoveryAttempts = 0;
      workflow.imageRecoveryLastSignature = "";
      workflow.recoveryBoundaryConfirmed = false;
      logTaskConversationEvent("stale-image-submission-reset", {
        step: "recovery",
        meta: { reason: "plan-ready-without-confirm-or-image-evidence" }
      });
      reportWorkbenchProgress(task, "恢复确认边界", 34, "检测到旧检查点曾标记已确认，但当前对话仍停在计划页；已清理旧生图标记，将只发送一次确认 1");
    }
    if (shouldAdoptPlanReadyBoundary({
      workflowPlanSubmitted: workflow.planSubmitted === true,
      workflowPlanDone: workflow.planDone === true,
      liveConversationStage: stateSnapshot.stage,
      generating: generatingNow(),
      responseInFlight: Boolean(stateSnapshot.responseInFlight),
      materialText: stateSnapshot.materialText,
      planText: stateSnapshot.latestAssistantText,
      liveImageEvidenceCount: stateSnapshot.latestImageCount,
      liveImageUrls: stateSnapshot.latestImageUrls,
      generatedImageActualCount: workflow.generatedImageActualCount,
      generatedImageUrls: workflow.generatedImageUrls,
      hasCopy: stateSnapshot.hasCopy || Boolean(workflow.copyText)
    })) {
      workflow.planDone = true;
      workflow.planText = stateSnapshot.latestAssistantText;
      workflow.plannedImageCount = parsePlannedImageCount(stateSnapshot.latestAssistantText);
      workflow.imageSubmitted = false;
      workflow.confirmTurnKey = "";
      workflow.beforeImagesCount = 0;
      workflow.beforeImageAssistantKeys = [];
      workflow.generatedBaselineUrls = [];
      workflow.generatedImageUrls = [];
      workflow.generatedImageActualCount = 0;
      workflow.generatedImageDetection = null;
      workflow.recoveryBoundaryConfirmed = false;
      logTaskConversationEvent("plan-recovered-from-live-boundary", {
        step: "recovery",
        receivedText: stateSnapshot.latestAssistantText,
        meta: { plannedImageCount: workflow.plannedImageCount, reason: "plan-ready-already-present" }
      });
      reportWorkbenchProgress(task, "恢复迁移计划", 32, `已识别当前网页完成的 ${workflow.plannedImageCount} 页计划，不重复上传素材，直接进入确认 1`);
    }
    if (isPostImageRecoveryStage(retryStage)) {
      workflow.plannedImageCount = resolveRecoveredPlannedImageCount({
        planText: latestRecoverablePlanText(),
        checkpointCount: workflow.plannedImageCount,
        taskExpectedCount: task.entry.expectedImages,
        recoveredImageCount: workflow.downloadResult?.count
      });
      if (workflow.downloadResult && Number(workflow.downloadResult.count || 0) < workflow.plannedImageCount) {
        workflow.downloadResult = null;
        workflow.textSubmitted = false;
        workflow.copyText = "";
      }
      workflow.planSubmitted = true;
      workflow.planDone = true;
      workflow.imageSubmitted = true;
      if (!workflow.downloadResult && workflow.plannedImageCount) {
        const recovered = await api("/api/gpt-production/recover-image-batch", {
          method: "POST",
          body: JSON.stringify({
            expectedImageCount: workflow.plannedImageCount,
            downloadRoot: String(options.downloadRoot || "")
          })
        }).catch(() => null);
        if (recovered?.batch?.files?.length === workflow.plannedImageCount) {
          workflow.downloadResult = recovered.batch;
          reportWorkbenchProgress(task, "恢复已下载图片", 82, `已核对本地 ${workflow.plannedImageCount} 张本轮图片，不重复下载或生成`);
        }
      }
    }
    if (!workflow.planDone && /等待迁移计划|提交迁移计划|确认出图/i.test(retryStage)) {
      const latestPlanTurn = [...assistantTurns()].reverse().find((turn) => {
        const text = cleanAssistantText(turn);
        return text.length >= 80
          && /迁移计划|逐页|P\s*1|第\s*1\s*页/i.test(text)
          && /等待.{0,12}(?:回复|输入).{0,6}1|暂时不出图/i.test(text);
      });
      const recoveredPlanText = cleanAssistantText(latestPlanTurn);
      const recoveredCount = parsePlannedImageCount(recoveredPlanText);
      if (latestPlanTurn && recoveredCount) {
        workflow.planSubmitted = true;
        workflow.planDone = true;
        workflow.planText = recoveredPlanText;
        workflow.plannedImageCount = recoveredCount;
        reportWorkbenchProgress(task, "恢复迁移计划", 32, `已识别当前网页完成的 ${recoveredCount} 页计划，不重复上传素材`);
      }
    }
    // If the page is still actively generating, let the normal wait-images
    // handler observe the live response. The old recovery branch waited only
    // 30 seconds for a URL and then failed, which made a restarted task look
    // frozen even though the native response was still running.
    const retryingActiveImageGeneration = /等待图片|生成图片/i.test(String(task.entry.retryFromStage || ""))
      && generatingNow();
    const retryStageHasNoImageBaseline = !workflow.generatedBaselineUrls?.length
      && !workflow.beforeImageAssistantKeys?.length
      && !Number(workflow.beforeImagesCount || 0);
    // A restarted task can retain only the durable "plan confirmed / image
    // turn submitted" boundary. The old 30-second recovery probe required a
    // DOM baseline and then threw IMAGE_RECOVERY_BOUNDARY_MISSING before the
    // normal wait-images handler could send its bounded continuation prompt.
    // Let that handler resume the same image turn; it must not re-upload or
    // send the plan/confirmation again.
    const skipLegacyImageRecovery = workflow.recoveryBoundaryConfirmed === true
      && retryStageHasNoImageBaseline;
    if (/等待图片|生成图片|下载图片|download/i.test(String(task.entry.retryFromStage || ""))
      && !retryingActiveImageGeneration
      && !skipLegacyImageRecovery) {
      const recoveryBaselineUrls = uniqueGeneratedImageUrls(workflow.generatedBaselineUrls || []);
      const recoveryBaselineKeys = Array.isArray(workflow.beforeImageAssistantKeys)
        ? workflow.beforeImageAssistantKeys.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      const recoveryBaselineCount = Math.max(0, Number(workflow.beforeImagesCount || 0));
      if (!recoveryBaselineKeys.length && !recoveryBaselineCount && !recoveryBaselineUrls.length) {
        const error = new Error("当前作品缺少生图回复边界证据；已暂停，未混用历史图片或补发提示");
        error.code = "IMAGE_RECOVERY_BOUNDARY_MISSING";
        throw error;
      }
      const recoveryTurnOptions = {
        baselineAssistantTurnKeys: recoveryBaselineKeys,
        baselineAssistantTurns: recoveryBaselineCount
      };
      const turns = await waitFor(() => {
        const currentTurns = assistantTurns();
        const freshTurns = currentTurns.filter((turn, index) => isFreshImageTurn(
          turn,
          recoveryTurnOptions,
          currentTurns,
          index
        ));
        return freshTurns.some((turn) => newGeneratedImageUrls(
          freshImageUrls([turn].filter(Boolean)),
          recoveryBaselineUrls
        ).length > 0) ? freshTurns : null;
      }, 30_000);
      if (!turns) {
        const error = new Error("恢复下载失败：等待 30 秒后仍没有找到最近一次生成图片");
        // Keep this failure on the image-boundary recovery path. A plain
        // Error used to lose its identity at the bridge boundary, so the
        // desktop worker treated it as a generic page outage and refreshed
        // forever instead of exhausting the bounded image recovery budget.
        error.code = "IMAGE_RECOVERY_BOUNDARY_MISSING";
        error.recoveryReason = "no-fresh-image-turn-within-bounded-recovery";
        throw error;
      }
      const taskExpectedImages = resolveRecoveredPlannedImageCount({
        planText: latestRecoverablePlanText(),
        checkpointCount: workflow.plannedImageCount,
        taskExpectedCount: task.entry.expectedImages
      });
      let generatedTurnIndex = -1;
      if (taskExpectedImages) {
        for (let index = turns.length - 1; index >= 0; index -= 1) {
          const turnUrls = newGeneratedImageUrls(freshImageUrls([turns[index]]), recoveryBaselineUrls);
          if (turnUrls.length === taskExpectedImages) {
            generatedTurnIndex = index;
            break;
          }
        }
      }
      for (let index = turns.length - 1; index >= 0; index -= 1) {
        if (generatedTurnIndex >= 0) break;
        if (newGeneratedImageUrls(freshImageUrls([turns[index]]), recoveryBaselineUrls).length > 0) {
          generatedTurnIndex = index;
          break;
        }
      }
      if (generatedTurnIndex < 0) throw new Error("恢复下载失败：当前会话中没有找到最近一次生成图片");
      const recoveredImageUrls = limitGeneratedImageUrls(
        newGeneratedImageUrls(turns.flatMap((turn) => freshImageUrls([turn])), recoveryBaselineUrls),
        taskExpectedImages
      );
      if (!recoveredImageUrls.length) {
        const error = new Error("恢复下载失败：当前回复没有可确认的新增图片，未使用历史图片补齐");
        error.code = "IMAGE_RECOVERY_NO_FRESH_OUTPUT";
        throw error;
      }
      workflow.planDone = true;
      workflow.imageSubmitted = true;
      workflow.beforeImagesCount = recoveryBaselineCount;
      workflow.beforeImageAssistantKeys = recoveryBaselineKeys;
      // The queue estimate is based on attachment count and may be lower than the
      // plan that GPT actually produced. Re-read the latest current plan after a
      // restart so a 10-page plan can never be downgraded to a 5-image package.
      workflow.plannedImageCount = resolveRecoveredPlannedImageCount({
        planText: latestRecoverablePlanText(),
        checkpointCount: workflow.plannedImageCount,
        taskExpectedCount: taskExpectedImages,
        recoveredImageCount: recoveredImageUrls.length
      });
      if (workflow.downloadResult && Number(workflow.downloadResult.count || 0) < workflow.plannedImageCount) {
        workflow.downloadResult = null;
      }
      workflow.generatedImageUrls = recoveredImageUrls;
      workflow.generatedBaselineUrls = recoveryBaselineUrls;
      reportWorkbenchProgress(task, "恢复下载图片", 64, `已找到当前会话最近一次 ${recoveredImageUrls.length} 张生成结果，不重复提交计划或消耗生图额度`);
    }
    if (/下载图片|生成小红书文案|纠正文案|打包作品|clipboard|剪贴板/i.test(retryStage) && !workflow.copyText) {
      const latestCopyTurn = latestCopyTurnAfterPrompt(options.copyPrompt);
      const recoveredCopy = cleanAssistantText(latestCopyTurn);
      if (isPublishCopyReady(recoveredCopy, 300)) {
        workflow.copyText = recoveredCopy;
        workflow.textSubmitted = true;
        reportWorkbenchProgress(task, "恢复小红书文案", 88, "已识别当前网页完成的文案，不重复发送文案请求");
        await saveCheckpoint("恢复小红书文案", 88);
      }
    }
    const initialAssistantCount = workflow.initialAssistantCount ?? assistantTurns().length;
    workflow.initialAssistantCount = initialAssistantCount;
    const initialAssistantKeys = workflow.initialAssistantKeys ?? assistantTurnKeys();
    workflow.initialAssistantKeys = initialAssistantKeys;
    const templateInitialization = task.entry.taskType === "template-init";
    // Reusing the current conversation means reusing its established master
    // rules, never reusing an old material's migration plan. Every fresh post
    // must submit its own attachments/instruction and receive a new assistant
    // plan before the workflow is allowed to send the confirmation text.

    // ── 按工作流步骤顺序执行（替代原硬编码序列） ──
    // 遍历 wfSteps 数组，按用户拖动的顺序依次执行每个步骤
    // 主流程步骤由对应 handler 处理，工具步骤由 executeUtilityStep 处理
    // 每个 handler 通过 workflow 状态标志去重，支持断点恢复
    let earlyReturn = null;

    // 构建步骤分发表：4 个归档动作统一指向 handleArchive，由 step.action 内部分发
    const mainFlowHandlers = {
      "upload-material": handleUploadMaterial,
      "wait-plan": handleWaitPlan,
      "send-confirm": handleSendConfirm,
      "wait-images": handleWaitImages,
      "request-copy": handleRequestCopy,
      "wait-copy": handleWaitCopy,
      "save-text": handleArchive,
      "download-images": handleArchive,
      "move-archive": handleArchive,
      "package-archive": handleArchive,
    };

    // 每个工作流环节都必须有明确截止时间。到期只中止当前任务并保留
    // 检查点，不抢占其他账号，也不发送下一条提示词；下次恢复会从该
    // 步骤的持久化证据继续判断，避免“等到天荒地老”或重复生成。
    const configuredTaskTimeoutMs = taskAttentionLineMs;
    task.workflowStartedMs = Math.max(
      1,
      Number(task.workflowStartedMs || 0)
        || Date.parse(String(task.workflowStartedAt || ""))
        || Date.now()
    );
    task.workflowStartedAt ||= new Date(task.workflowStartedMs).toISOString();
    // Version 2 removes the conflicting legacy 30-minute whole-task cutoff.
    // Keep the started-at timestamp for metrics, but let each workflow step
    // own its finite timeout. Recovery time is logged separately and never
    // turns into a false WORKFLOW_TASK_TIMEOUT.
    task.workflowBudgetVersion = 2;
    task.workflowTimeoutMs = 0;
    task.workflowDeadlineMs = 0;
    task.workflowDeadlineAt = "";
    task.workflowStepHistory = Array.isArray(task.workflowStepHistory) ? task.workflowStepHistory : [];
    task.workflowStepAttempts = task.workflowStepAttempts && typeof task.workflowStepAttempts === "object"
      ? task.workflowStepAttempts
      : {};
    const runWorkflowStepWithDeadline = async (step, handler) => {
      const action = String(step?.action || "unknown");
      const startedMs = Date.now();
      const attempt = Math.max(1, Number(task.workflowStepAttempts[action] || 0) + 1);
      task.workflowStepAttempts[action] = attempt;
      // Sending the copy request crosses the Electron/page bridge and can
      // legitimately take just over one minute on a long image conversation.
      // Keep it finite, but do not race the successful send at exactly 60s;
      // wait-copy still owns the separate 8-minute reply-generation budget.
      const configuredWaitBudgetMs = action === "request-copy"
        ? Math.max(wfTimeout(action, 120), 120_000)
        : wfTimeout(action, 60);
      const configuredTimeoutMs = workflowStepExecutionTimeoutMs(action, configuredWaitBudgetMs);
      const overallRemainingMs = null;
      const deadlineKind = "step";
      const timeoutMs = configuredTimeoutMs;
      const timing = {
        action,
        status: "running",
        attempt,
        startedMs,
        startedAt: new Date(startedMs).toISOString(),
        timeoutMs,
        deadlineAt: new Date(startedMs + timeoutMs).toISOString(),
        endedAt: "",
        elapsedMs: 0,
        timeoutTriggered: false
      };
      task.stepTiming = timing;
      task.workflowStepHistory.push({ ...timing });
      if (task.workflowStepHistory.length > 64) task.workflowStepHistory = task.workflowStepHistory.slice(-64);
      logTaskConversationEvent("step-started", {
        step: action,
        status: "running",
        startedAt: timing.startedAt,
        deadlineAt: timing.deadlineAt,
        waitLimitMs: timeoutMs,
        attempt,
        meta: {
          configuredTimeoutMs,
          overallRemainingMs,
          workflowDeadlineAt: task.workflowDeadlineAt,
          deadlineKind
        }
      });
      if (timeoutMs <= 0) {
        timing.status = "timeout";
        timing.timeoutTriggered = true;
        timing.endedAt = new Date().toISOString();
        timing.elapsedMs = 0;
        task.workflowStepHistory[task.workflowStepHistory.length - 1] = { ...timing };
        const error = productionBoundaryError(
          "WORKFLOW_TASK_TIMEOUT",
          `整套作品已超过 ${Math.ceil(task.workflowTimeoutMs / 60_000)} 分钟总预算，已停止在当前检查点`
        );
        error.step = action;
        error.waitLimitMs = task.workflowTimeoutMs;
        error.deadlineAt = task.workflowDeadlineAt;
        logTaskConversationEvent("step-timeout", {
          step: action,
          status: "timeout",
          startedAt: timing.startedAt,
          endedAt: timing.endedAt,
          elapsedMs: timing.elapsedMs,
          deadlineAt: task.workflowDeadlineAt,
          waitLimitMs: task.workflowTimeoutMs,
          attempt,
          meta: {
            reason: "workflow-deadline-exceeded",
            workflowStartedAt: task.workflowStartedAt,
            workflowDeadlineAt: task.workflowDeadlineAt,
            workflowElapsedMs: Math.max(0, startedMs - task.workflowStartedMs),
            workflowRemainingMs: 0
          }
        });
        saveCheckpoint(`整套作品超时：${action}`, Number(task.lastPercent || 0)).catch(() => null);
        throw error;
      }
      let timeoutTimer = null;
      let timedOut = false;
      const triggerTimeout = () => {
        if (timedOut) return;
        timedOut = true;
        timing.status = "timeout";
        timing.timeoutTriggered = true;
        timing.endedAt = new Date().toISOString();
        timing.elapsedMs = Math.max(0, Date.now() - startedMs);
        task.workflowStepHistory[task.workflowStepHistory.length - 1] = { ...timing };
        logTaskConversationEvent("step-timeout", {
          step: action,
          status: "timeout",
          startedAt: timing.startedAt,
          endedAt: timing.endedAt,
          elapsedMs: timing.elapsedMs,
          deadlineAt: timing.deadlineAt,
          waitLimitMs: timeoutMs,
          attempt,
          meta: {
            reason: deadlineKind === "workflow" ? "workflow-deadline-exceeded" : "step-deadline-exceeded",
            workflowStartedAt: task.workflowStartedAt,
            workflowDeadlineAt: task.workflowDeadlineAt,
            workflowElapsedMs: Math.max(0, Date.now() - task.workflowStartedMs),
            workflowRemainingMs: Math.max(0, task.workflowDeadlineMs - Date.now())
          }
        });
        // AbortController 已被所有 DOM 等待器监听；它会让当前 handler
        // 尽快退出。即使某个外部调用迟返回，wrapper 也不会进入下一步。
        task.controller?.abort();
        saveCheckpoint(`步骤超时：${action}`, Number(task.lastPercent || 0)).catch(() => null);
      };
      const timeoutError = () => {
        const error = productionBoundaryError(
          deadlineKind === "workflow" ? "WORKFLOW_TASK_TIMEOUT" : "WORKFLOW_STEP_TIMEOUT",
          deadlineKind === "workflow"
            ? `整套作品已到总截止时间 ${task.workflowDeadlineAt}，当前步骤“${action}”已停在检查点`
            : `步骤“${action}”超过 ${Math.ceil(timeoutMs / 1000)} 秒未完成，已停在当前检查点`
        );
        error.step = action;
        error.waitLimitMs = deadlineKind === "workflow" ? task.workflowTimeoutMs : timeoutMs;
        error.deadlineAt = deadlineKind === "workflow" ? task.workflowDeadlineAt : timing.deadlineAt;
        return error;
      };
      const deadlinePromise = new Promise((_, reject) => {
        timeoutTimer = setTimeout(() => {
          triggerTimeout();
          reject(timeoutError());
        }, timeoutMs);
      });
      try {
        // Promise.race is intentional here. AbortController stops cooperative
        // DOM waits, but an external bridge/API promise may never settle after
        // a renderer restart. The step wrapper itself must still return at its
        // deadline so no account worker can remain blocked forever.
        const value = await Promise.race([
          (async () => {
            await saveCheckpoint(`步骤开始：${action}`, Number(task.lastPercent || 0));
            return handler(step);
          })(),
          deadlinePromise
        ]);
        if (timedOut) {
          throw timeoutError();
        }
        // A page reload can abort the old controller after the packager has
        // already returned a verified package. That is no longer a safe
        // reason to cancel the archive step: the images/TXT are complete and
        // source-material lifecycle must still be closed idempotently.
        const postPackageBoundaryComplete = ["move-archive", "package-archive"].includes(action)
          && Boolean(workflow.packageResult?.packagePath || workflow.duplicateSkipped)
          && Number(workflow.downloadResult?.count || 0) > 0
          && String(workflow.copyText || "").trim().length >= 300;
        if (!postPackageBoundaryComplete) throwIfTaskAborted(task);
        timing.status = "completed";
        timing.endedAt = new Date().toISOString();
        timing.elapsedMs = Math.max(0, Date.now() - startedMs);
        task.workflowStepHistory[task.workflowStepHistory.length - 1] = { ...timing };
        logTaskConversationEvent("step-completed", {
          step: action,
          status: "completed",
          startedAt: timing.startedAt,
          endedAt: timing.endedAt,
          elapsedMs: timing.elapsedMs,
          deadlineAt: timing.deadlineAt,
          waitLimitMs: timeoutMs,
          attempt
        });
        await saveCheckpoint(`步骤完成：${action}`, Number(task.lastPercent || 0));
        return value;
      } catch (error) {
        if (timedOut && (!error?.code || !["WORKFLOW_STEP_TIMEOUT", "WORKFLOW_TASK_TIMEOUT"].includes(error.code))) error = timeoutError();
        if (!timedOut) {
          timing.status = error?.name === "AbortError" ? "cancelled" : "failed";
          timing.endedAt = new Date().toISOString();
          timing.elapsedMs = Math.max(0, Date.now() - startedMs);
          task.workflowStepHistory[task.workflowStepHistory.length - 1] = { ...timing };
          logTaskConversationEvent("step-failed", {
            step: action,
            status: timing.status,
            startedAt: timing.startedAt,
            endedAt: timing.endedAt,
            elapsedMs: timing.elapsedMs,
            deadlineAt: timing.deadlineAt,
            waitLimitMs: timeoutMs,
            attempt,
            meta: { errorCode: String(error?.code || ""), error: String(error?.message || error || "") }
          });
        }
        throw error;
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        task.stepTiming = { ...timing };
      }
    };

    for (const step of wfSteps) {
      throwIfTaskAborted(task);
      if (step.enabled === false) continue;
      if (earlyReturn) break;

      // Diagnostic: log each step being executed to verify the complete
      // workflow runs (especially send-confirm and request-copy)
      api("/api/gpt-production/dom-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "wf-step-execute",
          action: step.action,
          enabled: step.enabled,
          hasText: Boolean(step.text),
          wfStepsCount: wfSteps.length,
          wfStepsActions: wfSteps.map((s) => s.action),
          usedFallback: wfSteps === DEFAULT_WF_STEPS
        })
      }).catch(() => {});

      const handler = mainFlowHandlers[step.action];
      if (handler) {
        await runWorkflowStepWithDeadline(step, handler);
      } else {
        // 工具模块（wait-fixed / wait-random / send-text / clipboard-copy / detect-* / time-window / retry）
        const shouldContinue = await runWorkflowStepWithDeadline(step, executeUtilityStep);
        if (!shouldContinue) return { paused: true, reason: "时间窗口外暂停" };
      }
    }

    // 检查是否有提前返回（模板初始化、autoConfirm 关闭、查重跳过、autoPackage 关闭等）
    if (earlyReturn) return earlyReturn;

    // ── 素材归档（分离模式和合并模式统一处理） ──
    // 条件：autoArchive !== false && isMaterialTask && materialPath
    const materialPath = String(task.entry.materialPath || task.entry.path || "").trim();
    const isMaterialTask = task.entry.entryKind === "material" || task.entry.taskType === "material";
    if (options.autoArchive !== false && isMaterialTask && materialPath) {
      // Once the package has been verified, finishing the source-material
      // archive is safe even if the browser task was interrupted immediately
      // afterwards. Without this exception a real package could be left in
      // the library while the lifecycle ledger stayed pending.
      const postPackageBoundaryComplete = Boolean(workflow.packageResult?.packagePath || workflow.duplicateSkipped)
        && Number(workflow.downloadResult?.count || 0) > 0
        && String(workflow.copyText || "").trim().length >= 300;
      if (!postPackageBoundaryComplete) throwIfTaskAborted(task);
      reportWorkbenchProgress(task, "归档素材", 97, "作品已校验，正在登记使用次数并移动原素材");
      const archiveRequest = api("/api/gpt-production/archive-material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryPath: materialPath,
          requestId: task.entry.externalRequestId,
          templateId: task.entry.templateId || "",
          conversationUrl: location.href,
          packagePath: workflow.packageResult?.packagePath || ""
        })
      });
      const archiveTimeout = new Promise((_, reject) => setTimeout(() => {
        reject(productionBoundaryError(
          "ARCHIVE_CONFIRMATION_TIMEOUT",
          "作品文件已经生成，但素材归档在 90 秒内没有返回确认；已停在当前作品边界，重试时不会重新生图"
        ));
      }, 90_000));
      const archiveResult = await Promise.race([archiveRequest, archiveTimeout]);
      if (!archiveResult?.ok) throw new Error(archiveResult?.error || "作品已完成，但素材归档失败");
      workflow.archiveResult = archiveResult?.archive || null;
      if (workflow.duplicateSkipped) {
        reportWorkbenchProgress(task, "作品归档完成", 100, "历史图片组已存在；本轮未重复打包，原素材已完成归档");
      }
    }

    // ── 返回最终结果 ──
    return {
      downloadedImages: workflow.downloadResult?.count || 0,
      copyText: workflow.copyText || "",
      copyTextPath: workflow.copyTextPath || "",
      plannedImageCount: completedPlannedImageCount({
        plannedImageCount: workflow.plannedImageCount,
        downloadedImageCount: workflow.downloadResult?.count
      }),
      batchId: workflow.downloadResult?.batchId || workflow.batchId,
      packageResult: workflow.packageResult || null,
      duplicateSkipped: Boolean(workflow.duplicateSkipped),
      duplicateReason: String(workflow.duplicateReason || ""),
      archiveResult: workflow.archiveResult || null,
      conversationUrl: location.href
    };
  }

  function uploadEntry(entry) {
    if (!entry) return;
    // A direct/manual upload is an explicit user action after cleanup.
    if (!entry.externalRequestId) {
      state.boundaryPaused = false;
      state.boundaryErrorCode = "";
      state.boundaryErrorDetail = "";
    }
    const duplicate = state.uploadTasks.find((task) =>
      task.entry.id === entry.id && ["queued", "reading", "attaching"].includes(task.status)
    );
    if (duplicate) {
      setStatus("这个文件夹已经在上传队列中");
      return;
    }
    state.uploadSequence += 1;
    state.uploadTasks.push({
      id: state.uploadSequence,
      entry,
      workflow: entry.workflow && typeof entry.workflow === "object"
        ? JSON.parse(JSON.stringify(entry.workflow))
        : {},
      status: "queued",
      total: (entry.attachments || []).slice(0, 30).length,
      completed: 0,
      error: "",
      stopRequested: false,
      controller: new AbortController()
    });
    if (state.uploadTasks.length > 12) state.uploadTasks.splice(0, state.uploadTasks.length - 12);
    renderQueue();
    setStatus(`已加入上传队列：${entry.name}`);
    processUploadQueue();
  }

  async function processUploadQueue() {
    if (state.busy) return;
    const task = state.uploadTasks.find((item) => item.status === "queued");
    if (!task) return;
    state.busy = true;
    state.activeTask = task;
    const { entry } = task;
    setBusy(entry, `正在准备“${entry.name}”的文件…`);
    try {
      if (!composer() && !/^\/share\//i.test(location.pathname)) {
        // Normal /c/ conversations are not online templates. GPT can take a
        // moment to mount the composer after a tab switch or wake-up; wait for
        // the real control before entering the share-template branch below.
        reportWorkbenchProgress(task, "Waiting for GPT composer", 3, "GPT is restoring the conversation input");
        const ready = await waitFor(() => Boolean(composer()), 20_000);
        if (!ready) throw new Error("GPT composer is not ready; retry after the conversation wakes up");
      }
      if (!composer()) {
        reportWorkbenchProgress(task, "打开在线模板", 3, "正在把分享模板续接为当前账号可编辑的对话");
        const editable = await ensureEditableConversation();
        if (!editable) throw new Error("在线模板当前不可编辑；请使用 ChatGPT 会话链接，或先在分享页点击“继续此对话”");
      }
      const paths = (entry.attachments || []).slice(0, 30);
      const nativeUpload = entry.nativeUpload === true;
      const expectedFileNames = paths.map((filePath) => fileName(filePath));
      let files = [];
      let input = null;
      let workflowResult = null;
      if (entry.resumePlanSubmitted) {
        task.workflow = task.workflow || {};
        task.workflow.planSubmitted = true;
      }
      const pendingComposerDraft = composerDraftText();
      const pendingDraftBelongsToThisTask = isAutomationDraft(pendingComposerDraft, entry);
      const latestUserTurn = latestUserTurnWrapper();
      const currentPlanTurnAlreadySent = Boolean(latestUserTurn
        && automationPromptMatchesEntry(cleanAssistantText(latestUserTurn), entry));
      // A renderer/app restart can restore the exact workbench prompt while
      // losing only the native attachment previews.  `forceUpload` means the
      // files must be attached again; it does not mean the matching (often
      // very large) ProseMirror draft must be deleted and reinserted.  Keep
      // that verified draft in place and add only the missing files. This
      // avoids a long synchronous editor transaction and cannot resend an old
      // task because isAutomationDraft also verifies this queue entry.
      const preserveMatchingDraftForAttachmentResume = shouldPreserveAutomationDraftForAttachmentResume({
        forceUpload: entry.forceUpload,
        draftBelongsToTask: pendingDraftBelongsToThisTask,
        attachmentCount: attachmentPreviewCount(),
        currentPlanTurnAlreadySent
      });
      // A stale checkpoint can say planSubmitted=true while the exact plan
      // prompt is still unsent in the composer.  Treat the composer as the
      // boundary truth in this case: clear only this task's stale workflow
      // marker and take the normal fresh-upload path.  This prevents text-only
      // sends and prevents the queue from uploading the same task in a loop.
      if (task.workflow?.planSubmitted === true
        && pendingDraftBelongsToThisTask
        && !currentPlanTurnAlreadySent) {
        task.workflow = {};
        entry.resumePlanSubmitted = false;
        const pendingAttachmentCount = attachmentPreviewCount();
        // If this task's prompt and attachments are still present, the send
        // click was interrupted after upload. Preserve and submit that exact
        // composer payload below; clearing it and uploading again wastes the
        // rolling attachment allowance and can duplicate the material.
        entry.forceUpload = pendingAttachmentCount <= 0;
        entry.retryFromStage = "";
        entry.retryFromPercent = 0;
        reportWorkbenchProgress(
          task,
          "修复未发送计划检查点",
          4,
          pendingAttachmentCount > 0
            ? `检测到当前任务 ${pendingAttachmentCount} 个附件和提示词仍在输入框；将直接提交现有内容，不重复上传`
            : "检测到当前任务提示词仍在输入框但附件已经丢失；清理旧检查点后重新上传，不发送空计划、不重复生成"
        );
      }
      // Only skip file upload when the plan was already submitted to GPT.
      // retryFromStage or reconcileAction alone are NOT sufficient — if
      // planSubmitted is false, the task was interrupted before the plan
      // was sent, so files must be re-uploaded from scratch. Otherwise the
      // workflow would send text-only (no attachments) or get stuck waiting
      // for a send button that never appears.
      const resumeExistingWorkflow = !entry.forceUpload
        && Boolean(task.workflow?.planSubmitted);
      if (!resumeExistingWorkflow && !paths.length) throw new Error("这个文件夹里没有可上传的图片或文案");
      if (resumeExistingWorkflow) {
        reportWorkbenchProgress(
          task,
          entry.retryFromStage || task.lastStage || "resume current stage",
          Number(entry.retryFromPercent || task.lastPercent || 18),
          "resume the active web task without uploading attachments again"
        );
        workflowResult = await runAutomaticProduction(task);
      } else {
      // Prove material ownership before reading or attaching local files. One
      // conversation URL can contain many posts, so URL equality alone cannot
      // authorize a fresh upload over an unfinished material boundary.
      const latestLiveMaterialPrompt = latestAutomationMaterialPrompt();
      const liveBoundaryBeforeUpload = conversationStateSnapshot();
      const priorMaterialClosed = Boolean(
        liveBoundaryBeforeUpload?.stage === "archived"
        && liveBoundaryBeforeUpload?.canInjectNext === true
      ) || archivedAutomationBoundaryMatchesLive(readArchivedAutomationBoundary(), latestLiveMaterialPrompt);
      if (entry.externalRequestId
        && latestLiveMaterialPrompt
        && !automationPromptMatchesEntry(latestLiveMaterialPrompt, entry)
        && !priorMaterialClosed) {
        assertLiveAutomationBoundaryMatchesEntry(
          { materialText: latestLiveMaterialPrompt },
          entry,
          "上传附件前",
          { allowDurableLabelDrift: false }
        );
      }
      await waitForPageIdleBeforeFreshUpload(
        task,
        Math.max(5, Number(entry.autoOptions?.workflowAttentionMinutes || entry.autoOptions?.taskTimeoutMinutes || 20)) * 60_000
      );
      const usage = entry.externalRequestId ? null : await checkMaterialUsage(entry, task);
      if (usage?.record) entry.usage = usage.record;
      // A material may intentionally be reused with another template or in a
      // later production round. Text/usage history is therefore informative,
      // not a production blocker. The authoritative duplicate decision is the
      // downloaded output image-set hash inside make_work_package.ps1.
      assertSinglePostAttachmentBoundary(entry, paths);
      if (entry.forceUpload && !preserveMatchingDraftForAttachmentResume) {
        forceClearComposer();
        await waitForTaskDelay(400);
      }
      const existingComposerAttachments = attachmentPreviewCount();
      const existingComposerDraft = composerDraftText();
      const draftBelongsToThisTask = isAutomationDraft(existingComposerDraft, entry);
      const draftIsAutomation = draftBelongsToThisTask || looksLikeAutomationDraft(existingComposerDraft);
      if (existingComposerAttachments > 0 && !nativeUpload) {
        if (entry.forceUpload) {
          forceClearComposer();
          await waitForTaskDelay(400);
        } else if (!draftBelongsToThisTask || !entry.externalRequestId) {
          throw productionBoundaryError("COMPOSER_ATTACHMENTS_PENDING", `当前 GPT 输入框仍有 ${existingComposerAttachments} 个未发送附件；已阻止下一帖继续叠加`);
        } else {
          // The attachments and draft were inserted by this task but the send
          // click was interrupted. Submit them as-is instead of uploading twice.
          await submitComposer();
          if (entry.autoRun && !task.workflow.uploadQuotaRecorded) {
            await recordWorkbenchQuota(entry, "uploaded", existingComposerAttachments);
            task.workflow.uploadQuotaRecorded = true;
          }
          clearComposerDraft();
          if (entry.autoRun) workflowResult = await runAutomaticProduction(task);
        }
      }
      if (existingComposerDraft && !workflowResult) {
        if (entry.forceUpload) {
          if (!preserveMatchingDraftForAttachmentResume || !draftBelongsToThisTask) clearComposerDraft();
        } else if (draftIsAutomation && entry.externalRequestId) {
          // This is our own prompt left behind by a retry/restart. Clear it
          // before attaching the current single post; do not block the queue.
          clearComposerDraft();
        } else {
          throw productionBoundaryError("COMPOSER_DRAFT_PENDING", "当前 GPT 输入框仍有未发送文字；已阻止下一帖重复粘贴提示词");
        }
      }
      if (!workflowResult && entry.externalRequestId) {
        let boundarySnapshot = currentAutomationBoundarySnapshot();
        if (boundarySnapshot && await reconcileArchivedAutomationBoundary(boundarySnapshot)) {
          boundarySnapshot = null;
          reportWorkbenchProgress(task, "恢复归档边界", 3, "已用成品记录核对上一套作品，继续当前素材");
        }
        if (boundarySnapshot) {
          const matchesCurrentTask = automationPromptMatchesEntry(boundarySnapshot.materialText, entry);
          if (!matchesCurrentTask && !entry.forceUpload) {
            throw productionBoundaryError("WINDOW_STAGE_PENDING", "当前 GPT 窗口上一帖尚未完成文案 TXT、图片打包和归档，已阻止下一帖注入");
          }
          if (!matchesCurrentTask && entry.forceUpload) {
            // The operator explicitly retried this selected post after a
            // stopped/failed boundary. The page-idle and empty-composer gates
            // above have already proved that no response is still running, so
            // discard only the stale workflow marker and upload this post.
            task.workflow = {};
            reportWorkbenchProgress(task, "跳过旧失败帖", 4, "上一帖已停止且未完成；按用户重试指令从当前选中素材重新开始");
          }
          if (!entry.forceUpload) {
            task.workflow = task.workflow || {};
            task.workflow.planSubmitted = true;
            task.workflow.planDone = boundarySnapshot.stage !== "waiting-plan";
            task.workflow.planText ||= boundarySnapshot.planText || "";
            task.workflow.plannedImageCount ||= parsePlannedImageCount(boundarySnapshot.planText || "");
            if (["waiting-images", "images-ready", "waiting-copy", "completed-copy-pending-package"].includes(boundarySnapshot.stage)) {
              task.workflow.imageSubmitted = true;
              task.workflow.generatedImageUrls ||= boundarySnapshot.imageUrls || [];
            }
            if (["waiting-copy", "completed-copy-pending-package"].includes(boundarySnapshot.stage)) {
              task.workflow.textSubmitted = true;
            }
            if (boundarySnapshot.stage === "completed-copy-pending-package") {
              task.workflow.copyText ||= boundarySnapshot.copyText || "";
            }
            workflowResult = await runAutomaticProduction(task);
          }
        }
        if (!workflowResult && !entry.forceUpload) {
          const pendingRemote = await findPendingRemoteProduction();
          if (pendingRemote) {
            throw productionBoundaryError("WINDOW_STAGE_PENDING", "当前 GPT 窗口仍有上一帖的图片或文案未完成打包，已阻止下一帖注入");
          }
        }
      }
      if (!workflowResult) {
      if (nativeUpload) {
        // The Electron main process has already set the exact file input with
        // DOM.setFileInputFiles on this WebContents. Never rebuild the list in
        // the renderer: DataTransfer + synthetic change was the proven stall
        // that stopped account-1 after 14/15 files.
        task.status = "attaching";
        task.total = expectedFileNames.length;
        task.completed = expectedFileNames.length;
        renderQueue();
        reportWorkbenchProgress(task, "原生附件注入", 11, `等待 GPT 接收 ${expectedFileNames.length} 个原生附件`);
        const nativeInputFileCount = () => Math.max(0, ...[...document.querySelectorAll('input[type="file"]')]
          .map((candidate) => Number(candidate.files?.length || 0)));
        const nativeUploadSucceeded = () => nativeInputFileCount() >= expectedFileNames.length
          || attachmentPreviewCount() >= expectedFileNames.length;
        const nativeConfirmed = await waitFor(nativeUploadSucceeded, 45_000);
        if (!nativeConfirmed) {
          throw productionBoundaryError(
            "NATIVE_FILE_INPUT_NOT_CONFIRMED",
            `GPT 未确认原生附件：已看到 ${nativeInputFileCount()}/${expectedFileNames.length} 个文件`
          );
        }
        await waitForTaskDelay(400);
        reportWorkbenchProgress(task, "附件上传完成", 12, `${expectedFileNames.length} 个原生附件已进入 GPT`);
      } else {
      const loaded = await Promise.all([loadFiles(paths, task), findFileInput()]);
      files = loaded[0];
      input = loaded[1];
      if (task.controller.signal.aborted) throw new DOMException("上传已取消", "AbortError");
      if (!input) throw new Error("当前 GPT 没有原生附件入口，请先点输入框旁的"+"再重试");
      if (!files.length) throw new Error("文件读取完成但返回 0 个文件，路径: " + JSON.stringify(paths).slice(0, 500));
      task.status = "attaching";
      renderQueue();
      // Clear previous files from the input (leftover files from prior uploads
      // cause inputFilesLength to grow and may confuse ChatGPT's React handler)
      try {
        const emptyTransfer = new DataTransfer();
        input.files = emptyTransfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {}
      // Also dismiss any ChatGPT native modal that might be open (e.g. "添加任意内容"
      // dialog triggered by clicking the + button in a previous failed attempt).
      // An open modal blocks the composer and prevents file upload from working.
      const dismissOpenModals = () => {
        const modals = document.querySelectorAll('[role="dialog"], [data-state="open"][role="dialog"], dialog[open]');
        modals.forEach((modal) => {
          // Don't close our own sidebar modal
          if (modal.closest("#tb-gpt-sidebar") || modal.closest(".tb-sidebar-root")) return;
          // Look for close/escape button inside the modal
          const closeBtn = modal.querySelector('button[aria-label*="Close" i], button[aria-label*="关闭"], button[aria-label*="取消"]');
          if (closeBtn) { try { closeBtn.click(); } catch {} }
          else {
            // Dispatch Escape key to close the modal
            modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
          }
        });
      };
      dismissOpenModals();
      await waitForTaskDelay(500);
      dismissOpenModals(); // Second pass in case first dismissal triggered a transition
      await waitForTaskDelay(300);

      const previewsBefore = attachmentPreviewCount();
      // Diagnostic: log upload start
      api("/api/gpt-production/dom-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "upload-start",
          filesCount: files.length,
          filesNames: files.map(f => f.name),
          previewsBefore,
          inputFound: Boolean(input),
          inputId: input?.id,
          inputFilesLength: input?.files?.length
        })
      }).catch(() => {});

      const composerEl = composer();
      const dropZone = composerEl?.closest('[data-composer-surface]') || composerEl?.closest('form') || composerEl;

      // Success check: use file name visibility as the PRIMARY indicator
      // (attachmentPreviewCount had false positives — 35 for 7 files — because
      // ChatGPT creates intermediate elements during upload that match selectors
      // but aren't real attachment previews).
      const visibleUploadedFileCount = () => {
        const target = composer();
        const scope = target?.closest('[data-composer-surface]') || target?.closest("form") || target?.parentElement;
        if (!scope) return 0;
        const visibleText = scope.innerText || "";
        // Also check aria-label and title attributes of child elements
        const attrText = [...scope.querySelectorAll("[aria-label], [title], [data-testid]")]
          .map(n => `${n.getAttribute("aria-label") || ""} ${n.getAttribute("title") || ""} ${n.textContent || ""}`)
          .join(" ");
        const allText = `${visibleText} ${attrText}`;
        return expectedFileNames.filter((name) => allText.includes(name)).length;
      };
      const checkFilesVisible = () => files.length > 0 && visibleUploadedFileCount() >= files.length;

      const uploadSucceeded = () => {
        // PRIMARY: all file names visible in composer area (most reliable)
        if (checkFilesVisible()) return true;
        // SECONDARY: attachment preview count matches expected count
        // This ensures ALL files were uploaded, not just one.
        const count = attachmentPreviewCount();
        if (count > 0 && count >= files.length) return true;
        // NOTE: Do NOT use sendButton() alone as a success indicator.
        // ChatGPT shows the send button as soon as ANY content is in the composer,
        // even if only 1 of N files was pasted. This caused false "success" when
        // paste only delivered the first file (currentPreviewCount=1, filesCount=8).
        return false;
      };

      // === Sequential upload: try each method one at a time, stop on first success ===
      // Previous code fired all 3 methods simultaneously, causing duplicate uploads
      // ("你已上传过此文件" error) when more than one method succeeded.

      // --- Attempt 1: DataTransfer on the hidden file input (historically reliable) ---
      // Diagnostic data shows this method successfully uploaded all files in prior
      // versions (currentPreviewCount matched filesCount). Paste events only
      // delivered the first file due to ClipboardEvent limitations. Never hand
      // all files to React in one change event: 15 image/TXT files can freeze
      // the ChatGPT renderer before Electron receives another health response.
      let uploadOk = false;
      let dataTransferResult = null;
      try {
        dataTransferResult = await attachFilesInResponsiveBatches(files, task, async (batch) => {
          const currentInput = input.isConnected ? input : await findFileInput();
          if (!currentInput) throw new Error("GPT 附件入口在分批上传时消失，已保留当前检查点");
          const transfer = new DataTransfer();
          batch.forEach((file) => transfer.items.add(file));
          currentInput.files = transfer.files;
          currentInput.dispatchEvent(new Event("input", { bubbles: true }));
          currentInput.dispatchEvent(new Event("change", { bubbles: true }));
        }, { previewBaseline: previewsBefore, batchSize: 2 });
        uploadOk = dataTransferResult.ok && uploadSucceeded();
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        dataTransferResult = {
          ok: false,
          acceptedFiles: Math.max(0, attachmentPreviewCount() - previewsBefore),
          previewCount: attachmentPreviewCount(),
          error: String(error?.message || error || "分批上传失败")
        };
      }
      api("/api/gpt-production/dom-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "upload-datatransfer-attempt", succeeded: uploadOk, filesCount: files.length, acceptedFiles: Number(dataTransferResult?.acceptedFiles || 0), batchSize: 2, allNamesVisibleCheck: checkFilesVisible(), sendButtonFound: Boolean(sendButton()), currentPreviewCount: attachmentPreviewCount() })
      }).catch(() => {});

      if (!uploadOk && Number(dataTransferResult?.acceptedFiles || 0) > 0) {
        throw productionBoundaryError(
          "COMPOSER_PARTIAL_ATTACHMENTS",
          `GPT 已接收 ${Number(dataTransferResult.acceptedFiles)}/${files.length} 个附件，但本批未全部稳定；已停止发送并保留输入框，避免重复叠加`
        );
      }

      // --- Attempt 2: Drag-and-drop on the composer surface (only if DataTransfer failed) ---
      if (!uploadOk && dropZone) {
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropZone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropZone.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt }));
        uploadOk = await waitFor(() => uploadSucceeded(), 12_000);
        api("/api/gpt-production/dom-snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "upload-dnd-attempt", succeeded: uploadOk, filesCount: files.length, allNamesVisibleCheck: checkFilesVisible(), sendButtonFound: Boolean(sendButton()), currentPreviewCount: attachmentPreviewCount() })
        }).catch(() => {});
      }

      // --- Attempt 3: Paste event (last resort — may only deliver first file) ---
      if (!uploadOk && composerEl) {
        composerEl.focus();
        await waitForTaskDelay(200);
        const pasteTransfer = new DataTransfer();
        files.forEach((file) => pasteTransfer.items.add(file));
        composerEl.dispatchEvent(new ClipboardEvent("paste", {
          bubbles: true, cancelable: true, clipboardData: pasteTransfer
        }));
        uploadOk = await waitFor(() => uploadSucceeded(), 10_000);
        api("/api/gpt-production/dom-snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "upload-paste-attempt", succeeded: uploadOk, filesCount: files.length, allNamesVisibleCheck: checkFilesVisible(), sendButtonFound: Boolean(sendButton()), currentPreviewCount: attachmentPreviewCount() })
        }).catch(() => {});
      }

      // Diagnostic: log final appeared result
      api("/api/gpt-production/dom-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "upload-appeared-check",
          appeared: uploadOk,
          filesCount: files.length,
          previewsBefore,
          currentPreviewCount: attachmentPreviewCount(),
          allNamesVisibleCheck: checkFilesVisible(),
          sendButtonFound: Boolean(sendButton()),
          inputFilesLength: input?.files?.length
        })
      }).catch(() => {});

      if (!uploadOk) {
        const uploadResult = classifyAttachmentUploadResult({
          expected: files.length,
          observed: Math.max(visibleUploadedFileCount(), attachmentPreviewCount())
        });
        if (uploadResult.status === "partial") {
          throw productionBoundaryError(
            uploadResult.code,
            `GPT 上传未完整：${uploadResult.observed}/${uploadResult.expected} 个附件已进入输入框；` +
            "可能触达上传图片/文件上限，当前账号窗口已停住，等待下一次探测"
          );
        }
        throw productionBoundaryError(
          uploadResult.code,
          "ChatGPT 没有显示原生附件预览，文件上传未成功（paste、DataTransfer 和拖拽方式均无效，可能是 ChatGPT DOM 结构变更）"
        );
      }
      }
      task.entry.uploadedAttachments = nativeUpload ? expectedFileNames.length : files.length;
      if (entry.autoRun) {
        // 自动模式需要一条最小控制提示来启动当前会话的计划；流程控制
        // （发送、等待、扣 1、下载、打包）由扩展状态机负责，不写进素材提示词。
        // 如果工作流配置了"插入提示词"环节且有文字，将其拼接到指令后面
        const wfStepsForInstruction = Array.isArray(entry.autoOptions?.workflowSteps) ? entry.autoOptions.workflowSteps : [];
        const insertPromptStep = wfStepsForInstruction.find((s) => s.action === "insert-prompt" && s.enabled !== false);
        const baseInstruction = instruction(entry);
        const finalInstruction = insertPromptStep?.text
          ? `${baseInstruction}\n${String(insertPromptStep.text).trim()}`
          : baseInstruction;
        if (!preserveMatchingDraftForAttachmentResume || !isAutomationDraft(composerDraftText(), entry)) {
          await replaceComposerText(finalInstruction, entry);
        } else {
          rememberAutomationDraft(composerDraftText(), entry);
        }
        reportWorkbenchProgress(task, "附件上传完成", 12, `${files.length} 个文件已进入 GPT`);
        workflowResult = await runAutomaticProduction(task);
      } else {
        // 手动模式只把真实附件放进 GPT。不要改写输入框，避免把内部网页脚本、
        // 下载器或工作流控制语句暴露给用户，也避免覆盖用户正在编辑的文字。
        reportWorkbenchProgress(task, "素材上传完成", 100, "手动模式：附件已进入 GPT，未注入额外提示词");
      }
      }
      }
      task.status = workflowResult?.duplicateSkipped ? "duplicate" : "success";
      task.completed = task.total;
      const workflowDetail = workflowResult?.templateInitialized
        ? "当前会话的模板环境已初始化"
        : workflowResult?.plannedOnly
        ? "迁移计划已生成，等待人工确认"
        : workflowResult?.packageSkipped
          ? `已下载 ${workflowResult.downloadedImages || 0} 张图并复制文案`
          : workflowResult?.textSkipped
            ? `已下载 ${workflowResult.downloadedImages || 0} 张图`
            : workflowResult?.packageResult?.packagePath
              ? `作品已核对并保存到 ${workflowResult.packageResult.packagePath}`
              : `${files.length} 个文件已上传`;
      reportWorkbenchTask(task, workflowResult?.duplicateSkipped ? "duplicate" : "success", workflowResult?.duplicateSkipped
        ? `图片与历史作品完全重复，已清理本轮暂存文件并跳过：${entry.name}`
        : workflowDetail, {
        taskType: entry.taskType || "material",
        downloadedImages: Number(workflowResult?.downloadedImages || 0),
        plannedImageCount: Number(workflowResult?.plannedImageCount || 0),
        batchId: workflowResult?.batchId || "",
        packagePath: workflowResult?.packageResult?.packagePath || "",
        downloadRoot: workflowResult?.downloadResult?.downloadRoot || entry.autoOptions?.downloadRoot || "",
        copyTextLength: String(workflowResult?.copyText || "").trim().length,
        archivePath: workflowResult?.archiveResult?.to || "",
        conversationUrl: workflowResult?.conversationUrl || location.href
      });
      if (entry.entryKind === "material" && !workflowResult?.duplicateSkipped) {
        state.pendingUsage = entry;
        await recordMaterialUsage(entry, "prepared").catch(() => null);
      }
      renderQueue();
      setStatus(
        workflowResult?.duplicateSkipped
          ? `历史图片组已存在，已清理本轮下载并跳过：${entry.name}`
          : `已上传 ${files.length} 个文件，并保留原文案后追加生产指令`,
        workflowResult?.duplicateSkipped ? "danger" : "success"
      );
    } catch (error) {
      const workflowStepTimedOut = Boolean(task.stepTiming?.timeoutTriggered || ["WORKFLOW_STEP_TIMEOUT", "WORKFLOW_TASK_TIMEOUT"].includes(error?.code));
      if ((error?.name === "AbortError" && !workflowStepTimedOut) || task.stopRequested === true) {
        forceClearComposer();
        await new Promise((resolve) => setTimeout(resolve, 250));
        forceClearComposer();
        task.status = "cancelled";
        task.error = "";
        const stoppedByUser = task.stopRequested === true;
        const userClearedComposer = task.userClearedComposer === true;
        const automaticRecoveryAbort = task.automaticRecoveryAbort === true;
        const cancelCode = userClearedComposer
          ? "USER_CLEARED_UNSENT_COMPOSER"
          : stoppedByUser
            ? "USER_STOPPED_BY_USER"
            : automaticRecoveryAbort
              ? "GPT_AUTOMATIC_RECOVERY_ABORTED"
              : "USER_PAUSED_BEFORE_SUBMIT";
        const cancelDetail = userClearedComposer
          ? "检测到用户手动清空了未发送的素材和提示词；已暂停当前窗口，不自动回填"
          : automaticRecoveryAbort
            ? "自动恢复正在释放旧桥接；已取消本次请求，保留检查点"
            : `${stoppedByUser ? "已停止当前窗口" : "已在发送前安全暂停"}；输入框和附件已清理`;
        reportWorkbenchProgress(task, stoppedByUser ? "已停止" : "已取消", 100, `${stoppedByUser ? "已停止" : "已取消"}：${entry.name}`, "cancelled");
        reportWorkbenchTask(task, "cancelled", cancelDetail, {
          errorCode: cancelCode,
          userHold: userClearedComposer,
          automaticRecoveryAbort,
          pendingComposerAttachments: attachmentPreviewCount(),
          stage: task.lastStage || "",
          percent: Number(task.lastPercent || 0)
        });
        setStatus(`${stoppedByUser ? "已停止" : "已取消"}：${entry.name}`);
      } else {
        task.status = "failed";
        const pendingComposerAttachments = attachmentPreviewCount();
        const errorCode = String(error?.code
          || (/Failed to fetch|本地工作台连接失败/i.test(String(error?.message || "")) ? "LOCAL_BRIDGE_FETCH_FAILED" : "")
          || (pendingComposerAttachments > 0 ? "COMPOSER_ATTACHMENTS_PENDING" : ""));
        const failureDetail = error.message || "upload failed";
        reportWorkbenchProgress(task, "失败", 100, failureDetail, "failed");
        reportWorkbenchTask(task, "failed", failureDetail, {
          errorCode,
          recoveryReason: String(error?.recoveryReason || ""),
          detectedImages: Number(error?.detectedImages || 0),
          pendingComposerAttachments,
          stage: task.lastStage || "",
          percent: Number(task.lastPercent || 0),
          downloadRoot: String(task.entry.autoOptions?.downloadRoot || ""),
          copyTextLength: Number(String(task.workflow?.copyText || "").trim().length || 0),
          conversationUrl: String(location.href || "")
        });
        task.error = error.message || "未知错误";
        setStatus(task.error, "danger");
        if ([
          "COMPOSER_ATTACHMENTS_PENDING",
          "COMPOSER_DRAFT_PENDING",
          "MIXED_POST_ATTACHMENTS",
          "COMPOSER_ATTACHMENT_CONFLICT",
          "COMPOSER_DRAFT_NOT_SET",
          "ATTACHMENT_UPLOAD_NOT_READY",
          "UPLOAD_LIMIT_SIGNAL",
          "WINDOW_STAGE_PENDING",
          "WEB_RESPONSE_IN_FLIGHT",
          "IMAGE_COUNT_UNCERTAIN",
          "IMAGE_RECOVERY_BOUNDARY_MISSING",
          "COPY_IMAGE_HYDRATION_WAIT",
          "IMAGE_DRAFT_REJECTED",
          "PLAN_PARSE_FAILED",
          "PLAN_NOT_READY",
          "PLAN_NOT_COMPLETE",
          "GENERATION_LIMIT_SIGNAL",
          "SCRIPT_GENERATED_OUTPUT",
          "COPY_REQUIRED",
          "WORKFLOW_STEP_TIMEOUT",
          "WORKFLOW_TASK_TIMEOUT"
        ].includes(errorCode)
          || /未发送附件|未发送文字|重复粘贴提示词|混合上传|输入框仍有|仍在生成|图片数量检测不确定|生成结果不足|代码解释器|额度|文案 TXT/.test(failureDetail)) {
          state.boundaryPaused = true;
          state.boundaryErrorCode = errorCode;
          state.boundaryErrorDetail = failureDetail;
        }
      }
      renderQueue();
    } finally {
      state.busy = false;
      if (state.activeTask === task) state.activeTask = null;
      setBusy(null);
      if (!state.boundaryPaused) processUploadQueue();
    }
  }

  function findEntry(kind, id) {
    if (kind === "product") {
      const groups = [
        state.productTree?.entries || [],
        ...Object.values(state.productChildren).map((tree) => tree.entries || [])
      ];
      for (const entries of groups) {
        const item = entries.find((entry) => entry.id === id);
        if (item) return item;
      }
      return null;
    }
    for (const category of state.materials?.categories || []) {
      const item = (category.items || []).find((entry) => entry.id === id);
      if (item) return item;
    }
    return (state.materialIndex?.items || []).find((entry) => entry.id === id) || null;
  }

  async function loadCategory(categoryId) {
    const category = (state.materials?.categories || []).find((item) => item.id === categoryId);
    if (!category || category.loaded || category.loading) return;
    category.loading = true;
    try {
      const payload = await api(`/api/materials?category=${encodeURIComponent(categoryId)}`);
      const loaded = (payload.materials?.categories || []).find((item) => item.id === categoryId);
      if (loaded) Object.assign(category, loaded, { loaded: true, loading: false });
      renderBody();
    } catch (error) {
      category.loading = false;
      setStatus(error.message, "danger");
    }
  }

  function recalculateLocalIndexStats() {
    const items = state.materialIndex?.items || [];
    const byMainTag = { 团建游戏: 0, 团建转化: 0, 合集攻略: 0 };
    const byUsage = { unused: 0, once: 0, twice: 0, threePlus: 0, used: 0 };
    items.forEach((item) => {
      if (Object.prototype.hasOwnProperty.call(byMainTag, item.mainTag)) byMainTag[item.mainTag] += 1;
      const count = Number(item.usageCount || 0);
      if (count === 0) byUsage.unused += 1;
      if (count === 1) byUsage.once += 1;
      if (count === 2) byUsage.twice += 1;
      if (count >= 3) byUsage.threePlus += 1;
      if (count > 0) byUsage.used += 1;
    });
    if (state.materialIndex) {
      state.materialIndex.stats = {
        ...(state.materialIndex.stats || {}),
        total: items.length,
        byMainTag,
        byUsage
      };
    }
  }

  function scheduleMaterialIndexPoll(delay = 3_000) {
    clearTimeout(materialIndexTimer);
    materialIndexTimer = setTimeout(() => {
      loadMaterialIndex().catch(() => null);
    }, delay);
  }

  async function loadMaterialIndex(refreshIndex = false) {
    const payload = await api(`/api/extension/material-index${refreshIndex ? "?refresh=true" : ""}`);
    state.materialIndex = payload.index || null;
    renderBody();
    if (state.materialIndex?.status === "running") {
      setStatus(`正在建立全库素材索引：${Number(state.materialIndex.processedCategories || 0)}/${Number(state.materialIndex.totalCategories || 0)}`);
      scheduleMaterialIndexPoll();
    } else if (state.materialIndex?.status === "failed") {
      setStatus(`素材索引失败：${state.materialIndex.error || "未知错误"}`, "danger");
    } else if (state.materialIndex?.status === "complete") {
      setStatus(`全库索引完成：${Number(state.materialIndex.stats?.total || 0)} 条素材，${Number(state.materialIndex.stats?.review || 0)} 条待核对`, "success");
    }
    return state.materialIndex;
  }

  async function materialEntryForUpload(id, categoryId) {
    let entry = findEntry("material", id);
    if (entry?.attachments?.length) return entry;
    if (categoryId) await loadCategory(categoryId);
    entry = findEntry("material", id);
    return entry;
  }

  function categoryForEntry(entryId) {
    return (state.materials?.categories || []).find((category) =>
      (category.items || []).some((item) => item.id === entryId)
    );
  }

  async function updateMaterialEntry(entry, changes) {
    if (!entry?.path) return;
    setStatus(`正在更新“${entry.name}”…`);
    const payload = await api("/api/extension/material-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryPath: entry.path, folderHash: entry.folderHash, ...changes })
    });
    const record = payload.record || {};
    if (record.mainTag) {
      entry.mainTag = record.mainTag;
      entry.mainTagSource = record.mainTagSource || "manual";
    }
    if (Number.isFinite(Number(record.usageCount))) entry.usageCount = Number(record.usageCount);
    if (Array.isArray(record.tags)) entry.tags = record.tags;
    const indexed = (state.materialIndex?.items || []).find((item) => item.id === entry.id);
    if (indexed && indexed !== entry) Object.assign(indexed, {
      mainTag: entry.mainTag,
      mainTagSource: entry.mainTagSource,
      usageCount: entry.usageCount,
      tags: entry.tags
    });
    for (const category of state.materials?.categories || []) {
      const loaded = (category.items || []).find((item) => item.id === entry.id);
      if (loaded && loaded !== entry) Object.assign(loaded, {
        mainTag: entry.mainTag,
        mainTagSource: entry.mainTagSource,
        usageCount: entry.usageCount,
        tags: entry.tags
      });
    }
    recalculateLocalIndexStats();
    renderBody();
    setStatus(`已更新“${entry.name}”`, "success");
  }

  function saveMaterialActionSettings(form) {
    const next = JSON.parse(JSON.stringify(DEFAULT_ACTION_SETTINGS));
    for (const key of Object.keys(next)) {
      next[key].enabled = Boolean(form.querySelector(`[data-action-enabled="${key}"]`)?.checked);
      next[key].label = form.querySelector(`[data-action-label="${key}"]`)?.value || next[key].label;
    }
    next.move.targetPath = form.querySelector("[data-action-move-target]")?.value || "";
    storeActionSettings(next);
    state.settingsOpen = false;
    renderBody();
    setStatus("素材按钮设置已保存", "success");
  }

  async function loadProductFolder(folderPath) {
    setStatus(`正在读取 ${fileName(folderPath)}…`);
    const payload = await api(`/api/extension/product-tree?path=${encodeURIComponent(folderPath)}`);
    state.productChildren[folderPath] = payload.tree;
    renderBody();
    setStatus(`已读取 ${payload.tree?.entries?.length || 0} 项`, "success");
  }

  async function savePaths(kind, value) {
    const body = kind === "product"
      ? { workPackage: { libraryPath: value } }
      : { materialRoot: value };
    const payload = await api("/api/extension/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    state.workspace = { ...state.workspace, ...payload };
    storePaths({
      productRoot: kind === "product" ? value : state.paths.productRoot,
      materialRoot: kind === "material" ? value : state.paths.materialRoot
    });
    await refresh();
  }

  async function refresh() {
    try {
      const previousProductRoot = state.workspace?.settings?.workPackage?.libraryPath || state.paths.productRoot;
      const previousMaterialRoot = state.materials?.root || state.paths.materialRoot;
      const previousCategories = new Map(
        (state.materials?.categories || []).map((category) => [category.id, category])
      );
      const [workspace, materials, productTree, materialIndex] = await Promise.all([
        api("/api/extension/workspace"),
        api("/api/materials"),
        api("/api/extension/product-tree"),
        api("/api/extension/material-index")
      ]);
      state.workspace = workspace;
      state.productTree = productTree.tree;
      state.materialIndex = materialIndex.index || null;
      const nextProductRoot = workspace?.settings?.workPackage?.libraryPath || state.paths.productRoot;
      const nextMaterialRoot = materials.materials?.root || state.paths.materialRoot;
      const productRootChanged = previousProductRoot !== nextProductRoot;
      const materialRootChanged = previousMaterialRoot !== nextMaterialRoot;
      state.materials = {
        ...materials.materials,
        categories: (materials.materials?.categories || []).map((category) => {
          const previous = previousCategories.get(category.id);
          if (materialRootChanged || !previous?.loaded) return category;
          return { ...category, loaded: true, items: previous.items || [] };
        })
      };
      state.connected = true;
      state.health = {
        local: Boolean(nextProductRoot && nextMaterialRoot),
        gptUpload: Boolean(document.querySelector('#upload-files:not(:disabled)')),
        dedup: Boolean(workspace?.dedup?.production?.available)
      };
      storePaths({
        productRoot: nextProductRoot,
        materialRoot: nextMaterialRoot
      });
      if (productRootChanged) {
        state.productChildren = {};
        state.openProducts.clear();
      }
      if (materialRootChanged) state.openMaterials.clear();
      renderBody();
      renderHealth();
      setStatus("本地工作台已连接", "success");
      if (state.materialIndex?.status === "running") scheduleMaterialIndexPoll();
      scheduleRefresh(60_000);
    } catch {
      state.connected = false;
      state.health.local = false;
      state.health.dedup = false;
      state.health.gptUpload = Boolean(document.querySelector('#upload-files:not(:disabled)'));
      renderHealth();
      setStatus("正在自动连接本地工作台…", "danger");
      scheduleRefresh(5_000);
    }
  }

  function autoApplyPastedPath(input) {
    const productInput = input.matches(`#${ROOT_ID} [data-product-path]`);
    const materialInput = input.matches(`#${ROOT_ID} [data-material-path]`);
    if (!productInput && !materialInput) return;
    setTimeout(() => {
      const value = input.value.trim();
      if (!value) return;
      const kind = productInput ? "product" : "material";
      setStatus(`正在读取${kind === "product" ? "成品" : "素材"}目录…`);
      savePaths(kind, value).catch((error) => setStatus(error.message, "danger"));
    }, 80);
  }

  document.addEventListener("submit", (event) => {
    if (event.target.matches(`#${ROOT_ID} [data-product-form]`)) {
      event.preventDefault();
      savePaths("product", event.target.querySelector("[data-product-path]").value.trim()).catch((error) => setStatus(error.message, "danger"));
    }
    if (event.target.matches(`#${ROOT_ID} [data-material-form]`)) {
      event.preventDefault();
      savePaths("material", event.target.querySelector("[data-material-path]").value.trim()).catch((error) => setStatus(error.message, "danger"));
    }
    if (event.target.matches(`#${ROOT_ID} [data-material-settings-form]`)) {
      event.preventDefault();
      saveMaterialActionSettings(event.target);
    }
  });

  document.addEventListener("paste", (event) => {
    const input = event.target.closest?.(`#${ROOT_ID} input`);
    if (input) autoApplyPastedPath(input);
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(`#${ROOT_ID} [data-collapse], #${LAUNCHER_ID}`)) {
      state.collapsed = !state.collapsed;
      applyLayout();
      return;
    }
    const filterTag = event.target.closest(`#${ROOT_ID} [data-filter-main-tag]`);
    if (filterTag) {
      state.materialFilter.mainTag = filterTag.dataset.filterMainTag;
      renderBody();
      return;
    }
    const groupedFilter = event.target.closest(`#${ROOT_ID} [data-filter-dimension]`);
    if (groupedFilter) {
      const dimension = groupedFilter.dataset.filterDimension;
      if (dimension === "season" || dimension === "holiday") {
        state.materialFilter[dimension] = groupedFilter.dataset.filterValue;
        renderBody();
      }
      return;
    }
    if (event.target.closest(`#${ROOT_ID} [data-open-material-settings]`)) {
      state.settingsOpen = true;
      renderMaterialSettings();
      return;
    }
    if (event.target.closest(`#${ROOT_ID} [data-close-material-settings]`)) {
      state.settingsOpen = false;
      renderMaterialSettings();
      return;
    }
    if (event.target.closest(`#${ROOT_ID} [data-reset-material-settings]`)) {
      storeActionSettings(DEFAULT_ACTION_SETTINGS);
      renderMaterialSettings();
      return;
    }
    const tagAction = event.target.closest(`#${ROOT_ID} [data-material-main-tag]`);
    if (tagAction) {
      const entry = findEntry("material", tagAction.dataset.materialId);
      updateMaterialEntry(entry, { mainTag: tagAction.dataset.materialMainTag }).catch((error) => setStatus(error.message, "danger"));
      return;
    }
    const incrementAction = event.target.closest(`#${ROOT_ID} [data-material-increment]`);
    if (incrementAction) {
      const entry = findEntry("material", incrementAction.dataset.materialIncrement);
      updateMaterialEntry(entry, { incrementUsage: true }).catch((error) => setStatus(error.message, "danger"));
      return;
    }
    const moveAction = event.target.closest(`#${ROOT_ID} [data-material-move]`);
    if (moveAction) {
      const entry = findEntry("material", moveAction.dataset.materialMove);
      if (entry?.path && state.actionSettings.move.targetPath) {
        state.pendingMove = { entry: { ...entry, entryKind: "material" }, targetPath: state.actionSettings.move.targetPath };
        renderMoveDialog();
      }
      return;
    }
    const cancel = event.target.closest(`#${ROOT_ID} [data-cancel-upload]`);
    if (cancel) {
      const task = state.uploadTasks.find((item) => item.id === Number(cancel.dataset.cancelUpload));
      if (task) {
        if (task.status === "queued") {
          task.status = "cancelled";
          renderQueue();
        } else {
          task.controller.abort();
        }
      }
      return;
    }
    const retry = event.target.closest(`#${ROOT_ID} [data-retry-upload]`);
    if (retry) {
      const task = state.uploadTasks.find((item) => item.id === Number(retry.dataset.retryUpload));
      if (task) {
        task.status = "queued";
        task.completed = 0;
        task.error = "";
        task.controller = new AbortController();
        renderQueue();
        processUploadQueue();
      }
      return;
    }
    if (event.target.closest(`#${ROOT_ID} [data-cancel-move]`)) {
      state.pendingMove = null;
      renderMoveDialog();
      setStatus("已取消移动");
      return;
    }
    if (event.target.closest(`#${ROOT_ID} [data-confirm-move]`)) {
      confirmMove();
      return;
    }
    const productUpload = event.target.closest(`#${ROOT_ID} [data-upload-product]`);
    if (productUpload) uploadEntry({ ...findEntry("product", productUpload.dataset.uploadProduct), entryKind: "product" });
    const materialUpload = event.target.closest(`#${ROOT_ID} [data-upload-material]`);
    if (materialUpload) {
      materialEntryForUpload(
        materialUpload.dataset.uploadMaterial,
        materialUpload.dataset.indexCategory
      ).then((entry) => {
        if (!entry?.attachments?.length) throw new Error("素材详情尚未读取完成，请稍后再试");
        uploadEntry({ ...entry, entryKind: "material" });
      }).catch((error) => setStatus(error.message, "danger"));
    }
  });

  document.addEventListener("change", (event) => {
    const usage = event.target.closest?.(`#${ROOT_ID} [data-filter-usage]`);
    if (!usage) return;
    state.materialFilter.usage = usage.value;
    renderBody();
  });

  document.addEventListener("input", (event) => {
    const query = event.target.closest?.(`#${ROOT_ID} [data-filter-query]`);
    if (!query) return;
    state.materialFilter.query = query.value;
    const materials = document.querySelector(`#${ROOT_ID} [data-materials]`);
    if (materials) materials.innerHTML = materialRows();
  });

  document.addEventListener("toggle", (event) => {
    const product = event.target.closest?.(`#${ROOT_ID} details[data-product-path]`);
    if (product) {
      if (product.open) {
        const folderPath = product.dataset.productPath;
        state.openProducts.add(folderPath);
        if (!Object.prototype.hasOwnProperty.call(state.productChildren, folderPath)) {
          loadProductFolder(folderPath).catch((error) => setStatus(error.message, "danger"));
        }
      } else {
        state.openProducts.delete(product.dataset.productPath);
      }
      return;
    }
    const details = event.target.closest?.(`#${ROOT_ID} details[data-category]`);
    if (details) {
      if (details.open) {
        state.openMaterials.add(details.dataset.category);
        loadCategory(details.dataset.category);
      } else {
        state.openMaterials.delete(details.dataset.category);
      }
    }
  }, true);

  document.addEventListener("dragstart", (event) => {
    const row = event.target.closest?.(`#${ROOT_ID} [data-move-source-kind], #${ROOT_ID} [data-entry-kind]`);
    if (!row) return;
    const kind = row.dataset.moveSourceKind || row.dataset.entryKind;
    const id = row.dataset.moveSourceId || row.dataset.entryId;
    state.dragging = { ...findEntry(kind, id), entryKind: kind };
    if (!state.dragging?.path) {
      state.dragging = null;
      return;
    }
    showDropOverlay(false);
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/plain", state.dragging?.name || "团建内容");
  });
  document.addEventListener("dragover", (event) => {
    if (!state.dragging) return;
    const moveTarget = event.target.closest?.(`#${ROOT_ID} [data-move-target-path]`);
    if (moveTarget && moveTarget.dataset.moveTargetPath !== state.dragging.path) {
      event.preventDefault();
      event.stopPropagation();
      clearMoveTarget();
      moveTarget.classList.add("is-move-target");
      state.moveTarget = moveTarget.dataset.moveTargetPath;
      event.dataTransfer.dropEffect = "move";
      showDropOverlay(false);
      return;
    }
    clearMoveTarget();
    if (isChatDropTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      showDropOverlay(true);
    } else {
      showDropOverlay(false);
    }
  }, true);
  document.addEventListener("drop", (event) => {
    if (!state.dragging) return;
    const moveTarget = event.target.closest?.(`#${ROOT_ID} [data-move-target-path]`);
    if (moveTarget && moveTarget.dataset.moveTargetPath !== state.dragging.path) {
      event.preventDefault();
      event.stopPropagation();
      state.pendingMove = {
        entry: state.dragging,
        targetPath: moveTarget.dataset.moveTargetPath
      };
      state.dragging = null;
      clearMoveTarget();
      showDropOverlay(false);
      renderMoveDialog();
      return;
    }
    if (!isChatDropTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const entry = state.dragging;
    state.dragging = null;
    clearMoveTarget();
    showDropOverlay(false);
    uploadEntry(entry);
  }, true);
  document.addEventListener("dragend", () => {
    state.dragging = null;
    clearMoveTarget();
    showDropOverlay(false);
  });

  document.addEventListener("click", (event) => {
    if (!state.pendingUsage || event.target.closest?.(`#${ROOT_ID}`)) return;
    const button = event.target.closest?.("button");
    if (!button) return;
    const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`;
    if (/发送|send/i.test(label)) commitPendingMaterialUsage();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (!state.pendingUsage || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    if (event.target.closest?.(`#${ROOT_ID}`)) return;
    if (event.target.matches?.("textarea, [contenteditable='true']")) commitPendingMaterialUsage();
  }, true);

  async function acceptWorkbenchTask(message) {
    if (message?.source !== "teambuilding-workbench"
      || message?.type !== "tb-workbench-upload") return;
    const requestId = String(message.requestId || "").trim();
    if (requestId && state.acceptedWorkbenchRequestIds.has(requestId)) return;
    if (requestId) {
      state.acceptedWorkbenchRequestIds.add(requestId);
      if (state.acceptedWorkbenchRequestIds.size > 64) {
        state.acceptedWorkbenchRequestIds.delete(state.acceptedWorkbenchRequestIds.values().next().value);
      }
    }
    document.documentElement.dataset.tbGptLastTask = `${requestId || "missing"}:received`;
    const attachments = Array.isArray(message.attachments)
      ? [...new Set(message.attachments.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 30)
      : [];
    // Keep the template files separate from the current post files. The
    // single-post boundary allows only this explicit template whitelist;
    // dropping it here makes every local template look like mixed material.
    const templateAttachments = Array.isArray(message.templateAttachments)
      ? [...new Set(message.templateAttachments.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 20)
      : [];
    const prompt = String(message.prompt || "").trim().slice(0, 30000);
    if (String(message.taskType || "") === "template-link") {
      if (!requestId || !prompt) {
        window.postMessage({
          source: "tb-gpt-production-extension",
          type: "tb-workbench-task-result",
          requestId,
          status: "failed",
          detail: "模板链接为空，无法发送到当前 GPT"
        }, "*");
        return;
      }
      try {
        await replaceComposerText(prompt);
        await submitComposer();
        clearComposerDraft();
        window.postMessage({
          source: "tb-gpt-production-extension",
          type: "tb-workbench-task-result",
          requestId,
          status: "success",
          detail: "模板链接已发送到当前 GPT"
        }, "*");
      } catch (error) {
        window.postMessage({
          source: "tb-gpt-production-extension",
          type: "tb-workbench-task-result",
          requestId,
          status: "failed",
          detail: error?.message || "模板链接发送失败"
        }, "*");
      }
      return;
    }
    const retryFromStage = String(message.retryFromStage || "").trim();
    const reconcileAction = String(message.reconcileAction || "").trim();
    const forceUpload = Boolean(message.forceUpload);
    const nativeUpload = Boolean(message.nativeUpload);
    const resumePlanSubmitted = Boolean(message.resumePlanSubmitted);
    const taskOptions = message.autoOptions && typeof message.autoOptions === "object" ? message.autoOptions : {};
    const noPromptMode = taskOptions.useCurrentSession !== false || taskOptions.mode === "random";
    localStorage.setItem("tb-workbench-prompt-library-enabled", taskOptions.promptLibraryEnabled === false ? "0" : "1");
    localStorage.setItem("tb-workbench-message-downloads-enabled", taskOptions.messageDownloadsEnabled === false ? "0" : "1");
    window.dispatchEvent(new CustomEvent("tb-workbench-tools-visibility"));
    const resumeOnly = Boolean(retryFromStage || reconcileAction) && !forceUpload;
    if (!requestId || (!resumeOnly && (!attachments.length || (!prompt && !noPromptMode)))) {
      window.postMessage({
        source: "tb-gpt-production-extension",
        type: "tb-workbench-task-result",
        requestId,
        status: "failed",
        detail: "missing requestId, attachments or prompt"
      }, "*");
      return;
    }
    const retryOf = String(message.retryOf || "").trim();
    const previousBoundaryTask = [...state.uploadTasks].reverse().find((item) => item.status === "failed");
    const boundaryRecoveryRequest = Boolean(message.autoRun || retryOf);
    const autoClearComposerBoundary = Boolean(
      state.boundaryPaused
      && !forceUpload
      && automationCore.shouldAutoClearComposerBoundary?.({
        ...taskOptions,
        // Automatic recovery and an explicit retry both authorize clearing a
        // stale unsent composer boundary. The helper still limits this to
        // composer/attachment errors; quota and generation-limit pauses stay
        // blocked.
        autoRun: boundaryRecoveryRequest,
        errorCode: state.boundaryErrorCode || previousBoundaryTask?.errorCode || "",
        errorDetail: state.boundaryErrorDetail || previousBoundaryTask?.error || ""
      })
    );
    const workflowCheckpointResume = Boolean(
      message.workflow?.planSubmitted === true
      || resumePlanSubmitted
      || /计划|图片|生图|文案|下载|打包|归档/i.test(`${retryFromStage} ${reconcileAction}`)
    );
    const autoResumeWorkflowBoundary = Boolean(
      state.boundaryPaused
      && !forceUpload
      && boundaryRecoveryRequest
      && workflowCheckpointResume
      && automationCore.shouldAutoResumeWorkflowBoundary?.({
        ...taskOptions,
        autoRun: true,
        autoRecovery: true,
        errorCode: state.boundaryErrorCode || previousBoundaryTask?.errorCode || "",
        errorDetail: state.boundaryErrorDetail || previousBoundaryTask?.error || ""
      })
    );
    if (state.boundaryPaused && !forceUpload && !autoClearComposerBoundary && !autoResumeWorkflowBoundary) {
      window.postMessage({
        source: "tb-gpt-production-extension",
        type: "tb-workbench-task-result",
        requestId,
        status: "failed",
        errorCode: "COMPOSER_ATTACHMENT_CONFLICT",
        detail: "当前 GPT 输入框需要先清理未发送内容；已暂停当前窗口，请先重试上一帖"
      }, "*");
      return;
    }
    if (autoClearComposerBoundary) {
      state.boundaryPaused = false;
      state.boundaryErrorCode = "";
      state.boundaryErrorDetail = "";
      const removed = forceClearComposer();
      if (removed > 0) {
        await new Promise((r) => setTimeout(r, 600));
        forceClearComposer();
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (autoResumeWorkflowBoundary) {
      // This is a workflow checkpoint, not a composer conflict. Do not clear
      // attachments or draft text here; the resumed task owns its submitted
      // turn and the state machine controls the next prompt.
      state.boundaryPaused = false;
      state.boundaryErrorCode = "";
      state.boundaryErrorDetail = "";
    }
    if (forceUpload) {
      state.boundaryPaused = false;
      state.boundaryErrorCode = "";
      state.boundaryErrorDetail = "";
      // Do not synchronously mutate a potentially huge restored ProseMirror
      // draft while Electron is waiting for the dispatch acknowledgement.
      // processUploadQueue owns the page-idle gate and clears the composer in
      // its asynchronous force-upload stage before reading or attaching files.
    }
    if (retryOf) {
      state.boundaryPaused = false;
      state.boundaryErrorCode = "";
      state.boundaryErrorDetail = "";
    }
    const retryTask = retryOf
      ? state.uploadTasks.find((item) => item.entry?.externalRequestId === retryOf && item.status === "failed")
      : null;
    if (retryTask) {
      retryTask.entry.externalRequestId = requestId;
      retryTask.entry.name = String(message.name || retryTask.entry.name || "工作台素材").slice(0, 160);
      retryTask.entry.path = String(message.materialPath || message.name || retryTask.entry.path || "工作台素材");
      retryTask.entry.materialPath = String(message.materialPath || retryTask.entry.materialPath || "");
      retryTask.entry.attachments = attachments;
      retryTask.entry.templateAttachments = templateAttachments;
      retryTask.entry.customPrompt = prompt;
      retryTask.entry.expectedImages = clampExpectedImageCount(message.expectedImages || retryTask.entry.expectedImages || 0);
      retryTask.entry.accountId = String(message.quotaAccountId || message.accountId || retryTask.entry.accountId || "");
      retryTask.entry.autoOptions = taskOptions;
      retryTask.entry.retryFromStage = String(message.retryFromStage || "");
      retryTask.entry.retryFromPercent = Number(message.retryFromPercent || 0);
      retryTask.entry.reconcileAction = reconcileAction;
      retryTask.entry.forceUpload = forceUpload;
      retryTask.entry.nativeUpload = nativeUpload;
      retryTask.entry.conversationUrl = String(message.conversationUrl || retryTask.entry.conversationUrl || "");
      retryTask.entry.conversationOwnerConfirmed = message.conversationOwnerConfirmed === true;
      if (forceUpload) retryTask.workflow = {};
      else if (message.workflow && typeof message.workflow === "object") {
        retryTask.workflow = {
          ...(retryTask.workflow || {}),
          ...JSON.parse(JSON.stringify(message.workflow))
        };
      }
      if (resumePlanSubmitted) {
        retryTask.workflow = retryTask.workflow || {};
        retryTask.workflow.planSubmitted = true;
      }
      retryTask.status = "queued";
      retryTask.error = "";
      retryTask.stopRequested = false;
      retryTask.controller = new AbortController();
      renderQueue();
      processUploadQueue();
      return;
    }
    uploadEntry({
      id: `workbench-${requestId}`,
      name: String(message.name || "工作台素材").slice(0, 160),
      path: String(message.materialPath || message.name || "工作台素材"),
      attachments,
      templateAttachments,
      imageCount: attachments.filter((filePath) => /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(filePath)).length,
      entryKind: "external",
      customPrompt: prompt,
      externalRequestId: requestId,
      accountId: String(message.quotaAccountId || message.accountId || ""),
      taskType: String(message.taskType || "material"),
      templateId: String(message.templateId || ""),
      materialPath: String(message.materialPath || ""),
      autoRun: Boolean(message.autoRun),
      autoOptions: taskOptions,
      workflow: message.workflow && typeof message.workflow === "object"
        ? JSON.parse(JSON.stringify(message.workflow))
        : {},
      expectedImages: clampExpectedImageCount(message.expectedImages || 0),
      retryFromStage,
      retryFromPercent: Number(message.retryFromPercent || 0),
      reconcileAction,
      forceUpload,
      nativeUpload,
      conversationUrl: String(message.conversationUrl || ""),
      conversationOwnerConfirmed: message.conversationOwnerConfirmed === true,
      resumePlanSubmitted
    });
  }

  function pauseWorkbenchTaskBeforeSubmit(message = {}) {
    const requestId = String(message.requestId || "").trim();
    const task = state.uploadTasks.find((item) =>
      (!requestId || item.entry?.externalRequestId === requestId)
      && ["queued", "reading", "checking", "attaching"].includes(String(item.status || ""))
      && item.workflow?.planSubmitted !== true
    );
    if (!task) return { ok: true, paused: false, requestId };
    state.boundaryPaused = false;
    state.boundaryErrorCode = "";
    state.boundaryErrorDetail = "";
    task.controller?.abort();
    return { ok: true, paused: true, requestId: task.entry?.externalRequestId || requestId };
  }

  function visibleGenerationStopButton() {
    return [...document.querySelectorAll("button")].find((button) => {
      const rect = button.getBoundingClientRect();
      const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.getAttribute("data-testid") || ""}`;
      const inViewport = rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.right > 0
        && rect.top < window.innerHeight && rect.left < window.innerWidth;
      const currentComposerStop = button.id === "composer-submit-button"
        || button.getAttribute("data-testid") === "stop-button";
      return isActiveGenerationControl({
        visible: inViewport || currentComposerStop,
        disabled: button.disabled,
        label
      });
    }) || null;
  }

  function stopWorkbenchTask(message = {}) {
    const requestId = String(message.requestId || "").trim();
    const userInitiated = message.userInitiated !== false;
    const automaticRecoveryAbort = !userInitiated;
    const requestKey = requestId || "__active__";
    const now = Date.now();
    if (state.lastStopRequestKey === requestKey && now - Number(state.lastStopRequestAt || 0) < 1_000) {
      return { ok: true, stopped: false, aborted: false, duplicate: true, requestId };
    }
    state.lastStopRequestKey = requestKey;
    state.lastStopRequestAt = now;
    const task = state.uploadTasks.find((item) =>
      (!requestId || item.entry?.externalRequestId === requestId)
      && !["success", "completed", "cancelled", "duplicate"].includes(String(item.status || ""))
    );
    if (task) {
      state.boundaryPaused = false;
      state.boundaryErrorCode = "";
      state.boundaryErrorDetail = "";
      task.stopRequested = userInitiated;
      task.automaticRecoveryAbort = automaticRecoveryAbort;
      task.controller?.abort();
    }
    const stopButton = visibleGenerationStopButton();
    if (stopButton) stopButton.click();
    renderQueue();
    return {
      ok: Boolean(task || stopButton),
      stopped: Boolean(stopButton),
      aborted: Boolean(task),
      userInitiated,
      automaticRecoveryAbort,
      requestId: task?.entry?.externalRequestId || requestId
    };
  }

  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.source === "teambuilding-workbench" && message.type === "tb-workbench-pause-before-submit") {
      pauseWorkbenchTaskBeforeSubmit(message);
      return;
    }
    if (message.source === "teambuilding-workbench" && message.type === "tb-workbench-stop-current-task") {
      stopWorkbenchTask(message);
      return;
    }
    if (message.source === "teambuilding-workbench" && message.type === "tb-workbench-patrol-continue-request") {
      executePatrolSingleStep({
        targetUrl: String(message.targetUrl || ""),
        denylist: Array.isArray(message.denylist) ? message.denylist : [],
        confirmText: String(message.confirmText || "1"),
        copyPrompt: String(message.copyPrompt || DEFAULT_PUBLISH_COPY_PROMPT),
        generationRequestCount: Number(message.generationRequestCount || 0),
        maximumGenerationRequests: Number(message.maximumGenerationRequests || 5),
        requestId: String(message.productionRequestId || ""),
        materialName: String(message.materialName || ""),
        sourceMaterialPath: String(message.sourceMaterialPath || ""),
        templateId: String(message.templateId || ""),
        downloadRoot: String(message.downloadRoot || ""),
        productRoot: String(message.productRoot || ""),
        autoArchive: message.autoArchive !== false,
        allowUntitledRecovery: Boolean(message.allowUntitledRecovery),
        allowStaleComposerRecovery: Boolean(message.allowStaleComposerRecovery),
        allowExistingPackageRelease: Boolean(message.allowExistingPackageRelease),
        existingPackagePath: String(message.existingPackagePath || ""),
        existingPackageImages: Math.max(0, Number(message.existingPackageImages || 0)),
        durableImageUrls: Array.isArray(message.durableImageUrls)
          ? message.durableImageUrls.map(String).filter(Boolean).slice(0, 10)
          : [],
        durableImageCount: Math.max(0, Number(message.durableImageCount || 0)),
        expectedImageCount: Math.max(0, Number(message.expectedImageCount || 0)),
        inspectOnly: Boolean(message.inspectOnly)
      }).then((result) => window.postMessage({
        source: "tb-gpt-production-extension",
        type: "tb-workbench-patrol-continue-result",
        requestId: String(message.requestId || ""),
        ...result
      }, "*")).catch((error) => window.postMessage({
        source: "tb-gpt-production-extension",
        type: "tb-workbench-patrol-continue-result",
        requestId: String(message.requestId || ""),
        ok: false,
        acted: false,
        error: String(error?.message || error || "巡检单步续接失败")
      }, "*"));
      return;
    }
    if (message.source === "teambuilding-workbench" && message.type === "tb-workbench-patrol-discover-request") {
      discoverPatrolConversations({
        denylist: Array.isArray(message.denylist) ? message.denylist : [],
        maximumScrolls: Number(message.maximumScrolls || 16)
      }).then((result) => window.postMessage({
        source: "tb-gpt-production-extension",
        type: "tb-workbench-patrol-discover-result",
        requestId: String(message.requestId || ""),
        ...result
      }, "*")).catch((error) => window.postMessage({
        source: "tb-gpt-production-extension",
        type: "tb-workbench-patrol-discover-result",
        requestId: String(message.requestId || ""),
        readOnly: true,
        error: String(error?.message || error || "巡检发现失败"),
        conversations: []
      }, "*"));
      return;
    }
    if (message.source === "teambuilding-workbench" && message.type === "tb-workbench-inspect-request") {
      let responded = false;
      let fallbackTimer = null;
      const respond = () => {
        if (responded) return;
        responded = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        const snapshot = conversationStateSnapshot();
        window.postMessage({
          source: "tb-gpt-production-extension",
          type: "tb-workbench-inspect-result",
          requestId: String(message.requestId || ""),
          ...snapshot,
          composerReady: Boolean(composer()),
          composerDraft: composerDraftText(),
          attachmentCount: attachmentPreviewCount(),
          generating: Boolean(generatingNow()),
          inspectedAt: new Date().toISOString()
        }, "*");
      };
      // History reconciliation is useful for automatically releasing an
      // already-packaged boundary, but it must never block the safety probe.
      // A slow local history request previously made Continue/Retry appear
      // dead because the Electron bridge timed out before this response.
      fallbackTimer = setTimeout(respond, 1500);
      reconcileCurrentAutomationBoundaryFromHistory().catch(() => false).then(respond);
      return;
    }
    acceptWorkbenchTask(event.data);
  });

  document.addEventListener("tb-workbench-pause-before-submit", (event) => {
    pauseWorkbenchTaskBeforeSubmit(event.detail || {});
  });

  document.addEventListener("tb-workbench-stop-current-task", (event) => {
    stopWorkbenchTask(event.detail || {});
  });

  document.addEventListener("tb-workbench-upload", () => {
    try {
      const bridge = document.getElementById("tb-workbench-bridge-request");
      const message = JSON.parse(bridge?.textContent || "{}");
      // Let the short Electron dispatch evaluation return before any upload,
      // composer cleanup or React/ProseMirror work begins in this renderer.
      setTimeout(() => {
        acceptWorkbenchTask(message).catch((error) => {
          document.documentElement.dataset.tbGptLastTask = `bridge:failed:${error.message}`;
        });
      }, 0);
    } catch (error) {
      document.documentElement.dataset.tbGptLastTask = `bridge:failed:${error.message}`;
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "tb-sidebar-toggle") return;
    state.collapsed = !state.collapsed;
    applyLayout();
  });

  if (!isEmbeddedWorkbench()) render();
  Promise.all([readStoredPaths(), readActionSettings()]).then(([paths, actionSettings]) => {
    state.actionSettings = actionSettings;
    storePaths(paths);
    if (!isEmbeddedWorkbench()) {
      renderBody();
      return refresh();
    }
    return null;
  });

  const mountObserver = new MutationObserver(() => {
    if (isEmbeddedWorkbench()) return;
    if (document.getElementById(ROOT_ID) && document.getElementById(LAUNCHER_ID)) return;
    if (remountQueued) return;
    remountQueued = true;
    requestAnimationFrame(() => {
      remountQueued = false;
      render();
    });
  });
  mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  installComposerClearObserver();
})();
