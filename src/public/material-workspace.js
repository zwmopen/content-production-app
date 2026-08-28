(function materialWorkspaceModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MaterialWorkspace = api;
})(typeof document !== "undefined" && document.defaultView
  ? document.defaultView
  : (typeof self !== "undefined"
    ? self
    : (typeof window !== "undefined"
      ? window
      : (typeof globalThis !== "undefined" ? globalThis : this))), function createMaterialWorkspace() {
  // The standalone app owns one surface: material/template selection on the
  // left and GPT production on the right. Keep every unrelated legacy module
  // out of this shell so the dedicated app opens directly into production.
  const allowedTabs = new Set(["gptProductionTest"]);

  function resolveInitialTab(savedTab) {
    if (allowedTabs.has(savedTab)) return savedTab;
    // Migrate saved legacy module ids to the only dedicated-app entry. This
    // prevents an older localStorage value from reopening a hidden view.
    return "gptProductionTest";
  }

  function inferSelectionMode(materialPaths = []) {
    const paths = [...new Set((materialPaths || []).filter(Boolean))];
    return {
      mode: paths.length > 1 ? "batch" : "set",
      workCount: paths.length,
      label: paths.length ? `已选 ${paths.length} 个素材文件夹` : "未选择素材"
    };
  }

  function categoryCountLabel(category = {}) {
    return category.loaded === false && category.countKnown === false
      ? "未读取"
      : String(Number(category.count || 0));
  }

  function buildMaterialTree(categories, selectedId = "", expandedPaths = []) {
    const expanded = new Set(expandedPaths || []);
    return (categories || []).map((category) => ({
      name: category.name || "未命名素材库",
      path: category.path || "",
      count: Number(category.count || category.items?.length || 0),
      expanded: expanded.has(category.path),
      items: (category.items || []).map((item) => ({
        ...item,
        selected: item.id === selectedId,
        imageCount: Number(item.imageCount || 0)
      }))
    }));
  }

  function buildChatGptInstruction(item, category, template = "T04") {
    return [
      `请按 ${template || "T04"} 固定母版处理当前团建素材。`,
      `素材分类：${category?.name || "未分类"}`,
      `帖子文件夹：${item?.name || "未选择"}`,
      `本地文件夹：${item?.path || ""}`,
      `素材图片：${Number(item?.imageCount || 0)} 张`,
      "",
      "请先读取已发送的图片与文案，给出逐页出图计划；确认后再按现有网页脚本和本地工作包流程执行。"
    ].join("\n");
  }

  function normalizeMomentAsset(item = {}) {
    return {
      ...item,
      id: String(item.id || item.workId || ""),
      workId: String(item.workId || item.id || ""),
      name: String(item.name || item.workId || "未命名作品"),
      category: String(item.category || "未分类"),
      tags: [...new Set((Array.isArray(item.tags) ? item.tags : []).map((tag) => String(tag || "").trim()).filter(Boolean))],
      season: String(item.season || ""),
      place: String(item.place || ""),
      places: [...new Set((Array.isArray(item.places) ? item.places : item.place ? [item.place] : []).map((tag) => String(tag || "").trim()).filter(Boolean))],
      activityType: String(item.activityType || item.activity_type || "团建"),
      activities: [...new Set((Array.isArray(item.activities) ? item.activities : item.activityType ? [item.activityType] : []).map((tag) => String(tag || "").trim()).filter(Boolean))],
      usageCount: Math.max(0, Number(item.usageCount ?? item.usage_count ?? 0) || 0),
      sourceLabel: String(item.sourceLabel || "WeFlow历史采集"),
      publishedAt: String(item.publishedAt || item.published_at || ""),
      images: Array.isArray(item.images) ? item.images.slice(0, 9) : [],
      imageCount: Number(item.imageCount || item.images?.length || 0),
        text: String(item.text || ""),
        status: String(item.status || "QUEUED"),
        selectionEnabled: item.selectionEnabled !== false,
        mediaLimitExceeded: item.mediaLimitExceeded === true,
        maxMedia: Math.max(1, Number(item.maxMedia || 9) || 9),
        selectionBlockReason: String(item.selectionBlockReason || "")
    };
  }

  function momentDateParts(item = {}) {
    if (Number(item.year) && Number(item.month) && Number(item.day)) {
      return { year: Number(item.year), month: Number(item.month), day: Number(item.day) };
    }
    const date = new Date(item.publishedAt || item.published_at || "");
    if (!Number.isNaN(date.getTime())) return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
    return { year: Number(item.year || 0), month: Number(item.month || 0), day: Number(item.day || 0) };
  }

  function filterMomentAssets(items = [], filters = {}) {
    const category = String(filters.category || "all");
    const tag = String(filters.tag || "all");
    const season = String(filters.season || "all");
    const place = String(filters.place || "all");
    const activity = String(filters.activity || "all");
    const usage = String(filters.usage || "all");
    const query = String(filters.query || "").trim().toLowerCase();
    const policy = String(filters.policy || "current-year");
    const now = filters.today ? new Date(`${filters.today}T12:00:00`) : new Date();
    const normalizedItems = (items || []).map(normalizeMomentAsset);
    const hasLastYearAnniversary = normalizedItems.some((item) => {
      const parts = momentDateParts(item);
      return parts.year === now.getFullYear() - 1
        && parts.month === now.getMonth() + 1
        && parts.day === now.getDate();
    });
    const hasLastYearMonth = normalizedItems.some((item) => {
      const parts = momentDateParts(item);
      return parts.year === now.getFullYear() - 1
        && parts.month === now.getMonth() + 1;
    });
    const hasCurrentYear = normalizedItems.some((item) => {
      const parts = momentDateParts(item);
      return parts.year === now.getFullYear();
    });
    const candidates = normalizedItems.filter((item) => {
      const parts = momentDateParts(item);
      const categoryMatch = category === "all" || item.category === category;
      const tagMatch = tag === "all" || item.tags.includes(tag);
      const seasonMatch = season === "all" || item.season === season;
      const placeMatch = place === "all" || item.places.includes(place) || item.place === place;
      const activityMatch = activity === "all" || item.activities.includes(activity) || item.activityType === activity;
      const usageMatch = usage === "all" || (usage === "0" ? item.usageCount === 0 : item.usageCount === Number(usage));
      const queryMatch = !query || [item.name, item.workId, item.text, item.category, item.season, item.place, item.activityType, ...item.places, ...item.activities, ...item.tags]
        .join(" ").toLowerCase().includes(query);
    const policyMatch = policy === "all"
        || (policy === "current-year" && parts.year === now.getFullYear())
        || (policy === "last-year-day" && parts.year === now.getFullYear() - 1
          && parts.month === now.getMonth() + 1 && parts.day === now.getDate())
        || (policy === "historical-day" && parts.year < now.getFullYear()
          && parts.month === now.getMonth() + 1 && parts.day === now.getDate())
        || (policy === "last-year-month" && parts.year === now.getFullYear() - 1
          && parts.month === now.getMonth() + 1)
        || (policy === "anniversary" && (
          hasLastYearAnniversary
            ? parts.year === now.getFullYear() - 1 && parts.month === now.getMonth() + 1 && parts.day === now.getDate()
            : hasLastYearMonth
              ? parts.year === now.getFullYear() - 1 && parts.month === now.getMonth() + 1
              : normalizedItems.some((candidate) => {
                const candidateParts = momentDateParts(candidate);
                return candidateParts.year < now.getFullYear()
                  && candidateParts.month === now.getMonth() + 1;
              })
                ? parts.year < now.getFullYear() && parts.month === now.getMonth() + 1
                : hasCurrentYear && parts.year === now.getFullYear()
        ));
      return categoryMatch && tagMatch && seasonMatch && placeMatch && activityMatch && usageMatch && queryMatch && policyMatch;
    });
    return candidates.sort((left, right) => String(right.publishedAt || right.workId).localeCompare(String(left.publishedAt || left.workId)));
  }

  function buildMomentPreview(item = {}) {
    const normalized = normalizeMomentAsset(item);
    return {
      workId: normalized.workId,
      name: normalized.name,
      category: normalized.category,
      tags: normalized.tags,
      season: normalized.season,
      place: normalized.place,
      activityType: normalized.activityType,
      usageCount: normalized.usageCount,
      sourceLabel: normalized.sourceLabel,
      text: normalized.text,
      images: normalized.images.slice(0, 9),
      imageCount: normalized.imageCount,
        publishedAt: normalized.publishedAt || "",
        status: normalized.status,
        selectionEnabled: normalized.selectionEnabled,
        mediaLimitExceeded: normalized.mediaLimitExceeded,
        maxMedia: normalized.maxMedia,
        selectionBlockReason: normalized.selectionBlockReason
    };
  }

  function buildMomentPrepareRequest(item = {}) {
    const normalized = normalizeMomentAsset(item);
    return {
      workId: normalized.workId,
      name: normalized.name,
      imageCount: normalized.imageCount,
      textLength: normalized.text.length,
      humanConfirmationRequired: true,
      finalPublishButton: "never-clicked-by-v1",
      retryFailed: normalized.status === "FAILED"
    };
  }

  function installShell() {
    // Keep legacy markup available to existing render helpers and tests, but
    // expose only the dedicated content-production entries in the live sidebar.
    document.querySelectorAll('.rail-tab[data-tab]').forEach((tab) => {
      if (!allowedTabs.has(tab.dataset.tab)) tab.remove();
    });
    const productionTab = document.querySelector('[data-tab="gptProductionTest"]');
    if (productionTab) {
      productionTab.hidden = false;
      productionTab.classList.add("active");
      productionTab.setAttribute("aria-current", "page");
    }
    document.querySelectorAll(".view").forEach((view) => {
      const tabId = view.id.replace(/View$/, "");
      const active = allowedTabs.has(tabId) && view.id === "gptProductionTestView";
      view.hidden = !active;
      view.classList.toggle("active", active);
    });
    document.querySelector("#dashboardView")?.setAttribute("data-legacy-view", "true");
    document.querySelector("#dashboardLegacyView")?.setAttribute("data-legacy-view", "true");
    document.querySelector('[data-settings-jump="api"]')?.remove();
    document.querySelector("#settingsApiSection")?.remove();
  }

  return {
    allowedTabIds: [...allowedTabs],
    resolveInitialTab,
    inferSelectionMode,
    categoryCountLabel,
    buildMaterialTree,
    buildChatGptInstruction,
    normalizeMomentAsset,
    momentDateParts,
    filterMomentAssets,
    buildMomentPreview,
    buildMomentPrepareRequest,
    installShell
  };
});
