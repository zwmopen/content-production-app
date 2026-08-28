"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseStructuredLog,
  publicTransferTask,
  updateTransferProgress
} = require("./transfer-progress");

test("distribution output becomes human-readable progress stages", () => {
  const record = { progress: 0, output: "", child: { pid: 1 } };
  updateTransferProgress(record, "目标：1号；指定作品集：作品集_008[转]\n");
  assert.equal(record.progress, 3);
  assert.equal(record.stageLabel, "正在核对作品包与设备");

  updateTransferProgress(record, "接收任务 task-skill-20260725123456\n");
  assert.equal(record.remoteTaskId, "task-skill-20260725123456");
  assert.equal(record.progress, 8);

  updateTransferProgress(record, "传送 42%\n");
  assert.equal(record.progress, 42);
  assert.equal(record.stageLabel, "正在发送到设备");

  updateTransferProgress(record, "接收确认成功\n");
  assert.equal(record.progress, 97);
  assert.equal(record.stageLabel, "设备已接收，正在确认");

  updateTransferProgress(record, '补货完成：{"transport":"Wi-Fi"}\n');
  assert.equal(record.progress, 99);
  assert.equal(record.stageLabel, "正在写入使用记录");
  assert.equal(record.transport, "Wi-Fi");
});

test("automatic distribution records the collection selected by the transfer script", () => {
  const record = { progress: 0, output: "", collection: "" };
  updateTransferProgress(
    record,
    '补货完成：{"device":"苹果12","asset":"作品集_050[转]","transport":"Wi-Fi"}\n'
  );

  assert.equal(record.collection, "作品集_050[转]");
  assert.equal(record.transport, "Wi-Fi");
  assert.equal(record.progress, 99);
});

test("automatic distribution also handles a completion line split across output chunks", () => {
  const record = { progress: 0, output: "", collection: "" };
  updateTransferProgress(record, '补货完成：{"device":"苹果12",');
  updateTransferProgress(record, '"asset":"作品集_051[转]","transport":"Wi-Fi"}\n');

  assert.equal(record.collection, "作品集_051[转]");
  assert.equal(record.transport, "Wi-Fi");
});

test("public task never exposes the child process", () => {
  assert.deepEqual(
    publicTransferTask({ id: "task-1", child: { pid: 1 }, progress: 10 }),
    { id: "task-1", progress: 10 }
  );
});

// --- 新增：结构化日志格式测试 ---

test("parseStructuredLog extracts fields from a structured log line", () => {
  const entry = parseStructuredLog(
    "[2026-08-03 13:41:11] [OP-d1acf0] [INFO] send_to_device: 传送 45% | sent=1024000 | total=2048000\n"
  );
  assert.equal(entry.timestamp, "2026-08-03 13:41:11");
  assert.equal(entry.opId, "OP-d1acf0");
  assert.equal(entry.level, "INFO");
  assert.equal(entry.module, "send_to_device");
  assert.equal(entry.message, "传送 45%");
  assert.equal(entry.kv.sent, "1024000");
  assert.equal(entry.kv.total, "2048000");
});

test("parseStructuredLog returns null for plain stdout text", () => {
  assert.equal(parseStructuredLog("传送 42%\n"), null);
  assert.equal(parseStructuredLog("补货完成：{json}\n"), null);
});

test("structured stderr log: packing fraction format (打包 N/M)", () => {
  const record = { progress: 0, output: "" };
  // 新格式：打包 120/350（不是旧的打包 42%）
  updateTransferProgress(record, "打包 120/350\n");
  assert.equal(record.stage, "packing");
  assert.equal(record.stageLabel, "正在整理作品包");
  assert.ok(record.progress > 0 && record.progress <= 12);
});

test("structured stderr log: packing step marker (→ 打包文件夹)", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:10] [OP-abc123] [INFO] send_to_device: → 打包文件夹 | source=作品集_008[转] | files=350\n",
    true
  );
  assert.equal(record.stage, "packing");
  assert.ok(record.progress >= 5);
});

test("structured stderr log: preparing step marker (→ 清点文件)", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:09] [OP-abc123] [INFO] send_to_device: → 清点文件 | source=作品集_008[转]\n",
    true
  );
  assert.equal(record.stage, "preparing");
  assert.equal(record.stageLabel, "正在核对作品包与设备");
  assert.equal(record.progress, 3);
});

test("structured stderr log: connecting via op_start LAN传输", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:10] [OP-abc123] [INFO] send_to_device: ▶ 操作开始: LAN传输 | task=task-skill-20260803134100 | device=红米13 | files=350 | bytes=2048000\n",
    true
  );
  assert.equal(record.stage, "connecting");
  assert.equal(record.remoteTaskId, "task-skill-20260803134100");
  assert.equal(record.progress, 8);
});

test("structured stderr log: sending progress (传送 N%)", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:11] [OP-abc123] [INFO] send_to_device: 传送 45% | sent=1024000 | total=2048000\n",
    true
  );
  assert.equal(record.stage, "sending");
  assert.equal(record.stageLabel, "正在发送到设备");
  assert.equal(record.progress, 45);
});

test("structured stderr log: confirming (接收确认完成)", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:12] [OP-abc123] [INFO] send_to_device: 接收确认完成 | committed=True\n",
    true
  );
  assert.equal(record.stage, "confirming");
  assert.equal(record.progress, 97);
});

test("structured stderr log: recording via op_end (✓ 操作完成)", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:13] [OP-abc123] [INFO] send_to_device: ✓ 操作完成: LAN传输 | task=task-skill-20260803134100 | files=350 | bytes=2048000 | transport=Wi-Fi\n",
    true
  );
  assert.equal(record.stage, "recording");
  assert.equal(record.progress, 99);
  assert.equal(record.transport, "Wi-Fi");
});

test("structured stderr log: recording via 补货完成 message", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:14] [OP-abc123] [INFO] restock_device: 补货完成 | device=红米13 | asset=作品集_008[转] | transport=Wi-Fi | before=12 | after=13\n",
    true
  );
  assert.equal(record.stage, "recording");
  assert.equal(record.progress, 99);
  assert.equal(record.transport, "Wi-Fi");
  assert.equal(record.collection, "作品集_008[转]");
});

test("structured stderr log: ERROR level sets record.error", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:15] [OP-abc123] [ERROR] send_to_device: 上传失败 | status=500 | error=timeout\n",
    true
  );
  assert.equal(record.error, "上传失败");
});

test("structured stderr log: INFO level does NOT set record.error", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:11] [OP-abc123] [INFO] send_to_device: 传送 45% | sent=1024000 | total=2048000\n",
    true
  );
  assert.equal(record.error, undefined);
});

test("structured stderr log: DEBUG level does NOT set record.error", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:09] [OP-abc123] [DEBUG] send_to_device: HTTP探测失败 | host=192.168.1.10 | error=timed out\n",
    true
  );
  // DEBUG 级别不应设为 error
  assert.equal(record.error, undefined);
});

test("backward compat: stdout 传送 N% still works alongside stderr logs", () => {
  const record = { progress: 0, output: "" };
  // 先来一条 stderr 结构化日志
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:10] [OP-abc123] [INFO] send_to_device: ▶ 操作开始: LAN传输 | task=task-skill-20260803134100\n",
    true
  );
  // 再来一条 stdout 明文进度
  updateTransferProgress(record, "传送 42%\n");
  assert.equal(record.stage, "sending");
  assert.equal(record.progress, 42);
  assert.equal(record.remoteTaskId, "task-skill-20260803134100");
});

test("structured stderr log: wbTask field is extracted for cross-system correlation", () => {
  const record = { progress: 0, output: "" };
  updateTransferProgress(
    record,
    "[2026-08-03 13:41:10] [OP-abc123] [INFO] send_to_device: ▶ 操作开始: LAN传输 | task=task-skill-20260803134100 | wbTask=distribution-1234567890-abc123\n",
    true
  );
  assert.equal(record.wbTaskId, "distribution-1234567890-abc123");
  // 确保 wbTask 不覆盖 remoteTaskId
  assert.equal(record.remoteTaskId, "task-skill-20260803134100");
});
