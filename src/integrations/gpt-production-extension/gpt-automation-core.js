(function initTeambuildingGptAutomationCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TeambuildingGptAutomationCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function parsePlannedImageCount(text) {
    const source = String(text || "");
    // GPT does not use one fixed label. Real plans commonly say
    // “本轮输出页数：10 页”, “建议输出：9 页”, “预计输出总张数：9 张”
    // or only enumerate P1/P2/... headings. Keep the match local to a page/
    // image-count label so prices, people counts and route durations cannot
    // become the page total by accident.
    const explicit = [
      /(?:本轮|本次|本批)?\s*(?:预计|建议)?\s*(?:输出|生成|制作)?\s*(?:总)?(?:页数|张数|图片数|图片数量)\s*[：:＝=]?\s*(\d{1,2})\s*(?:张|页|张图|张图片)?/giu,
      /(?:建议|预计|本轮|本次|本批)?\s*(?:输出|生成|制作)\s*[：:＝=]\s*(\d{1,2})\s*(?:张|页|张图|张图片)/giu,
      /(?:预计输出(?:总)?(?:张数|页数)|输出总张数|共计|合计|总计|固定)\s*[：:＝=]?\s*(?:\D{0,40})?(\d{1,2})\s*(?:张|页)/giu
    ].flatMap((pattern) => [...source.matchAll(pattern)])
      .filter((match) => {
        const page = Number(match[1]);
        if (page <= 10) return true;
        const before = source.slice(Math.max(0, Number(match.index || 0) - 80), Number(match.index || 0));
        const after = source.slice(Number(match.index || 0) + match[0].length, Number(match.index || 0) + match[0].length + 120);
        const citedSource = /\u539f(?:\u7d20\u6750)?\s*$/.test(before);
        const negatedBefore = /(?:\u7981\u6b62|\u4e25\u7981|\u7edd\u4e0d|\u4e0d\u5f97|\u4e0d\u505a|\u4e0d\u751f\u6210|\u6ca1\u6709|\u4e0d\u5b58\u5728|\u65e0)[^\n\u3002\uff1b]{0,60}$/.test(before);
        const negatedAfter = /^\s*(?:\u4e0d\u5b58\u5728|\u6ca1\u6709|\u4e0d\u505a|\u4e0d\u751f\u6210|\u7981\u6b62|\u65e0)/.test(after);
        return !(citedSource || negatedBefore || negatedAfter);
      })
      .map((match) => Number(match[1]))
      .filter((value) => value > 0 && value <= 30);
    if (explicit.length) return explicit[explicit.length - 1];
    const pages = [...source.matchAll(/^\s*P\s*(\d{1,2})(?=\s*(?:[｜|：:\-—.．]|\b|$))/gim)]
      .map((match) => Number(match[1]))
      .filter((value) => value > 0 && value <= 30);
    const actionablePages = pages.filter((page) => {
      if (page <= 10) return true;
      const marker = new RegExp(`^\\s*P\\s*${page}\\b`, "gim");
      return [...source.matchAll(marker)].some((match) => {
        const before = source.slice(Math.max(0, Number(match.index || 0) - 80), Number(match.index || 0));
        const after = source.slice(Number(match.index || 0) + match[0].length, Number(match.index || 0) + match[0].length + 120);
        const citedSource = /\u539f(?:\u7d20\u6750)?\s*$/.test(before);
        const negatedBefore = /(?:\u7981\u6b62|\u4e25\u7981|\u7edd\u4e0d|\u4e0d\u5f97|\u4e0d\u505a|\u4e0d\u751f\u6210|\u6ca1\u6709|\u4e0d\u5b58\u5728|\u65e0)[^\n\u3002\uff1b]{0,60}$/.test(before);
        const negatedAfter = /^\s*(?:\u4e0d\u5b58\u5728|\u6ca1\u6709|\u4e0d\u505a|\u4e0d\u751f\u6210|\u7981\u6b62|\u65e0)/.test(after);
        return !(citedSource || negatedBefore || negatedAfter);
      });
    });
    return actionablePages.length ? Math.max(...actionablePages) : 0;
  }

  function requiresPlannedImageCount(taskType = "") {
    return String(taskType || "").trim() !== "template-init";
  }

  function workflowStepExecutionTimeoutMs(action, configuredTimeoutMs, options = {}) {
    const configured = Math.max(1, Number(configuredTimeoutMs || 0));
    const settlementGraceMs = Math.max(1_000, Number(options.settlementGraceMs || 15_000));
    // These handlers own an inner wait that may consume the full configured
    // budget. The outer Promise.race needs a small settlement window for the
    // final DOM scan and checkpoint write, otherwise a valid result found at
    // the boundary is overwritten by WORKFLOW_STEP_TIMEOUT.
    return ["wait-plan", "wait-images", "wait-copy"].includes(String(action || ""))
      ? configured + settlementGraceMs
      : configured;
  }

  function shouldTrustCompletedPlanCheckpoint(options = {}) {
    if (options.planDone !== true || options.materialMatched !== true) return false;
    const plannedImageCount = Math.max(
      0,
      Number(options.plannedImageCount || 0),
      parsePlannedImageCount(options.planText || "")
    );
    return options.requiresPlannedImageCount === false || plannedImageCount > 0;
  }

  function isConfirmUserTurnText(value = "", options = {}) {
    const text = String(value || "").replace(/\r/g, "").trim();
    if (/^1\s*$/.test(text)) return true;
    if (Math.max(0, Number(options.attachmentCount || 0)) <= 0) return false;
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.length > 1 && lines.at(-1) === "1";
  }

  function clampExpectedImageCount(value, maximum = 10) {
    const cap = Math.max(1, Number(maximum || 10));
    return Math.max(0, Math.min(cap, Number(value || 0)));
  }

  function isArchivedAutomationBoundary(options = {}) {
    const marker = options.marker && typeof options.marker === "object" ? options.marker : null;
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    if (!marker) return false;
    return normalize(options.currentUrl) === normalize(marker.conversationUrl)
      && Boolean(normalize(options.materialText))
      && normalize(options.materialText) === normalize(marker.materialText);
  }

  function completedHistoryMatchesAutomationBoundary(options = {}) {
    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const normalizeUrl = (value) => String(value || "").split(/[?#]/)[0].trim();
    const currentUrl = normalizeUrl(options.currentUrl);
    const materialText = normalizeText(options.materialText);
    if (!currentUrl || !materialText) return false;
    return (Array.isArray(options.historyItems) ? options.historyItems : []).some((item) => {
      if (!item) return false;
      const sameConversation = normalizeUrl(item.conversationUrl) === currentUrl;
      if (!sameConversation && options.allowCrossConversation !== true) return false;
      if (!item.packageValid || !normalizeText(item.packagePath) || Number(item.downloadedImageCount || 0) < 1) return false;
      // The durable checkpoint history uses the machine step key in the
      // completed record (for example `步骤完成：move-archive`), while older
      // records use the human-facing `作品归档完成` label.  Both are valid
      // only after the package, image count, and material identity checks
      // above have passed.
      if (!/(?:作品归档完成|完成$|move-archive$)/u.test(normalizeText(item.stage))) return false;
      const materialName = normalizeText(String(item.sourceMaterialPath || "").split(/[\\/]/).pop());
      const promptLabel = normalizeText(materialText.match(/当前素材文件夹\s*[：:]\s*(.+)$/u)?.[1]);
      return materialName.length >= 8
        && (materialText.includes(materialName)
          || (promptLabel.length >= 16 && (materialName.startsWith(promptLabel) || promptLabel.startsWith(materialName))));
    });
  }

  function patrolActionLedgerKey(options = {}) {
    const conversationUrl = String(options.conversationUrl || "").split(/[?#]/)[0].trim();
    const materialText = String(options.materialText || "").replace(/\s+/g, " ").trim();
    // Keep URL-only keys compatible with ledgers written by older versions.
    // Once a material boundary exists, however, each post in the same ChatGPT
    // conversation needs an independent action/package record.
    if (!materialText) return conversationUrl;
    let hash = 0x811c9dc5;
    for (let index = 0; index < materialText.length; index += 1) {
      hash ^= materialText.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${conversationUrl}::material:${materialText.length}:${hash.toString(16).padStart(8, "0")}`;
  }

  function firstBatchChoice(options = {}) {
    const maximum = Math.max(1, Number(options.maximum || 10));
    const planned = Math.max(1, Number(options.plannedImageCount || maximum));
    const expectedImageCount = Math.min(planned, maximum);
    return {
      reply: `先出 P1-P${expectedImageCount}`,
      expectedImageCount
    };
  }

  function validatePlanPageCap(options = {}) {
    const maximum = Math.max(1, Number(options.maximum || 10));
    const planned = Math.max(0, Number(options.plannedImageCount || 0));
    const text = String(options.text || "");
    if (planned > maximum) {
      return { valid: false, code: "PLAN_PAGE_CAP_EXCEEDED" };
    }
    // A compliant plan often repeats the guardrail itself (for example
    // “不做 P11 / 不开第二批”).  Those negative statements are evidence of
    // compliance, not a request for another batch.  Remove only the local
    // negated clause before looking for an affirmative P11/second-batch plan.
    const actionableText = text.replace(
      /(?:禁止|严禁|不得|不做|不会|不再|没有|不存在|无|取消)[^\n。；]{0,40}(?:P\s*11\b|第\s*二\s*批)[^\n。；]*/giu,
      ""
    );
    const proposesAnotherBatch = /(?:^|\n)\s*P\s*11\s*(?:[｜|:：\-]|$)/iu.test(actionableText)
      || /第二批\s*[:：]?\s*P|第二批.{0,24}(?:继续|生成|出图|剩余)|(?:继续|再出|生成|出图|规划).{0,24}P\s*11/iu.test(actionableText);
    if (proposesAnotherBatch) {
      return { valid: false, code: "PLAN_BATCHING_FORBIDDEN" };
    }
    return { valid: true, code: "" };
  }

  function resolveEntryInstruction(entry = {}) {
    if (String(entry.customPrompt || "").trim()) return String(entry.customPrompt).trim();
    if (String(entry.prompt || "").trim()) return String(entry.prompt).trim();
    return [
      "请沿用当前对话已经确定的母版与规则，处理刚上传的这组团建素材。",
      `内容名称：${String(entry.name || "").trim()}`
    ].filter(Boolean).join("\n");
  }

  function shouldRecoverSilentAssistant(options = {}) {
    const elapsedMs = Math.max(0, Number(options.elapsedMs || 0));
    const thresholdMs = Math.max(1, Number(options.thresholdMs || 60_000));
    return elapsedMs >= thresholdMs
      && Math.max(0, Number(options.freshTurnCount || 0)) === 0
      && !options.generating
      && Boolean(options.composerEmpty);
  }

  function shouldRecoverSilentImageGeneration(options = {}) {
    const elapsedMs = Math.max(0, Number(options.elapsedMs || 0));
    const thresholdMs = Math.max(1, Number(options.thresholdMs || 60_000));
    return elapsedMs >= thresholdMs
      && Math.max(0, Number(options.freshTurnCount || 0)) === 0
      && Math.max(0, Number(options.freshImageCount || 0)) === 0
      && !options.generating;
  }

  function shouldStopStalledSilentGeneration(options = {}) {
    const stableForMs = Math.max(0, Number(options.stableForMs || 0));
    const thresholdMs = Math.max(1, Number(options.thresholdMs || 300_000));
    return Boolean(options.generating)
      && stableForMs >= thresholdMs
      && Math.max(0, Number(options.meaningfulTurnCount || 0)) === 0;
  }

  function shouldStopStalledNativeImageGeneration(options = {}) {
    const stableForMs = Math.max(0, Number(options.stableForMs || 0));
    const thresholdMs = Math.max(1, Number(options.thresholdMs || 300_000));
    const detected = Math.max(0, Number(options.detected || 0));
    const expected = Math.max(0, Number(options.expected || 0));
    return Boolean(options.generating)
      && stableForMs >= thresholdMs
      && detected > 0
      && expected > detected;
  }

  function shouldStopStalledEmptyImageGeneration(options = {}) {
    const stableForMs = Math.max(0, Number(options.stableForMs || 0));
    const thresholdMs = Math.max(1, Number(options.thresholdMs || 300_000));
    const detected = Math.max(0, Number(options.detected || 0));
    const expected = Math.max(0, Number(options.expected || 0));
    return Boolean(options.generating)
      && stableForMs >= thresholdMs
      && detected === 0
      && expected > 0;
  }

  function nextContinuousImageIdleSince(options = {}) {
    const now = Math.max(0, Number(options.now || Date.now()));
    const previous = Math.max(0, Number(options.previous || 0));
    // The long-quiet fallback is only safe after one continuous idle window.
    // ChatGPT can briefly hide its streaming control between generated images;
    // carrying an older timer across that active period can classify a late
    // 9-image response as a one-image result and duplicate it on another account.
    if (options.generating) return 0;
    if (options.signatureChanged || !previous) return now;
    return previous;
  }

  function detectRejectedImageDraftLoop(options = {}) {
    const text = String(options.text || "");
    const nativeImages = Math.max(0, Number(options.nativeImages || 0));
    const rejectionMarkers = [
      ...text.matchAll(/不合格|返工|重新绘制|重新生成这一页|再次重做|rejected\s+draft|regenerat(?:e|ing)\s+this\s+page/giu)
    ].length;
    const samePageConstraint = /只(?:生成|做)(?:一张图|单页)|只保留.{0,30}P\s*\d+|只参考.{0,30}P\s*\d+/iu.test(text);
    return {
      detected: nativeImages >= 2 && rejectionMarkers >= 2 && samePageConstraint,
      rejectionMarkers,
      nativeImages
    };
  }

  function shouldRetryThreadError(options = {}) {
    const elapsedMs = Math.max(0, Number(options.elapsedMs || 0));
    const thresholdMs = Math.max(1, Number(options.thresholdMs || 15_000));
    return elapsedMs >= thresholdMs
      && Boolean(options.retryVisible)
      && Math.max(0, Number(options.freshTurnCount || 0)) === 0
      && !options.alreadyRetried;
  }

  function detectRepetitiveAssistantLoop(text, minimumRepeats = 8) {
    const lines = String(text || "").split(/\r?\n/)
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    const token = lines.at(-1) || "";
    if (!token || token.length > 40) return { detected: false, token: "", repeats: 0 };
    let repeats = 0;
    for (let index = lines.length - 1; index >= 0 && lines[index] === token; index -= 1) repeats += 1;
    return { detected: repeats >= Math.max(2, Number(minimumRepeats || 8)), token, repeats };
  }

  function classifyPatrolConversationCandidate(options = {}) {
    const title = String(options.title || "").replace(/\s+/g, " ").trim();
    const url = String(options.url || "").trim();
    const denylist = (Array.isArray(options.denylist) ? options.denylist : [])
      .map((value) => String(value || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const titleMatched = /模板|母版/i.test(title);
    const excludedByKeyword = /游戏/i.test(title);
    const explicitlyExcluded = Boolean(url && denylist.includes(url)) || Boolean(title && denylist.includes(title));
    const excluded = excludedByKeyword || explicitlyExcluded;
    return { title, url, titleMatched, excludedByKeyword, explicitlyExcluded, excluded, eligible: titleMatched && !excluded };
  }

  function generatedImageIdentity(value) {
    const url = String(value || "").trim();
    if (!url) return "";
    try {
      const parsed = new URL(url);
      const fileId = parsed.searchParams.get("id");
      if (fileId) return `chatgpt-file:${fileId}`;
    } catch { /* blob/data URLs keep their full identity */ }
    return url;
  }

  function uniqueGeneratedImageUrls(urls) {
    const seen = new Set();
    return (Array.isArray(urls) ? urls : []).map((value) => String(value || "").trim()).filter((url) => {
      if (!/^(?:https?:|blob:|data:image\/)/i.test(url)) return false;
      // ChatGPT may render one generated file through several signed URLs
      // (thumbnail/full-size/lazy-loaded variants). The backend file id is
      // the stable identity; comparing the entire signed URL made the same
      // image look new after a signature refresh.
      const identity = generatedImageIdentity(url);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
      });
  }

  function preferCurrentBatchImageUrls(roleBasedUrls = [], semanticUrls = []) {
    const roleBased = uniqueGeneratedImageUrls(roleBasedUrls);
    const semantic = uniqueGeneratedImageUrls(semanticUrls);
    // After a reload or lazy hydration, role-based image discovery can expose
    // only the first thumbnail while the semantic image markers already
    // contain the complete current batch. Prefer the larger same-turn set;
    // never merge unrelated turns into one batch.
    return semantic.length > roleBased.length ? semantic : roleBased;
  }

  function newGeneratedImageUrls(urls, baselineUrls = []) {
    const baseline = new Set((Array.isArray(baselineUrls) ? baselineUrls : [])
      .map(generatedImageIdentity)
      .filter(Boolean));
    return uniqueGeneratedImageUrls(urls).filter((url) => !baseline.has(generatedImageIdentity(url)));
  }

  // A renderer reload can temporarily expose no image DOM at all even though
  // the same submitted task already persisted the complete current batch.
  // Use that durable boundary only when it is tied to this task's confirmation
  // turn and the saved URLs are a complete, fresh set.  A bare 10/10 counter
  // is deliberately insufficient because it cannot be downloaded or tied to
  // the current material.
  function resolveDurableImageBoundary(options = {}) {
    const expected = Math.max(
      0,
      Number(options.expectedImageCount || 0),
      Number(options.plannedImageCount || 0)
    );
    const urls = uniqueGeneratedImageUrls(options.generatedImageUrls);
    const baselineUrls = uniqueGeneratedImageUrls(options.generatedBaselineUrls);
    const freshUrls = newGeneratedImageUrls(urls, baselineUrls);
    const actual = Math.max(
      0,
      Number(options.generatedImageActualCount || 0),
      Number(options.generatedImages || 0),
      urls.length
    );
    const taskBound = options.imageSubmitted === true
      && Boolean(String(options.confirmTurnKey || "").trim());
    if (!taskBound) {
      return { ready: false, reason: "task-image-boundary-missing", expected, actual, urls, freshUrls };
    }
    if (!expected || urls.length < expected || actual < expected) {
      return { ready: false, reason: "durable-image-set-incomplete", expected, actual, urls, freshUrls };
    }
    if (baselineUrls.length && freshUrls.length < expected) {
      return { ready: false, reason: "durable-image-set-overlaps-baseline", expected, actual, urls, freshUrls };
    }
    return {
      ready: true,
      reason: "submitted-task-complete-image-boundary",
      expected,
      actual,
      urls: limitGeneratedImageUrls(urls, expected),
      freshUrls: limitGeneratedImageUrls(freshUrls, expected)
    };
  }

  function limitGeneratedImageUrls(urls, maximum = 0) {
    const unique = uniqueGeneratedImageUrls(urls);
    const cap = Math.max(0, Number(maximum || 0));
    return cap > 0 ? unique.slice(0, cap) : unique;
  }

  const COPY_FORMAT_HEADER = "<<<COPY_FORMAT:2>>>";
  const COPY_MARKERS = Object.freeze({
    xhsStart: "<<<XHS_START>>>",
    xhsEnd: "<<<XHS_END>>>",
    douyinStart: "<<<DOUYIN_START>>>",
    douyinEnd: "<<<DOUYIN_END>>>"
  });
  const DOUYIN_FORBIDDEN_TERMS = Object.freeze([
    "10人起接",
    "人数起接",
    "承接",
    "接单",
    "定制",
    "咨询",
    "联系我们",
    "留言城市+人数",
    "方案获客",
    "报名",
    "预约",
    "下单",
    "报价",
    "费用",
    "价格"
  ]);
  const DOUYIN_MIN_GROUP_PATTERN = /[0-9一二三四五六七八九十百千万]+\s*人\s*(?:起接|起订|起团|以上接待)/gu;

  function parsePlatformCopy(text) {
    const source = String(text || "").replace(/\r\n?/g, "\n").trim();
    const markerEntries = [
      ["xhsStart", COPY_MARKERS.xhsStart],
      ["xhsEnd", COPY_MARKERS.xhsEnd],
      ["douyinStart", COPY_MARKERS.douyinStart],
      ["douyinEnd", COPY_MARKERS.douyinEnd]
    ];
    const markerCount = Object.fromEntries(markerEntries.map(([key, marker]) => [
      key,
      source.split(marker).length - 1
    ]));
    const hasAnyMarker = markerEntries.some(([key]) => markerCount[key] > 0);
    const hasAllMarkers = markerEntries.every(([key]) => markerCount[key] === 1);
    const headerPresent = source.split(COPY_FORMAT_HEADER).length - 1 === 1;
    if (!hasAllMarkers || !headerPresent) {
      return {
        formatVersion: 1,
        legacy: true,
        strict: false,
        valid: Boolean(source),
        xhs: source,
        douyin: "",
        issues: hasAnyMarker ? ["COPY_FORMAT_MARKERS_INCOMPLETE"] : []
      };
    }
    const headerIndex = source.indexOf(COPY_FORMAT_HEADER);
    const xhsStart = source.indexOf(COPY_MARKERS.xhsStart);
    const xhsEnd = source.indexOf(COPY_MARKERS.xhsEnd, xhsStart + COPY_MARKERS.xhsStart.length);
    const douyinStart = source.indexOf(COPY_MARKERS.douyinStart);
    let douyinEnd = douyinStart >= 0 ? source.indexOf(COPY_MARKERS.douyinEnd, douyinStart + COPY_MARKERS.douyinStart.length) : -1;
    let softEndMarker = false;
    if (douyinStart >= 0 && douyinEnd < 0) {
      douyinEnd = source.length;
      softEndMarker = true;
    }
    const ordered = headerIndex === 0
      && xhsStart > headerIndex
      && xhsEnd > xhsStart
      && douyinStart > xhsEnd
      && douyinEnd > douyinStart;
    const outside = ordered
      ? `${source.slice(0, headerIndex)}${source.slice(douyinEnd + COPY_MARKERS.douyinEnd.length)}`.trim()
      : source;
    const xhs = ordered
      ? source.slice(xhsStart + COPY_MARKERS.xhsStart.length, xhsEnd).trim()
      : "";
    const douyin = ordered
      ? source.slice(douyinStart + COPY_MARKERS.douyinStart.length, douyinEnd).trim()
      : "";
    const issues = [];
    if (!ordered) issues.push("COPY_FORMAT_ORDER_INVALID");
    if (outside) issues.push("COPY_FORMAT_EXTRA_OUTPUT");
    if (!xhs) issues.push("XHS_EMPTY");
    if (!douyin) issues.push("DOUYIN_EMPTY");
    return {
      formatVersion: 2,
      legacy: false,
      strict: issues.length === 0,
      valid: issues.length === 0,
      xhs,
      douyin,
      issues
    };
  }

  function countCopyHashtags(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").trim().split("\n");
    const lastLine = lines.at(-1) || "";
    return [...lastLine.matchAll(/#[^\s#]+/gu)].length;
  }

  function detectDouyinForbiddenPhrases(text) {
    const source = String(text || "").replace(/\s+/gu, "");
    const terms = DOUYIN_FORBIDDEN_TERMS.filter((term) => source.includes(term.replace(/\s+/gu, "")));
    const groupMatches = [...String(text || "").matchAll(DOUYIN_MIN_GROUP_PATTERN)].map((match) => match[0]);
    return [...new Set([...terms, ...groupMatches])];
  }

  function validatePlatformCopy(text, options = {}) {
    const parsed = parsePlatformCopy(text);
    const minimumSectionLength = Math.max(1, Number(options.minimumSectionLength || 120));
    const requiredXhsHashtags = Math.max(0, Number(options.requiredXhsHashtags ?? 10));
    const requiredDouyinHashtags = Math.max(0, Number(options.requiredDouyinHashtags ?? 5));
    const issues = [...parsed.issues];
    if (parsed.formatVersion !== 2) issues.push("COPY_FORMAT_VERSION_LEGACY");
    if (parsed.xhs.replace(/\s/g, "").length < minimumSectionLength) issues.push("XHS_TOO_SHORT");
    if (parsed.douyin.replace(/\s/g, "").length < minimumSectionLength) issues.push("DOUYIN_TOO_SHORT");
    const xhsHashtags = countCopyHashtags(parsed.xhs);
    const douyinHashtags = countCopyHashtags(parsed.douyin);
    const douyinForbiddenPhrases = parsed.formatVersion === 2
      ? detectDouyinForbiddenPhrases(parsed.douyin)
      : [];
    if (parsed.formatVersion === 2 && xhsHashtags !== requiredXhsHashtags) issues.push("XHS_HASHTAG_COUNT_INVALID");
    if (parsed.formatVersion === 2 && douyinHashtags !== requiredDouyinHashtags) issues.push("DOUYIN_HASHTAG_COUNT_INVALID");
    if (douyinForbiddenPhrases.length) issues.push("DOUYIN_FORBIDDEN_PHRASES");
    return {
      valid: issues.length === 0,
      parsed,
      issues: [...new Set(issues)],
      xhsHashtags,
      douyinHashtags,
      douyinForbiddenPhrases
    };
  }

  function formatPlatformCopy({ xhs = "", douyin = "" } = {}) {
    return [
      COPY_FORMAT_HEADER,
      "",
      COPY_MARKERS.xhsStart,
      String(xhs || "").trim(),
      COPY_MARKERS.xhsEnd,
      "",
      COPY_MARKERS.douyinStart,
      String(douyin || "").trim(),
      COPY_MARKERS.douyinEnd,
      ""
    ].join("\n");
  }

  function isCompleteCopy(text, minimum = 300) {
    return String(text || "").replace(/\s/g, "").length >= Math.max(1, Number(minimum || 300));
  }

  function isLikelyPublishCopy(text, minimum = 300) {
    const source = String(text || "").trim();
    const platformCopy = parsePlatformCopy(source);
    if (platformCopy.formatVersion === 2) {
      return platformCopy.strict
        && platformCopy.xhs.replace(/\s/g, "").length >= Math.max(1, Number(minimum || 300) / 2)
        && platformCopy.douyin.replace(/\s/g, "").length >= Math.max(1, Number(minimum || 300) / 2)
        && (countCopyHashtags(platformCopy.xhs) > 0 || countCopyHashtags(platformCopy.douyin) > 0);
    }
    if (!isCompleteCopy(source, minimum)) return false;
    if (/母版页数不是输出上限|逐页迁移计划|迁移计划|等待.{0,12}(?:回复|输入).{0,6}1|暂时不出图/i.test(source)) return false;
    const pageHeadings = source.match(/(?:^|\n)\s*P\s*\d{1,2}\s*[｜|：:\-—]/gim) || [];
    if (pageHeadings.length >= 2) return false;
    return /#[^\s#]{2,}|(?:适合|地点|行程|玩法|团建|公司团队|出发前)/i.test(source);
  }

  function detectCopyMetaNarration(text) {
    const source = String(text || "");
    const rules = [
      { code: "txt-source", pattern: /(?:TXT|txt)\s*(?:里|中|里面|文档中).{0,24}(?:提到|写着|写了|显示|说明|提及)/u },
      { code: "material-source", pattern: /(?:素材|文案素材|参考素材)\s*(?:里|中|里面).{0,24}(?:提到|写着|写了|显示|说明|提及)/u },
      { code: "image-source", pattern: /(?:根据|结合|参考)(?:你提供的|提供的|这些|本轮)?(?:图片素材|图片|附件|素材)/u },
      { code: "image-observation", pattern: /(?:从|通过)(?:你提供的|提供的|这些|本轮)?(?:图片素材|图片|图中|图里|附件|素材)(?:中|里)?(?:可以)?(?:看到|看出|得知|了解到)/u },
      { code: "reference-copy", pattern: /参考文案\s*(?:里|中|里面).{0,24}(?:提到|写着|写了|显示|说明|提及)/u },
      { code: "combined-source", pattern: /结合\s*(?:TXT|txt|图片|附件|素材).{0,20}(?:TXT|txt|图片|附件|素材)/u },
      { code: "plan-source", pattern: /根据(?:本轮|当前)?出图计划/u },
      { code: "ai-process", pattern: /(?:由|通过|使用)?(?:AI|人工智能|模型)(?:生成|整理|读取|分析|改写)|作为(?:AI|模型)/iu }
    ];
    const matches = rules.filter((rule) => rule.pattern.test(source)).map((rule) => rule.code);
    return { matched: matches.length > 0, matches };
  }

  function escapeRegExpLiteral(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function defaultKeywordPattern(action) {
    const key = String(action || "").trim();
    if (key === "wait-plan" || key === "detect-plan") return "迁移计划|逐页|P\\s*1|计划完成";
    if (key === "wait-images" || key === "detect-images") return "出图完毕|图片完成|生成完成";
    if (key === "wait-copy" || key === "detect-copy") return "文案完成|文案已完成|复制文案完成";
    return "";
  }

  function keywordPatternMatches(text, pattern) {
    const source = String(text || "");
    const raw = String(pattern || "").trim();
    if (!source || !raw) return false;
    try {
      return new RegExp(raw, "i").test(source);
    } catch {
      return new RegExp(escapeRegExpLiteral(raw), "i").test(source);
    }
  }

  function completionKeywordDetected(text, options = {}) {
    const action = String(options.action || "").trim();
    const pattern = String(options.keywordPattern || options.pattern || defaultKeywordPattern(action) || "").trim();
    return {
      matched: keywordPatternMatches(text, pattern),
      pattern
    };
  }

  function classifyAttachmentUploadResult(options = {}) {
    const expected = Math.max(0, Number(options.expected || 0));
    const observed = Math.max(0, Math.min(expected, Number(options.observed || 0)));
    if (expected > 0 && observed >= expected) {
      return { status: "complete", expected, observed };
    }
    if (observed > 0) {
      return { status: "partial", expected, observed, code: "UPLOAD_LIMIT_SIGNAL" };
    }
    return { status: "missing", expected, observed, code: "ATTACHMENT_UPLOAD_NOT_READY" };
  }

  function classifyPlanDetectionResult(options = {}) {
    if (!options.validPlan) return { ready: false, code: "PLAN_NOT_READY" };
    if (!options.planComplete) return { ready: false, code: "PLAN_NOT_COMPLETE" };
    if (Object.prototype.hasOwnProperty.call(options, "plannedImageCount")
      && Math.max(0, Number(options.plannedImageCount || 0)) === 0) {
      return { ready: false, code: "PLAN_NOT_COMPLETE" };
    }
    return { ready: true, code: "" };
  }

  function decidePlanRecovery(options = {}) {
    const attempts = Math.max(0, Number(options.attempts || 0));
    const maxAttempts = Math.max(0, Number(options.maxAttempts ?? 2));
    if (options.generating) return { action: "wait-current", nextAttempt: attempts };
    if (attempts < maxAttempts) return { action: "retry-current", nextAttempt: attempts + 1 };
    return { action: "pause", nextAttempt: attempts };
  }

  function decideCopyRecovery(options = {}) {
    const attempts = Math.max(0, Number(options.attempts || 0));
    const maxAttempts = Math.max(0, Number(options.maxAttempts ?? 2));
    if (options.valid) return { action: "complete", nextAttempt: attempts };
    if (options.generating) return { action: "wait", nextAttempt: attempts };
    if (options.promptMissing) {
      return attempts < maxAttempts
        ? { action: "retry-current", nextAttempt: attempts + 1 }
        : { action: "pause", nextAttempt: attempts };
    }
    if (!options.hasCandidate) return { action: "wait", nextAttempt: attempts };
    if (attempts < maxAttempts) return { action: "retry-current", nextAttempt: attempts + 1 };
    return { action: "pause", nextAttempt: attempts };
  }

  function decidePartialImageRecovery(options = {}) {
    const detected = Math.max(0, Number(options.detected || 0));
    const expected = Math.max(0, Number(options.expected || 0));
    const attempts = Math.max(0, Number(options.attempts || 0));
    const maxAttempts = Math.max(0, Number(options.maxAttempts ?? 2));
    if (expected > 0 && detected >= expected) return { action: "complete", nextAttempt: attempts };
    // A partially rendered native reply is not a missing-image result.  The
    // DOM can expose the first few image nodes while the same assistant turn
    // is still producing the rest; sending a recovery prompt here creates a
    // second competing reply and can make the original batch look incomplete.
    if (options.currentReplyInFlight || options.generating) {
      return { action: "wait-current", nextAttempt: attempts };
    }
    if (detected > 0 && expected > detected && attempts < maxAttempts) {
      return { action: "continue-missing", nextAttempt: attempts + 1 };
    }
    if (detected > 0 && expected > detected) return { action: "pause-partial", nextAttempt: attempts };
    return { action: "none", nextAttempt: attempts };
  }

  function classifyExhaustedImageRecovery(options = {}) {
    const evidence = String(options.evidence || "");
    const attempts = Math.max(0, Number(options.attempts || 0));
    const maxAttempts = Math.max(0, Number(options.maxAttempts ?? 2));
    const detected = Math.max(0, Number(options.detected || 0));
    if (detected === 0 && evidence === "failed-image-response" && attempts >= maxAttempts) {
      return { action: "rotate-account", code: "IMAGE_GENERATION_UNAVAILABLE" };
    }
    return { action: "pause-uncertain", code: "IMAGE_COUNT_UNCERTAIN" };
  }

  function isRetryableNoImageResponseEvidence(evidence = "") {
    return ["silent-image-response", "stalled-image-response", "failed-image-response"]
      .includes(String(evidence || ""));
  }

  function mergePartialImageRecovery(options = {}) {
    const urls = uniqueGeneratedImageUrls([
      ...(Array.isArray(options.accumulated) ? options.accumulated : []),
      ...(Array.isArray(options.detected) ? options.detected : [])
    ]);
    const detectedCount = options.detectedCount == null
      ? urls.length
      : Math.max(0, Number(options.detectedCount || 0));
    return {
      ...decidePartialImageRecovery({
        detected: detectedCount,
        expected: options.expected,
        attempts: options.attempts,
        maxAttempts: options.maxAttempts,
        currentReplyInFlight: options.currentReplyInFlight,
        generating: options.generating
      }),
      urls,
      detectedCount
    };
  }

  function partialImageRecoverySignature(options = {}) {
    const urls = uniqueGeneratedImageUrls(Array.isArray(options.urls) ? options.urls : [])
      .map(generatedImageIdentity)
      .filter(Boolean)
      .sort();
    return urls.join("|");
  }

  function effectiveGeneratedImageCount(options = {}) {
    const urlCount = uniqueGeneratedImageUrls(Array.isArray(options.urls) ? options.urls : []).length;
    // The download helper's declared count is UI metadata and can lag behind
    // the live native-image DOM while ChatGPT is replacing thumbnails. It must
    // never downgrade an already observed set of unique backend image IDs
    // (the 10-images-rendered/declared-1 incident did exactly that). A declared
    // count may still be used as completion evidence by the caller, but the
    // durable actual count is always grounded in the URLs we can account for.
    return urlCount;
  }

  function imageUrlsFromLatestConfirmedBatch(turns = [], options = {}) {
    const confirmText = String(options.confirmText || "1").replace(/\s+/g, "");
    const normalizedTurns = Array.isArray(turns) ? turns : [];
    let confirmationIndex = -1;
    for (let index = normalizedTurns.length - 1; index >= 0; index -= 1) {
      const turn = normalizedTurns[index] || {};
      if (String(turn.role || "").trim() !== "user") continue;
      if (String(turn.text || "").replace(/\s+/g, "") === confirmText) {
        confirmationIndex = index;
        break;
      }
    }
    if (confirmationIndex < 0) return [];
    return uniqueGeneratedImageUrls(normalizedTurns.slice(confirmationIndex + 1)
      .filter((turn) => String(turn?.role || "").trim() === "assistant")
      .flatMap((turn) => Array.isArray(turn?.urls) ? turn.urls : []));
  }

  function isFreshAutomationTurnKey(options = {}) {
    const key = String(options.key || "").trim();
    const baselineKeys = Array.isArray(options.baselineKeys)
      ? options.baselineKeys.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    return Boolean(key && baselineKeys.length && !baselineKeys.includes(key));
  }

  function isActiveGenerationControl(options = {}) {
    if (!options.visible || options.disabled) return false;
    const label = String(options.label || "");
    // ChatGPT keeps a clickable historical disclosure named “已停止思考”
    // after a response finishes.  It is not the live stop control.
    if (/已停止(?:思考|生成|回答|响应)|(?:already\s+)?stopped\s+(?:thinking|generating|response)/i.test(label)) return false;
    return /stop-(?:button|generating|streaming|response)|stop\s+(?:generating|streaming|response)|停止(?:生成|回答|响应|流式|思考)/i.test(label);
  }

  // ── GPT 触顶特征检测 ──
  // 用户反馈:GPT 撞到生图上限后,可能不用 DALL-E 原生出图,而是用 PY/代码解释器
  // 直接拼接垃圾图;只出 4 张及以下也是撞上限的表现。

  // PY 脚本兜底拼图检测:GPT 撞到上限后用代码解释器/脚本生成低质量图片,而非
  // DALL-E 原生出图。判定条件:有图片(>0) 且有脚本特征(代码信号或脚本文件)。
  // 无图片时不判定(纯脚本/沙盒输出由 detectScriptOutputLimitSignal 单独处理)。
  function detectPyScriptFallbackSignal(options = {}) {
    const nativeImages = Math.max(0, Number(options.nativeImages || 0));
    const hasCodeSignal = Boolean(options.hasCodeSignal);
    const hasScriptArtifact = Boolean(options.hasScriptArtifact);
    if (nativeImages <= 0) return { detected: false, reason: "" };
    if (hasCodeSignal || hasScriptArtifact) {
      return {
        detected: true,
        reason: "py-script-fallback",
        factors: {
          nativeImages,
          hasCodeSignal,
          hasScriptArtifact
        }
      };
    }
    return { detected: false, reason: "" };
  }

  // 纯脚本/沙盒输出检测:没有原生生图,但出现代码解释器、脚本文件、压缩包或
  // 批量下载等产物。这也是生图触顶特征,不能只当普通脚本异常。
  function detectScriptOutputLimitSignal(options = {}) {
    const nativeImages = Math.max(0, Number(options.nativeImages || 0));
    const artifactCount = Math.max(0, Number(options.artifactCount || 0));
    const hasCodeSignal = Boolean(options.hasCodeSignal);
    const hasScriptArtifact = Boolean(options.hasScriptArtifact);
    const hasArchiveSignal = Boolean(options.hasArchiveSignal);
    if (nativeImages > 0 || artifactCount <= 0) return { detected: false, reason: "" };
    if (hasCodeSignal || hasScriptArtifact || hasArchiveSignal) {
      return { detected: true, reason: "script-output-limit" };
    }
    return { detected: false, reason: "" };
  }

  // 低图触顶检测:GPT 只生成 threshold(默认 4) 张及以下图片,视为撞上限特征。
  // nativeImages 为 0 时不判定(无图由其他检测处理)。
  function detectLowImageLimit(options = {}) {
    const nativeImages = Math.max(0, Number(options.nativeImages || 0));
    const threshold = Math.max(1, Number(options.threshold || 4));
    const detected = nativeImages > 0 && nativeImages <= threshold;
    return {
      detected,
      count: nativeImages,
      threshold
    };
  }

  function classifyAutomationBoundaryPause(snapshot = {}) {
    if (snapshot.scriptOutputLimitSignal) {
      return {
        shouldPause: true,
        boundaryPaused: true,
        code: "GENERATION_LIMIT_SIGNAL",
        riskReason: "script-output-limit",
        message: "检测到纯脚本/沙盒产物输出，按生图触顶处理，停止当前帖子"
      };
    }
    if (snapshot.pyScriptFallbackSignal) {
      return {
        shouldPause: true,
        boundaryPaused: true,
        code: "GENERATION_LIMIT_SIGNAL",
        riskReason: "py-script-fallback",
        message: "检测到 GPT 使用 PY 代码兜底拼接垃圾图，停止当前帖子，疑似撞到生图上限"
      };
    }
    if (snapshot.limitSignal) {
      return {
        shouldPause: true,
        boundaryPaused: true,
        code: "GENERATION_LIMIT_SIGNAL",
        riskReason: "retry-or-limit-signal",
        message: "检测到 GPT 重试或额度限制信号，停止当前帖子，等待下一个时间点"
      };
    }
    if (snapshot.scriptOutput) {
      return {
        shouldPause: true,
        boundaryPaused: true,
        code: "SCRIPT_GENERATED_OUTPUT",
        riskReason: "script-output",
        message: "检测到代码解释器或脚本输出，停止当前帖子，不把脚本拼图当作正常生图"
      };
    }
    return {
      shouldPause: false,
      boundaryPaused: false,
      code: "",
      riskReason: "",
      message: ""
    };
  }

  function shouldAutoClearComposerBoundary(options = {}) {
    const mode = String(options.mode || "").trim().toLowerCase();
    const automatic = options.autoRun === true
      || options.continuousAutoStart === true
      || ["automatic", "single", "scheduled"].includes(mode);
    if (!automatic || options.continuousAutoStart === false) return false;
    const code = String(options.errorCode || "").trim();
    const detail = String(options.errorDetail || "");
    return [
      "COMPOSER_ATTACHMENT_CONFLICT",
      "COMPOSER_ATTACHMENTS_PENDING",
      "COMPOSER_DRAFT_PENDING",
      "COMPOSER_DRAFT_NOT_SET"
    ].includes(code)
      || /输入框需要先清理未发送内容|输入框仍有未发送附件|输入框仍有未发送文字|未发送附件|未发送文字/.test(detail);
  }

  // A workflow boundary can be stale after a renderer restart or a short
  // bridge failure even when the composer itself is already safe. Automatic
  // recovery may release this local latch only for a submitted checkpoint;
  // real quota/generation-limit decisions stay outside this helper.
  function shouldAutoResumeWorkflowBoundary(options = {}) {
    const mode = String(options.mode || "").trim().toLowerCase();
    const automatic = options.autoRun === true
      || options.continuousAutoStart === true
      || ["automatic", "single", "scheduled"].includes(mode);
    if (!automatic || options.continuousAutoStart === false) return false;
    if (options.autoRecovery !== true || options.userHold === true || options.generating === true) return false;
    const code = String(options.errorCode || "").trim();
    const detail = String(options.errorDetail || "");
    return [
      "PLAN_PARSE_FAILED",
      "PLAN_NOT_READY",
      "PLAN_NOT_COMPLETE",
      "WEB_RESPONSE_IN_FLIGHT",
      "IMAGE_RECOVERY_BOUNDARY_MISSING",
      "IMAGE_DRAFT_REJECTED",
      "COPY_REQUIRED"
    ].includes(code)
      || /没有返回可确认的迁移计划|迁移计划正文尚未稳定结束|网页检查点|当前作品已生成但自动归档未完成|文案请求环节/.test(detail);
  }

  function completedPlannedImageCount(options = {}) {
    return clampExpectedImageCount(Math.max(
      0,
      Number(options.plannedImageCount || 0),
      Number(options.downloadedImageCount || 0)
    ));
  }

  function resolveRecoveredPlannedImageCount(options = {}) {
    return clampExpectedImageCount(Math.max(
      parsePlannedImageCount(options.planText || ""),
      Number(options.checkpointCount || 0),
      Number(options.taskExpectedCount || 0),
      Number(options.recoveredImageCount || 0)
    ));
  }

  function lastAssistantIndexAfterPrompt(roles = [], promptIndex = -1) {
    let assistantIndex = -1;
    for (let index = Math.max(-1, Number(promptIndex || 0)) + 1; index < roles.length; index += 1) {
      const role = String(roles[index] || "").toLowerCase();
      if (role === "user") break;
      if (role === "assistant") assistantIndex = index;
    }
    return assistantIndex;
  }

  function isPostImageRecoveryStage(stage = "") {
    return /下载图片|生成小红书文案|恢复小红书文案|纠正文案|保存小红书文案|请求小红书文案|文案已生成|打包作品|clipboard|剪贴板/i.test(String(stage || ""));
  }

  function shouldBypassImageRecovery(options = {}) {
    const liveConversationStage = String(options.liveConversationStage || "").trim();
    const expectedImageCount = Math.max(
      0,
      Number(options.expectedImageCount || options.plannedImageCount || 0)
    );
    const imageEvidenceCount = Math.max(
      0,
      Number(options.imageEvidenceCount || 0),
      Number(options.generatedImageCount || 0),
      Number(options.downloadedImageCount || 0),
      Array.isArray(options.imageUrls) ? options.imageUrls.length : 0
    );
    // A copy request is only a workflow boundary after the same material's
    // image batch has been observed.  The old rule trusted the DOM stage
    // alone; a stale/virtualized conversation could therefore skip wait-images
    // with zero image evidence and later look like a completed 7/10 or 0/10
    // production.  Keep the bypass conservative: if a plan count is known,
    // the observed evidence must meet it.
    const hasImageEvidence = imageEvidenceCount > 0
      && (expectedImageCount === 0 || imageEvidenceCount >= expectedImageCount);
    const evidenceMissing = { bypass: false, reason: "image-evidence-missing" };
    if (["waiting-copy", "completed-copy-pending-package"].includes(liveConversationStage)) {
      return hasImageEvidence
        ? { bypass: true, reason: "live-copy-boundary" }
        : evidenceMissing;
    }
    const hasCopyBoundary = Boolean(
      String(options.copyText || "").trim()
      || String(options.copyTextPath || "").trim()
      || String(options.packagePath || "").trim()
      || Number(options.downloadedImageCount || 0) > 0
    );
    if (hasCopyBoundary) {
      return hasImageEvidence
        ? { bypass: true, reason: "copy-or-archive-boundary" }
        : evidenceMissing;
    }
    const retryStage = String(options.retryStage || "").trim();
    if (Boolean(options.textSubmitted) && isPostImageRecoveryStage(retryStage)) {
      return hasImageEvidence
        ? { bypass: true, reason: "post-image-recovery-stage" }
        : evidenceMissing;
    }
    return { bypass: false, reason: "" };
  }

  // A stale wait-images checkpoint must never be allowed to send a recovery
  // prompt after the same material has already entered the copy boundary.
  // This is intentionally separate from shouldBypassImageRecovery: bypassing
  // the image wait requires image evidence, while blocking a new generation
  // request is safe even when the page is still hydrating that evidence.
  function shouldBlockImageRecoveryAfterCopyBoundary(options = {}) {
    const stage = String(options.liveConversationStage || options.stage || "").trim();
    const copyText = String(options.copyText || "").trim();
    const hasCopyBoundary = Boolean(
      options.hasCopy === true
      || options.textSubmitted === true
      || copyText.length >= Math.max(1, Number(options.minimumCopyLength || 300))
      || String(options.copyTextPath || "").trim()
      || String(options.packagePath || "").trim()
    );
    const copyStage = [
      "waiting-copy",
      "completed-copy-pending-package",
      "completed",
      "archived"
    ].includes(stage);
    if (!hasCopyBoundary && !copyStage) {
      return { blocked: false, reason: "copy-boundary-not-observed", stage };
    }
    const identityKnown = options.materialIdentityRequired !== true
      || options.materialIdentityMatched === true;
    if (!identityKnown) {
      return {
        blocked: true,
        safeToAdopt: false,
        reason: "copy-boundary-material-mismatch",
        stage
      };
    }
    return {
      blocked: true,
      safeToAdopt: Boolean(copyText),
      reason: copyText ? "copy-boundary-observed" : "copy-boundary-awaiting-copy-evidence",
      stage
    };
  }

  function shouldReenterConfirmAtPlanBoundary(options = {}) {
    if (String(options.liveConversationStage || "").trim() !== "plan-ready") return false;
    if (options.generating === true || options.responseInFlight === true) return false;
    if (options.imageSubmitted !== true) return false;
    if (String(options.confirmTurnKey || "").trim()) return false;
    if (options.textSubmitted === true) return false;
    if (String(options.copyText || options.copyTextPath || options.packagePath || "").trim()) return false;
    if (Number(options.downloadedImageCount || 0) > 0) return false;
    const baselineCount = Math.max(
      0,
      Number(options.beforeImagesCount || 0),
      Array.isArray(options.beforeImageAssistantKeys) ? options.beforeImageAssistantKeys.length : 0,
      Array.isArray(options.generatedBaselineUrls) ? options.generatedBaselineUrls.length : 0
    );
    const currentImageEvidence = Math.max(
      0,
      Number(options.generatedImageActualCount || 0),
      Array.isArray(options.generatedImageUrls) ? options.generatedImageUrls.length : 0,
      Number(options.liveImageEvidenceCount || 0),
      Array.isArray(options.liveImageUrls) ? options.liveImageUrls.length : 0
    );
    return baselineCount === 0 && currentImageEvidence === 0;
  }

  // A renderer reload may still classify the visible conversation as the
  // plan-ready boundary while the durable checkpoint already records that
  // this exact task sent the confirmation. In that case the checkpoint is
  // stronger than the lazy DOM snapshot: clearing the marker would send a
  // duplicate "1" and consume another image-generation turn.
  function shouldReconcilePlanConfirmationBoundary(options = {}) {
    if (String(options.liveConversationStage || "").trim() !== "plan-ready") return false;
    if (options.generating === true || options.responseInFlight === true) return false;
    if (String(options.confirmTurnKey || "").trim()) return false;
    if (options.recoveryBoundaryConfirmed === true) return false;
    // A lazy/virtualized DOM can temporarily expose the old plan after copy or
    // archive has already completed. Durable post-image evidence is monotonic:
    // it must never be erased merely because the visible page looks older.
    const durableStage = String(options.durableStage || options.checkpointStage || "").trim();
    if (options.textSubmitted === true
      || String(options.copyText || options.copyTextPath || options.packagePath || "").trim()
      || Number(options.downloadedImageCount || 0) > 0
      || ["copy-requested", "copy-ready", "downloaded", "packaged", "archived", "completed"].includes(durableStage)) {
      return false;
    }
    if (options.imageSubmitted !== true
      && Number(options.generatedImageActualCount || 0) <= 0
      && !(Array.isArray(options.generatedImageUrls) && options.generatedImageUrls.length)) {
      return false;
    }
    return true;
  }

  function shouldAdoptPlanReadyBoundary(options = {}) {
    if (options.workflowPlanSubmitted !== true || options.workflowPlanDone === true) return false;
    if (String(options.liveConversationStage || "").trim() !== "plan-ready") return false;
    if (options.generating === true || options.responseInFlight === true) return false;
    if (options.hasCopy === true || String(options.copyText || "").trim()) return false;
    const imageEvidence = Math.max(
      0,
      Number(options.liveImageEvidenceCount || 0),
      Number(options.generatedImageActualCount || 0),
      Array.isArray(options.liveImageUrls) ? options.liveImageUrls.length : 0,
      Array.isArray(options.generatedImageUrls) ? options.generatedImageUrls.length : 0
    );
    if (imageEvidence > 0) return false;
    if (!String(options.materialText || "").trim()) return false;
    return parsePlannedImageCount(options.planText || "") > 0;
  }

  // A long reused conversation can expose an older archived/post-image DOM
  // snapshot while a new task is still waiting in the composer.  Only adopt a
  // post-plan workflow marker when the live material boundary belongs to the
  // current task and carries a real plan count.  The plan-ready boundary is
  // handled separately by shouldAdoptPlanReadyBoundary(), which also requires
  // the current task's planSubmitted marker.
  function shouldAdoptCurrentMaterialWorkflowBoundary(options = {}) {
    if (options.forceFreshWorkflow === true || options.materialMatched !== true) return false;
    const stage = String(options.liveBoundaryStage || "").trim();
    if (!["waiting-images", "images-ready", "waiting-copy", "completed-copy-pending-package"].includes(stage)) {
      return false;
    }
    const plannedImageCount = Math.max(
      0,
      Number(options.boundaryExpectedImageCount || 0),
      parsePlannedImageCount(options.boundaryPlanText || "")
    );
    return plannedImageCount > 0;
  }

  function shouldAdoptCompletedCopyBoundary(options = {}) {
    const stage = String(options.boundaryStage || "").trim();
    if (!["images-ready", "waiting-copy"].includes(stage)) return false;
    if (options.generating === true || options.responseInFlight === true) return false;
    if (options.latestAssistantAfterImage !== true || options.latestAssistantHasCopy !== true) return false;
    const imageCount = Math.max(
      0,
      Number(options.imageEvidenceCount || 0),
      Number(options.generatedImageCount || 0),
      Array.isArray(options.imageUrls) ? options.imageUrls.length : 0
    );
    const expectedImageCount = Math.max(0, Number(options.expectedImageCount || 0));
    return imageCount > 0 && (expectedImageCount === 0 || imageCount >= expectedImageCount);
  }

  function resolveDurableWorkflowStep(options = {}) {
    const order = [
      "session-init",
      "template-learning",
      "session-ready",
      "material-uploaded",
      "plan-ready",
      "confirm-sent",
      "images-generating",
      "images-ready",
      "copy-requested",
      "copy-ready",
      "downloaded",
      "packaged",
      "archived"
    ];
    const rank = new Map(order.map((step, index) => [step, index]));
    const candidates = [String(options.currentStep || "").trim()].filter((step) => rank.has(step));
    const pageStage = String(options.pageStage || options.liveConversationStage || "").trim();
    const pageStep = ({
      archived: "archived",
      completed: "archived",
      "completed-copy-pending-package": "copy-ready",
      "waiting-copy": "copy-requested",
      "images-ready": "images-ready",
      "waiting-images": "images-generating",
      "plan-ready": "plan-ready",
      "waiting-plan": "material-uploaded"
    })[pageStage];
    if (pageStep) candidates.push(pageStep);
    if (options.planSubmitted === true) candidates.push("material-uploaded");
    if (options.planDone === true || Number(options.plannedImageCount || 0) > 0) candidates.push("plan-ready");
    if (options.imageSubmitted === true || String(options.confirmTurnKey || "").trim()) candidates.push("confirm-sent");
    const imageCount = Math.max(
      Number(options.generatedImageActualCount || 0),
      Array.isArray(options.generatedImageUrls) ? options.generatedImageUrls.length : 0
    );
    const expected = Math.max(0, Number(options.plannedImageCount || options.expectedImageCount || 0));
    if (imageCount > 0) candidates.push(expected > 0 && imageCount >= expected ? "images-ready" : "images-generating");
    if (options.textSubmitted === true) candidates.push("copy-requested");
    if (String(options.copyText || options.copyTextPath || "").trim()) candidates.push("copy-ready");
    if (Number(options.downloadedImageCount || 0) > 0) candidates.push("downloaded");
    if (String(options.packagePath || "").trim()) candidates.push("packaged");
    if (options.archived === true || options.usageUpdated === true) candidates.push("archived");
    return candidates.sort((left, right) => rank.get(right) - rank.get(left))[0] || "session-init";
  }

  return {
    parsePlannedImageCount,
    workflowStepExecutionTimeoutMs,
    shouldTrustCompletedPlanCheckpoint,
    requiresPlannedImageCount,
    isConfirmUserTurnText,
    clampExpectedImageCount,
    completedPlannedImageCount,
    resolveRecoveredPlannedImageCount,
    lastAssistantIndexAfterPrompt,
    isPostImageRecoveryStage,
    shouldBypassImageRecovery,
    shouldBlockImageRecoveryAfterCopyBoundary,
    shouldReenterConfirmAtPlanBoundary,
    shouldReconcilePlanConfirmationBoundary,
    shouldAdoptPlanReadyBoundary,
    shouldAdoptCurrentMaterialWorkflowBoundary,
    shouldAdoptCompletedCopyBoundary,
    resolveDurableWorkflowStep,
    isArchivedAutomationBoundary,
    completedHistoryMatchesAutomationBoundary,
    patrolActionLedgerKey,
    firstBatchChoice,
    validatePlanPageCap,
    resolveEntryInstruction,
    shouldRecoverSilentAssistant,
    shouldRecoverSilentImageGeneration,
    shouldStopStalledSilentGeneration,
    shouldStopStalledNativeImageGeneration,
    shouldStopStalledEmptyImageGeneration,
    nextContinuousImageIdleSince,
    detectRejectedImageDraftLoop,
    shouldRetryThreadError,
    detectRepetitiveAssistantLoop,
    classifyPatrolConversationCandidate,
    generatedImageIdentity,
    uniqueGeneratedImageUrls,
    preferCurrentBatchImageUrls,
    newGeneratedImageUrls,
    limitGeneratedImageUrls,
    resolveDurableImageBoundary,
    COPY_FORMAT_HEADER,
    COPY_MARKERS,
    DOUYIN_FORBIDDEN_TERMS,
    parsePlatformCopy,
    countCopyHashtags,
    detectDouyinForbiddenPhrases,
    validatePlatformCopy,
    formatPlatformCopy,
    isCompleteCopy,
    isLikelyPublishCopy,
    detectCopyMetaNarration,
    defaultKeywordPattern,
    keywordPatternMatches,
    completionKeywordDetected,
    classifyAttachmentUploadResult,
    classifyPlanDetectionResult,
    decidePlanRecovery,
    decideCopyRecovery,
    decidePartialImageRecovery,
    classifyExhaustedImageRecovery,
    isRetryableNoImageResponseEvidence,
    mergePartialImageRecovery,
    partialImageRecoverySignature,
    effectiveGeneratedImageCount,
    imageUrlsFromLatestConfirmedBatch,
    isFreshAutomationTurnKey,
    isActiveGenerationControl,
    detectPyScriptFallbackSignal,
    detectScriptOutputLimitSignal,
    detectLowImageLimit,
    classifyAutomationBoundaryPause,
    shouldAutoClearComposerBoundary,
    shouldAutoResumeWorkflowBoundary
  };
});
