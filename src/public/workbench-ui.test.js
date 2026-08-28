const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const version = fs.readFileSync(path.join(__dirname, "..", "..", "VERSION"), "utf8").trim();
const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const commandBus = fs.readFileSync(path.join(__dirname, "workbench-command-bus.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const conversionOutputReport = fs.readFileSync(path.join(__dirname, "..", "..", "docs", "流量转化成交产出复盘.html"), "utf8");
const workerStateSource = fs.readFileSync(path.join(__dirname, "gpt-window-worker-state.js"), "utf8");
const productionStatus = fs.readFileSync(path.join(__dirname, "gpt-production-status.js"), "utf8");
const desktopMain = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");
const temporaryWebCacheSchedule = fs.readFileSync(path.join(__dirname, "..", "lib", "temporary-web-cache-schedule.js"), "utf8");
const desktopPreload = fs.readFileSync(path.join(__dirname, "..", "desktop", "preload.js"), "utf8");
const assistantOverlay = fs.readFileSync(path.join(__dirname, "assistant-overlay.html"), "utf8");
const conversionFormalRuntimePath = "D:\\AICode\\运行数据\\江湖有旅人\\转化助手\\SOP正式知识库.json";
const conversionFormalRuntime = fs.existsSync(conversionFormalRuntimePath)
  ? fs.readFileSync(conversionFormalRuntimePath, "utf8")
  : "";
const promptRegistry = require("./gpt-prompt-registry");
const _routeDir = path.join(__dirname, "..", "server", "routes");
const _routeSources = fs.existsSync(_routeDir)
  ? fs.readdirSync(_routeDir).filter(f => f.endsWith(".js")).map(f => fs.readFileSync(path.join(_routeDir, f), "utf8")).join("\n")
  : "";
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8") + _routeSources;
const gptSidebar = fs.readFileSync(path.join(__dirname, "..", "integrations", "gpt-production-extension", "sidebar.js"), "utf8");
const gptBackground = fs.readFileSync(path.join(__dirname, "..", "integrations", "gpt-production-extension", "background.js"), "utf8");
const gptUserscript = fs.readFileSync(path.join(__dirname, "..", "integrations", "gpt-production-extension", "vendor", "chatgpt-conversation-tree.user.js"), "utf8");

function appFunctionSource(name, nextName) {
  const marker = `function ${name}(`;
  let start = app.indexOf(marker);
  assert.notEqual(start, -1, `missing app function: ${name}`);
  if (app.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  const end = app.indexOf(`function ${nextName}(`, start + marker.length);
  assert.notEqual(end, -1, `missing next app function: ${nextName}`);
  return app.slice(start, end).trim();
}

function isolatedAppFunction(name, nextName, context = {}) {
  return vm.runInNewContext(`(${appFunctionSource(name, nextName)}\n)`, context);
}

test("P0 primary navigation exposes the approved product workspaces and skill center", () => {
  const expected = [
    ["gptProductionTest", "内容制作"],
    ["works", "作品仓库"],
    ["distribution", "文件传输"],
    ["publishing", "在线分发"],
    ["conversion", "流量转化"],
    ["skills", "技能中心"],
    ["settings", "设置中心"]
  ];
  for (const [tab, label] of expected) {
    assert.match(html, new RegExp(`data-tab="${tab}"[^>]*>[\\s\\S]*?<span>${label}<\\/span>`));
  }
  assert.doesNotMatch(html, /data-tab="wechat"/);
  assert.doesNotMatch(html, /<span>内容生产<\/span>|<span>内容分发<\/span>|<span>公众号分发<\/span>/);
});

test("P0 keeps the mature production workspace and adds a first-class work library", () => {
  assert.match(html, /id="gptProductionTestView"/);
  assert.match(html, /id="workbenchMaterialFolders"/);
  assert.match(html, /id="workbenchTemplateList"/);
  assert.match(html, /id="gptEmbeddedHost"/);
  assert.match(html, /id="gptEmbeddedHost"/);
  assert.match(html, /id="worksView"/);
  assert.match(html, /id="worksSearchInput"/);
  assert.match(html, /id="worksList"/);
  assert.match(html, /id="addWorksToDistributionBtn"/);
});

test("内容生产 A-D 实例共享素材账本并避免冷启动同步阻塞", () => {
  assert.match(server, /SHARED_MATERIAL_ROOT/);
  assert.match(server, /MATERIAL_CLAIM_LOCK_FILE/);
  assert.match(server, /withMaterialLedgerLock/);
  assert.match(server, /CONTENT_ONLY_MODE/);
  assert.match(server, /内容生产冷启动|cold start/i);
});

test("内容生产独立实例使用现有 D 盘下载暂存目录", () => {
  assert.match(
    server,
    /CONTENT_ONLY_MODE\s*\?\s*"D:\\\\Download"\s*:\s*WORKPKG_SCRIPT_ROOT/
  );
});

test("新会话已提交后恢复时继续原对话，不回退到 new-chat 首页", () => {
  assert.match(app, /const submittedConversationCheckpoint = task\.taskType === "material"/);
  assert.match(app, /const resumeOwnedConversation = resumeCheckpoint\.resuming \|\| submittedConversationCheckpoint/);
  assert.match(app, /if \(automaticResume && !resumeOwnedConversation/);
  assert.match(app, /if \(!resumeOwnedConversation && task\.navigationUrl\)/);
  assert.match(app, /else if \(!resumeOwnedConversation && task\.navigation === "new-chat"\)/);
  assert.match(app, /const freshConversationTask = !resumeOwnedConversation && \(task\.navigation === "new-chat"/);
});

test("内容生产 A-D 实例不会用旧本地缓存重新创建外部账号", () => {
  assert.match(app, /function contentInstanceAccountIds\(\)/);
  assert.match(app, /instance-\(\[A-D\]\)/);
  assert.match(app, /CONTENT_INSTANCE_ACCOUNT_BY_ID/);
  assert.match(app, /A: "account-1"/);
  assert.match(app, /B: "account-2"/);
  assert.match(app, /C: "account-3"/);
  assert.match(app, /D: "account-4"/);
  assert.match(app, /"4331": "A"/);
  assert.match(app, /"4332": "B"/);
  assert.match(app, /"4333": "C"/);
  assert.match(app, /"4334": "D"/);
  assert.match(app, /return accountId \? new Set\(\[accountId\]\) : null/);
  assert.match(app, /const isolatedAccounts = filterContentInstanceAccounts\(accounts\.map/);
  assert.match(app, /const fallbackIds = assigned \? \[\.\.\.assigned\] : \["account-1"\]/);
  assert.match(app, /filterContentInstanceAccounts\(gptAccounts\)/);
  assert.match(app, /function filterContentInstanceRuntime\(runtime = \{\}\)/);
  assert.match(app, /filterContentInstanceRuntime\(gptWindowRuntime\)/);
  assert.match(app, /windowRuntime: filterContentInstanceRuntime\(/);
  assert.match(app, /const assignedProfiles = filterContentInstanceAccounts\(state\.profiles \|\| \[\]\)/);
});

test("GPT 前端桥接未就绪时安全停机，不抛出原生 undefined 错误或继续上传", () => {
  const start = app.indexOf("async function assertFreshConversationInjectionSafe");
  const end = app.indexOf("function findGptConversationOwnerTask", start);
  const block = app.slice(start, end);
  assert.match(block, /typeof window\.gptWorkbench\?\.inspectStatus !== "function"/);
  assert.match(block, /error\.code = "GPT_BRIDGE_UNAVAILABLE"/);
  assert.match(block, /已阻止上传/);
});

test("内容实例网页预览没有 GPT 桥接时不显示已就绪或开始入口", () => {
  assert.match(app, /previewOnly: isReadOnlyGptPreview\(\)/);
  assert.match(app, /productionStatus\.code === "preview" \? productionStatus\.message/);
  assert.match(app, /queueContinuationState = new Set\(\["paused", "pending", "stopped", "quota", "preview"\]\)/);
  assert.match(productionStatus, /网页预览未接入 GPT 桥接，已禁止开始生产/);
  assert.match(productionStatus, /primaryActionId: "gpt\.preview-only"/);
});

test("内容实例网页预览占位明确显示只读边界，并提供可更新的桥接状态节点", () => {
  assert.match(html, /data-gpt-preview-placeholder="shared"/);
  assert.match(html, /id="gptEmbeddedState"[^>]*data-tone="busy"[^>]*role="status"/);
  assert.match(html, /正在读取 GPT 窗口状态/);
  assert.match(html, /生产按钮仅在桌面桥接确认后可用/);
  assert.match(html, /id="gptTestSendBtn"[^>]*disabled[^>]*hidden/);
  assert.doesNotMatch(html, /B GPT 桌面桥接未连接/);
  assert.match(app, /const previewOnly = isReadOnlyGptPreview\(\);[\s\S]{0,120}state\.textContent = previewOnly/);
  assert.match(app, /contentInstanceDisplayLabel\(\)\}网页预览（只读）· GPT 桥接未连接/);
  assert.match(app, /state\.title = previewOnly/);
});

test("A-D 预览在运行态异步回读前也不会短暂显示可生产按钮", () => {
  assert.match(app, /function isContentInstanceBrowserPreview\(\)/);
  assert.match(app, /Boolean\(contentInstanceAccountIds\(\)\?\.size\) && !isGptRuntimeWriteAuthority\(\)/);
  assert.match(app, /return !isGptRuntimeWriteAuthority\(\) && Boolean\(assigned\?\.size\)/);
});

test("A-D 网页预览只读保护覆盖初始化、动态重绘、动作总线和直接生产入口", () => {
  assert.match(app, /installReadOnlyGptPreviewGuards\(\);\s*applyReadOnlyGptPreviewControls\(\);/);
  assert.match(app, /new MutationObserver\(/);
  assert.match(app, /document\.addEventListener\(eventName, guard, true\)/);
  assert.match(app, /const actionId = String\(input\.actionId \|\| input\.id \|\| ""\);[\s\S]{0,220}GPT_PREVIEW_BLOCKED_ACTIONS\.has\(actionId\)/);
  assert.match(app, /async function sendNextGptTestTask\(options = \{\}\) \{[\s\S]{0,140}rejectGptPreviewWrite\("gpt\.continue"\)/);
  assert.match(app, /async function runIndependentGptWindow\(accountId = activeGptAccountId, options = \{\}\) \{[\s\S]{0,140}isReadOnlyGptPreview\(\)/);
  assert.match(app, /\["click", "change", "input", "submit", "keydown"\]\.forEach/);
  assert.match(app, /\[data-gpt-test-material-check\].*[\s\S]*\[data-gpt-test-template-check\]/);
  assert.match(app, /const target = event\.target\?\.closest\?\.\(selector\);[\s\S]{0,360}if \(!target\) return;/);
  assert.match(app, /\[data-browser-toggle-disable\], \[data-browser-toggle\], \[data-browser-recovery\]/);
  assert.doesNotMatch(app, /const target = event\.target\?\.closest\?\.\(selector\);[\s\S]{0,120}target\.closest\?\.\("#gptProductionTestView"\)/);
});

test("左侧主导航模块支持拖动排序并持久化，不影响页面内部卡片", () => {
  assert.match(html, /id="workflowRail"/);
  assert.match(app, /WORKFLOW_RAIL_ORDER_STORAGE_KEY/);
  assert.match(app, /function setupWorkflowRailSorting\(\)/);
  assert.match(app, /tab\.draggable = true/);
  assert.match(app, /localStorage\.setItem\(WORKFLOW_RAIL_ORDER_STORAGE_KEY/);
  assert.match(css, /is-rail-drop-target/);
});

test("技能中心把聊天提取和流量转化维护接成可运行入口", () => {
  assert.match(html, /id="skillsView"/);
  assert.match(html, /id="skillsGrid"/);
  assert.match(html, /id="refreshSkillsBtn"/);
  assert.match(app, /api\("\/api\/skills"\)/);
  assert.match(app, /data-skill-run/);
  assert.match(app, /encodeURIComponent\(skillId\).*\/run/);
  assert.match(server, /wechat-chat-analysis/);
  assert.match(server, /jianghu-sop-maintainer/);
  assert.match(server, /api\/扫描聊天源/);
  assert.match(server, /getConversionSnapshot\(\{ includeLargeIndexes: true \}\)/);
  assert.match(css, /\.skills-chain/);
  assert.match(css, /\.skill-card/);
});

test("模板仓库技能提供宽输入、完整提示、HTML入口和收录按钮", () => {
  assert.match(app, /data-skill-template-input/);
  assert.match(app, /data-template-repository-open/);
  assert.match(app, /data-template-repository-run/);
  assert.match(app, /模板仓库添加整理/);
  assert.match(app, /function runTemplateRepositorySkillCard/);
  assert.match(app, /function installTemplateRepositoryQuickInputs/);
  assert.match(app, /data-template-quick-drop/);
  assert.match(app, /body: JSON\.stringify\(\{ text, paths, files \}\)/);
  assert.match(app, /function openTemplateRepository/);
  assert.match(app, /\/api\/skills\/template-repository-maintainer\/repository/);
  assert.match(app, /模板名称、文字描述、来源链接或本地路径/);
  assert.match(app, /拖入图片 \/ Ctrl\+V/);
  assert.match(app, /自动识别、登记来源、打标签并提示缺口/);
  assert.match(app, />打开 HTML</);
  assert.match(app, />收录</);
  assert.match(server, /TEMPLATE_REPOSITORY_SKILL_ID/);
  assert.match(server, /title: "模板仓库添加整理"/);
  assert.match(server, /category: "模板"/);
  assert.match(app, /const category = isTemplateSkill \? "模板"/);
  assert.match(server, /sync:template-registry/);
  assert.match(server, /maintain:global-template-repository/);
  assert.match(css, /\.skill-quick-entry/);
  assert.match(css, /data-skill-card="template-repository-maintainer"/);
  assert.match(app, /data-tooltip="模板输入支持文字、链接、路径、图片和文件夹/);
  assert.match(css, /is-dragging/);
});

test("图文工作台素材区说明连接江湖工具箱下载后整理技能", () => {
  assert.match(html, /gpt-test-material-card[^>]*data-tooltip="[^"]*江湖工具箱只负责下载[^"]*20个可见字符[^"]*不完整视频或TXT残留不会自动删除/);
  assert.match(app, /素材区怎么维护[\s\S]*江湖工具箱只负责把帖子下载到本地[\s\S]*按20个可见字符[\s\S]*整包移入01-素材库/);
});

test("无 TXT 素材在诊断中进入采集候选，但不进入生产选择", () => {
  assert.match(server, /analyzeCollectionCandidates/);
  assert.match(server, /collection: collectionSummary/);
  assert.match(app, /data-material-collection-copy/);
  assert.match(app, /缺 TXT 但有图片/);
  assert.match(app, /采集词：/);
  assert.match(css, /\.material-collection-tools/);
});

test("dashboard首屏延后分发明细并使用轻量实时快照轮询", () => {
  assert.match(app, /dashboardInitialLoad/);
  assert.match(app, /params\.set\("lite", "1"\)/);
  assert.match(app, /fetch\(summaryOnly \? "\/api\/distribution\/live\?summary=1" : "\/api\/distribution\/live"/);
  assert.match(app, /dashboardLoadInFlight/);
  assert.match(server, /parsed\.query\.lite === "1"/);
  assert.match(server, /pathname === "\/api\/distribution\/live"/);
  assert.match(server, /snapshotDeferred: true/);
  assert.match(server, /LIVE_DISTRIBUTION_CACHE_TTL_MS/);
  assert.match(server, /force: parsed\.query\.refresh === "1"/);
  assert.match(server, /pathname === "\/api\/runtime-info"/);
  assert.match(server, /parsed\.query\.summary === "1"/);
  assert.match(app, /RUNTIME_VERSION_RELOAD_KEY/);
  assert.match(app, /hasPersistedGptTask/);
  assert.match(app, /assetVersion/);
  assert.match(app, /document\.scripts/);
  assert.match(app, /api\/distribution\/live\?summary=1/);
  assert.match(app, /liveDistributionPollInFlight/);
  assert.match(app, /new AbortController\(\)/);
  assert.match(app, /refreshExpandedGptMaterialTrees\(\)[\s\S]*?loadMaterialCategory\(categoryPath, \{ includeDiagnostics: false \}\)/);
  assert.match(app, /function hasActiveGptProductionWorker\(\)[\s\S]*?state\.autoRunning \|\| state\.armed/);
  assert.match(app, /if \(\$\("#gptProductionTestView"\)\?\.classList\.contains\("active"\)[\s\S]*?\|\| hasActiveGptProductionWorker\(\)\) return/);
  assert.match(app, /if \(hasActiveGptProductionWorker\(\)\) return;[\s\S]*?lastMaterialStaleTime = staleTime/);
});

test("作品仓库不会把首屏轻量快照误报为空，并会补取完整作品扫描", () => {
  assert.match(app, /正在读取作品仓库/);
  assert.match(app, /正在扫描本机成品目录，不会移动、删除或修改作品/);
  assert.match(app, /if \(name === "works"\) \{[\s\S]*?dashboard\?\.dashboardLite === true/);
  assert.match(app, /作品仓库读取失败/);
});

test("内容制作不会停留在首屏轻量快照，会补取素材库和模板库", () => {
  const start = app.indexOf('if (name === "gptProductionTest")');
  const end = app.indexOf('} else if (window.gptWorkbench?.available)', start);
  const block = app.slice(start, end);
  assert.match(block, /dashboard\?\.dashboardLite === true/);
  assert.match(block, /loadDashboard\(false\)/);
  assert.match(block, /renderGptTestMaterials\(\)/);
  assert.match(block, /renderGptTestTemplates\(\)/);
});

test("GPT 重启恢复按素材身份合并旧日志，不把已归档 8/8 作品降级成新上传", () => {
  assert.match(app, /function gptMaterialLogEntryMatchesTask\(task, entry\)/);
  assert.match(app, /materialEntries = task\._submittedToGpt === true/);
  assert.match(app, /downloadedCount/);
  assert.match(app, /archivedCount/);
  assert.match(app, /observedImageCount/);
  assert.match(app, /不重复补图或补计划/);
  assert.match(gptSidebar, /submittedToGpt: Boolean\(task\.workflow\?\.planSubmitted/);
});

test("计划完成但尚未扣1时优先清除过期生图检查点并恢复确认步骤", () => {
  assert.match(app, /const livePlanConfirmationBoundary = Boolean\(/);
  assert.match(app, /livePlanConfirmationBoundary && \([\s\S]*?workflow\.imageSubmitted = false/);
  assert.match(app, /task\.reconcileAction = "resume-current-plan"/);
  assert.match(app, /livePlanConfirmationBoundary \? "等待确认出图" : "等待迁移计划"/);
  assert.match(gptSidebar, /plan-confirmation-boundary-reconciled/);
  assert.match(gptSidebar, /网页当前停在计划完成、等待回复 1/);
  assert.match(gptSidebar, /!livePlanConfirmationBoundary && \["images-ready", "waiting-images"/);
});

test("手动清空未发送输入会建立用户暂停边界，不会自动回填素材", () => {
  assert.match(gptSidebar, /installComposerClearObserver\(\)/);
  assert.match(gptSidebar, /USER_CLEARED_UNSENT_COMPOSER/);
  assert.match(gptSidebar, /不自动回填/);
  assert.match(app, /USER_CLEARED_UNSENT_COMPOSER/);
  assert.match(app, /workerState\.pausedByUser = true/);
  assert.match(app, /task\._dispatchingToGpt = true/);
  assert.match(app, /status\.submittedToGpt === true/);
});

test("旧版提前打标但没有远端提交证据时，重启恢复只重新上传当前素材", () => {
  assert.match(app, /function downgradeStalePreSubmitGptTask\(task, runtime = \{\}\)/);
  assert.match(app, /const staleBoundary = \["GPT_PAGE_RELOADED", "RESTART_INTERRUPTED", "USER_CLEARED_UNSENT_COMPOSER"\]/);
  assert.match(app, /if \(hasRemoteWorkflow \|\| !staleBoundary\) return false/);
  assert.match(app, /task\._submittedToGpt = false/);
  assert.match(app, /按当前素材安全重新上传/);
});

test("空首页与本地已提交标记冲突时只重置新会话边界，不重置真实 /c 对话", () => {
  assert.match(app, /function isEmptyFreshGptLiveBoundary\(inspection = \{\}\)/);
  assert.match(app, /async function reconcileFreshGptTaskAgainstLiveBoundary\(task, accountId\)/);
  assert.match(app, /async function reconcileSubmittedGptTaskAgainstLiveBoundary\(task, accountId, workerState\)/);
  assert.match(app, /const liveSubmittedCheckpoint = await reconcileSubmittedGptTaskAgainstLiveBoundary\(/);
  assert.match(app, /const taskConversationUrl = canonicalGptConversationUrl\(/);
  assert.match(app, /liveConversationUrl !== taskConversationUrl/);
  assert.match(app, /if \(canonicalGptConversationUrl\(task\.conversationUrl \|\| task\.browserConversationUrl\)\) return false/);
  assert.match(app, /const liveFreshBoundaryReset = await reconcileFreshGptTaskAgainstLiveBoundary\(task, account\.id\)/);
  assert.match(app, /task\._submittedToGpt = false;[\s\S]*?task\.workflow = \{\};[\s\S]*?task\.forceUpload = true/);
  assert.match(app, /task\.navigation = "new-chat"/);
  assert.match(app, /workflow\.generatedImageUrls = uniqueGeneratedImageUrls\(\[/);
});

test("重启发生在新会话首轮发送后时，按同一素材认领原 /c 对话而不重复上传", () => {
  assert.match(app, /function freshGptTaskHasLiveSubmittedEvidence\(task = \{\}, inspection = \{\}\)/);
  assert.match(app, /async function reconcileFreshNavigationTaskAgainstLiveConversation\(accountId, workerState, task\)/);
  assert.match(app, /const adoptedFreshTask = await reconcileFreshNavigationTaskAgainstLiveConversation\(/);
  assert.match(app, /task\.navigation = "";/);
  assert.match(app, /task\._freshConversationBootstrap = false;/);
  assert.match(app, /task\._submittedToGpt = true;/);
  assert.match(app, /task\.conversationUrl = liveUrl;/);
  assert.match(app, /freshGptTaskHasLiveSubmittedEvidence\(task, inspection\)/);
  assert.match(app, /task\._freshConversationBootstrap === true/);
});

test("新会话任务已提交但实时会话素材不一致时阻止串线继续", () => {
  assert.match(app, /sameMaterial === false \? "conversation-owner-mismatch"/);
  assert.match(app, /当前新会话任务已提交，但 GPT 实时会话素材不一致/);
  assert.match(app, /GPT_SUBMITTED_BOUNDARY_PENDING/);
  assert.match(app, /const taskOwnerConfirmed = activeTask\?\._conversationLogOwnerConfirmed === true/);
  assert.match(app, /const freshRoot = freshSession && !taskOwnerConfirmed/);
  assert.match(app, /const url = freshRoot \? "" : knownGptConversationUrl\(key, runtime\)/);
});

test("恢复链清理游离的后续 running 标记并保留账号队列串行所有权", () => {
  assert.match(app, /function normalizeFutureIndependentQueueTaskStatuses\(workerState\)/);
  assert.match(app, /index <= cursor/);
  assert.match(app, /task\._submittedToGpt === true/);
  assert.match(app, /task\._status = "queued";/);
  assert.match(app, /normalizeFutureIndependentQueueTaskStatuses\(workerState\)/);
});

test("心跳中断恢复优先传递已提交任务的原对话，不把游离任务误判成首页", () => {
  assert.match(app, /const recoveryConversationUrl = knownGptConversationUrl\(/);
  assert.match(app, /recoveryConversationUrl\n/);
  assert.match(desktopPreload, /recoveryConversationUrl: String\(stopOptions\.recoveryConversationUrl \|\| ""\)/);
  assert.match(desktopMain, /function durableSubmittedConversationUrl\(accountId, runtimeState = null\)/);
  assert.match(desktopMain, /const suppliedRecoveryUrl = normalizeChatConversationUrl\(input\.recoveryConversationUrl/);
  assert.match(desktopMain, /const freshRoot = isFreshRootGptTaskPending\(account, runtimeState\)[\s\S]{0,160}!suppliedRecoveryUrl/);
  assert.match(desktopMain, /suppliedRecoveryUrl\n\s*\|\| persistedSubmittedUrl/);
});

test("works repository keeps the header compact and opens its configured folder from the path row", () => {
  assert.match(html, /id="worksView"[\s\S]*?class="page-heading"/);
  assert.doesNotMatch(html, /id="openPublishRootBtn"/);
  assert.match(html, /id="openCollectionRootBtn"/);
  assert.match(html, /id="openCollectionRootBtn"[\s\S]*?id="chooseCollectionRootBtn"/);
  assert.match(app, /\$\("#openCollectionRootBtn"\)\?\.addEventListener\("click"/);
  assert.match(app, /\$\("#collectionRootInput"\)\?\.value/);
  assert.match(app, /await openPath\(configuredPath\)/);
  assert.match(css, /#worksView \.collection-layout > \.page-heading/);
  assert.match(css, /#worksView \.folder-source-bar[\s\S]*?grid-template-columns: minmax\(0, 1\.35fr\)/);
});

test("generic transfer picker prefers native desktop dialogs and keeps browser fallback", () => {
  assert.match(desktopPreload, /pickFolder\(options = \{\}\)/);
  assert.match(desktopPreload, /pickFile\(options = \{\}\)/);
  assert.match(desktopMain, /ipcMain\.handle\("desktop:pick-file"/);
  assert.match(app, /window\.desktopDialogs\?\.pickFolder/);
  assert.match(app, /window\.desktopDialogs\?\.pickFile/);
  assert.match(app, /const endpoint = kind === "folder" \? "\/api\/pick-folder" : "\/api\/pick-file"/);
});

test("device transfer keeps edited label separate from transport identity", () => {
  assert.match(app, /function preferredDeviceLabel\(device = \{\}\)/);
  assert.match(app, /function transferStageLabel\(task = \{\}\)/);
  assert.match(app, /正在发送到 \$\{label\}/);
  assert.match(app, /deviceLabel: preferredDeviceLabel\(device\)/);
  assert.match(app, /task\.deviceLabel \|\| task\.device/);
  assert.match(app, /data-device-label=/);
  assert.match(server, /deviceLabel: String\(body\.deviceLabel \|\| ""\)/);
  assert.match(server, /deviceLabel: String\(options\.deviceLabel \|\| ""\)/);
});

test("device rows show one editable computer label and keep inventory on the second line", () => {
  assert.match(app, /const label = preferredDeviceLabel\(device\)/);
  assert.match(app, /(?:const inventoryLabel = device\.workCount == null \? "手机储备未上报"|const inventoryLabel = counts[\s\S]*?device\.workCount == null \? "手机储备未上报")/);
  assert.match(app, /class="device-inventory-line"/);
  assert.match(app, /device\.note\n\s*\|\| device\.liveName/);
  assert.match(server, /noteIsCustom: hasSavedNote/);
  assert.match(server, /syncedName/);
  assert.match(server, /id\.startsWith\("discovered-"\)/);
  assert.match(css, /\.device-inventory-line[\s\S]*?text-overflow: ellipsis/);
});

test("file transfer help explains the real workflow and recovery path", () => {
  assert.match(app, /title: "文件传输说明"/);
  for (const phrase of [
    "首次使用",
    "手动发送",
    "自动分发",
    "泛 \/ 精准",
    "失败恢复",
    "去重规则",
    "操作记录",
    "看不到设备",
    "库存未上报"
  ]) {
    assert.match(app, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")));
  }
  assert.match(css, /\.system-dialog[\s\S]*?max-height: min\(780px, calc\(100vh - 48px\)\)/);
  assert.match(css, /\.system-dialog[\s\S]*?overflow-y: auto/);
});

test("every auxiliary workspace has a detailed page help entry", () => {
  for (const viewId of ["gptProductionTestView", "promptsView", "conversionView", "juguangView", "workflowView"]) {
    assert.match(app, new RegExp(`${viewId}:\\s*\\{`));
    assert.match(html, new RegExp(`data-page-help="${viewId}"`));
  }
  for (const phrase of ["内容制作说明", "提示词管理说明", "流量转化说明", "聚光运营说明", "自动化工作流说明"]) {
    assert.match(app, new RegExp(phrase));
  }
  assert.match(css, /\.juguang-hero-actions/);
  assert.match(css, /\.workflow-panel-heading/);
});

test("page help renders tuple details instead of blank labels", () => {
  assert.match(app, /Array\.isArray\(item\)[\s\S]*?label: item\[0\][\s\S]*?value: item\[1\]/);
  assert.match(app, /\["全链路知识库",\s*"这里是从来源材料提炼出的经营总览/);
});

test("material, work and device pickers share grouped tag dropdown filters", () => {
  assert.match(html, /id="gptMaterialTagFilters"/);
  assert.match(html, /id="worksTagFilters"/);
  assert.match(app, /renderTagFilterBar\("gptMaterialTagFilters"/);
  assert.match(app, /renderTagFilterBar\("worksTagFilters"/);
  assert.match(app, /renderTagFilterBar\("distributionTagFilters"/);
  assert.match(app, /tagGroupRegistry/);
  assert.match(app, /data-tag-filter-option/);
});

test("grouped tag filters remain readable in both midnight themes", () => {
  assert.match(css, /body\[data-theme="midnight"\] \.tag-filter-bar/);
  assert.match(css, /body\[data-theme="midnight-glass"\] \.tag-filter-dropdown > summary/);
  assert.match(css, /body\[data-theme="midnight"\] \.tag-filter-menu/);
  assert.match(css, /body\[data-theme="midnight-glass"\] \.tag-filter-options span/);
});

test("tag filter bars wrap controls when the panel is narrow", () => {
  assert.match(css, /\.tag-filter-bar \{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(css, /\.tag-filter-dropdown \{[\s\S]*?flex:\s*0 0 auto/);
});

test("the complete work library uses dark surfaces instead of light collection cards", () => {
  for (const theme of ["midnight", "midnight-glass"]) {
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] \\.collection-layout \\.folder-source-bar`));
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] \\.collection-layout \\.workflow-stage-tabs`));
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] \\.collection-row`));
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] \\.work-tag-strip i`));
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] \\.works-action-dock`));
  }
});

test("work library warehouse stages use generic labels and safe local configuration", () => {
  assert.match(app, /const COLLECTION_STAGE_DEFAULTS = \{/);
  assert.match(app, /仓库 1（抖音小红书可发）/);
  assert.match(app, /仓库 2（微信公众号可发）/);
  assert.match(app, /仓库 3（已发送）/);
  assert.match(app, /teambuilding-collection-stage-settings-v1/);
  assert.match(app, /data-collection-stage-context/);
  assert.match(app, /kind: "collection-stage"/);
  assert.match(app, /contextSetCollectionPathManual/);
  assert.match(html, /id="contextResetCollectionStage"/);
  assert.match(html, /id="contextSetCollectionPathManual"/);
  assert.match(css, /body \.collection-toggle[\s\S]*?width:\s*30px[\s\S]*?height:\s*30px[\s\S]*?border-radius:\s*10px/);
  for (const theme of ["midnight", "midnight-glass"]) {
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] \\.collection-layout \\.collection-toggle`));
  }
});

test("every primary workspace has explicit midnight theme surfaces", () => {
  for (const theme of ["midnight", "midnight-glass"]) {
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] #conversionView`));
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] :is\\(#worksView, #distributionView, #publishingView, #settingsView\\)`));
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] #conversionView :is\\(\\.conversion-source-stats span`));
  }
});

test("online publishing dark themes cover native editor and checker controls", () => {
  for (const theme of ["midnight", "midnight-glass"]) {
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] #publishingView :is\\(\\.wechat-web-surface, \\.checker-image-item, \\.checker-title-input, \\.checker-body-input\\)`));
  }
  assert.match(css, /#publishingView :is\(\.wechat-web-surface, \.checker-image-item\)/);
});

test("device distribution dark themes cover device rows and transport states", () => {
  for (const theme of ["midnight", "midnight-glass"]) {
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] #distributionView :is\\(\\.device-row, \\.record-row, \\.official-card, \\.distribution-package-row, \\.device-platform-icon\\)`));
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] #distributionView \\.transport-tag\\.is-active`));
  }
});

test("dark themes cover the complete distribution shell and shared publishing package rows", () => {
  for (const theme of ["midnight", "midnight-glass"]) {
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] :is\\(#distributionView, #publishingView\\)`));
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] :is\\(#distributionView, #publishingView\\) :is\\([\\s\\S]*?\\.distribution-stage-tabs`));
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] :is\\(#distributionView, #publishingView\\) \\.state-badge`));
    assert.match(css, new RegExp(`body\\[data-theme="${theme}"\\] :is\\(#distributionView, #publishingView\\) :is\\([\\s\\S]*?\\.distribution-package-row`));
  }
});

test("grouped tag dropdowns escape scroll-card clipping and open below the trigger", () => {
  assert.match(css, /\.workbench-card:has\(\.tag-filter-dropdown\[open\]\)/);
  assert.match(css, /\.gpt-production-test-library:has\(\.tag-filter-dropdown\[open\]\)/);
  assert.match(css, /\.tag-filter-menu \{[\s\S]*?position:\s*fixed/);
  assert.match(app, /function positionOpenTagFilterDropdown/);
  assert.match(app, /document\.addEventListener\("toggle"[\s\S]*tag-filter-dropdown/);
  assert.match(app, /menu\.style\.top = `\$\{top\}px`/);
});

test("content production material filters keep the menu anchored to the trigger", () => {
  assert.match(css, /\.gpt-production-test-library \.gpt-test-material-card:has\(\.tag-filter-dropdown\[open\]\)[\s\S]*?transform:\s*none\s*!important/);
  assert.match(css, /\.gpt-production-test-library \.gpt-test-material-card:has\(\.tag-filter-dropdown\[open\]\) \.tag-filter-bar[\s\S]*?transform:\s*none\s*!important/);
});

test("dark navigation rail keeps conversion icon outline-only", () => {
  assert.match(css, /body\[data-theme="midnight"\] \.workflow-rail \.rail-tab svg[\s\S]*?fill:\s*none/);
  assert.match(css, /body\[data-theme="midnight-glass"\] \.workflow-rail \.rail-tab svg[\s\S]*?fill:\s*none/);
});

test("dark navigation active item has no stray bottom shadow or pseudo-element", () => {
  assert.match(css, /body\[data-theme="midnight"\] \.workflow-rail \.rail-tab\.active[\s\S]*?box-shadow: inset 3px 0 0/);
  assert.match(css, /body\[data-theme="midnight-glass"\] \.workflow-rail \.rail-tab::before/);
  assert.match(css, /body\[data-theme="midnight-glass"\] \.workflow-rail \.rail-tab::after/);
});

test("rail brand title stays compact beside the navigation control", () => {
  assert.match(css, /\.rail-brand-copy strong\s*\{[\s\S]*?font-size: 13px/);
});

test("tag filter bars show only actionable group controls", () => {
  assert.doesNotMatch(app, /tag-filter-help/);
  assert.doesNotMatch(app, />标签筛选\s*</);
});

test("work rows expose inferred tags and a persisted manual override action", () => {
  assert.match(app, /data-edit-work-tags/);
  assert.match(app, /\/api\/works\/tags/);
  assert.match(app, /item\.tagGroups/);
});

test("P0 online publishing shell keeps WeChat and marks future platforms truthfully", () => {
  assert.match(html, /id="publishingView"/);
  assert.match(html, /data-publishing-platform="wechat"[^>]*>公众号/);
  assert.match(html, /data-publishing-platform="xiaohongshu"[^>]*>小红书/);
  assert.match(html, /data-publishing-platform="douyin"[^>]*>抖音/);
  assert.match(html, /data-publishing-platform="x"[^>]*>X \/ 推特/);
  assert.match(html, /data-publishing-platform="ctrip"[^>]*>携程旅行/);
  assert.match(html, /id="distributionOfficial"/);
  assert.match(html, /id="publishingAdapterPanel"/);
  assert.match(app, /待接入/);
});

test("online publishing platform tabs expose an explicit selected state and compact status labels", () => {
  assert.match(html, /nav class="publishing-platform-tabs"[^>]*role="tablist"/);
  for (const platform of ["wechat", "xiaohongshu", "douyin", "x", "ctrip"]) {
    assert.match(html, new RegExp(`role="tab"[^>]*aria-selected="(?:true|false)"[^>]*data-publishing-platform="${platform}"`));
  }
  assert.match(html, /data-publishing-platform="wechat"[\s\S]*?<span class="platform-tab-status">已接入<\/span>/);
  assert.match(html, /data-publishing-platform="ctrip"[\s\S]*?<span class="platform-tab-status">可批量存草稿<\/span>/);
  assert.match(app, /tab\.setAttribute\("aria-selected", String\(isActive\)\)/);
  assert.match(app, /data-manual-open/);
  assert.match(app, /data-manual-copy/);
  assert.match(app, /data-prepare-manual-platform/);
  assert.match(app, /function renderManualPlatformPanel\(/);
  assert.match(app, /data-publishing-action-slot/);
  assert.match(app, /publishing-help/);
  assert.match(app, /function renderCtripDraftBatchPanel\(\)/);
  assert.match(app, /function startCtripDraftBatch\(\)/);
  assert.match(app, /window\.onlinePlatformWorkbench\?\.ctripDraft/);
  assert.match(app, /只允许调用“存草稿”/);
  assert.doesNotMatch(html, /publishingComingSoon/);
  assert.match(html, /id="publishingWorkbench"/);
  assert.match(html, /class="publishing-library-pane"/);
  assert.match(app, /未配置前可以编辑和复制发布包，但不会调用适配器/);
});

test("online publishing uses the existing work library and gives every platform an actionable right pane", () => {
  assert.match(html, /id="publishingLibrarySearch"/);
  assert.match(html, /data-publishing-library-filter="traffic"/);
  assert.match(html, /id="publishingCollectionList"/);
  assert.match(html, /id="wechatDraftRight"/);
  assert.match(app, /renderPublishingLibrary\(visibleOfficialCollections, officialCollections, officialAvailableCount\)/);
  assert.match(app, /dashboard\?\.dashboardLite === true/);
  assert.match(app, /void loadWechatDraftPosts\(platformVisibleOfficialCollections\[0\]\.name\)/);
  assert.match(app, /wechatDraftSelectedPost = wechatDraftPosts\[0\] \|\| null/);
  assert.match(app, /function syncPublishingSelectedWork\(post = null\)/);
  assert.match(app, /data-copy-platform-package/);
  assert.match(app, /publishingSelectedWork\?\.collectionName/);
  assert.match(html, /data-publishing-flow-rail/);
  assert.match(html, /data-publishing-flow-step="select"/);
  assert.match(app, /function syncPublishingFlowRail\(\)/);
  assert.match(app, /function renderPublishingSelectionSummary\(/);
  assert.match(app, /renderPublishingSelectionSummary\(work\)/);
});

test("online publishing right panes use the content-workbench split with a real platform web surface", () => {
  assert.match(html, /class="publishing-workbench"/);
  assert.match(html, /class="publishing-library-pane"/);
  assert.match(html, /class="[^"]*publishing-platform-web-panel[^"]*" id="distributionOfficial"/);
  assert.match(app, /function renderPublishingPlatformWebPanel\(\)/);
  assert.match(app, /PUBLISHING_PLATFORM_WEB_HOME_URLS/);
  for (const action of ["data-publishing-web-nav", "data-publishing-web-copy", "publishingPlatformWebHost", "publishingPlatformWebAddress"]) {
    assert.match(app, new RegExp(action));
  }
  assert.match(app, /publishing-web-more/);
  assert.match(app, /publishing-web-reload-button/);
  assert.match(app, /ctrip-draft-batch-safety-details/);
  assert.match(app, /function copyPublishingCurrentWork\(/);
  assert.match(desktopPreload, /onlinePlatformWorkbench/);
  assert.match(desktopMain, /ONLINE_PLATFORM_WEB_CONFIG/);
  assert.match(desktopMain, /desktop:online-platform-show/);
  assert.match(css, /\.publishing-platform-web-shell\s*\{/);
  assert.match(css, /\.publishing-platform-web-host\s*\{/);
  assert.match(css, /\.publishing-web-more-menu\s*\{/);
  assert.match(css, /@media \(max-height: 900px\)/);
  assert.match(css, /\.publishing-platform-web-surface\s*\{[\s\S]*?min-height: 340px/);
});

test("online publishing serializes catalog reads and recovers platform panels after a short local restart", () => {
  assert.match(app, /platformPublishingCatalogRequest/);
  assert.match(app, /platformPublishingPanelRequestId/);
  assert.match(app, /const isCurrentRequest = \(\) => requestId === platformPublishingPanelRequestId/);
  assert.match(app, /transientNetworkFailure = \/网络请求失败（\\\/api\\\/platform-publishing\\\/platforms）\//);
  assert.match(app, /本地服务正在恢复/);
  assert.match(app, /data-refresh-platform-publishing/);
  assert.match(app, /loadPlatformPublishingPanel\(activePlatform, \{ force: true \}\)/);
  assert.match(css, /\.publishing-state-error/);
  assert.match(css, /\.publishing-state-recovering/);
});

test("online publishing keeps the selected platform after the background library refresh", () => {
  assert.match(app, /const selectedPlatform = \$\("\[data-publishing-platform\]\.active"\)\?\.dataset\.publishingPlatform \|\| "wechat"/);
  assert.match(app, /const currentPlatform = \$\("\[data-publishing-platform\]\.active"\)\?\.dataset\.publishingPlatform \|\| "wechat"/);
  assert.match(app, /if \(currentPlatform !== selectedPlatform\) return/);
  assert.match(app, /\$\("#distributionOfficial"\)\?\.classList\.add\("active"\)/);
  assert.match(app, /setPublishingPlatform\(selectedPlatform\)/);
  assert.match(app, /setPublishingPlatform\(activePublishingPlatformId\(\)\)/);
  assert.doesNotMatch(app, /setPublishingPlatform\("wechat"\)/);
});

test("online publishing recomputes the left library summary after a platform switch", () => {
  assert.match(app, /function refreshPublishingLibraryForActivePlatform\(\)/);
  assert.match(app, /renderPublishingLibrary\(visibleOfficialCollections, officialCollections, officialAvailableCount\)/);
  assert.match(app, /selectFirstEligiblePublishingPost\(\);[\s\S]{0,220}refreshPublishingLibraryForActivePlatform\(\)/);
});

test("online publishing clears the right post list when the selected collection leaves the active usage filter", () => {
  assert.match(app, /let publishingDraftSelectionWasReset = false/);
  assert.match(app, /publishingDraftSelectionWasReset = true/);
  assert.match(app, /if \(publishingDraftSelectionWasReset\) renderWechatDraftRight\(\)/);
  assert.match(app, /wechatDraftSelectedCollection\s*\?\s*`<div class="empty-state"><strong>没有找到帖子/);
  assert.match(app, /<strong>请先选择作品集<\/strong><p>左侧筛选出可用成品后/);
});

test("online publishing refreshes the selected-work summary after loading the authoritative source", () => {
  assert.match(app, /publishingSelectedWork = \{[\s\S]*?source\.body \|\| publishingSelectedWork\.preview/);
  assert.match(app, /summary\.outerHTML = renderPublishingSelectionSummary\(publishingSelectedWork\)/);
  assert.match(app, /syncPublishingFlowRail\(\);/);
});

test("online publishing chrome stays compact so the real WeChat workbench gets the first screen", () => {
  assert.match(css, /#publishingView \.wechat-publishing-heading\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /#publishingView \.publishing-platform-tabs button\s*\{[\s\S]*?min-height:\s*26px/);
  assert.match(css, /#publishingView \.publishing-flow-step small\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /#distributionOfficial \.account-status-card\.ready > p\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /@media \(max-height: 760px\)\s*\{[\s\S]*?\.publishing-flow-rail\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /\.publishing-action-zone\s*\{/);
  assert.match(css, /\.publishing-help\s*\{/);
  assert.match(html, /id="distributionOfficial"/);
});

test("P0 device distribution keeps the main surface compact and exposes its core panels", () => {
  assert.doesNotMatch(html, /data-distribution-workspace=/);
  assert.match(html, /id="distributionDevices"/);
  assert.match(html, /id="distributionHistory"/);
  assert.match(html, /id="distributionDropZone"/);
  assert.doesNotMatch(html, /不改原文件/);
  assert.match(html, /拖入文件或文件夹后，在设备卡片上发送/);
  assert.match(app, /data-send-dropped/);
  assert.match(app, /for \(const sourcePath of paths\) await startGenericTransfer\(deviceId, sourcePath\)/);
});

test("manual mobile distribution gives immediate picker feedback and stops click fall-through", () => {
  assert.match(app, /const sendPackage = event\.target\.closest\("\[data-send-package\]"\)/);
  assert.match(app, /const sendPackage = event\.target\.closest\("\[data-send-package\]"\);[\s\S]*?event\.preventDefault\(\);[\s\S]*?toast\("已打开设备选择，请选择在线且空闲的手机"\);[\s\S]*?return;/);
  assert.match(app, /function isDistributionDeviceBusy\(device = \{\}\)/);
  assert.match(app, /data-confirm-package-device=.*disabled.*接收中 · 请稍候/);
  assert.match(css, /\.device-picker-list > button:disabled\s*\{/);
});

test("manual mobile distribution explains a busy receiver instead of silently failing", () => {
  assert.match(app, /设备正在接收上一批/);
  assert.match(app, /当前发送未重复建立，请等待手机回到空闲后再发送/);
  assert.match(app, /error\.status === 409/);
});

test("transfer progress is owned by the assistant instead of a duplicate task panel", () => {
  assert.match(html, /id="workbenchAssistantTransferProgress"/);
  assert.doesNotMatch(app, /<article class="summary-card"><span>进行中任务<\/span>/);
  assert.match(app, /function renderAssistantTransferProgress\(\)/);
  assert.match(app, /activeTransferUiTasks\(\)/);
  assert.match(app, /renderAssistantTransferProgress\(\);/);
  assert.match(css, /\.assistant-transfer-progress-bar\s*\{/);
});

test("P0 work library exposes stable work identity and global one-success distribution state", () => {
  assert.match(server, /WORK_DISTRIBUTION_LEDGER_FILE/);
  assert.match(server, /WORK_DISTRIBUTION_CLAIMS_ROOT/);
  assert.match(server, /acquireWorkDistributionClaims/);
  assert.match(server, /configuredDistributionSendRoots\(getPageSettings\(\)\.distribution/);
  assert.match(server, /受管作品目录必须选择包含图片和 TXT 的完整作品文件夹/);
  assert.match(server, /DUPLICATE_DISTRIBUTION_BLOCKED/);
  assert.match(server, /DISTRIBUTION_COLLECTION_REQUIRED/);
  assert.match(server, /旧的按分类自动挑选补货入口已停用/);
  assert.match(server, /recordSuccessfulWorkDistribution/);
  assert.match(server, /作品中已有成功分发记录，不能再次自动分发/);
  assert.match(app, /已拦截重复发送/);
  assert.doesNotMatch(app, /确认仍然发送/);
  assert.match(app, /自动和手动都不能再发到其他设备或账号/);
});

test("P0 settings center leaves skill-specific configuration inside the skill center", () => {
  for (const label of ["通用设置", "数据与同步", "系统与维护"]) {
    assert.match(html, new RegExp(`data-settings-jump="[^"]+">${label}<\\/button>`));
  }
  assert.match(html, /这里只放跨页面的全局配置/);
  assert.doesNotMatch(html, /data-settings-jump="skills"/);
  assert.doesNotMatch(html, /id="momentsSettingsCard"|id="skillsSettingsCard"/);
  assert.doesNotMatch(html, /id="skillCenterEnabled"|id="materialIngestionSkillEnabled"/);
  assert.match(html, /id="skillsCenterSettingsBtn"/);
  assert.match(app, /function openSkillsCenterSettingsPanel\(\)/);
  assert.match(app, /data-skills-center-field="enabled"/);
  assert.match(app, /function isSkillCenterEnabled\(\)/);
  assert.match(html, /id="assistantCatVisible"/);
  assert.match(html, /id="workbenchMaterialRoot"/);
  assert.match(html, /id="autoDistributionEnabled"/);
  assert.match(html, /id="gptModeQuickTabs"/);
});

test("GPT image detection prioritizes current outer conversation turns over legacy semantic nodes", () => {
  const assistantTurnsSource = gptSidebar.match(/function assistantTurns\(\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(assistantTurnsSource.indexOf("const outerTurns") >= 0);
  assert.ok(assistantTurnsSource.indexOf("if (outerTurns.length)") < assistantTurnsSource.indexOf("if (semanticTurns.length) return semanticTurns"));
});

test("GPT silent image recovery repeats the exact planned page range", () => {
  assert.match(gptSidebar, /const recoveryPrompt = `请继续完成刚才已经确认的全部图片生成。[\s\S]*?P1-P\$\{expectedImages\}/);
});
test("GPT image detection anchors silent recovery after the latest confirmation turn", () => {
  assert.match(gptSidebar, /function latestConfirmationUserTurn\(confirmText = "1"\)/);
  assert.match(gptSidebar, /const confirmationAnchor = options\.afterTurn\?\.isConnected/);
  assert.match(gptSidebar, /afterTurn: confirmationAnchor/);
  assert.match(gptSidebar, /assistantTurnsAfter\(confirmationAnchor\)\.length/);
});
test("GPT partial image recovery waits for a settled reply and suppresses the same snapshot", () => {
  assert.match(gptSidebar, /const partialImageQuietMs =/);
  assert.match(gptSidebar, /partialQuietMs: partialImageQuietMs/);
  assert.match(gptSidebar, /const staleNonGeneratingTimeout = imageDetection\.evidence === "timeout"/);
  assert.match(gptSidebar, /const currentReplyInFlight = Boolean\(imageDetection\.generating\) && !staleNonGeneratingTimeout/);
  assert.match(gptSidebar, /partial-image-recovery-suppressed/);
  assert.match(gptSidebar, /same-partial-image-snapshot/);
  assert.match(gptSidebar, /full grace window/);
});
const serverSource = server;

test("global rotation resumes submitted work on its owning account without changing request id", () => {
  assert.match(app, /rotationTaskBoundAccountId\(task\)/);
  assert.match(app, /accounts\.find\(\(item\) => item\.id === boundAccountId\)/);
  const recoveryStart = app.indexOf('if (recovery.action === "resume-plan")');
  const recoveryEnd = app.indexOf('if (recovery.action !== "resume-plan")', recoveryStart);
  const recoveryBlock = app.slice(recoveryStart, recoveryEnd);
  assert.doesNotMatch(recoveryBlock, /boundaryRetryTask\.requestId\s*=/);
});

test("desktop and extension carry the durable image checkpoint across a renderer restart", () => {
  assert.match(desktopMain, /workflow:\s*task\.workflow[\s\S]*?JSON\.parse\(JSON\.stringify\(task\.workflow\)\)/);
  assert.match(gptSidebar, /workflow:\s*entry\.workflow[\s\S]*?JSON\.parse\(JSON\.stringify\(entry\.workflow\)\)/);
  assert.match(gptSidebar, /generatedImageActualCount:\s*Number\(workflow\.generatedImageActualCount/);
  assert.match(gptSidebar, /Number\(checkpoint\.generatedImageActualCount/);
  assert.match(gptSidebar, /Number\(checkpoint\.downloadedFiles\?\.length/);
});

test("fresh GPT uploads are blocked until the current conversation is archived", () => {
  assert.match(app, /async function assertFreshConversationInjectionSafe\(task, accountId(?:, options = \{\})?\)/);
  assert.match(app, /gptWorkbench\.inspectStatus\(accountId\)/);
  assert.match(app, /freshConversationInjectionBoundary\(task, inspection\)/);
  assert.match(app, /error\.code = "WINDOW_STAGE_PENDING"/);
  assert.match(gptSidebar, /function archivedAutomationLiveEvidence\(\)/);
  assert.match(gptSidebar, /function archivedAutomationBoundaryMatchesLive\(marker, materialText = ""\)/);
  assert.match(gptSidebar, /Older markers only keyed by URL \+ material/);
  assert.match(gptSidebar, /const liveCopyReplyBoundary = Boolean/);
  assert.match(gptSidebar, /copy-boundary-image-count-uncertain/);
  assert.match(gptSidebar, /copy-boundary-material-mismatch/);
  assert.match(gptSidebar, /patrolMaterialCopyIdentity/);
  assert.match(gptSidebar, /resolvePatrolCopyBoundary/);
  assert.match(gptSidebar, /turnCount: live\.turnCount/);
  assert.match(gptSidebar, /const activeStages = new Set\(\[/);
  assert.match(gptSidebar, /completed-copy-pending-package/);
  assert.match(gptSidebar, /recovery-images-requested/);
  assert.match(gptSidebar, /IMAGE_RECOVERY_CAP_REACHED/);
  assert.match(gptSidebar, /const archivedByAutomation =/);
  assert.match(gptSidebar, /stage = \(archivedByPatrol \|\| archivedByAutomation\) \? "archived"/);
});

test("GPT patrol material mismatch does not read candidate before it is initialized", () => {
  const candidateDeclaration = gptSidebar.indexOf("const candidate = classifyPatrolConversationCandidate");
  const mismatchReturn = gptSidebar.lastIndexOf('reason: "copy-boundary-material-mismatch"');
  assert.ok(candidateDeclaration >= 0);
  assert.ok(mismatchReturn > candidateDeclaration);
  assert.equal((gptSidebar.match(/const candidate = classifyPatrolConversationCandidate/g) || []).length, 1);
});

test("GPT copy-boundary mismatch is isolated and rebound instead of freezing archive recovery", () => {
  const recoveryStart = app.indexOf("async function recoverCompletedGptConversationBeforeInjection");
  const recoveryEnd = app.indexOf("function gptCurrentRecoveryTask", recoveryStart);
  const recoveryBlock = app.slice(recoveryStart, recoveryEnd);
  assert.match(recoveryBlock, /result\?\.reason === "copy-boundary-material-mismatch"/);
  assert.match(recoveryBlock, /rebindUnownedCompletedConversationToFreshChat\(key, workerState, inspection, \{[\s\S]*ownerTask/);
  assert.match(recoveryBlock, /reboundFresh: true/);
  const reconcileStart = app.indexOf("async function reconcileIndependentConversationBeforeStart");
  const reconcileEnd = app.indexOf("function isTransientGptWindowFailure", reconcileStart);
  const reconcileBlock = app.slice(reconcileStart, reconcileEnd);
  assert.match(reconcileBlock, /if \(recovered\?\.reboundFresh\)/);
  assert.match(reconcileBlock, /currentTask\.forceUpload = true|ownerTask\.forceUpload = true/);
  assert.match(app, /const requestedTask = options\.ownerTask && queue\.includes\(options\.ownerTask\)/);
});

test("GPT runtime queue has a server mirror and restart reconciliation", () => {
  assert.match(serverSource, /\/api\/gpt-production\/runtime-state/);
  assert.match(app, /function reconcileGptRuntimeState\(\)/);
  assert.match(app, /function scheduleGptRuntimeSync\(/);
  assert.match(app, /function isGptRuntimeWriteAuthority\(\)/);
  assert.match(app, /\\bElectron\\\//);
  assert.match(app, /if \(!isGptRuntimeWriteAuthority\(\)\) return/);
  assert.match(app, /!isGptRuntimeWriteAuthority\(\)[\s\S]*?remoteTime > localTime/);
  assert.match(app, /teambuilding-gpt-queue-meta-v2/);
  assert.match(app, /hadPausedCurrentTask = \["paused", "failed"\]/);
  assert.match(app, /saved\.paused \|\| hadInterruptedTask \|\| hadPausedCurrentTask/);
  assert.match(app, /task\._errorCode \|\|= "RESTART_INTERRUPTED"/);
  assert.match(app, /function localGptControlSnapshot\(\)/);
  assert.match(app, /function applyGptRuntimeControl\(/);
  assert.match(app, /control:\s*localGptControlSnapshot\(\)/);
  assert.match(app, /applyGptRuntimeControl\(remote\.control\)/);
  assert.match(app, /status: "paused-restart"/);
  assert.match(app, /if \(!pendingTasks\.length && !recoverableTasks\.length\) return/);
  assert.match(app, /\(gptQueuePaused \|\| !pendingTasks\.length\) && recoverableTasks\.length/);
  assert.match(app, /const liveMirrorAccount = gptAccounts\.find/);
  assert.match(app, /mirrorUsesIndependentQueue/);
  assert.match(app, /serializedGptQueueTasks\(mirrorState\?\.queue \|\| \[\]\)/);
  assert.match(app, /recoveringWindowIds\.length > 0/);
  assert.match(app, /planText: String\(inspection\?\.latestAssistantText/);
  assert.match(app, /plannedImageCount: Math\.max\(1, Math\.min\(10, Number\(boundaryRetryTask\.workflow\?\.plannedImageCount \|\| boundaryRetryTask\.expectedImages \|\| inspection\?\.expectedImageCount/);
  assert.match(gptSidebar, /plannedImageCount: completedPlannedImageCount\(/);
  assert.match(serverSource, /authoritativePlannedImageCount/);
  assert.match(app, /const runtimeReconciliation = await reconcileGptRuntimeState\(\);[\s\S]*?adoptGptRuntimeQueueIntoWindowWorkers\(runtimeReconciliation\?\.state\);[\s\S]*?restoreGptQueue\(\);[\s\S]*?restoreLegacyGptWindowState\(activeGptAccountId\);[\s\S]*?refreshGptUiAfterRuntimeRestore\(\);/);
  assert.match(app, /async function reconcileCompletedGptTasksFromConversationLog\(queue = gptTestQueue/);
  assert.match(app, /reconcileCompletedGptTasksFromConversationLog\(workerState\.queue, \{[\s\S]*?workerState/);
  assert.match(app, /textSaved.*imagesDownloaded.*archived/);
  assert.match(app, /latestCurrentAttemptAt/);
  assert.match(app, /latestArchivedAt/);
  assert.match(app, /const directArchiveEvidence = directEntries\.some\(\(entry\) => entry\?\.event === "archived"\)/);
  assert.match(app, /task\._status === "running" && !allowStaleRunningTaskReconciliation && !directArchiveEvidence/);
  assert.match(app, /newerAttemptThanArchive/);
  assert.match(app, /hasRetryBoundary/);
  assert.match(app, /result\.action === "regenerate-batch"/);
  assert.match(app, /RECOVERY_IN_PROGRESS/);
  assert.match(app, /inspection\.generating === true && ownerTask/);
  assert.match(app, /const archivedOwner = \["archived", "completed"\]/);
  assert.match(app, /STALE_ARCHIVE_CHAIN/);
  assert.match(app, /task\._completedFromLog = true/);
  assert.match(app, /await reconcileCompletedGptTasksFromConversationLog\(\);/);
  assert.match(app, /setInterval\(async \(\) => \{[\s\S]*?reconcileCompletedGptTasksFromConversationLog\(\)/);
  assert.match(app, /async function reconcileIndependentGptWindowFromConversationLog\(accountId\)/);
  assert.match(app, /reconcileRunning: recoverableStatus/);
  assert.match(app, /gptAccounts\.map\(\(account\) => reconcileIndependentGptWindowFromConversationLog/);
  assert.match(app, /function isFalsePartialImageRecoveryAfterDurableArchive\(taskEntries, archivedAt/);
  assert.match(app, /falsePartialRecoveryAfterArchive/);
  assert.match(app, /partial-image-recovery-suppressed/);
  assert.match(app, /startup-stagger/);
  assert.match(app, /waiting-startup-stagger/);
  assert.match(app, /markGptStartupFirstOutput/);
  assert.match(app, /GPT_STARTUP_STAGGER_MIN_DELAY_MS = 5 \* 60_000/);
  assert.match(app, /GPT_STARTUP_STAGGER_MAX_DELAY_MS = 10 \* 60_000/);
  assert.match(app, /markGptStartupLaunched/);
  assert.match(app, /启动后 5–10 分钟/);
  assert.match(app, /lastDeferredError: task\._error/);
  assert.match(app, /legacyQueue && gptAutoRunning/);
  assert.match(app, /function refreshGptUiAfterRuntimeRestore\(\)[\s\S]*?renderGptAccountTabs\(\);[\s\S]*?renderGptBrowserManager\(\);[\s\S]*?updateGptTestQueueStatus\(\);/);
});

test("restart reconciliation reattaches an unfinished server task to its account worker", () => {
  assert.match(app, /function adoptGptRuntimeQueueIntoWindowWorkers\(runtimeState\)/);
  assert.match(app, /const accountId = String\(persistedTask\?\.accountId \|\| persistedTask\?\.browserIdentityId/);
  assert.match(app, /if \(task\._status === "failed" \|\| task\._status === "paused"\)/);
  assert.match(app, /adoptGptRuntimeQueueIntoWindowWorkers\(runtimeReconciliation\?\.state\)/);
  assert.match(app, /state\.queue\.push\(task\)/);
});

test("GPT automatic recovery backs off after the refresh limit instead of polling every 20 seconds", () => {
  assert.match(app, /refreshed\?\.skipped === "refresh-limit"/);
  assert.match(app, /withGptWindowRecoveryLock\(key, "refresh-limit-browser-recreate"/);
  assert.match(app, /recreateGptWindowForAutomaticRecovery\(key, "refresh-limit-browser-recreate"/);
  assert.match(app, /scheduleNextRecovery\(20_000, "浏览器重建未确认，等待有限重试"\)/);
});

test("rotation pause blocks the next post and clears a pre-submit composer", () => {
  assert.match(app, /USER_PAUSED_BEFORE_SUBMIT/);
  assert.match(app, /pausePendingTask\?\.\(accountId, activeTask\.requestId\)/);
  assert.match(app, /const readiness = await waitForGptProductionReadiness[\s\S]*?if \(gptAutoPaused\)/);
  assert.match(app, /const admission = await boundedGptBrowserCall[\s\S]*?if \(gptAutoPaused\)/);
  assert.match(app, /runInitializerForAccount\(task, account\)[\s\S]*?if \(gptAutoPaused\)[\s\S]*?runGptTaskOnBrowser/);
  assert.match(desktopPreload, /pausePendingTask\(accountId = "", requestId = ""\)/);
  assert.match(desktopMain, /desktop:gpt-pause-pending-task/);
  assert.match(gptSidebar, /tb-workbench-pause-before-submit/);
  assert.match(gptSidebar, /forceClearComposer\(\);[\s\S]*?USER_PAUSED_BEFORE_SUBMIT/);
  assert.match(app, /if \(worker\.status === "running" && !worker\.currentTask\) worker\.status = "paused"/);
  assert.match(app, /status: worker\?\.status === "running" && !worker\?\.currentTask \? "paused" : worker\?\.status/);
});

test("material production tasks are capped at ten images before execution", () => {
  assert.match(app, /expectedImages:\s*Math\.max\(0,\s*Math\.min\(10,\s*Number\(entry\.item\.imageCount/);
  assert.match(app, /task\.expectedImages\s*=\s*Math\.max\(0,\s*Math\.min\(10,/);
  assert.match(app, /if \(migratedQueue \|\| hadInterruptedTask \|\| hadPausedCurrentTask !== Boolean\(saved\.paused\)\) persistGptQueue\(\)/);
  assert.match(gptSidebar, /clampExpectedImageCount/);
  assert.match(serverSource, /plannedImageCount:\s*Math\.max\(0,\s*Math\.min\(10,/);
});

test("GPT rolling upload quota counts attachments only after a real submission", () => {
  const submitIndex = gptSidebar.indexOf("await submitComposer();");
  const quotaIndex = gptSidebar.indexOf("await recordWorkbenchQuota(task.entry, \"uploaded\", expectedAttachmentCount);");
  assert.ok(submitIndex >= 0 && quotaIndex > submitIndex, "upload quota must be recorded after submitComposer");
  assert.doesNotMatch(gptSidebar.slice(0, submitIndex), /recordWorkbenchQuota\([^\n]*uploaded/);
  assert.match(gptSidebar, /workflow\.uploadQuotaRecorded/);
  assert.match(app, /const requiredUploads = \(task\.attachments \|\| \[\]\)\.length/);
});

test("A-D Electron instances use separate single-instance lock namespaces", () => {
  assert.match(desktopMain, /app\.setName\(`jianghu-content-production-\$\{CONTENT_INSTANCE_ID\.toLowerCase\(\)\}`\)/);
  assert.match(desktopMain, /app\.requestSingleInstanceLock\(\)/);
});

test("已提交的 GPT 会话检查点不被新素材上传额度提前拦截", () => {
  assert.match(app, /function gptTaskOwnsSubmittedConversationCheckpoint\(task = \{\}\)/);
  assert.match(app, /task\._submittedToGpt === true/);
  assert.match(app, /task\.forceUpload !== true/);
  const scheduleStart = app.indexOf("function scheduleContinuousGptProduction");
  const scheduleEnd = app.indexOf("function buildGptTemplateInitTask", scheduleStart);
  const scheduleBlock = app.slice(scheduleStart, scheduleEnd);
  assert.ok(scheduleBlock.includes("const ownsSubmittedCheckpoint = gptTaskOwnsSubmittedConversationCheckpoint(durableCurrentTask)"));
  assert.ok(scheduleBlock.includes("Number(quotaState.nextProbeAt || 0) > Date.now() && !ownsSubmittedCheckpoint"));
  assert.ok(scheduleBlock.includes("已有 GPT 检查点，继续当前作品"));
  assert.ok(scheduleBlock.includes("a real platform generation limit still comes back from"));
  assert.ok(scheduleBlock.includes("GPT and is handled by the normal finite quota-wait path"));
});

test("重启后用服务端额度校准旧的前端等待标记", () => {
  assert.match(app, /function reconcileStaleGptQuotaBoundary\(accountId, task, expectedProbeAt\)/);
  assert.match(app, /api\(`\/api\/gpt-production\/quota\?account=\$\{encodeURIComponent\(quotaKey\)\}`\)/);
  assert.match(app, /remainingUploads < requiredUploads/);
  assert.match(app, /Number\(current\.nextProbeAt \|\| 0\) !== Number\(expectedProbeAt\)/);
  const scheduleStart = app.indexOf("function scheduleContinuousGptProduction");
  const scheduleEnd = app.indexOf("function buildGptTemplateInitTask", scheduleStart);
  const scheduleBlock = app.slice(scheduleStart, scheduleEnd);
  assert.ok(scheduleBlock.indexOf("reconcileStaleGptQuotaBoundary(key, durableCurrentTask") > scheduleBlock.indexOf("const quotaState = readGptCycleState"));
});

test("开发版静态资源缓存版本与 VERSION 同步", () => {
  assert.ok(version, "VERSION must not be empty");
  const versionPattern = version.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  assert.match(html, new RegExp(`styles\\.css\\?v=${versionPattern}`));
  assert.match(html, new RegExp(`distribution-ui\\.js\\?v=${versionPattern}`));
  assert.match(html, new RegExp(`material-workspace\\.js\\?v=${versionPattern}`));
  assert.match(html, new RegExp(`app\\.js\\?v=${versionPattern}`));
});

test("runtime version probe stays ahead of blocking optional routers", () => {
  const routeStart = server.indexOf("async function route");
  const probe = server.indexOf('if (pathname === "/api/runtime-info" && req.method === "GET")', routeStart);
  const runtimeStateProbe = server.indexOf('if (pathname === "/api/gpt-production/runtime-state" && req.method === "GET")', routeStart);
  const earlyConversion = server.indexOf("await conversionRoute.handleEarly", routeStart);
  assert.ok(probe >= 0, "runtime probe must exist");
  assert.ok(runtimeStateProbe >= 0, "runtime state probe must exist");
  assert.ok(earlyConversion >= 0, "early conversion router must exist");
  assert.ok(probe < earlyConversion, "runtime probe must not wait for optional conversion helpers");
  assert.ok(runtimeStateProbe < earlyConversion, "runtime state probe must not wait for optional conversion helpers");
});

test("GPT conversation evidence probe stays ahead of blocking optional routers", () => {
  const routeStart = server.indexOf("async function route");
  const conversationProbe = server.indexOf('if (pathname === "/api/gpt-production/conversation-log" && req.method === "GET")', routeStart);
  const earlyConversion = server.indexOf("await conversionRoute.handleEarly", routeStart);
  assert.ok(conversationProbe >= 0, "conversation evidence probe must exist");
  assert.ok(earlyConversion >= 0, "early conversion router must exist");
  assert.ok(conversationProbe < earlyConversion, "conversation evidence probe must not wait for optional conversion helpers");
  assert.match(server.slice(conversationProbe, earlyConversion), /readRecentGptConversationEntries\(parsed\.query\.limit\)/);
});

test("orphan GPT recovery resolves one material from the global index without scanning categories", () => {
  assert.match(server, /function findMaterialGlobalIndexEntry\(folderName = ""\)/);
  assert.match(server, /pathname === "\/api\/materials\/find"/);
  assert.match(server, /MATERIAL_GLOBAL_INDEX_FILE/);
  const recoverySection = app.match(/async function resolveGptMaterialForConversationRecovery\(folderName = ""\)[\s\S]*?\n}\n\nasync function adoptCompletedGptConversationCheckpoint/)?.[0] || "";
  assert.match(recoverySection, /\/api\/materials\/find\?name=/);
  assert.doesNotMatch(recoverySection, /loadMaterialCategory/);
});

test("material global indexing is isolated from the server event loop", () => {
  const workerSource = fs.readFileSync(path.join(__dirname, "..", "material-index-worker.js"), "utf8");
  assert.match(server, /const \{ Worker \} = require\("worker_threads"\)/);
  assert.match(server, /new Worker\(path\.join\(APP_ROOT, "material-index-worker\.js"\)/);
  assert.match(server, /queueMaterialGlobalIndexRefresh/);
  assert.match(workerSource, /runMaterialGlobalIndexRefresh/);
  assert.match(workerSource, /getMaterialGlobalIndexJobStatus/);
});

test("设置中心提供桌面检查更新、发布目录和手机端 GitHub 更新入口", () => {
  assert.match(html, /id="checkAppUpdateBtn"[^>]*>检查更新/);
  assert.match(html, /id="openReleaseRootBtn"[^>]*>打开发布目录/);
  assert.match(html, /id="openMobileUpdateUrlBtn"[\s\S]*?<span>手机端更新<\/span>/);
  assert.match(html, /id="settingsUpdateNote"/);
  assert.match(app, /\$\("#openMobileUpdateUrlBtn"\)\?\.addEventListener\("click"/);
  assert.match(app, /dashboard\?\.appInfo\?\.mobileUpdateUrl/);
  assert.match(server, /mobileUpdateUrl:\s*MOBILE_UPDATE_URL/);
  assert.match(server, /team-video-workflow\/releases/);
  assert.match(css, /\.version-link-button\s*\{/);
  assert.match(css, /\.version-link-icon\s*\{/);
});

test("文件传输软件说明提供手机端安装包页面直达按钮", () => {
  assert.match(app, /distributionView:\s*\{[\s\S]*?externalLink:\s*\{[\s\S]*?打开手机端安装包页面/);
  assert.match(app, /help\.externalLink[\s\S]*?dashboard\?\.appInfo\?\.mobileUpdateUrl/);
  assert.match(app, /data-dialog-open-url/);
  assert.match(app, /await openExternal\(externalLinkButton\.dataset\.dialogOpenUrl\)/);
  assert.match(app, /externalLink:\s*options\.externalLink/);
  assert.match(css, /\.system-dialog-external-link\s*\{/);
});

test("素材与模板工作区支持面板放大恢复、滚动和十秒无操作缩小", () => {
  assert.match(html, /data-workbench-expandable="material"/);
  assert.match(html, /data-workbench-expandable="template"/);
  assert.match(html, /data-workbench-expand="material"[^>]*aria-expanded="false"/);
  assert.match(html, /data-workbench-expand="template"[^>]*aria-expanded="false"/);
  assert.match(html, /10 秒无操作自动缩小/);
  assert.match(app, /const WORKBENCH_LIBRARY_IDLE_COLLAPSE_MS = 10_000/);
  assert.match(app, /function setWorkbenchLibraryExpanded\(kind = ""\)/);
  assert.match(app, /grid\.addEventListener\("scroll", touchWorkbenchLibraryExpansion, true\)/);
  assert.match(app, /event\.key === "Escape" && workbenchExpandedLibrary/);
  assert.match(css, /\.production-workbench-grid\.library-expanded/);
  assert.match(css, /data-expanded-library="material"/);
  assert.match(css, /data-expanded-library="template"/);
  assert.match(css, /data-expanded-library="material"\]>.production-library-column\{grid-template-rows:minmax\(0,1fr\) 58px\}/);
  assert.match(css, /data-expanded-library="template"\]>.production-library-column\{grid-template-rows:58px minmax\(0,1fr\)\}/);
  assert.doesNotMatch(css, /library-expanded>\.production-dialog-column[^}]*display:none/);
  assert.match(html, /data-workbench-expand="material"[^>]*title="展开素材区[^>]*>[\s\S]*?workbench-expand-icon/);
  assert.match(html, /data-workbench-expand="template"[^>]*title="展开模板区[^>]*>[\s\S]*?workbench-expand-icon/);
  assert.doesNotMatch(html, /[⤢⤡]/);
  assert.match(css, /\.workbench-expand-button\{display:grid!important;width:30px;min-width:30px;height:30px/);
  assert.match(css, /cubic-bezier\(\.22,1,\.36,1\)/);
  assert.match(css, /\.workbench-expand-button\[aria-expanded="true"\] \.expand-corner-tl/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(app, /button\.setAttribute\("aria-expanded", String\(active\)\)/);
  assert.match(app, /content\.toggleAttribute\("inert", isCompact\)/);
  assert.match(css, /\.production-workbench-grid\.library-expanded[\s\S]*\.workbench-template-images\{grid-template-columns:repeat\(auto-fill,minmax\(138px,1fr\)\)/);
});

test("当前 GPT 素材区和模板区提供右上角平滑展开收起控件", () => {
  assert.match(html, /data-gpt-library-expand="material"[^>]*aria-label="展开素材区"[^>]*>[\s\S]*?workbench-expand-icon/);
  assert.match(html, /data-gpt-library-expand="template"[^>]*aria-label="展开模板区"[^>]*>[\s\S]*?workbench-expand-icon/);
  assert.match(app, /const GPT_LIBRARY_IDLE_RESTORE_MS = 10_000/);
  assert.match(app, /function setGptLibraryPanelExpanded\(kind = ""\)/);
  assert.match(app, /bindGptLibraryPanelExpansion\(\)/);
  assert.match(css, /gpt-library-panel-expanded\[data-expanded-panel="material"\][\s\S]*grid-template-rows: minmax\(520px, 1fr\) 58px auto/);
  assert.match(css, /gpt-library-panel-expanded\[data-expanded-panel="template"\][\s\S]*grid-template-rows: 58px minmax\(420px, 1fr\) auto/);
});

test("GPT production exposes manual, single-account and safe continuous modes", () => {
  assert.match(html, /value="manual">人工控制/);
  assert.match(html, /value="single">/);
  assert.doesNotMatch(html, /value="rotate">/);
  assert.match(html, /value="scheduled">/);
  assert.match(html, /value="patrol">/);
  assert.match(html, /id="gptSingleQuotaAutoSwitch"/);
  assert.match(app, /GPT_MODE_DEFINITIONS/);
  assert.match(app, /singleQuotaAutoSwitch/);
  assert.match(app, /useCurrentSession/);
  assert.match(app, /gptModeProfiles/);
  assert.match(gptSidebar, /noPromptMode/);
  assert.match(gptSidebar, /conversationStateSnapshot/);
});

test("工作台侧栏支持紧凑折叠、图标导航和跨刷新记忆", () => {
  assert.match(html, /id="workflowRail"/);
  assert.match(html, /id="railCollapseBtn"[^>]*aria-controls="workflowRail"[^>]*aria-expanded="true"/);
  assert.equal((html.match(/class="tab rail-tab[^>]*aria-label=/g) || []).length, 10);
  assert.match(html, /data-tab="materialLibrary"[^>]*aria-label="素材库"/);
  assert.match(html, /data-tab="templateRepository"[^>]*data-open-template-repository="true"[^>]*>[^<]*[\s\S]*?<span>模板仓库<\/span>/);
  assert.match(app, /tab\.dataset\.openTemplateRepository === "true"/);
  assert.match(html, /class="rail-service-label"[^>]*>本地服务已连接/);
  assert.match(app, /const WORKBENCH_RAIL_COLLAPSED_STORAGE_KEY = "tb-workbench-rail-collapsed"/);
  assert.match(app, /function applyWorkbenchRailCollapsed\(collapsed/);
  assert.match(app, /localStorage\.setItem\(WORKBENCH_RAIL_COLLAPSED_STORAGE_KEY/);
  assert.match(app, /bindWorkbenchRailCollapse\(\)/);
  assert.match(css, /body\.rail-collapsed \.app-shell\s*\{\s*grid-template-columns:\s*68px minmax\(0, 1fr\)/);
  assert.match(css, /body\.rail-collapsed \.workflow-rail \.rail-tab svg\s*\{[\s\S]*?display:\s*block/);
  assert.match(css, /body\.rail-collapsed \.rail-brand-copy/);
  assert.match(css, /body\.rail-collapsed \.rail-service \.status-dot\s*\{\s*margin-right:\s*0/);
});

test("A-D 预览按当前实例端口健康探测服务状态，掉线时不伪装在线", () => {
  assert.match(html, /id="localServiceStatus"[^>]*data-service-status="unknown"[^>]*aria-live="polite"/);
  assert.match(html, /id="localTopbarStatus"[^>]*data-service-status="unknown"[^>]*aria-live="polite"/);
  assert.match(app, /const CONTENT_INSTANCE_STATUS_INTERVAL_MS = 5_000/);
  assert.match(app, /function isContentInstanceBrowserPreview\(\)/);
  assert.match(app, /function refreshContentInstanceServiceStatus\(\)/);
  assert.match(app, /fetch\(`\/api\/runtime-info\?ts=\$\{Date\.now\(\)\}`/);
  assert.match(app, /本地服务未连接/);
  assert.match(app, /startContentInstanceServiceStatusMonitor\(\)/);
  assert.match(css, /\.rail-service\[data-service-status="offline"\][\s\S]*\.topbar-status\[data-service-status="offline"\]/);
});

test("GPT copy request asks for publish-ready copy without section-label chatter", () => {
  assert.match(app, /const GPT_PUBLISH_COPY_PROMPT =/);
  assert.match(app, /只输出一份可直接复制发布的双平台完整文案/);
  assert.match(app, /<<<COPY_FORMAT:2>>>/);
  assert.match(app, /<<<XHS_START>>>/);
  assert.match(app, /<<<DOUYIN_START>>>/);
  assert.match(app, /固定输出10个/);
  assert.match(app, /固定输出5个/);
  assert.match(app, /禁止价格、报价、费用、10人起接/);
  assert.match(app, /不得输出标题\/正文\/标签栏目名/);
  assert.match(app, /LEGACY_GPT_COPY_PROMPTS/);
  assert.match(app, /normalizeGptCopyPrompt/);
  assert.match(app, /不得提及 TXT、图片、附件、素材、参考文案、出图计划、提示词、AI、模型或读取过程/);
  assert.match(gptSidebar, /COPY_META_NARRATION/);
  assert.match(gptSidebar, /copy-meta-narration-rewrite/);
  assert.match(gptSidebar, /detectCopyMetaNarration/);
  assert.match(gptSidebar, /copy-format-recovery-sent/);
  assert.match(gptSidebar, /baselineKeys: options\.baselineKeys/);
  assert.match(gptSidebar, /copyMetaNarrationRewriteAttempted/);
  assert.match(gptSidebar, /copy-meta-narration-still-present/);
});

test("embedded GPT browser exposes an account-partitioned address bar", () => {
  assert.match(html, /id="gptBrowserAddressInput"/);
  assert.match(html, /id="gptBrowserGoBtn"/);
  assert.match(html, /id="gptBrowserGoBtn"[^>]*aria-label="访问当前网址"[^>]*>→<\/button>/);
  assert.match(html, /aria-label="账号窗口切换"/);
  assert.match(html, /aria-label="当前账号窗口网页"/);
  assert.match(html, /默认 ChatGPT，可输入其他网址/);
  assert.match(app, /submitGptBrowserAddress/);
  assert.match(app, /syncGptBrowserAddress/);
  assert.match(desktopPreload, /action: String\(action \|\| "reload"\)/);
  assert.match(desktopMain, /function safeBrowserUrl/);
  assert.match(desktopMain, /只允许访问 http:\/\/ 或 https:\/\/ 网页/);
  assert.match(desktopMain, /await contents\.loadURL\(targetUrl\)/);
  assert.match(desktopMain, /isChatGpt: \/\^https/);
  assert.match(app, /浏览器网页已打开 · 返回 GPT 可继续生产/);
  assert.match(desktopMain, /desktop:gpt-url-changed/);
  assert.match(desktopPreload, /onUrlChanged\(callback\)/);
  assert.match(app, /onUrlChanged\?\.\(\(input = \{\}\) =>/);
  assert.match(app, /function resolveGptBrowserInput/);
  assert.match(app, /https:\/\/www\.google\.com\/search\?q=\$\{encodeURIComponent\(raw\)\}/);
});

test("主导航命名和 GPT 工具栏视觉保持克制", () => {
  assert.doesNotMatch(html, /data-tab="dashboard"/);
  assert.doesNotMatch(html, />生产（暂停）<\/span>/);
  assert.match(html, />内容制作<\/span>/);
  assert.match(html, />设置中心<\/span>/);
  assert.doesNotMatch(html, /素材生产（暂不开发）/);
  assert.doesNotMatch(html, /内容生产（自动）/);
  assert.match(css, /\.gpt-browser-toolbar[\s\S]*box-shadow: none/);
  assert.match(css, /\.gpt-browser-nav button,[\s\S]*\.gpt-add-account[\s\S]*background: transparent/);
  assert.match(css, /\.gpt-account-tab\.active[\s\S]*border-bottom/);
});

test("the literal single-account mode survives normalization and settings save", () => {
  assert.match(app, /mode === "single".*return "single"/s);
  assert.match(app, /const normalizedMode = normalizeGptProductionMode\(gptAutoSettings\.mode\)/);
});

test("GPT production exposes the endless mode and low-usage material selection", () => {
  assert.match(html, /value="single">/);
  assert.match(app, /async function prepareAllDayGptQueue/);
  assert.match(app, /async function selectLowestUsageGptEntries/);
  assert.match(app, /gptAutoMaterialReservations/);
  assert.match(app, /isHiddenMaterialPath/);
  assert.match(app, /gptMaterialUsageCount\(left\.item, left\.category\)/);
  assert.match(app, /normalizeGptProductionMode\(gptAutoSettings\.mode\)/);
  assert.match(server, /!entry\.name\.startsWith\("\."\)/);
  assert.match(server, /includeHidden = options\.includeHidden === true/);
  assert.match(server, /scanPostFolders\(categoryRoot\)/);
  assert.doesNotMatch(server, /scanPostFolders\(categoryRoot, \{ includeHidden: true \}\)/);
});

test("GPT all-day production persists across restarts and obeys cross-midnight work hours", () => {
  assert.match(html, /id="gptContinuousAutoStart"/);
  assert.match(html, /id="gptLaunchAtLogin"/);
  assert.match(html, /id="gptContinuousWorkHoursEnabled"/);
  assert.match(html, /id="gptContinuousWorkStart"[^>]*value="08:00"/);
  assert.match(html, /id="gptContinuousWorkEnd"[^>]*value="02:00"/);
  assert.match(app, /GPT_CONTINUOUS_RUN_STORAGE_KEY/);
  assert.match(app, /function getGptContinuousWorkWindow/);
  assert.match(app, /const crossesMidnight = startMinutes > endMinutes/);
  assert.match(app, /function scheduleContinuousGptProduction/);
  assert.match(app, /window\.addEventListener\("online"/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /gptAutoSettings\.continuousAutoStart !== false/);
  assert.match(app, /GPT_DEFAULT_MODE_MIGRATION_KEY/);
  assert.match(app, /openPageSettings\("gptAuto"\)/);
  assert.match(desktopPreload, /setLaunchAtLogin/);
  assert.match(desktopMain, /app\.setLoginItemSettings/);
});

test("continuous startup uses the loaded low-usage catalog before deep-scanning every category", () => {
  const catalogSection = app.match(/async function ensureGptAutoMaterialCatalog\(\)[\s\S]*?\n}\n\nfunction gptWindowReservedMaterialPaths/)?.[0] || "";
  assert.match(catalogSection, /loadedItems/);
  assert.match(catalogSection, /if \(loadedItems > 0\) return dashboard\?\.materials/);
  assert.match(catalogSection, /find\(\(category\) => category\.loaded === false/);
  assert.doesNotMatch(catalogSection, /for \(const category of dashboard\?\.materials\?\.categories \|\| \[\]\)/);
  const selectionSection = app.match(/async function selectLowestUsageGptEntries\([\s\S]*?\n}\n\nasync function prepareAutoGptQueue/)?.[0] || "";
  assert.match(selectionSection, /待复核.*归档完成.*生产中.*作品已完成待归档/);
  assert.doesNotMatch(selectionSection, /待初次打标/);
  assert.match(app, /仍在 initial-tagging|仍在初次打标|initial-tagging/);
});

test("continuous auto-selection uses the refreshed global index before a deep category scan", () => {
  assert.match(server, /function getFastAutomaticMaterialEntries\(count = 8, excludedPaths = \[\], options = \{\}\)/);
  assert.match(server, /pathname === "\/api\/materials\/auto-select"/);
  assert.match(server, /source: "material-global-index"/);
  assert.match(app, /\/api\/materials\/auto-select\?/);
  assert.match(app, /Prefer the asynchronously refreshed global index/);
});

test("a durable archive completes even when the recovered plan count is stale", () => {
  assert.match(app, /const durableArchivePackagePath = String\(archived\?\.packagePath/);
  assert.match(app, /const durableArchiveBoundary = Boolean\(/);
  assert.match(app, /!durableArchiveBoundary && plannedCount > 0 && imageCount < plannedCount/);
  assert.match(app, /stale plan count[\s\S]*already packaged work/);
});

test("a later archive on the same conversation releases a stale checkpoint gate", () => {
  assert.match(app, /api\("\/api\/gpt-production\/conversation-log\?limit=500"\)/);
  assert.match(app, /const hasLaterArchive = conversationEntries\.some\(\(entry\) =>/);
  assert.match(app, /\["archived", "archive-complete", "archive-saved", "move-archive"\]/);
  assert.match(app, /return !hasLaterArchive;/);
});

test("automatic selection ignores a quarantined incomplete checkpoint after bounded isolation", () => {
  const selectionSection = app.match(/async function selectLowestUsageGptEntries\([\s\S]*?\n}\n\nasync function prepareAutoGptQueue/)?.[0] || "";
  assert.match(selectionSection, /isAutomaticGptTaskQuarantined\(ownerAccountId, item\.requestId\)/);
});

test("an online template cannot fall back to another account's conversation", () => {
  const resolver = app.match(/function gptOnlineConversationForAccount\([\s\S]*?\n}\n\nasync function openGptOnlineConversation/)?.[0] || "";
  assert.doesNotMatch(resolver, /conversations\.find\(\(item\) => item\.autoSaved !== false\)/);
  assert.doesNotMatch(resolver, /\|\| conversations\[0\]/);
  assert.match(app, /if \(template\.kind === "online"\) return entries\.map\(\(entry\) => buildGptTestTask\(entry\)\)/);
  assert.match(app, /sanitizeUnsubmittedGptTaskAccountBinding/);
});

test("a shared profile URL is repaired from that account's conversation evidence", () => {
  assert.match(app, /const rendererUrlIsShared = nativeUrl && gptAccounts\.some/);
  assert.match(app, /const nativeUrlIsShared = nativeUrl && Array\.isArray\(state\?\.profiles\)/);
  assert.match(app, /treat[\s\S]*contaminated and consult this account's own conversation evidence/);
  assert.match(app, /account\.lastConversationUrl = recoveredUrl/);
});

test("a completed GPT boundary is reclaimed by the live material folder before owner-mismatch pause", () => {
  assert.match(app, /function gptMaterialFolderFromInspection\(inspection = \{\}\)/);
  assert.match(app, /async function resolveGptMaterialForConversationRecovery\(folderName = ""\)/);
  assert.match(app, /async function adoptCompletedGptConversationCheckpoint\(accountId, workerState, inspection\)/);
  assert.match(app, /stage === "completed-copy-pending-package"/);
  assert.match(app, /nextAction === "download-and-package"/);
  assert.match(app, /planEvidence\?\.meta\?\.plannedImageCount/);
  assert.match(app, /recoveryBoundaryConfirmed: true/);
  assert.match(app, /if \(!ownerTask[\s\S]{0,500}adoptCompletedGptConversationCheckpoint/);
  assert.match(app, /normal patrol recovery|正常巡检恢复/);
});

test("GPT production exposes explicit material refresh and multi-slot scheduled mode", () => {
  assert.match(html, /id="gptTestMaterialRefreshBtn"/);
  assert.match(html, /id="gptScheduledEnabled"/);
  assert.match(html, /id="gptSchedulePlan"/);
  assert.match(html, /gptMinimumImageCount[^>]*value="4"/);
  assert.match(app, /1.3 张/);
  assert.match(app, /function parseGptSchedulePlan/);
  assert.match(app, /prepareAutoGptQueue/);
  assert.match(app, /gptTestMaterialRefreshBtn/);
});

test("GPT production history exposes cumulative work, time and average plan summary", () => {
  assert.match(html, /id="gptProductionHistorySummary"/);
  assert.match(app, /function renderGptProductionSummary/);
  assert.match(app, /平均出计划/);
  assert.match(css, /\.gpt-production-history-summary/);
});

test("GPT production history distinguishes recoverable checkpoints from records needing review", () => {
  assert.match(html, /gpt-history-status\.js\?v=/);
  assert.match(app, /const productionHistoryPolicy = window\.TBGptHistoryStatus/);
  assert.match(app, /productionHistoryPolicy\.summarizeProductionHistory/);
  assert.match(app, /productionHistoryPolicy\.classifyProductionHistoryItem/);
  assert.match(app, /可恢复断点/);
  assert.match(app, /待核对/);
  assert.match(serverSource, /taskState:\s*item\.taskState/);
  assert.match(serverSource, /confirmSentAt:\s*item\.confirmSentAt/);
  assert.match(html, /id="gptProductionModeEvidence"/);
  assert.match(app, /productionMode:\s*normalizeGptProductionMode/);
  assert.match(gptSidebar, /productionMode:\s*String\(options\.mode/);
  assert.match(serverSource, /productionMode:\s*item\.productionMode/);
});

test("GPT production history hides the native GPT view before opening its DOM panel", () => {
  assert.match(app, /if \(gptActive\) await window\.gptWorkbench\?\.hide\?\.\(\)\.catch/);
  assert.match(app, /panel\.hidden = false/);
});

test("小猫助手拖拽不被 GPT 内嵌区域硬编码顶开", () => {
  assert.doesNotMatch(app, /overNativeGpt/);
  assert.doesNotMatch(app, /gptHost\.top - launcherH \/ 2 - 8/);
});

test("Electron 小猫悬浮窗拖拽使用屏幕工作区边界而不是主窗口硬编码边界", () => {
  assert.match(desktopMain, /screen\.getDisplayMatching/);
  assert.match(desktopMain, /\.workArea/);
  assert.doesNotMatch(desktopMain, /parent\.y \+ 34/);
  assert.doesNotMatch(desktopMain, /parent\.x \+ 8/);
});

test("Electron 小猫悬浮窗会按左右位置翻转气泡方向", () => {
  assert.match(desktopMain, /dockSide/);
  assert.match(assistantOverlay, /dataset\.side/);
  assert.match(assistantOverlay, /data-side="right"/);
});

test("Electron 小猫不会在透明子窗口短暂失焦时被隐藏或重复重挂载", () => {
  assert.doesNotMatch(desktopMain, /overlay\.on\("blur", hideAttachedAssistantOverlayWhenInactive\)/);
  assert.match(desktopMain, /parent window's blur handler below remains/);
  assert.match(desktopMain, /const modeChanged = previousDetached/);
  assert.match(desktopMain, /if \(modeChanged\) applyAssistantOverlayWindowMode\(overlay\)/);
});

test("小猫拖拽边界以小猫主体为准而不是气泡或透明窗口", () => {
  assert.match(desktopMain, /ASSISTANT_OVERLAY_CAT_BOUNDS/);
  assert.match(desktopMain, /workArea\.y - catTop/);
  assert.match(desktopMain, /workArea\.y \+ workArea\.height - \(catTop \+ catHeight\)/);
  assert.match(assistantOverlay, /assistant-black-cat-v3\.png/);
  assert.match(html, /assistant-black-cat-v3\.png/);
});

test("小猫助手在切换界面时显示上下文提示", () => {
  assert.match(app, /WORKBENCH_ASSISTANT_PAGE_TIPS/);
  assert.match(app, /function showAssistantTipForActiveView/);
  assert.match(app, /showAssistantTipForActiveView\(\)/);
  assert.match(app, /dashboardView.*当前生产状态/);
  assert.match(app, /gptProductionTestView.*内容制作区/);
  assert.match(app, /distributionView.*文件传输/);
  assert.match(app, /conversionView.*流量转化/);
  assert.doesNotMatch(html, /data-tab="plugins"|id="pluginsView"|插件市场/);
  assert.doesNotMatch(app, /PLUGIN_MARKET_ITEMS|renderPluginMarket|pluginsView/);
  assert.match(html, /data-tab="gptProductionTest"/);
  assert.match(gptSidebar, /tb-gpt-production-studio/);
  assert.match(gptBackground, /chrome\.runtime/);
  assert.match(app, /settingsView.*设置中心/);
  assert.match(app, /lastAssistantTipTime/);
  assert.match(app, /10000/);
  assert.match(app, /transient: true/);
});

test("小猫气泡在深色主题下使用深色背景而非硬编码白色", () => {
  assert.match(css, /--assistant-bubble-bg/);
  assert.match(css, /--assistant-bubble-fg/);
  assert.match(css, /--assistant-bubble-border/);
  assert.match(css, /var\(--assistant-bubble-bg, #fff\)/);
  assert.match(css, /var\(--assistant-bubble-fg, var\(--ink\)\)/);
  assert.match(css, /body\[data-theme="midnight"\] \.workbench-assistant-bubble[\s\S]*--assistant-bubble-bg: rgba\(14, 31, 43/);
  assert.match(css, /body\[data-theme="midnight-glass"\] \.workbench-assistant-bubble/);
  assert.match(css, /body\[data-theme="midnight"\] \.workbench-assistant-bubble[\s\S]*--assistant-bubble-fg: #e9f2f7/);
});

test("GPT production exposes editable current-session and injected-prompt profiles", () => {
  assert.match(app, /id="gptModeStartBehavior"/);
  assert.match(app, /value="current"[^>]*>继续使用当前会话/);
  assert.match(app, /value="inject"[^>]*>注入模板提示词/);
  assert.match(app, /const useCurrentSession = \$\("#gptModeStartBehavior"\)\?\.value !== "inject"/);
  assert.match(app, /useCurrentSession \? "" :/);
  assert.match(html, /id="gptModeWorkflowEditor"/);
  assert.match(html, /id="gptAddModeWorkflowStepBtn"/);
  assert.match(app, /function defaultGptWorkflowSteps/);
  assert.match(app, /function validateGptWorkflowSteps/);
  assert.match(app, /必须在计划完成后/);
  assert.match(app, /profileSteps/);
  assert.match(app, /select\.id === "gptProductionMode"/);
  assert.match(app, /kind: "gpt-production-mode"/);
});

test("GPT 工作流提示词和等待参数编辑器不再挤成摆设", () => {
  assert.match(app, /data-workflow-field="text"[\s\S]*gpt-workflow-prompt-editor/);
  assert.match(app, /data-workflow-prompt-edit/);
  assert.match(app, /查看 \/ 编辑/);
  assert.match(app, /gpt-workflow-prompt-summary/);
  assert.match(css, /gpt-workflow-text-cell-simple/);
  assert.match(app, /const key = activeSettingsModeKey\(\)/);
  assert.match(app, /提示词已保存，将从下一套任务生效/);
  assert.doesNotMatch(app, /togglePromptExpand\(row, editor, presetSelect, stepIndex, actionLabel, \{ readOnly: gptAutoRunning \}\)/);
  assert.match(css, /\.gpt-workflow-text-cell:focus-within \.gpt-workflow-prompt-editor[\s\S]*min-height: 92px/);
  assert.match(app, /gpt-workflow-random-inline/);
  assert.doesNotMatch(app, /gpt-workflow-random-inline"><span>随机<\/span>/);
  assert.match(app, /gpt-workflow-retry-delay[\s\S]*失败重试[\s\S]*retryDelayMin[\s\S]*retryDelayMax[\s\S]*秒/);
  assert.doesNotMatch(app, /gpt-workflow-retry-delay"><span>延迟<\/span>/);
  assert.doesNotMatch(app, /<span>秒后<\/span>/);
  assert.doesNotMatch(app, /hasRandomRange \|\| hasDetectDelay \|\| hasRetry/);
  assert.match(app, /gpt-workflow-retry-group/);
  assert.match(css, /\.gpt-workflow-retry-delay input[\s\S]*width: 68px !important/);
  assert.match(css, /\.gpt-workflow-timeout\s*\{[\s\S]*min-width: 118px/);
  assert.match(css, /\.gpt-workflow-timeout input[\s\S]*width: 74px !important/);
  assert.doesNotMatch(app, /data-workflow-move/);
  assert.doesNotMatch(app, /dataset\.workflowMove/);
});

test("GPT 自动生产每个步骤都有有限截止时间和可恢复的历史遥测", () => {
  assert.match(gptSidebar, /runWorkflowStepWithDeadline/);
  assert.match(gptSidebar, /WORKFLOW_STEP_TIMEOUT/);
  assert.match(gptSidebar, /workflowStepHistory/);
  assert.match(gptSidebar, /workflowStepAttempts/);
  assert.match(gptSidebar, /deadlineAt/);
  assert.match(gptSidebar, /waitLimitMs/);
  assert.match(gptSidebar, /task\.controller\?\.abort\(\)/);
  assert.match(gptSidebar, /step-started/);
  assert.match(gptSidebar, /step-completed/);
  assert.match(gptSidebar, /step-timeout/);
  assert.match(server, /workflowStepHistory/);
  assert.match(server, /stageHistory/);
  assert.match(gptSidebar, /task\.metrics\.current\.status === "running"/);
  assert.match(gptSidebar, /task\.metrics\.current\.endedBy = "stage-transition"/);
});

test("文案请求发送保留两分钟桥接预算，文案生成等待仍由 wait-copy 单独限时", () => {
  assert.match(gptSidebar, /action === "request-copy"[\s\S]{0,160}Math\.max\(wfTimeout\(action, 120\), 120_000\)/);
  assert.match(gptSidebar, /const copyTimeoutMs = wfAutoDetect\("wait-copy"\)[\s\S]{0,100}wfTimeout\("wait-copy", 480\)/);
});

test("GPT 检查点持久化三源阶段证据与 A B 工作流隔离字段", () => {
  assert.match(server, /normalizeEvidenceSnapshot/);
  assert.match(server, /\.\.\.normalizeEvidenceSnapshot\(source\)/);
  assert.match(server, /workflowVariant:/);
  assert.match(server, /workflowVariantVersion:/);
  assert.match(server, /experimentId:/);
  assert.match(server, /sessionPolicy:/);
  assert.match(server, /templateConversationUrl:/);
  assert.match(server, /workflowProfileId:/);
});

test("GPT 浏览器账号持久化独立工作流 variant 且任务继承它", () => {
  assert.match(desktopMain, /function safeGptWorkflowVariant/);
  assert.match(desktopMain, /workflowVariant:/);
  assert.match(desktopMain, /workflowVariantVersion:/);
  assert.match(desktopMain, /experimentId:/);
  assert.match(desktopMain, /sessionPolicy:/);
  assert.match(app, /workflowVariant: String\(item\.workflowVariant/);
  assert.match(app, /workflowVariant: String\(account\?\.workflowVariant/);
  assert.match(app, /selectedTemplateId: String\(account\?\.selectedTemplateId/);
  assert.match(app, /fresh-session-fixed-template/);
  assert.match(app, /id: "current-master-v1"/);
  assert.match(app, /navigation: "new-chat"/);
  assert.match(app, /accountId: workerState\.accountId/);
});

test("GPT 原生账号水合不会丢失新模式与固定模板绑定", () => {
  const hydrateBlock = app.match(/async function hydrateGptBrowserProfiles\(\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction/)?.[1] || "";
  assert.match(hydrateBlock, /workflowVariant: String\(profile\.workflowVariant \|\| "legacy-v1"\)/);
  assert.match(hydrateBlock, /workflowVariantVersion: String\(profile\.workflowVariantVersion \|\| "1"\)/);
  assert.match(hydrateBlock, /sessionPolicy: String\(profile\.sessionPolicy/);
  assert.match(hydrateBlock, /selectedTemplateId: String\(profile\.selectedTemplateId \|\| ""\)/);
  assert.match(hydrateBlock, /templateConversationUrl: String\(profile\.templateConversationUrl \|\| ""\)/);
  assert.match(hydrateBlock, /workflowProfileId: String\(profile\.workflowProfileId \|\| ""\)/);
});

test("全新会话固定模板模式只保留一个模板并写入原生账号档案", () => {
  const templateSelectionBlock = app.match(/const gptTemplateCheck = event\.target\.closest\("\[data-gpt-test-template-check\]"\);([\s\S]*?)\r?\n\s*const jump =/)?.[1] || "";
  assert.match(templateSelectionBlock, /account\?\.workflowVariant === "fresh-session-fixed-template"/);
  assert.match(templateSelectionBlock, /gptTestSelectedTemplates\.clear\(\)/);
  assert.match(templateSelectionBlock, /account\.selectedTemplateId =/);
  assert.match(templateSelectionBlock, /window\.gptWorkbench\?\.saveProfile/);
});

test("发送区公开显示每窗口工作流版本切换", () => {
  assert.match(html, /id="gptWorkflowVariant"/);
  assert.match(html, /value="legacy-v1">旧模式｜复用原对话/);
  assert.match(html, /value="fresh-session-fixed-template">新模式｜每套新对话 \+ 固定模板/);
  assert.match(html, /id="gptWorkflowVariantHint"/);
});

test("工作流版本切换按当前账号持久化并同步会话策略", () => {
  assert.match(app, /function renderGptWorkflowVariantControl\(\)/);
  assert.match(app, /\$\("#gptWorkflowVariant"\)\?\.addEventListener\("change", async \(event\) =>/);
  assert.match(app, /currentAccount\.workflowVariant = variant/);
  assert.match(app, /currentAccount\.sessionPolicy = variant === "fresh-session-fixed-template" \? "fresh-session" : "reuse-conversation"/);
  assert.match(app, /window\.gptWorkbench\?\.saveProfile\?\.\(\{ \.\.\.currentAccount, active: false \}\)/);
});

test("发送区使用紧凑控制条并移除重复常驻说明", () => {
  assert.match(html, /id="gptSkipTaskBtn"[^>]*>跳过作品<\/button>/);
  assert.match(html, /<summary[^>]*>恢复工具<\/summary>/);
  assert.match(css, /\.gpt-mode-hint\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /\.gpt-queue-actions\s*\{[\s\S]*?display:\s*grid/);
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
});

test("当前可见 GPT 浏览器账号 Tab 使用明确选中色并暴露选中语义", () => {
  const renderTabs = appFunctionSource("renderGptAccountTabs", "renameGptAccount");
  assert.match(renderTabs, /account\.id === activeGptAccountId \? "true" : "false"/);
  assert.match(renderTabs, /aria-current="\$\{account\.id === activeGptAccountId \? "page" : "false"\}"/);
  const activeTabCss = css.match(/\.gpt-account-tab\.active\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.match(activeTabCss, /background:\s*linear-gradient/);
  assert.match(activeTabCss, /color:\s*#fff/);
  assert.match(activeTabCss, /box-shadow:/);
});

test("停止状态只显示一条检查点信息", () => {
  const statusBlock = app.match(/function updateGptTestQueueStatus\([\s\S]*?const BADGE_CLASS_KEY/)?.[0] || "";
  assert.match(statusBlock, /productionStatus\.code === "stopped"\s*\?\s*"保留当前作品检查点"/);
  assert.match(statusBlock, /productionStatus\.code === "stopped"\s*\?\s*""/);
});

test("GPT 设置和助手控件在宽屏下紧凑自适应", () => {
  assert.match(html, /id="gptAddModeWorkflowStepBtn"[^>]*class="secondary-button gpt-workflow-add-step-btn"[^>]*aria-label="添加环节"[^>]*>＋<\/button>/);
  assert.doesNotMatch(html, /＋ 添加环节/);
  assert.match(css, /\.workbench-assistant-launcher[\s\S]*width: clamp\(42px, 4\.8vw, 58px\)/);
  assert.match(css, /\.settings-two-columns[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(150px, 1fr\)\)/);
  assert.match(css, /\.settings-sub-group[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(260px, 1fr\)\)/);
  assert.match(css, /\.settings-wide-field[\s\S]*grid-column: auto/);
  assert.match(css, /\.gpt-workflow-add-step-btn[\s\S]*justify-self: start/);
});

test("GPT 账号窗口设置跟随真实手动账号列表刷新", () => {
  assert.match(app, /function renderGptBrowserManager\(options = \{\}\)/);
  assert.match(app, /gpt-browser-manager-summary[\s\S]*gptAccounts\.length[\s\S]*个账号窗口/);
  assert.match(app, /renderGptBrowserManager\(\{ hydrateNative: true \}\)/);
  assert.match(app, /options\.hydrateNative[\s\S]*hydrateGptBrowserProfiles\(\)/);
  assert.match(app, /gptAutoSettings\.accounts = normalizedSettings/);
  assert.match(app, /activeGptAccountId = gptAccounts\.some\(\(profile\) => profile\.id === state\.activeId/);
  assert.match(app, /if \(gptShowInFlight\) await gptShowInFlight\.catch/);
  assert.match(app, /gptLastShowSignature = "";[\s\S]*await showEmbeddedGptView\(\)\.catch/);
});

test("GPT 内置测试把本地素材和模板与持久原生网页合成一个生产界面", () => {
  assert.match(html, /data-tab="gptProductionTest"/);
  assert.match(html, /id="gptTestMaterialFolders"/);
  assert.match(html, /id="gptTestTemplateList"/);
  assert.match(html, /id="gptEmbeddedHost"/);
  assert.match(html, /id="gptTestSendBtn"/);
  assert.match(app, /gptTestSelectedMaterials/);
  assert.match(app, /gptTestSelectedTemplates/);
  assert.match(app, /buildGptTemplateInitTask/);
  assert.match(app, /GPT_CURRENT_MASTER_PROMPT/);
  assert.match(app, /templates\.flatMap/);
  assert.match(app, /window\.gptWorkbench\.sendTask/);
  assert.doesNotMatch(html, /做一套|做一批/);
  assert.match(desktopMain, /new WebContentsView/);
  assert.match(desktopMain, /persist:teambuilding-gpt-production/);
  assert.match(desktopMain, /integrations["'], ["']gpt-production-extension/);
  assert.match(desktopMain, /\[bundled\]/);
  assert.doesNotMatch(desktopMain, /teambuilding-gpt-production-extension["'].*src/);
  assert.match(desktopMain, /loadExtension/);
  assert.match(serverSource, /\/api\/extension\/save-generated-image/);
  assert.match(serverSource, /sharp\(bytes\)\.metadata\(\)/);
  assert.match(serverSource, /new TextDecoder\("gb18030"\)/);
  assert.match(serverSource, /\/\^OK\$\/m/);
  assert.match(serverSource, /\/\^DUPLICATE\$\/m/);
  assert.match(serverSource, /duplicateReason:\s*String\(fields\.DuplicateReason/);
  assert.match(serverSource, /deletedImages:\s*Math\.max\(0, Number\(fields\.DeletedImages/);
  assert.match(desktopMain, /tb-workbench-upload/);
  assert.match(desktopPreload, /gptWorkbench/);
  assert.match(css, /\.gpt-production-test-grid/);
});

test("GPT 自动生产 uses isolated accounts, browser controls, real serial completion and random pacing", () => {
  assert.match(html, /内容生产/);
  assert.match(html, /id="gptBrowserBackBtn"/);
  assert.match(html, /id="gptBrowserForwardBtn"/);
  assert.match(html, /id="gptBrowserReloadBtn"/);
  assert.match(html, /id="gptBrowserHomeBtn"/);
  assert.match(html, /id="gptAccountTabs"/);
  // 0.14.31: delay inputs moved into workflow steps as「随机等待」modules
  assert.match(app, /Math\.random\(\) \* \(maxDelay - minDelay\)/);
  assert.match(app, /window\.gptWorkbench\.sendTask\(task\)/);
  assert.match(app, /gptAutoSettings\.accountTaskLimit/);
  assert.match(desktopMain, /GPT_PARTITION_PREFIX = "persist:teambuilding-gpt-production"/);
  assert.match(desktopMain, /partition: `\$\{GPT_PARTITION_PREFIX\}-\$\{id\}`/);
  assert.match(desktopMain, /desktop:gpt-navigate/);
});

test("GPT automatic queue enforces one post folder per serial upload", () => {
  assert.match(app, /function attachmentsForSingleMaterial\(/);
  assert.match(app, /normalized\.startsWith\(prefix\)/);
  assert.match(app, /task\.attachments = attachmentsForSingleMaterial/);
  assert.match(app, /const materialAttachments = attachmentsForSingleMaterial\(entry\.item\)/);
  assert.match(app, /const attachments = freshSessionFixedTemplate[\s\S]{0,260}materialAttachments/);
  assert.match(app, /window\.gptWorkbench\.sendTask\(task\)/);
  assert.match(gptSidebar, /function assertSinglePostAttachmentBoundary\(/);
  assert.match(gptSidebar, /const existingComposerAttachments = attachmentPreviewCount\(\)/);
});

test("composer attachment conflicts pause the batch without advancing to another post", () => {
  assert.match(app, /COMPOSER_ATTACHMENTS_PENDING/);
  assert.match(app, /COMPOSER_DRAFT_PENDING/);
  assert.match(app, /queue-integrity failure/);
  assert.match(app, /gptAutoPaused = true/);
  assert.match(app, /清理输入框后从当前帖子继续/);
  assert.match(app, /function currentGptQueueIntegrityBlock\(/);
  assert.match(app, /boundaryConflict = \[[\s\S]*?COMPOSER_ATTACHMENTS_PENDING/);
  assert.match(app, /delete failedTask\._errorCode/);
});

test("single-account production refuses authentication pages before claiming or uploading a post", () => {
  assert.match(desktopMain, /authenticationRequired/);
  assert.match(desktopMain, /terminalAuthenticationSignal/);
  assert.match(desktopMain, /\\u4f1a\\u8bdd\\u5df2\\u8fc7\\u671f/);
  assert.match(desktopMain, /authenticationUrl \|\| terminalAuthenticationSignal \|\| \(!composerReady && authenticationSignal\)/);
  assert.match(desktopMain, /productionReady/);
  assert.match(desktopMain, /TeambuildingGptConversationStateSnapshot/);
  assert.match(app, /const preflight = await window\.gptWorkbench\.status\(runAccountId\)/);
  assert.match(app, /if \(!preflight\?\.productionReady\)/);
  assert.match(app, /本次没有上传任何素材/);
  const preflightIndex = app.indexOf("const preflight = await window.gptWorkbench.status(runAccountId)");
  const runningIndex = app.indexOf("gptAutoRunning = true;", preflightIndex);
  assert.ok(preflightIndex >= 0 && runningIndex > preflightIndex, "preflight must run before the queue is marked running");
});

test("GPT 自动生产 downloads and packages only the current verified batch", () => {
  assert.match(gptSidebar, /chatgpt-workpkg-\$\{batchId\}-\$\{index \+ 1\}-of-\$\{urls\.length\}/);
  assert.match(gptSidebar, /type: "tb-download"/);
  assert.match(gptSidebar, /batchId: downloadResult\.batchId/);
  assert.match(gptSidebar, /expectedImageCount: downloadResult\.count/);
  assert.match(gptSidebar, /platformPauseReason\(\)/);
  assert.match(gptBackground, /api\/extension\/download-event/);
  assert.match(server, /chatgpt-workpkg-task-\$\{batchId\}\.json/);
  assert.match(server, /"-BatchId", batchId, "-ExpectedImageCount"/);
  assert.match(server, /成品图片核对失败/);
  assert.match(server, /成品文件夹没有 TXT 文案/);
});

test("GPT automatic production exposes safe retry, quota and real archive controls", () => {
  assert.match(html, /id="gptRetryTaskBtn"/);
  assert.match(html, /id="gptResetTaskBtn"/);
  assert.match(html, /id="gptMoreRecovery"/);
  assert.match(app, /id: "gpt\.recover-current"/);
  assert.match(app, /id: "gpt\.reset-current"/);
  assert.match(app, /recordGptActionAudit/);
  // 0.14.31: archive checkbox moved into workflow as「移动到成品库」step
  assert.match(html, /id="gptUploadLimit"/);
  assert.match(html, /id="gptGenerationLimit"/);
  assert.match(app, /retryFromStage/);
  assert.match(app, /retryFromPercent/);
  assert.match(app, /gpt-production\/quota/);
  assert.match(gptSidebar, /resumeExistingWorkflow/);
  assert.match(gptSidebar, /autoArchive/);
  assert.match(gptSidebar, /gpt-production\/archive-material/);
  assert.match(gptSidebar, /allowUntitledRecovery: Boolean\(message\.allowUntitledRecovery\)/);
  assert.match(server, /function archiveMaterialAfterProduction/);
  assert.match(server, /sourceMaterialArchivePath: finalPath/);
  assert.match(server, /packageRecord\.sourceMaterialArchivePath = finalPath/);
});

test("automatic GPT recovery can recreate only an idle, non-held renderer", () => {
  assert.match(desktopMain, /bridgeRecoveryRecreate/);
  assert.match(desktopMain, /async function recreateGptAccountView\(/);
  assert.match(desktopMain, /productionTaskAccounts\.has\(id\)/);
  assert.match(desktopMain, /persistedGptUserHold\(id\)/);
  assert.match(desktopMain, /rootPageLoadStall = options\.forceRecovery === true/);
  assert.match(desktopMain, /const rootPageNotReady =/);
  assert.match(desktopMain, /rootPageNotReady/);
  assert.match(desktopMain, /gpt-view-recreate-forced-stalled-root/);
  assert.match(desktopMain, /function loadGptUrlBounded\(/);
  assert.match(desktopMain, /gpt-account-load-bounded/);
  assert.match(desktopMain, /gpt-init-timeout/);
  assert.match(desktopMain, /init:\$\{account\.id\}/);
  assert.match(desktopMain, /desktop:gpt-recreate/);
  assert.match(desktopPreload, /recreate\(input = \{\}\)/);
  assert.match(desktopPreload, /forceRecovery: input\.forceRecovery === true/);
  assert.match(desktopMain, /forceRecovery: input\.forceRecovery === true/);
  assert.match(app, /window\.gptWorkbench\.recreate/);
  assert.match(app, /forceRecovery: true/);
  assert.match(app, /GPT 窗口已重建，等待网页就绪/);
});

test("continuous single-account workers refill an exhausted queue after completion", () => {
  const start = app.indexOf("async function ensureGptWindowWorkerQueue");
  const end = app.indexOf("function independentGptWindowMode", start);
  const block = app.slice(start, end);
  assert.match(block, /const continuousWindow = normalizeGptProductionMode\(settings\.mode\) === "single"/);
  assert.match(block, /const queueExhausted = continuousWindow/);
  assert.match(block, /workerState\.queue = \[\]/);
  assert.match(block, /selectLowestUsageGptEntries\(settings\.accountTaskLimit \|\| 8, \{ accountId \}\)/);
  assert.match(app, /gptWindowWorkerPromises\.delete\(key\);/);
  assert.match(app, /scheduleContinuousGptProduction\(Math\.max\(1_500, Number\(settings\.minDelaySeconds \|\| 25\) \* 1_000\)\)/);
});

test("legacy global queue is copied once into its owning independent window", () => {
  const start = app.indexOf("async function ensureGptWindowWorkerQueue");
  const end = app.indexOf("function independentGptWindowMode", start);
  const block = app.slice(start, end);
  assert.match(block, /legacyOwner === String\(accountId\) && gptTestQueue\.length/);
  assert.match(block, /const legacyTasks = gptTestQueue/);
  assert.match(block, /accountId: String\(task\.accountId \|\| accountId\)/);
  assert.match(block, /accountWindowId: String\(task\.accountWindowId \|\| accountId\)/);
  assert.match(block, /browserIdentityId: String\(task\.browserIdentityId \|\| accountId\)/);
  assert.match(block, /if \(legacyTasks\.length\)/);
  assert.match(block, /gptTestQueue = \[\]/);
  assert.match(block, /gptTestQueueIndex = 0/);
  assert.match(block, /no[\s\S]{0,120}material, checkpoint, log or completed output is deleted/);
});

test("runtime restart adopts unowned legacy tasks only to the old active account", () => {
  const start = app.indexOf("function adoptGptRuntimeQueueIntoWindowWorkers");
  const end = app.indexOf("// The extension can finish", start);
  const block = app.slice(start, end);
  assert.match(block, /const legacyOwner = String\(runtimeState\?\.queue\?\.activeAccountId/);
  assert.match(block, /const taskOwner = String\(/);
  assert.match(block, /const accountId = String\(persistedTask\?\.accountId \|\| persistedTask\?\.browserIdentityId \|\| taskOwner \|\| legacyOwner\)/);
  assert.match(block, /accountWindowId: String\(persistedTask\.accountWindowId \|\| accountId\)/);
  assert.match(block, /browserIdentityId: String\(persistedTask\.browserIdentityId \|\| accountId\)/);
  assert.match(block, /quotaAccountId: String\(persistedTask\.quotaAccountId \|\| accountId\)/);
  assert.match(block, /never distribute them to other accounts by guesswork/);
  assert.match(block, /const legacyKeys = new Set\(tasks\.map/);
  assert.match(block, /Older builds copied the global queue into every window worker/);
  assert.match(block, /workerId !== legacyOwner/);
  assert.match(block, /persistGptWindowWorkerState\(workerId, state\)/);
  const startupStart = app.indexOf("const runtimeReconciliation = await reconcileGptRuntimeState()");
  const startupEnd = app.indexOf("refreshGptUiAfterRuntimeRestore();", startupStart);
  const startup = app.slice(startupStart, startupEnd);
  assert.match(startup, /const adoptedRuntimeQueueTasks = adoptGptRuntimeQueueIntoWindowWorkers/);
  assert.match(startup, /if \(adoptedRuntimeQueueTasks > 0\) persistGptQueue\(\)/);
});

test("independent worker persistence stamps missing task ownership", () => {
  const start = app.indexOf("function persistGptWindowWorkerState");
  const end = app.indexOf("function activeGptWindowWorkerState", start);
  const block = app.slice(start, end);
  assert.match(block, /Every task inside an independent worker inherits that worker's account/);
  assert.match(block, /accountId: String\(task\.accountId \|\| key\)/);
  assert.match(block, /accountWindowId: String\(task\.accountWindowId \|\| key\)/);
  assert.match(block, /browserIdentityId: String\(task\.browserIdentityId \|\| key\)/);
  assert.match(block, /quotaAccountId: String\(task\.quotaAccountId \|\| key\)/);
});

test("automatic startup clears a recognizable stale composer before the next material", () => {
  const start = app.indexOf("async function reconcileIndependentConversationBeforeStart");
  const end = app.indexOf("async function runIndependentGptWindow", start);
  const block = app.slice(start, end);
  assert.match(block, /staleWorkbenchDraft = \/当前素材文件夹：\|请完整读取全部附件\|迁移计划/);
  assert.match(block, /automaticDraftMismatch = Boolean\(/);
  assert.match(block, /currentTask\._submittedToGpt !== true/);
  assert.match(block, /!currentTaskMatches/);
  assert.match(block, /staleCompletedCopyBoundary = stage === "completed-copy-pending-package"/);
  assert.match(block, /\(!currentTaskMatches \|\| staleCompletedCopyBoundary\)/);
  assert.match(block, /currentTask\.forceUpload = true/);
  assert.match(block, /STALE_COMPOSER_AUTO_RECOVERED/);
  assert.match(block, /clearedStaleComposer: true/);
  assert.match(block, /!gptWindowIsUserStopped\(key\)/);
  assert.match(block, /!gptWindowIsUserPaused\(key\)/);
});

test("quota wait mirrors preserve the scheduled probe when only the status changes", () => {
  const start = app.indexOf("function writeGptWindowRuntime");
  const end = app.indexOf("function scheduleGptWindowScheduleWake", start);
  const block = app.slice(start, end);
  assert.match(block, /waitStatus === "waiting-quota"/);
  assert.match(block, /previousRuntime\.nextProbeAt/);
  assert.match(block, /nextPatch\.nextProbeAt = Number\(previousRuntime\.nextProbeAt\)/);
  assert.match(block, /nextPatch\.nextProbeAt \|\| previousRuntime\.nextProbeAt/);
});

test("quota waiting inspects a completed-copy boundary before blocking the window", () => {
  const start = app.indexOf("async function reconcileGptWindow");
  const end = app.indexOf("async function switchGptAccount", start);
  const block = app.slice(start, end);
  assert.match(block, /window\.gptWorkbench\?\.inspectStatus\?\.\(key\)/);
  assert.match(block, /completed-copy-pending-package/);
  assert.match(block, /download-and-package/);
  assert.match(block, /先下载归档当前作品；额度只限制下一套/);
  assert.match(block, /if \(!completedCopyBoundary\)/);
});

test("completed-copy adoption can reclaim a missing DOM material label from the same conversation log request", () => {
  const start = app.indexOf("async function adoptCompletedGptConversationCheckpoint");
  const end = app.indexOf("async function adoptRecoverableGptConversationCheckpoint", start);
  const block = app.slice(start, end);
  assert.match(block, /copy-recovery-sent/);
  assert.match(block, /canonicalGptConversationUrl/);
  assert.match(block, /queueByRequestId/);
  assert.match(block, /durableCopyOwner/);
  assert.match(block, /Same-account \+ same\s*\/\/ conversation \+ a durable copy event/);
  assert.match(block, /durableCopyOwner\?\.materialPath/);
});

test("separated download and move-archive workflows keep automatic packaging enabled", () => {
  assert.match(app, /function hasEnabledGptArchiveStep\(steps\)/);
  assert.match(app, /enabledActions\.has\("package-archive"\)[\s\S]*?enabledActions\.has\("move-archive"\)/);
  assert.match(app, /gptAutoSettings\.autoPackage = hasEnabledGptArchiveStep\(profile\.steps\)/);
  assert.match(app, /const derivedAutoPackage = hasEnabledGptArchiveStep\(actualSteps\)/);
});

test("archive completion records the exact current conversation boundary", () => {
  assert.match(gptSidebar, /markArchivedAutomationBoundary\(String\([\s\S]*?boundary\?\.materialText[\s\S]*?snapshot\.materialText/);
  assert.match(gptSidebar, /const currentArchiveBoundary = currentAutomationBoundarySnapshot\(\);[\s\S]*?currentArchiveBoundary\?\.materialText/);
  const replayStart = gptSidebar.indexOf("if (record.packagePath && options.requestId)");
  const replayEnd = gptSidebar.indexOf("const silentImageRetry", replayStart);
  assert.ok(replayStart >= 0 && replayEnd > replayStart);
  assert.match(gptSidebar.slice(replayStart, replayEnd), /markArchivedAutomationBoundary\(String\(snapshot\.materialText/);
  assert.match(gptSidebar, /markerEvidenceMatches[\s\S]*?latestAssistantText/);
});

test("completed copy in a restored long conversation is preserved and cannot advance the queue when missing", () => {
  assert.match(gptSidebar, /function cleanAssistantText\(turn\)[\s\S]*const visibleText = String\(turn\.innerText/);
  assert.match(gptSidebar, /cleanedText\.length[^;]*\? cleanedText : visibleText/);
  assert.match(gptSidebar, /copyError\.code = "COPY_REQUIRED"/);
  assert.match(app, /"COPY_REQUIRED"(?:\]|, "WORKFLOW_STEP_TIMEOUT", "WORKFLOW_TASK_TIMEOUT"\])\.includes/);
});

test("copy recovery is durable and cannot resend the same request after timeout", () => {
  assert.match(gptSidebar, /copyRecoveryExhausted === true/);
  assert.match(gptSidebar, /文案等待\/恢复已达到上限；已停止重复发送/);
  assert.match(gptSidebar, /saveCheckpoint\("文案恢复达到上限", 74\)/);
  assert.match(gptSidebar, /saveCheckpoint\("文案等待超时", 74\)/);
  assert.match(gptSidebar, /copyRecoveryExhausted: workflow\.copyRecoveryExhausted === true/);
  assert.match(gptSidebar, /workflow\.copyRecoveryExhausted \|\|= checkpoint\.copyRecoveryExhausted === true/);
});

test("copy boundary cannot skip image recovery without same-material image evidence", () => {
  assert.match(gptSidebar, /const liveImageUrls = uniqueGeneratedImageUrls\(/);
  assert.match(gptSidebar, /const liveCopyBoundary = \["waiting-copy", "completed-copy-pending-package"\]/);
  assert.match(gptSidebar, /liveCopyBoundary \? liveImageEvidenceCount : 0/);
  assert.match(gptSidebar, /wait-images-boundary-blocked/);
  assert.match(gptSidebar, /expectedImageCount: liveExpectedImageCount/);
});

test("durable copy and archive evidence seals the request before lazy DOM recovery", () => {
  assert.match(gptSidebar, /conversation-log\?limit=500/);
  assert.match(gptSidebar, /durable-copy-boundary-adopted/);
  assert.match(gptSidebar, /durable-archive-log/);
  assert.match(gptSidebar, /workflow\.packageResult =/);
  assert.match(gptSidebar, /recoveredFromDurableArchive: true/);
  assert.match(gptSidebar, /archivedEntry|archiveEntry/);
});

test("reconciled completion increments each account set exactly once per request", () => {
  assert.match(app, /lastCompletedRequestId: ""/);
  assert.match(app, /function markGptWindowSetCompleted\(accountId = activeGptAccountId, requestId = ""\)/);
  assert.match(app, /if \(completionKey && String\(current\.lastCompletedRequestId \|\| ""\) === completionKey\) return current/);
  assert.match(app, /markGptWindowSetCompleted\(reconciledAccountId, task\.requestId\)/);
});

test("partial GPT attachments are treated as an upload-limit signal and the cat chat stays above the native page", () => {
  assert.match(gptSidebar, /UPLOAD_LIMIT_SIGNAL/);
  assert.match(gptSidebar, /GPT 上传未完整/);
  assert.match(gptSidebar, /可能触达上传图片\/文件上限/);
  assert.match(app, /UPLOAD_LIMIT_SIGNAL/);
  assert.match(app, /assistantChatOpen/);
  assert.match(app, /await window\.gptWorkbench\?\.hide/);
    assert.match(css, /\.workbench-assistant-panel[\s\S]*z-index: var\(--tb-layer-assistant-panel\)/);
    assert.match(css, /\.workbench-assistant-messages[\s\S]*max-height: min\(150px, 22vh\)/);
    assert.match(css, /\.workbench-assistant-panel[\s\S]*max-height: min\(300px, 46vh\)/);
  });

test("manual production remains available while automatic production obeys the configured quota boundary", () => {
  assert.match(app, /const resumeCurrentConversation = options\.resumeCurrentConversation === true/);
  assert.match(app, /if \(!manualMode && !resumeCurrentConversation\) await ensureGptTaskQuota/);
  assert.match(app, /error\.code = "LOCAL_QUOTA_BOUNDARY"/);
  assert.match(app, /当前作品尚未启动，已在作品边界等待额度恢复/);
  assert.match(app, /allowManualOverride: Boolean\(options\.allowQuotaOverride \|\| options\.quotaProbe\)/);
  assert.match(app, /手动强制尝试/);
});

test("archive recovery claims the selected account before a stale boundary can pause it", () => {
  const claim = app.indexOf("task.accountId = runAccountId;");
  const recovery = app.indexOf("recoverCompletedGptConversationBeforeInjection(task, runAccountId)");
  assert.ok(claim >= 0 && recovery > claim, "the checkpoint must be account-bound before archive recovery");
  assert.match(app, /allowQuotaOverride,\n\s+userInitiated: true,\n\s+allowWindowSwitch: true/);
});

test("GPT 对话日志不读取作用域外的 task 变量", () => {
  const loggerStart = gptSidebar.indexOf("function logConversationEvent");
  const loggerEnd = gptSidebar.indexOf("function readStoredPaths", loggerStart);
  const loggerSource = gptSidebar.slice(loggerStart, loggerEnd);
  assert.ok(loggerStart >= 0 && loggerEnd > loggerStart);
  assert.doesNotMatch(loggerSource, /task\?\./);
});

test("GPT 完成记账不读取作用域外的 uploadImages 变量", () => {
  assert.match(app, /let uploadImages = 0;[\s\S]{0,500}uploadImages = \(task\.attachments/);
  assert.doesNotMatch(app, /try \{[\s\S]{0,180}const uploadImages =/);
});

test("single-window continuation enforces quota before upload and reattaches tasks paused before the bridge", () => {
  assert.match(app, /TBGptAccountRotation\.taskQuotaBoundary/);
  assert.match(app, /error\.gptLimit = true/);
  assert.match(app, /task\._submittedToGpt = true/);
  assert.match(app, /shouldReattachGptTaskOnResume/);
  assert.match(app, /task\.forceUpload = true/);
  assert.match(desktopMain, /forceUpload: Boolean\(task\.forceUpload\)/);
  assert.match(gptSidebar, /const forceUpload = Boolean\(message\.forceUpload\)/);
  assert.match(gptSidebar, /!entry\.forceUpload/);
});

test("retrying a failed send or composer boundary forces a clean one-post upload", () => {
  assert.match(app, /const failureText = `\$\{gptLastFailedStage \|\| ""\} \$\{failedTask\._error \|\| failedTask\.error \|\| ""\}`/);
  assert.match(app, /requiresFreshUpload = \/没有检测到新消息\|发送按钮已出现\|未发送附件/);
  assert.match(app, /failedTask\.forceUpload = true/);
  assert.match(app, /failedTask\._submittedToGpt = false/);
  assert.match(app, /delete failedTask\.workflow/);
});

test("configured quota blocks only the next work boundary and real web limits stay separately detectable", () => {
  assert.match(app, /requiredGenerations: generatedImages/);
  assert.match(app, /remainingGenerations: quota\.remainingGenerations/);
  assert.match(app, /Date\.parse\(String\(quota\.nextExpiryAt \|\| ""\)\)/);
  assert.match(app, /localStorage\.setItem\(gptCycleStateKey\(quotaAccountId\), JSON\.stringify\(boundaryState\)\)/);
  assert.match(app, /expectedAttachments: requiredUploads[\s\S]{0,160}nextProbeAt/);
  assert.match(app, /localQuotaBoundary[\s\S]{0,500}_submittedToGpt = false/);
  assert.match(app, /function isActualGptLimitMessage/);
  assert.match(app, /function recordActualGptLimit/);
  assert.match(app, /function inferGptQuotaLimitKind/);
  assert.match(app, /function formatGptQuotaProbeTime/);
  assert.match(app, /已触发额度\/低产出上限/);
  assert.match(app, /自动重新探测/);
  assert.match(app, /quotaPauseMessage: uiState\.quotaPauseStatus/);
  // The quota resume control is intentionally short; the delayed tooltip
  // carries the full "wait for the next quota window" explanation.
  assert.match(app, /继续尝试/);
  assert.match(app, /已触达额度或低产出上限/);
  assert.match(app, /上传本轮起点/);
  assert.match(app, /等待真实消耗后计算/);
  assert.match(app, /scheduleGptQuotaReminder\(new Date\(nextProbeAt\)\.toISOString\(\), quotaAccountId\)/);
  assert.match(app, /uploadCycleStartAt/);
  assert.match(app, /generationCycleStartAt/);
  assert.match(app, /nextUploadProbeAt/);
  assert.match(app, /nextGenerationProbeAt/);
});

test("生产页、设置页和小猫共用同一个生产状态判定器", () => {
  assert.match(html, /gpt-production-status\.js/);
  assert.match(app, /function resolveCurrentProductionStatus/);
  assert.match(app, /const productionStatus = resolveCurrentProductionStatus\(\)/);
  assert.doesNotMatch(app, /已恢复未完成队列/);
});

test("跨页面生产通知结束后恢复当前页面自己的固定消息", () => {
  assert.match(app, /sourceView: "gptProductionTestView"/);
  assert.match(app, /pinnedAssistantMessageAfterNotice/);
  assert.match(app, /assistantLastMessagesByView\.get\(activeView\)/);
});

test("low-output generation is a batch-level limit signal", () => {
  assert.match(app, /function isLowOutputGptLimitMessage/);
  assert.match(app, /生成结果不足\|本轮只检测到\|安全线为\|额度触顶\|生成不完整/);
  assert.match(app, /const lowOutputLimit = isLowOutputGptLimitMessage/);
  assert.match(app, /已识别为触顶征兆，当前素材跳过，本批暂停/);
  assert.match(app, /等待下一轮额度探测/);
  assert.match(app, /本轮图片低于安全线，判定为触顶\/降级征兆/);
  assert.match(app, /if \(lowOutputLimit\) gptTestQueueIndex \+= 1/);
  assert.match(app, /quotaPausedTask = task/);
  assert.match(app, /if \(!quotaPausedTask && failedTask/);
  assert.match(app, /function resetGptCycleForAutomaticProbe/);
  assert.match(app, /async function resumeGptQueueAfterQuotaProbe/);
  assert.match(app, /const independentWindow = Boolean\(account/);
  assert.match(app, /reconcileGptWindow\((?:key|windowKey), \{ force: false, automaticResume: true \}\)/);
  assert.match(app, /正在用下一条素材自动试跑/);
  assert.match(app, /function restoreGptQuotaProbeTimers/);
  assert.match(app, /restoreGptQuotaProbeTimers\(\)/);
});

test("an explicit zero-image generation failure retries the same conversation immediately", () => {
  assert.match(gptSidebar, /const explicitImageFailure = urls\.length === 0/);
  assert.match(gptSidebar, /something went wrong while generating/);
  assert.ok(gptSidebar.includes("\\u51fa\\u56fe(?:\\u65f6)?\\u53d1\\u751f\\u4e86?\\u751f\\u6210\\u9519\\u8bef"));
  assert.match(gptSidebar, /evidence: "failed-image-response"/);
  assert.match(gptSidebar, /isRetryableNoImageResponseEvidence/);
  assert.match(gptSidebar, /stalled-image-response/);
  assert.match(gptSidebar, /classifyExhaustedImageRecovery/);
  assert.match(gptSidebar, /IMAGE_GENERATION_UNAVAILABLE/);
  assert.match(app, /"IMAGE_GENERATION_UNAVAILABLE"/);
});

test("a Chinese GPT image-generation error resumes the confirmed image stage once per reply", () => {
  assert.match(gptSidebar, /imageRecoveryFailureSignature/);
  assert.match(gptSidebar, /explicit-gpt-image-generation-error/);
  assert.match(gptSidebar, /imageRecoveryAttempts < 2/);
  assert.match(gptSidebar, /recoveryBoundaryConfirmed: workflow\.recoveryBoundaryConfirmed === true/);
  assert.match(gptSidebar, /workflow\.recoveryBoundaryConfirmed \|\|= checkpoint\.recoveryBoundaryConfirmed === true/);
  assert.match(gptSidebar, /不要重新输出计划，直接按已确认的 P1-P\$\{expectedImages\}/);
  assert.match(gptSidebar, /workflow\.beforeImageAssistantKeys = assistantTurnKeys\(\)/);
});

test("uncertain GPT image counts preserve the current material instead of faking a quota limit", () => {
  assert.match(app, /"IMAGE_COUNT_UNCERTAIN"/);
  assert.match(app, /function isActualGptLimitMessage[\s\S]*?未\|无法\|不能[\s\S]*?return false/);
  assert.match(app, /function isLowOutputGptLimitMessage[\s\S]*?未\|无法\|不能[\s\S]*?return false/);
  assert.match(app, /\(\?:只检测到\|完整回复只有\)/);
  assert.match(gptSidebar, /copy-turn-action-button/);
  assert.match(gptSidebar, /assistant-response-quiet-complete/);
  assert.match(gptSidebar, /未判定额度触顶/);
  assert.match(app, /LEGACY_IMAGE_COUNT_RECHECK/);
  assert.match(app, /本轮只检测到\\s\*1\\s\*张/);
  assert.match(app, /task\.retryFromStage = "等待图片"/);
  assert.match(app, /delete task\._endedAt/);
});

test("GPT material tree never presents an unloaded parent folder as a fake zero", () => {
  assert.match(app, /category\.folderCountKnown === false/);
  assert.match(app, /Number\(category\.folderCount/);
  assert.match(app, /material-folder-count/);
  assert.match(app, /material-production-diagnostics/);
  assert.match(app, /diagnostics\.invalidCount/);
  assert.match(app, /includeDiagnostics/);
  const materialRenderStart = app.indexOf("function renderGptTestMaterials");
  const materialRenderEnd = app.indexOf("function renderGptTestTemplates", materialRenderStart);
  assert.doesNotMatch(app.slice(materialRenderStart, materialRenderEnd), /鍙敓浜?/);
  assert.match(app, /function scheduleGptMaterialCountRefresh/);
  assert.match(app, /function refreshGptMaterialCategoryCounts/);
  assert.match(app, /some\(\(category\) => category\.countKnown === false\)/);
  assert.match(app, /category\.countKnown === false \? "…" : Number\(category\.count/);
  assert.match(app, /const categoryItems = category\.items \|\| \[\]/);
  assert.match(app, /const shouldSelect = gptCategoryCheck\.checked/);
});

test("GPT login recovery stays local and never enters ordinary cloud settings export", () => {
  assert.match(html, /id="createGptLoginRecoveryBtn"/);
  assert.match(html, /id="restoreGptLoginRecoveryBtn"/);
  assert.match(desktopPreload, /createLoginRecovery/);
  assert.match(desktopPreload, /restoreLoginRecovery/);
  assert.match(desktopMain, /GPT_LOGIN_RECOVERY_ROOT/);
  assert.match(desktopMain, /GPT_PENDING_RESTORE_FILE/);
  assert.match(desktopMain, /applyPendingGptLoginRestore/);
  assert.doesNotMatch(server, /GPT_LOGIN_RECOVERY_ROOT/);
});

test("production exposes phase, percent, progressbar, status and recent log", () => {
  assert.match(html, /id="workbenchProgressPhase"/);
  assert.match(html, /id="workbenchProgressPercent"/);
  assert.match(html, /role="progressbar"[^>]+aria-valuenow="0"/);
  assert.match(html, /id="workbenchProgressBar"/);
  assert.match(html, /id="workbenchProductionStatus"/);
  assert.match(html, /id="workbenchProductionLog"/);
  assert.match(app, /function updateWorkbenchProgress\(/);
  assert.match(app, /30 \+ Math\.round\(percent \* 0\.7\)/);
  assert.match(css, /\.workbench-progress-track/);
  assert.match(css, /@keyframes statusPulse/);
});

test("directory actions use compact labels", () => {
  assert.doesNotMatch(html, />\s*切换目录\s*</);
  assert.doesNotMatch(html, />\s*选择目录\s*</);
  assert.match(html, /id="workbenchChooseMaterialRootBtn"[^>]*>选择<\/button>/);
  assert.match(html, /id="workbenchChooseProductRootBtn"[^>]*>选择<\/button>/);
});

test("status surfaces have a compact visual reminder", () => {
  assert.match(css, /\.version-status[^\{]*\.production-live-status[^\{]*\.workbench-production-status/);
  assert.match(css, /#workbenchModelStatus::before/);
  assert.match(css, /#imageApiStatus::before/);
});

test("production confirmation stays in the main action dock and starts with one paid calibration image", () => {
  assert.match(html, /class="workbench-action-dock"/);
  assert.match(html, /id="workbenchPlanPanel"[^>]*hidden[\s\S]*id="workbenchEditPlanBtn"[^>]*hidden[\s\S]*id="workbenchStartProductionBtn"/);
  assert.match(app, /activeProductionPlan\s*\?\s*confirmProductionPlan\(\)\s*:\s*createProductionPlan\(\)/);
  assert.match(app, /workbenchStartProductionBtn"\)\.textContent = "生成首张校准图（仅1次调用）"/);
  assert.match(app, /runScope: "calibration"/);
  assert.match(app, /首图确认无误，继续生成剩余/);
  assert.match(app, /失败不自动重试/);
  assert.match(app, /workbenchPlanPanel"\)\?\.scrollIntoView/);
  assert.doesNotMatch(app, /data-confirm-production-plan/);
  assert.match(css, /\.workbench-action-dock\{position:sticky/);
});

test("production model and page controls use one compact toolbar", () => {
  assert.match(html, /class="workbench-run-settings compact"/);
  assert.match(css, /\.workbench-run-settings\.compact\{grid-template-columns:/);
  assert.match(css, /\.workbench-run-settings\.compact select\{height:30px/);
});

test("page help and settings actions use fixed round svg icons", () => {
  assert.match(html, /class="page-help-button"[\s\S]*class="round-action-icon help-icon"/);
  assert.match(html, /class="page-settings-button"[\s\S]*class="round-action-icon"/);
  assert.match(app, /const buttonContent = `<svg class="round-action-icon help-icon"/);
  assert.match(css, /inline-size: 36px !important/);
  assert.match(css, /block-size: 36px !important/);
  assert.match(css, /aspect-ratio: 1 \/ 1/);
});

test("分发页标题动作和统计卡保持居中紧凑", () => {
  assert.match(css, /\.page-heading \.detail-button-row\s*\{[\s\S]*display: flex/);
  assert.match(css, /\.page-heading \.detail-button-row\s*\{[\s\S]*justify-content: flex-end/);
  assert.match(css, /\.distribution-stats \.summary-card\s*\{[\s\S]*text-align: center/);
  assert.match(css, /\.distribution-stats \.summary-card\s*\{[\s\S]*place-items: center/);
});

test("深色模式模块使用浅色边界并同步嵌入转化页", () => {
  assert.match(app, /function applyTheme\(theme, options = \{\}\)[\s\S]*syncConversionTheme\(value\)/);
  assert.match(serverSource, /jianghu-theme-ready/);
  assert.match(serverSource, /window\.addEventListener\("message"[\s\S]*jianghu-theme/);
  assert.match(css, /body\[data-theme="midnight"\] :is\(\.gpt-browser-nav button, \.gpt-add-account, \.gpt-account-tab\)[\s\S]*border: 1px solid rgba\(176, 220, 232, \.22\)/);
  assert.match(css, /body\[data-theme="midnight-glass"\] :is\(\.gpt-browser-nav button, \.gpt-add-account, \.gpt-account-tab\)[\s\S]*background: rgba\(223, 244, 255, \.08\)/);
  assert.match(css, /body\[data-theme="midnight"\] \.workflow-rail \.rail-tab\.active[\s\S]*border: 1px solid rgba\(104, 216, 195, \.34\)/);
  assert.match(css, /body\[data-theme="midnight"\] \.rail-service[\s\S]*background: rgba\(255, 255, 255, \.055\)/);
  assert.match(css, /body\[data-theme="midnight"\] \.device-platform-icon[\s\S]*color: #bfe9f1/);
  assert.match(css, /\.workbench-assistant-cat[\s\S]*background: transparent/);
}
);

test("settings cards and compact production layout cannot collapse into narrow columns", () => {
  assert.match(css, /\.settings-layout > \.api-settings-card\s*\{\s*grid-column: span 5/);
  assert.match(css, /\.settings-layout > \.version-card\s*\{\s*grid-column: 1 \/ -1/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*grid-column: 1 \/ -1/);
  assert.match(css, /@media \(max-width: 1050px\)[\s\S]*grid-template-columns: minmax\(250px, \.9fr\) minmax\(420px, 1\.4fr\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.production-workbench-grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
});

test("settings home prioritizes a three-step production setup over technical parameters", () => {
  assert.match(html, /id="settingsStartCard"[\s\S]*第一次使用也能按三步完成设置/);
  assert.match(html, /data-settings-jump="gptAuto:mode"[\s\S]*生产模式与额度/);
  assert.match(html, /data-settings-jump="gptAuto:workflow"[\s\S]*工作流与提示词/);
  assert.match(html, /data-settings-jump="gptAuto:accounts"[\s\S]*账号窗口/);
  assert.match(html, /class="settings-section-nav"[\s\S]*data-settings-jump="assistant"[\s\S]*data-settings-jump="backup"/);
  assert.doesNotMatch(html, /id="settingsApiSection"/);
  assert.doesNotMatch(html, /data-settings-jump="api"/);
  assert.match(html, /<details class="settings-card cloud-backup-card settings-advanced-card" id="settingsBackupSection">/);
});

test("废弃 API 生产链退出导航、设置和服务路由", () => {
  assert.doesNotMatch(html, /data-tab="dashboard"/);
  assert.doesNotMatch(html, /id="settingsApiSection"/);
  assert.doesNotMatch(html, /id="productionApiProvider"/);
  assert.doesNotMatch(server, /pathname === "\/api\/production\//);
  assert.doesNotMatch(server, /pathname === "\/api\/image-api\//);
  assert.doesNotMatch(server, /pathname === "\/api\/text-api\//);
  assert.match(server, /pathname !== "\/api\/workbench-assistant\/interpret"/);
  assert.match(server, /pathname\.startsWith\("\/api\/"\)[\s\S]*api not found/);
});

test("settings shortcuts open the real editor and current configuration summary stays live", () => {
  assert.match(app, /function renderSettingsHome\(\)/);
  assert.match(app, /settingsCurrentMode/);
  assert.match(app, /settingsAccountSummary/);
  assert.match(app, /settingsQuotaSummary/);
  assert.match(app, /settingsRunSummary/);
  assert.match(app, /const settingsJump = event\.target\.closest\("\[data-settings-jump\]"\)/);
  assert.match(app, /await openPageSettings\("gptAuto"\)/);
  assert.match(app, /target === "mode"\s*\?\s*"gptModeQuickTabs"/);
  assert.match(app, /gptModeWorkflowEditor/);
  assert.match(css, /\.settings-start-card\s*\{[\s\S]*grid-template-columns: minmax\(0, 1\.15fr\) minmax\(320px, \.85fr\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.settings-start-card\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
});

test("one app keeps the commercial defaults simple and folds custom workflow controls into developer settings", () => {
  assert.match(html, /<section class="gpt-developer-settings" id="gptDeveloperSettings">/);
  assert.match(html, /工作流与提示词（本模式专属）/);
  assert.match(html, /id="gptDeveloperSettingsToggle" type="checkbox"[^>]*checked/);
  assert.match(html, /id="gptDeveloperSettingsSummary"/);
  assert.match(html, /gptDeveloperSettings[\s\S]*id="gptModeWorkflowEditor"[\s\S]*id="gptAutoTaskTimeout"[\s\S]*<\/section>/);
  assert.match(app, /target === "workflow"[\s\S]*setGptDeveloperSettingsOpen\(true\)/);
  assert.match(app, /target === "mode"[\s\S]*setGptDeveloperSettingsOpen\(false\)/);
  assert.match(app, /if \(section === "gptAuto"\) \{[\s\S]*setGptDeveloperSettingsOpen\(true\)/);
  assert.match(app, /gptDeveloperSettingsSummary/);
  assert.match(app, /runSummary\.textContent = `\$\{productionStatus\.label\} · \$\{productionStatus\.message\}`/);
  assert.match(css, /\.gpt-developer-settings\s*\{[\s\S]*border: 1px solid var\(--line\)/);
});

test("finished products use the same expandable image and TXT folder interaction as materials", () => {
  assert.match(html, /data-workbench-output-filter="unpacked">未打包/);
  assert.match(html, /data-workbench-output-filter="packed">已打包/);
  assert.match(html, /data-workbench-output-filter="history">打包记录/);
  assert.match(html, /data-workbench-material-filter="conversion">精准流量贴/);
  assert.match(html, /data-workbench-material-filter="traffic">泛流量贴/);
  assert.match(html, /data-workbench-material-filter="unclassified">未分类/);
  assert.doesNotMatch(html, /data-workbench-output-type=/);
  assert.match(app, /data-workbench-product-folder=/);
  assert.match(app, /data-workbench-product-check=/);
  assert.match(app, /data-workbench-text-path=/);
  assert.match(app, /workbenchExpandedProductPath === work\.path/);
  assert.match(css, /\.workbench-output-folder \.workbench-post-assets/);
});

test("production settings expose a separate packed-library path", () => {
  assert.match(html, /id="productionPackedRoot"/);
  assert.match(html, /id="chooseProductionPackedRootBtn"[^>]*>选择<\/button>/);
  assert.match(app, /packedRoot: \$\("#productionPackedRoot"\)\?\.value/);
});

test("material and output tabs support persistent folder bindings from the context menu", () => {
  assert.match(html, /id="contextSetFolder"[^>]*>设置关联文件夹<\/button>/);
  assert.match(app, /function effectiveWorkbenchFolderBindings\(/);
  assert.match(app, /material-\$\{materialButton\.dataset\.workbenchMaterialFilter\}/);
  assert.match(app, /output-\$\{outputButton\.dataset\.workbenchOutputFilter\}/);
  assert.match(app, /folderBindings: effectiveWorkbenchFolderBindings\(\)/);
});

test("distribution uses a floating command assistant and no longer exposes migration maintenance", () => {
  assert.doesNotMatch(html, /id="reconcileDistributionFoldersBtn"/);
  assert.doesNotMatch(html, /class="codex-command-bar"/);
  assert.match(html, /id="workbenchAssistantLauncher"/);
  assert.match(html, /id="workbenchAssistantPanel"/);
  assert.match(html, /团建中控助手/);
  assert.match(app, /function executeWorkbenchAssistantCommand\(/);
  assert.match(css, /\.workbench-assistant-launcher/);
});

test("workbench assistant explains its capabilities and safely falls back to model intent understanding", () => {
  assert.match(html, /我能理解自然语言/);
  assert.match(app, /function workbenchAssistantCapabilities\(/);
  assert.match(app, /function executeInterpretedWorkbenchAssistant\(/);
  assert.match(app, /\/api\/workbench-assistant\/interpret/);
  assert.match(app, /options\.allowModel === false/);
  assert.match(html, /id="workbenchAssistantBubble"/);
  assert.match(app, /function setupWorkbenchAssistantDrag\(/);
  assert.match(app, /tb-workbench-assistant-position/);
  assert.match(app, /showWorkbenchAssistantBubble\(/);
});

test("GPT production locks selection while running and exposes a real pause/continue state", () => {
  assert.match(app, /function blockGptSelectionDuringRun\(/);
  assert.match(app, /if \(blockGptSelectionDuringRun\(\)\) return;/);
  assert.match(app, /let gptQueuePaused = false/);
  assert.match(app, /继续自动生产/);
  assert.match(app, /pauseButton\.textContent = runtime\.pausedByUser/);
  assert.match(html, /id="gptStopQueueBtn"/);
  assert.match(app, /function reconcileGptWindow\(/);
  assert.match(app, /gptQueuePaused = true/);
  assert.match(app, /GPT 网页状态读取超时/);
  assert.match(app, /自动恢复检查失败，等待下一次探测/);
});

test("GPT production keeps a recoverable queue and supports permanent account windows", () => {
  assert.match(app, /GPT_QUEUE_STORAGE_KEY/);
  assert.match(app, /function persistGptQueue\(/);
  assert.match(app, /function restoreGptQueue\(/);
  assert.match(app, /sendMultiWindowGptTasks/);
  assert.match(app, /parallelWorkers/);
  assert.match(html, /value="single">/);
  assert.doesNotMatch(html, /value="rotate">/);
  assert.match(html, /value="manual">人工控制/);
  assert.match(html, /添加账号窗口/);
  assert.match(html, /id="gptBrowserManager"/);
  assert.match(app, /当前账号窗口打开在线模板/);
  assert.match(app, /name: `账号窗口 \${index \+ 1}`/);
  assert.match(app, /单账号全自动/);
  assert.match(app, /多账号全自动已启动/);
  assert.match(html, /账号窗口/);
  assert.match(desktopMain, /gpt-browser-profiles\.json/);
  assert.match(desktopMain, /desktop:gpt-profile-save/);
});

test("out-of-hours scheduling refreshes the legacy running mirror", () => {
  const scheduleStart = app.indexOf("function scheduleContinuousGptProduction(");
  const scheduleEnd = app.indexOf("function buildGptTemplateInitTask(", scheduleStart);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
  assert.match(app.slice(scheduleStart, scheduleEnd), /等待工作时段/);
  assert.match(app.slice(scheduleStart, scheduleEnd), /persistGptQueue\(\);/);
});

test("legacy multi-account settings migrate to the single-account worker", () => {
  assert.match(html, /value="automatic">/);
  assert.doesNotMatch(html, /value="rotate">/);
  assert.match(app, /if \(mode === "rotate"[\s\S]{0,420}return "single"/);
  assert.match(app, /function singleAccountQuotaAutoSwitchEnabled\(/);
  assert.match(app, /function nextSingleAccountAfterQuota\(/);
  assert.match(app, /prepareSingleAccountQuotaHandoff\(/);
});

test("GPT rotation checks quota before opening the local upload-cycle window", () => {
  const start = app.indexOf("async function runGptTaskOnBrowser");
  const end = app.indexOf("function resetGptTaskForRotation", start);
  const body = app.slice(start, end);
  const quotaCheck = body.indexOf("await ensureGptTaskQuota(task, task.quotaAccountId");
  const usageAnchor = body.indexOf('recordGptQuotaConsumption(task, task.quotaAccountId, "upload")');

  assert.ok(quotaCheck >= 0, "rotation must run a quota preflight");
  assert.ok(usageAnchor >= 0, "rotation must retain the upload-cycle anchor");
  assert.ok(quotaCheck < usageAnchor, "quota preflight must happen before the upload-cycle anchor is opened");
});

test("rotation pauses on a dirty composer instead of skipping subsequent materials", () => {
  assert.match(app, /const integrityBoundaryCodes\s*=\s*new Set\(/);
  assert.match(app, /integrityBoundaryCodes\.has\(failureCode\)/);
  assert.match(app, /isTransientGptWindowFailure\(\{ code: failureCode, message \}\)/);
  assert.doesNotMatch(app.slice(app.indexOf('async function sendRotatingGptTasks'), app.indexOf('async function sendMultiWindowGptTasks')), /task\._status\s*=\s*"skipped"/);
  assert.match(app, /task\._status\s*=\s*"paused";[\s\S]{0,1200}gptAutoPaused\s*=\s*true;[\s\S]{0,1200}break;/);
  assert.match(app, /copy\.taskType\s*=\s*"template-init";[\s\S]{0,500}copy\.forceUpload\s*=\s*true;/);
});

test("global account rotation uses per-window opt-in and closes a whole work before the 45-image safety switch", () => {
  assert.match(html, /gpt-account-rotation\.js\?v=/);
  assert.match(app, /function availableRotationAccounts\(/);
  assert.match(app, /TBGptAccountRotation\.accountParticipatesInRotation/);
  assert.match(app, /const accounts = availableRotationAccounts\(\)/);
  assert.match(app, /await refreshGptQuota\(account\.id, \{ syncBrowser: options\.syncBrowser !== false \}\)/);
  assert.match(app, /TBGptAccountRotation\.accountQuotaBoundary/);
  assert.match(app, /recordGptSafetyLineCooldown/);
  assert.match(app, /blockedAccounts\.add\(account\.id\)[\s\S]{0,900}accountCursor = \(accountCursor \+ 1\) % accounts\.length/);
  assert.match(app, /本轮作品已完整归档/);
  assert.match(app, /generationLimit:\s*45/);
});

test("legacy 50-image defaults migrate once to the new 45-image safety line", () => {
  assert.match(app, /GPT_GENERATION_SAFETY_MIGRATION_KEY/);
  assert.match(app, /loaded\.generationLimit\) === 50[\s\S]{0,160}loaded\.generationLimit = 45/);
  assert.match(app, /account\.generationLimit\) === 50[\s\S]{0,420}generationLimit: 45/);
  assert.match(app, /localStorage\.setItem\(GPT_GENERATION_SAFETY_MIGRATION_KEY/);
});

test("server-backed 50-image quotas migrate atomically before the completion marker", () => {
  assert.match(app, /GPT_SERVER_GENERATION_SAFETY_MIGRATION_KEY/);
  assert.match(app, /Number\(persistedGptAuto\.generationLimit\) === 50[\s\S]{0,500}generationLimit:\s*45/);
  assert.match(app, /const result = await api\("\/api\/page-settings"[\s\S]{0,500}localStorage\.setItem\(GPT_SERVER_GENERATION_SAFETY_MIGRATION_KEY/);
});

test("GPT queue recovery persists the final failed stage and replaces stale retry checkpoints", () => {
  assert.match(app, /task\._stage = gptLastFailedStage;/);
  assert.match(app, /task\._error = taskError\.message;/);
  assert.match(app, /if \(resuming && task\._stage && task\._status !== "completed"\)/);
  assert.match(app, /failedTask\._stage = localQuotaBoundary \? "等待额度恢复" : \(gptLastFailedStage \|\| failedTask\._stage/);
  assert.match(server, /GPT_PRODUCTION_CHECKPOINT_FILE/);
  assert.match(server, /gpt-production\/recover-image-batch/);
  assert.match(server, /resolveAuthorizedDownloadRoot/);
  assert.match(server, /image_inbox_path/);
});

test("GPT checkpoints persist generated image URLs so a restart can finish download and packaging", () => {
  assert.match(server, /generatedImageUrls:\s*Array\.isArray\(source\.generatedImageUrls\)/);
  assert.match(server, /beforeImageAssistantKeys:\s*Array\.isArray\(source\.beforeImageAssistantKeys\)/);
  assert.match(server, /generatedBaselineUrls:\s*Array\.isArray\(source\.generatedBaselineUrls\)/);
  assert.match(server, /generatedImageActualCount:\s*Math\.max\(0, Math\.min\(30, Number\(source\.generatedImageActualCount/);
  assert.match(server, /imageRecoveryAttempts:\s*Math\.max\(0, Math\.min\(20, Math\.floor\(Number\(source\.imageRecoveryAttempts/);
  assert.match(server, /recoveryBoundaryConfirmed:\s*source\.recoveryBoundaryConfirmed === true/);
  assert.match(gptSidebar, /generatedImageUrls:\s*workflow\.generatedImageUrls/);
  assert.match(gptSidebar, /workflow\.generatedImageUrls\s*\|\|=\s*checkpoint\.generatedImageUrls/);
  assert.match(gptSidebar, /beforeImageAssistantKeys:\s*workflow\.beforeImageAssistantKeys/);
  assert.match(gptSidebar, /workflow\.beforeImageAssistantKeys\s*=\s*checkpoint\.beforeImageAssistantKeys/);
});

test.skip("image recovery counters survive the server checkpoint round trip (legacy assertion replaced below)", () => {
  assert.match(server, /generatedImageDetection:\s*source\.generatedImageDetection/);
  assert.match(server, /imageRecoveryLastSignature:\s*String\(source\.imageRecoveryLastSignature/);
  assert.match(server, /copyRecoveryAttempts:\s*Math\.max\(0, Math\.min\(20, Math\.floor\(Number\(source\.copyRecoveryAttempts/);
  assert.match(gptSidebar, /workflow\.imageRecoveryAttempts \|=\|\| Number\(checkpoint\.imageRecoveryAttempts/);
  assert.match(gptSidebar, /workflow\.copyRecoveryExhausted \|=\| checkpoint\.copyRecoveryExhausted === true/);
});

test("image recovery counters use persisted checkpoint values", () => {
  assert.ok(gptSidebar.includes("workflow.imageRecoveryAttempts ||= Number(checkpoint.imageRecoveryAttempts || 0)"));
  assert.ok(gptSidebar.includes("workflow.copyRecoveryExhausted ||= checkpoint.copyRecoveryExhausted === true"));
});

test("server checkpoints retain the production mode used by the completed task", () => {
  assert.match(server, /productionMode:\s*String\(source\.productionMode\s*\|\|\s*""\)\.slice\(0,\s*40\)/);
  assert.match(gptSidebar, /productionMode:\s*String\(options\.mode\s*\|\|\s*task\.entry\.productionMode\s*\|\|\s*""\)/);
  const saveCheckpointStart = gptSidebar.indexOf("const saveCheckpoint = async");
  const saveCheckpointEnd = gptSidebar.indexOf("if (checkpointRequestId && retryStage)", saveCheckpointStart);
  assert.match(gptSidebar.slice(saveCheckpointStart, saveCheckpointEnd), /productionMode:\s*String\(options\.mode\s*\|\|\s*task\.entry\.productionMode\s*\|\|\s*""\)/);
  assert.match(server, /productionMode:\s*item\.productionMode\s*\|\|\s*""/);
});

test("patrol packaging closes the authoritative server checkpoint as well as the visible history", () => {
  assert.match(gptSidebar, /await api\("\/api\/gpt-production\/checkpoint"/);
  assert.match(gptSidebar, /await reportPatrolPackageCompletion\(packageTask/);
  assert.match(gptSidebar, /downloadedFiles,\s*downloadRoot:/);
  assert.match(gptSidebar, /packagePath\s*\n\s*}/);
});

test("desktop close goes to tray and temporary cache maintenance never clears login storage", () => {
  assert.match(desktopMain, /new Tray\(/);
  assert.match(desktopMain, /打开图文工作台/);
  assert.match(desktopMain, /彻底退出/);
  assert.match(desktopMain, /event\.preventDefault\(\)/);
  assert.match(desktopMain, /window\.hide\(\)/);
  assert.match(desktopMain, /partition: WORKBENCH_PARTITION,[\s\S]{0,260}backgroundThrottling: false/);
  assert.match(desktopMain, /async function refreshGptAccountSession\(/);
  assert.match(desktopMain, /await account\.session\.clearCache\(\)/);
  assert.match(desktopMain, /desktop:gpt-maintenance/);
  assert.match(desktopMain, /clearStorageData\(\)/);
  assert.match(desktopPreload, /maintenance\(input = \{\}\)/);
  assert.match(desktopMain, /persist:teambuilding-gpt-production/);
  assert.match(desktopMain, /async function flushAllGptStorageData\(\)/);
  assert.match(desktopMain, /flushStorageData\(\)/);
  assert.match(desktopMain, /if \(!quitFlushCompleted\)/);
});

test("独立内容生产应用使用自己的产品名且保留运行路径兼容", () => {
  assert.match(server, /name:\s*"图文工作台"/);
  assert.match(server, /name:\s*"图文工作台 · GPT 助手"/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "lib", "workbench-port.js"), "utf8"), /启动图文工作台/);
  assert.match(desktopMain, /const APP_TITLE = `内容生产/);
  assert.match(desktopMain, /团建工作台\.ico/);
  assert.match(html, /<title>内容生产<\/title>/);
  assert.doesNotMatch(html, /图文项目工作台/);
  assert.match(assistantOverlay, /图文工作台已就绪/);
});

test("startup keeps the material tree lazy and ignores dot-prefixed holding folders", () => {
  assert.match(server, /getMaterialLibrary\(force, selectedLibraryPath, \{ loadDefault: false \}\)/);
  assert.match(server, /getMaterialLibrary\(parsed\.query\.refresh === "1", "", \{[\s\S]{0,140}loadDefault: false/);
  assert.match(app, /const visibleCategories = categories\.filter\(\(category\) => !isHiddenMaterialPath\(category\.path\)\)/);
  assert.doesNotMatch(app, /workbenchActiveMaterialCategoryPath =[\s\S]{0,320}\|\| categories\[0\]\?\.path/);
});

test("fresh GPT uploads stay blocked while the owning account has an unfinished checkpoint", () => {
  assert.ok(app.includes("const unfinishedOwnerCheckpoint ="));
  assert.ok(app.includes("Do not fill that account with a fresh material while its exact /c/... URL"));
  assert.ok(app.includes("return { entries: [], recoverablePaths, blockedByCheckpoint: true }"));
  assert.match(app, /await readGptAccountConversationUrl\(ownerAccountId, \{ allowLogFallback: true \}\)/);
  assert.match(app, /const checkpointOwnersByRequest = new Map/);
  assert.match(app, /checkpointOwners\.size !== 1 \|\| !checkpointOwners\.has\(ownerAccountId\)/);
});

test("an empty continuous worker restores its durable conversation checkpoint before selecting fresh material", () => {
  const runner = app.match(/async function runIndependentGptWindow\([\s\S]*?\n}\n\nfunction registerWorkbenchCommands/)?.[0] || "";
  const restoreAt = runner.indexOf("restoreIndependentGptCheckpointAtStartup(key)");
  const ensureAt = runner.indexOf("ensureGptWindowWorkerQueue(key, workerState, settings)");
  assert.ok(restoreAt >= 0, "empty workers must attempt durable checkpoint adoption");
  assert.ok(ensureAt >= 0, "worker queue admission must remain present");
  assert.ok(restoreAt < ensureAt, "checkpoint adoption must happen before fresh material selection");
});

test("independent automatic windows launch together without the legacy startup stagger", () => {
  assert.match(app, /const GPT_STARTUP_STAGGER_ENABLED = false/);
  const gate = app.match(/function gptStartupStaggerGate\([\s\S]*?\n}/)?.[0] || "";
  assert.match(gate, /!GPT_STARTUP_STAGGER_ENABLED/);
  assert.match(gate, /startup-stagger-disabled/);
});

test("GPT production refreshes after a completed post and clears only temporary cache every configured three-hour window", () => {
  assert.match(app, /GPT_TEMPORARY_CACHE_STORAGE_KEY/);
  assert.match(app, /function scheduleGptTemporaryCacheMaintenance\(/);
  assert.match(app, /async function refreshGptAfterProduction\(/);
  assert.match(app, /GPT_POST_REFRESH_TIMEOUT_MS/);
  assert.match(app, /Promise\.race\(\[maintenanceRequest, timeoutRequest\]\)/);
  assert.match(app, /async function runGptTemporaryCacheMaintenance\(/);
  assert.match(app, /clearTemporaryCache: true/);
  assert.match(app, /GPT_TEMPORARY_CACHE_INTERVAL_MS = 3 \* 60 \* 60 \* 1000/);
  assert.match(app, /task\?\.taskType === "material" \|\|/);
  assert.match(app, /gptTemporaryCacheIntervalMs/);
  assert.match(app, /await refreshGptAfterProduction\(account\.id, "rotation-production-complete"\)/);
  assert.match(app, /await refreshGptAfterProduction\(runAccountId, "production-complete"\)/);
  assert.match(app, /production-limit-signal/);
  assert.match(desktopMain, /reloadIgnoringCache/);
  assert.match(desktopMain, /Never call clearStorageData here/);
  assert.match(desktopPreload, /desktop:gpt-maintenance/);
});

test("three-hour cache cleanup defers when a durable runtime still owns an unfinished task", () => {
  assert.match(app, /const durableRuntime = readGptWindowRuntime\(key\);/);
  assert.match(app, /durableTaskStillBusy = Boolean\([\s\S]{0,360}currentTaskId/);
  assert.match(app, /!\["idle", "completed", "waiting-quota"\]\.includes\(String\(durableRuntime\.status \|\| ""\)\)/);
  assert.match(app, /\|\| durableTaskStillBusy;/);
});

test("automatic readiness recovery does not reload a window that still owns a non-terminal checkpoint", () => {
  assert.match(app, /const runtimeOwnsTask = !settledHeartbeatRecovery[\s\S]{0,520}currentTaskId/);
  assert.match(app, /!\["idle", "completed", "waiting-quota", "retry-wait", "failed", "probing"\]\.includes\(String\(activeRuntime\.status \|\| ""\)\)/);
  assert.match(app, /activeRuntime\.pausedByUser !== true/);
  assert.match(app, /activeRuntime\.stoppedByUser !== true/);
});

test("a stale recovery callback clears retry-wait after its task is released", () => {
  const start = app.indexOf("const currentTaskIdBeforeRefresh");
  const end = app.indexOf("const taskStageBeforeRefresh", start);
  const block = app.slice(start, end);
  assert.match(block, /runtimeOwnsReleasedRecovery/);
  assert.match(block, /!currentTaskIdBeforeRefresh && !runtimeBeforeRefresh\.currentTaskId && !runtimeBeforeRefresh\.windowRecoveryTaskId/);
  assert.match(block, /status: hasPendingTask \? "probing" : "idle"/);
  assert.match(block, /currentStage: hasPendingTask \? "旧恢复回调已取消，继续队列" : "等待素材"/);
  assert.match(block, /scheduleContinuousGptProduction\(1_500\)/);
});

test("native renderer recreation does not reload a non-terminal durable checkpoint", () => {
  const start = desktopMain.indexOf("async function recreateGptAccountView");
  const end = desktopMain.indexOf("function enqueueGptAccountInitialization", start);
  const block = desktopMain.slice(start, end);
  assert.match(block, /productionTaskAccounts\.has\(id\)/);
  assert.match(block, /const runtimeTaskStillBusy = !rootPageLoadStall[\s\S]{0,520}currentTaskId/);
  assert.match(block, /!\["idle", "completed", "waiting-quota"\]\.includes\(String\(runtime\.status \|\| ""\)\)/);
  assert.match(block, /runtime\.pausedByUser !== true/);
  assert.match(block, /runtime\.stoppedByUser !== true/);
  assert.match(block, /skipped: "runtime-task"/);
});

test("GPT heartbeat recovery settles the old bridge request before reconnecting", () => {
  assert.match(app, /const sendTaskPromise = Promise\.resolve\(\)\.then\(\(\) => window\.gptWorkbench\.sendTask\(task\)\)/);
  assert.match(app, /function settleGptTaskAfterHeartbeatLoss[\s\S]{0,500}stopCurrentTask/);
  assert.match(app, /Promise\.resolve\(sendTaskPromise\)\.catch/);
  assert.match(desktopMain, /shouldAbortPendingGptTask/);
  assert.match(desktopMain, /gpt-task-cancelled/);
});

test("fresh-session pre-submit upload gets its own finite heartbeat budget", () => {
  assert.match(app, /const freshRootBootstrap = task\?\._freshConversationBootstrap === true/);
  assert.match(app, /GPT_PRE_SUBMIT_DISPATCH_GRACE_MS/);
  assert.match(app, /const freshRootPreSubmitWithinBudget = freshRootBootstrap/);
  assert.match(app, /pageStallRequiresRecovery = pageStalled[\s\S]{0,180}freshRootPreSubmitWithinBudget/);
  assert.match(app, /bridgeTaskLost = !previousPostIdleWithinBudget[\s\S]{0,240}freshRootPreSubmitWithinBudget/);
});

test("desktop cache maintenance is three-hour, work-hour gated, and defers during production", () => {
  assert.match(desktopMain, /temporary-web-cache-schedule/);
  assert.match(temporaryWebCacheSchedule, /TEMPORARY_WEB_CACHE_INTERVAL_MS = 3 \* 60 \* 60 \* 1000/);
  assert.match(desktopMain, /planTemporaryWebCacheCleanup/);
  assert.match(temporaryWebCacheSchedule, /production-active/);
  assert.doesNotMatch(desktopMain, /TEMPORARY_WEB_CACHE_CLEANUP_INTERVAL_MS = 10 \* 60 \* 1000/);
});

test("restoring a minimized workbench reattaches the live GPT surface without reloading it", () => {
  assert.match(desktopMain, /window\.on\("restore",/);
  assert.match(desktopMain, /notifyWindowRestored\("restore"\)/);
  assert.match(desktopMain, /contentView\.removeChildView\(account\.view\)/);
  assert.match(desktopMain, /contentView\.addChildView\(account\.view\)/);
  assert.match(desktopMain, /desktop:window-restored/);
  assert.doesNotMatch(desktopMain, /notifyWindowRestored[\s\S]{0,1800}reload\(/);
});

test("portable desktop copies runtime resources to a durable version directory before background service starts", () => {
  assert.match(desktopMain, /ensureDurableRuntimeResources/);
  assert.match(desktopMain, /durableRuntimeAppRoot/);
  assert.match(desktopMain, /runtime-manifest\.json/);
  assert.match(desktopMain, /serverFile = app\.isPackaged[\s\S]{0,220}path\.join\(__dirname, "\.\.", "server\.js"\)/);
});

test("embedded GPT reports real page readiness instead of treating a created view as loaded", () => {
  assert.match(desktopMain, /pageState/);
  assert.match(desktopMain, /did-start-loading/);
  assert.match(desktopMain, /did-finish-load/);
  assert.match(desktopMain, /domReady/);
  assert.match(desktopMain, /extensionReady/);
  assert.match(desktopMain, /gptInitializationPromise/);
  assert.match(desktopMain, /document\.documentElement\.dataset\.tbGptProductionExtension/);
  assert.match(desktopMain, /setBorderRadius\(16\)/);
  assert.match(app, /function restoreEmbeddedGptView/);
});

test("global assistant is a draggable cat with separate status log and chat layers", () => {
  assert.match(html, /workbenchAssistantCat/);
  assert.match(html, /assistant-black-cat-v3\.png/);
  assert.match(html, /workbenchAssistantBubbleContent/);
  assert.match(html, /workbenchAssistantLogPanel/);
  assert.match(html, /data-assistant-mute="1"/);
  assert.match(html, /data-assistant-mute="5"/);
  assert.match(html, /data-assistant-mute="60"/);
  assert.match(css, /@keyframes tb-cat-bounce/);
  assert.match(app, /assistantEventLog/);
  assert.match(app, /openWorkbenchAssistantLog/);
  assert.match(app, /tb-workbench-assistant-position-v5/);
  assert.doesNotMatch(app, /const assistantRail = 76/);
  assert.doesNotMatch(app, /const inset = 12/);
  assert.match(app, /x:\s*rect\.left,[\s\S]*?width:\s*Math\.max\(320, rect\.width\)/);
  assert.doesNotMatch(html, /id="gptSelectionAssistant"/);
  assert.match(css, /\.workbench-assistant-bubble\s*\{[\s\S]*?background:\s*#fff/);
  assert.match(css, /\.workbench-assistant-bubble::after/);
  assert.match(css, /\.workbench-assistant-launcher\s*\{[\s\S]*?top:\s*96px/);
  assert.match(app, /function resyncWorkbenchAssistantDockFromLauncher/);
  assert.match(app, /const bubbleGap = element === bubble \? 12 : 4/);
  assert.match(app, /requestAnimationFrame\(\(\) => resyncWorkbenchAssistantDockFromLauncher\(\)\)/);
  assert.match(app, /gptProductionHistoryPanel"\)\?\.hidden !== false/);
  assert.match(desktopMain, /assistantOverlayWindow/);
  assert.match(desktopMain, /assistant-overlay\.html/);
  assert.match(desktopPreload, /assistantOverlay:\s*true/);
  assert.match(assistantOverlay, /data-theme="midnight-glass"/);
  assert.match(assistantOverlay, /document\.documentElement\.dataset\.theme = state\.theme/);
  assert.match(desktopMain, /assistantOverlayState = \{ \.\.\.assistantOverlayState, theme: gptThemeName \}/);
  assert.match(app, /native-assistant-overlay/);
  assert.doesNotMatch(app, /workbenchAssistantBubble"\)\?\.addEventListener\("mouseenter"/);
  assert.match(app, /assistantSuppressClickUntil/);
});

test("cat idle motion is continuous instead of whipping through all turns at the end", () => {
  assert.doesNotMatch(css, /0%,\s*88%,\s*100%/);
  assert.doesNotMatch(assistantOverlay, /0%,\s*88%,\s*100%/);
  assert.match(css, /25%\s*\{\s*transform:\s*translateY\(-1px\) rotate\(-\.6deg\)/);
  assert.match(css, /50%\s*\{\s*transform:\s*translateY\(-2px\) rotate\(0deg\)/);
  assert.match(css, /75%\s*\{\s*transform:\s*translateY\(-1px\) rotate\(\.6deg\)/);
  assert.match(assistantOverlay, /25%\{transform:translateY\(-1px\) rotate\(-\.6deg\)\}/);
  assert.match(assistantOverlay, /50%\{transform:translateY\(-2px\) rotate\(0deg\)\}/);
  assert.match(assistantOverlay, /75%\{transform:translateY\(-1px\) rotate\(\.6deg\)\}/);
});

test("assistant notifications are page-aware, stable, configurable, and independent from cat visibility", () => {
  assert.match(html, /assistant-notification-policy\.js/);
  assert.match(html, /id="assistantCatVisible"/);
  assert.match(html, /id="assistantNotificationsEnabled"/);
  assert.match(html, /id="assistantBubblePinned"[^>]*checked/);
  assert.match(assistantOverlay, /id="menuBubblePinned"[^>]*checked/);
  assert.match(app, /function assistantBubbleShouldBeVisible/);
  assert.match(html, /id="assistantCurrentDurationSeconds"[^>]*value="9"/);
  assert.match(html, /id="assistantOtherDurationSeconds"[^>]*value="3"/);
  assert.match(html, /id="assistantOtherMaxPerBatch"[^>]*value="1"/);
  assert.match(app, /sourceView:\s*"distributionView"/);
  assert.match(app, /distribution-reserve:/);
  assert.match(app, /assistantNoticeQueue/);
  assert.match(app, /bubbleVisible:/);
  assert.match(desktopMain, /catVisible:/);
  assert.match(desktopMain, /bubbleVisible:/);
  assert.doesNotMatch(desktopMain, /assistantOverlayState\.visible/);
});

test("native cat uses a separate head-neck layer with an intact pendant and follows the screen cursor", () => {
  assert.match(assistantOverlay, /cat-layer cat-body/);
  assert.match(assistantOverlay, /cat-layer cat-head/);
  assert.match(assistantOverlay, /\.cat-body\s*\{[^}]*clip-path:\s*inset\(66% 0 0 0\)/);
  assert.match(assistantOverlay, /\.cat-head\s*\{[^}]*clip-path:\s*inset\(0 0 33% 0\)/);
  assert.match(assistantOverlay, /--head-angle/);
  assert.match(assistantOverlay, /cat\.addEventListener\("contextmenu", openMenu\)/);
  assert.match(desktopMain, /screen\.getCursorScreenPoint\(\)/);
  assert.match(desktopMain, /setInterval\(updateAssistantCursorDirection, 50\)/);
});

test("paused queue recovery is loaded as a module and awaits confirmed readiness", () => {
  const recoveryIndex = html.indexOf("/gpt-runtime-recovery.js");
  const appIndex = html.indexOf("/app.js");
  assert.ok(recoveryIndex > 0 && recoveryIndex < appIndex);
  assert.match(app, /TBGptRuntimeRecovery\?\.createController/);
  assert.doesNotMatch(app, /const stillReady = window\.gptWorkbench\?\.status/);
});

test("late image completion recovery preserves the submitted checkpoint and resumes the same queue item", () => {
  assert.match(app, /currentTask:\s*gptTestQueue\[gptTestQueueIndex\]/);
  assert.match(app, /inspect:\s*\(accountId\)\s*=>\s*window\.gptWorkbench\?\.inspectStatus\?\.\(accountId\)/);
  assert.match(app, /resumeImageUncertainty:\s*async\s*\(\{\s*task,\s*accountId\s*\}\)/);
  assert.match(app, /task\.forceUpload\s*=\s*false/);
  assert.match(app, /task\._submittedToGpt\s*=\s*true/);
  assert.match(app, /gptQueuePaused\s*=\s*true;[\s\S]{0,500}sendNextGptTestTask\(\{[\s\S]{0,180}accountId/);
  assert.match(app, /const recoveryImageCount = Math\.max\(1, Number\(task\.workflow\?\.plannedImageCount \|\| task\.expectedImages \|\| 1\)\)/);
  assert.match(app, /检测到当前作品的 \$\{recoveryImageCount\} 张图片已经生成完成/);
});

test("workbench keeps a single explicit renderer layer contract", () => {
  assert.match(css, /--tb-layer-gpt:\s*10/);
  assert.match(css, /--tb-layer-assistant-bubble:\s*1000/);
  assert.match(css, /\.workbench-assistant-launcher\s*\{\s*z-index:\s*var\(--tb-layer-assistant-cat\)/);
  assert.match(css, /\.context-menu[\s\S]*?z-index:\s*var\(--tb-layer-context-menu\)/);
  assert.match(css, /\.system-dialog-backdrop[\s\S]*?z-index:\s*var\(--tb-layer-dialog\)/);
  assert.match(desktopMain, /overlay\.setAlwaysOnTop\(detached && alwaysOnTop, "floating", 1\)/);
});

test("native cat is app-bound by default, opens on double click, and exposes floating controls", () => {
  assert.match(assistantOverlay, /id="menuDetached"/);
  assert.match(assistantOverlay, /id="menuAlwaysOnTop"/);
  assert.match(assistantOverlay, /cat\.addEventListener\("dblclick",/);
  assert.doesNotMatch(assistantOverlay, /cat\.addEventListener\("click",[\s\S]{0,160}type:\s*"chat"/);
  assert.match(html, /id="assistantDetached"/);
  assert.match(html, /id="assistantAlwaysOnTop"/);
  assert.match(desktopMain, /function applyAssistantOverlayWindowMode/);
  assert.match(desktopMain, /window\.on\("blur",/);
  assert.match(desktopMain, /window\.on\("focus",/);
  assert.match(desktopMain, /assistantOverlayInteractionUntil/);
  assert.match(desktopMain, /Date\.now\(\) < assistantOverlayInteractionUntil/);
});

test("development and automatic restarts bypass confirmation while packaged user restarts retain it", () => {
  assert.match(desktopPreload, /restartApp\(options = \{\}\)/);
  assert.match(desktopPreload, /interactive:\s*options\.interactive === true/);
  assert.match(desktopMain, /ipcMain\.handle\("desktop:restart-app", async \(_event, input = \{\}\)/);
  assert.match(desktopMain, /interactive:\s*input\.interactive === true/);
  assert.match(desktopMain, /if \(interactive && productionTaskActive && mainWindow\)/);
  assert.match(desktopMain, /restartApp\(\{ source: "tray-menu", interactive: app\.isPackaged \}\)/);
  assert.doesNotMatch(desktopMain, /restartApp\("renderer"\)/);
  assert.match(desktopMain, /return \{ ok: false, cancelled: true \}/);
  assert.match(desktopMain, /const ownedServer = serverProcess/);
  assert.match(desktopMain, /ownedServer\.kill\(\)/);
  assert.match(desktopMain, /setTimeout\(\(\) => app\.exit\(0\), 180\)/);
  assert.match(desktopMain, /return \{ ok: true, scheduled: true \}/);
});

test("GPT automatic production keeps a durable user-visible production history", () => {
  assert.match(html, /id="gptProductionHistoryBtn"/);
  assert.match(html, /id="gptProductionHistoryPanel"/);
  assert.match(app, /GPT_HISTORY_STORAGE_KEY/);
  assert.match(app, /appendGptProductionHistory/);
  assert.match(app, /accountName: String\(gptAccounts\.find/);
  assert.match(app, /escapeHtml\(item\.accountName \|\| "当前账号窗口"\)/);
  assert.match(app, /openGptProductionHistory/);
  assert.match(app, /\/api\/gpt-production\/history/);
  assert.match(app, /planDurationMs/);
  assert.match(app, /imageDurationMs/);
  assert.match(app, /data-open-production-path/);
  assert.match(app, /打开成品文件夹/);
  assert.match(app, /打开图片暂存目录/);
  assert.match(app, /function openPath/);
  assert.match(server, /pathname === "\/api\/gpt-production\/history"/);
  assert.match(server, /downloadRoot/);
  assert.match(server, /copyTextLength/);
  assert.match(server, /packagePath/);
});

test("GPT browser profiles remember the last safe conversation URL", () => {
  assert.match(desktopMain, /lastUrl:\s*GPT_URL/);
  assert.match(desktopMain, /lastBrowserUrl:\s*GPT_URL/);
  assert.match(desktopMain, /lastConversationUrl:\s*""/);
  assert.match(desktopMain, /const lastBrowserUrl = safeBrowserUrlOrDefault\(/);
  assert.match(desktopMain, /lastBrowserUrl,/);
  assert.match(desktopMain, /clearConversation/);
  assert.match(desktopMain, /lastConversationUrl: clearConversation\s*\?/);
  assert.match(desktopMain, /function safeGptUrl/);
  assert.match(desktopMain, /function safeBrowserUrl/);
  assert.match(desktopMain, /function rememberBrowserUrl/);
  assert.match(desktopMain, /function resolveGptRecoveryTargetUrl/);
  assert.match(desktopMain, /did-navigate-in-page/);
  assert.match(desktopMain, /const startupUrl = safeBrowserUrlOrDefault\(resolveGptStartupUrl\(startupProfile/);
  assert.match(desktopMain, /loadGptUrlBounded\(account\.view\.webContents, startupUrl/);
  assert.match(desktopMain, /const initialTargetUrl = resolveGptRecoveryTargetUrl\(account\)/);
  assert.match(desktopMain, /const targetUrl = resolveGptRecoveryTargetUrl\(account\)/);
  assert.match(desktopMain, /profile\.lastUrl = profile\.lastConversationUrl \|\| GPT_URL/);
  assert.match(desktopMain, /profile\.lastConversationUrl = "";[\s\S]*?writeBrowserProfiles\(profiles\)/);
  assert.match(desktopMain, /normalizeChatConversationUrl\(nextUrl\)/);
  assert.match(desktopMain, /!\["http:", "https:"\]\.includes\(parsed\.protocol\)/);
  assert.match(desktopMain, /parsed\.username \|\| parsed\.password/);
  assert.match(app, /function resolveGptTaskConversationUrl/);
  assert.match(app, /GPT_CONVERSATION_RESUME_PENDING/);
  assert.match(app, /resumeConversationUrl/);
  assert.match(app, /gptAccountConversationUrl/);
  assert.match(app, /allowLogFallback:\s*true/);
  assert.match(app, /const knownConversationUrl = await readGptAccountConversationUrl\(key/);
  assert.match(app, /当前账号已有原 GPT 对话，网页检查尚未确认续接/);
  assert.match(app, /task\.conversationUrl = resumeConversationUrl/);
  assert.match(app, /task\.browserConversationUrl = resumeConversationUrl/);
  assert.match(app, /const knownConversationUrl = await readGptAccountConversationUrl\(key/);
  assert.match(app, /GPT_ORIGINAL_CONVERSATION_BOUNDARY_PENDING/);
  assert.match(app, /保留同一对话上下文，等待自动恢复，不切换新对话、不重复上传/);
  assert.match(app, /不回首页、不切新对话/);
  assert.match(app, /已保存原 GPT 对话 \$\{knownConversationUrl\}，当前页面未恢复；不在首页发送，等待自动重接/);
  assert.match(app, /原 GPT 对话未恢复，禁止首页发送，等待自动重接/);
});

test("GPT browser tabs keep an independent live URL and return home to ChatGPT", () => {
  assert.match(desktopMain, /partition:\s*`\$\{GPT_PARTITION_PREFIX\}-\$\{id\}`/);
  assert.match(desktopMain, /resolveGptStartupUrl\(startupProfile, GPT_URL\)/);
  assert.match(desktopMain, /action === "home" \|\| action === "new-chat"\) \{[\s\S]*?profile\.lastConversationUrl = "";[\s\S]*?await contents\.loadURL\(GPT_URL\)/);
  assert.match(app, /syncGptBrowserAddress\(result\.url\)/);
  assert.match(app, /gptBrowserHomeBtn.*navigateEmbeddedGpt\("home"\)/);
  assert.match(html, /id="gptBrowserAddressInput"/);
});

test("automatic recovery prefers the current queue task conversation URL", () => {
  assert.match(app, /function knownGptConversationUrl\(accountId, runtime = \{\}\)/);
  assert.match(app, /const queuedTask = \(state\?\.queue \|\| \[\]\)\.find/);
  assert.match(app, /queuedTask\?\.conversationUrl/);
  assert.match(app, /queuedTask\?\.chatUrl/);
  assert.ok(app.includes("if (/\\/c\\//i.test(taskCandidate))"));
  assert.match(app, /runtime\.conversationUrl/);
});

test("GPT material folders support context editing, recycle-bin deletion and drag move", () => {
  assert.match(html, /id="contextTrashFolder"/);
  assert.match(app, /data-gpt-material-path/);
  assert.match(app, /text\/x-teambuilding-material-path/);
  assert.match(app, /\/api\/extension\/move-entry/);
  assert.match(app, /\/api\/trash-workspace-folder/);
  assert.match(server, /function trashEditableWorkspaceDirectory/);
  assert.match(server, /RecycleOption\]::SendToRecycleBin/);
});

test("embedded GPT packages do not leak a foreground login page title", () => {
  assert.match(server, /conversationTitle:\s*publishTitle/);
  assert.match(server, /验证你的身份 - OpenAI/);
});

test("GPT production exposes real paths, minimum image checks, tool toggles and scheduled start", () => {
  assert.match(html, /id="gptMinimumImageCount"/);
  assert.match(html, /id="gptDownloadRoot"/);
  assert.match(html, /id="gptProductRoot"/);
  assert.match(html, /id="gptPromptLibraryEnabled"/);
  assert.match(html, /id="gptMessageDownloadsEnabled"/);
  assert.match(html, /id="gptScheduledEnabled"/);
  assert.match(app, /checkScheduledGptProduction/);
  assert.match(app, /scheduleGptQuotaReminder/);
  assert.match(server, /requestedDownloadRoot/);
  assert.match(server, /requestedProductRoot/);
});

test("normal production never routes package output into acceptance folders", () => {
  assert.match(server, /isAcceptancePath/);
  assert.match(server, /normalProductRoot/);
  assert.match(server, /const effectivePortfolioOutputRoot = configuredPackedRoot[\s\S]{0,180}stageRoots\.mobile/);
  assert.match(server, /config\.portfolio_output_path = effectivePortfolioOutputRoot/);
  assert.match(server, /config\.portfolio_batch_size = Math\.max\(1,[\s\S]{0,140}workspaceSettings\?\.workPackage\?\.batchSize/);
  assert.match(app, /normalizeProductionPath/);
});

test("GPT packaging writes its task manifest beside the actual downloaded images", () => {
  assert.match(server, /const effectiveDownloadRoot = requestedDownloadRoot/);
  assert.match(server, /taskFile = path\.join\(effectiveDownloadRoot, `chatgpt-workpkg-task-/);
  assert.match(server, /sourceMaterialPath: String\(body\.sourceMaterialPath \|\| ""\)/);
  assert.match(server, /sourceMaterialPath: String\(source\.sourceMaterialPath \|\| ""\)/);
  assert.match(server, /sourceMaterialPath: item\.sourceMaterialPath \|\| ""/);
  assert.match(server, /pathname === "\/api\/extension\/save-copy-text"/);
  assert.match(server, /\.gpt-copy-staging/);
  assert.match(server, /removeExtensionCopyText/);
  assert.match(server, /function inspectGptWorkPackage\(/);
  assert.match(server, /packageValid: packagePath \? packageInspection\.valid : false/);
  assert.match(server, /recordMatchesDisk = packageRecord\?\.status === "completed"/);
  assert.match(server, /recordedActual === recordedExpected/);
  assert.match(server, /validatedByPackageRecord: recordMatchesDisk/);
  assert.match(app, /打开成品文件夹（待核对）/);
});

test("GPT material parent checkbox keeps valid independent accessibility attributes", () => {
  assert.match(app, /data-indeterminate="\$\{partial \? "true" : "false"\}" aria-label="选择此文件夹中的全部帖子"/);
});

test("distribution package selection lifts the whole row and actions share one height", () => {
  assert.match(css, /\.distribution-package-row\.active[\s\S]*transform: translateY\(-3px\)/);
  assert.match(css, /\.distribution-package-row \.device-actions > :is\(button, label\)/);
  assert.match(app, /const issueBadge = sendable \? ""/);
  assert.doesNotMatch(app, /\["good", "可发送到手机"\]/);
});

test("device rows use a compact drop hint instead of redundant restock buttons", () => {
  assert.match(app, /class="device-drop-hint \$\{sendEnabled \? "" : "is-disabled"\}"/);
  assert.match(app, /拖动文件或文件夹到这里可上传/);
  assert.match(app, /设备上线后可拖动文件或文件夹上传/);
  assert.doesNotMatch(app, /data-device-action="traffic"[\s\S]*补泛流量/);
  assert.doesNotMatch(app, /data-device-action="conversion"[\s\S]*补精准流量/);
  assert.doesNotMatch(app, /data-upload-other="\$\{escapeHtml\(device\.id\)\}"/);
  assert.match(app, /const row = event\.target\.closest\?\.\("\.device-row\.is-online"\)/);
  assert.match(app, /await startGenericTransfer\(row\.dataset\.deviceId, sourcePath\)/);
  assert.match(css, /\.device-drop-hint\s*\{/);
  assert.match(css, /\.device-row\.is-drag-target \.device-drop-hint/);
});

test("device rows keep only transport state badges and omit default capability labels", () => {
  const rowStart = app.indexOf('const deviceRows = devices.map((device) => {');
  const rowEnd = app.indexOf('  $("#distributionDevices").innerHTML', rowStart);
  assert.ok(rowStart >= 0 && rowEnd > rowStart);
  const deviceRowTemplate = app.slice(rowStart, rowEnd);
  assert.match(deviceRowTemplate, /class="badge-line device-status-badges">\s*\$\{renderDeviceTransportTags\(device\)\}/);
  assert.doesNotMatch(deviceRowTemplate, /trustLabel/);
  assert.doesNotMatch(deviceRowTemplate, /可自动分发/);
  assert.doesNotMatch(deviceRowTemplate, /可发送/);
  assert.match(deviceRowTemplate, /firstConfirmationRequired && sendEnabled/);
});

test("finished transfer tasks can be dismissed and expire from the live surface", () => {
  assert.match(app, /data-dismiss-transfer=/);
  assert.match(app, /TRANSFER_TASK_VISIBLE_MS\s*=\s*3 \* 60 \* 1000/);
  assert.match(app, /dismissTransferTask\(/);
});

test("cloud backup exposes automatic schedule and monthly upload budget controls", () => {
  assert.match(html, /id="cloudBackupScheduleEnabled"/);
  assert.match(html, /id="cloudBackupFrequency"/);
  assert.match(html, /id="cloudBackupIntervalHours"/);
  assert.match(html, /id="cloudBackupMonthlyLimitMb"/);
  assert.match(html, /id="cloudBackupSourceRoot"/);
});

test("settings no longer exposes retired image or copy API credentials", () => {
  assert.doesNotMatch(html, /id="productionTextProvider"/);
  assert.doesNotMatch(html, /id="productionTextModel"/);
  assert.doesNotMatch(html, /id="productionTextApiKey"/);
  assert.doesNotMatch(html, /id="productionApiProvider"/);
});

test("流量转化桌面页使用原生骨架而不是 iframe 壳", () => {
  assert.doesNotMatch(html, /id="conversionAppFrame"/);
  assert.doesNotMatch(html, /<iframe[^>]+流量转化/);
  assert.match(html, /class="conversion-native-shell"/);
  assert.match(html, /id="conversionServiceStatus"/);
  assert.match(html, /data-conversion-module="search"/);
  assert.match(html, /data-conversion-module="analysis"/);
  assert.match(html, /id="conversionContent"/);
  assert.match(app, /if \(name === "conversion"\) \{[\s\S]*?loadConversionHub\(\)/);
  assert.doesNotMatch(app, /ensureEmbeddedConversionApp\(\)/);
  assert.match(css, /#conversionView\s*\{[\s\S]*?--conv-bg:\s*#e8edf3/);
  assert.match(css, /\.conversion-native-shell\s*\{[\s\S]*?display:\s*grid/);
  assert.match(css, /\.conversion-native-shell\s*\{[\s\S]*?grid-template-rows:\s*auto\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /#conversionView\.active\s*\{[\s\S]*?height:\s*100%[\s\S]*?min-height:\s*0/);
  assert.match(css, /\.conversion-native-shell\s*\{[\s\S]*?height:\s*100%[\s\S]*?min-height:\s*0/);
  assert.match(css, /\.conversion-main\s*\{[\s\S]*?height:\s*100%[\s\S]*?overflow:\s*hidden/);
});

test("流量转化四个模块渲染函数和布局细节齐全", () => {
  // 查回复 — 身份面板 + 双栏布局 + 双按钮
  assert.match(app, /function renderConversionSearch\(/);
  assert.match(app, /class="conversion-assistant-shell"/);
  assert.match(app, /class="conversion-identity-panel"/);
  assert.match(app, /class="conversion-identity-option/);
  assert.match(app, /id="conversionQuestion"/);
  assert.match(app, /id="conversionSearchBtn"/);
  assert.match(app, /id="conversionLocalSearchBtn"/);
  assert.match(app, /id="conversionSearchResult"/);
  assert.match(app, /function renderConversionActionResult\(/);
  assert.match(app, /data-copy-conversion-result=/);
  assert.match(app, /class="conversion-statusline"/);
  assert.match(app, /function renderConversionChatSourceStats\(\)[\s\S]*indexed\.总消息数[\s\S]*消息总数/);
  assert.match(app, /function renderConversionChatSourceStats\(\)[\s\S]*indexed\.客户转化群[\s\S]*indexed\.前端私聊会话/);
  assert.match(css, /\.conversion-search-shell\s*\{[\s\S]*?background:\s*var\(--conv-panel\)/);
  assert.match(css, /\.conversion-search-shell\s*\{[\s\S]*?box-shadow:\s*var\(--conv-shadow\)/);
  assert.match(css, /\.conversion-identity-panel\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /\.conversion-assistant-shell\s*\{[\s\S]*?grid-template-columns:\s*220px\s*minmax\(0,\s*1fr\)/);
  // SOP — stage-button 列表 + stage-detail 详情面板 + script-block 话术
  assert.match(app, /function renderConversionSop\(/);
  assert.match(app, /function conversionAnswerNote\(/);
  assert.match(app, /function conversionAnswerMoreOpen\(/);
  assert.match(app, /class="conversion-tree-explainer"/);
  assert.doesNotMatch(app, /data-like-answer/);
  assert.doesNotMatch(app, /conversion-like-btn/);
  assert.match(app, /class="conversion-sop-shell"/);
  assert.match(app, /class="conversion-sop-rail"/);
  assert.match(app, /class="conversion-stage-list"/);
  assert.match(app, /class="conversion-stage-button/);
  assert.match(app, /class="conversion-stage-detail"/);
  assert.match(app, /class="conversion-stage-code"/);
  assert.match(app, /class="conversion-script-block"/);
  assert.match(app, /data-conversion-stage=/);
  assert.match(css, /\.conversion-sop-shell\s*\{[\s\S]*?grid-template-columns:\s*220px\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.conversion-stage-button\s*\{[\s\S]*?grid-template-columns:\s*34px\s*1fr\s*auto/);
  assert.match(css, /\.conversion-stage-detail\s*\{[\s\S]*?min-height:\s*520px/);
  assert.match(css, /\.conversion-script-block\s*\{[\s\S]*?border-radius:\s*16px/);
  assert.match(css, /\.conversion-answer-actions\s*\{[\s\S]*?justify-content:\s*flex-end/);
  assert.match(css, /\.conversion-answer-note\s*\{[\s\S]*?border-left:/);
  // 配方案 — proposal-form + 手动筛选器 + 双按钮
  assert.match(app, /function renderConversionProposal\(/);
  assert.match(app, /class="conversion-proposal-form"/);
  assert.match(app, /class="conversion-manual-filter"/);
  assert.match(app, /class="conversion-filter-chip"/);
  assert.match(app, /id="conversionDemand"/);
  assert.match(app, /id="conversionProposalBtn"/);
  assert.match(app, /id="conversionMatchProposalBtn"/);
  assert.match(app, /id="conversionProposalResult"/);
  assert.match(app, /data-copy-conversion-plan=/);
  assert.match(app, /data-open-conversion-plan=/);
  assert.match(css, /\.conversion-proposal-form\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/);
  assert.match(css, /\.conversion-filter-chip\s*\{[\s\S]*?border-radius:\s*99px/);
  // 决策树 — 真实的递归分支画布 + 大纲式思维导图 + 可执行节点
  assert.match(app, /function renderConversionJourney\(/);
  assert.match(app, /class="conversion-journey-shell density-\$\{conversionJourneySettings\.density\} conversion-decision-tree-shell"/);
  assert.match(app, /const CONVERSION_DECISION_TREE_LAYOUT = \{/);
  assert.match(app, /function renderConversionDecisionTreeNode\(/);
  assert.match(app, /class="decision-tree-guide"/);
  assert.match(app, /class="decision-tree-board"/);
  assert.match(app, /class="decision-tree-canvas"/);
  assert.match(app, /class="decision-tree-node /);
  assert.match(app, /class="decision-tree-branch \$\{conversionDecisionTreeToneClass\(branch\.tone\)\}"/);
  assert.match(app, /class="decision-tree-terminal /);
  assert.match(app, /data-tree-depth=/);
  assert.match(app, /function conversionDecisionMindmapPath\(/);
  assert.match(app, /function renderConversionDecisionMindmap\(/);
  assert.match(app, /class="decision-mindmap-path"/);
  assert.match(app, /class="decision-mindmap-connector/);
  assert.match(app, /class="decision-mindmap-side-branch /);
  assert.match(app, /function renderConversionDecisionOutline\(/);
  assert.match(app, /function renderConversionDecisionOutlineNode\(/);
  assert.match(app, /class="decision-outline-map"/);
  assert.match(app, /class="decision-outline-node decision-tree-node /);
  assert.match(app, /data-decision-outline-action="expand"/);
  assert.match(app, /data-decision-outline-action="collapse"/);
  assert.match(app, /像大纲笔记一样读这棵树/);
  assert.match(css, /\.decision-mindmap-path\s*\{[\s\S]*?min-width:\s*max-content/);
  assert.match(css, /\.decision-mindmap-connector\s*\{[\s\S]*?height:\s*50px/);
  assert.match(css, /\.decision-mindmap-side-branch\s*\{[\s\S]*?border-left:/);
  assert.match(css, /\.decision-outline-tree\s*\{[\s\S]*?max-width:\s*980px/);
  assert.match(css, /\.decision-outline-summary\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.decision-outline-node\[open\]\s*>\s*\.decision-outline-summary/);
  assert.match(css, /\.decision-outline-branch-head\s*\{[\s\S]*?min-height:/);
  assert.match(app, /后续扩展/);
  assert.match(app, /function conversionJourneyTargetLabel\(/);
  assert.match(app, /CONVERSION_JOURNEY_EXECUTION/);
  assert.match(app, /CONVERSION_JOURNEY_SETTINGS_KEY/);
  assert.match(app, /CONVERSION_JOURNEY_PROGRESS_KEY/);
  assert.match(app, /function normalizeConversionJourneyProgress\(/);
  assert.match(app, /function completeCurrentConversionJourneyStep\(/);
  assert.match(app, /function resetConversionJourneyProgress\(/);
  assert.match(app, /data-journey-action="complete"/);
  assert.match(app, /data-journey-action="start"/);
  assert.match(app, /data-journey-action="reset"/);
  assert.match(app, /function renderConversionJourneySettingsPanel\(/);
  assert.match(app, /data-conversion-journey-setting=/);
  assert.match(app, /conversionJourneySettingsReset/);
  assert.match(app, /function bindConversionJourneySettings\(/);
  assert.match(css, /\.decision-tree-guide\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.decision-tree-board\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.decision-tree-canvas\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(css, /\.decision-tree-node\s*\{[\s\S]*?border-top:/);
  assert.match(css, /\.decision-tree-branches\s*\{[\s\S]*?grid-template-columns:\s*repeat\(var\(--decision-branch-count/);
  assert.match(css, /\.decision-tree-branch-line\s*\{[\s\S]*?height:\s*18px/);
  assert.match(css, /\.decision-tree-terminal\s*\{[\s\S]*?box-shadow:\s*var\(--conv-soft-shadow\)/);
  assert.match(css, /\.decision-tree-board-footer\s*\{[\s\S]*?border-top:\s*1px\s*solid\s*var\(--conv-line\)/);
  assert.match(css, /\.conversion-journey-progress\s*\{[\s\S]*?box-shadow:\s*var\(--conv-soft-shadow\)/);
  assert.match(css, /\.conversion-journey-progress-track\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.conversion-journey-settings-toggle\s*\{[\s\S]*?cursor:\s*pointer/);
  assert.match(css, /\.conversion-journey-settings-panel\s*\{[\s\S]*?position:\s*absolute/);
  // 全链路知识库 — 上帝视角经营总览，正式执行回到工作台
  assert.match(app, /const CONVERSION_KNOWLEDGE_REPORT_PATH/);
  assert.match(app, /const CONVERSION_OUTPUT_REPORT_PATH/);
  assert.match(app, /function renderConversionAnalysis\(/);
  assert.match(app, /analysis: \["全链路知识库"/);
  assert.match(app, /const CONVERSION_HTML_MODULES/);
  assert.match(app, /id: "deals"/);
  assert.match(app, /title: "全量漏斗"/);
  assert.match(app, /title: "成交分析"/);
  assert.match(app, /title: "团队分析"/);
  assert.match(app, /title: "工作台同步"/);
  assert.match(app, /title: "方法论沉淀"/);
  assert.match(app, /totalRevenue: "308,263"/);
  assert.match(app, /grossProfitRange: "30,826–77,066"/);
  assert.match(app, /\["2026-09", "0", "0"/);
  assert.match(app, /确认成交额/);
  assert.match(app, /const CONVERSION_HTML_EVIDENCE/);
  assert.match(app, /relevantSessions: "469"/);
  assert.match(app, /11 个确认成交案例/);
  assert.match(app, /conversion-html-evidence/);
  assert.match(app, /WeFlow 已恢复/);
  assert.doesNotMatch(app, /WeFlow 实时 API 当前不可用/);
  assert.match(app, /data-conversion-html-module=/);
  assert.match(app, /流量转化模块维护/);
  assert.match(app, /建立基线.*上帝视角判断.*更新流量转化模块/);
  assert.match(app, /对照成交与行业变化/);
  assert.match(app, /行业校准/);
  assert.match(app, /data-open-conversion-knowledge-report=/);
  assert.match(app, /data-open-conversion-output-report=/);
  assert.match(app, /流量转化成交产出复盘\.html/);
  assert.match(app, /data-analysis-module=/);
  assert.match(app, /conversion-analysis-shell/);
  assert.match(app, /全链路知识库模块/);
  assert.match(app, /工作台同步快照/);
  assert.doesNotMatch(app, /<h3>HTML复盘/);
  assert.match(app, /42 条/);
  assert.match(conversionOutputReport, /持续更新与行业校准/);
  assert.match(conversionOutputReport, /对照真实结果/);
  assert.match(conversionOutputReport, /分层写回/);
  assert.match(css, /\.conversion-analysis-shell\s*\{/);
  assert.match(css, /\.conversion-analysis-dimension-grid\s*\{/);
  // 工作区可滚动
  assert.match(css, /\.conversion-workspace\s*\{[\s\S]*?min-width:\s*0[\s\S]*?min-height:\s*0[\s\S]*?overflow-x:\s*hidden[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.conversion-workspace\s*>\s*:is\(\.conversion-assistant-shell,\s*\.conversion-sop-shell,\s*\.conversion-proposal-shell,\s*\.conversion-journey-shell\)\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none/);
  assert.match(css, /\.conversion-search-shell\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none/);
  assert.match(css, /\.conversion-proposal-shell\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none/);
  // 旧 iframe 状态层绝对定位已清除
  assert.doesNotMatch(css, /\.conversion-embedded-status\s*\{[^}]*position:\s*absolute/);
  // 深色模式覆盖转化模块
  assert.match(css, /data-theme="midnight-glass"\]\s*\.conversion-query/);
  assert.match(css, /data-theme="midnight-glass"\]\s*\.conversion-result\b/);
  assert.match(css, /data-theme="midnight-glass"\]\s*\.conversion-journey-lane/);
  // 顶部统计栏
  assert.match(html, /id="conversionCountBox"/);
  assert.match(html, /id="conversionShotCount"/);
  // 状态指示点
  assert.match(html, /id="conversionApiDot"/);
  assert.match(css, /\.conversion-dot\s*\{[\s\S]*?border-radius:\s*50%/);
  // 窄屏折叠
  assert.match(css, /@media\s*\(\s*max-width:\s*850px\s*\)[\s\S]*?\.conversion-sop-shell\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});

test("流量转化原生模块不得丢失原版搜索、方案和旅程内容", () => {
  assert.match(app, /\/api\/conversion\/snapshot\?lite=1/);
  assert.match(app, /\/api\/conversion\/search-index/);
  assert.match(app, /\/api\/conversion\/plan-index/);
  assert.match(server, /includeLargeIndexes: parsed\.query\.lite !== "1"/);
  assert.match(server, /Content-Encoding.*gzip|acceptsGzip/);
  assert.match(server, /requestConversionService\("\/api\/搜索快照"/);
  assert.match(server, /requestConversionService\("\/api\/方案索引"/);
  assert.match(server, /requestConversionService\("\/api\/搜索快照",\s*\{\s*timeoutMs:\s*45_000\s*\}/);
  assert.match(server, /requestConversionService\("\/api\/方案索引",\s*\{\s*timeoutMs:\s*30_000\s*\}/);
  assert.match(server, /function latestConversionRuntimeJson\(/);
  assert.match(server, /function getConversionSyncStatus\(/);
  assert.match(server, /CONVERSION_RUNTIME_ROOT/);
  assert.match(server, /sync[,\n]/);
  assert.match(app, /function conversionHistories\(/);
  assert.match(app, /function renderConversionHistoryCards\(/);
  assert.match(app, /id="conversionHistoryResults"/);
  assert.match(app, /id="conversionChatSourceStats"/);
  assert.doesNotMatch(app, /历史回答检索能力即将上线/);
  assert.match(app, /function conversionPlans\(/);
  assert.match(app, /function renderConversionPlanCards\(/);
  assert.match(app, /class="conversion-proposal-stats"/);
  assert.match(app, /id="conversionProposalLocalResults"/);
  assert.doesNotMatch(app, /本地方案匹配能力即将上线/);
  assert.match(app, /const DEFAULT_CONVERSION_JOURNEY_TREE = \{/);
  assert.match(app, /root: "lead-entry"/);
  assert.match(app, /function conversionJourneyTreeList\(/);
  assert.match(app, /target: "minimum-info"/);
  assert.match(app, /data-journey-node-id=/);
  assert.match(app, /data-journey-target=/);
  assert.match(app, /data-journey-sop-role=/);
  assert.match(app, /data-journey-progress-current=/);
  assert.match(app, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(app, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(app, /title: "客户第一次出现"/);
  assert.match(app, /title: "结果回流知识库"/);
  assert.match(app, /const CONVERSION_DECISION_TREE_LAYOUT = \{/);
  assert.match(app, /question: "这条信息是不是一个真实的团建需求？"/);
  assert.match(app, /class="decision-tree-branch \$\{conversionDecisionTreeToneClass\(branch\.tone\)\}"/);
  assert.match(app, /tone: "hold"/);
  assert.match(app, /class="decision-tree-terminal/);
  assert.match(app, /function renderConversionDecisionTreeTerminal\(/);
  assert.match(app, /function renderConversionDecisionTreeNode\(/);
  assert.match(app, /class="decision-tree-board"/);
  assert.match(app, /class="decision-tree-canvas"/);
  assert.match(app, /后续扩展/);
  assert.match(app, /class="conversion-sync-panel"/);
  assert.match(app, /class="conversion-sync-details"/);
  assert.match(app, /class="conversion-sync-summary"/);
  assert.match(app, /candidate\.messages/);
  assert.match(app, /待审核消息/);
  assert.match(css, /\.conversion-action-result\s*\{[\s\S]*?display:\s*grid/);
  assert.match(css, /\.conversion-result-action-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.conversion-plan-card-actions\s*\{[\s\S]*?justify-content:\s*flex-end/);
});

test("小红书固定评论话术保留企业号版和克制版备注", () => {
  if (!conversionFormalRuntime) return;
  assert.match(conversionFormalRuntime, /F01Q04A1/);
  assert.match(conversionFormalRuntime, /F01Q04A2/);
  assert.match(conversionFormalRuntime, /企业号专用/);
  assert.match(conversionFormalRuntime, /克制版/);
  assert.match(conversionFormalRuntime, /有多少人告诉我/);
});

test("embedded GPT follows the workbench light or dark theme without a duplicate card shell", () => {
  assert.match(app, /gptWorkbench\?\.setTheme\?\.\(value\)/);
  assert.match(desktopPreload, /setTheme\(theme = "neo"\)/);
  assert.match(desktopMain, /ipcMain\.handle\("desktop:gpt-theme"/);
  assert.match(desktopMain, /function applyEmbeddedGptTheme/);
  assert.match(desktopMain, /function embeddedGptPalette/);
  assert.match(desktopMain, /document\.body\?\.style\.setProperty\("background-color", palette\.main, "important"\)/);
  assert.match(css, /\.gpt-production-browser-panel\s*\{[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(css, /\.gpt-embedded-host\s*\{[\s\S]*?margin:\s*0;/);
  assert.match(css, /\.gpt-embedded-host\s*\{[\s\S]*?background:\s*var\(--page-bg/);
  assert.match(css, /#gptProductionTestView\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.gpt-production-test-shell\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;/);
  assert.match(css, /\.gpt-production-test-library\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/);
  assert.match(css, /body\[data-theme="midnight-glass"\] \.rail-tab\.active span\s*\{[\s\S]*?color:\s*inherit/);
});

test("theme changes update the document color scheme and replay after GPT DOM readiness", () => {
  assert.match(app, /root\.dataset\.theme\s*=\s*value/);
  assert.match(app, /root\.style\.colorScheme\s*=\s*isDarkTheme\s*\?\s*"dark"\s*:\s*"light"/);
  assert.match(desktopMain, /webContents\.on\("dom-ready",[\s\S]{0,1400}scheduleEmbeddedGptThemeReplay\(account, \[1200, 2200\]\)/);
  assert.match(desktopMain, /root\.dataset\.theme\s*=\s*\$\{JSON\.stringify\(isDark\s*\?\s*"dark"\s*:\s*"light"\)\}/);
});

test("GPT theme replay waits for embedded bootstrap instead of starving the production bridge", () => {
  assert.match(desktopMain, /if \(account\.gptEmbeddedInitialized !== true\) return;/);
  assert.match(desktopMain, /account\.gptEmbeddedInitialized = initialized !== null/);
  assert.match(desktopMain, /account\.gptEmbeddedInitialized = false/);
  assert.match(desktopMain, /scheduleEmbeddedGptThemeReplay\(account, \[180, 700\]\)/);
});

test("theme replay ignores a released GPT view instead of logging a stale-view race", () => {
  const start = desktopMain.indexOf("async function applyEmbeddedGptTheme");
  const end = desktopMain.indexOf("function waitForExtensionReady", start);
  const block = desktopMain.slice(start, end);
  assert.match(block, /const webContents = view\?\.webContents/);
  assert.match(block, /!view \|\| !webContents \|\| typeof webContents\.isDestroyed !== "function"/);
  assert.match(block, /account\?\.view !== view/);
  assert.match(block, /webContents\.isDestroyed\(\)/);
});

test("GPT browser tabs can be reordered and renamed without changing the running task owner", () => {
  assert.match(app, /data-gpt-account[^>]*draggable="true"/);
  assert.match(app, /reorderGptAccounts/);
  assert.match(app, /gptAccountTabs\?\.addEventListener\("pointerdown"/);
  assert.match(app, /reorderGptAccountTabsInDom/);
  assert.match(app, /persistGptAccountOrder\(gptAccountTabDomOrder\(gptAccountTabs\)\)/);
  assert.match(app, /renameGptAccount/);
  assert.match(desktopPreload, /reorderProfiles/);
  assert.match(desktopMain, /desktop:gpt-profile-reorder/);
  assert.match(app, /(?:gptAutoRunning|activeGptWindowWorkerState\(\)\.autoRunning) && !options\.silent/);
});

test("GPT production binds queue, controls and auto-runner to each browser window", () => {
  assert.match(html, /gpt-window-worker-state\.js\?v=/);
  assert.match(app, /const gptWindowWorkerStates = new Map\(\)/);
  assert.match(app, /const gptWindowWorkerPromises = new Map\(\)/);
  assert.match(app, /function gptWindowSettings\(accountId = activeGptAccountId\)/);
  assert.match(app, /function persistActiveGptWindowSelections\(\)/);
  assert.match(app, /async function runIndependentGptWindow\(accountId = activeGptAccountId/);
  assert.match(app, /gptWindowWorkerPromises\.has\(key\)/);
  assert.match(app, /if \(!await ensureGptWindowWorkerQueue\(key, workerState, settings\)\)/);
  assert.match(app, /runGptTaskOnBrowser\(task, account, tracker, workerState, settings, options\)/);
  assert.match(app, /options = \{ \.\.\.options, independentWorker: true \}/);
  assert.match(app, /function updateGptWindowUi\(accountId, callback\)/);
  assert.match(app, /normalizeGptProductionMode\(settings\.mode\) !== "single"/);
  assert.match(app, /GptWindowWorkerState\?\.shouldAutoArm/);
  assert.match(app, /if \(!state\.armed \|\| state\.autoPaused\)/);
  assert.match(app, /getGptContinuousWorkWindow\(new Date\(\), settings\)/);
  assert.match(app, /const hasLiveWorker = gptWindowWorkerPromises\.has\(key\)/);
  assert.match(app, /if \(state\.autoRunning && !hasLiveWorker\)/);
  assert.match(app, /scheduleGptWindowScheduleWake\(key, nextStartAt\)/);
  assert.match(app, /else localStorage\.removeItem\(GPT_CONTINUOUS_RUN_STORAGE_KEY\)/);
  assert.match(desktopMain, /partition: `\$\{GPT_PARTITION_PREFIX\}-\$\{id\}`/);
  assert.match(desktopMain, /backgroundThrottling: false/);
});

test("automatic GPT recovery does not display a stale terminal bridge stage as running", () => {
  assert.match(app, /async function runGptTaskOnBrowser\(task, account, tracker, workerState = gptWindowWorkerState\(account\.id\), settings = gptWindowSettings\(account\.id\), options = \{\}\)/);
  assert.match(app, /const automaticResume = options\.automaticResume === true/);
  assert.match(app, /task\._stage = checkpointStage && !terminalStagePattern\.test\(checkpointStage\)[\s\S]*?自动恢复当前检查点/);
  assert.match(app, /const terminalBridgeState = \["failed", "cancelled", "canceled", "completed"\]/);
  assert.match(app, /if \(terminalBridgeState && !workflowProgressObserved\)/);
  assert.match(app, /runGptTaskOnBrowser\(task, account, tracker, workerState, settings, options\)/);
});

test("single-account production hands the next post to the manually selected window", () => {
  assert.match(app, /let pendingSingleAccountHandoff = "";/);
  assert.match(app, /normalizeGptProductionMode\(gptAutoSettings\.mode\) === "single"[\s\S]{0,260}activeGptAccountId !== runAccountId/);
  assert.match(app, /pendingSingleAccountHandoff = activeGptAccountId;/);
  assert.match(app, /reconcileGptWindow\(handoffAccountId, \{ force: true \}\)/);
});

test("GPT account tab context menu supports disable, rename and remove with cookie warning", () => {
  assert.match(html, /id="contextToggleDisable"/);
  assert.match(html, /id="contextRemoveAccount"/);
  assert.match(app, /toggleGptAccountDisabled/);
  assert.match(app, /removeGptAccount/);
  assert.match(app, /renameGptAccount[\s\S]*?openSystemDialog/);
  assert.match(app, /removeGptAccount[\s\S]*?openSystemDialog/);
  assert.match(app, /Cookie、GPT 登录状态、Google 登录/);
  assert.match(app, /gpt-account-tab\.disabled/);
  assert.match(app, /disabled:\s*Boolean\(item\.disabled\)/);
  assert.match(app, /previousDisabled/);
  assert.match(app, /saveProfile\(\{\s*\.\.\.account,\s*disabled:\s*nextDisabled,\s*active:\s*false\s*\}\)/);
  assert.match(desktopMain, /hasOwnProperty\.call\(profile, "disabled"\)[\s\S]{0,120}disabled:\s*Boolean\(profile\.disabled\)/);
  assert.match(desktopMain, /disabled:\s*Boolean\(input\.disabled\s*\?\?\s*existing\?\.disabled\)/);
  assert.match(app, /hasOwnProperty\.call\(profile, "disabled"\)[\s\S]{0,240}saveProfile\(\{[\s\S]{0,160}disabled:\s*previousDisabled\.get\(id\)/);
});

test("GPT tab context menus keep the embedded browser visible when they do not overlap it", () => {
  assert.match(app, /function contextMenuOverlapsGptView\(menu\)/);
  assert.match(app, /contextMenuOverlapsGptView\(menu\)/);
  assert.match(app, /if \(gptActive && window\.gptWorkbench\?\.available && contextMenuOverlapsGptView\(menu\) && !contextMenuGptHidden\)/);
});

test("GPT template panel supports local folders and persistent online conversation templates", () => {
  assert.match(html, /id="gptTemplateCategoryFilter"/);
  assert.match(html, /option value="conversion">转化模板/);
  assert.match(html, /option value="game">游戏模板/);
  assert.match(html, /id="gptOnlineTemplateName"/);
  assert.match(html, /id="gptOnlineTemplateUrl"/);
  assert.match(app, /data-gpt-template-link/);
  assert.match(app, /loadGptOnlineTemplates/);
  assert.match(app, /saveGptOnlineTemplate/);
  assert.match(app, /taskType: "template-link"/);
  assert.match(app, /sendTemplateLinkToCurrentGpt/);
  assert.match(gptSidebar, /taskType \|\| ""\) === "template-link"/);
  assert.match(app, /data-gpt-online-template-delete/);
  assert.match(server, /pathname === "\/api\/gpt-online-templates"/);
  assert.match(desktopMain, /safeBrowserUrl/);
  assert.match(desktopMain, /await contents\.loadURL\(targetUrl\)/);
});

test("GPT template sessions are grouped by business template and expose account-owned conversation actions", () => {
  assert.match(html, /id="gptOnlineTemplateAccount"/);
  assert.match(app, /function gptOnlineTemplateGroupKey\(/);
  assert.match(app, /onlineConversations/);
  assert.match(app, /function gptOnlineConversationForAccount\(/);
  assert.match(app, /data-gpt-online-open/);
  assert.match(app, /data-gpt-online-copy/);
  assert.match(app, /browserIdentityId/);
  assert.match(app, /action: "record-success"/);
  assert.match(app, /successfulOutputCount/);
  assert.match(server, /function onlineTemplateIdentityKey\(/);
  assert.match(server, /action === "record-success"/);
  assert.match(server, /只接受当前账号的原始 ChatGPT 会话链接/);
  assert.match(css, /\.gpt-online-template-account-row/);
  assert.match(css, /\.gpt-online-account-link/);
});

test("continuous GPT windows keep optional progressive events but never block an independent queue", () => {
  assert.match(app, /function progressiveGptAccounts\(/);
  assert.match(app, /function progressiveGptLaunchGate\(/);
  assert.match(app, /reason: "independent-window-queue"/);
  assert.match(app, /waiting-previous-window-output/);
  assert.match(app, /function triggerProgressiveGptWindowLaunch\(/);
  assert.match(app, /triggerProgressiveGptWindowLaunch\(key\)/);
  assert.match(app, /workerState\.successfulOutputs/);
  assert.match(app, /task\.taskType === "material" && task\._status === "completed"/);
  assert.match(workerStateSource, /successfulOutputs/);
  assert.match(workerStateSource, /firstValidOutputAt/);
});

test("material and template rows expose the same manual upload action without starting automation", () => {
  assert.match(app, /data-gpt-upload-post/);
  assert.match(app, /data-gpt-upload-template/);
  assert.match(app, />上传素材<\/button>/);
  assert.match(app, />上传模板<\/button>/);
  assert.match(app, /uploadMaterialToCurrentGpt/);
  assert.match(app, /uploadTemplateToCurrentGpt/);
  assert.match(app, /autoRun:\s*false/);
  assert.match(app, /尚未自动发送/);
  assert.doesNotMatch(app, /data-gpt-send-post/);
  assert.match(css, /\.gpt-test-template-list \.workbench-folder-row\s*\{\s*grid-template-columns:\s*22px minmax\(0, 1fr\) auto;/);
});

test("manual sidebar uploads are scoped to the active window and keep a visible click response", () => {
  assert.equal((app.match(/function availableGptTestTemplates\(/g) || []).length, 1);
  assert.equal((app.match(/function uploadTemplateToCurrentGpt\(/g) || []).length, 1);
  assert.match(app, /function gptManualUploadLockState\(/);
  assert.match(app, /const manualUploadLock = gptManualUploadLockState\(\)/);
  assert.match(app, /data-gpt-upload-template=.*aria-disabled=/);
  assert.doesNotMatch(app, /data-gpt-upload-template=.*\$\{gptAutoRunning \? " disabled" : ""\}/);
  assert.match(app, /GPT_REQUEST_IN_FLIGHT[\s\S]{0,260}showSystemNotice\(/);
});

test("new account windows receive the current V4.5 registry prompt while trained conversations stay compact", () => {
  assert.match(html, /gpt-prompt-registry\.js\?v=/);
  assert.match(app, /TBGptPromptRegistry\.currentInitializationPrompt/);
  assert.match(app, /TBGptPromptRegistry\.currentInitializationVersion/);
  assert.doesNotMatch(app, /GPT_V36_MASTER_PROMPT/);
  assert.match(app, /function gptAccountNeedsMasterPrompt/);
  assert.match(app, /task\.taskType === "template-init"/);
  assert.match(app, /没有可确认的历史母版/);
  assert.match(app, /lastUrl: String\(profile\.lastUrl \|\| ""\)/);
  assert.equal(promptRegistry.currentInitializationVersion, "4.5");
  assert.equal(promptRegistry.currentInitializationSha256, "9EF9FE06E0D2E26DA3DF580A519BBE4E71D60C46E49E9366D5EC9A9D798F9A80");
  assert.match(promptRegistry.currentInitializationPrompt, /轮播母版迁移器 V4\.5/);
  assert.match(promptRegistry.currentInitializationPrompt, /最多10张/);
});

test("settings exposes the real initialization and per-step prompts as editable content", () => {
  assert.match(html, /id="gptMasterPromptRules"[^>]*textarea|textarea[^>]*id="gptMasterPromptRules"/);
  assert.doesNotMatch(html, /type="hidden" id="gptMasterPromptRules"/);
  assert.match(html, /id="gptRestoreMasterPromptBtn"/);
  assert.match(html, /id="gptCopyMasterPromptBtn"/);
  assert.match(html, /id="gptSaveMasterPromptBtn"/);
  assert.match(app, /function currentGptMasterPrompt\(\)/);
  assert.match(app, /masterPromptRules:/);
  assert.match(app, /gptRestoreMasterPromptBtn/);
  assert.match(app, /gptCopyMasterPromptBtn/);
  assert.match(html, /当前素材文件夹由程序自动追加/);
});

test("the editable material prompt is the exact instruction sent and plans are capped at ten", () => {
  assert.match(app, /const GPT_MATERIAL_PLAN_PROMPT = [^;]*最多 10 张[^;]*禁止第二批/);
  assert.match(app, /action: "upload-material", text: GPT_MATERIAL_PLAN_PROMPT/);
  assert.match(app, /normalizeGptMaterialPlanPrompt/);
  assert.match(app, /function normalizeQueuedGptTaskPrompt\(task/);
  assert.match(app, /saved\.tasks = saved\.tasks\.map\(\(task\) => normalizeQueuedGptTaskPrompt\(task\)\)/);
  assert.match(gptSidebar, /return resolveEntryInstruction\(entry\)/);
  assert.match(gptSidebar, /validatePlanPageCap\(\{ plannedImageCount, text: planText, maximum: 10 \}\)/);
  assert.match(gptSidebar, /PLAN_PAGE_CAP_EXCEEDED\|PLAN_BATCHING_FORBIDDEN/);
});

test("multi-account endless mode keeps one serial task per browser and isolates quota stops", () => {
  assert.doesNotMatch(html, /value="multi"[^>]*>多账号全自动（旧版）/);
  assert.match(app, /pendingGroups\.splice\(claimIndex, 1\)/);
  assert.match(app, /await runGptTaskOnBrowser\(task, account, tracker\)/);
  assert.match(app, /isActualGptLimitMessage[\s\S]*?return;/);
  assert.match(app, /allowedAccountIds/);
});

test("multi-account production persists workers, filters accounts and leaves quota-pending posts queued", () => {
  assert.match(app, /GPT_MULTI_RUN_STORAGE_KEY/);
  assert.match(app, /function persistGptMultiRun\(/);
  assert.match(app, /function availableMultiWindowAccounts\(/);
  assert.match(app, /multiAccountIds/);
  assert.match(app, /status\s*=\s*"waiting-quota"/);
  assert.match(app, /pendingGroups\.unshift\(\{ group: group\.slice\(taskIndex \+ 1\)/);
  assert.match(app, /gptQueuePaused = pending\.length > 0/);
  assert.match(app, /!\["completed", "skipped"\]\.includes\(task\._status\)/);
});

test("endless material selection only queues complete non-hidden post folders in usage order", () => {
  assert.match(app, /const imageCount = Number\(item\.imageCount \|\| 0\)/);
  assert.match(app, /const textCount = Number\(item\.textCount \|\| 0\)/);
  assert.match(app, /return hasImage && hasText/);
  assert.match(app, /isHiddenMaterialPath\(item\.path\)/);
  assert.match(app, /gptMaterialUsageCount\(left\.item, left\.category\) - gptMaterialUsageCount\(right\.item, right\.category\)/);
});

test("endless selection treats physical 已使用/已上传 folders as usage evidence even with a stale zero ledger", () => {
  assert.match(app, /function gptMaterialUsageCount\(item = \{\}, category = \{\}\)/);
  assert.match(app, /gptMaterialUsageCount\(left\.item, left\.category\) - gptMaterialUsageCount\(right\.item, right\.category\)/);
});

test("endless scheduler freezes a deliberate selected batch before automatic refill", () => {
  assert.match(app, /async function ensureGptWindowWorkerQueue\([\s\S]*?workerState\.selectedMaterials\.size[\s\S]*?await buildGptProductionQueueForWindow/);
  assert.match(app, /completed queue is a historical checkpoint/);
  assert.match(app, /normalizeGptProductionMode\(settings\.mode\) === "single"/);
  assert.match(app, /workerState\.selectedMaterials = new Set\(selection\.entries\.map/);
  assert.match(app, /async function buildGptProductionQueueForWindow\([\s\S]*?await selectedGptTestEntriesForWindow/);
  assert.match(app, /await loadMaterialCategory\(category\.path, \{ includeDiagnostics: false \}\)/);
  assert.match(app, /if \(window\.GptWindowWorkerState\.hasPending\(workerState\) && !queueExhausted\) return true;/);
});

test("retrying a stale previous-post boundary forces a clean upload of the selected post", () => {
  assert.match(app, /上一帖\|composer\|COMPOSER/);
  assert.match(app, /WINDOW_STAGE_PENDING/);
  assert.match(app, /failedTask\.forceUpload = true/);
  assert.match(app, /failedTask\._submittedToGpt = false/);
});

test("desktop manual download actions cross the isolated extension world through a DOM bridge", () => {
  assert.match(desktopMain, /tb-workbench-manual-action-request/);
  assert.match(desktopMain, /tb-workbench-manual-action-result/);
  assert.doesNotMatch(desktopMain, /window\.CGPTImageDownloadDebug\?\.manualAction/);
});

test("manual recovery can download every unique image from the latest complete assistant turn", () => {
  assert.match(gptUserscript, /download-complete-latest/);
  assert.match(gptUserscript, /TeambuildingGptProductionDownload/);
  assert.match(gptUserscript, /backend-api\/estuary\/content/);
});

test("a new post cannot upload while the previous GPT response is still generating", () => {
  assert.match(gptSidebar, /waitForPageIdleBeforeFreshUpload/);
  assert.match(gptSidebar, /WEB_RESPONSE_IN_FLIGHT/);
  assert.match(gptSidebar, /等待上一帖完成/);
  assert.match(gptSidebar, /PREVIOUS_POST_IDLE_WAIT_LIMIT_MS = 3 \* 60_000/);
  assert.match(gptSidebar, /wait-previous-post-idle/);
  assert.match(gptSidebar, /deadlineAt: timing\.deadlineAt/);
  assert.match(gptSidebar, /step-timeout/);
  assert.match(gptSidebar, /受控恢复/);
  assert.match(app, /GPT_PREVIOUS_POST_IDLE_TIMEOUT_MS = 3 \* 60_000/);
  assert.match(app, /previousPostIdleWithinBudget/);
  assert.match(app, /previousPostIdleRecoveryAllowed/);
});

test("continuous account windows recover ordinary failures without turning the window into a manual hold", () => {
  assert.match(app, /function isTransientGptWindowFailure/);
  assert.match(app, /GPT_INSPECTION_UNAVAILABLE/);
  assert.match(app, /isTransientGptWindowFailure[\s\S]*?WORKFLOW_STEP_TIMEOUT/);
  assert.match(app, /_autoRecoveryDeadlineAt/);
  assert.match(app, /_webReconnectDeadlineAt/);
  assert.match(app, /网页\/桥接恢复已超过/);
  assert.match(app, /GPT_REQUEST_DISPATCH_FAILED/);
  assert.match(app, /附件助手未确认接收请求/);
  assert.match(app, /async function refreshGptWindowForAutomaticRecovery/);
  assert.match(app, /automatic-readiness-recovery/);
  assert.match(app, /waitForGptProductionReadiness\(key, 12_000\)/);
  assert.match(app, /网页状态没有完成确认/);
  assert.match(app, /clearTimeout\(gptWindowRetryTimers\.get\(accountId\)\)/);
  assert.match(app, /const quotaKey = String\(gptAccounts\.find\(\(item\) => item\.id === key\)\?\.quotaGroup \|\| key\)/);
  assert.match(app, /await refreshGptQuota\(account\.id, \{ syncBrowser: options\.syncBrowser !== false \}\)/);
  const scheduler = app.slice(app.indexOf("function scheduleContinuousGptProduction"), app.indexOf("function buildGptTemplateInitTask"));
  assert.match(scheduler, /scheduleIndependentGptAutoRecovery\(key, result\)/);
  assert.match(scheduler, /status: "waiting-quota"[\s\S]{0,260}currentStage: "等待额度恢复"/);
  assert.doesNotMatch(scheduler, /state\.autoPaused = true/);
  assert.doesNotMatch(scheduler, /已停止自动重复发送/);
  assert.match(app, /const GPT_AUTOMATIC_RECOVERY_MAX_DEFERRALS = 3/);
  assert.match(app, /AUTO_RECOVERY_QUARANTINED/);
  assert.match(app, /shouldDeferStagnantRecovery/);
  assert.match(app, /同一检查点连续自动恢复但没有新进展/);
  assert.match(app, /state\.queueIndex = state\.queue\.length > 1[\s\S]{0,180}currentIndex \+ 1/);
  assert.match(app, /const isolated = deferIndependentGptTaskAfterAutomaticRecovery\([\s\S]*?scheduleContinuousGptProduction\(1_500\);[\s\S]*?return;/);
  assert.match(app, /GPT_PRODUCTION_READINESS_RECOVERY_BUDGET_MS/);
  assert.match(app, /GPT_PRODUCTION_READINESS_RECOVERY_MAX_ATTEMPTS/);
  assert.match(app, /readinessRecoveryDeadlineAt/);
  assert.match(app, /GPT_READINESS_RECOVERY_EXHAUSTED/);
  assert.match(app, /preflight-recovery-exhausted/);
  assert.match(app, /gptProductionRetryTimers.size > 0/);
  assert.match(app, /GPT_WINDOW_RECOVERY_BUDGET_MS/);
  assert.match(app, /GPT_WINDOW_RECOVERY_MAX_ATTEMPTS/);
  assert.match(app, /windowRecoveryDeadlineAt/);
  assert.match(app, /window-recovery-exhausted/);
  assert.match(app, /skipped: "recovery-in-flight"/);
  assert.match(app, /const scheduleNextRecovery/);
  assert.match(app, /handedOffToAnotherBoundary/);
  assert.match(app, /window-recovery-handoff/);
  assert.match(app, /Date\.now\(\) >= recoveryState\.deadlineAt/);
  assert.match(app, /ARCHIVED_BOUNDARY_RELEASE_PENDING/);
  assert.match(app, /CONVERSATION_BOUNDARY_PENDING/);
  assert.match(app, /archive-recovery-failed/);
  assert.match(app, /conversation-owner-mismatch/);
  assert.match(app, /copy-boundary-material-mismatch/);
  assert.match(app, /finite recovery budget eventually defers\/quarantines/);
});

test("top-level runtime mirror reports an independent retry or probe as running", () => {
  assert.match(app, /const mirrorRunning = hasIndependentWorker[\s\S]{0,180}recoveringWindowIds\.length > 0/);
  assert.match(app, /const liveMirrorAccount = gptAccounts\.find/);
  assert.match(app, /mirrorUsesIndependentQueue/);
});

test("inspection timeout uses a ready-page direct upload fallback and never reloads an active heartbeat task", () => {
  assert.match(app, /status\(accountId\)/);
  assert.match(app, /direct-upload-ready/);
  assert.match(app, /function gptAccountHasKnownConversation\(accountId = ""\)/);
  assert.match(app, /function isFreshRootGptReadiness\(readiness, accountId = ""\)/);
  assert.match(app, /function isFreshRootGptPageHealth\(health\)/);
  assert.match(app, /health\?\.extensionReady === true/);
  assert.match(app, /readiness\?\.composerReady !== false/);
  assert.match(app, /task\._freshConversationBootstrap === true/);
  assert.match(app, /freshChatReady && knownConversationUrl && task\._freshConversationBootstrap !== true/);
  assert.match(app, /freshConversationTask = !resumeOwnedConversation && \(task\.navigation === "new-chat"[\s\S]{0,180}task\._freshConversationBootstrap === true/);
  assert.match(app, /rememberedConversationUrl && task\._freshConversationBootstrap === true/);
  assert.match(app, /当前作品原 GPT 对话被重定向到首页/);
  assert.match(app, /const freshRootDeadlineAt = Date\.now\(\) \+ 10_000/);
  assert.match(app, /Date\.now\(\) < freshRootDeadlineAt/);
  assert.match(app, /const settleDeadlineAt = Date\.now\(\) \+ 15_000/);
  assert.match(app, /currentUrl === resumeConversationUrl[\s\S]{0,260}readiness\?\.productionReady !== true/);
  assert.match(app, /context\.navigated && context\.freshConversationBootstrap !== true/);
  assert.match(app, /let invalidConversationProved = currentTask\._freshConversationBootstrap === true/);
  assert.match(app, /if \(!invalidConversationProved\)/);
  assert.match(app, /skipped: "fresh-root-bootstrap-active"/);
  assert.match(app, /queuedTask\?\._freshConversationBootstrap === true/);
  assert.match(app, /const submittedOwnerUrl = String\([\s\S]{0,420}if \(submittedOwnerUrl\) return submittedOwnerUrl\.split\(\/\[\?#\]\//);
  assert.match(app, /if \(submittedOwnerUrl\)[\s\S]{0,120}return ""/);
  assert.match(app, /new Error\("新会话首页正在恢复；已保留当前作品，不再回退访问失效对话"\)/);
  assert.match(app, /window\.gptWorkbench\.navigate\("home", key\)/);
  assert.match(app, /knownConversationUrl: url,[\s\S]{0,80}freshRoot/);
  assert.match(app, /async function invalidateGptAccountConversationUrl/);
  assert.match(app, /function resetFreshConversationRecoveryBudget/);
  assert.match(app, /const freshTask = restored\?\.queue\?\.find/);
  assert.match(app, /if \(freshTask\) resetFreshConversationRecoveryBudget\(freshTask, key\)/);
  assert.match(app, /resetFreshConversationRecoveryBudget\(task, key\)/);
  assert.match(app, /currentTask\._freshConversationBootstrap = true;[\s\S]{0,220}currentTask\.forceUpload = true;/);
  assert.match(app, /delete task\[field\]/);
  assert.match(app, /readinessRecoveryAttempts: 0/);
  assert.match(app, /rememberedConversationUrl && task\._freshConversationBootstrap === true[\s\S]{0,120}resetFreshConversationRecoveryBudget/);
  assert.match(app, /lastInvalidConversationUrl: invalidUrl/);
  assert.match(app, /writeGptWindowRuntime\(key, \{[\s\S]{0,140}conversationUrl: ""[\s\S]{0,140}lastInvalidConversationUrl: invalidUrl/);
  assert.match(app, /entry\.url && entry\.url !== canonicalGptConversationUrl/);
  assert.match(app, /await invalidateGptAccountConversationUrl\(key, resumeConversationUrl, task\)/);
  assert.match(app, /invalidConversationUrl: freshRoot \? String\(activeTask\?\._staleConversationUrl/);
  assert.match(desktopMain, /const freshRoot = options\.freshRoot === true/);
  assert.match(desktopMain, /profile\.lastConversationUrl = ""/);
  assert.match(desktopMain, /lastInvalidConversationUrl: normalizeChatConversationUrl/);
  assert.match(desktopMain, /options\.invalidConversationUrl \|\| profile\.lastInvalidConversationUrl/);
  assert.match(desktopPreload, /invalidConversationUrl: String\(input\.invalidConversationUrl \|\| ""\)/);
  assert.match(desktopMain, /function isFreshRootGptPageReady\(readiness = \{\}\)/);
  assert.match(desktopMain, /allowFreshRoot: payload\.freshConversationBootstrap/);
  assert.match(desktopMain, /payload\.conversationUrl = ""/);
  assert.doesNotMatch(app, /const freshChatReady = readiness\?\.productionReady === true[\s\S]{0,160}readiness\?\.chatConversation !== true/);
  assert.match(app, /A-Za-z0-9-/);
  assert.match(app, /withGptWindowRecoveryLock\(key, "workflow-heartbeat-lost"/);
  assert.match(app, /refreshGptWindowForAutomaticRecovery\(key, "workflow-heartbeat-lost"/);
  assert.doesNotMatch(app, /const refreshed = await refreshGptAfterProduction\(key, "workflow-heartbeat-lost"\)/);
  assert.match(app, /GPT_AUTOMATIC_RECOVERY_MAX_REFRESHES/);
  assert.match(app, /automaticRefreshHistory/);
  assert.match(app, /refreshLimit/);
});

test("account-level page outages keep the current material instead of draining the queue", () => {
  assert.match(workerStateSource, /action: "hold-environment"/);
  assert.match(workerStateSource, /Never advance through and quarantine every material/);
});

test("automatic material selection uses the authoritative lifecycle claim gate", () => {
  assert.match(app, /fastParams\.set\("accountId", ownerAccountId\)/);
  assert.match(server, /getFastAutomaticMaterialEntries\(count = 8, excludedPaths = \[\], options = \{\}\)/);
  assert.match(server, /canClaimMaterial\(entry, \{ owner, now \}\)\.ok/);
  assert.match(server, /owner: String\(parsed\.query\.accountId \|\| ""\)/);
});

test("a submitted account-owned checkpoint can resume when only the native inspection read times out", () => {
  assert.match(app, /const resumeOwnedConversation = options\.resumeOwnedConversation === true/);
  assert.match(app, /if \(resumeOwnedConversation\) \{[\s\S]*?skippedInspection: true/);
  assert.match(app, /const sameAccountSubmittedTask = Boolean\(candidate/);
  assert.match(app, /candidate\._submittedToGpt === true/);
  assert.match(app, /candidate\.forceUpload !== true/);
  assert.match(app, /if \(sameAccountSubmittedTask\) \{[\s\S]*?resumed: true,[\s\S]*?skippedInspection: true/);
  assert.match(app, /resumeOwnedConversation\s*,/);
});

test("copy recovery stops stalled native responses and persists the bounded retry count", () => {
  assert.match(gptSidebar, /stalled-copy-generation/);
  assert.match(gptSidebar, /stalledGenerationThresholdMs/);
  assert.match(gptSidebar, /stalledImageSignatureSince/);
  assert.match(gptSidebar, /evidence: "stalled-image-response"/);
  assert.match(gptSidebar, /stopButtonFound/);
  assert.match(gptSidebar, /function visibleGenerationStopButton\(\)/);
  assert.match(gptSidebar, /function visibleGenerationStopButton\(\)[\s\S]{0,900}isActiveGenerationControl/);
  assert.match(gptSidebar, /const inViewport = rect\.width > 0 && rect\.height > 0[\s\S]{0,180}rect\.bottom > 0/);
  assert.match(gptSidebar, /const currentComposerStop = button\.id === "composer-submit-button"/);
  assert.match(gptSidebar, /const outerTurns = \[\.\.\.document\.querySelectorAll\('\[data-testid\^="conversation-turn"\]'\)\]/);
  assert.match(gptSidebar, /const semanticTurns = \[\.\.\.document\.querySelectorAll\('\[data-turn="assistant"\]'\)\]/);
  assert.match(gptSidebar, /copyRecoveryAttempts: Number\(workflow\.copyRecoveryAttempts \|\| 0\)/);
  assert.match(gptSidebar, /workflow\.copyRecoveryAttempts = Math\.max/);
  assert.match(gptSidebar, /文案连续 \$\{copyRecoveryAttempts\} 次恢复后仍不完整/);
});

test("continuous startup re-arms recoverable checkpoints for every independent window", () => {
  assert.match(app, /function gptWindowAutoStartAllowed\(accountId = activeGptAccountId\)/);
  assert.match(app, /function normalizeNonAutomaticGptWindowRuntime\(accountId = activeGptAccountId\)/);
  assert.match(app, /账号已停用，不参与自动生产/);
  assert.match(app, /手动模式，不参与自动生产/);
  assert.match(app, /GptWindowWorkerState\?\.shouldAutoArm/);
  assert.match(app, /queuePaused` is a recoverable checkpoint/);
  assert.match(app, /boundaryIsStagnant/);
  assert.match(app, /同一 GPT 对话边界多轮未释放，已自动隔离当前作品并继续队列/);
  assert.match(app, /durableCurrentTask\.\_status \|\| ""\) === "completed"/);
  assert.match(app, /已确认上一套完成，继续队列/);
  const startupStart = app.indexOf("gptAccounts.forEach((account) => {");
  const startupEnd = app.indexOf("scheduleContinuousGptProduction(1800)", startupStart);
  const startup = startupStart >= 0 && startupEnd > startupStart
    ? app.slice(startupStart, startupEnd)
    : "";
  assert.match(startup, /gptWindowAutoStartAllowed\(key\)/);
  assert.doesNotMatch(startup, /!state\.queuePaused/);
  assert.match(app, /function gptStartupStaggerWorkWindowKey\(now = new Date\(\), settings = gptAutoSettings\)/);
  assert.match(app, /function resetGptStartupStaggerForAllowedWorkWindow\(\)/);
  assert.match(app, /resetGptStartupStaggerForAllowedWorkWindow\(\);/);
  assert.match(app, /GptStartupStagger\.resetForWorkWindow/);
  assert.match(app, /setProductionActive\?\.\(true, key\)/);
  assert.match(app, /setProductionActive\?\.\(false, key\)/);
});

test("native production keep-alive tracks parallel account workers instead of one global boolean", () => {
  assert.match(desktopMain, /const productionTaskAccounts = new Set\(\)/);
  assert.match(desktopMain, /productionTaskAccounts\.add\(accountId\)/);
  assert.match(desktopMain, /productionTaskAccounts\.delete\(accountId\)/);
  assert.match(desktopMain, /legacyProductionTaskActive \|\| productionTaskAccounts\.size > 0/);
  assert.match(desktopPreload, /setProductionActive\(active = false, accountId = ""\)/);
});

test("cat usage is account-window specific and refreshes from real quota events", () => {
  assert.match(app, /currentSetNumber/);
  assert.match(app, /近\$\{quota\.settings\?\.windowHours \|\| 3\}小时上传/);
  assert.doesNotMatch(app, /预计上传 \$\{imageUploads\} 张图/);
  assert.match(app, /tb-workbench-quota-updated/);
  assert.match(app, /startGptQuotaUsageRefresh/);
});

test("generated quota is recorded when the current reply is confirmed, before download", () => {
  assert.match(gptSidebar, /generationQuotaRecorded/);
  assert.match(gptSidebar, /recordWorkbenchQuota\(task\.entry, "generated", detectedCount\)/);
  assert.doesNotMatch(gptSidebar, /recordWorkbenchQuota\(task\.entry, "generated", downloadResult\.count\)/);
});

test("rotation quota refresh does not wait on a browser that was just reloaded", () => {
  assert.match(app, /refreshGptAfterProduction\(account\.id, "rotation-production-complete"\)[\s\S]{0,700}refreshGptQuota\(account\.id, \{ syncBrowser: false \}\)/);
});

test("rotation browser readiness and admission IPC calls are individually bounded", () => {
  assert.match(app, /async function boundedGptBrowserCall/);
  assert.match(app, /boundedGptBrowserCall\(window\.gptWorkbench\.show\(bounds, activeGptAccountId\), 5_000\)/);
  assert.match(app, /boundedGptBrowserCall\(window\.gptWorkbench\.status\(accountId\), 2_500\)/);
  assert.match(app, /boundedGptBrowserCall\(window\.gptWorkbench\.inspectStatus\(account\.id\), GPT_INSPECT_CALL_TIMEOUT_MS\)/);
  assert.match(app, /switchGptAccount\(account\.id, \{ silent: true, resumeWindow: false, syncBrowser: false \}\)/);
});

test("upload quota is recorded only after the GPT page acknowledges the task", () => {
  assert.match(app, /let uploadQuotaRecorded = resumeOwnedConversation/);
  assert.match(app, /const uploadAcknowledged = status\.submittedToGpt === true[\s\S]{0,260}acknowledgedAttachments >= expectedAttachmentCount/);
  assert.match(app, /if \(!uploadQuotaRecorded && uploadAcknowledged\) \{[\s\S]{0,180}recordGptQuotaConsumption\(task, task\.quotaAccountId, "upload"\)/);
  assert.doesNotMatch(app, /if \(!resumeOwnedConversation\) recordGptQuotaConsumption\(task, task\.quotaAccountId, "upload"\)/);
  assert.doesNotMatch(app, /if \(!resumeCurrentConversation\) recordGptQuotaConsumption\(task, runAccountId, "upload"\)/);
});

test("GPT desktop read and stop bridges return bounded results when a window renderer stalls", () => {
  assert.match(desktopMain, /function executeGptJavaScriptBounded\(contents, script, timeoutMs = 4000/);
  assert.match(desktopMain, /async function executeGptJavaScriptViaCdp\(contents, script, timeoutMs = 4000\)/);
  assert.match(desktopMain, /Runtime\.evaluate/);
  assert.match(desktopMain, /contents\.debugger\.sendCommand\("Runtime\.evaluate"/);
  assert.match(desktopMain, /all account windows can legitimately be[\s\S]*?on https:\/\/chatgpt\.com/);
  assert.doesNotMatch(desktopMain, /127\.0\.0\.1:9333\/json\/list/);
  assert.match(desktopMain, /const gptJavaScriptInFlight = new WeakMap\(\)/);
  assert.match(desktopMain, /const gptJavaScriptExecutionTails = new WeakMap\(\)/);
  assert.match(desktopMain, /const executionTails = gptJavaScriptExecutionTails\.get\(contents\) \|\| new Map\(\)/);
  assert.match(desktopMain, /const previousExecution = executionTails\.get\(channel\) \|\| Promise\.resolve\(\)/);
  assert.match(desktopMain, /executionTails\.set\(channel, executionTail\)/);
  assert.doesNotMatch(desktopMain, /gptJavaScriptExecutionTails\.set\(contents, executionTail\)/);
  assert.match(desktopMain, /stalled inspect\/status probe/);
  assert.match(desktopMain, /workflow upload/);
  assert.match(desktopMain, /const executionTail = resultPromise\.then\(\(\) => executionReleased, \(\) => executionReleased\)/);
  assert.match(desktopMain, /const gptJavaScriptReadHealth = new WeakMap\(\)/);
  assert.match(desktopMain, /gpt-read-backoff/);
  assert.match(desktopMain, /consecutiveTimeouts >= 3/);
  assert.match(desktopMain, /backoffUntil = Date\.now\(\) \+ 5000/);
  assert.match(desktopMain, /if \(inFlight\.has\(channel\)\) return Promise\.resolve\(fallback\)/);
  assert.match(desktopMain, /gpt-execute-timeout/);
  assert.match(desktopMain, /desktop:gpt-workflow-status[\s\S]*?executeGptJavaScriptBounded/);
  assert.match(desktopMain, /tb-workbench-bridge-progress[\s\S]*?\}\)\(\)`?, 5000/);
  assert.match(desktopMain, /status:\$\{safeGptAccountId\(accountId\)\}:workflow/);
  assert.match(desktopMain, /desktop:gpt-inspect-status[\s\S]*?executeGptJavaScriptBounded/);
  assert.match(desktopMain, /desktop:gpt-stop-current-task[\s\S]*?stopCurrentTaskInEmbeddedGpt/);
  const statusStart = desktopMain.indexOf('ipcMain.handle("desktop:gpt-status"');
  const statusEnd = desktopMain.indexOf('ipcMain.handle("desktop:gpt-show"', statusStart);
  const statusBlock = desktopMain.slice(statusStart, statusEnd);
  assert.doesNotMatch(statusBlock, /TeambuildingGptConversationStateSnapshot/);
  assert.match(desktopMain, /function gptPageReadinessScript[\s\S]*?slice\(0, 2000\)/);
  assert.match(desktopMain, /const GPT_INITIALIZATION_TIMEOUT_MS = 10_000/);
  assert.match(desktopMain, /\}\)\(\)`, GPT_INITIALIZATION_TIMEOUT_MS, null, `init:\$\{account\.id\}`/);
  assert.match(desktopMain, /const cdpBudget = Math\.min\(1500, Math\.max\(500, Math\.floor\(limit \* 0\.25\)\)\)/);
  assert.match(desktopMain, /executeGptJavaScriptViaCdp\(contents, script, cdpBudget\)/);
  assert.match(desktopMain, /gpt-cdp-fallback/);
  assert.match(desktopMain, /if \(readHealth && readHealth\.consecutiveTimeouts > 0\)/);
  assert.match(desktopMain, /function noteGptBridgeSuccess\(account, channel\)/);
  assert.match(desktopMain, /gpt-bridge-timeout-deferred/);
  assert.match(statusBlock, /probeGptPageReadiness\(account, "status", 3000\)/);
});

test("a timeout-owned bridge recovery may rebuild the current task without weakening user holds", () => {
  assert.match(desktopMain, /const bridgeRecoveryOwnsTask = options\.reason === "stalled-conversation-bridge"/);
  assert.match(desktopMain, /bridgeRecoveryPending === true[\s\S]{0,220}!account\?\.pendingGptTask/);
  assert.match(desktopMain, /\(bridgeRecoveryOwnsTask \|\| \([\s\S]{0,220}!productionTaskAccounts\.has\(id\)/);
  assert.match(desktopMain, /if \(!bridgeRecoveryOwnsTask && shouldDeferGptPageRecovery\(/);
  assert.match(desktopMain, /const canRecreateStalledConversation = \["running", "retry-wait", "failed", "probing"\]/);
  assert.match(desktopMain, /if \(account\.bridgeRecoveryPending\) \{[\s\S]{0,160}gpt-bridge-recovery-confirmed/);
  assert.match(desktopMain, /runtime\.pausedByUser !== true/);
  assert.match(desktopMain, /runtime\.stoppedByUser !== true/);
});

test("heartbeat loss rebuilds only the stalled account before its worker can redispatch", () => {
  const stopStart = desktopMain.indexOf("async function stopCurrentTaskInEmbeddedGpt");
  const stopEnd = desktopMain.indexOf("async function setGptAccountUserHold", stopStart);
  const stopBlock = desktopMain.slice(stopStart, stopEnd);
  assert.match(stopBlock, /const automaticHeartbeatRecovery = !userInitiated && reason === "heartbeat-recovery"/);
  assert.match(stopBlock, /if \(automaticHeartbeatRecovery && pendingAborted && account\)/);
  assert.match(stopBlock, /account\.bridgeRecoveryPending = true/);
  assert.match(stopBlock, /reason: "stalled-conversation-bridge"/);
  assert.match(stopBlock, /allowActiveTaskRecovery: true/);
  assert.match(stopBlock, /freshRoot/);
  assert.match(stopBlock, /return \{[\s\S]{0,220}recovery: rebuilt/);
});

test("an interrupted plan submit preserves its existing composer attachments instead of uploading twice", () => {
  assert.match(gptSidebar, /const pendingAttachmentCount = attachmentPreviewCount\(\)/);
  assert.match(gptSidebar, /entry\.forceUpload = pendingAttachmentCount <= 0/);
  assert.match(gptSidebar, /将直接提交现有内容，不重复上传/);
  assert.match(gptSidebar, /Submit them as-is instead of uploading twice/);
});

test("GPT account renderers initialize with a bounded startup concurrency", () => {
  assert.match(desktopMain, /GPT_ACCOUNT_INITIALIZATION_CONCURRENCY = 1/);
  assert.match(desktopMain, /function enqueueGptAccountInitialization\(task, accountId = ""\)/);
  assert.match(desktopMain, /function drainGptAccountInitializationQueue\(\)/);
  assert.match(desktopMain, /gptAccountInitializationActive < GPT_ACCOUNT_INITIALIZATION_CONCURRENCY/);
  assert.match(desktopMain, /account\.initializing = enqueueGptAccountInitialization\(initializeAccount, id\)/);
});

test("large cloud backup scans yield to the local HTTP and production runtime", () => {
  assert.match(serverSource, /async function scanLargeBackupFiles\(root\)/);
  assert.match(serverSource, /await fs\.promises\.readdir\(current, \{ withFileTypes: true \}\)/);
  assert.match(serverSource, /await new Promise\(\(resolve\) => setImmediate\(resolve\)\)/);
  assert.match(serverSource, /const candidates = \(await scanLargeBackupFiles\(sourceRoot\)\)/);
});

test("optional backup and conversion warm-up do not occupy the startup health window", () => {
  assert.match(serverSource, /setTimeout\(runScheduledCloudBackup, 60_000\)/);
  assert.doesNotMatch(serverSource, /setTimeout\(runScheduledCloudBackup, 8_000\)/);
  assert.doesNotMatch(serverSource, /setTimeout\(warmIntegratedConversionCache, 10_000\)/);
});

test("runtime state writes return a compact acknowledgement instead of the full queue", () => {
  assert.match(serverSource, /const saved = await writeGptRuntimeStateAsync\(GPT_RUNTIME_STATE_FILE, body\)/);
  assert.match(serverSource, /revision: saved\.revision/);
  assert.match(serverSource, /updatedAt: saved\.updatedAt/);
  assert.match(serverSource, /queue: saved\.queue \? \{ version: saved\.queue\.version \} : null/);
  assert.doesNotMatch(serverSource, /state: await writeGptRuntimeStateAsync\(GPT_RUNTIME_STATE_FILE, body\)/);
});

test("native GPT bridge keeps health, workflow, and inspection reads from blocking each other", () => {
  assert.match(desktopMain, /function gptJavaScriptChannelForLabel/);
  assert.match(desktopMain, /function gptAccountForWebContents/);
  assert.match(desktopMain, /function noteGptBridgeTimeout/);
  assert.match(desktopMain, /if \(\/\^inspect:\/\.test\(value\)\) return "inspect"/);
  assert.match(desktopMain, /if \(\/\^workflow:\/\.test\(value\)\) return "workflow"/);
  assert.match(desktopMain, /return "health"/);
  assert.match(desktopMain, /shouldPreserveGptPageAfterReadTimeout/);
  assert.match(desktopMain, /readTimedOut/);
  assert.match(desktopMain, /bridge-timeout-known-stable/);
  assert.match(desktopMain, /const automaticRecoveryPending = !account\.pendingGptTask/);
  assert.match(desktopMain, /const productionBridgeReady = Boolean\(liveReadiness\?\.productionReady \|\| liveReadiness\?\.authenticationRequired\)/);
  assert.match(desktopMain, /const stableForAutomaticRecovery = isGptPageDocumentStable/);
  assert.match(desktopMain, /bridgeTimeoutStreak/);
  assert.match(desktopMain, /gpt-bridge-stalled-recovery/);
  assert.match(desktopMain, /account\.forceGptPageRecovery = true/);
  assert.match(desktopMain, /scheduleStalledGptPageRecovery\(account\)/);
});

test("GPT readiness requires the saved conversation path instead of treating ChatGPT home as live", () => {
  assert.ok(desktopMain.includes("const chatConversation = Boolean(chatHost &&"));
  assert.ok(desktopMain.includes('const chatConversation = (parsedUrl?.hostname === "chatgpt.com" || parsedUrl?.hostname === "www.chatgpt.com")'));
  assert.equal(desktopMain.includes('const chatConversation = Boolean(chatHost && (pathname === "/"'), false);
});

test("GPT task admission waits for a usable page and never lets a second click cancel the first", () => {
  const sendStart = desktopMain.indexOf("async function sendTaskToEmbeddedGpt");
  const sendEnd = desktopMain.indexOf("async function pausePendingTaskInEmbeddedGpt", sendStart);
  const sendBlock = desktopMain.slice(sendStart, sendEnd);
  assert.match(sendBlock, /waitForGptPageReadiness\([\s\S]{0,80}account,[\s\S]{0,80}30_000/);
  assert.match(sendBlock, /GPT_REQUEST_IN_FLIGHT/);
  assert.match(sendBlock, /pending\.promise = requestPromise/);
  assert.doesNotMatch(sendBlock, /abortPendingGptTask\(account, "新的生产请求已接管当前账号窗口"\)/);
  assert.match(app, /result\?\.errorCode === "GPT_REQUEST_IN_FLIGHT"/);
  assert.match(app, /本次点击未重复上传/);
});

test("GPT production dispatch does not hold one renderer evaluation for the whole workflow", () => {
  assert.match(desktopMain, /function embeddedGptTaskResultScript\(requestId\)/);
  assert.match(desktopMain, /async function waitForEmbeddedGptTaskResult\(account, requestId, aborted/);
  assert.match(desktopMain, /const dispatchScript = `\(\(\) =>/);
  assert.match(desktopMain, /return waitForEmbeddedGptTaskResult\(account, requestId, aborted\)/);
  const sendStart = desktopMain.indexOf("async function sendTaskToEmbeddedGpt");
  const sendEnd = desktopMain.indexOf("async function pausePendingTaskInEmbeddedGpt", sendStart);
  const sendBlock = desktopMain.slice(sendStart, sendEnd);
  assert.doesNotMatch(sendBlock, /setTimeout\(\(\) =>[\s\S]{0,300}65 \* 60 \* 1000/);
  assert.match(sendBlock, /workflow:\$\{accountId\}:dispatch/);
  assert.match(desktopMain, /read:\$\{account\.id\}:result/);
  assert.match(gptSidebar, /acceptedWorkbenchRequestIds: new Set\(\)/);
  assert.match(gptSidebar, /acceptedWorkbenchRequestIds\.has\(requestId\)/);
  assert.match(gptSidebar, /document\.addEventListener\("tb-workbench-upload"[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?acceptWorkbenchTask\(message\)/);
  const acceptStart = gptSidebar.indexOf("async function acceptWorkbenchTask");
  const acceptEnd = gptSidebar.indexOf("function pauseWorkbenchTaskBeforeSubmit", acceptStart);
  const acceptBlock = gptSidebar.slice(acceptStart, acceptEnd);
  assert.doesNotMatch(acceptBlock, /if \(forceUpload\)[\s\S]{0,260}forceClearComposer\(\)/);
  assert.match(gptSidebar, /existingDraft\.length > 12000[\s\S]{0,500}target\.textContent = ""/);
  assert.match(gptSidebar, /function shouldPreserveAutomationDraftForAttachmentResume/);
  assert.match(gptSidebar, /forceUpload: entry\.forceUpload[\s\S]{0,240}draftBelongsToTask: pendingDraftBelongsToThisTask[\s\S]{0,240}attachmentCount: attachmentPreviewCount\(\)/);
  assert.match(gptSidebar, /entry\.forceUpload && !preserveMatchingDraftForAttachmentResume/);
  assert.match(gptSidebar, /!preserveMatchingDraftForAttachmentResume \|\| !isAutomationDraft\(composerDraftText\(\), entry\)/);
  assert.match(gptSidebar, /async function decodeBase64FileInResponsiveChunks/);
  assert.match(gptSidebar, /const chunkCharacters = 256 \* 1024/);
  assert.match(gptSidebar, /await new Promise\(\(resolve\) => setTimeout\(resolve, 0\)\)/);
  assert.doesNotMatch(gptSidebar, /const binary = atob\(response\.data\)/);
  assert.match(gptSidebar, /async function attachFilesInResponsiveBatches/);
  assert.match(gptSidebar, /batchSize: 2/);
  assert.match(gptSidebar, /COMPOSER_PARTIAL_ATTACHMENTS/);
  assert.doesNotMatch(gptSidebar, /files\.forEach\(\(file\) => transfer\.items\.add\(file\)\)/);
});

test("GPT production attachments use the exact Electron WebContents native file input path", () => {
  assert.match(desktopMain, /async function setGptTaskFileInputFiles\(contents, filePaths\)/);
  assert.match(desktopMain, /DOM\.setFileInputFiles/);
  const sendStart = desktopMain.indexOf("async function sendTaskToEmbeddedGpt");
  const sendEnd = desktopMain.indexOf("async function pausePendingTaskInEmbeddedGpt", sendStart);
  const sendBlock = desktopMain.slice(sendStart, sendEnd);
  const nativeUploadFlagIndex = sendBlock.indexOf("nativeUpload:");
  const nativeInputSetIndex = sendBlock.indexOf("setGptTaskFileInputFiles(view.webContents, payload.attachments)");
  const dispatchIndex = sendBlock.indexOf("const dispatched = await Promise.race([");
  assert.ok(nativeUploadFlagIndex >= 0, "dispatch payload must carry the native upload flag");
  assert.ok(nativeInputSetIndex >= 0, "the exact WebContents native input helper must be called");
  assert.ok(dispatchIndex >= 0, "the request must be dispatched after native file selection");
  assert.ok(nativeInputSetIndex < dispatchIndex, "native file selection must finish before the workflow request is dispatched");
  assert.match(sendBlock, /gpt-native-file-input-set/);
  assert.match(gptSidebar, /const nativeUpload = Boolean\(message\.nativeUpload\)/);
  assert.match(gptSidebar, /retryTask\.entry\.nativeUpload = nativeUpload/);
  const nativeStart = gptSidebar.indexOf("if (nativeUpload) {");
  const nativeEnd = gptSidebar.indexOf("} else {", nativeStart);
  assert.ok(nativeStart >= 0 && nativeEnd > nativeStart, "native upload branch must remain explicit");
  const nativeBranch = gptSidebar.slice(nativeStart, nativeEnd);
  assert.doesNotMatch(nativeBranch, /new DataTransfer|loadFiles\(|dispatchEvent\(/);
});

test("content production instances expose a permanent A-D identity badge and native window title", () => {
  assert.match(html, /id="contentInstanceBadge"/);
  assert.match(html, /id="contentInstanceBrand"/);
  assert.match(html, /id="contentInstanceTitle"/);
  assert.match(css, /\.content-instance-badge/);
  assert.match(app, /function applyContentInstanceIdentity\(\)/);
  assert.match(app, /document\.body\.dataset\.contentInstance = instance/);
  assert.match(desktopMain, /const APP_TITLE = `内容生产 \$\{CONTENT_INSTANCE_ID\}/);
  assert.match(desktopMain, /page-title-updated/);
  assert.match(desktopMain, /window\.setTitle\(APP_TITLE\)/);
});

test("scheduled web cache cleanup never clears GPT production partitions", () => {
  assert.match(desktopMain, /async function clearReproducibleWebCaches\(reason = "manual", options = \{\}\)/);
  assert.match(desktopMain, /const includeGpt = options\.includeGpt !== false/);
  assert.match(desktopMain, /clearReproducibleWebCaches\("scheduled-3h", \{ includeGpt: false \}\)/);
});

test("automatic readiness recovery never reloads an account that still owns a live task", () => {
  const start = app.indexOf("async function refreshGptWindowForAutomaticRecovery");
  const end = app.indexOf("function scheduleGptWindowRetry", start);
  const block = app.slice(start, end);
  assert.match(block, /const activeWorker = gptWindowWorkerState\(key\)/);
  assert.match(block, /const activeQueueTask = Array\.isArray\(activeWorker\.queue\)/);
  assert.match(block, /activeWorker\.autoRunning/);
  assert.match(block, /const runtimeOwnsTask = !settledHeartbeatRecovery[\s\S]{0,520}currentTaskId/);
  assert.match(block, /!\["idle", "completed", "waiting-quota", "retry-wait", "failed", "probing"\]\.includes\(String\(activeRuntime\.status \|\| ""\)\)/);
  assert.match(block, /activeRuntime\.pausedByUser !== true/);
  assert.match(block, /activeRuntime\.stoppedByUser !== true/);
  assert.match(block, /skipped: "active-task"/);
  assert.match(block, /ERR_ABORTED/);
});

test("GPT maintenance keeps a window closed to new work until its refresh promise settles", () => {
  assert.match(app, /const gptWindowRefreshInFlight = new Set\(\)/);
  assert.match(app, /gptWindowRefreshInFlight\.add\(key\)/);
  assert.match(app, /gptWindowRefreshInFlight\.delete\(key\)/);
  assert.match(app, /if \(gptWindowRefreshInFlight\.has\(key\) \|\| gptAccountRefreshPromises\.has\(key\)\)/);
  assert.match(app, /const workerBusy = gptWindowRefreshInFlight\.has\(key\)/);
});

test("native GPT maintenance defers navigation while a durable account task is active", () => {
  const start = desktopMain.indexOf("async function refreshGptAccountSession(");
  const end = desktopMain.indexOf("function embeddedGptTaskResultScript", start);
  const block = desktopMain.slice(start, end);
  assert.match(block, /const durableRuntime = readRuntimeState\(GPT_RUNTIME_STATE_FILE\)/);
  assert.match(block, /durableTaskStillBusy/);
  assert.match(block, /productionTaskAccounts\.has\(id\) \|\| account\.pendingGptTask \|\| durableTaskStillBusy/);
  assert.match(block, /gpt-page-maintenance-deferred/);
  assert.match(block, /deferred: true/);
  assert.match(block, /已延后网页刷新/);
});

test("GPT temporary cache maintenance respects manual mode and explicit window holds", () => {
  const helperStart = app.indexOf("function gptWindowMaintenanceHeld");
  const scheduleStart = app.indexOf("function scheduleGptTemporaryCacheMaintenance", helperStart);
  const runStart = app.indexOf("async function runGptTemporaryCacheMaintenance", scheduleStart);
  assert.ok(helperStart >= 0 && scheduleStart > helperStart && runStart > scheduleStart);
  const helper = app.slice(helperStart, scheduleStart);
  const schedule = app.slice(scheduleStart, runStart);
  const run = app.slice(runStart, app.indexOf("function restoreGptTemporaryCacheMaintenanceTimers", runStart));
  assert.match(helper, /!independentGptWindowMode\(settings\.mode\)/);
  assert.match(helper, /workerState\.stoppedByUser/);
  assert.match(helper, /runtime\.pausedByUser/);
  assert.match(schedule, /gptWindowMaintenanceHeld\(key\)/);
  assert.match(run, /reason: "user-hold"/);
  assert.match(app, /const explicitUserHold = Boolean\(/);
  assert.match(app, /已停止，不参与自动生产/);
  assert.match(app, /nextRetryAt: null/);
  assert.match(app, /scheduleGptTemporaryCacheMaintenance\(accountId, Date\.now\(\)\)/);
});

test("a delayed native GPT show is hidden again after navigation leaves the production view", () => {
  const showStart = app.indexOf("async function showEmbeddedGptView()");
  const showEnd = app.indexOf("function restoreEmbeddedGptView()", showStart);
  const showBlock = app.slice(showStart, showEnd);
  const nativeShow = showBlock.indexOf("await boundedGptBrowserCall(window.gptWorkbench.show");
  const signatureCommit = showBlock.indexOf("gptLastShowSignature = signature", nativeShow);
  const postShowGuard = showBlock.slice(nativeShow, signatureCommit);

  assert.ok(showStart >= 0 && showEnd > showStart);
  assert.ok(nativeShow >= 0 && signatureCommit > nativeShow);
  assert.match(postShowGuard, /if \(!\$\("#gptProductionTestView"\)\?\.classList\.contains\("active"\)\)/);
  assert.match(postShowGuard, /await window\.gptWorkbench\?\.hide\?\.\(\)\.catch/);
});

test("manual distribution uses manual eligibility instead of automatic eligibility", () => {
  assert.match(app, /const sendable = collection\.sourceValid && collection\.manualEligible/);
  assert.match(app, /!collection\.sourceValid \|\| !collection\.manualEligible/);
});

test("per-window mode: each account window stores and restores its own production mode", () => {
  // loadGptAccounts includes a mode field per account
  assert.match(app, /mode:\s*item\.mode\s*\?\s*normalizeGptProductionMode\(item\.mode\)/);
  // handleGptModeChange persists the mode on the current account
  assert.match(app, /currentAccount\.mode\s*=\s*key/);
  // switchGptAccount restores the mode from the account
  assert.match(app, /const accountMode\s*=\s*account\.mode/);
  assert.match(app, /gptAutoSettings\.mode\s*=\s*accountMode/);
  // hydrateGptBrowserProfiles preserves mode across Electron sync
  assert.match(app, /previousModes/);
  // Account tabs show the mode tag
  assert.match(app, /gpt-account-mode-tag/);
});

test("per-window mode is persisted to the native browser profile", () => {
  const modeChange = app.match(/const handleGptModeChange = \(event\) => \{([\s\S]*?)\r?\n\s*\};\r?\n\s*\$\("#gptProductionMode"\)/)?.[1] || "";
  assert.match(modeChange, /currentAccount\.mode\s*=\s*key/);
  assert.match(modeChange, /window\.gptWorkbench\?\.saveProfile\?\.\(\{\s*\.\.\.currentAccount,\s*active:\s*false\s*\}\)/);
});

test("switching account windows restores the left material/template selections and active queue controls", () => {
  const switchSection = app.match(/async function switchGptAccount\(accountId, options = \{\}\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nasync function addGptAccount/)?.[1] || "";
  assert.match(switchSection, /restoreLegacyGptWindowState\(account\.id\);[\s\S]{0,500}renderGptTestMaterials\(\);[\s\S]{0,120}renderGptTestTemplates\(\);[\s\S]{0,120}updateGptTestQueueStatus\(\);/);
  assert.match(app, /function persistActiveGptWindowSelections\(\)/);
  assert.match(app, /activeGptWindowWorkerState\(\)/);
});

test("a newly added browser window starts with its own production mode and empty selections", () => {
  const addSection = app.match(/async function addGptAccount\(\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nasync function removeGptAccount/)?.[1] || "";
  assert.match(addSection, /mode:\s*"single"/);
  assert.match(addSection, /activeGptAccountId = account\.id;[\s\S]{0,300}restoreLegacyGptWindowState\(account\.id\);[\s\S]{0,300}renderGptTestMaterials\(\);[\s\S]{0,300}renderGptTestTemplates\(\);/);
});

test("Electron browser profiles preserve a validated production mode across rehydration", () => {
  assert.match(desktopMain, /function safeGptProductionMode\(/);
  assert.match(desktopMain, /mode:\s*safeGptProductionMode\(profile\.mode/);
  assert.match(desktopMain, /mode:\s*safeGptProductionMode\(input\.mode\s*\?\?\s*existing\?\.mode/);
});

test("account tab context menu opens that window's own production mode and quota settings", () => {
  assert.match(app, /contextModeSettings.*hidden\s*=\s*!\(isProductionMode \|\| isBrowserProfile\)/);
  assert.match(app, /contextModeSettings.*textContent\s*=\s*isBrowserProfile\s*\?\s*"账号生产与额度设置"/s);
  assert.match(app, /target\?\.kind === "gpt-browser-profile"[\s\S]{0,500}await switchGptAccount\(target\.accountId/);
  assert.match(app, /await switchGptAccount\(target\.accountId[\s\S]{0,500}openPageSettings\("gptAuto"\)/);
});


test("one-shot and continuous production modes keep their distinct queue contracts", () => {
  // “选材后自动”仍是一次性批次；只有“单账号全自动/定时单账号全自动”补充下一套。
  assert.match(app, /automatic:\s*\{[^}]*continuous:\s*false/);
  assert.match(app, /single:\s*\{[^}]*continuous:\s*true/);
  assert.match(app, /scheduled:\s*\{[^}]*continuous:\s*true/);
  // 旧总开关只是兼容镜像；重启后应由仍处于自动模式的账号和检查点恢复生产。
  assert.match(app, /function isContinuousGptProductionArmed\(\)\s*\{[\s\S]*?if \(!isContinuousGptMode\(\)\) return false;[\s\S]*?localStorage\.getItem\(GPT_CONTINUOUS_RUN_STORAGE_KEY\) === "true"[\s\S]*?return gptAccounts\.some\(/);
  assert.match(app, /if \(!hasPendingQueue && isContinuousGptMode\(\)\)\s*\{\s*hasPendingQueue = Boolean\(await prepareAutoGptQueue/);
  // manual 模式不自动发送；其他自动模式沿用完整工作流。
  assert.match(app, /const manualMode = normalizedMode === "manual"/);
  assert.match(app, /task\.autoRun = !manualMode/);
  assert.match(app, /modeKey === "manual"[\s\S]*?button\.textContent = "📤 上传素材到输入框"/);
  assert.match(app, /button\.textContent = productionStatus\.primaryActionLabel/);
});

test("GPT production UI labels clarify upload actions, live status and optional extra prompt", () => {
  assert.match(html, /id="gptStatusBadge"/);
  assert.match(html, /class="gpt-extra-prompt-fold"/);
  assert.match(html, /补充要求（可留空）/);
  assert.match(app, /data-gpt-upload-post/);
  assert.match(app, />上传素材<\/button>/);
  assert.match(app, /data-gpt-upload-template/);
  assert.match(app, />上传模板<\/button>/);
  assert.match(app, /只把这个帖子的图片和 TXT 上传到当前 GPT 输入框，不自动发送/);
  assert.match(app, /只把这个模板的图片和规则上传到当前 GPT 输入框，不自动发送/);
  assert.match(productionStatus, /label: "等待发送"/);
  assert.match(css, /\.gpt-status-badge\.badge-running/);
  assert.match(css, /\.gpt-status-badge\.badge-pending/);
  assert.match(css, /\.gpt-status-badge\.badge-quota/);
  assert.match(css, /\.gpt-extra-prompt-fold/);
});

test("GPT production UI makes mode and template choices visible at a glance", () => {
  assert.match(html, /class="gpt-template-category-filter"/);
  assert.match(css, /\.gpt-template-category-filter select/);
  assert.match(css, /\.gpt-mode-hint/);
  assert.match(app, /gpt-account-mode-tag/);
  assert.match(css, /\.gpt-account-mode-tag/);
  assert.match(html, /<select id="gptProductionMode" aria-label="生产模式"/);
  assert.doesNotMatch(html, /<label for="gptProductionMode">生产模式<\/label>/);
  assert.match(css, /\.gpt-mode-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(app, /pauseButton\.hidden = !productionStatus\.showPauseButton \|\| windingDownAfterPause/);
  assert.match(app, /stopButton\.hidden = !productionStatus\.showStopButton \|\| \(runtime\.stoppedByUser && canResumeQueue\)/);
  assert.match(app, /runtime\.stoppedByUser \? "▶ 启动本窗口" : "⏹ 停止本窗口"/);
  assert.match(app, /button\.hidden = queueContinuationState\.has\(productionStatus\.code\) \|\| windingDownAfterPause/);
  assert.match(app, /productionStatus\.code === "stopped"\) pauseButton\.textContent = "▶ 恢复本窗口"/);
  assert.match(app, /const continuationActions = new Set\(\["stopped", "paused", "pending", "quota"\]\)/);
  assert.match(app, /continuationActions\.has\(status\.code\)[\s\S]*?\? "gpt\.continue"/);
  assert.match(app, /已收到恢复指令，正在恢复当前账号窗口/);
  assert.match(app, /工作台动作总线尚未加载/);
  assert.match(app, /function prepareIndependentRestartRecoveryTask\(workerState\)/);
  assert.match(app, /工作台重启中断了当前执行[\s\S]*?task\._submittedToGpt !== true/);
  assert.match(app, /已识别上次刷新留下的当前作品，正在从网页检查点恢复/);
  assert.match(app, /skipBtn\.hidden = !hasQueueTask/);
  assert.match(app, /skipBtn\.disabled = uiState\.autoRunning/);
  assert.match(app, /reopenButton\.hidden = uiState\.autoRunning \|\| !hasRecoverySurface/);
  assert.match(app, /gpt\.reopen-window/);
  assert.match(app, /if \(windingDownAfterPause\)[\s\S]*?button\.textContent = "▶ 继续当前流程"/);
});

test("独立账号入口不会回落到旧全局 worker，并且文案边界先于过期补图判断", () => {
  assert.match(app, /const requestedWindowSettings = gptWindowSettings\(requestedAccountId\)/);
  assert.match(app, /independentGptWindowMode\(requestedWindowSettings\.mode\)[\s\S]*?return runIndependentGptWindow\(requestedAccountId/);
  assert.match(gptSidebar, /const conversationSnapshot = conversationStateSnapshot\(\)/);
  assert.match(gptSidebar, /const pagePackageCount = packageCountMatch/);
  assert.match(gptSidebar, /snapshotCopyText = String\(conversationSnapshot\?\.copyText/);
  assert.match(gptSidebar, /pagePackageCount,[\s\S]*?conversationSnapshot\?\.latestImageCount/);
});

test("stopped independent windows wait for the old worker before restarting", () => {
  assert.match(productionStatus, /停止不会自动重启；点击“恢复本窗口”后继续生产/);
  assert.match(productionStatus, /停止不会自动重启；点击“恢复本窗口”继续保留队列/);
  const resumeSection = app.match(/async function continueGptQueueFromUser\([\s\S]*?\n}\n\nfunction toggleGptQueueFromUser/)?.[0] || "";
  assert.match(resumeSection, /gptWindowWorkerPromises\.get\(accountId\)/);
  assert.match(resumeSection, /上一次停止正在安全收尾/);
  assert.match(resumeSection, /15_000/);
  assert.match(resumeSection, /already running/);
  assert.match(resumeSection, /reason: "stopping"/);
});

test("GPT worker recovers a healthy reloaded page whose old bridge task disappeared", () => {
  assert.match(app, /function createGptWorkflowHeartbeat\(task, accountId/);
  assert.match(app, /GPT_WORKFLOW_HEARTBEAT_LOST/);
  assert.match(app, /GPT_WORKFLOW_POST_SUBMIT_STALLED/);
  assert.match(app, /shouldRecoverStalledSubmittedWorkflow/);
  assert.match(workerStateSource, /POST_SUBMIT_IDLE_STALL_LIMIT_MS/);
  assert.match(workerStateSource, /POST_SUBMIT_GENERATION_STALL_LIMIT_MS/);
  assert.match(app, /GPT_PRE_SUBMIT_DISPATCH_GRACE_MS/);
  assert.match(app, /GPT_PRE_SUBMIT_DISPATCH_GRACE_MS = 180_000/);
  assert.match(app, /preSubmitDispatchStalled/);
  assert.match(app, /_dispatchStartedAt/);
  assert.match(app, /GPT 预发送桥接超过 180 秒未确认/);
  assert.match(app, /workflowHeartbeat\.lostPromise/);
  assert.match(app, /task\._webReconnectAttempts/);
  assert.match(app, /refreshGptWindowForAutomaticRecovery\(key, "workflow-heartbeat-lost"/);
  assert.match(app, /不会推进队列/);
  assert.match(desktopMain, /pendingGptTask/);
  assert.match(desktopMain, /abortPendingGptTask\(account/);
  assert.match(desktopMain, /GPT_PAGE_RELOADED/);
  assert.match(desktopPreload, /pageHealth\(accountId = ""\)/);
  assert.match(desktopMain, /desktop:gpt-page-health/);
  assert.match(desktopMain, /startedAt: String\(account\?\.pageState\?\.startedAt/);
  assert.match(app, /pageHealth\(accountId\)/);
  assert.match(desktopMain, /function scheduleStalledGptPageRecovery\(account\)/);
  assert.match(desktopMain, /gpt-page-load-stalled/);
  assert.match(desktopMain, /gpt-page-recovery-waiting/);
  assert.match(desktopMain, /不会要求手动重开/);
  assert.match(desktopMain, /gpt-read-channel-released-after-timeout/);
  assert.match(desktopMain, /function scheduleGptPageRecoveryReset\(account\)/);
  assert.match(desktopMain, /60_000/);
  assert.match(desktopMain, /loadRecoveryAttempts/);
  assert.match(app, /const pageStalled = health\?\.ok/);
  assert.match(app, /const pageStalled = health\?\.ok[\s\S]{0,160}!readiness\?\.productionReady/);
  assert.match(app, /lastStatusSignature/);
  assert.match(workerStateSource, /POST_SUBMIT_IDLE_STALL_LIMIT_MS/);
  assert.match(app, /Re-reading the same bridge payload is not a heartbeat/);
  assert.match(app, /shortStageStalled/);
  assert.match(app, /task\._status = userHeld \|\| task\._quotaLimit \? "paused" : "failed"/);
});

test("GPT heartbeat loss keeps the checkpoint queued and schedules automatic retry", () => {
  assert.match(app, /网页\/桥接暂态，等待自动续接/);
  assert.match(app, /reason: "heartbeat-retry-wait"/);
  assert.match(app, /scheduleGptWindowRetry\(key, 20_000, "网页\/桥接暂态，等待自动续接"\)/);
  assert.doesNotMatch(app, /正在第 \$\{task\._webReconnectAttempts\}\/2 次自动重接/);
});

test("GPT heartbeat does not cancel a healthy page on a stale short-stage read", () => {
  assert.match(app, /const stageStallRequiresRecovery = shortStageStalled[\s\S]{0,140}health\?\.ok === true[\s\S]{0,140}!pageHealthy[\s\S]{0,140}task\?\._submittedToGpt !== true/);
  assert.match(app, /!readiness\?\.productionReady/);
  assert.match(app, /pageStallRequiresRecovery = pageStalled[\s\S]{0,180}freshRootPreSubmitWithinBudget[\s\S]{0,120}previousPostIdleWithinBudget/);
  assert.match(app, /pageStallRequiresRecovery \|\| stageStallRequiresRecovery \|\| bridgeTaskLost/);
});

test("GPT heartbeat does not abort a submitted generation only because its first progress read is late", () => {
  assert.match(app, /const bridgeTaskLost = !previousPostIdleWithinBudget[\s\S]{0,260}![\s\S]*?lastStatus[\s\S]{0,260}task\?\._submittedToGpt !== true/);
  assert.match(app, /GPT can spend several minutes[\s\S]{0,80}generating the first image/);
  assert.match(app, /nextRetryAt: null,[\s\S]{0,120}lastError: ""/);
});

test("empty automatic window clears stale current-work progress", () => {
  const emptyQueueStart = app.indexOf("if (!await ensureGptWindowWorkerQueue(key, workerState, settings))");
  const emptyQueueBlock = app.slice(emptyQueueStart, app.indexOf("const recoveredRestartCheckpoint", emptyQueueStart));
  assert.ok(emptyQueueStart >= 0, "empty queue guard should exist");
  assert.match(emptyQueueBlock, /currentTaskId: ""/);
  assert.match(emptyQueueBlock, /currentPercent: 0/);
  assert.match(emptyQueueBlock, /expectedImages: 0/);
  assert.match(emptyQueueBlock, /nextRetryAt: null/);
});

test("restart recovery adopts each account conversation checkpoint before selecting fresh material", () => {
  assert.match(app, /async function restoreIndependentGptCheckpointAtStartup\(accountId\)/);
  assert.match(app, /restoreIndependentGptCheckpointAtStartup\(account\.id\)/);
  assert.match(app, /await Promise\.all\([\s\S]{0,500}restoreIndependentGptCheckpointAtStartup/);
  assert.match(app, /if \(recoverableGptConversationStage\(stage\)\)/);
  assert.match(app, /adoptRecoverableGptConversationCheckpoint\(key, state, inspection\)/);
  assert.match(app, /stage === "completed-copy-pending-package"/);
  assert.match(app, /adoptCompletedGptConversationCheckpoint\(key, state, inspection\)/);
  const startupRecoveryIndex = app.indexOf("const startupRecoveries = await Promise.all");
  const schedulerIndex = app.indexOf("scheduleContinuousGptProduction(1800)", startupRecoveryIndex);
  assert.ok(startupRecoveryIndex >= 0 && schedulerIndex > startupRecoveryIndex,
    "fresh material scheduling must start after durable checkpoint recovery");
});

test("fresh-session startup keeps the cursor on an empty ChatGPT composer instead of adopting history", () => {
  const start = app.indexOf("async function restoreIndependentGptCheckpointAtStartup");
  const end = app.indexOf("function isContinuousGptProductionArmed", start);
  const block = app.slice(start, end);
  assert.match(block, /const pendingFreshCursor = startupCursorTask\?\.taskType === "material"/);
  assert.match(block, /pendingFreshCursor && isEmptyFreshGptLiveBoundary\(inspection\)/);
  assert.match(block, /startupCursorTask\._submittedToGpt = false/);
  assert.match(block, /startupCursorTask\.navigation = "new-chat"/);
  assert.match(block, /persistGptWindowWorkerState\(key, state\);\s*return null;/);
  assert.match(block, /startupTaskIds\.includes\(requestId\)[\s\S]{0,120}itemConversationUrl === liveUrl/);
  assert.match(block, /const recoveryConversationUrl = canonicalGptConversationUrl/);
  assert.match(block, /if \(!recoveryConversationUrl\) return null/);
});

test("checkpoint adoption requires a canonical live GPT conversation", () => {
  const recoverStart = app.indexOf("async function adoptRecoverableGptConversationCheckpoint");
  const recoverEnd = app.indexOf("async function recoverCompletedGptConversationBeforeInjection", recoverStart);
  const recoverBlock = app.slice(recoverStart, recoverEnd);
  assert.match(recoverBlock, /const activeConversationUrl = canonicalGptConversationUrl/);
  assert.match(recoverBlock, /if \(!activeConversationUrl\) return null/);
  assert.match(recoverBlock, /recoveryCursorRequestIds\.has\(requestId\)[\s\S]{0,100}checkpointUrl === activeConversationUrl/);
  assert.match(recoverBlock, /conversationUrl: authoritativeCheckpointUrl \|\| activeConversationUrl/);

  const completedStart = app.indexOf("async function adoptCompletedGptConversationCheckpoint");
  const completedEnd = app.indexOf("async function adoptRecoverableGptConversationCheckpoint", completedStart);
  const completedBlock = app.slice(completedStart, completedEnd);
  assert.match(completedBlock, /const liveConversationUrl = canonicalGptConversationUrl/);
  assert.match(completedBlock, /if \(!liveConversationUrl\) return null/);
});

test("independent recovery telemetry uses the account worker task instead of the visible legacy queue", () => {
  const start = app.indexOf("function logGptReadinessRecoveryEvent(");
  const end = app.indexOf("function clearGptProductionReadinessRecovery", start);
  const section = start >= 0 && end > start ? app.slice(start, end) : "";
  assert.match(section, /const worker = gptWindowWorkerState\(key\)/);
  assert.match(section, /worker\?\.lastFailedTask/);
  assert.match(section, /worker\?\.queue\?\.\[/);
  assert.match(section, /key === String\(activeGptAccountId/);
});

test("quota or unavailable startup lanes do not block the other independent windows", () => {
  const start = app.indexOf("function eligibleGptStartupStaggerAccounts()");
  const end = app.indexOf("function gptStartupStaggerWorkWindowKey", start);
  const section = start >= 0 && end > start ? app.slice(start, end) : "";
  assert.match(section, /const runtime = readGptWindowRuntime\(account\.id\)/);
  assert.match(section, /\["login-required", "waiting-schedule"\]/);
  assert.match(section, /status === "waiting-quota"/);
  assert.match(section, /const quotaState = readGptCycleState\(account\.quotaGroup \|\| account\.id\)/);
  assert.match(section, /quotaState\.nextProbeAt/);
  assert.match(section, /first-launch chain/);
});

test("runtime hydration clears stale metrics for taskless waiting windows", () => {
  assert.match(app, /function normalizeGptWindowRuntimeEntry\(accountId, runtime = \{\}\)/);
  assert.match(app, /const hasCurrentTask = Boolean\(String\(merged\.currentTaskId \|\| ""\)\.trim\(\)\)/);
  assert.match(app, /isWaitingWithoutTask = !hasCurrentTask/);
  assert.match(app, /currentPercent: 0,[\s\S]{0,180}expectedImages: 0,[\s\S]{0,100}generatedImages: 0/);
  assert.match(app, /windowRuntime: filterContentInstanceRuntime\(Object\.fromEntries\(Object\.entries\(gptWindowRuntime/);
});

test("read-only preview runtime overrides stale local worker activity without changing Electron authority", () => {
  assert.match(app, /let gptReadOnlyRuntimeState = null/);
  assert.match(app, /function isReadOnlyGptPreview\(\)/);
  assert.match(app, /function readOnlyGptWindowWorkerState\(accountId = activeGptAccountId/);
  assert.match(app, /isGptRuntimeWriteAuthority\(\)\s*\|\|\s*!assigned\?\.size\s*\|\|\s*!gptReadOnlyRuntimeState\?\.control\?\.windowRuntime/);
  assert.match(app, /autoRunning: status === "running"/);
  assert.match(app, /gptReadOnlyRuntimeState = isGptRuntimeWriteAuthority\(\) \? null : remote/);
  assert.match(app, /const worker = readOnlyGptWindowWorkerState\(accountId, activeGptWindowWorkerState\(\)\)/);
  assert.match(app, /readOnlyGptWindowWorkerState\(key, gptWindowWorkerState\(key\)\)/);
});

test("read-only A-D preview never starts a GPT worker or promotes a stale promise to production", () => {
  assert.match(app, /if \(isReadOnlyGptPreview\(\)\) return;/);
  assert.match(app, /const readOnlyPreview = isReadOnlyGptPreview\(\)/);
  assert.match(app, /worker\.autoRunning === true \|\| \(!readOnlyPreview && gptWindowWorkerPromises\.has\(accountId\)\)/);
  assert.match(app, /const activeWorker = uiState\.worker/);
  assert.match(app, /active: uiState\.autoRunning/);
});

test("GPT page recovery probes live readiness before reloading a slow page", () => {
  const recoverySection = desktopMain.match(/function scheduleStalledGptPageRecovery\(account\)[\s\S]*?\n}\n\nfunction hideAllGptViews/)?.[0] || "";
  assert.match(recoverySection, /probeGptPageReadiness\(account, "recovery"/);
  assert.match(recoverySection, /gpt-page-recovery-suppressed/);
  assert.match(recoverySection, /isGptPageDocumentStable\(\{/);
  assert.match(recoverySection, /freshRootReady/);
  assert.match(recoverySection, /productionReady/);
  assert.match(recoverySection, /canRecreateStalledConversation/);
  assert.match(recoverySection, /gpt-page-recovery-recreate/);
  assert.match(recoverySection, /stalled-conversation-bridge/);
  assert.match(recoverySection, /const reload = plan\.action === "reloadIgnoringCache"[\s\S]*?\n\s*:\s*\(\) => contents\.reload\(\);/);
  assert.doesNotMatch(recoverySection, /const reload = plan\.action === "reloadIgnoringCache"[\s\S]*?\n\s*:\s*\(\) => contents\.loadURL\(targetUrl\);/);
  assert.match(recoverySection, /gpt-page-recovery-recreate-deferred/);
  assert.match(recoverySection, /reason: "stalled-navigation"/);
});

test("stale fresh-root pre-submit bridge can escalate after its finite budget", () => {
  assert.match(desktopMain, /GPT_PRE_SUBMIT_DISPATCH_GRACE_MS = 180_000/);
  assert.match(desktopMain, /freshRootPreSubmitRecoveryDue/);
  assert.match(desktopMain, /pendingRequest: pendingForEscalation/);
  assert.match(desktopMain, /startedAt: Date\.now\(\)/);
  assert.match(desktopMain, /pending\.submittedToGpt = true/);
});

test("native GPT recovery restores durable user holds before touching idle windows", () => {
  assert.match(desktopMain, /readRuntimeState/);
  assert.match(desktopMain, /gpt-production-runtime\.json/);
  assert.match(desktopMain, /function persistedGptUserHold\(accountId\)/);
  assert.match(desktopMain, /userRecoveryHold: persistedGptUserHold\(id\)/);
  assert.match(desktopMain, /if \(!account\.userRecoveryHold\) scheduleStalledGptPageRecovery\(account\)/);
  assert.match(desktopMain, /reason=user-hold/);
  assert.match(desktopMain, /if \(account\.userRecoveryHold\)[\s\S]{0,180}continue;/);
});

test("GPT idle view cleanup is account-scoped and never releases a busy production window", () => {
  const releaseSection = desktopMain.match(/ipcMain\.handle\("desktop:gpt-release-idle"[\s\S]*?\n}\);/)?.[0] || "";
  assert.doesNotMatch(releaseSection, /if \(productionTaskActive\) return/);
  assert.match(releaseSection, /const accountBusy = productionTaskAccounts\.has\(id\)/);
  assert.match(releaseSection, /Boolean\(account\.pendingGptTask\)/);
  assert.match(desktopMain, /gpt-view-released/);
});

test("GPT image polling bounds DOM scans to recent turns and defers full-document fallback", () => {
  assert.match(gptSidebar, /GPT_IMAGE_DETECTION_RECENT_TURN_LIMIT/);
  assert.match(gptSidebar, /function recentImageDetectionTurns\(/);
  assert.match(gptSidebar, /const detectionOptions = \{[\s\S]*?fullDocumentFallback: false/);
  assert.match(gptSidebar, /freshGeneratedImageUrls\(baselineUrls, detectionOptions\)/);
  assert.match(gptSidebar, /fullDocumentFallback === false/);
});

test("GPT production controls use short labels with delayed detailed tooltips", () => {
  assert.match(html, /id="gptRetryTaskBtn"[^>]*data-tooltip="[^"]+"[^>]*>重试当前步骤<\/button>/);
  assert.match(html, /id="gptSkipTaskBtn"[^>]*data-tooltip="[^"]+"[^>]*>跳过作品<\/button>/);
  assert.match(html, /id="gptReopenWindowBtn"[^>]*data-tooltip="[^"]+"[^>]*>重开当前窗口<\/button>/);
  assert.match(html, /id="gptResetTaskBtn"[^>]*data-tooltip="[^"]+"[^>]*>重做此作品<\/button>/);
  assert.match(html, /id="gptMoreRecovery"/);
  assert.match(html, /id="gptStatusNextAction"/);
  assert.match(app, /nextActionNode\.textContent = nextAction \? `下一步：\$\{nextAction\}`/);
  assert.match(html, /id="gptStopQueueBtn"[^>]*data-tooltip="[^"]+"[^>]*>停止本窗口<\/button>/);
      assert.match(app, /WORKBENCH_TOOLTIP_DELAY_MS = 3000/);
      assert.match(app, /bindWorkbenchDelayedTooltips\(\)/);
  assert.match(app, /getAttribute\?\.\("title"\)/);
  assert.match(app, /\[data-tooltip\], \[title\], button, select/);
  assert.match(css, /\.workbench-delayed-tooltip/);
});

test("GPT production progress separates the current stage from batch counts", () => {
  for (const id of ["gptProgressDetail", "gptCurrentTaskProgress", "gptCurrentStageProgress", "gptCurrentProgressEvidence", "gptBatchProgressSummary"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /src="\/gpt-progress-display\.js\?v=/);
  assert.match(app, /function gptBatchProgressCounts\(tracker = \{\}, currentTask = null\)/);
  assert.match(app, /function renderGptTaskProgress\(task = null, status = \{\}, tracker = \{\}, options = \{\}\)/);
  assert.match(app, /自动队列：全仓库持续生产 · 完成后自动补充下一套/);
  assert.match(app, /normalizeGptContinuousQueueStatus/);
  assert.match(app, /gptProgressDisplay\.appendDistinctTask\(materialTasks, materialCurrentTask\)/);
  assert.match(app, /gptProgressDisplay\.filterBatchMaterialTasks\(sourceTasks\)/);
  assert.match(app, /gptProgressDisplay\.isBatchMaterialTask\(currentTask\)/);
  assert.match(app, /progressContainer\.dataset\.progressMode = progressMode === "indeterminate"/);
  assert.match(app, /resolveMonotonicPercent/);
  assert.match(app, /GPT_PROGRESS_RETENTION_MS/);
  assert.match(app, /refreshRetention: false/);
  assert.doesNotMatch(app, /const overall = Math\.round\(\(\(gptTestQueueIndex/);
  assert.match(gptSidebar, /key: "prepare", label: "准备会话", start: 0, end: 10/);
  assert.match(gptSidebar, /key: "upload", label: "上传素材", start: 10, end: 20/);
  assert.match(gptSidebar, /key: "plan", label: "生成并确认计划", start: 20, end: 35/);
  assert.match(gptSidebar, /key: "images", label: "生图", start: 35, end: 65/);
  assert.match(gptSidebar, /key: "copy", label: "生成文案", start: 65, end: 75/);
  assert.match(gptSidebar, /key: "download", label: "下载图片", start: 75, end: 87/);
  assert.match(gptSidebar, /key: "package", label: "打包校验", start: 87, end: 95/);
  assert.match(gptSidebar, /key: "archive", label: "归档完成", start: 95, end: 100/);
  assert.match(gptSidebar, /progressCountLabel/);
  assert.match(gptSidebar, /progressMode: progress\.progressMode/);
  assert.match(gptSidebar, /shouldAutoClearComposerBoundary/);
  assert.match(gptSidebar, /autoClearComposerBoundary/);
  assert.match(css, /\.gpt-auto-progress\[data-progress-mode="indeterminate"\]/);
  assert.match(css, /@keyframes gpt-progress-pulse/);
  assert.doesNotMatch(css, /gpt-progress-indeterminate/);
  assert.doesNotMatch(css, /\.gpt-auto-progress\[data-progress-mode="indeterminate"\][^}]*transform: translateX/);
});

test("GPT recovery claims a conversation by full path or its exact material folder identity", () => {
  assert.match(app, /function findGptConversationOwnerTask\(inspection = \{\}, queue = gptTestQueue\)/);
  assert.ok(app.includes("const materialFolder = materialPath.split"));
  assert.ok(app.includes("当前素材文件夹：([^\\r\\n]+)"));
  assert.ok(app.includes("identities.some((identity) => materialText.includes(identity))"));
  assert.match(app, /inspection\?\.materialText/);
  assert.match(app, /resolveGptTaskConversationUrl\(candidate\)/);
  assert.match(app, /candidate\._submittedToGpt === true/);
  assert.match(gptSidebar, /findCompletedCopyBoundary/);
  assert.match(gptSidebar, /已阻止重复发送迁移计划/);
});

test("post-restart copy boundary can claim the current queue task from durable runtime identity", () => {
  const start = app.indexOf("async function recoverCompletedGptConversationBeforeInjection");
  const end = app.indexOf("function gptCurrentRecoveryTask", start);
  const block = app.slice(start, end);
  assert.match(block, /const runtime = readGptWindowRuntime\(key\)/);
  assert.match(block, /runtime\.currentTaskId/);
  assert.match(block, /inspectionConversationUrl/);
  assert.match(block, /const ownerTask = explicitOwnerTask \|\| findGptConversationOwnerTask\(inspection, queue\)[\s\S]*?runtimeOwnedTask/);
  assert.match(block, /下载\/归档|downloading\/archiving|download.*archive/i);
});

test("GPT recovery prefers the newest same-conversation production log and isolates superseded work", () => {
  assert.match(app, /const activeRecoveryEvents = new Set\(\[/);
  assert.match(app, /newestLoggedMaterial/);
  assert.match(app, /_recoveredFromLatestConversationLog: true/);
  assert.match(app, /SUPERSEDED_CONVERSATION_BOUNDARY/);
  assert.match(app, /_conversationLogOwnerConfirmed: true/);
  assert.match(app, /durableConversationLogOwner/);
  assert.match(app, /taskConversationUrl === activeConversationUrl/);
  assert.match(app, /accountWindowId: key/);
  assert.match(app, /const boundResumeConversationUrl = canonicalGptConversationUrl/);
  assert.match(app, /currentUrl === boundResumeConversationUrl/);
  assert.match(app, /task\._conversationLogOwnerConfirmed = true/);
});

test("runtime mirror carries finite step timing and wait deadlines", () => {
  assert.match(app, /const previousRuntime = readGptWindowRuntime\(key\)/);
  assert.match(app, /const nowIso = new Date\(\)\.toISOString\(\)/);
  assert.match(app, /nextPatch\.stageStartedAt = nowIso/);
  assert.match(app, /nextPatch\.lastProgressAt = nowIso/);
  assert.match(app, /previousRuntime\.lastProgressAt \|\| nextPatch\.lastProgressAt/);
  assert.match(app, /const progressFields = \[/);
  assert.match(app, /normalizedProgressValue/);
  assert.match(app, /progressFields\.some/);
  assert.doesNotMatch(app, /lastProgressAt: new Date\(\)\.toISOString\(\)/);
  assert.match(app, /deadlineAt: String\(status\.deadlineAt \|\| ""\)/);
  assert.match(app, /stepRemainingMs: Number\(status\.stepRemainingMs \|\| 0\)/);
  assert.match(app, /\["retry-wait", "waiting-startup-stagger", "waiting-quota", "waiting-schedule", "login-required"\]/);
  assert.match(app, /nextPatch\.nextActionAt = nextPatch\.deadlineAt/);
  assert.match(app, /nextPatch\.stepRemainingMs = nextPatch\.waitLimitMs/);
  assert.match(app, /nextPatch\.reason = String\(nextPatch\.lastError \|\| nextPatch\.currentStage/);
  assert.match(app, /nextPatch\.stageElapsedMs = Math\.max\(0, Date\.now\(\) - stageStartMs\)/);
  assert.match(app, /nextPatch\.elapsedMs = nextPatch\.stageElapsedMs/);
  assert.match(app, /nextPatch\.deadlineAt = new Date\(waitUntil\)\.toISOString\(\)/);
  assert.match(gptSidebar, /workflowStepHistory/);
  assert.match(gptSidebar, /deadlineAt: timing\.deadlineAt/);
  assert.match(gptSidebar, /elapsedMs: timing\.elapsedMs/);
});

test("workflow step deadline rejects even when a bridge promise never settles", () => {
  assert.match(gptSidebar, /const deadlinePromise = new Promise\(\(_, reject\) =>/);
  assert.match(gptSidebar, /const value = await Promise\.race\(\[/);
  assert.match(gptSidebar, /(?:step-deadline-exceeded|workflow-deadline-exceeded)/);
  assert.match(gptSidebar, /task\.controller\?\.abort\(\)/);
});

test("startup stagger has a polling fallback after its one-shot wake timer", () => {
  assert.match(app, /const GPT_STARTUP_STAGGER_POLL_MS = 30_000/);
  assert.match(app, /const gate = refreshGptStartupStaggerWake\(\)/);
  assert.match(app, /if \(!gate\) scheduleContinuousGptProduction\(0\)/);
  assert.match(app, /window\.setInterval\(\(\) => \{[\s\S]*?GPT_STARTUP_STAGGER_POLL_MS/);
});

test("startup stagger clears stale recovery state and cannot replay an exhausted task", () => {
  const recoveryStart = app.indexOf("function scheduleGptWindowRetry");
  const recoveryEnd = app.indexOf("function logGptReadinessRecoveryEvent", recoveryStart);
  const recoveryBlock = app.slice(recoveryStart, recoveryEnd);
  assert.match(recoveryBlock, /startup-stagger-boundary/);
  assert.match(recoveryBlock, /windowRecoveryAttempts: 0/);
  assert.match(recoveryBlock, /scheduleGptStartupStaggerWake/);
  const schedulerStart = app.indexOf("function scheduleContinuousGptProduction");
  const schedulerEnd = app.indexOf("function singleAccountQuotaAutoSwitchEnabled", schedulerStart);
  const schedulerBlock = app.slice(schedulerStart, schedulerEnd);
  assert.match(schedulerBlock, /status: "waiting-startup-stagger"[\s\S]*?windowRecoveryTaskId: null/);
});

test("startup stagger never blocks a submitted material checkpoint", () => {
  const start = app.indexOf("const resumableCurrentTask = Boolean(");
  const end = app.indexOf("const hasLiveWorker = gptWindowWorkerPromises.has(key);", start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /durableCurrentTask\._submittedToGpt === true/);
  assert.match(block, /durableCurrentTask\.workflow\?\.planSubmitted === true/);
  assert.match(block, /reason: "resume-existing-checkpoint"/);
});

test("startup reconciliation also resumes a submitted material checkpoint", () => {
  const start = app.indexOf("async function reconcileGptWindow");
  const end = app.indexOf("async function switchGptAccount", start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /const durableCurrentTask = workerState\.queue\?\.\[workerState\.queueIndex\]/);
  assert.match(block, /durableCurrentTask\._submittedToGpt === true/);
  assert.match(block, /durableCurrentTask\.workflow\?\.planSubmitted === true/);
  assert.match(block, /reason: "resume-existing-checkpoint"/);
});

test("startup stagger does not consume a launch slot outside the work window", () => {
  const timerStart = app.indexOf("const timer = setTimeout(async () => {");
  const timerEnd = app.indexOf("gptWindowWorkerTimers.set(key, timer);", timerStart);
  assert.ok(timerStart >= 0 && timerEnd > timerStart);
  const timerBlock = app.slice(timerStart, timerEnd);
  assert.match(timerBlock, /const workWindow = getGptContinuousWorkWindow\(new Date\(\), gptWindowSettings\(key\)\)/);
  assert.match(timerBlock, /status: "waiting-schedule"/);
  assert.ok(timerBlock.indexOf("markGptStartupLaunched(key)") > timerBlock.indexOf("if \(!workWindow.allowed\)"));
});

test("continuous scheduler checks work hours before progressive launch and stagger", () => {
  const schedulerStart = app.indexOf("function scheduleContinuousGptProduction");
  const progressiveIndex = app.indexOf("const progressiveGate = progressiveGptLaunchGate(key);", schedulerStart);
  const workWindowIndex = app.indexOf("const workWindow = getGptContinuousWorkWindow(new Date(), settings);", schedulerStart);
  const staggerIndex = app.indexOf("gptStartupStaggerGate(key);", schedulerStart);
  assert.ok(schedulerStart >= 0);
  assert.ok(workWindowIndex > schedulerStart && workWindowIndex < progressiveIndex);
  assert.ok(workWindowIndex < staggerIndex);
  assert.match(app.slice(workWindowIndex, progressiveIndex), /status: "waiting-schedule"/);
});

test("settings center keeps one visible module switch and folds advanced assistant controls", () => {
  assert.match(html, /<details class="settings-card assistant-settings-card settings-advanced-card" id="assistantSettingsCard">/);
  assert.match(html, /id="assistantSettingsCard"[\s\S]*settings-summary-switch[\s\S]*id="assistantCatVisible"/);
  assert.match(html, /id="assistantSettingsCard"[\s\S]*id="assistantNotificationsEnabled"/);
  assert.match(html, /<details class="settings-card version-card settings-advanced-card" id="settingsVersionSection">/);
  assert.match(html, /data-settings-jump="version">系统与维护<\/button>/);
  assert.match(app, /settingsCard\?\.matches\("details"\)[\s\S]*settingsCard\.open = true/);
  assert.match(css, /\.assistant-settings-grid\s*\{[\s\S]*?gap:\s*6px 12px;[\s\S]*?margin-top:\s*10px;/);
  assert.match(css, /\.assistant-settings-grid \.switch-setting\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 36px/);
  assert.match(css, /\.assistant-settings-grid \.switch-setting input\[type="checkbox"\]\s*\{[\s\S]*?width:\s*36px[\s\S]*?height:\s*20px/);
});

test("shared controls expose visible pressed, focus and selected feedback", () => {
  assert.match(css, /button:not\(:disabled\):active[\s\S]*?transform:\s*translateY\(1px\) scale\(\.985\)/);
  assert.match(css, /button:not\(:disabled\):focus-visible[\s\S]*?outline:\s*2px solid/);
  assert.match(css, /\[role="tab"\]\[aria-selected="true"\]/);
  assert.match(css, /\[aria-pressed="true"\]/);
  assert.match(css, /\.system-dialog footer button:focus-visible[\s\S]*?outline:\s*3px solid/);
  assert.match(app, /tab\.setAttribute\("aria-selected", String\(isActive\)\)/);
  assert.match(app, /function showDistributionPanel\(panel\)/);
});

test("Electron runs a three-hour work-hour-gated disposable web-cache cleanup without clearing account storage", () => {
  assert.match(temporaryWebCacheSchedule, /TEMPORARY_WEB_CACHE_INTERVAL_MS = 3 \* 60 \* 60 \* 1000/);
  assert.match(temporaryWebCacheSchedule, /TEMPORARY_WEB_CACHE_STARTUP_GRACE_MS = 60 \* 1000/);
  assert.match(desktopMain, /function startTemporaryWebCacheCleanup\(\)/);
  assert.match(desktopMain, /planTemporaryWebCacheCleanup/);
  assert.match(desktopMain, /temporaryWebCacheCleanupStartupGraceUntil/);
  assert.match(temporaryWebCacheSchedule, /outside-work-hours/);
  assert.match(temporaryWebCacheSchedule, /production-active/);
  assert.match(desktopMain, /profileSession\.clearCache\(\)/);
  assert.match(desktopMain, /Never call clearStorageData\(\) here/);
  assert.match(desktopMain, /startTemporaryWebCacheCleanup\(\)/);
});

test("GPT three-hour cache maintenance respects each window and the 02:00 work boundary", () => {
  assert.match(app, /const GPT_TEMPORARY_CACHE_INTERVAL_MS = 3 \* 60 \* 60 \* 1000/);
  assert.match(app, /function nextGptTemporaryCacheAllowedAt\(accountId, requestedAt = Date\.now\(\)\)/);
  assert.match(app, /const nextAt = Math\.max\(now \+ 1000, nextGptTemporaryCacheAllowedAt\(key, requestedTarget\)\)/);
  assert.match(app, /const workerBusy = gptWindowRefreshInFlight\.has\(key\)[\s\S]*?gptWindowWorkerPromises\.has\(key\)[\s\S]*?workerState\.autoRunning === true/);
  assert.match(app, /const hasPendingWorkerTask = typeof window\.GptWindowWorkerState\?\.hasPending === "function"/);
  assert.match(app, /\|\| hasPendingWorkerTask/);
  assert.match(app, /reason: "outside-work-hours"/);
  assert.match(app, /reason: "window-running"/);
  assert.match(desktopMain, /account\.session\.clearCache\(\)/);
  assert.match(desktopMain, /Never call clearStorageData\(\) here/);
});

test("GPT 自动生产设置的全局子组使用紧凑两列且标题跨列", () => {
  assert.match(css, /#gptAutoPageSettings \.global-specific-group \.settings-sub-group\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)/);
  assert.match(css, /#gptAutoPageSettings \.global-specific-group \.settings-sub-group > \.settings-inline-heading\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);
  assert.match(css, /#gptAutoPageSettings \.global-specific-group \.settings-sub-group \+ \.settings-sub-group\s*\{[\s\S]*?border-top/);
});

test("mode quick-tabs use shortNames consistent with GPT_MODE_DEFINITIONS and dropdown", () => {
  assert.match(html, /data-mode="manual"[^>]*role="tab"><span>人工<\/span>/);
  assert.match(html, /data-mode="automatic"[^>]*role="tab"><span>选材后<\/span>/);
  assert.match(html, /data-mode="single"[^>]*role="tab"><span>单账号<\/span>/);
  assert.match(html, /data-mode="scheduled"[^>]*role="tab"><span>定时<\/span>/);
  assert.doesNotMatch(html, /data-mode="rotate"[^>]*role="tab"><span>多账号<\/span>/);
  assert.match(html, /data-mode="patrol"[^>]*role="tab"><span>巡检<\/span>/);
  assert.doesNotMatch(html, /data-mode="semi-auto"[^>]*class="mode-quick-tab"/);
  assert.match(app, /shortName: "人工"/);
  assert.match(app, /shortName: "选材后"/);
  assert.match(app, /shortName: "单账号"/);
  assert.match(app, /shortName: "定时"/);
  assert.doesNotMatch(app, /shortName: "多账号"/);
  assert.match(app, /shortName: "巡检"/);
});

test("status badge uses English CSS class keys via BADGE_CLASS_KEY mapping", () => {
  assert.match(app, /BADGE_CLASS_KEY/);
  assert.match(app, /badge-\$\{BADGE_CLASS_KEY\[productionStatus\.code\] \|\| "idle"\}/);
  assert.match(css, /\.gpt-status-badge\.badge-running/);
  assert.match(css, /\.gpt-status-badge\.badge-ready/);
  assert.match(css, /\.gpt-status-badge\.badge-pending/);
  assert.match(css, /\.gpt-status-badge\.badge-confirm/);
  assert.match(css, /\.gpt-status-badge\.badge-paused/);
  assert.match(css, /\.gpt-status-badge\.badge-quota/);
  assert.match(css, /\.gpt-status-badge\.badge-restored/);
  assert.doesNotMatch(css, /badge-运行中/);
  assert.doesNotMatch(css, /badge-待发送/);
  assert.doesNotMatch(css, /badge-暂停中/);
});

test("production history button lives in heading actions not queue actions", () => {
  const headingMatch = html.match(/gpt-production-test-actions[\s\S]*?<\/div>/);
  assert.ok(headingMatch, "heading actions area must exist");
  assert.match(headingMatch[0], /id="gptProductionHistoryBtn"/);
  const queueMatch = html.match(/class="gpt-queue-actions"[\s\S]*?<\/div>/);
  assert.ok(queueMatch, "queue actions area must exist");
  assert.doesNotMatch(queueMatch[0], /gptProductionHistoryBtn/);
});

test("automatic mode resumes only the remaining queue after a quota probe, never refills new material", () => {
  const resumeIdx = app.indexOf("async function resumeGptQueueAfterQuotaProbe");
  assert.ok(resumeIdx >= 0, "resumeGptQueueAfterQuotaProbe must exist");
  const resumeSection = app.slice(resumeIdx, resumeIdx + 2400);
  // manual 模式不自动恢复
  assert.match(resumeSection, /if \(gptAutoSettings\.mode === "manual"\) return/);
  // 补充素材只在 continuous 模式，automatic 只续剩余队列
  assert.match(resumeSection, /if \(!hasPendingQueue && isContinuousGptMode\(\)\)\s*\{\s*hasPendingQueue = Boolean\(await prepareAutoGptQueue/);
});

test("quota waiting still schedules read-only reconciliation for a completed package boundary", () => {
  const scheduleIdx = app.indexOf("function scheduleContinuousGptProduction");
  const section = app.slice(scheduleIdx, scheduleIdx + 12_000);
  assert.match(section, /quota wait blocks only a fresh upload\/generation attempt/);
  assert.match(section, /scheduleGptQuotaConversationReconciliation\(key, Math\.min\(15_000/);
  assert.doesNotMatch(section, /if \(!conversationBoundaryFailed\)\s*\{\s*scheduleGptQuotaConversationReconciliation/);
});
test("restart restores quota timers with an immediate read-only conversation reconciliation", () => {
  const restoreIdx = app.indexOf("function restoreGptQuotaProbeTimers");
  assert.ok(restoreIdx >= 0, "restoreGptQuotaProbeTimers must exist");
  const section = app.slice(restoreIdx, restoreIdx + 2200);
  assert.match(section, /scheduleGptQuotaReminder\(/);
  assert.match(section, /independentGptWindowMode\(gptWindowSettings\(account\.id\)\.mode\)/);
  assert.match(section, /scheduleGptQuotaConversationReconciliation\(account\.id, 15_000\)/);
  assert.match(section, /must still inspect the already-open conversation now/);
});
test("continuous single-account scheduling clears only the stale legacy queue pause mirror", () => {
  const scheduleIdx = app.indexOf("function scheduleContinuousGptProduction");
  const section = app.slice(scheduleIdx, scheduleIdx + 1_000);
  assert.match(section, /if \(isContinuousGptMode\(\) && !gptAutoPaused\)/);
  assert.match(section, /gptQueuePaused = false;/);
  assert.match(section, /gptQuotaPauseStatus = "";/);
  assert.match(section, /per-window worker\/runtime state/);
});
test("automatic bridge cancellation is not mislabeled as a user stop", () => {
  const uploadIdx = app.indexOf("const userStopped = result?.userStopped === true");
  assert.ok(uploadIdx >= 0, "upload result must use explicit user-stop evidence");
  const section = app.slice(uploadIdx, uploadIdx + 520);
  assert.doesNotMatch(section, /result\?\.status === "cancelled"/);
  assert.match(section, /result\?\.errorCode === "USER_STOPPED_BY_USER"/);
  assert.match(section, /workerState\.stoppedByUser === true/);
});
test("automatic recovery stop commands carry a non-user reason through Electron and the extension", () => {
  assert.match(desktopPreload, /stopCurrentTask\(accountId = "", requestId = "", options = \{\}\)/);
  assert.match(desktopPreload, /userInitiated: stopOptions\.userInitiated !== false/);
  assert.match(app, /stopCurrentTask\?\.\(accountId, requestId, \{[\s\S]*?reason: "heartbeat-recovery"/);
  assert.match(gptSidebar, /const userInitiated = message\.userInitiated !== false/);
  assert.match(gptSidebar, /task\.stopRequested = userInitiated/);
  assert.match(gptSidebar, /GPT_AUTOMATIC_RECOVERY_ABORTED/);
  assert.match(app, /"GPT_AUTOMATIC_RECOVERY_ABORTED"/);
});
test("restart recovery releases only stale automatic stop markers, never a real user hold", () => {
  assert.match(app, /function releaseStaleAutomaticStopCheckpoint\(workerState\)/);
  assert.match(app, /String\(task\._errorCode \|\| ""\) !== "USER_STOPPED_BY_USER"/);
  assert.match(app, /workerState\.stoppedByUser === true/);
  assert.match(app, /runtime\.stoppedByUser === true/);
  assert.match(app, /task\._status = "queued"/);
  assert.match(app, /const releasedStaleAutomaticStop = releaseStaleAutomaticStopCheckpoint\(workerState\)/);
});
test("stop button resets gptAutoRunning so mode switch works after stopping", () => {
  assert.match(app, /\$\("#gptStopQueueBtn"\)\?\.addEventListener\("click", async \(\) =>/);
  assert.match(app, /gptAutoPaused = true;[\s\S]*?gptQueuePaused = true;[\s\S]*?gptAutoRunning = false;/);
});

test("an explicit mode switch suspends a stale rotation run and preserves the paused queue", () => {
  const modeChange = app.match(/const handleGptModeChange = \(event\) => \{([\s\S]*?)\r?\n\s*\};\r?\n\s*\$\("#gptProductionMode"\)/)?.[1] || "";
  assert.match(modeChange, /rotationRunAfterModeSwitch/);
  assert.match(modeChange, /persistGptMultiRun/);
  const settingsChange = app.match(/\[\s*"#gptProductionMode",([\s\S]*?)\$\("#gptAccountTabs"\)/)?.[1] || "";
  assert.doesNotMatch(settingsChange, /gptTestQueue\s*=\s*\[\]/);
  assert.doesNotMatch(settingsChange, /gptTestQueueIndex\s*=\s*0/);
});

test("switching or reattaching an account resumes recoverable pauses but respects explicit user holds", () => {
  const reconcileSection = app.match(/async function reconcileGptWindow[\s\S]*?\r?\n}\r?\n\r?\nasync function switchGptAccount/)?.[0] || "";
  assert.match(reconcileSection, /if \(workerState\.queuePaused && !options\.force && !gptWindowAutoStartAllowed\(key\)\) return false;/);
  assert.match(reconcileSection, /if \(runtime\.stoppedByUser && !options\.force\) return false;/);
  assert.match(reconcileSection, /if \(runtime\.pausedByUser && !options\.force\) return false;/);
});

test("startup clears stale continuous arming when the restored mode is not continuous", () => {
  assert.match(app, /gptAccounts\.forEach\(\(account\) => \{[\s\S]*?gptWindowWorkerState\(key\)[\s\S]*?independentGptWindowMode\(settings\.mode\)[\s\S]*?state\.armed = true[\s\S]*?scheduleContinuousGptProduction\(1800\);/);
});

test("restart button clears both queue pause flags before reconciling", () => {
  const restartSection = app.match(/if \(runtime\.stoppedByUser\) \{([\s\S]*?)\r?\n\s*return;\r?\n\s*\}/)?.[1] || "";
  assert.match(restartSection, /(?:gptAutoPaused = false;|workerState\.autoPaused = false;)/);
  assert.match(restartSection, /(?:gptQueuePaused = false;|workerState\.queuePaused = false;)/);
  assert.match(restartSection, /reconcileGptWindow\(accountId, \{ force: true \}\)/);
});

test("missing GPT plan is an integrity boundary that never advances to the next material", () => {
  assert.match(gptSidebar, /error\.code = "PLAN_NOT_READY"/);
  assert.match(app, /"PLAN_NOT_READY"/);
});

test("a stale previous-post boundary pauses rotation instead of skipping the selected material", () => {
  const integritySet = app.match(/const integrityBoundaryCodes = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
  assert.match(integritySet, /"WINDOW_STAGE_PENDING"/);
  assert.match(app, /integrityBoundaryCodes\.has[\s\S]*task\._status = "paused"/);
});

test("material archive confirmation has a bounded wait and remains an integrity boundary", () => {
  assert.match(gptSidebar, /ARCHIVE_CONFIRMATION_TIMEOUT/);
  assert.match(gptSidebar, /Promise\.race\(\[archiveRequest, archiveTimeout\]\)/);
  const integritySet = app.match(/const integrityBoundaryCodes = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
  assert.match(integritySet, /"ARCHIVE_CONFIRMATION_TIMEOUT"/);
});

test("plan parse retry resumes the existing web plan without reuploading attachments", () => {
  assert.match(app, /planParseBoundary\s*=\s*Boolean\(failedTask\.workflow\?\.planSubmitted\)/);
  assert.match(app, /if \(planParseBoundary\)[\s\S]*failedTask\.workflow\s*=\s*failedTask\.workflow\s*\|\|\s*\{\}/);
  assert.match(app, /if \(planParseBoundary\)[\s\S]*failedTask\.workflow\.planSubmitted\s*=\s*true/);
  assert.match(app, /if \(planParseBoundary\)[\s\S]*failedTask\.forceUpload\s*=\s*false/);
  assert.match(app, /if \(planParseBoundary\)[\s\S]*failedTask\._submittedToGpt\s*=\s*true/);
  assert.match(desktopMain, /resumePlanSubmitted:\s*Boolean\(task\.workflow\?\.planSubmitted\)/);
  assert.match(gptSidebar, /resumePlanSubmitted[\s\S]{0,500}workflow\.planSubmitted\s*=\s*true/);
});

test("an unsent current-task plan draft cannot be resumed as a submitted workflow", () => {
  const uploadHandlerStart = gptSidebar.indexOf("async function handleUploadMaterial()");
  const waitPlanStart = gptSidebar.indexOf("async function handleWaitPlan()", uploadHandlerStart);
  const uploadHandler = gptSidebar.slice(uploadHandlerStart, waitPlanStart);
  const submitIndex = uploadHandler.indexOf("await submitComposer();");
  const markSubmittedIndex = uploadHandler.indexOf("workflow.planSubmitted = true;", submitIndex);
  assert.ok(submitIndex >= 0 && markSubmittedIndex > submitIndex,
    "planSubmitted must be persisted only after the composer send succeeds");
  assert.match(gptSidebar, /const pendingComposerDraft = composerDraftText\(\)/);
  assert.match(gptSidebar, /const pendingDraftBelongsToThisTask = isAutomationDraft\(pendingComposerDraft, entry\)/);
  assert.match(gptSidebar, /const currentPlanTurnAlreadySent = Boolean\(latestUserTurn/);
  assert.match(gptSidebar, /pendingDraftBelongsToThisTask[\s\S]{0,260}!currentPlanTurnAlreadySent/);
  assert.match(gptSidebar, /entry\.forceUpload = true/);
  assert.match(gptSidebar, /清理旧检查点后重新上传/);
  assert.match(gptSidebar, /pendingPlanIsAutomation/);
  assert.match(gptSidebar, /livePlanAlreadySent/);
  assert.match(gptSidebar, /自动提示词均已在输入框；已真实发送一次/);
  assert.match(gptSidebar, /UNSENT_PLAN_CHECKPOINT/);
  assert.match(gptSidebar, /!workflow\.planSubmitted && attachmentPreviewCount\(\) > 0/);
});

test("renderer restart forwards the durable workflow checkpoint before sending a recovered task", () => {
  assert.match(app, /task\.workflow\s*=\s*TBGptAccountRotation\.resumedWorkflowState\(/);
  assert.match(app, /TBGptAccountRotation\.resumedWorkflowState\([\s\S]{0,240}readGptWindowRuntime\(account\.id\)/);
  assert.match(app, /if \(resumeOwnedConversation\) \{[\s\S]{0,180}task\.workflow\s*=\s*TBGptAccountRotation\.resumedWorkflowState/);
  assert.match(gptSidebar, /retryingActiveImageGeneration/);
  assert.match(gptSidebar, /!retryingActiveImageGeneration/);
});

test("post-plan retry keeps the full workflow instead of only the submitted flag", () => {
  assert.match(gptSidebar, /retryTask\.workflow\s*=\s*\{[\s\S]{0,180}JSON\.parse\(JSON\.stringify\(message\.workflow\)\)/);
  assert.match(gptSidebar, /workflow:\s*message\.workflow\s*&&\s*typeof message\.workflow === "object"/);
  assert.match(gptSidebar, /workflow\.imageSubmitted === true[\s\S]{0,180}workflow\.planDone = true/);
});

  test("same-material conversation log can restore a complete image and copy boundary", () => {
  assert.match(app, /async function hydrateGptWorkflowFromConversationLog\(queue = \[\], accountId = ""\)/);
  assert.match(app, /\["images-detected", "images-detection-decision", "live-image-boundary-adopted"\]\.includes\(String\(entry\?\.event \|\| ""\)\)/);
  assert.match(app, /\[\"copy-requested\", \"copy-recovery-sent\"\]\.includes\(String\(entry\.event/);
  assert.match(app, /recoveryBoundaryConfirmed: true/);
  assert.match(app, /hydratedFromConversationLog = await hydrateGptWorkflowFromConversationLog/);
    assert.match(gptSidebar, /workflow\.recoveryBoundaryConfirmed !== true/);
  });

  test("conversation-log hydration preserves a completion reconciled immediately before it", () => {
    assert.match(app, /Completion reconciliation runs immediately before this hydration pass/);
    assert.match(app, /task\._status \|\| ""\)\)\) continue;/);
  });

  test("conversation-log recovery tolerates a busy local API", () => {
    assert.match(app, /conversation-log\?limit=400[\s\S]{0,220}15_000/);
    assert.match(app, /conversation-log\?limit=200[\s\S]{0,220}15_000/);
  });

  test("live image, copy, and archive boundaries cannot be adopted by another material", () => {
  assert.match(gptSidebar, /function assertLiveAutomationBoundaryMatchesEntry\(boundary, entry, step = "workflow", options = \{\}\)/);
  assert.match(gptSidebar, /function durableRecoveryConversationMatchesEntry\(entry\)/);
  assert.match(gptSidebar, /entry\?\.conversationOwnerConfirmed === true/);
  assert.match(gptSidebar, /canonicalConversationUrl\(entry\?\.conversationUrl\)/);
  assert.match(gptSidebar, /canonicalConversationUrl\(location\.href\)/);
  assert.match(gptSidebar, /if \(options\.allowDurableLabelDrift !== false && durableRecoveryConversationMatchesEntry\(entry\)\) return;/);
  assert.match(gptSidebar, /error\.code = "CONVERSATION_OWNER_MISMATCH"/);
  assert.match(gptSidebar, /assertLiveAutomationBoundaryMatchesEntry\(liveAutomationBoundary, task\.entry, "生图检查点恢复"\)/);
  assert.match(gptSidebar, /assertLiveAutomationBoundaryMatchesEntry\(liveCopyBoundary, task\.entry, "文案检查点恢复"\)/);
  assert.match(gptSidebar, /assertLiveAutomationBoundaryMatchesEntry\(liveArchiveBoundary, task\.entry, "归档"\)/);
  assert.match(desktopMain, /conversationUrl: String\(task\.conversationUrl \|\| task\.browserConversationUrl \|\| ""\)/);
  assert.match(desktopMain, /conversationOwnerConfirmed: task\._conversationLogOwnerConfirmed === true/);
  });

test("stale archived material paths cannot leave an automatic window running", () => {
    assert.match(app, /"MATERIAL_PATH_INVALID"/);
    assert.match(app, /素材当前不可进入生产，已隔离并继续队列/);
    assert.match(app, /safelySkippedStaleOwnerCodes[\s\S]*MATERIAL_REVIEW_REQUIRED/);
    assert.match(app, /safelySkippedStaleOwnerCodes\.has\(String\(ownerTask\._errorCode/);
    assert.match(app, /staleUnownedWorkflowBoundary[\s\S]*"waiting-copy"/);
});

test("download recovery refreshes the same GPT file identity after a restart", () => {
  assert.match(gptSidebar, /image-url-refreshed-for-download/);
  assert.match(gptSidebar, /freshGeneratedImageUrls\(\[\], \{[\s\S]{0,120}fullDocumentFallback: true/);
  assert.match(gptSidebar, /generatedImageIdentity\(candidate\) === generatedImageIdentity\(url\)/);
  assert.doesNotMatch(gptSidebar, /refreshedUrls\[index\]/);
});

test("download save treats an already-existing same-batch image as idempotent", () => {
  assert.match(gptSidebar, /同批次图片已经存在\|图片已经存在\|already exists/);
  assert.match(gptSidebar, /return filename;/);
});

test("GPT image downloads have a bounded fetch timeout before same-file refresh", () => {
  assert.match(gptSidebar, /async function fetchImageWithTimeout\(url, timeoutMs = 45_000\)/);
  assert.match(gptSidebar, /GPT_IMAGE_DOWNLOAD_TIMEOUT/);
  assert.match(gptSidebar, /const response = await fetchImageWithTimeout\(url\)/);
});

test("missing GPT response retries the current attachment turn before pausing", () => {
  assert.match(gptSidebar, /guardImageRecoveryAgainstCopyBoundary/);
  assert.match(gptSidebar, /shouldBlockImageRecoveryAfterCopyBoundary/);
  assert.match(gptSidebar, /partial-image-recovery-suppressed/);
  assert.match(gptSidebar, /copy-boundary-material-mismatch/);
  assert.match(gptSidebar, /COPY_IMAGE_HYDRATION_WAIT/);
  assert.match(gptSidebar, /afterTurn:/);
  assert.match(gptSidebar, /请继续处理我上一条已上传的全部附件/);
  assert.match(gptSidebar, /plan-recovery-sent/);
  assert.match(gptSidebar, /generating:\s*generatingNow\(\)[\s\S]*?recovery\.action === "wait-current"[\s\S]*?保持原帖等待，不追加恢复提示/);
  assert.match(gptSidebar, /partialRecovery\.action === "continue-missing"[\s\S]*?partial-image-recovery-sent[\s\S]*?图片没有补齐/);
  assert.match(gptSidebar, /mergePartialImageRecovery\([\s\S]*?accumulated:\s*imageUrls[\s\S]*?detected:\s*imageDetection\.urls/);
  assert.match(gptSidebar, /generatedBaselineUrls:\s*workflow\.generatedBaselineUrls/);
  assert.match(gptSidebar, /existingGeneratedImageUrls\s*=\s*uniqueGeneratedImageUrls\(workflow\.generatedImageUrls/);
  assert.match(gptSidebar, /liveImageUrls\.length\s*>=\s*existingGeneratedImageUrls\.length/);
  assert.match(gptSidebar, /recoveryBaselineKeys/);
  assert.match(gptSidebar, /IMAGE_RECOVERY_BOUNDARY_MISSING/);
  assert.match(gptSidebar, /hasLiveImageBoundary/);
  assert.match(gptSidebar, /if\s*\(!hasLiveImageBoundary\)[\s\S]{0,300}recovery-image-boundary-missing/);
  assert.match(gptSidebar, /boundaryRecoveryRequest\s*=\s*Boolean\(message\.autoRun\s*\|\|\s*retryOf\)/);
  assert.match(gptSidebar, /state\.boundaryPaused\s*&&\s*!forceUpload\s*&&\s*!autoClearComposerBoundary/);
  assert.doesNotMatch(gptSidebar, /imageUrlsFromLatestConfirmedBatch\(conversationRoleTurns\(\)\.map/);
});

test("forced fresh upload ignores the previous archived page boundary", () => {
  assert.match(gptSidebar, /const forceFreshWorkflow = Boolean\(task\.entry\?\.forceUpload\)/);
  assert.match(gptSidebar, /const workflow = forceFreshWorkflow\s*\n\s*\? \(task\.workflow = \{\}\)/);
  assert.match(gptSidebar, /const snapshotIsPostPlan = !forceFreshWorkflow && !livePlanConfirmationBoundary && \[/);
  assert.match(gptSidebar, /if \(!forceFreshWorkflow && !workflow\.planDone && \(snapshotIsPostPlan/);
});

test("a settled short plan response enters recovery without waiting for the full plan timeout", () => {
  assert.match(gptSidebar, /const incompletePlanSettled\s*=\s*Boolean\(/);
  assert.match(gptSidebar, /plannedImageCountReady\s*\|\|\s*incompletePlanSettled/);
});

test("continuous production fresh-retries and defers an unresponsive plan without stopping the queue", () => {
  assert.match(app, /recoverContinuousPlanFailure/);
  assert.match(app, /_planFreshRetryCount/);
  assert.match(app, /_planRecoveryDeferrals/);
  assert.match(app, /gptTestQueue\.splice\(deferIndex, 0, deferredTask\)/);
});

test("extension hot reload is deferred while any GPT task is active", () => {
  assert.match(desktopMain, /activeGptTaskAccounts/);
  assert.match(desktopMain, /extensionReloadPending/);
  assert.match(desktopMain, /gpt-extension-auto-reload-deferred/);
  assert.match(desktopMain, /removeExtension\(extensionId\)/);
  assert.match(desktopMain, /loadExtension\(extensionPath, \{ allowFileAccess: true \}\)/);
  assert.match(desktopMain, /gpt-extension-registered/);
});

test("extension hot reload rechecks task ownership immediately before navigation", () => {
  assert.match(desktopMain, /reason=task-started-during-reload/);
  assert.match(desktopMain, /activeGptTaskAccounts\.has\(id\) \|\| account\.pendingGptTask/);
});

test("a verified package still completes source archive after a stale task abort", () => {
  assert.match(gptSidebar, /const postPackageBoundaryComplete = \["move-archive", "package-archive"\]/);
  assert.match(gptSidebar, /if \(!postPackageBoundaryComplete\) throwIfTaskAborted\(task\)/);
  assert.match(gptSidebar, /workflow\.packageResult\?\.packagePath \|\| workflow\.duplicateSkipped/);
});

test("copy and package evidence are hard forward-only boundaries during recovery", () => {
  assert.match(app, /const durableCopyBoundary = Boolean\([\s\S]{0,420}copyTextLength/);
  assert.match(app, /&& !durableCopyBoundary/);
  assert.match(app, /if \(durableCopyBoundary\) \{[\s\S]{0,220}task\._stage = "等待归档"/);
  assert.match(app, /maximumGenerationRequests: 0/);
  assert.match(app, /copy-boundary-generation-suppressed/);
  assert.match(app, /ownerHasDurableCopy[\s\S]{0,800}禁止再次补图/);
});

test("GPT admission reconciles a lost archive marker from completed history before declaring a conversation busy", () => {
  assert.match(gptSidebar, /TeambuildingGptReconcileArchivedBoundary\s*=\s*reconcileCurrentAutomationBoundaryFromHistory/);
  assert.match(gptSidebar, /tb-workbench-inspect-request[\s\S]*?reconcileCurrentAutomationBoundaryFromHistory\(\)\.catch\(\(\) => false\)\.then\(respond\)/);
  assert.match(gptSidebar, /const snapshot = conversationStateSnapshot\(\)/);
});

test("GPT mode definitions include 6 user-facing modes plus semi-auto compatibility", () => {
  assert.match(app, /manual:\s*\{[^}]*label:\s*"人工控制"/);
  assert.match(app, /automatic:\s*\{[^}]*label:\s*"选材后自动"/);
  assert.match(app, /single:\s*\{[^}]*label:\s*"单账号全自动"/);
  assert.match(app, /scheduled:\s*\{[^}]*label:\s*"定时单账号全自动"/);
  assert.match(app, /rotate:\s*\{[^}]*label:\s*"旧多账号全自动"[^}]*hidden:\s*true/);
  assert.match(app, /patrol:\s*\{[^}]*label:\s*"单账号多对话巡检"/);
  assert.match(app, /"semi-auto":\s*\{[^}]*label:\s*"半自动（兼容）"[^}]*hidden:\s*true/);
});

test("GPT production uses progressive disclosure without removing any production mode", () => {
  assert.doesNotMatch(html, /class="gpt-simple-cockpit"/);
  assert.doesNotMatch(html, /id="gptCockpitMode"/);
  assert.match(html, /id="gptCockpitAccount"/);
  assert.doesNotMatch(html, /id="gptCockpitState"/);
  assert.doesNotMatch(html, /id="gptCockpitNextAction"/);
  assert.match(html, /class="gpt-current-account-chip"/);
  assert.match(html, /class="mode-quick-tabs-primary"/);
  assert.match(html, /<details class="mode-more-modes">/);
  assert.match(html, /<section class="gpt-developer-settings" id="gptDeveloperSettings">/);
  for (const mode of ["manual", "automatic", "single", "scheduled", "patrol"]) {
    assert.match(html, new RegExp(`class="mode-quick-tab" data-mode="${mode}"`));
  }
  assert.match(app, /#gptCockpitAccount/);
  assert.match(productionStatus, /等待当前作品完整归档，无需操作/);
  assert.match(productionStatus, /点击开始生产/);
  assert.match(html, /id="gptDeveloperSettingsToggle" type="checkbox"/);
  assert.match(css, /gpt-developer-settings-checkbox:checked ~ \.gpt-developer-settings-body/);
});

test("embedded GPT address bar reflects native page loading progress", () => {
  assert.match(html, /id="gptBrowserLoadingProgress"/);
  assert.match(html, /id="gptBrowserLoadingBar"/);
  assert.match(desktopMain, /desktop:gpt-loading-changed/);
  assert.match(desktopMain, /did-start-loading[\s\S]*notifyGptLoadingChanged/);
  assert.match(desktopMain, /did-finish-load[\s\S]*notifyGptLoadingChanged/);
  assert.match(desktopMain, /did-fail-load[\s\S]*notifyGptLoadingChanged/);
  assert.match(desktopMain, /code !== -3/);
  assert.match(desktopPreload, /onLoadingChanged/);
  assert.match(app, /onLoadingChanged/);
  assert.match(app, /setGptBrowserLoading/);
});

test("a stale controlled recovery cannot refresh through a newly active window worker", () => {
  assert.match(app, /const workerOwnsTask = !settledHeartbeatRecovery && \(Boolean\(activeWorker\.autoRunning\)/);
  assert.doesNotMatch(app, /const workerOwnsTask = !settledHeartbeatRecovery && !controlledRecovery/);
});

test("same-conversation page loading preserves the pending GPT task", () => {
  assert.match(desktopMain, /gpt-task-navigation-deferred/);
  assert.doesNotMatch(desktopMain, /webContents\.on\("did-start-loading"[\s\S]{0,180}abortPendingGptTask\(account\)/);
  assert.match(desktopMain, /pendingConversation && navigatedConversation && pendingConversation !== navigatedConversation/);
});

test("window recovery exhaustion quarantines the exact request instead of a stale last failure", () => {
  assert.match(app, /requestedTaskId \? state\.queue\.find/);
  assert.match(app, /\{ quarantine: true, requestId: currentTaskId \}/);
});

test("embedded GPT DOM readiness clears a stale native loading indicator", () => {
  assert.match(desktopMain, /webContents\.on\("dom-ready",\s*\(\)\s*=>\s*\{[\s\S]*?loading:\s*false[\s\S]*?notifyGptLoadingChanged\(id,\s*false\)/);
  assert.match(desktopMain, /account\.pageState\.loading\s*=\s*false;[\s\S]*?liveState\?\.composerReady/);
});

test("recovered image workflows keep the task image plan authoritative over stale page counts", () => {
  assert.match(app, /expectedImages:\s*Math\.max\(1, Number\(task\.workflow\?\.plannedImageCount \|\| task\.expectedImages \|\| 1\)\)/);
  assert.match(app, /expectedImages:\s*Math\.max\(1, Number\(task\.workflow\?\.plannedImageCount \|\| task\.expectedImages \|\| status\.expectedImages \|\| 1\)\)/);
});

test("GPT progress adopts the live plan count without re-uploading the material", () => {
  assert.match(app, /function adoptLiveGptPlanCount\(task, status = \{\}\)/);
  assert.match(app, /Math\.max\(0, Math\.min\(10, Number\(status\.expectedImages \|\| status\.progressExpected \|\| 0\)\)\)/);
  assert.match(app, /task\.workflow\.plannedImageCount = liveCount;/);
  assert.match(app, /task\.expectedImages = liveCount;/);
  assert.match(app, /workflowProgressObserved = true;\s*workflowHeartbeat\.observe\(status\);\s*adoptLiveGptPlanCount\(task, status\);/s);
  assert.match(app, /workflowHeartbeat\.observe\(status\);\s*adoptLiveGptPlanCount\(task, status\);\s*gptLastFailedStage/);
});

test("GPT production keeps the primary action dock visible inside the scrolling library", () => {
  assert.match(css, /\.gpt-test-send-dock\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s);
  assert.match(css, /\.gpt-test-send-dock\s*\{[^}]*z-index:\s*\d+;/s);
  assert.match(css, /\.gpt-test-send-dock\s*\{[^}]*min-height:\s*max-content;/s);
  assert.match(css, /\.gpt-test-send-dock::before\s*\{/s);
  assert.match(html, /class="gpt-mode-action-row"[\s\S]*?class="gpt-mode-row"[\s\S]*?class="gpt-action-row"/);
  assert.match(css, /\.gpt-mode-action-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.gpt-action-row\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.gpt-action-row \.primary-button\s*\{[^}]*flex:\s*1 1 100%/s);
  assert.match(css, /\.gpt-status-bar\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.gpt-status-next-action\s*\{[^}]*grid-column:\s*1 \/ -1/);
});

test("GPT main actions explain their effect before the user clicks", () => {
  for (const id of [
    "gptSaveOnlineTemplateBtn",
    "gptTestSendBtn",
    "gptManualNextBtn",
    "gptSemiAutoResumeBtn",
    "gptPauseQueueBtn",
    "gptStopQueueBtn",
    "gptRetryTaskBtn",
    "gptSkipTaskBtn",
    "gptReopenWindowBtn",
    "gptResetTaskBtn"
  ]) {
    assert.match(html, new RegExp(`id=\\"${id}\\"[\\s\\S]{0,360}(?:title|data-tooltip)=`));
  }
  assert.match(app, /startButtonHelp = \{/);
  assert.match(app, /skipBtn\.title =/);
  assert.match(app, /resetButton\.title =/);
  assert.match(app, /manualNextButton\.title =/);
  assert.match(app, /semiAutoResumeButton\.title =/);
});

test("normalizeGptProductionMode maps legacy multi to single and recognizes scheduled/patrol", () => {
  assert.match(app, /if \(mode === "scheduled"/);
  assert.match(app, /if \(mode === "patrol"/);
  assert.match(app, /if \(mode === "multi"\) return "single"/);
});

test("scheduled and patrol modes are continuous for automatic queue replenishment", () => {
  assert.match(app, /scheduled:\s*\{[^}]*continuous:\s*true/);
  assert.match(app, /patrol:\s*\{[^}]*continuous:\s*true/);
});

test("single-account multi-conversation patrol auto-joins template titles and keeps a denylist", () => {
  assert.match(html, /id="gptPatrolSettingsGroup"[^>]*hidden/);
  assert.match(html, /id="gptPatrolDenylist"/);
  assert.match(html, /标题含“模板”或“母版”会自动参与/);
  assert.match(html, /标题含“游戏”一律排除/);
  assert.match(html, /id="gptPatrolDiscoverBtn"[^>]*>只读扫描当前账号/);
  assert.match(app, /GPT_PATROL_SETTINGS_STORAGE_KEY/);
  assert.match(app, /discoverCurrentAccountPatrolConversations/);
  assert.match(app, /discoverPatrolConversations\(activeGptAccountId/);
  assert.match(desktopPreload, /discoverPatrolConversations\(accountId/);
  assert.match(desktopMain, /desktop:gpt-patrol-discover/);
  assert.match(gptSidebar, /discoverPatrolConversations/);
  assert.match(gptSidebar, /maximumScrolls/);
  assert.match(gptSidebar, /originalPositions/);
  assert.match(gptSidebar, /titleMatched && !excluded/);
  assert.match(gptSidebar, /readOnly:\s*true/);
  assert.doesNotMatch(gptSidebar, /tb-workbench-patrol-discover-request[\s\S]{0,1200}sendComposerText/);
});

test("patrol discovery displays a side-effect-free stage label for the current conversation", () => {
  assert.match(gptSidebar, /const currentState = conversationStateSnapshot\(\)/);
  assert.match(gptSidebar, /patrolState = classifyPatrolStage/);
  assert.match(gptSidebar, /expectedImageCount/);
  assert.match(gptSidebar, /const priorPlan = \[\.\.\.after\.slice\(0, confirm\.index\)\]\.reverse\(\)/);
  assert.match(gptSidebar, /expectedImageCount:\s*parsePlannedImageCount|const expectedImageCount = parsePlannedImageCount\(planText\)/);
  assert.match(app, /当前对话：\$\{escapeHtml\(item\.currentState\.patrolState\.label\)\}/);
  assert.match(gptSidebar, /turnDeadline = Date\.now\(\) \+ 20_000/);
  assert.match(gptSidebar, /imageHydrationDeadline = Date\.now\(\) \+ 20_000/);
});

test("patrol exposes an explicit title-gated single-step continuation bridge", () => {
  assert.match(app, /data-patrol-continue/);
  assert.match(app, /continuePatrolConversation\(activeGptAccountId/);
  assert.match(desktopPreload, /continuePatrolConversation\(accountId/);
  assert.match(desktopMain, /desktop:gpt-patrol-continue/);
  assert.match(gptSidebar, /executePatrolSingleStep/);
  assert.match(gptSidebar, /decidePatrolSingleStep/);
  assert.match(gptSidebar, /allowStaleComposerRecovery/);
  assert.match(gptSidebar, /forceClearComposer\(\)/);
  assert.match(desktopPreload, /allowStaleComposerRecovery: Boolean\(options\.allowStaleComposerRecovery\)/);
  assert.match(desktopMain, /allowStaleComposerRecovery: Boolean\(input\.allowStaleComposerRecovery\)/);
  assert.match(gptSidebar, /tb-workbench-patrol-continue-request/);
  assert.match(gptSidebar, /titleMatched && !excluded/);
  assert.match(gptSidebar, /const silentImageRetry = record\.lastAction === "send-confirm"/);
  assert.match(gptSidebar, /Date\.now\(\) - Number\(record\.lastActionAt \|\| 0\) >= 60_000/);
  assert.match(gptSidebar, /silentImageRetry[\s\S]{0,180}nextActionKey: "send-confirm"/);
  assert.match(gptSidebar, /const silentCopyRetry = record\.lastAction === "request-copy"/);
  assert.match(gptSidebar, /silentCopyRetry[\s\S]{0,180}nextActionKey: "request-copy"/);
});

test("patrol recovery separates material-scoped ledger keys from navigable conversation URLs", () => {
  assert.match(desktopMain, /function patrolConversationUrlInput\(value = ""\)/);
  assert.match(desktopMain, /::material:/);
  assert.match(desktopMain, /directConversation/);
  assert.match(desktopMain, /customGptConversation/);
  assert.match(desktopMain, /reason: "invalid-target-url"/);
  assert.match(app, /function explicitPatrolConversationUrl\(\.\.\.values\)/);
  assert.match(app, /explicitPatrolConversationUrl\(inspection\.url, inspection\.patrolLedgerKey\)/);
  assert.match(app, /allowUntitledRecovery: hasExactOwner/);
  assert.match(app, /durableImageUrls: Array\.isArray\(ownerTask\?\.workflow\?\.generatedImageUrls\)/);
  assert.match(app, /\.catch\(\(error\) => \(\{ ok: false, acted: false/);
});

test("patrol recognizes ChatGPT semantic image turns and native batch completion", () => {
  assert.match(gptSidebar, /img\[alt\^="\\u5df2\\u751f\\u6210\\u56fe\\u7247"\]/);
  assert.match(gptSidebar, /\[data-turn="user"\], \[data-turn="assistant"\]/);
  assert.match(gptSidebar, /!turn\.parentElement\?\.closest\?\.\('\[data-turn\]'\)/);
  assert.match(gptSidebar, /conversationTurnRole/);
  assert.match(gptSidebar, /button\[aria-label\*="下载本组"\]/);
  assert.match(gptSidebar, /containers\.flatMap\(\(container\) => \[\.\.\.container\.querySelectorAll\("img"\)\]\)/);
});

test("patrol mode assigns each queued material to a verified free template conversation", () => {
  assert.match(html, /gpt-patrol-scheduler\.js\?v=/);
  assert.match(app, /async function preparePatrolTaskNavigation\(/);
  assert.match(app, /TBGptPatrolScheduler\.orderedEligibleConversations/);
  assert.match(app, /continuePatrolConversation\(accountId/);
  assert.match(app, /inspectOnly:\s*true/);
  assert.match(desktopPreload, /inspectOnly:\s*Boolean\(options\.inspectOnly\)/);
  assert.match(desktopMain, /inspectOnly:\s*Boolean\(input\.inspectOnly\)/);
  assert.match(gptSidebar, /if \(options\.inspectOnly\)/);
  assert.match(app, /TBGptPatrolScheduler\.patrolProbeAvailability/);
  assert.match(app, /task\.patrolConversationUrl\s*=\s*candidate\.url/);
  assert.match(app, /savePatrolCursor\(/);
  assert.match(app, /await preparePatrolTaskNavigation\(task, runAccountId\)/);
  assert.match(app, /PATROL_NO_AVAILABLE_CONVERSATION/);
});

test("patrol packaging reports and can replay the authoritative completed package without redownloading", () => {
  assert.match(gptSidebar, /function reportPatrolPackageCompletion\(/);
  assert.match(gptSidebar, /const latestImageAssistant = \[\.\.\.assistantTurns\]\.reverse\(\)/);
  assert.match(gptSidebar, /const latestGeneratedTurn = \[\.\.\.document\.querySelectorAll\('\[data-testid\^="conversation-turn"\]'\)\]/);
  assert.match(gptSidebar, /latestSemanticBatchImages/);
  assert.match(gptSidebar, /durableImageUrls/);
  assert.match(gptSidebar, /durableImageEvidence/);
  assert.match(gptSidebar, /historicalImagesBelongToCopy/);
  assert.match(gptSidebar, /snapshot\?\.latestImageUrls/);
  assert.match(gptSidebar, /semanticGeneratedImageUrlsIn/);
  assert.match(gptSidebar, /semanticImageUrls\.length > roleBasedImageUrls\.length/);
  assert.match(app, /compactPromptForTrainedGptConversation/);
  assert.match(app, /durableImageUrls: Array\.isArray\(ownerTask\?\.workflow\?\.generatedImageUrls\)/);
  assert.match(gptSidebar, /snapshot\?\.copyText/);
  assert.match(gptSidebar, /record\.packagePath[\s\S]{0,1800}reportPatrolPackageCompletion/);
  assert.match(gptSidebar, /reportWorkbenchTask\(packageTask, "success"/);
  assert.match(gptSidebar, /logConversationEvent\("archived"/);
  assert.match(gptSidebar, /downloadedImages:\s*Number\(/);
  assert.match(gptSidebar, /copyTextLength:\s*String\(/);
  assert.match(desktopPreload, /durableImageUrls: Array\.isArray\(options\.durableImageUrls\)/);
  assert.match(desktopMain, /durableImageCount: Math\.max\(0, Number\(input\.durableImageCount/);
});

test("a durable package can release a stale live boundary without sending again", () => {
  assert.match(gptSidebar, /allowExistingPackageRelease/);
  assert.match(gptSidebar, /existingPackageMatchesLiveBoundary/);
  assert.match(gptSidebar, /action: "release-boundary"/);
  assert.match(gptSidebar, /do not download,[\s\S]{0,120}archive, or send anything again/);
  assert.match(app, /allowExistingPackageRelease: allowAlreadyPackagedReplay/);
  assert.match(app, /ARCHIVED_BOUNDARY_RELEASE_PENDING/);
  assert.match(desktopPreload, /allowExistingPackageRelease: Boolean\(options\.allowExistingPackageRelease\)/);
  assert.match(desktopMain, /existingPackageImages: Math\.max\(0, Number\(/);
});

test("independent windows automatically back off and retry transient bridge failures", () => {
  assert.match(app, /const transientWindowFailure = isTransientGptWindowFailure/);
  assert.match(app, /reason: "transient-retry-wait"/);
  assert.match(app, /task\._status = "queued"[\s\S]{0,2500}scheduleGptWindowRetry\(key, 15_000, "网页\/桥接临时失败"\)/);
  assert.doesNotMatch(app.match(/if \(transientWindowFailure[\s\S]*?return \{\s*ok: false,\s*reason: "transient-retry-wait"/)?.[0] || "", /isContinuousGptProductionArmed\(\)/);
  assert.match(app, /不会推进队列/);
});

test("patrol duplicate package results still archive the source material", () => {
  assert.match(gptSidebar, /if \(options\.autoArchive !== false && sourceMaterialPath\)/);
  assert.doesNotMatch(gptSidebar, /if \(!packageResult\?\.duplicate && options\.autoArchive !== false && sourceMaterialPath\)/);
  assert.match(gptSidebar, /const archiveResponse = await api\("\/api\/gpt-production\/archive-material"/);
  assert.match(gptSidebar, /archive-source-skipped/);
  assert.match(server, /source-material-missing-or-already-archived/);
});

test("automatic duplicate packaging still reaches the source archive boundary", () => {
  const duplicateStart = gptSidebar.indexOf("if (packageResult.duplicate)");
  const duplicateEnd = gptSidebar.indexOf("if (checkpointLabel)", duplicateStart);
  const duplicateBlock = gptSidebar.slice(duplicateStart, duplicateEnd);
  assert.ok(duplicateStart >= 0 && duplicateEnd > duplicateStart);
  assert.match(duplicateBlock, /workflow\.duplicateSkipped = true/);
  assert.doesNotMatch(duplicateBlock, /earlyReturn\s*=/);
  assert.match(gptSidebar, /if \(workflow\.duplicateSkipped\) \{[\s\S]*?作品归档完成/);
  assert.match(gptSidebar, /duplicateSkipped: Boolean\(workflow\.duplicateSkipped\)/);
});

test("a live archived conversation releases a stale TXT-only history row", () => {
  assert.match(gptSidebar, /const liveConversation = conversationStateSnapshot\(\)/);
  assert.match(gptSidebar, /liveConversation\?\.stage === "archived"[\s\S]*?liveConversation\.canInjectNext === true[\s\S]*?return null/);
});

test("an archived live boundary completes its owner task before another confirmation", () => {
  assert.match(app, /const ownerTask = explicitOwnerTask \|\| findGptConversationOwnerTask\(inspection, queue\)/);
  assert.match(app, /ownerTask && \["completed", "archived"\]\.includes\(stage\)/);
  assert.match(app, /ownerTask\._status = "completed"[\s\S]*?ownerTask\._completedFromLog = true/);
  assert.match(app, /reason: "already-packaged"/);
});

test("recovery reclaims an earlier skipped owner and labels waiting-images correctly", () => {
  assert.match(app, /const ownerIsEarlierQueueTask = Boolean\(conversationOwner/);
  assert.match(app, /ownerIndex < gptTestQueueIndex\);/);
  const ownerGuardStart = app.indexOf("const ownerIsEarlierQueueTask");
  const ownerGuard = app.slice(ownerGuardStart, app.indexOf("if (ownerIsEarlierQueueTask)", ownerGuardStart));
  assert.doesNotMatch(ownerGuard, /completed|skipped/);
  assert.match(app, /preservePostConfirmImageStage \|\| stage === "waiting-images"\) \{[\s\S]*?task\._stage = "等待图片"/);
  assert.match(app, /preservePostConfirmImageStage \|\| stage === "waiting-images"\s*\n\s*\? 48/);
});

test("independent startup reconciles the live conversation before sending a future queue item", () => {
  assert.match(app, /async function reconcileIndependentConversationBeforeStart\(accountId, workerState\)/);
  assert.match(app, /async function adoptRecoverableGptConversationCheckpoint\(accountId, workerState, inspection\)/);
  assert.match(app, /api\("\/api\/gpt-production\/history"\)/);
  assert.match(app, /api\("\/api\/gpt-production\/conversation-log\?limit=500"\)/);
  assert.match(app, /gptConversationMaterialMatch\(item, inspection\)/);
  assert.match(app, /inspection\?\.canInjectNext === false && inspection\?\.generating !== true/);
  assert.match(app, /const durableRuntime = readGptWindowRuntime\(key\) \|\| \{\}/);
  assert.match(app, /const queueOwnerForLogEntry = \(entry = \{\}\) => \{/);
  assert.match(app, /const requestOwner = queueByRequestId\.get\(String\(entry\?\.requestId \|\| ""\)\)/);
  assert.match(app, /folderName\.length >= 8 && loggedMaterial\.includes\(folderName\)/);
  assert.match(app, /Boolean\(queueOwnerForLogEntry\(entry\)\)/);
  assert.match(app, /const imageEvidence = \[\.\.\.related\]\.reverse\(\)\.find/);
  assert.match(app, /const loggedImageCount = Math\.max/);
  assert.match(app, /\[liveImageUrls, ownerImageUrls, persistedImageUrls, loggedImageUrls\]/);
  assert.match(app, /checkpoint\?conversationUrl=/);
  assert.match(app, /&sourceMaterialPath=/);
  assert.match(app, /&accountId=/);
  assert.match(app, /copyText: String\(inspection\.copyText \|\| durableCheckpoint\?\.copyText \|\| task\.workflow\?\.copyText \|\| ""\)\.trim\(\)/);
  assert.match(app, /expectedImageCount: Math\.max\([\s\S]*?ownerTask\?\.workflow\?\.plannedImageCount/);
  assert.match(app, /const liveInspectionBeforeRefresh = await boundedGptBrowserCall/);
  assert.match(app, /"completed-copy-pending-package",[\s\S]*?"archived"/);
  assert.match(app, /原对话阶段可读取/);
  assert.match(app, /result\?\.deferred === true \|\| result\?\.reason === "active-task"/);
  assert.match(app, /skipped: "active-task"/);
  assert.match(app, /checkpoint\.imageSubmitted === true/);
  assert.match(app, /const checkpointPlanCount = Number\(checkpoint\.plannedImageCount \|\| checkpoint\.expectedImages \|\| 0\)/);
  assert.match(app, /const runtimePlanCount = runtimeMatchesCheckpoint \? Number\(durableRuntime\.expectedImages \|\| 0\) : 0/);
  assert.match(app, /generatedImageCount: observedImageCount/);
  assert.match(app, /generatedImageActualCount: observedImageCount/);
  assert.match(app, /const copyRequested = checkpoint\.textSubmitted === true/);
  assert.match(app, /_stage: imagesComplete \? "等待文案"/);
  assert.match(app, /queuedSameMaterial/);
  assert.match(app, /queuedRequestIds = new Set/);
  assert.match(app, /window\.gptWorkbench\.navigate\("url", key, checkpointUrl\)/);
  assert.match(app, /window\.gptWorkbench\.inspectStatus\(key\)/);
  assert.match(app, /_submittedToGpt: true/);
  assert.match(app, /workerState\.queue\.splice\(insertAt, 0, task\)/);
  assert.match(app, /const adopted = await adoptRecoverableGptConversationCheckpoint\(key, workerState, inspection\)/);
  assert.match(app, /const uncertainSubmittedTask = \["AUTO_RECOVERY_DEFERRED", "conversation-owner-mismatch"\]/);
  assert.match(app, /adopted: true/);
  assert.match(app, /reason: "inspection-unavailable"/);
  assert.match(app, /errorCode: "GPT_INSPECTION_UNAVAILABLE"/);
  assert.match(app, /if \(!inspection\) \{[\s\S]*?已暂缓发送/);
  assert.match(app, /findGptConversationOwnerTask\(inspection, queue\)/);
  assert.match(app, /const currentQueueIndex = Math\.max\(0, Number\(workerState\.queueIndex \|\| 0\)\)/);
  assert.match(app, /ownerIndex < currentQueueIndex[\s\S]*?workerState\.queueIndex = ownerIndex/);
  assert.match(app, /const trustedArchivedTask = Boolean\(ownerTask/);
  assert.match(app, /ownerTask\._completedFromLog === true[\s\S]*?ownerTask\._result\?\.packagePath/);
  assert.match(app, /alreadyPackaged: true[\s\S]*?trustedLog: true/);
  assert.match(app, /allowAlreadyPackagedReplay: true/);
  assert.match(app, /const stage = String\(inspection\.stage \|\| ""\)/);
  assert.match(app, /\["archive-recovery-failed", "conversation-owner-mismatch"\]/);
  assert.match(app, /recoverCompletedGptConversationBeforeInjection\(ownerTask, key, \{[\s\S]*?queue,[\s\S]*?ownerTask/);
  assert.match(app, /prepareGptCurrentConversationCheckpoint\(ownerTask, inspection, \{[\s\S]*?queue,[\s\S]*?allowGenerating: true/);
  assert.match(app, /const stableImagesComplete = inspection\.generating !== true[\s\S]*?durableImagesComplete/);
  assert.match(app, /else if \(inspection\.generating === true \|\| preservePostConfirmImageStage \|\| stage === "waiting-images"\)/);
  assert.match(app, /task\._percent = durableCopyBoundary[\s\S]{0,180}stableImagesComplete/);
  assert.match(app, /laterWorkflowCheckpoint = !livePlanConfirmationBoundary && \(workflow\.imageSubmitted === true/);
  assert.match(app, /workflow\.planDone = !planReady \|\| laterWorkflowCheckpoint/);
  assert.match(app, /const conversationReconciliation = await reconcileIndependentConversationBeforeStart\(key, workerState\)/);
  assert.match(app, /const taskMatchesLiveConversation = gptConversationMaterialMatch\(\{/);
  assert.match(app, /if \(resumeOwnedConversation && !taskMatchesLiveConversation && !durableConversationLogOwner\)/);
  assert.match(app, /error\.code = "CONVERSATION_OWNER_MISMATCH"/);
  assert.match(app, /const orphanFolderName = gptMaterialFolderFromInspection\(inspection\)/);
  assert.match(app, /inspection\?\.patrolState\?\.safeToAct === true/);
  assert.match(app, /const planReadyStage = \["plan-ready", "waiting-plan"\]/);
  assert.match(app, /const liveLaterStage = !planReadyStage/);
  assert.match(app, /const transientReconciliation = isTransientGptWindowFailure\(conversationReconciliation\)/);
  assert.match(app, /while \(workerState\.queueIndex < workerState\.queue\.length[\s\S]*?GptWindowWorkerState\.isTerminalTask/);
  assert.match(app, /second gate, the next task could enter upload against the old/);
  assert.match(app, /if \(Number\(workerState\.queueIndex \|\| 0\) > 0\)/);
  assert.match(app, /const boundaryReconciliation = await reconcileIndependentConversationBeforeStart\(key, workerState\)/);
  assert.match(app, /const verifiedBoundary = await boundedGptBrowserCall\(/);
  assert.match(app, /const currentTaskOwnsRecoverableBoundary = Boolean\([\s\S]*?verifiedOwner === blockedTask[\s\S]*?recoverableGptConversationStage/);
  assert.match(app, /verifiedBoundary\.canInjectNext === false && !currentTaskOwnsRecoverableBoundary/);
  assert.match(app, /errorCode: "CONVERSATION_BOUNDARY_PENDING"/);
  assert.match(app, /const recoveredQueuedRestartCheckpoint = prepareIndependentRestartRecoveryTask\(workerState\)/);
  assert.match(app, /if \(task\._submittedToGpt !== true\) \{[\s\S]*?task\.forceUpload = true/);
  assert.match(app, /workerState\.queuePaused = !transientReconciliation/);
  assert.match(app, /scheduleGptQuotaConversationReconciliation\(key/);
  assert.match(app, /reconcileOnly: true/);
  assert.match(app, /if \(options\.reconcileOnly\) \{[\s\S]*?state: "reconciled"/);
  assert.match(app, /当前 GPT 对话仍停在“\$\{inspection\.stage/);
  assert.match(app, /const freeRootChat = stage === "unknown"/);
  assert.match(app, /const alreadyReboundRootTask = previousRequestId\.startsWith\("gpt-root-rebind-"\)/);
  assert.match(app, /if \(!alreadyReboundRootTask\) \{[\s\S]*?currentTask\.retryOf = previousRequestId/);
  assert.match(app, /ROOT_PAGE_DIRECT_UPLOAD/);
  assert.match(app, /首页输入框已就绪，准备上传当前作品/);
});

test("an unowned completed copy boundary is isolated and rebound to a fresh chat", () => {
  assert.match(app, /async function rebindUnownedCompletedConversationToFreshChat\(accountId, workerState, inspection(?:, options = \{\})?\)/);
  assert.match(app, /const staleUnownedWorkflowBoundary = \[[\s\S]*?"waiting-plan"[\s\S]*?"waiting-images"/);
  assert.match(app, /inspection\?\.canInjectNext === false/);
  assert.match(app, /AUTO_RECOVERY_ORPHAN_BOUNDARY/);
  assert.match(app, /window\.gptWorkbench\.navigate\("new-chat", key\)/);
  assert.match(app, /task\.navigation = "new-chat"/);
  assert.match(app, /task\._freshConversationRebound = true/);
  assert.match(app, /task\.forceUpload = true/);
  assert.match(app, /const quarantinedLiveConversation = Object\.values\(readAutomaticGptTaskQuarantine\(\)\)/);
  assert.match(app, /const knownConversationUrl = quarantinedLiveConversation\s*\? ""/);
  assert.match(app, /const orphanRebound = await rebindUnownedCompletedConversationToFreshChat\(key, workerState, inspection\)/);
  assert.match(app, /const isolatedStaleOwner = ownerIndex < currentQueueIndex[\s\S]*?ownerTask\._isolationReason/);
  assert.match(app, /if \(isolatedStaleOwner\) \{[\s\S]*?rebindUnownedCompletedConversationToFreshChat\(key, workerState, inspection\)/);
  assert.match(app, /task\.navigation === "new-chat"[\s\S]{0,900}gptAccountNeedsMasterPrompt/);
  assert.match(app, /!\["single", "automatic"\]\.includes\(normalizeGptProductionMode\(settings\.mode\)\)/);
});

test("fresh-session template initialization bypasses the stale previous conversation boundary", () => {
  const reconcileStart = app.indexOf("async function reconcileIndependentConversationBeforeStart");
  const reconcileEnd = app.indexOf("async function runIndependentGptWindow", reconcileStart);
  const reconcileBlock = app.slice(reconcileStart, reconcileEnd);
  const freshGate = reconcileBlock.indexOf("const explicitFreshNavigationTask");
  const inspection = reconcileBlock.indexOf("window.gptWorkbench.inspectStatus");
  assert.ok(freshGate >= 0, "expected an explicit fresh-session navigation gate");
  assert.ok(inspection > freshGate, "fresh-session gate must run before inspecting the stale previous conversation");
  assert.match(reconcileBlock, /explicitFreshNavigationTask[\s\S]*?taskType === "template-init"/);
  assert.match(reconcileBlock, /explicitFreshNavigationTask[\s\S]*?navigation === "new-chat"/);
  assert.match(reconcileBlock, /explicitFreshNavigationTask[\s\S]*?_submittedToGpt !== true/);
  assert.match(reconcileBlock, /freshNavigation: true/);
});

test("fresh-session fixed-template queue opens every material in a new chat with template attachments", () => {
  const buildBlock = app.slice(
    app.indexOf("async function buildGptProductionQueueForWindow"),
    app.indexOf("function sanitizeUnsubmittedGptTaskAccountBinding")
  );
  assert.match(buildBlock, /freshSessionFixedTemplate/);
  assert.match(buildBlock, /navigation:\s*"new-chat"/);
  assert.match(buildBlock, /_freshConversationBootstrap:\s*true/);
  assert.match(buildBlock, /entries\.map\(\(entry\)\s*=>/);
  assert.doesNotMatch(buildBlock, /freshSessionFixedTemplate[\s\S]{0,900}buildGptTemplateInitTask/);

  const taskBlock = app.slice(
    app.indexOf("function buildGptTestTask"),
    app.indexOf("function buildGptProductionQueue")
  );
  assert.match(taskBlock, /freshSessionFixedTemplate/);
  assert.match(taskBlock, /templateAttachments/);
  assert.match(taskBlock, /materialAttachments/);
  assert.match(taskBlock, /templateAttachments:\s*freshSessionFixedTemplate \? templateAttachments : \[\]/);
  assert.match(taskBlock, /母版附件/);
  assert.match(taskBlock, /待迁移素材附件/);
  assert.match(app, /function freshSessionFixedTemplateAttachments/);
  assert.match(app, /task\._submittedToGpt !== true[\s\S]{0,160}freshSessionFixedTemplateAttachments/);
  assert.match(desktopMain, /templateAttachments:\s*Array\.isArray\(task\.templateAttachments\)/);
  assert.match(gptSidebar, /approvedTemplateFiles[\s\S]*?!approvedTemplateFiles\.has\(normalized\)/);
});

test("saved fresh-session queues upgrade only unsent tasks and retain submitted checkpoints", () => {
  const ensureStart = app.indexOf("async function ensureGptWindowWorkerQueue");
  const ensureEnd = app.indexOf("function independentGptWindowMode", ensureStart);
  const ensureBlock = app.slice(ensureStart, ensureEnd);
  assert.match(ensureBlock, /task\?\.taskType === "template-init"[\s\S]{0,120}_submittedToGpt !== true/);
  assert.match(ensureBlock, /task\?\.taskType !== "material" \|\| task\._submittedToGpt === true\) continue/);
  assert.match(ensureBlock, /buildGptTestTask/);
  assert.match(ensureBlock, /navigation: "new-chat"/);
  assert.match(ensureBlock, /_freshConversationBootstrap: true/);
  assert.match(ensureBlock, /requestId: task\.requestId/);
});

test("switching back to legacy mode rebuilds only unsent fresh-session tasks for the saved conversation", () => {
  const ensureStart = app.indexOf("async function ensureGptWindowWorkerQueue");
  const ensureEnd = app.indexOf("function independentGptWindowMode", ensureStart);
  const ensureBlock = app.slice(ensureStart, ensureEnd);
  assert.match(ensureBlock, /accountProfile\?\.workflowVariant === "legacy-v1"/);
  assert.match(ensureBlock, /task\?\._submittedToGpt !== true/);
  assert.match(ensureBlock, /task\?\.workflowVariant !== "fresh-session-fixed-template"/);
  assert.match(ensureBlock, /buildGptTestTask\([\s\S]{0,240}null/);
  assert.match(ensureBlock, /templateAttachments: \[\]/);
  assert.match(ensureBlock, /navigation: ""/);
  assert.match(ensureBlock, /_freshConversationBootstrap: false/);
  assert.match(ensureBlock, /workflowVariant: "legacy-v1"/);
  assert.match(ensureBlock, /sessionPolicy: "reuse-conversation"/);
});

test("fresh-session dispatch marks the root composer as an intentional bootstrap before native readiness", () => {
  const runBlock = app.slice(
    app.indexOf("async function runGptTaskOnBrowser"),
    app.indexOf("async function runGptWorkers", app.indexOf("async function runGptTaskOnBrowser"))
  );
  const freshBranch = runBlock.indexOf('task.navigation === "new-chat"');
  const nativeSend = runBlock.indexOf("window.gptWorkbench.sendTask(task)");
  assert.ok(freshBranch >= 0 && nativeSend > freshBranch);
  assert.match(runBlock.slice(freshBranch, nativeSend), /task\._freshConversationBootstrap = true/);
  assert.match(runBlock.slice(freshBranch, nativeSend), /task\.conversationUrl = ""/);
});

test("fresh-session worker does not mark a task submitted before the bridge confirms GPT receipt", () => {
  const runBlock = app.slice(
    app.indexOf("async function runGptTaskOnBrowser"),
    app.indexOf("async function runGptWorkers", app.indexOf("async function runGptTaskOnBrowser"))
  );
  assert.match(runBlock, /task\._submittedToGpt = resumeCurrentConversation \|\| task\._submittedToGpt === true/);
  assert.match(runBlock, /status\.submittedToGpt === true/);
  assert.match(runBlock, /result\?\.submittedToGpt === true \|\| result\?\.planSubmitted === true/);
});

test("fresh-session material navigation bypasses the previous conversation boundary before submit", () => {
  const reconcileBlock = app.slice(
    app.indexOf("async function reconcileIndependentConversationBeforeStart"),
    app.indexOf("async function runIndependentGptWindow", app.indexOf("async function reconcileIndependentConversationBeforeStart"))
  );
  assert.match(reconcileBlock, /fresh-session-fixed-template/);
  assert.match(reconcileBlock, /taskType === "material"/);
  assert.match(reconcileBlock, /navigation === "new-chat"/);
  assert.match(reconcileBlock, /_submittedToGpt !== true/);
});

test("restart recovery preserves the identity of a submitted nonterminal task", () => {
  const task = {
    requestId: "gpt-original-confirmed",
    taskType: "material",
    _submittedToGpt: true,
    _status: "paused",
    _stage: "等待图片",
    _percent: 48,
    _errorCode: "RESTART_INTERRUPTED",
    workflow: { planSubmitted: true, imageSubmitted: true }
  };
  const workerState = { accountId: "account-2", queue: [task], queueIndex: 0, lastFailedTask: task };
  const prepareRestartRecovery = isolatedAppFunction(
    "prepareIndependentRestartRecoveryTask",
    "releaseStaleAutomaticStopCheckpoint",
    {
      activeGptAccountId: "account-2",
      readGptWindowRuntime: () => ({ currentStage: "等待图片" }),
      normalizeSubmittedGptCheckpoint: () => {}
    }
  );

  assert.equal(prepareRestartRecovery(workerState), true);
  assert.equal(task.requestId, "gpt-original-confirmed", "submitted restart recovery must keep the original requestId");
  assert.doesNotMatch(task.requestId, /^gpt-window-recover-/, "restart recovery must not create a new work identity");
});

test("retry current step preserves the identity of a submitted nonterminal task", async () => {
  const task = {
    requestId: "gpt-original-retry",
    taskType: "material",
    _submittedToGpt: true,
    _status: "failed",
    _stage: "等待图片",
    _percent: 48,
    workflow: { planSubmitted: true, imageSubmitted: true }
  };
  const state = { queue: [task], queueIndex: 0, lastFailedTask: task, autoRunning: false };
  let runtimePatch = null;
  const retryCurrentStep = isolatedAppFunction(
    "retryIndependentGptWindowTask",
    "completeCurrentManualGptTask",
    {
      activeGptAccountId: "account-2",
      gptWindowWorkerState: () => state,
      persistGptWindowWorkerState: () => {},
      writeGptWindowRuntime: (_accountId, patch) => { runtimePatch = patch; },
      updateGptWindowUi: (_accountId, callback) => callback(),
      updateGptTestQueueStatus: () => {},
      runIndependentGptWindow: async () => ({ ok: true })
    }
  );

  await retryCurrentStep("account-2");
  assert.equal(task.requestId, "gpt-original-retry", "retrying a submitted step must keep the original requestId");
  assert.equal(runtimePatch?.currentTaskId, "gpt-original-retry", "runtime ownership must stay on the original requestId");
  assert.doesNotMatch(task.requestId, /^gpt-window-retry-/, "retry must not create a new work identity");
});

test("orphan rebind cannot erase or move a submitted nonterminal checkpoint to new chat", async () => {
  const workflow = { planSubmitted: true, imageSubmitted: true, plannedImageCount: 10 };
  const task = {
    requestId: "gpt-original-orphan",
    taskType: "material",
    _submittedToGpt: true,
    _status: "paused",
    _stage: "等待图片",
    _percent: 48,
    workflow
  };
  const workerState = { accountId: "account-2", queue: [task], queueIndex: 0 };
  const navigations = [];
  const rebindOrphan = isolatedAppFunction(
    "rebindUnownedCompletedConversationToFreshChat",
    "autoIsolateStalledImageBoundary",
    {
      activeGptAccountId: "account-2",
      window: {
        gptWorkbench: {
          navigate: async (...args) => { navigations.push(args); }
        }
      },
      resolveGptTaskConversationUrl: () => "",
      readAutomaticGptTaskQuarantine: () => ({}),
      findDurableGptTaskConversationUrl: async () => "",
      canonicalGptConversationUrl: (value) => String(value || "").split(/[?#]/)[0],
      readGptAccountConversationUrl: async () => "",
      gptWindowAutoStartAllowed: () => true,
      persistGptWindowWorkerState: () => {},
      writeGptWindowRuntime: () => {},
      updateGptWindowUi: (_accountId, callback) => callback(),
      updateGptTestQueueStatus: () => {},
      gptAccounts: [],
      saveGptAccounts: () => {},
      setTimeout: (callback) => { callback(); return 0; }
    }
  );

  await rebindOrphan("account-2", workerState, {
    stage: "waiting-images",
    canInjectNext: false,
    composerReady: true,
    authenticationRequired: false,
    generating: false,
    conversationUrl: "https://chatgpt.com/c/unowned-live-boundary"
  }, { ownerTask: task });

  assert.deepEqual({
    requestId: task.requestId,
    submittedToGpt: task._submittedToGpt,
    workflowPreserved: task.workflow === workflow,
    newChatNavigations: navigations.filter(([action]) => action === "new-chat").length
  }, {
    requestId: "gpt-original-orphan",
    submittedToGpt: true,
    workflowPreserved: true,
    newChatNavigations: 0
  }, "submitted nonterminal recovery must preserve identity/workflow and wait for its original conversation");
});

test("production checkpoints persist the browser account identity used for recovery", () => {
  assert.match(gptSidebar, /accountWindowId:\s*String\(task\.entry\.accountId/);
  assert.match(gptSidebar, /accountId:\s*String\(task\.entry\.accountId/);
  assert.match(server, /accountId:\s*checkpointAccountId \|\| String\(source\.accountId \|\| source\.accountWindowId/);
});

test("legacy missing-image-boundary isolation is revived once without reopening real quarantines", () => {
  assert.match(app, /function isRetryableLegacyImageBoundaryQuarantine\(accountId, requestId\)/);
  assert.match(app, /当前作品缺少生图回复边界证据/);
  assert.match(app, /function clearAutomaticGptTaskQuarantine\(accountId, requestId\)/);
  assert.match(app, /isAutomaticGptTaskQuarantined\(key, requestId\)\s*&&\s*!isRetryableLegacyImageBoundaryQuarantine\(key, requestId\)/);
  assert.match(app, /clearAutomaticGptTaskQuarantine\(key, checkpoint\.requestId\)/);
});

test("same-material and orphan fallbacks reject a live conversation owned by another account", () => {
  assert.match(app, /const liveConversationOwners = new Set/);
  assert.match(app, /const liveConversationOwnedByOtherAccount = \[\.\.\.liveConversationOwners\]\.some\(\(owner\) => owner !== key\)/);
  assert.match(app, /const queuedRequestOwners = accountByRequest\.get\(String\(task\.requestId \|\| ""\)\.trim\(\)\)/);
  assert.match(app, /if \(\[\.\.\.\(queuedRequestOwners \|\| \[\]\)\]\.some\(\(owner\) => owner !== key\)\) return false/);
  assert.match(app, /&& !liveConversationOwnedByOtherAccount[\s\S]*?const orphanFolderName/);
});

test("ambiguous recovery resolves request ownership from the full durable conversation ledger", () => {
  assert.match(server, /function readGptConversationOwnership\(requestIds = \[\]\)/);
  assert.match(server, /pathname === "\/api\/gpt-production\/conversation-ownership"/);
  assert.match(app, /api\("\/api\/gpt-production\/conversation-ownership\?requestIds="/);
  assert.match(app, /const durableAccountByRequest = new Map/);
  assert.match(app, /const durableOwners = durableAccountByRequest\.get\(String\(task\.requestId \|\| ""\)\.trim\(\)\)/);
  assert.match(app, /if \(\[\.\.\.\(durableOwners \|\| \[\]\)\]\.some\(\(owner\) => owner !== key\)\) return false/);
});

test("adopted recovery task persists its authoritative checkpoint conversation URL", () => {
  assert.match(app, /const authoritativeCheckpointUrl = canonicalGptConversationUrl\(checkpointUrl\)/);
  assert.match(app, /conversationUrl: authoritativeCheckpointUrl \|\| activeConversationUrl/);
  assert.match(app, /browserConversationUrl: authoritativeCheckpointUrl \|\| activeConversationUrl/);
});

test("reviving a legacy image-boundary isolation clears only its stale recovery budget", () => {
  assert.match(app, /const revivingLegacyBoundary = isRetryableLegacyImageBoundaryQuarantine\(key, checkpoint\.requestId\)/);
  assert.match(app, /delete task\._windowRecoveryStartedAt/);
  assert.match(app, /delete task\._windowRecoveryDeadlineAt/);
  assert.match(app, /windowRecoveryAttempts: 0/);
  assert.match(app, /windowRecoveryExhaustedAt: null/);
  assert.match(app, /lastError: ""/);
});

test("orphan recovery restores the task-owned material conversation before account latest URL", () => {
  assert.match(app, /async function findDurableGptTaskConversationUrl\(accountId = "", task = \{\}, options = \{\}\)/);
  assert.match(app, /gptMaterialLogEntryMatchesTask\(task, item\)/);
  assert.match(app, /const durableTaskConversationUrl = await findDurableGptTaskConversationUrl\(key, task/);
  assert.match(app, /const ownedConversationUrl = durableTaskConversationUrl/);
  assert.match(app, /阻止跨作品串会话/);
  assert.match(app, /recoveryAction: "restore-task-conversation"/);
  assert.match(app, /window\.gptWorkbench\.navigate\("url", key, ownedConversationUrl\)/);
  assert.match(app, /禁止混用已归档旧作品/);
});

test("conversation-log hydration rejects contradictory material identity even when request id matches", () => {
  assert.match(app, /const requestIdMatch = requestIds\.has\(String\(entry\.requestId \|\| ""\)\.trim\(\)\)/);
  assert.match(app, /const hasEntryIdentity = \[entry\?\.materialName, entry\?\.materialPath, entry\?\.sourceMaterialPath\]/);
  assert.match(app, /return materialMatch \|\| requestIdMatch && !hasEntryIdentity/);
});

test("an ambiguous post-restart image boundary is isolated without pausing the continuous window", () => {
  assert.match(app, /function isAutoIsolatableGptWorkflowFailure\(errorOrResult = \{\}\)/);
  assert.match(app, /imageBoundaryCode === "IMAGE_COUNT_UNCERTAIN"[\s\S]*?reason: "image-count-uncertain-isolated"/);
  assert.match(app, /const imageBoundaryRetryable = \["IMAGE_RECOVERY_BOUNDARY_MISSING"\]\.includes\(imageBoundaryCode\)/);
  assert.match(app, /task\._status = "skipped";[\s\S]*?task\._isolationReason = "AUTO_RECOVERY_ISOLATED"/);
  assert.match(app, /workerState\.queueIndex \+= 1;[\s\S]*?workerState\.queuePaused = false;/);
  assert.match(app, /当前作品边界无法确认，已自动隔离；不重复出图，继续下一套/);
  assert.match(app, /if \(isolatableWorkflowFailure[\s\S]*?continue;/);
  const recoveryStart = app.indexOf("function scheduleIndependentGptAutoRecovery(accountId, result = {})");
  const recoveryEnd = app.indexOf("let gptHourlyHealthAuditInFlight", recoveryStart);
  const recoverySection = app.slice(recoveryStart, recoveryEnd);
  assert.match(recoverySection, /const isolatableWorkflowFailure = isAutoIsolatableGptWorkflowFailure/);
  assert.match(recoverySection, /reason: "image-boundary-isolated"/);
  assert.match(recoverySection, /deferIndependentGptTaskAfterAutomaticRecovery/);
  assert.match(app, /"IMAGE_RECOVERY_BOUNDARY_MISSING"/);
  assert.match(app, /当前作品缺少生图回复边界证据/);
});

test("image boundary recovery retries the confirmed image stage before isolation", () => {
  const recoveryStart = app.indexOf("function scheduleIndependentGptAutoRecovery(accountId, result = {})");
  const recoveryEnd = app.indexOf("let gptHourlyHealthAuditInFlight", recoveryStart);
  const recoverySection = app.slice(recoveryStart, recoveryEnd);
  assert.match(recoverySection, /imageBoundaryRetryRounds/);
  assert.match(recoverySection, /image-boundary-retry-scheduled/);
  assert.match(recoverySection, /task\.workflow\.imageSubmitted = true/);
  assert.match(recoverySection, /task\.forceUpload = false/);
  assert.match(recoverySection, /scheduleGptWindowRetry\(key, 15_000, "已确认计划，自动续接当前生图"\)/);
  assert.match(app, /windowRecoveryTaskId/);
  assert.match(gptSidebar, /skipLegacyImageRecovery/);
  assert.match(gptSidebar, /Let that handler resume the same image turn/);
});

test("restart hydration preserves a durable partial image boundary without requesting copy", () => {
  const hydrationStart = app.indexOf("async function hydrateGptWorkflowFromConversationLog");
  const hydrationEnd = app.indexOf("function isFalsePartialImageRecoveryAfterDurableArchive", hydrationStart);
  const hydrationSection = app.slice(hydrationStart, hydrationEnd);
  assert.match(hydrationSection, /hasDurableImageBoundary/);
  assert.match(hydrationSection, /imageBatchComplete = observedImageCount >= expectedImages/);
  assert.match(hydrationSection, /const copyRequested = imageBatchComplete && related\.some/);
  assert.match(hydrationSection, /imageBoundaryPartial: true/);
  assert.match(app, /const preservePostConfirmImageStage = laterWorkflowCheckpoint && !durableImagesComplete/);
});

test("a late completion cannot clear a newer account-window request", () => {
  assert.match(app, /const completedTaskId = String\(nextPatch\.completedTaskId \|\| ""\)\.trim\(\)/);
  assert.match(app, /previousRuntime\.currentTaskId[\s\S]*?completedTaskId[\s\S]*?return previousRuntime/);
  assert.match(app, /const differentActiveTask = Boolean\(/);
  assert.match(app, /completedTaskId: task\.requestId/);
});

test("recovery download timeout keeps the image-boundary error identity", () => {
  assert.match(gptSidebar, /恢复下载失败：等待 30 秒后仍没有找到最近一次生成图片/);
  assert.match(gptSidebar, /error\.code = "IMAGE_RECOVERY_BOUNDARY_MISSING"/);
  assert.match(gptSidebar, /no-fresh-image-turn-within-bounded-recovery/);
});

test("old archive reconciliation cannot clear a newer submitted recovery task", () => {
  assert.ok(app.includes("const anotherActiveSubmittedTask = targetQueue.some"));
  assert.ok(app.includes("if (anotherActiveSubmittedTask) continue;"));
  assert.ok(app.includes("submitted task still needs copy/download/archive recovery"));
});

test("a transient startup inspection retries durable checkpoint recovery before fresh selection", () => {
  assert.ok(app.includes("const gptWindowCheckpointRestorePromises = new Map()"));
  assert.ok(app.includes("restoreIndependentGptCheckpointAtStartup(key)"));
  assert.ok(app.includes("before admitting a fresh material"));
});

test("checkpoint fallback recovery preserves the original copy-request boundary", () => {
  assert.ok(app.includes("const checkpointCandidate = candidates[0]"));
  assert.ok(app.includes("checkpointTextSubmitted: checkpoint.textSubmitted === true"));
  assert.ok(app.includes("textSubmitted: inspection.checkpointTextSubmitted === true"));
  assert.ok(app.includes("latestImageUrls: Array.isArray(checkpoint.generatedImageUrls)"));
});

test("a stale conversation boundary leaves retry-wait after its finite budget", () => {
  const boundaryStart = app.indexOf('if (!verifiedBoundary\n            || (verifiedBoundary.canInjectNext === false && !currentTaskOwnsRecoverableBoundary))');
  assert.ok(boundaryStart >= 0, "expected the pre-submit conversation boundary guard");
  const boundaryEnd = app.indexOf('scheduleGptWindowRetry(key, 20_000, "上一套作品边界仍未释放")', boundaryStart);
  assert.ok(boundaryEnd > boundaryStart, "expected the bounded retry call");
  const boundarySection = app.slice(boundaryStart, boundaryEnd);
  assert.match(boundarySection, /boundaryRecoveryAttempts >= GPT_WINDOW_RECOVERY_MAX_ATTEMPTS/);
  assert.match(boundarySection, /deferIndependentGptTaskAfterAutomaticRecovery\(/);
  assert.match(boundarySection, /reason: "conversation-boundary-isolated"/);
  assert.match(boundarySection, /scheduleContinuousGptProduction\(1_500\)/);
  assert.match(boundarySection, /quarantine: true/);
});

test("exhausted window recovery quarantines the current task instead of requeueing the same last task", () => {
  const recoveryStart = app.indexOf("function scheduleGptWindowRetry(accountId = activeGptAccountId");
  const recoveryEnd = app.indexOf("function refreshGptWindowForAutomaticRecovery", recoveryStart);
  const recoverySection = app.slice(recoveryStart, recoveryEnd);
  assert.match(recoverySection, /当前作品已保存检查点并隔离/);
  assert.match(recoverySection, /quarantine: true/);
  assert.match(app, /function deferIndependentGptTaskAfterAutomaticRecovery\(accountId, reason = "当前作品暂时无法完成", options = \{\}\)/);
  assert.match(app, /const forceQuarantine = options\?\.quarantine === true/);
  assert.match(app, /const runtimeTaskId = String\(readGptWindowRuntime\(key\)\?\.currentTaskId \|\| ""\)\.trim\(\)/);
  assert.match(app, /runtimeTaskId \? state\.queue\.find\(\(item\) => String\(item\?\.requestId \|\| ""\) === runtimeTaskId\)/);
});

test("automatic quarantine survives restart and prevents history recovery from reopening the same request", () => {
  assert.match(app, /const GPT_AUTOMATIC_QUARANTINE_STORAGE_KEY = "teambuilding-gpt-automatic-quarantine-v1"/);
  assert.match(app, /function markAutomaticGptTaskQuarantined\(accountId, task, reason = ""\)/);
  assert.match(app, /function isAutomaticGptTaskQuarantined\(accountId, requestId\)/);
  assert.match(app, /!isAutomaticGptTaskQuarantined\(key, requestId\)/);
  assert.match(app, /if \(retryableLegacyBoundary\) return true/);
  assert.match(app, /markAutomaticGptTaskQuarantined\(key, task, task\._error\)/);
});

test("startup recovery does not re-adopt an already quarantined request", () => {
  const start = app.indexOf("async function restoreIndependentGptCheckpointAtStartup");
  const end = app.indexOf("function", start + 20);
  const block = app.slice(start, end > start ? end : start + 3000);
  assert.match(block, /const startupTaskIds = \[/);
  assert.match(block, /runtime\.currentTaskId/);
  assert.match(block, /state\.queue\?\.\[state\.queueIndex \|\| 0\]\?\.requestId/);
  assert.doesNotMatch(block.match(/const startupTaskIds = \[[\s\S]*?\]\.map/)?.[0] || "", /lastFailedTask/);
  assert.match(block, /startupTaskIds\.some\(\(requestId\) => isAutomaticGptTaskQuarantined\(key, requestId\)[\s\S]*?!isRetryableLegacyImageBoundaryQuarantine\(key, requestId\)\)/);
});

test("long ChatGPT conversations keep a finite inspection budget above the measured production boundary", () => {
  assert.match(app, /const GPT_INSPECT_CALL_TIMEOUT_MS = 18_000/);
  const inspectStart = desktopMain.indexOf('ipcMain.handle("desktop:gpt-inspect-status"');
  const inspectEnd = desktopMain.indexOf('ipcMain.handle("desktop:gpt-patrol-discover"', inspectStart);
  const inspectBlock = desktopMain.slice(inspectStart, inspectEnd);
  assert.match(inspectBlock, /\}, 15000\);/);
  assert.match(inspectBlock, /\}\)`?, 18000, null, `inspect:/);
  assert.match(app, /inspectStatus\?\.\(key\),[\s\S]{0,80}GPT_INSPECT_CALL_TIMEOUT_MS/);
});

test("window recovery hydrates its finite budget from persisted runtime after restart", () => {
  const recoveryStart = app.indexOf("function scheduleGptWindowRetry(accountId = activeGptAccountId");
  const recoveryEnd = app.indexOf("function refreshGptWindowForAutomaticRecovery", recoveryStart);
  const recoverySection = app.slice(recoveryStart, recoveryEnd);
  assert.match(recoverySection, /const activeTask = nextActiveQueueTask \|\| failedTask \|\| runtimeTask/);
  assert.match(recoverySection, /const recoveryTask = activeTask/);
  assert.match(recoverySection, /skipped: "no-active-task"/);
  assert.match(recoverySection, /persistedStartedAt = sameTaskRecovery[\s\S]*?recoveryTask\?\._windowRecoveryStartedAt/);
  assert.match(recoverySection, /persistedDeadlineAt = sameTaskRecovery[\s\S]*?recoveryTask\?\._windowRecoveryDeadlineAt/);
  assert.match(recoverySection, /persistedAttempts = Math\.max\([\s\S]*?recoveryTask\?\._windowRecoveryAttempts/);
  assert.match(recoverySection, /recoveryTask\?\._windowRecoveryExhaustedAt/);
  assert.match(recoverySection, /recoveryTask\._windowRecoveryDeadlineAt = recoveryState\.deadlineAt/);
  assert.match(recoverySection, /previousExhaustedAt > 0 \? GPT_WINDOW_RECOVERY_MAX_ATTEMPTS \+ 1 : 1/);
  assert.match(recoverySection, /taskId: currentTaskId/);
  assert.match(recoverySection, /window-recovery-cancelled-task-advanced/);
  assert.match(recoverySection, /status: "probing"[\s\S]*?网页\/桥接恢复已到时限/);
});

test("a readable workflow boundary closes stale window recovery before resuming the worker", () => {
  const recoveryStart = app.indexOf("function scheduleGptWindowRetry(accountId = activeGptAccountId");
  const recoveryEnd = app.indexOf("function refreshGptWindowForAutomaticRecovery", recoveryStart);
  const recoverySection = app.slice(recoveryStart, recoveryEnd);
  const readableStart = recoverySection.indexOf("if (readableWorkflowStage");
  const readableEnd = recoverySection.indexOf("if (shouldAutoRefreshGptWindowForRecovery", readableStart);
  const readableBlock = recoverySection.slice(readableStart, readableEnd);
  assert.match(readableBlock, /gptWindowRetryRecoveryStates\.delete\(key\)/);
  assert.match(readableBlock, /windowRecoveryStartedAt: null/);
  assert.match(readableBlock, /windowRecoveryTaskId: null/);
  assert.match(readableBlock, /window-recovered-readable-stage/);
  assert.match(readableBlock, /runIndependentGptWindow\(key, \{ force: true, automaticResume: true \}\)/);
  assert.doesNotMatch(readableBlock, /scheduleNextRecovery/);
});

test("a stopped non-generating image boundary is isolated before it can block the queue", () => {
  assert.match(app, /function autoIsolateStalledImageBoundary\(accountId, workerState, task, inspection\)/);
  assert.match(app, /stage !== "waiting-images"/);
  assert.match(app, /inspection\?\.generating === true/);
  assert.match(app, /已停止思考\|停止回答\|生成失败\|网页错误\|桥接/);
  assert.match(app, /task\._isolationReason = "STALLED_IMAGE_BOUNDARY"/);
  assert.match(app, /task\._errorCode = "AUTO_RECOVERY_ISOLATED"/);
  assert.match(app, /停滞作品已隔离，继续队列/);
  assert.doesNotMatch(app.match(/function autoIsolateStalledImageBoundary[\s\S]*?\n\}/)?.[0] || "", /isContinuousGptProductionArmed\(\)/);
  assert.match(app, /if \(autoIsolateStalledImageBoundary\(key, workerState, ownerTask, inspection\)\)/);
});

test("continuous window startup discards an exhausted historical queue before refilling", () => {
  assert.match(app, /if \(!workerState\.queue\.length\) \{[\s\S]*?buildGptProductionQueueForWindow\(workerState, settings\)[\s\S]*?workerState\.queueIndex = 0;[\s\S]*?\}/);
  assert.match(app, /workerState\.queue = \[\];[\s\S]*?workerState\.queueIndex = 0;[\s\S]*?workerState\.selectedMaterials = new Set\(\);[\s\S]*?selectLowestUsageGptEntries/);
});

test("continuous window removes quarantined persisted tasks before refilling", () => {
  const start = app.indexOf("async function ensureGptWindowWorkerQueue");
  const end = app.indexOf("function independentGptWindowMode", start);
  const block = app.slice(start, end);
  assert.match(block, /const quarantinedQueue = workerState\.queue\.filter/);
  assert.match(block, /isAutomaticGptTaskQuarantined\(key, task\?\.requestId\)/);
  assert.match(block, /workerState\.queue = workerState\.queue\.filter/);
  assert.match(block, /const currentTaskId = String\([\s\S]*?workerState\.queue\[Math\.max\(0, Number\(workerState\.queueIndex \|\| 0\)\)\]\?\.requestId/);
  assert.match(block, /const restoredIndex = currentTaskId[\s\S]*?findIndex/);
  assert.match(block, /workerState\.queueIndex = restoredIndex >= 0[\s\S]*?window\.GptWindowWorkerState\.nextPendingIndex\(workerState\)/);
  assert.match(block, /legacyTasks[\s\S]*!isAutomaticGptTaskQuarantined\(String\(accountId\), task\?\.requestId\)/);
  assert.match(block, /workerState\.queuePaused = false/);
});

test("continuous window removes persisted foreign-account queue copies before refilling", () => {
  const start = app.indexOf("async function ensureGptWindowWorkerQueue");
  const end = app.indexOf("async function adoptGptRuntimeQueueIntoWindowWorkers", start);
  const block = app.slice(start, end);
  assert.match(block, /foreignQueue/);
  assert.match(block, /owner !== key/);
  assert.match(block, /persistGptWindowWorkerState\(key, workerState\)/);
});

test("stopping a browser window aborts the active worker and the native GPT response", () => {
  assert.match(app, /stopCurrentTask\?\.\(accountId, activeTask\.requestId\)/);
  assert.match(app, /setUserHold\?\.\(accountId, true\)/);
  assert.match(app, /setUserHold\?\.\(accountId, false\)/);
  assert.match(desktopPreload, /stopCurrentTask\(accountId = "", requestId = "", options = \{\}\)/);
  assert.match(desktopPreload, /setUserHold\(accountId = "", held = false\)/);
  assert.match(desktopMain, /desktop:gpt-stop-current-task/);
  assert.match(desktopMain, /desktop:gpt-set-user-hold/);
  assert.match(desktopMain, /tb-workbench-stop-current-task/);
  assert.match(gptSidebar, /function stopWorkbenchTask\(message = \{\}\)/);
  assert.match(gptSidebar, /task\.stopRequested = true/);
  assert.match(gptSidebar, /task\.controller\?\.abort\(\)/);
  assert.match(gptSidebar, /function visibleGenerationStopButton\(\)/);
  assert.match(gptSidebar, /tb-workbench-stop-current-task/);
  assert.match(gptSidebar, /USER_STOPPED_BY_USER/);
});

test("heartbeat recovery refreshes after the settled worker released its page task", () => {
  assert.match(app, /async function refreshGptWindowForAutomaticRecovery\(accountId = activeGptAccountId, reason = "automatic-readiness-recovery", options = \{\}\)/);
  assert.match(app, /allowActiveTaskRecovery/);
  assert.match(app, /refreshGptWindowForAutomaticRecovery\(key, "workflow-heartbeat-lost", \{[\s\S]*?allowActiveTaskRecovery: true[\s\S]*?requestId: task\.requestId/);
});

test("exhausted window recovery quarantines the current work instead of reopening retry wait", () => {
  assert.match(app, /function scheduleGptWindowRetry[\s\S]*?const deferred = deferIndependentGptTaskAfterAutomaticRecovery\(/);
  assert.match(app, /const deferred = deferIndependentGptTaskAfterAutomaticRecovery\([\s\S]*?if \(deferred\.action === "quarantine" \|\| deferred\.action === "defer"\)[\s\S]*?scheduleContinuousGptProduction\(1_500\)/);
  assert.match(app, /当前作品已保存检查点并隔离/);
  assert.match(app, /quarantine: true/);
  assert.match(app, /\{ quarantine: true, requestId: recoveryState\.taskId \}/);
});

test("patrol preserves the complete image set across copy retries and restart before packaging", () => {
  assert.match(gptSidebar, /preferredRecoveryImageUrls\(imageUrls, record\.generatedImageUrls \|\| \[\]\)/);
  assert.match(gptSidebar, /Number\(record\.expectedImageCount \|\| 0\)/);
  assert.match(gptSidebar, /generatedImageUrls: decision\.action === "request-copy"/);
  assert.match(gptSidebar, /expectedImageCount: decision\.action === "request-copy"/);
  assert.match(gptSidebar, /reason: "downloaded-image-set-incomplete"/);
  assert.match(gptSidebar, /expectedImageCount: expectedRecoveryImages \|\| downloadResult\.count/);
});

test("normal production restart recovery prefers the latest web plan over attachment estimates", () => {
  assert.match(gptSidebar, /resolveRecoveredPlannedImageCount/);
  assert.match(gptSidebar, /planText: latestRecoverablePlanText\(\)/);
  assert.match(gptSidebar, /a 10-page plan can never be downgraded to a 5-image package/);
  assert.match(gptSidebar, /workflow\.downloadResult\.count \|\| 0\) < workflow\.plannedImageCount/);
  assert.match(gptSidebar, /effectiveGeneratedImageCount/);
  assert.match(gptSidebar, /detectedCount: actualImageCount/);
  assert.match(gptSidebar, /task\.entry\.generatedImages = detectedCount/);
  assert.match(gptSidebar, /实际只下载 \$\{downloadedImages\}\/\$\{workflow\.plannedImageCount\} 张，禁止打包归档/);
});

test("image detection is stable across signed URL refreshes and multi-reply batches", () => {
  assert.match(gptSidebar, /generatedImageIdentity/);
  assert.match(gptSidebar, /newGeneratedImageUrls\(nativeUrls, baselineUrls\)/);
  assert.match(gptSidebar, /nativeUrls\.push\(\.\.\.generatedImageNodes\(turn\)/);
  assert.match(gptSidebar, /freshGeneratedImageUrls\(baselineUrls, detectionOptions\)/s);
  assert.match(gptSidebar, /limitGeneratedImageUrls\(\s*(?:observedImageUrls|imageUrls)/s);
  assert.match(gptSidebar, /newGeneratedImageUrls\(imageDetection\.urls, imageUrls\)/);
  assert.match(gptSidebar, /detected = limitGeneratedImageUrls\(imageUrls, expectedImages\)/);
});

test("GPT 虚拟化缩略图不会让同一批次的图片证据回退", () => {
  assert.match(gptSidebar, /let observedImageUrls = \[\]/);
  assert.match(gptSidebar, /observedImageUrls = uniqueGeneratedImageUrls\(\[\.\.\.observedImageUrls, \.\.\.detectedImageUrls\]\)/);
  assert.match(gptSidebar, /const liveImageEvidenceCache = new Map\(\)/);
  assert.match(gptSidebar, /stableImageEvidenceKey/);
  assert.match(gptSidebar, /latestImages = uniqueGeneratedImageUrls\(\[\.\.\.previousImages, \.\.\.observedLatestImages\]\)/);
});

test("patrol continuation consumes its package result into one completed user-visible history row", () => {
  assert.match(app, /function recordPatrolPackageResult\(/);
  assert.match(app, /recordPatrolPackageResult\(item, result\)/);
  assert.match(app, /gptProductionHistory\s*=\s*gptProductionHistory\.filter\(\(entry\) => entry\.requestId !== requestId\)/);
  assert.match(app, /status:\s*"completed"/);
  assert.match(gptSidebar, /productionRequestId:\s*String\(options\.requestId/);
});

test("a recovered task clears stale failure metadata after successful completion", () => {
  assert.match(app, /task\._status = "completed";\s*task\._percent = 100;\s*task\._error = "";\s*delete task\._errorCode;/);
});

test("fresh workflow progress clears stale recovery errors while the same task is running", () => {
  assert.match(app, /status\?\.requestId === task\.requestId/);
  assert.match(app, /task\._status === "running" && \(task\._error \|\| task\._errorCode\)/);
  assert.match(app, /task\._error = "";[\s\S]{0,80}task\._errorCode = "";/);
  assert.match(app, /const activeWorkflowProgress = \["running", "probing"\]/);
  assert.match(app, /nextPatch\.lastDeferredError = ""/);
});

test("account-worker completion clears stale errors before persisting a completed task", () => {
  assert.match(app, /task\._status = "completed";\s*task\._percent = 100;\s*task\._error = "";\s*task\._errorCode = "";[\s\S]{0,420}markGptWindowSetCompleted\(account\.id, task\.requestId\)/);
});

test("manual distribution sends the exact workbench-validated source after Junction removal", () => {
  assert.match(server, /function resolveDistributionCollectionSource\(collectionName, options = \{\}\)/);
  assert.match(server, /collection\.workflowStage !== "mobile"/);
  assert.match(server, /options\.automatic === true[\s\S]{0,160}collection\.automaticEligible === true[\s\S]{0,160}collection\.manualEligible === true/);
  assert.match(server, /const args = \["--source", selected\.source, "--device"/);
  assert.match(server, /path\.join\(DEVICE_TRANSFER_ROOT, "scripts", "send_to_device\.py"\)/);
});

test("distribution keeps its controls fixed while its active panel scrolls independently", () => {
  assert.match(html, /id="distributionView"[\s\S]*?class="distribution-sticky-shell"[\s\S]*?id="distributionTabs"/);
  assert.match(html, /class="distribution-command-bar"[\s\S]*?<h2>文件传输<\/h2>[\s\S]*?id="distributionDropZone"/);
  assert.doesNotMatch(html, /<p class="label">电脑 ↔ 手机 \/ 设备<\/p>/);
  assert.doesNotMatch(html, /统一发送作品、普通文件和文件夹；真实传输、库存、失败恢复和记录继续沿用/);
  assert.match(css, /\.distribution-command-bar\s*\{[^}]*min-height:\s*48px[^}]*display:\s*flex/s);
  assert.match(css, /\.distribution-drop-zone\s*\{[^}]*display:\s*inline-flex[^}]*min-height:\s*36px/s);
  assert.match(css, /\.distribution-sticky-shell\s*\{[^}]*border:\s*1px solid[^}]*border-radius:\s*var\(--radius-card\)[^}]*box-shadow:\s*var\(--soft-shadow\)/s);
  assert.match(css, /#distributionView\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.distribution-layout\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.distribution-panel\.active\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.distribution-panel-fixed\s*\{[^}]*position:\s*sticky/s);
  assert.match(app, /class="distribution-panel-fixed"/);
  assert.match(app, /class="package-list distribution-panel-scroll"/);
  assert.match(css, /body\.device-picker-open\s*\{\s*overflow:\s*hidden/);
  assert.match(app, /function syncDevicePickerModalState\(\)/);
  assert.match(app, /function dismissDevicePicker\(\)/);
  assert.match(app, /if \(event\.key === "Escape"\)[\s\S]{0,120}dismissDevicePicker\(\)/);
});

test("distribution history has bounded automatic source tabs and readable fields", () => {
  assert.match(app, /\["all", "全部"\], \["manual", "设备与文件记录"\], \["auto", "自动分发记录"\]/);
  assert.match(app, /作品\/来源：\$\{escapeHtml\(row\.source\)\}/);
  assert.match(app, /设备\/目标：\$\{escapeHtml\(row\.target\)\}/);
  assert.match(app, /row\.details\.map\(\(detail\) =>/);
  assert.match(app, /role="img" aria-label="\$\{row\.channel === "auto" \? "自动事件" : "手动事件"\}"/);
  assert.match(app, /row\.channel === "auto" \? "↻" : "↗"/);
  assert.match(app, /updateLiveDistributionSnapshot\(data\)/);
  assert.match(app, /data\.automationHistory \|\| \[\]\)\.length/);
  assert.match(css, /\.distribution-event-log\s*\{[^}]*max-height:/s);
  assert.match(css, /\.distribution-event-details\s*\{/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
});

test("distribution history filters use the shared rounded control style", () => {
  assert.match(css, /\.distribution-history-tabs button\s*\{[\s\S]*?padding:\s*0 12px;[\s\S]*?border-radius:\s*var\(--radius-control\);/);
  assert.match(css, /\.distribution-history-tabs button\.active\s*\{[\s\S]*?border-color:/);
  assert.match(css, /\.distribution-history-tabs button:hover:not\(\.active\)/);
  assert.match(css, /\.distribution-history-tabs button:focus-visible:not\(\.active\)/);
});

test("automatic distribution exposes retry settings and uses the live device transport name", () => {
  assert.match(html, /id="autoDistributionRetryLimit"/);
  assert.match(app, /autoRetryLimit:\s*Number\(\$\("#autoDistributionRetryLimit"\)/);
  assert.match(server, /deviceTransportTarget\(liveRecord/);
  assert.match(server, /automaticMaxAttempts:\s*maxAttempts/);
  assert.match(server, /classifyAutomaticDistributionError/);
  assert.match(server, /retryOnReconnect/);
  assert.match(server, /receiver_update_required/);
});

test("production account chip keeps only the current window name", () => {
  assert.match(html, /class="gpt-current-account-chip"[^>]*title="当前窗口"/);
  assert.doesNotMatch(html, /gpt-current-account-chip[^>]*>\s*账号\s*<strong/);
});

test("后台设备监测使用双向 UDP 快速发现并只补充已发现手机库存", () => {
  assert.match(server, /function deviceStatusScanArgs\(mode = "background"\)/);
  assert.match(server, /: "--status-background"/);
  assert.match(server, /DEVICE_STATUS_SCAN_TIMEOUT_MS = 18_000/);
  assert.match(server, /deviceStatusScanArgs\(mode\)/);
  assert.match(server, /automaticDistributionScanInFlight/);
  assert.match(server, /deviceLabel:\s*device\?\.note/);
  assert.match(server, /deviceModel:\s*liveRecord\.model/);
  assert.match(app, /系统会自动检测，也可点击“刷新设备”立即检查/);
  assert.match(app, /系统会自动检测局域网接收端；手机上线后会显示在这里/);
});

test("automatic distribution re-evaluates an online device after inventory changes", () => {
  assert.match(server, /const automaticDistributionSessions = new Map\(\)/);
  assert.match(server, /automaticDistributionDecisionFingerprint\(liveRecord, settings, eligible, admission\)/);
  assert.match(server, /selectDeviceInventory\(liveRecord, settings\.autoCategory\)/);
  assert.match(server, /hasWorkDistributionClaim\(WORK_DISTRIBUTION_CLAIMS_ROOT/);
  assert.match(server, /automaticDistributionActiveDeviceKeys\.has\(key\)/);
  assert.match(server, /automaticDistributionSessions\.get\(key\) === decisionFingerprint/);
  assert.match(server, /event:\s*"evaluated"/);
  assert.match(server, /skipReason/);
});

test("automatic distribution uses the work-package library as its normal source", () => {
  assert.match(html, /id="distributionCollectionRootInput"/);
  assert.match(html, /手机库存按自动推送分类判断；当前默认精准流量低于 5 个才补发/);
  assert.doesNotMatch(html, /id="distributionTrafficSendRoot"/);
  assert.doesNotMatch(html, /id="distributionConversionSendRoot"/);
  assert.match(server, /legacyAdditionalRootsEnabled/);
  assert.match(server, /legacyAdditionalRootsEnabled !== true/);
});

test("global help explains the six user-facing questions after a three-second hover", () => {
  assert.match(app, /WORKBENCH_TOOLTIP_DELAY_MS = 3000/);
  for (const label of ["背景", "用途", "它是什么", "怎么用", "如何运行", "为什么"]) assert.match(app, new RegExp(label));
  assert.match(app, /distributionDropZone:/);
  assert.match(app, /distributionRefreshBtn:/);
  assert.match(app, /function workbenchHelpTarget/);
  assert.match(app, /WORKBENCH_HELP_MODULE_SELECTOR/);
  assert.match(html, /id="distributionDropZone"[^>]*data-tooltip="拖入文件或文件夹"/);
  assert.match(css, /\.workbench-delayed-tooltip-title/);
  assert.match(css, /\.workbench-delayed-tooltip-row/);
});

test("server request parsing avoids the deprecated legacy URL parser", () => {
  assert.doesNotMatch(server, /url\.parse\(req\.url/);
  assert.match(server, /new URL\(req\.url \|\| "\/"/);
  assert.match(server, /query: Object\.fromEntries\(requestUrl\.searchParams\.entries\(\)\)/);
});

test("silent device scans retry through a short desktop server restart", () => {
  assert.match(app, /transientNetworkFailure = \/网络请求失败（\\\/api\\\/distribution\\\/check）\//);
  assert.match(app, /options\.silent && transientNetworkFailure && retryCount < 2/);
  assert.match(app, /networkRetry: retryCount \+ 1/);
});

test("desktop exposes an isolated native WeChat draft browser surface", () => {
  assert.match(desktopMain, /persist:teambuilding-wechat-draft/);
  assert.match(desktopMain, /desktop:wechat-draft-show/);
  assert.match(desktopMain, /desktop:wechat-draft-hide/);
  assert.match(desktopMain, /desktop:wechat-draft-status/);
  assert.match(desktopMain, /desktop:wechat-draft-run/);
  assert.match(desktopMain, /Promise\.resolve\(draftSession\.flushStorageData\(\)\)/);
  assert.match(desktopMain, /function loadWechatUrlBounded/);
  assert.match(desktopMain, /contents\.once\("dom-ready"/);
  assert.match(desktopPreload, /wechatWorkbench/);
  assert.match(desktopPreload, /ipcRenderer\.invoke\("desktop:wechat-draft-show"/);
  assert.match(desktopPreload, /ipcRenderer\.invoke\("desktop:wechat-draft-run"/);
  assert.match(desktopMain, /for \(let index = 0; index < payload\.images\.length; index \+= 1\)/);
  assert.match(desktopMain, /payload\.images\[index\]/);
});

test("desktop Ctrip draft automation uses the real picture-text editor and only saves drafts", () => {
  assert.match(desktopMain, /CTRIP_PICTURE_TEXT_URL = "https:\/\/we\.ctrip\.com\/publish\/publishPictureText"/);
  assert.match(desktopMain, /buildCtripDraftProbeScript/);
  assert.match(desktopMain, /locationRequired/);
  assert.match(desktopMain, /locationReady/);
  assert.match(desktopMain, /stage: "location-required"/);
  assert.match(desktopMain, /role === "textbox"/);
  assert.match(desktopMain, /role === "combobox"/);
  assert.match(desktopMain, /normalizeCtripTopics/);
  assert.match(desktopMain, /appendCtripTopics/);
  assert.match(desktopMain, /Array\.from\(body\)\.length > 3_000/);
  assert.match(desktopMain, /buildCtripDraftSaveScript/);
  assert.match(desktopMain, /存草稿/);
  assert.match(desktopMain, /DOM\.setFileInputFiles/);
  assert.match(desktopMain, /desktop:ctrip-draft-run/);
  assert.match(desktopPreload, /ctripDraft\(input = \{\}\)/);
  assert.match(desktopPreload, /ipcRenderer\.invoke\("desktop:ctrip-draft-run"/);
  assert.match(desktopPreload, /topics: Array\.isArray\(input\.topics\)/);
  assert.match(app, /function ctripDraftTopicCandidates\(post = null\)/);
  assert.match(app, /function ctripDraftBodyFromPost\(post = null\)/);
  assert.match(app, /function ctripDraftTitleFromPost\(post = null\)/);
  assert.match(app, /function ctripDraftImagePathsFromPost\(post = null\)/);
  assert.match(app, /function ctripDraftPostEligibility\(post = null\)/);
  assert.match(app, /图片超过10张上限/);
  assert.match(app, /imageCount > 20/);
  assert.match(app, /function publishingPostUsable\(post, platform\)/);
  assert.match(app, /ctripDraftPostsFromSelection\(\)[\s\S]{0,180}publishingPostUsable/);
  assert.match(app, /stoppedForLocation/);
  assert.match(app, /请先在右侧携程页面选择地点后重试/);
  assert.match(app, /title: ctripDraftTitleFromPost\(post\)/);
  assert.match(app, /topics: ctripDraftTopicCandidates\(post\)/);
  assert.match(app, /Array\.from\(item\.body\)\.length > 3000/);
  assert.match(app, /只允许调用“存草稿”/);
  assert.doesNotMatch(desktopMain, /runCtripDraft[\s\S]{0,500}button\.click\(\)[\s\S]{0,500}发布/);
});

test("WeChat publishing stays live inside the unified online platform workspace", () => {
  assert.match(html, /data-tab="publishing"[^>]*>[\s\S]*?<span>在线分发<\/span>/);
  assert.match(html, /id="publishingView"[\s\S]*?data-publishing-platform="wechat"[\s\S]*?id="distributionOfficial"/);
  assert.match(app, /publishingView:\s*"在线分发/);
  assert.match(app, /五个平台统一打开官方网页/);
  assert.match(app, /if \(name === "publishing"\)[\s\S]{0,360}activeDistributionPanel = "official"/);
  assert.match(app, /#publishingView/);
  const distributionTabItems = app.match(/const tabItems = \[([\s\S]*?)\];/)?.[1] || "";
  assert.doesNotMatch(distributionTabItems, /\["official",\s*"微信公众号可发"/);
});

test("native WeChat editor stays inside the visible workbench viewport", () => {
  assert.match(app, /const visibleLeft = Math\.max\(0, rect\.left\)/);
  assert.match(app, /const visibleTop = Math\.max\(0, rect\.top\)/);
  assert.match(app, /const visibleRight = Math\.min\(window\.innerWidth - 8, rect\.right\)/);
  assert.match(app, /const visibleBottom = Math\.min\(window\.innerHeight - 8, rect\.bottom\)/);
  assert.match(html, /class="publishing-workbench"[\s\S]*?class="publishing-library-pane"/);
  assert.match(html, /class="publishing-library-pane"[\s\S]*?<h3>成品区<\/h3>/);
  assert.match(html, /id="publishingCollectionList"/);
  assert.match(html, /id="wechatDraftRight"/);
  assert.match(css, /\.publishing-workbench\s*\{[\s\S]*?grid-template-columns:\s*minmax\(290px, 360px\) minmax\(0, 1fr\)/);
  assert.match(css, /\.publishing-library-pane\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.wechat-draft-detail-card\s*\{[\s\S]*?height:\s*100%/);
});

test("多平台分发按作品平台使用标签筛选，并提供明确的人工确认记录入口", () => {
  assert.match(app, /function publishingWorkEligibility\(work = \{\}, platform = activePublishingPlatformId\(\)\)/);
  assert.match(html, /data-publishing-library-availability="available"/);
  assert.match(html, /data-publishing-library-availability="used"/);
  assert.match(app, /function publishingPostMatchesAvailability\(post = null, platform = activePublishingPlatformId\(\)\)/);
  assert.match(app, /let publishingLibraryAvailabilityFilter = "available"/);
  assert.match(app, /platformVisibleOfficialCollections = visibleOfficialCollections\.filter/);
  assert.match(app, /wechatDraftSelectedCollection = ""/);
  assert.match(app, /function publishingPostTagLabels\(post = null\)/);
  assert.match(app, /class="post-card-tags"/);
  assert.match(app, /function selectFirstEligiblePublishingPost\(\)/);
  assert.match(app, /if \(!publishingPostUsable\(wechatDraftPosts\[index\], activePublishingPlatformId\(\)\)\)/);
  assert.match(app, /publishingPostEligibility\(post, activePlatform\)\.eligible/);
  assert.match(app, /data-mark-platform-used="true"/);
  assert.match(app, /\/api\/platform-publishing\/mark-used/);
  assert.match(app, /我已发布，记录标签/);
  assert.match(app, /这篇成品下次会自动排除/);
  assert.match(server, /platformUsageTagGroups/);
  assert.match(server, /legacy_device_distribution/);
  assert.match(server, /recordPlatformUsage: recordPlatformUsageForRoute/);
  assert.match(css, /\.wechat-draft-post-card\.platform-excluded/);
  assert.match(css, /\.publishing-selection-summary\.is-excluded/);
  assert.match(css, /\.publishing-usage-confirm/);
});

test("在线分发摘要区分当前平台可发、当前平台已用和当前筛选结果", () => {
  assert.match(app, /const searched = visibleOfficialCollections\.filter/);
  assert.match(app, /const platformUsedCount = searchedWorks\.filter/);
  assert.match(app, /当前\$\{filterLabel\}筛选/);
  assert.match(app, /个可发、\$\{platformUsedCount\} 个已用/);
  assert.match(server, /const hasSuccessfulDeviceDistribution = distribution\.duplicateBlocked === true/);
  assert.match(server, /distributed: hasSuccessfulDeviceDistribution/);
  assert.doesNotMatch(server, /distributed: distribution\.automaticEligible === false/);
});

test("device distribution removes permanent stranger blocking and exposes one-time approval", () => {
  assert.doesNotMatch(html, /陌生设备始终禁止|新设备第一次出现只会显示“陌生设备”/);
  assert.match(app, /data-approve-device/);
  assert.match(app, /firstConfirmationRequired/);
  assert.match(app, /首次自动分发需确认/);
  assert.doesNotMatch(app, /可信设备在线/);
  assert.match(server, /\/api\/devices\/approve/);
  assert.match(server, /DEVICE_DISTRIBUTION_APPROVALS_FILE/);
  assert.match(server, /onlineDevices\.filter\(\(device\) => device\.current !== false\)\.length/);
  assert.doesNotMatch(server, /陌生设备或尚未确认的设备不允许传送/);
});

test("WeChat draft UI defaults to native web automation and records confirmed saves", () => {
  assert.match(app, /wechatWebEditorOpen/);
  assert.match(app, /id="publishingPlatformWebHost"/);
  assert.doesNotMatch(html, /id="wechatWebHost"/);
  assert.match(app, /window\.wechatWorkbench\.runDraft/);
  assert.match(app, /\/api\/wechat-draft\/web\/prepare/);
  assert.match(app, /\/api\/wechat-draft\/web\/complete/);
  assert.match(app, /value="web"[^>]*>原生网页/);
  assert.match(app, /value="api"[^>]*>官方 API/);
  assert.match(app, /id="wechatDraftType"/);
  assert.match(app, /value="newspic"[^>]*>贴图（当前默认）/);
  assert.match(app, /value="article"[^>]*>文章（长图文/);
  assert.match(app, /const task = \{ postPath: post\.path, title, body, account, draftType, forceCreate \}/);
  assert.match(app, /draftType,\s*autoSave: true/);
});

test("formal WeChat web batches claim and persist each queue item before continuing", () => {
  assert.match(app, /\/api\/wechat-draft\/batch\/claim-next/);
  assert.match(app, /\/api\/wechat-draft\/batch\/update/);
  assert.match(app, /processWechatWebBatchNext/);
  assert.match(server, /batch\/claim-next/);
  assert.match(server, /batch\/update/);
});

test("dashboard refresh preserves a loaded WeChat draft workspace", () => {
  assert.match(app, /let wechatDraftLoadedCollection = ""/);
  assert.match(app, /function restoreWechatDraftWorkspaceAfterRender\(\)/);
  assert.match(app, /wechatDraftLoadedCollection === wechatDraftSelectedCollection/);
  assert.match(app, /if \(wechatDraftSelectedCollection !== collectionName\) return/);
  assert.match(app, /const currentRight = \$\("#wechatDraftRight"\)/);
});

test("image preview close control uses a stable SVG icon and safe mobile geometry", () => {
  assert.match(app, /class="image-lightbox-close"[^>]*aria-label="返回作品预览"[^>]*><svg/);
  assert.match(app, /class="image-lightbox-close"[^>]*aria-label="返回文本预览"[^>]*><svg/);
  assert.match(css, /\.image-lightbox\{[^}]*padding:clamp\(/);
  assert.match(css, /\.image-lightbox-close svg\{[^}]*stroke-linecap:round/);
  assert.match(css, /@media \(max-width:560px\)\{\.image-lightbox\{/);
});

test("作品预览对话框关闭控件 uses a stable SVG icon", () => {
  assert.match(app, /class="preview-close"[^>]*aria-label="返回作品预览"[^>]*><svg/);
  assert.match(css, /\.work-preview-dialog\s*\{[^}]*position:\s*relative/);
  assert.match(css, /\.preview-close\s+svg\s*\{[^}]*stroke-linecap:\s*round/);
});

test("manual, assistant and voice entry points share the registered workbench command bus", () => {
  assert.match(html, /workbench-command-bus\.js/);
  assert.match(html, /id="workbenchAssistantVoice"/);
  assert.match(commandBus, /function createWorkbenchCommandBus/);
  assert.match(commandBus, /actionId/);
  assert.match(commandBus, /source/);
  assert.match(app, /id: "assistant\.text"/);
  assert.match(app, /id: "gpt\.continue"/);
  assert.match(app, /id: "gpt\.toggle-pause"/);
  assert.match(app, /id: "gpt\.retry"/);
  assert.match(app, /id: "gpt\.diagnostic"/);
  assert.match(app, /id: "workspace\.context"/);
  assert.match(app, /\/api\/workbench-control\/context/);
  assert.match(server, /pathname === "\/api\/workbench-control\/context"/);
  assert.match(server, /WORKBENCH_CONTEXT_SOURCE_FILES/);
  assert.match(server, /WORKBENCH_CONTEXT_LOG_FILES/);
  assert.match(app, /dispatchWorkbenchCommand\(\{ actionId: "assistant\.text", source: "assistant"/);
  assert.match(app, /dispatchWorkbenchCommand\(\{ actionId: "assistant\.text", source: "voice"/);
  assert.match(app, /window\.workbenchControl = Object\.freeze/);
});
