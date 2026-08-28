#!/usr/bin/env node
const { getJuguangSnapshot, queryKeywords } = require("../lib/juguang-data");

let input = "";
function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function result(value) { return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }; }
function tools() {
  return [
    { name: "juguang_status", description: "读取聚光接入状态、数据更新时间和数据量，不返回客户隐私。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "juguang_query_keywords", description: "查询聚光关键词快照和团建内容建议。", inputSchema: { type: "object", properties: { text: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
    { name: "juguang_note_signals", description: "读取账号笔记的脱敏表现信号，用于复刻排序。", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false } },
    { name: "juguang_lead_summary", description: "读取聚光线索脱敏汇总。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "juguang_recommend_topics", description: "返回下一批团建选题。", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 12 } }, additionalProperties: false } }
  ];
}

async function handle(request) {
  const { id, method, params = {} } = request;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: params.protocolVersion || "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "juguang-ops", version: "0.1.0" } } });
  if (method === "notifications/initialized") return;
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: tools() } });
  if (method === "tools/call") {
    const snapshot = getJuguangSnapshot();
    const args = params.arguments || {};
    let value;
    if (params.name === "juguang_status") value = { mode: snapshot.mode, api: snapshot.api, updatedAt: snapshot.updatedAt, counts: snapshot.counts, nextActions: snapshot.nextActions };
    else if (params.name === "juguang_query_keywords") value = queryKeywords(args);
    else if (params.name === "juguang_note_signals") value = snapshot.noteSignals.slice(0, Math.min(Number(args.limit) || 20, 20));
    else if (params.name === "juguang_lead_summary") value = snapshot.leads;
    else if (params.name === "juguang_recommend_topics") value = snapshot.recommendations.slice(0, Math.min(Number(args.limit) || 8, 12));
    else return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool" } });
    return send({ jsonrpc: "2.0", id, result: result(value) });
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  const lines = input.split(/\r?\n/);
  input = lines.pop() || "";
  lines.filter(Boolean).forEach((line) => {
    try { handle(JSON.parse(line)); }
    catch (error) { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } }); }
  });
});
