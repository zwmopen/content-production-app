const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyProductionHistoryItem,
  summarizeProductionHistory,
  summarizeModeEvidence
} = require("./gpt-history-status");

const NOW = Date.parse("2026-08-10T02:00:00.000Z");

test("真实成品、模板初始化和可恢复断点使用不同状态", () => {
  assert.equal(classifyProductionHistoryItem({ packagePath: "D:/works/a", packageValid: true }, NOW).key, "completed");
  assert.equal(classifyProductionHistoryItem({ requestId: "gpt-template-1", stage: "迁移计划完成" }, NOW).key, "setup");
  assert.equal(classifyProductionHistoryItem({
    requestId: "gpt-1",
    stage: "已发送确认",
    sourceMaterialPath: "D:/materials/a",
    updatedAt: "2026-08-10T01:30:00.000Z"
  }, NOW).key, "recoverable");
});

test("模式验收只统计带真实成品的闭环证据", () => {
  const result = summarizeModeEvidence([
    { productionMode: "rotate", packagePath: "D:/works/a", packageValid: true },
    { productionMode: "rotate", stage: "已发送确认", updatedAt: "2026-08-10T01:30:00.000Z" },
    { productionMode: "patrol", packagePath: "D:/works/b", packageValid: true }
  ], NOW);
  assert.deepEqual(result, { rotate: 1, patrol: 1 });
});

test("长期没有成品的生产断点进入待核对而不是伪装成普通暂停", () => {
  const result = classifyProductionHistoryItem({
    requestId: "gpt-2",
    stage: "迁移计划完成",
    sourceMaterialPath: "D:/materials/b",
    updatedAt: "2026-08-08T01:00:00.000Z"
  }, NOW);
  assert.equal(result.key, "review");
  assert.match(result.label, /核对/);
});

test("生产历史摘要单独统计可恢复和待核对记录", () => {
  const summary = summarizeProductionHistory([
    { packagePath: "D:/works/a", packageValid: true },
    { requestId: "gpt-template-1", stage: "模板初始化" },
    { requestId: "gpt-1", stage: "已发送确认", sourceMaterialPath: "D:/a", updatedAt: "2026-08-10T01:30:00.000Z" },
    { requestId: "gpt-2", stage: "迁移计划完成", sourceMaterialPath: "D:/b", updatedAt: "2026-08-08T01:00:00.000Z" }
  ], NOW);
  assert.deepEqual(summary, { completed: 1, recoverable: 1, review: 1, setup: 1, informational: 0 });
});
