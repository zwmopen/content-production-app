"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");

const sidebarSource = fs.readFileSync(path.join(__dirname, "sidebar.js"), "utf8");

test("automatic upload handler uses task-owned scope after submitting attachments", () => {
  const start = sidebarSource.indexOf("    async function handleUploadMaterial() {");
  const end = sidebarSource.indexOf("\n    // wait-plan：等待 GPT 返回迁移计划", start);
  assert.ok(start >= 0, "handleUploadMaterial must exist");
  assert.ok(end > start, "handleUploadMaterial boundary must exist");
  const handler = sidebarSource.slice(start, end);

  // The handler is nested inside runAutomaticProduction, not
  // processUploadQueue. A bare `entry`/`files` reference here passes syntax
  // checks but fails only after GPT has accepted the attachments.
  assert.doesNotMatch(handler.replaceAll("task.entry", ""), /\bentry\.autoRun\b/);
  assert.doesNotMatch(handler, /\bfiles\.length\b/);
  assert.match(handler, /task\.entry\.autoRun && !workflow\.uploadQuotaRecorded/);
  assert.match(handler, /recordWorkbenchQuota\(task\.entry, "uploaded", expectedAttachmentCount\)/);
});

test("send-confirm refuses to submit while material attachments remain in the composer", () => {
  const start = sidebarSource.indexOf("    async function handleSendConfirm() {");
  const end = sidebarSource.indexOf("\n    // wait-images：等待本轮图片生成完成", start);
  assert.ok(start >= 0, "handleSendConfirm must exist");
  assert.ok(end > start, "handleSendConfirm boundary must exist");
  const handler = sidebarSource.slice(start, end);
  assert.match(handler, /attachmentPreviewCount\(\) > 0/);
  assert.match(handler, /CONFIRM_ATTACHMENTS_PENDING/);
  assert.match(handler, /allowDurableLabelDrift: false/);
});

test("wait handlers get an outer settlement grace instead of racing their own budget", () => {
  assert.match(sidebarSource, /workflowStepExecutionTimeoutMs\(action, configuredWaitBudgetMs\)/);
});
