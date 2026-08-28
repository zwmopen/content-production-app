(function exposeAssistantNotificationPolicy(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AssistantNotificationPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAssistantNotificationPolicy() {
  const DEFAULT_ASSISTANT_SETTINGS = Object.freeze({
    notificationsEnabled: true,
    catVisible: true,
    bubblePinned: true,
    motionEnabled: true,
    detached: false,
    alwaysOnTop: false,
    currentDurationMs: 9000,
    otherDurationMs: 3000,
    otherMaxPerBatch: 1
  });

  function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
  }

  function normalizeAssistantSettings(input = {}) {
    const detached = input.detached === true;
    return {
      notificationsEnabled: input.notificationsEnabled !== false,
      catVisible: input.catVisible !== false,
      bubblePinned: input.bubblePinned !== false,
      motionEnabled: input.motionEnabled !== false,
      detached,
      alwaysOnTop: detached && input.alwaysOnTop === true,
      currentDurationMs: clampNumber(input.currentDurationMs, DEFAULT_ASSISTANT_SETTINGS.currentDurationMs, 1000, 30_000),
      otherDurationMs: clampNumber(input.otherDurationMs, DEFAULT_ASSISTANT_SETTINGS.otherDurationMs, 1000, 30_000),
      otherMaxPerBatch: Math.round(clampNumber(input.otherMaxPerBatch, DEFAULT_ASSISTANT_SETTINGS.otherMaxPerBatch, 0, 5))
    };
  }

  function classifyAssistantNotice(notice = {}, activeView = "") {
    const sourceView = String(notice.sourceView || activeView || "global");
    return sourceView === "global" || sourceView === String(activeView || "") ? "current" : "other";
  }

  function assistantNoticeDuration(notice = {}, activeView = "", inputSettings = {}) {
    const settings = normalizeAssistantSettings(inputSettings);
    return classifyAssistantNotice(notice, activeView) === "current"
      ? settings.currentDurationMs
      : settings.otherDurationMs;
  }

  function selectAssistantNoticeBatch(notices = [], activeView = "", inputSettings = {}) {
    const settings = normalizeAssistantSettings(inputSettings);
    let otherCount = 0;
    return notices.filter((notice) => {
      if (classifyAssistantNotice(notice, activeView) === "current") return true;
      otherCount += 1;
      return otherCount <= settings.otherMaxPerBatch;
    });
  }

  function selectPinnedAssistantMessage({ notice = {}, activeView = "", currentViewMessage = "", persistentMessage = "" } = {}) {
    if (classifyAssistantNotice(notice, activeView) === "current") return String(notice.message || currentViewMessage || persistentMessage || "");
    return String(currentViewMessage || persistentMessage || "");
  }

  return {
    DEFAULT_ASSISTANT_SETTINGS,
    normalizeAssistantSettings,
    classifyAssistantNotice,
    assistantNoticeDuration,
    selectAssistantNoticeBatch,
    selectPinnedAssistantMessage
  };
});
