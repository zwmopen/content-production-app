const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveProductionStatus } = require("./gpt-production-status");

test("a restored queue that still needs a click is consistently called paused", () => {
  const status = resolveProductionStatus({
    autoRunning: false,
    queuePaused: true,
    queueLength: 25,
    queueIndex: 24,
    continuousMode: true,
    continuousArmed: true,
    runtimeStatus: "idle"
  });

  assert.equal(status.code, "paused");
  assert.equal(status.label, "已暂停");
  assert.equal(status.message, "自动生产已暂停，恢复后继续从素材库补充");
  assert.equal(status.nextAction, "点击继续，恢复当前作品");
  assert.equal(status.primaryActionLabel, "▶ 继续自动生产");
  assert.equal(status.showPauseButton, true);
  assert.equal(status.showStopButton, false);
  assert.match(status.assistantText, /已暂停/);
  assert.doesNotMatch(status.assistantText, /已恢复|等待启动/);
});

test("quota waiting takes precedence over an ordinary paused queue", () => {
  const status = resolveProductionStatus({
    queuePaused: true,
    quotaPauseMessage: "本轮额度已用完",
    queueLength: 4,
    queueIndex: 2,
    runtimeStatus: "waiting-quota"
  });

  assert.equal(status.code, "quota");
  assert.equal(status.label, "等待额度");
  assert.equal(status.message, "本轮额度已用完");
  assert.match(status.nextAction, /自动探测/);
});

test("a completed conversation boundary is shown before a stale quota runtime", () => {
  const status = resolveProductionStatus({
    queuePaused: true,
    queueLength: 8,
    queueIndex: 6,
    runtimeStatus: "waiting-quota",
    quotaPauseMessage: "已到当前额度安全线",
    integrityMessage: "当前对话仍停在“completed-copy-pending-package”；请先完成下载归档"
  });

  assert.equal(status.code, "blocked");
  assert.equal(status.label, "待处理当前作品");
  assert.match(status.message, /completed-copy-pending-package/);
  assert.match(status.primaryActionLabel, /恢复当前作品/);
  assert.equal(status.primaryActionId, "gpt.recover-current");
  assert.equal(status.secondaryActionId, "gpt.retry");
  assert.equal(status.showPauseButton, false);
  assert.doesNotMatch(status.assistantText, /额度/);
});

test("a stale waiting-quota runtime without a live probe deadline is not treated as quota", () => {
  const status = resolveProductionStatus({
    queuePaused: true,
    queueLength: 8,
    queueIndex: 3,
    runtimeStatus: "waiting-quota",
    runtimeQuotaWaiting: false
  });

  assert.equal(status.code, "paused");
  assert.equal(status.label, "已暂停");
  assert.doesNotMatch(status.message, /额度/);
});

test("running and stopped states have unambiguous primary actions", () => {
  const running = resolveProductionStatus({ autoRunning: true, queueLength: 5, queueIndex: 1, modeLabel: "单账号全自动" });
  assert.equal(running.label, "生产中");
  assert.equal(running.primaryActionLabel, "单账号全自动进行中 2/5");
  assert.equal(running.showPauseButton, true);

  const stopped = resolveProductionStatus({ stoppedByUser: true, queueLength: 5, queueIndex: 1 });
  assert.equal(stopped.label, "已停止");
  assert.equal(stopped.primaryActionLabel, "▶ 重新启动自动生产");
  assert.equal(stopped.showPauseButton, true);
  assert.equal(stopped.showStopButton, false);
});

test("continuous single-account status does not expose the finite batch as a total", () => {
  const status = resolveProductionStatus({
    autoRunning: true,
    continuousMode: true,
    queueLength: 8,
    queueIndex: 6,
    modeLabel: "单账号全自动"
  });

  assert.equal(status.message, "单账号全自动正在持续生产");
  assert.equal(status.primaryActionLabel, "单账号全自动进行中");
  assert.equal(status.remaining, null);
  assert.equal(status.position, "");
  assert.doesNotMatch(status.message, /7\/8/);
  assert.doesNotMatch(status.message, /第 7 套/);
});

test("paused, quota-waiting, and pending states expose one resume action without a duplicate stop", () => {
  for (const input of [
    { queuePaused: true, queueLength: 4, queueIndex: 1 },
    { quotaPauseMessage: "本轮额度已用完", queuePaused: true, queueLength: 4, queueIndex: 1 },
    { queueLength: 4, queueIndex: 1 }
  ]) {
    const status = resolveProductionStatus(input);
    assert.equal(status.showStopButton, false);
    assert.equal(status.showPauseButton, true);
    assert.match(status.primaryActionLabel, /继续|尝试/);
  }
});

test("an idle armed account is only ready when no paused work remains", () => {
  const status = resolveProductionStatus({
    continuousMode: true,
    continuousArmed: true,
    runtimeStatus: "idle",
    selectedCount: 0,
    queueLength: 0,
    queueIndex: 0
  });

  assert.equal(status.code, "ready");
  assert.equal(status.label, "已就绪");
  assert.match(status.assistantText, /已就绪/);
});

test("a B localhost preview never advertises a runnable GPT queue", () => {
  const status = resolveProductionStatus({
    previewOnly: true,
    previewMessage: "B 网页预览未接入 GPT 桥接，已禁止开始生产",
    previewNextAction: "打开 B 桌面实例，等待账号 3/4 的 GPT 窗口连接后再开始",
    continuousMode: true,
    continuousArmed: true,
    runtimeStatus: "idle",
    selectedCount: 8,
    queueLength: 8
  });

  assert.equal(status.code, "preview");
  assert.equal(status.label, "预览模式");
  assert.match(status.message, /未接入 GPT 桥接/);
  assert.match(status.nextAction, /账号 3\/4/);
  assert.equal(status.primaryActionId, "gpt.preview-only");
  assert.equal(status.showPauseButton, false);
  assert.equal(status.showStopButton, false);
});

test("a user-paused account never appears ready even when its queue is empty", () => {
  const status = resolveProductionStatus({
    pausedByUser: true,
    continuousMode: true,
    continuousArmed: true,
    runtimeStatus: "idle",
    queueLength: 0
  });

  assert.equal(status.code, "paused");
  assert.equal(status.label, "已暂停");
  assert.match(status.nextAction, /继续/);
});
