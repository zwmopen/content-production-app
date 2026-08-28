(function exposeGptProductionStatus(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GptProductionStatusPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGptProductionStatusPolicy() {
  function resolveProductionStatus(input = {}) {
    const queueLength = Math.max(0, Number(input.queueLength) || 0);
    const queueIndex = Math.max(0, Number(input.queueIndex) || 0);
    const unlimited = Boolean(input.continuousMode);
    const remaining = unlimited ? null : Math.max(0, queueLength - queueIndex);
    // Continuous modes consume the whole material library.  A queue snapshot
    // is only an internal refill window, never a user-facing total or ordinal.
    const position = !unlimited && queueLength
      ? `${Math.min(queueIndex + 1, queueLength)}/${queueLength}`
      : "";
    const modeLabel = String(input.modeLabel || "自动生产");

    if (input.stoppedByUser) {
      return {
        code: "stopped",
        label: "已停止",
        message: unlimited ? "已停止，保留当前作品检查点" : (remaining ? `已停止，保留 ${remaining} 套待处理` : "当前账号窗口已停止"),
        nextAction: "停止不会自动重启；点击“恢复本窗口”后继续生产",
        primaryActionLabel: "▶ 重新启动自动生产",
        primaryActionId: "gpt.continue",
        actionHelp: "停止不会自动重启；点击“恢复本窗口”继续保留队列，不会删除素材或登录状态。",
        assistantText: unlimited ? "已停止，恢复后继续从素材库补充" : (remaining ? `已停止，保留 ${remaining} 套待处理` : "已停止，等待重新启动"),
        showPauseButton: true,
        // 已停止时只保留主按钮“重新启动自动生产”。再次显示“启动/停止”
        // 会和主按钮形成两个入口，用户无法判断应该点哪一个。
        showStopButton: false,
        remaining,
        position
      };
    }

    if (input.autoRunning) {
      return {
        code: "running",
        label: "生产中",
        message: unlimited ? `${modeLabel}正在持续生产` : (position ? `${modeLabel}正在处理第 ${position} 套` : `${modeLabel}正在准备任务`),
        nextAction: "等待当前作品完整归档，无需操作",
        primaryActionLabel: unlimited
          ? `${modeLabel}进行中`
          : (position ? `${modeLabel}进行中 ${position}` : `${modeLabel}进行中`),
        primaryActionId: "gpt.toggle-pause",
        actionHelp: "当前作品正在处理，完成归档后才会进入下一套。",
        assistantText: unlimited ? "正在持续生产" : (position ? `正在生产第 ${position} 套` : "正在准备生产任务"),
        showPauseButton: true,
        showStopButton: true,
        remaining,
        position
      };
    }

    if (input.integrityMessage) {
      const message = String(input.integrityMessage);
      return {
        code: "blocked",
        label: "待处理当前作品",
        message,
        nextAction: "先恢复当前作品或完成下载归档，再继续下一套",
        primaryActionLabel: "▶ 恢复当前作品",
        primaryActionId: "gpt.recover-current",
        secondaryActionId: "gpt.retry",
        actionHelp: "恢复只读取并完成当前对话，不会重新上传下一套素材。",
        assistantText: message,
        showPauseButton: false,
        showStopButton: false,
        remaining,
        position
      };
    }

    // The B localhost page is a read-only preview. It can display persisted
    // queue data, but it has no Electron preload bridge and must never look
    // ready to start a GPT production run.
    if (input.previewOnly && !input.autoRunning) {
      const message = String(input.previewMessage || "网页预览未接入 GPT 桥接，已禁止开始生产");
      return {
        code: "preview",
        label: "预览模式",
        message,
        nextAction: String(input.previewNextAction || "打开桌面实例，等待 GPT 窗口连接后再开始"),
        primaryActionLabel: "⏳ 等待 GPT 桥接",
        primaryActionId: "gpt.preview-only",
        actionHelp: "当前页面只读展示已保存的队列和检查点；不会上传、发送、出图、下载或归档。",
        assistantText: "网页预览模式，等待 GPT 桥接连接",
        showPauseButton: false,
        showStopButton: false,
        remaining,
        position
      };
    }

    const runtimeQuotaWaiting = input.runtimeStatus === "waiting-quota"
      && input.runtimeQuotaWaiting !== false;
    if (input.quotaPauseMessage || runtimeQuotaWaiting) {
      const message = String(input.quotaPauseMessage || "已到当前额度安全线");
      return {
        code: "quota",
        label: "等待额度",
        message,
        nextAction: "等待额度恢复，系统会按计划自动探测",
        primaryActionLabel: "▶ 继续尝试（等待额度）",
        primaryActionId: "gpt.force-quota-probe",
        actionHelp: "只跳过本地额度提醒探测一次；网页真实限流仍会暂停。",
        assistantText: message,
        showPauseButton: true,
        // 等额度状态的唯一动作是“继续尝试”；停止没有额外意义。
        showStopButton: false,
        remaining,
        position
      };
    }

    if (input.manualPending) {
      return {
        code: "manual",
        label: "等待发送",
        message: "素材已上传到输入框，等待手动发送",
        nextAction: "在右侧检查内容并手动发送",
        primaryActionLabel: "⏳ 等待手动发送",
        primaryActionId: "gpt.manual-send",
        assistantText: "素材已上传，等待手动发送",
        showPauseButton: false,
        showStopButton: false,
        remaining,
        position
      };
    }

    if (input.confirmationPending) {
      return {
        code: "confirmation",
        label: "等待确认",
        message: "计划已生成，等待确认后继续",
        nextAction: "确认计划后继续出图",
        primaryActionLabel: "⏳ 等待确认计划",
        primaryActionId: "gpt.confirm-plan",
        assistantText: "计划已生成，等待确认继续出图",
        showPauseButton: false,
        showStopButton: false,
        remaining,
        position
      };
    }

    if (input.pausedByUser) {
      return {
        code: "paused",
        label: "已暂停",
        message: unlimited
          ? "已手动暂停，恢复后继续从素材库补充"
          : (remaining ? `已手动暂停，保留 ${remaining} 套待处理` : "当前账号窗口已手动暂停"),
        nextAction: "点击继续后恢复自动生产",
        primaryActionLabel: unlimited ? "▶ 继续自动生产" : (position ? `▶ 继续当前任务 ${position}` : "▶ 继续自动生产"),
        primaryActionId: "gpt.continue",
        actionHelp: "从当前安全检查点继续，不重复已完成作品。",
        assistantText: unlimited ? "已手动暂停，恢复后继续从素材库补充" : (remaining ? `已手动暂停，保留 ${remaining} 套待处理` : "已手动暂停，等待继续"),
        showPauseButton: true,
        // 暂停状态由主按钮负责恢复；不再并列显示“停止”。
        showStopButton: false,
        remaining,
        position
      };
    }

    if (input.queuePaused && remaining > 0) {
      return {
        code: "paused",
        label: "已暂停",
        message: `已暂停在第 ${position} 套，保留 ${remaining} 套待处理`,
        nextAction: "点击继续，恢复当前未完成作品",
        primaryActionLabel: `▶ 继续当前任务 ${position}`,
        primaryActionId: "gpt.continue",
        actionHelp: "恢复保留队列；如果当前对话还有作品，先用“恢复当前作品”。",
        assistantText: `已暂停，保留 ${remaining} 套待处理；点击继续后恢复`,
        showPauseButton: true,
        showStopButton: false,
        remaining,
        position
      };
    }

    if (input.queuePaused && unlimited) {
      return {
        code: "paused",
        label: "已暂停",
        message: "自动生产已暂停，恢复后继续从素材库补充",
        nextAction: "点击继续，恢复当前作品",
        primaryActionLabel: "▶ 继续自动生产",
        primaryActionId: "gpt.continue",
        actionHelp: "从当前安全检查点继续；当前批次完成后会自动从素材库补充下一批。",
        assistantText: "自动生产已暂停，恢复后继续从素材库补充",
        showPauseButton: true,
        showStopButton: false,
        remaining,
        position
      };
    }

    if (remaining > 0) {
      return {
        code: "pending",
        label: "待继续",
        message: `还有 ${remaining} 套待处理`,
        nextAction: "继续当前队列或重试当前任务",
        primaryActionLabel: `▶ 继续当前任务 ${position}`,
        primaryActionId: "gpt.continue",
        actionHelp: "继续队列，不等于重新上传上一套素材。",
        assistantText: `还有 ${remaining} 套待处理`,
        showPauseButton: true,
        showStopButton: false,
        remaining,
        position
      };
    }

    if (Number(input.selectedCount || 0) > 0 || (input.continuousMode && input.continuousArmed && input.runtimeStatus === "idle")) {
      return {
        code: "ready",
        label: "已就绪",
        message: Number(input.selectedCount || 0) > 0 ? "素材已准备好，可以开始生产" : "自动生产已就绪",
        nextAction: Number(input.selectedCount || 0) > 0 ? "点击开始生产" : "等待启动新任务",
        primaryActionLabel: `▶ 开始${String(input.shortMode || modeLabel)}生产`,
        primaryActionId: "gpt.continue",
        assistantText: "自动生产已就绪，等待启动新任务",
        showPauseButton: false,
        showStopButton: false,
        remaining,
        position
      };
    }

    return {
      code: "idle",
      label: "待机",
      message: "请选择素材；模板可以不选",
      nextAction: "先选择素材；模板可以不选",
      primaryActionLabel: `▶ 开始${String(input.shortMode || modeLabel)}生产`,
      primaryActionId: "gpt.continue",
      assistantText: "当前待机，等待选择素材",
      showPauseButton: false,
      showStopButton: false,
      remaining,
      position
    };
  }

  return { resolveProductionStatus };
});
