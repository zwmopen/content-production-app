(function momentsPublisherPanel(root) {
  const workspace = root.MaterialWorkspace;
  if (!workspace) return;

  const MOMENTS_SELECTION_POLICIES = new Set([
    "anniversary",
    "historical-day",
    "last-year-day",
    "last-year-month",
    "current-year",
    "random",
    "all"
  ]);

  const state = {
    items: [],
    selectedId: "",
    loading: false,
    preparing: false,
    config: { libraryRoot: "D:\\朋友圈weflow", autoOpenWeChat: true, collectionScheduleEnabled: false, collectionScheduleDay: 1, collectionScheduleTime: "10:20", collectionScheduleCatchUpDays: 7, triggerMode: "manual", scheduleWindowStart: "10:00", scheduleWindowEnd: "12:00", scheduleTimes: ["10:20"], dailyAutoLimit: 1, selectionRule: "anniversary" },
    summary: {},
    scheduler: { enabled: false, triggerMode: "manual", scheduleWindowStart: "10:00", scheduleWindowEnd: "12:00", scheduleTimes: ["10:20"], dailyAutoLimit: 1, dailyAutoCount: 0, selectionRule: "anniversary", lockedToday: false, collection: { enabled: false, catchUpDays: 7 } },
    publisherState: { date: "", status: "NO_RECORD", record: null },
    filters: { category: "all", tag: "all", season: "all", place: "all", activity: "all", usage: "all", policy: "anniversary", query: "" }
  };
  let libraryLoadPromise = null;

  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
    let data = null;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok || data?.ok === false) {
      const detail = data?.error || data?.message || `${response.status} ${response.statusText}`;
      const error = new Error(detail);
      error.payload = data;
      throw error;
    }
    return data;
  }

  function selectedItem() {
    return state.items.find((item) => item.workId === state.selectedId) || null;
  }

  function visibleItems() {
    return workspace.filterMomentAssets(state.items, state.filters);
  }

  function normalizeSelectionPolicy(policy) {
    const value = String(policy || "anniversary");
    return MOMENTS_SELECTION_POLICIES.has(value) ? value : "anniversary";
  }

  function formatDate(item) {
    const parts = workspace.momentDateParts(item);
    if (!parts.year || !parts.month || !parts.day) return "日期未知";
    return `${parts.year}.${String(parts.month).padStart(2, "0")}.${String(parts.day).padStart(2, "0")}`;
  }

  function setStatus(text, tone = "") {
    const target = $("#momentsLibraryStatus");
    if (!target) return;
    target.textContent = text;
    target.dataset.tone = tone;
  }

  function formatSchedulerAt(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
    if (!match) return "未安排";
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    return match.slice(1, 4).join("-") === today ? `今天 ${match[4]}` : `${match[1]}-${match[2]}-${match[3]} ${match[4]}`;
  }

  function todayRecord() {
    return state.publisherState?.record && typeof state.publisherState.record === "object"
      ? state.publisherState.record
      : null;
  }

  function dayIsLocked() {
    // A live PREPARING record means the same WeChat composer is still being
    // filled.  Prepared/confirmed records are history and must not block a
    // deliberate manual additional preparation.
    return todayRecord()?.status === "PREPARING";
  }

  function dayLockMessage() {
    const record = todayRecord();
    if (!record) return "";
    const workId = record.work_id ? ` · ${record.work_id}` : "";
    if (record.status === "PREPARING") return `今天正在准备${workId} · 已锁定，不会换下一条`;
    if (record.status === "PREPARED_FOR_HUMAN_CONFIRM") return `已有一条待人工发表${workId} · 处理微信窗口后仍可手动追加`;
    if (record.status === "CONFIRMED_PUBLISHED") return `已有一条已确认发布${workId} · 手动入口仍可追加下一条`;
    return "";
  }

  function populateFilters() {
    const categorySelect = $("#momentsCategoryFilter");
    const tagSelect = $("#momentsTagFilter");
    const seasonSelect = $("#momentsSeasonFilter");
    const placeSelect = $("#momentsPlaceFilter");
    const activitySelect = $("#momentsActivityFilter");
    const usageSelect = $("#momentsUsageFilter");
    if (!categorySelect || !tagSelect) return;
    const categories = [...new Set(state.items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const tags = [...new Set(state.items.flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const seasons = [...new Set(state.items.map((item) => item.season).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const places = [...new Set(state.items.flatMap((item) => item.places || []).concat(state.items.map((item) => item.place).filter(Boolean)))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const activities = [...new Set(state.items.flatMap((item) => item.activities || []).concat(state.items.map((item) => item.activityType).filter(Boolean)))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const usageCounts = [...new Set([0, 1, 2, 3, ...state.items.map((item) => Number(item.usageCount || 0))])]
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    categorySelect.innerHTML = `<option value="all">全部分类 · ${categories.length}</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
    tagSelect.innerHTML = `<option value="all">全部标签 · ${tags.length}</option>${tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join("")}`;
    if (seasonSelect) seasonSelect.innerHTML = `<option value="all">全部季节</option>${seasons.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (placeSelect) placeSelect.innerHTML = `<option value="all">全部地点</option>${places.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (activitySelect) activitySelect.innerHTML = `<option value="all">全部活动</option>${activities.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (usageSelect) usageSelect.innerHTML = `<option value="all">全部使用次数</option>${usageCounts.map((value) => `<option value="${value}">${value ? `使用 ${value} 次` : "未使用"}</option>`).join("")}`;
    categorySelect.value = state.filters.category;
    tagSelect.value = state.filters.tag;
    if (seasonSelect) seasonSelect.value = state.filters.season;
    if (placeSelect) placeSelect.value = state.filters.place;
    if (activitySelect) activitySelect.value = state.filters.activity;
    if (usageSelect) usageSelect.value = state.filters.usage;
    const policySelect = $("#momentsPolicyFilter");
    if (policySelect) policySelect.value = state.filters.policy;
  }

  function renderCards() {
    const grid = $("#momentsAssetGrid");
    const summary = $("#momentsResultsSummary");
    const count = $("#momentsLibraryCount");
    if (!grid) return;
    const items = visibleItems();
    if (!items.some((item) => item.workId === state.selectedId)) {
      const firstReady = items.find((item) => item.selectionEnabled) || items[0];
      state.selectedId = firstReady?.workId || "";
    }
    if (summary) summary.textContent = `${items.length} 条候选 · ${state.summary.total || state.items.length} 条素材 · ${state.summary.totalImages || 0} 张图 · 已按“${policyLabel(state.filters.policy)}”筛选${state.filters.query ? ` · 搜索「${state.filters.query}」` : ""}`;
    if (count) count.textContent = `${items.length} / ${state.items.length} 条`;
    if (!items.length) {
      grid.innerHTML = `<div class="moments-no-results"><strong>当前筛选没有可准备作品</strong><p>${escapeHtml(policyEmptyHint(state.filters.policy))}</p></div>`;
      renderPreview(null);
      return;
    }
    grid.innerHTML = items.map((item) => {
      const preview = item.coverUrl
        ? `<img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.name)}封面" loading="lazy" />`
        : `<span class="moments-cover-placeholder">无封面</span>`;
      const disabled = item.selectionEnabled ? "" : " is-disabled";
      const selected = item.workId === state.selectedId ? " is-selected" : "";
      const status = item.selectionEnabled ? "待发布" : (item.selectionBlockReason || item.status);
      return `<button class="moments-asset-card${selected}${disabled}" type="button" data-moments-work-id="${escapeHtml(item.workId)}" title="${formatDate(item)} · ${item.imageCount} 张图 · 状态 ${escapeHtml(status)}">
        <span class="moments-card-cover">${preview}<em>${item.imageCount} 图</em></span>
        <span class="moments-card-body"><strong>${formatDate(item)}</strong><small>${escapeHtml(item.sourceLabel || "历史采集")} · ${escapeHtml(item.place || "地点待补")}</small><span class="moments-card-tags">${[item.season, item.activityType, ...(item.tags || [])].filter(Boolean).slice(0, 3).map((tag) => `<i>${escapeHtml(tag)}</i>`).join("") || "未标注标签"}</span></span>
        <span class="moments-card-status">${escapeHtml(status)}</span>
      </button>`;
    }).join("");
    grid.querySelectorAll("[data-moments-work-id]").forEach((card) => card.addEventListener("click", () => {
      state.selectedId = card.dataset.momentsWorkId || "";
      renderCards();
      renderPreview(selectedItem());
      if (window.matchMedia?.("(max-width: 980px)")?.matches) $("#momentsPreviewCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    renderPreview(selectedItem());
  }

  function policyLabel(policy) {
    return ({
      "current-year": "今年素材",
      "last-year-day": "去年今天",
      "historical-day": "往年今天（随机一年）",
      "last-year-month": "去年本月",
      anniversary: "智能回退：去年今天 → 去年本月随机 → 历史同月随机 → 今年未使用素材",
      random: "随机挑选今年素材",
      all: "全部历史"
    })[policy] || "当前策略";
  }

  function policyEmptyHint(policy) {
    const now = new Date();
    const lastYear = now.getFullYear() - 1;
    const month = now.getMonth() + 1;
    const day = now.getDate();
    if (policy === "last-year-day") {
      return `“去年今天”查找的是 ${lastYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}，当前素材库没有可用作品；这不是今天被触发成功。可改用“往年今天”或“去年本月”。`;
    }
    if (policy === "historical-day") {
      return `“往年今天”会在 ${month} 月 ${day} 日的历史年份中随机选一年；当前素材库没有可用作品。`;
    }
    if (policy === "last-year-month") {
      return `“去年本月”查找的是 ${lastYear} 年 ${month} 月，当前素材库没有可用作品；可以切换“智能回退”或“全部历史”。`;
    }
    if (policy === "anniversary") {
      return "“智能回退”会先找去年今天，再从去年本月随机，仍没有时从历史同月随机，历史也用完才使用今年未发布素材；当前没有符合其他筛选条件的可用作品。";
    }
    if (policy === "current-year") return "今年素材中没有符合当前其他筛选条件的可用作品。";
    if (policy === "all") return "全部历史中没有符合当前筛选条件的可用作品。";
    return `当前“${policyLabel(policy)}”没有符合条件的可用作品。`;
  }

  function renderPreview(item) {
    const empty = $("#momentsEmptyPreview");
    const card = $("#momentsPreviewCard");
    if (!empty || !card) return;
    if (!item) {
      empty.hidden = false;
      card.hidden = true;
      return;
    }
    const preview = workspace.buildMomentPreview(item);
    empty.hidden = true;
    card.hidden = false;
    $("#momentsPreviewTitle").textContent = "朋友圈内容预览";
    $("#momentsPreviewMeta").textContent = `${formatDate(item)} · ${preview.sourceLabel || "历史采集"} · ${preview.place || "地点待补"} · ${preview.imageCount} 张图 · ${preview.status}`;
    $("#momentsPreviewTags").innerHTML = preview.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") || `<span>未标注标签</span>`;
    $("#momentsPreviewGrid").innerHTML = preview.images.length
      ? preview.images.map((image) => `<figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name)}" loading="lazy" /><figcaption>${escapeHtml(image.name)}</figcaption></figure>`).join("")
      : `<div class="moments-preview-no-images">当前作品没有可预览图片</div>`;
    $("#momentsPreviewText").textContent = preview.text || "（没有读取到 content.txt）";
    const sendButton = $("#momentsPreviewSendBtn");
    const openButton = $("#momentsOpenFolderBtn");
    const prepareState = $("#momentsPrepareState");
    const canRetryFailed = preview.status === "FAILED";
    const locked = dayIsLocked();
    if (sendButton) {
      sendButton.disabled = state.preparing || locked || (!preview.selectionEnabled && !canRetryFailed);
      sendButton.textContent = state.preparing
        ? "正在准备…"
        : locked
            ? "正在准备中"
        : preview.selectionEnabled
          ? "发送到微信待发布"
          : canRetryFailed
            ? "手动重试该作品"
            : `不可发送 · ${preview.selectionBlockReason || preview.status}`;
    }
    if (openButton) openButton.disabled = !item.workId;
    if (prepareState) {
      prepareState.textContent = state.preparing
        ? "正在打开微信并填充…"
        : dayLockMessage() || (preview.selectionEnabled
          ? "等待人工确认"
          : canRetryFailed
            ? "上次失败 · 可手动重试"
            : `当前状态：${preview.selectionBlockReason || preview.status}`);
    }
  }

  function applyFacetFilter(field, value, label) {
    state.filters[field] = String(value || "all");
    // The date policy is an execution rule, while tags/categories are library
    // browsing facets.  Keeping the date-policy intersection made
    // valid tags look broken whenever that exact date had no post.
    if (state.filters.policy !== "all") {
      state.filters.policy = "all";
      populateFilters();
      setStatus(`已按${label}浏览全部历史；日期策略可单独选择`, "info");
    }
    renderCards();
  }

  async function prepareSelected({ notify = true } = {}) {
    const item = selectedItem();
    const canRetryFailed = item?.status === "FAILED";
    if (!item || dayIsLocked() || (!item.selectionEnabled && !canRetryFailed) || state.preparing) return;
    const request = {
      ...workspace.buildMomentPrepareRequest(item),
      selectionPolicy: state.filters.policy,
      source: "manual"
    };
    state.preparing = true;
    renderPreview(item);
    setStatus(`正在准备「${item.name}」…`, "busy");
    try {
      const result = await requestJson("/api/moments/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
      setStatus("已停在微信发表前，等待人工确认", "success");
      const prepareState = $("#momentsPrepareState");
      if (prepareState) prepareState.textContent = "已准备 · 请检查后手动发表";
      await loadLibrary({ preserveSelection: true });
      return { result, item, libraryRoot: result.libraryRoot || state.config.libraryRoot || "" };
    } catch (error) {
      const resultError = error.payload?.result?.error
        || error.payload?.result?.record?.error
        || error.payload?.result?.diagnostic
        || "";
      const diagnostic = error.payload?.diagnostic || error.payload?.stderr || "";
      const detail = diagnostic ? `\n\n错误输出：${String(diagnostic).trim().slice(-800)}` : "";
      const waitingForLogin = error.payload?.stage === "WAITING_FOR_HUMAN_LOGIN";
      const waitingForHumanConfirm = error.payload?.stage === "WAITING_FOR_HUMAN_CONFIRM"
        || error.payload?.code === "MOMENTS_HUMAN_CONFIRM_REQUIRED";
      const waitingBoundary = waitingForLogin || waitingForHumanConfirm;
      setStatus(
        waitingForLogin
          ? "微信等待人工登录；原作品保持不变"
          : waitingForHumanConfirm
            ? "已停在微信发表前；请人工确认"
            : "准备失败，已停止；没有自动换下一条",
        waitingBoundary ? "busy" : "danger"
      );
      const userMessage = `${waitingForHumanConfirm ? "已停在微信发表前，请检查后手动点击发表。" : resultError || error.message}${detail}`;
      error.userFacingMessage = userMessage;
      if (notify) window.alert(userMessage);
      await loadLibrary({ preserveSelection: true }).catch(() => {});
      if (!notify) throw error;
    } finally {
      state.preparing = false;
      renderCards();
    }
  }

  async function preflightSelected() {
    const item = selectedItem();
    const button = $("#momentsPreflightBtn");
    if (!item?.workId || !button || state.preparing) return;
    button.disabled = true;
    setStatus(`正在检查「${item.name}」…`, "busy");
    try {
      const result = await requestJson("/api/moments/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId: item.workId, selectionPolicy: state.filters.policy })
      });
      const plan = result.result || {};
      setStatus(`发送前自检通过 · ${plan.media_count ?? item.imageCount} 张图 · 文案 ${plan.text_length ?? item.text.length} 字`, "success");
      const prepareState = $("#momentsPrepareState");
      if (prepareState) prepareState.textContent = "自检通过 · 可以发送到微信待发布";
    } catch (error) {
      const detail = error.payload?.result?.error || error.payload?.diagnostic || error.message;
      setStatus(`发送前自检未通过 · ${String(detail).trim().slice(-220)}`, "danger");
      const prepareState = $("#momentsPrepareState");
      if (prepareState) prepareState.textContent = "自检未通过 · 未打开微信、未写入状态";
    } finally {
      button.disabled = false;
    }
  }

  async function openSelectedFolder() {
    const item = selectedItem();
    if (!item?.workId) return;
    try {
      await requestJson("/api/moments/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId: item.workId })
      });
    } catch (error) {
      window.alert(`素材目录没有打开：${error.message}`);
    }
  }

  async function loadLibrary({ preserveSelection = false } = {}) {
    if (state.loading) return libraryLoadPromise;
    state.loading = true;
    setStatus(`正在读取 ${state.config.libraryRoot}…`, "busy");
    libraryLoadPromise = (async () => {
      try {
        const result = await requestJson("/api/moments/library");
        state.items = (result.items || []).map(workspace.normalizeMomentAsset);
        state.summary = result.summary || {};
        state.config = { ...state.config, ...(result.settings || {}) };
        state.scheduler = result.scheduler || state.scheduler;
        state.publisherState = result.publisherState || { date: "", status: "NO_RECORD", record: null };
        if (!preserveSelection) {
          state.filters.policy = normalizeSelectionPolicy(state.scheduler.selectionRule);
        }
        const modeStatus = $("#momentsOpenModeStatus");
        if (modeStatus) modeStatus.textContent = state.config.autoOpenWeChat ? "自动打开微信" : "手动打开微信";
        const scheduleStatus = $("#momentsScheduleStatus");
        if (scheduleStatus) {
          const windowStart = state.scheduler.scheduleWindowStart || state.config.scheduleWindowStart;
          const windowEnd = state.scheduler.scheduleWindowEnd || state.config.scheduleWindowEnd;
          scheduleStatus.textContent = state.scheduler.enabled
            ? (windowStart && windowEnd
              ? `定时窗口：${windowStart}–${windowEnd} · 自动 ${state.scheduler.dailyAutoCount || 0}/${state.scheduler.dailyAutoLimit || state.config.dailyAutoLimit || 1}`
              : `定时：${(state.scheduler.scheduleTimes || []).join("、")} · 自动 ${state.scheduler.dailyAutoCount || 0}/${state.scheduler.dailyAutoLimit || state.config.dailyAutoLimit || 1}`)
            : "手动触发";
          scheduleStatus.title = state.scheduler.enabled
            ? `规则：${policyLabel(state.scheduler.selectionRule)}；每日自动最多准备 ${state.scheduler.dailyAutoLimit || state.config.dailyAutoLimit || 1} 条，手动仍可追加；不自动发表；点击切换模式`
            : "定时准备已关闭；点击切换模式";
        }
        const scheduleNext = $("#momentsScheduleNext");
        if (scheduleNext) {
          scheduleNext.textContent = state.scheduler.enabled
            ? (state.scheduler.windowActive ? "窗口内可立即触发" : `下次 ${formatSchedulerAt(state.scheduler.nextRunAt)}`)
            : "自动关闭";
          const lastRun = state.scheduler.lastRun;
          scheduleNext.title = lastRun
            ? `最近自动准备：${lastRun.ok ? "完成" : "失败"}${lastRun.workId ? ` · ${lastRun.workId}` : ""}${lastRun.error ? ` · ${String(lastRun.error).slice(-240)}` : ""}`
            : "还没有自动准备记录";
        }
        const collectionSchedule = $("#momentsCollectionScheduleStatus");
        const collection = state.scheduler.collection || {};
        if (collectionSchedule) {
          collectionSchedule.textContent = collection.enabled
            ? `月采：${collection.day} 日 ${collection.time}，错过后补 ${collection.catchUpDays || 7} 天`
            : "月采集关闭";
          collectionSchedule.title = collection.enabled
            ? `每月 ${collection.day} 号优先；失败后在接下来 ${collection.catchUpDays || 7} 天内补采；下次 ${formatSchedulerAt(collection.nextRunAt)}；继续写入 ${state.config.libraryRoot || "当前朋友圈素材库"}`
            : "每月自动采集已关闭；到技能中心朋友圈设置中开启";
        }
        populateFilters();
        if (!preserveSelection) state.selectedId = "";
        renderCards();
        setStatus(dayLockMessage() || `${result.summary?.ready || 0} 条可准备 · 共 ${result.summary?.total || 0} 条`, dayIsLocked() ? "busy" : "success");
      } catch (error) {
        state.items = [];
        renderCards();
        setStatus(`作品库读取失败：${error.message}`, "danger");
      }
    })();
    try {
      return await libraryLoadPromise;
    } finally {
      state.loading = false;
      libraryLoadPromise = null;
    }
  }

  function bind() {
    const view = $("#momentsView");
    if (!view || view.dataset.momentsBound === "true") return;
    view.dataset.momentsBound = "true";
    $("#momentsCategoryFilter")?.addEventListener("change", (event) => applyFacetFilter("category", event.target.value, "分类"));
    $("#momentsTagFilter")?.addEventListener("change", (event) => applyFacetFilter("tag", event.target.value, "标签"));
    $("#momentsSeasonFilter")?.addEventListener("change", (event) => applyFacetFilter("season", event.target.value, "季节"));
    $("#momentsPlaceFilter")?.addEventListener("change", (event) => applyFacetFilter("place", event.target.value, "地点"));
    $("#momentsActivityFilter")?.addEventListener("change", (event) => applyFacetFilter("activity", event.target.value, "活动"));
    $("#momentsUsageFilter")?.addEventListener("change", (event) => applyFacetFilter("usage", event.target.value, "使用次数"));
    $("#momentsPolicyFilter")?.addEventListener("change", (event) => { state.filters.policy = event.target.value; renderCards(); });
    $("#momentsSearchInput")?.addEventListener("input", (event) => applyFacetFilter("query", event.target.value, "搜索"));
    $("#momentsRefreshBtn")?.addEventListener("click", () => loadLibrary({ preserveSelection: true }));
    $("#momentsPreviewSendBtn")?.addEventListener("click", prepareSelected);
    $("#momentsPreflightBtn")?.addEventListener("click", preflightSelected);
    $("#momentsOpenFolderBtn")?.addEventListener("click", openSelectedFolder);
    loadLibrary();
  }

  function setSelectionPolicy(policy, options = {}) {
    if (options.resetManualFilters) {
      Object.assign(state.filters, {
        category: "all",
        tag: "all",
        season: "all",
        place: "all",
        activity: "all",
        usage: "all",
        query: ""
      });
    }
    state.filters.policy = normalizeSelectionPolicy(policy);
    populateFilters();
    renderCards();
    return state.filters.policy;
  }

  function stableSelectionIndex(items, policy) {
    if (!items.length || !["historical-day", "anniversary"].includes(policy)) return 0;
    const dayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    const seed = `${dayKey}:${policy}:${items.map((item) => item.workId).join("|")}`;
    let hash = 0;
    for (const character of seed) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return Math.abs(hash) % items.length;
  }

  function selectFirstReady() {
    const candidates = visibleItems().filter((candidate) => candidate.selectionEnabled || candidate.status === "FAILED");
    const item = candidates[stableSelectionIndex(candidates, state.filters.policy)] || null;
    state.selectedId = item?.workId || "";
    renderCards();
    if (!item && !dayIsLocked()) setStatus(policyEmptyHint(state.filters.policy), "warning");
    return item;
  }

  function getSelectionState() {
    return {
      policy: state.filters.policy,
      selectedId: state.selectedId,
      selectedItem: selectedItem(),
      visibleCount: visibleItems().length,
      todayLocked: dayIsLocked(),
      lockMessage: dayLockMessage(),
      emptyMessage: policyEmptyHint(state.filters.policy)
    };
  }

  const api = {
    filterMomentAssets: workspace.filterMomentAssets,
    buildMomentPreview: workspace.buildMomentPreview,
    loadLibrary,
    setSelectionPolicy,
    selectFirstReady,
    getSelectionState,
    prepareSelected,
    preflightSelected
  };
  root.MomentsPublisherPanel = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})(typeof document !== "undefined" && document.defaultView
  ? document.defaultView
  : (typeof self !== "undefined" ? self : window));
