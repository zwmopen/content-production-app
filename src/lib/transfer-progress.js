"use strict";

/**
 * 传输进度解析器
 *
 * 兼容两种日志来源：
 * 1. stdout 明文（旧格式）："传送 42%" / "接收任务 task-skill-xxx" / "补货完成：{json}"
 * 2. stderr 结构化日志（新格式）："[时间] [OP-xxx] [INFO] module: message | key=value"
 *
 * 结构化日志由 device-folder-transfer/scripts/logger.py 生成，
 * 工作台通过 child.stderr 回调接收并传入 updateTransferProgress(record, chunk, true)。
 */

function lastLine(text) {
  return String(text || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .at(-1) || "";
}

/**
 * 解析结构化日志行。
 *
 * 格式: [2026-08-03 13:41:11] [OP-d1acf0] [INFO] send_to_device: 传送 45% | sent=1024000 | total=2048000
 *
 * @param {string} text - 原始文本块（可能含多行）
 * @returns {{ timestamp: string, opId: string, level: string, module: string, message: string, kv: Record<string, string> } | null}
 */
function parseStructuredLog(text) {
  const match = text.match(
    /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[([^\]]+)\] \[([^\]]+)\] ([^:]+): (.+)$/m
  );
  if (!match) return null;
  const [, timestamp, opId, level, module, rest] = match;
  const pipeParts = rest.split(" | ");
  const message = (pipeParts.shift() || "").trim();
  const kv = {};
  for (const part of pipeParts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx > 0) {
      kv[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
    }
  }
  return { timestamp, opId, level, module: module.trim(), message, kv };
}

function updateTransferProgress(record, chunk, isError = false) {
  const text = String(chunk || "");
  if (!text) return record;

  record.output = `${record.output || ""}${text}`.slice(-64 * 1024);
  const line = lastLine(text);
  if (line) record.message = line;

  // 尝试解析结构化日志行
  const logEntry = parseStructuredLog(text);

  // 只在真正的 ERROR 级别或非结构化 stderr 错误时设置 record.error
  // 避免 INFO/DEBUG 日志行污染 error 字段
  if (logEntry && logEntry.level === "ERROR") {
    record.error = logEntry.message;
  } else if (isError && line && !logEntry) {
    // 非结构化的 stderr 输出（旧版错误信息、traceback 等）
    record.error = line;
  }

  // --- 提取远程任务 ID ---

  // 从结构化日志提取工作台任务 ID（打通双日志系统的关联 ID）
  if (logEntry && logEntry.kv.wbTask) {
    record.wbTaskId = String(logEntry.kv.wbTask);
  }

  // stdout: "接收任务 task-skill-20260725123456"
  const remoteMatch = text.match(/接收任务\s+(task-skill-\d{14})/);
  if (remoteMatch) record.remoteTaskId = remoteMatch[1];

  // stderr 结构化: "▶ 操作开始: LAN传输 | task=task-skill-xxx"
  if (logEntry && logEntry.kv.task && String(logEntry.kv.task).startsWith("task-skill-")) {
    record.remoteTaskId = logEntry.kv.task;
  }

  // --- 打包阶段 ---

  // stdout 旧格式: "打包 42%"  → 打包百分比
  const packagePercentMatches = [...text.matchAll(/打包\s+(\d+)%/g)];
  // stdout 新格式: "打包 120/350"  → 打包进度（当前/总数）
  const packageFractionMatches = [...text.matchAll(/打包\s+(\d+)\/(\d+)/g)];

  if (packagePercentMatches.length || packageFractionMatches.length) {
    record.stage = "packing";
    record.stageLabel = "正在整理作品包";
    let pct;
    if (packagePercentMatches.length) {
      pct = Number(packagePercentMatches.at(-1)[1]);
    } else {
      const [, idx, total] = packageFractionMatches.at(-1);
      pct = total > 0 ? Math.round((Number(idx) / Number(total)) * 100) : 0;
    }
    record.progress = Math.max(record.progress || 0, Math.min(12, Math.round(pct * 0.12)));
  }

  // stderr 结构化: "→ 打包文件夹" (步骤标记，logger.step 输出带 → 前缀)
  if (logEntry && logEntry.message.includes("打包文件夹")) {
    record.stage = "packing";
    record.stageLabel = "正在整理作品包";
    record.progress = Math.max(record.progress || 0, 5);
  }

  // --- 准备阶段 ---

  // stdout: "目标：1号红米13；源：作品集_008[转]"
  if (/目标：/.test(text)) {
    record.stage = "preparing";
    record.stageLabel = "正在核对作品包与设备";
    record.progress = Math.max(record.progress || 0, 3);
  }

  // stderr 结构化: "→ 清点文件" (步骤标记，logger.step 输出带 → 前缀)
  if (logEntry && logEntry.message.includes("清点文件")) {
    record.stage = "preparing";
    record.stageLabel = "正在核对作品包与设备";
    record.progress = Math.max(record.progress || 0, 3);
  }

  // --- 连接阶段 ---

  // stdout: "接收任务 task-skill-20260725123456"
  if (/接收任务\s+task-skill-/.test(text)) {
    record.stage = "connecting";
    record.stageLabel = "设备已响应，准备接收";
    record.progress = Math.max(record.progress || 0, 8);
  }

  // stderr 结构化: "▶ 操作开始: LAN传输" 或 "▶ 操作开始: USB传输"
  if (logEntry && /操作开始.*(?:LAN传输|USB传输)/.test(logEntry.message)) {
    record.stage = "connecting";
    record.stageLabel = "设备已响应，准备接收";
    record.progress = Math.max(record.progress || 0, 8);
  }

  // --- 传输阶段 ---

  // stdout 和 stderr 都会出现: "传送 42%"
  const transferMatches = [...text.matchAll(/传送\s+(\d+)%/g)];
  if (transferMatches.length) {
    record.stage = "sending";
    record.stageLabel = "正在发送到设备";
    record.progress = Math.max(record.progress || 0, Math.min(95, Number(transferMatches.at(-1)[1])));
  }

  // --- 确认阶段 ---

  // stdout/stderr: "接收确认" 或 "接收成功" 或 "接收确认完成"
  if (/接收确认|接收成功/.test(text)) {
    record.stage = "confirming";
    record.stageLabel = "设备已接收，正在确认";
    record.progress = Math.max(record.progress || 0, 97);
  }

  // USB 传输完成（stderr 结构化）
  if (logEntry && /USB传输完成/.test(logEntry.message)) {
    record.stage = "confirming";
    record.stageLabel = "设备已接收，正在确认";
    record.progress = Math.max(record.progress || 0, 97);
    if (logEntry.kv.transport) record.transport = String(logEntry.kv.transport);
  }

  // --- 记录阶段 ---

  // stdout: "补货完成：{json}" 或 "发送完成：{json}"
  if (/补货完成：|发送完成：/.test(record.output)) {
    record.stage = "recording";
    record.stageLabel = "正在写入使用记录";
    record.progress = Math.max(record.progress || 0, 99);
    const resultMatch = record.output.match(/(?:补货完成|发送完成)：(\{[^\r\n]+\})/);
    if (resultMatch) {
      try {
        const result = JSON.parse(resultMatch[1]);
        if (result.transport) record.transport = String(result.transport);
        if (result.asset) record.collection = String(result.asset).trim();
      } catch {
        // 旧版脚本可能输出非 JSON 文本；不影响任务完成判定。
      }
    }
  }

  // stderr 结构化: "✓ 操作完成: LAN传输" 或 "✓ 操作完成: USB传输"
  if (logEntry && /操作完成.*(?:LAN传输|USB传输|send_to_device|restock_device)/.test(logEntry.message)) {
    record.stage = "recording";
    record.stageLabel = "正在写入使用记录";
    record.progress = Math.max(record.progress || 0, 99);
    // 从结构化日志提取传输协议和作品集名称
    if (logEntry.kv.transport) record.transport = String(logEntry.kv.transport);
    if (logEntry.kv.asset) record.collection = String(logEntry.kv.asset).trim();
  }

  // stderr 结构化: "补货完成" (logger.info 消息，无冒号)
  if (logEntry && logEntry.message === "补货完成") {
    record.stage = "recording";
    record.stageLabel = "正在写入使用记录";
    record.progress = Math.max(record.progress || 0, 99);
    if (logEntry.kv.transport) record.transport = String(logEntry.kv.transport);
    if (logEntry.kv.asset) record.collection = String(logEntry.kv.asset).trim();
  }

  return record;
}

function publicTransferTask(record) {
  if (!record) return null;
  const { child, ...safe } = record;
  return safe;
}

module.exports = {
  lastLine,
  parseStructuredLog,
  publicTransferTask,
  updateTransferProgress
};
