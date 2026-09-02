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

test("post-plan recovery is scoped to the current material boundary", () => {
  const runStart = sidebarSource.indexOf("  async function runAutomaticProduction(task) {");
  const start = sidebarSource.indexOf("    const liveAutomationBoundary = currentAutomationBoundarySnapshot();", runStart);
  const end = sidebarSource.indexOf("    const DEFAULT_WF_STEPS = [", start);
  assert.ok(runStart >= 0, "runAutomaticProduction must exist");
  assert.ok(start > runStart, "runAutomaticProduction must inspect the live material boundary");
  assert.ok(end > start, "post-plan adoption guard boundary must exist");
  const guard = sidebarSource.slice(start, end);
  assert.match(guard, /automationPromptMatchesEntry\(liveAutomationBoundary\.materialText, task\.entry\)/);
  assert.match(guard, /shouldAdoptCurrentMaterialWorkflowBoundary\(/);
  assert.match(guard, /const snapshotIsPostPlan = canAdoptCurrentMaterialPostPlanBoundary/);
  assert.doesNotMatch(guard, /stateSnapshot\.stage\s*===?\s*["']archived["']/);
  assert.doesNotMatch(guard, /stateSnapshot\.expectedImageCount/);
});

test("native upload waits for composer previews instead of trusting input.files", () => {
  const start = sidebarSource.indexOf("      if (nativeUpload) {");
  const end = sidebarSource.indexOf("      } else {", start);
  assert.ok(start >= 0, "native upload branch must exist");
  assert.ok(end > start, "native upload branch boundary must exist");
  const branch = sidebarSource.slice(start, end);
  assert.match(branch, /nativeAttachmentCount\(\) >= expectedFileNames\.length/);
  assert.match(branch, /nativeUploadProcessing\(\)/);
  assert.doesNotMatch(branch, /nativeUploadSucceeded\s*=\s*\(\)\s*=>\s*nativeInputFileCount\(\)\s*>=/);
  assert.match(branch, /waitFor\(nativeUploadSucceeded, 90_000\)/);
});
