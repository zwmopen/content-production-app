"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const main = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "preload.js"), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("template status IPC reads an existing assigned account without creating or navigating one", () => {
  const handler = sourceBetween(
    main,
    'ipcMain.handle("desktop:gpt-template-sync-status"',
    "// 账号真实身份：服务端会话"
  );
  assert.match(handler, /readExistingBrowserProfileForTemplateSync\(id\)/);
  assert.match(handler, /gptAccounts\.get\(id\)/);
  assert.doesNotMatch(handler, /ensureGptAccount\(|\.loadURL\(/);
  assert.match(handler, /projectTemplateSyncStatus\(/);
  assert.match(preload, /targetConversationUrl: String\(input\.targetConversationUrl \|\| ""\)/);
});

test("template status page and auth probes suppress bridge health effects and expose no private values", () => {
  const pageProbe = sourceBetween(main, "function gptTemplateSyncStatusPageScript()", "function gptTemplateSyncAuthStatusScript()");
  const authProbe = sourceBetween(main, "function gptTemplateSyncAuthStatusScript()", "// 诊断用：同一份结构判断");
  const statusHandler = sourceBetween(
    main,
    'ipcMain.handle("desktop:gpt-template-sync-status"',
    "// 账号真实身份：服务端会话"
  );
  assert.match(pageProbe, /composerEmpty: Boolean\(composerElement\) && !composerText/);
  assert.match(pageProbe, /attachmentsClear,/);
  assert.match(pageProbe, /generating: streamingMarker \|\| stopControl/);
  const returnedFields = pageProbe.match(/return \{\s*\n([\s\S]*?)\n\s*\};/)?.[1] || "";
  assert.ok(returnedFields, "page probe must return a status object");
  assert.doesNotMatch(returnedFields, /^\s*composerText\s*[:,]/m);
  assert.match(authProbe, /authChecked: response\.ok === true, authLoggedIn:/);
  assert.doesNotMatch(authProbe, /email|name|plan|cookie|token/i);
  assert.equal((statusHandler.match(/channel: "template-sync-readonly", trackReadHealth: false, reportBridgeHealth: false/g) || []).length, 2);
  assert.match(main, /if \(reportBridgeHealth\) noteGptBridgeTimeout\(account, channel\)/);
  assert.match(main, /if \(reportBridgeHealth\) noteGptBridgeSuccess\(account, channel\)/);
  assert.doesNotMatch(statusHandler, /authEmail|authName|authPlan|\.email|\.name|\.plan|currentUrl\s*:/);
});
