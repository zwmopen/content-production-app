(function attachGptHistoryStatus(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TBGptHistoryStatus = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGptHistoryStatus() {
  const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

  function productionTimestamp(item = {}) {
    return Date.parse(String(item.finishedAt || item.updatedAt || item.startedAt || "")) || 0;
  }

  function classifyProductionHistoryItem(item = {}, now = Date.now()) {
    if ((item.packagePath || item.productPath) && item.packageValid !== false) {
      return { key: "completed", label: "已完成", actionable: false };
    }
    const requestId = String(item.requestId || item.id || "");
    const stage = String(item.stage || "");
    if (/^gpt-template-/i.test(requestId) || /(?:模板|母版).*(?:初始化|迁移)|(?:初始化|迁移).*(?:模板|母版)/.test(stage)) {
      return { key: "setup", label: "模板初始化", actionable: false };
    }
    const looksLikeProduction = Boolean(item.sourceMaterialPath)
      || /^gpt-(?!template-)/i.test(requestId)
      || /计划|确认|出图|图片|文案|下载|归档|额度/.test(stage);
    if (!looksLikeProduction) return { key: "informational", label: "过程记录", actionable: false };

    const timestamp = productionTimestamp(item);
    const stale = timestamp > 0 && Number(now) - timestamp > STALE_AFTER_MS;
    const explicitFailure = item.status === "failed" || item.packageValid === false && Boolean(item.packagePath)
      || /失败|缺 TXT|缺图片|完整性/.test(`${stage} ${item.error || ""}`);
    if (stale || explicitFailure) return { key: "review", label: "待核对", actionable: true };
    return { key: "recoverable", label: "可恢复", actionable: true };
  }

  function summarizeProductionHistory(items = [], now = Date.now()) {
    const summary = { completed: 0, recoverable: 0, review: 0, setup: 0, informational: 0 };
    items.forEach((item) => {
      const key = classifyProductionHistoryItem(item, now).key;
      summary[key] = Number(summary[key] || 0) + 1;
    });
    return summary;
  }

  function summarizeModeEvidence(items = [], now = Date.now()) {
    const result = {};
    items.forEach((item) => {
      if (classifyProductionHistoryItem(item, now).key !== "completed") return;
      const mode = String(item.productionMode || "").trim();
      if (!mode) return;
      result[mode] = Number(result[mode] || 0) + 1;
    });
    return result;
  }

  return {
    STALE_AFTER_MS,
    classifyProductionHistoryItem,
    summarizeProductionHistory,
    summarizeModeEvidence
  };
});
