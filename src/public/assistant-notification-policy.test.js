const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_ASSISTANT_SETTINGS,
  normalizeAssistantSettings,
  classifyAssistantNotice,
  assistantNoticeDuration,
  selectAssistantNoticeBatch,
  selectPinnedAssistantMessage
} = require("./assistant-notification-policy");

test("assistant notification defaults favor the current page without flashing other-page notices", () => {
  assert.equal(DEFAULT_ASSISTANT_SETTINGS.notificationsEnabled, true);
  assert.equal(DEFAULT_ASSISTANT_SETTINGS.catVisible, true);
  assert.equal(DEFAULT_ASSISTANT_SETTINGS.bubblePinned, true);
  assert.equal(DEFAULT_ASSISTANT_SETTINGS.detached, false);
  assert.equal(DEFAULT_ASSISTANT_SETTINGS.alwaysOnTop, false);
  assert.equal(DEFAULT_ASSISTANT_SETTINGS.currentDurationMs, 9000);
  assert.equal(DEFAULT_ASSISTANT_SETTINGS.otherDurationMs, 3000);
  assert.equal(DEFAULT_ASSISTANT_SETTINGS.otherMaxPerBatch, 1);
});

test("assistant stays inside the workbench unless desktop floating is explicitly enabled", () => {
  assert.deepEqual(
    normalizeAssistantSettings({ detached: false, alwaysOnTop: true }),
    { ...DEFAULT_ASSISTANT_SETTINGS }
  );
  const detached = normalizeAssistantSettings({ detached: true, alwaysOnTop: true });
  assert.equal(detached.detached, true);
  assert.equal(detached.alwaysOnTop, true);
});

test("assistant settings are clamped to usable, stable durations", () => {
  const settings = normalizeAssistantSettings({
    currentDurationMs: 200,
    otherDurationMs: 99_000,
    otherMaxPerBatch: 9
  });
  assert.equal(settings.currentDurationMs, 1000);
  assert.equal(settings.otherDurationMs, 30_000);
  assert.equal(settings.otherMaxPerBatch, 5);
});

test("a notice is classified by its source page instead of whichever render triggered it", () => {
  assert.equal(classifyAssistantNotice({ sourceView: "distributionView" }, "distributionView"), "current");
  assert.equal(classifyAssistantNotice({ sourceView: "distributionView" }, "gptProductionTestView"), "other");
  assert.equal(classifyAssistantNotice({ sourceView: "global" }, "gptProductionTestView"), "current");
});

test("current-page notices use nine seconds and other-page notices use three seconds", () => {
  assert.equal(assistantNoticeDuration({ sourceView: "distributionView" }, "distributionView"), 9000);
  assert.equal(assistantNoticeDuration({ sourceView: "distributionView" }, "gptProductionTestView"), 3000);
});

test("a batch keeps all current-page notices but only one other-page notice", () => {
  const notices = [
    { id: "c1", sourceView: "gptProductionTestView" },
    { id: "c2", sourceView: "gptProductionTestView" },
    { id: "o1", sourceView: "distributionView" },
    { id: "o2", sourceView: "distributionView" }
  ];
  assert.deepEqual(
    selectAssistantNoticeBatch(notices, "gptProductionTestView").map((item) => item.id),
    ["c1", "c2", "o1"]
  );
});

test("a finished cross-page notice restores the current page message", () => {
  assert.equal(selectPinnedAssistantMessage({
    notice: { sourceView: "gptProductionTestView", message: "生产中" },
    activeView: "conversionView",
    currentViewMessage: "流量转化：等待输入客户原话",
    persistentMessage: "全局消息"
  }), "流量转化：等待输入客户原话");
});

test("a current-page notice remains pinned after its display duration", () => {
  assert.equal(selectPinnedAssistantMessage({
    notice: { sourceView: "gptProductionTestView", message: "当前作品正在生成" },
    activeView: "gptProductionTestView",
    currentViewMessage: "内容生产区",
    persistentMessage: "全局消息"
  }), "当前作品正在生成");
});
