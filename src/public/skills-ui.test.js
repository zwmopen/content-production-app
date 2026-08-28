const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const panel = fs.readFileSync(path.join(__dirname, "moments-publisher-panel.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const skillsRoute = fs.readFileSync(path.join(__dirname, "..", "server", "routes", "skills.js"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("Skill view is registered without replacing the existing sidebar", () => {
  assert.match(html, /id="skillsView"/);
  assert.match(html, /id="skillsGrid"/);
  assert.match(html, /data-tab="skills"/);
  assert.match(html, /<span>技能中心<\/span>/);
  assert.match(app, /loadSkillsCatalog/);
  assert.match(app, /<strong>介绍<\/strong>/);
  assert.match(app, /aria-current/, "sidebar tabs expose the active page to assistive technology");
  assert.doesNotMatch(html, /skills-ui\.js/);
  assert.match(html, /<span>技能中心<\/span>/);
  assert.match(app, /documentationOnly/);
  assert.match(app, /class="skill-run-flow"/);
});

test("技能中心只保留可执行技能卡和紧凑工具入口", () => {
  assert.match(html, /id="skillsExecutableSection"/);
  assert.match(app, /function skillCardHtml/);
  assert.match(app, /function isDocumentationSkill/);
  assert.match(app, /function updateSkillsCenterStatus/);
  assert.match(app, /data-skill-template-input/);
  assert.match(app, /data-template-repository-open/);
  assert.match(app, /data-template-repository-run/);
  assert.match(app, /function runTemplateRepositorySkillCard/);
  assert.match(app, /项可执行/);
  assert.doesNotMatch(html, /skillsNextAction/);
  assert.doesNotMatch(html, /skillsToolsSection|skillsWorkflowDetails|skillsDocsSection|skillsDocsGrid/);
  assert.doesNotMatch(app, /skillsNextAction|focusSkillCard|openSkillTool/);
  assert.doesNotMatch(styles, /skills-next-action|skills-summary|skills-docs-section|skills-workflow-details/);
  assert.match(styles, /\.skill-quick-entry/);
});

test("技能目录加载共享同一个 Promise，设置入口不会撞上加载竞态", () => {
  assert.match(app, /let skillsLoadPromise = null/);
  assert.match(app, /if \(skillsLoadPromise\) return skillsLoadPromise/);
  assert.match(app, /skillsLoadPromise = \(async \(\) =>/);
  assert.doesNotMatch(app, /if \(skillsLoadInFlight\) return/);
});

test("素材处理和朋友圈设置归属技能中心，不再渲染到设置中心", () => {
  assert.match(html, /id="skillsCenterSettingsBtn"/);
  assert.doesNotMatch(html, /id="momentsSettingsCard"|id="skillsSettingsCard"/);
  assert.doesNotMatch(html, /id="materialIngestionSkillEnabled"|id="materialIngestionSourceRoot"|id="materialIngestionMaterialRoot"/);
  assert.doesNotMatch(html, /data-settings-jump="skills"/);
  assert.match(html, /id="contextSkillSettings"/);
  assert.match(html, /id="contextSkillPaths"/);
  assert.match(app, /jianghu-toolbox-material-ingestion/);
  assert.match(app, /previewTaskId/);
  assert.match(app, /确认预览并整理素材/);
  assert.match(app, /material_ingestion/);
  assert.match(app, /data-skill-card/);
  assert.match(app, /contextSkillSettings/);
  assert.match(app, /data-help-background/);
  assert.match(app, /api\/skills\/jianghu-toolbox-material-ingestion\/settings/);
  assert.match(app, /function skillsCenterSettingsHtml/);
  assert.match(app, /function openSkillsCenterSettingsPanel/);
  assert.match(app, /data-skill-context-field="momentsEnabled"/);
  assert.match(app, /data-skill-context-field="autoOpenWeChat"/);
  assert.match(app, /data-skill-context-field="triggerMode"/);
  assert.match(app, /data-skill-context-field="selectionRule"/);
  assert.match(app, /data-skill-context-field="scheduleTimes"/);
  assert.match(app, /data-skill-context-field="scheduleWindowStart"/);
  assert.match(app, /data-skill-context-field="scheduleWindowEnd"/);
  assert.match(app, /data-skill-context-field="dailyAutoLimit"/);
  assert.match(app, /每日自动准备条数/);
});

test("技能中心工具入口收进技能卡，并保留延迟说明与右键上下文入口", () => {
  assert.match(app, /const isMaterialDownload = skill\.id === "material-download"/);
  assert.match(app, /const isTemplateSkill = skill\.id === "template-repository-maintainer"/);
  assert.match(app, /data-tooltip="\$\{escapeHtml\(/);
  assert.match(app, /event\.target\.closest\?\.\("\[data-skill-card\], \[data-skill-module\]"\)/);
  assert.match(app, /function workbenchHelpCopy[\s\S]*data\.helpBackground/);
});

test("技能卡右键菜单按技能显示专属入口，并在当前界面弹窗", () => {
  assert.doesNotMatch(html, /contextCopySkillId/);
  assert.match(app, /function skillContextMeta/);
  assert.match(app, /function openSkillContextPanel/);
  assert.match(app, /素材处理设置/);
  assert.match(app, /设置素材处理路径/);
  assert.match(app, /设置朋友圈素材目录/);
  assert.match(app, /openSkillContextPanel\(target, "settings"\)/);
  assert.match(app, /openSkillContextPanel\(target, "paths"\)/);
  assert.match(app, /openSkillContextPanel\(target, "source"\)/);
  assert.match(app, /data-skill-open[\s\S]*openSkillContextPanel\(\{/);
  assert.match(styles, /\.skill-context-backdrop/);
  assert.match(styles, /\.skill-context-input-row/);
  assert.doesNotMatch(app, /copyText\(target\?\.skillId/);
});

test("技能卡默认紧凑，详细内容只交给三秒悬浮提示", () => {
  assert.match(styles, /Compact skill cards/);
  assert.match(styles, /grid-template-columns:\s*repeat\(auto-fill, minmax\(260px, 1fr\)\)/);
  assert.match(styles, /\.skill-flow-list,\s*\.skill-card-details,\s*\.skill-safety,\s*\.skill-connector-row\s*\{\s*display: none !important;/);
  assert.match(app, /WORKBENCH_TOOLTIP_DELAY_MS = 3000/);
  assert.match(app, /function workbenchHelpTarget/);
  assert.match(app, /\.workflow-rail \.rail-tab/);
  assert.match(app, /const spaceAbove = Math\.max/);
  assert.match(app, /tip\.style\.maxHeight/);
  assert.match(app, /WORKBENCH_HELP_MODULE_SELECTOR/);
  assert.match(app, /WORKBENCH_HELP_CONTROL_SELECTOR/);
  assert.match(app, /data-help-module="true"/);
  assert.doesNotMatch(app, /悬停查看说明|skill-card-help-cue/);
  assert.match(app, /aria-label="\$\{escapeHtml\(`\$\{displayTitle\}：\$\{skill\.description\}`\)\}"/);
  assert.doesNotMatch(app, /data-skill-card="\$\{escapeHtml\(skill\.id\)\}"[^>]*title=/);
});

test("技能卡悬浮说明合并为介绍，启动后展示带箭头的运行步骤", () => {
  assert.match(app, /const skillCard = target\?\.closest\?\.\("\[data-skill-card\]"\)/);
  assert.match(app, /const rows = skillCard/);
  assert.match(app, /\["介绍", \[copy\.background, copy\.use, copy\.what, copy\.how\]/);
  assert.match(app, /data-skill-run-flow/);
  assert.match(app, /skill-run-flow-arrow/);
  assert.match(styles, /\.skill-run-flow-track/);
  assert.match(styles, /\.skill-run-flow-step/);
});

test("客资技能的现场门槛明确标为运行前预检", () => {
  assert.match(app, /needs_user: "运行前预检"/);
});

test("模板仓库卡片保持单列宽度，长输入说明收进延迟悬浮提示", () => {
  assert.doesNotMatch(styles, /\.skill-card\[data-skill-card="template-repository-maintainer"\]\s*\{\s*grid-column:\s*span\s*2/);
  assert.doesNotMatch(app, /class="skill-quick-hint"/);
  assert.match(app, /const templateInputGuidance =/);
  assert.match(app, /data-tooltip="模板输入支持文字、链接、路径、图片和文件夹；详细规则请悬停技能卡 3 秒查看"/);
  assert.match(app, /helpHowForSkill = isTemplateSkill/);
});

test("每个可执行技能都把真实结果接到可打开的交付出口", () => {
  assert.match(app, /function skillResultLinks\(task, skill = null\)/);
  assert.match(app, /打开下载目录/);
  assert.match(app, /打开素材库/);
  assert.match(app, /打开聊天源目录/);
  assert.match(app, /打开待分析记录/);
  assert.match(app, /打开朋友圈仓库/);
  assert.match(app, /result\.targetRoot/);
  assert.match(app, /result\.after\?\.sourceDirectory/);
  assert.match(app, /result\.intakePath/);
  assert.match(app, /result\.libraryRoot/);
  assert.match(app, /renderSkillResult\(status, skill\)/);
  assert.match(app, /outputDir: current\.outputDir \|\| outputDir/);
  assert.match(panel, /return \{ result, item, libraryRoot:/);
  assert.match(skillsRoute, /repositoryPath: templateRepositoryEntry\(\)\.path/);
});

test("朋友圈采集、标签整理和准备都会回写技能卡结果状态", () => {
  assert.match(app, /momentsAction: "collect"/);
  assert.match(app, /momentsAction: "organize"/);
  assert.match(app, /momentsAction: "prepare"/);
    assert.match(app, /prepareSelected\?\.\(\{ notify: false \}\)/);
    assert.match(app, /state: error\.code === "MOMENTS_HUMAN_CONFIRM_REQUIRED" \? "needs_user" : "failed"/);
    assert.match(panel, /error\.payload\?\.result\?\.error/);
    assert.match(panel, /resultError \|\| error\.message/);
  assert.match(app, /libraryRoot: result\.libraryRoot/);
  assert.match(app, /libraryRoot: prepared\.libraryRoot/);
  assert.match(server, /libraryRoot: momentsLibraryRoot\(\)/);
});

test("微信聊天记录提取直接开始真实扫描，并提供六段模块说明", () => {
  assert.match(skillsRoute, /wechat-chat-analysis[\s\S]*?runLabel: "开始提取"/);
  assert.match(skillsRoute, /wechat-chat-analysis[\s\S]*?background:/);
  assert.match(skillsRoute, /wechat-chat-analysis[\s\S]*?input:/);
  assert.match(skillsRoute, /wechat-chat-analysis[\s\S]*?invocation:/);
  assert.match(skillsRoute, /wechat-chat-analysis[\s\S]*?operation:/);
  assert.match(skillsRoute, /wechat-chat-analysis[\s\S]*?output:/);
  assert.match(skillsRoute, /api\/扫描聊天源/);
  assert.match(app, /WORKBENCH_MODULE_HELP/);
  assert.match(app, /data-help-background/);
  assert.match(app, /data-help-running/);
  assert.match(app, /data-help-why/);
  assert.match(app, /const helpHow =/);
  assert.match(app, /const helpRunning =/);
});

test("流量转化维护技能绑定全链路来源和模块去向入口", () => {
  assert.match(skillsRoute, /团建项目全链路知识库\.html/);
  assert.match(skillsRoute, /团建知识库维护/);
  assert.match(app, /function skillKnowledgeSourceHtml/);
  assert.match(app, /function normalizedSkillKnowledgeModules/);
  assert.match(app, /function normalizedSkillSafety/);
  assert.match(app, /data-skill-knowledge-open/);
  assert.match(app, /data-skill-knowledge-detail/);
  assert.match(app, /查看来源/);
  assert.match(app, /查看模块去向/);
  assert.match(app, /全链路知识库只是本模块的经营总览和派生展示/);
  assert.match(app, /工作台执行/);
  assert.match(app, /复盘参考/);
  assert.match(app, /技能维护/);
  assert.match(styles, /\.skill-knowledge-source/);
  assert.match(styles, /\.skill-context-module-grid/);
});

test("朋友圈技能卡提供采集、标签整理、朋友圈仓库和触发发送入口，并提供日期快捷触发", () => {
  const actionBlock = app.match(/isMomentsSkill\s*\n?\s*\? `([\s\S]*?)`\s*\n?\s*: isMaterialDownload/)?.[1];
  assert.ok(actionBlock, "朋友圈技能卡应有独立的动作区");
  assert.equal((actionBlock.match(/data-moments-skill-action=/g) || []).length, 4);
  assert.match(actionBlock, /data-moments-skill-action="collect"[^>]*>采集<\/button>/);
  assert.match(actionBlock, /data-moments-skill-action="organize"[^>]*>整理标签<\/button>/);
  assert.match(actionBlock, /data-moments-skill-action="open"[^>]*>朋友圈仓库<\/button>/);
  assert.match(actionBlock, /data-moments-skill-action="prepare"[^>]*>触发发送<\/button>/);
  assert.match(app, /完成后自动整理标签/);
  assert.match(html, /id="momentsOpenFolderBtn"/);
  assert.match(html, /id="momentsPreviewSendBtn"/);
  assert.match(html, /id="momentsPreflightBtn"/);
  assert.match(html, /id="momentsScheduleNext"/);
  assert.match(html, /id="momentsCollectionScheduleStatus"/);
  assert.match(html, /id="momentsScheduleStatus"[^>]*data-skill-moments-settings/);
  assert.match(app, /data-skill-moments-settings/);
  assert.match(app, /data-skill-context-field="libraryRoot"/);
  assert.match(app, /option value="scheduled"[^>]*>定时触发（自动准备）<\/option>/);
  assert.match(app, /pathsLabel: "设置朋友圈素材目录"/);
  assert.match(app, /saveSkillContextMomentsSettings/);
  assert.match(app, /const latest = await api\("\/api\/page-settings"\)/);
  assert.match(app, /dashboard\.workspaceSettings\.pageSettings = latest\.settings/);
  assert.match(skillsRoute, /\[MOMENTS_SKILL_ID\]:[\s\S]*?pathFields: \["libraryRoot"\]/);
  assert.match(actionBlock, /momentsPolicyButton\("last-year-day", "去年今天"/);
  assert.match(actionBlock, /momentsPolicyButton\("historical-day", "往年今天"/);
  assert.match(actionBlock, /momentsPolicyButton\("last-year-month", "去年本月"/);
  assert.match(app, /class="secondary-button skill-card-policy-action moments-skill-policy-option\$\{momentsSkillPolicy === policy \? " is-selected"/);
  assert.match(app, /aria-pressed="\$\{momentsSkillPolicy === policy \? "true" : "false"\}"/);
  assert.match(app, /function runMomentsSkillAction\(action, button, options = \{\}\)/);
  assert.match(app, /panel\?\.setSelectionPolicy\?\./);
  assert.match(app, /resetManualFilters: true/);
  assert.match(app, /MOMENTS_DAY_LOCKED/);
  assert.match(app, /MOMENTS_NO_MATCH/);
  const prepareBlock = app.match(/if \(action === "prepare"\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.doesNotMatch(prepareBlock, /activateTab\("moments"\)/);
  assert.match(panel, /policyEmptyHint/);
  assert.match(panel, /全部使用次数/);
  assert.match(app, /panel\?\.prepareSelected\?\./);
  assert.match(panel, /prepareSelected/);
  assert.match(panel, /preflightSelected/);
  assert.match(panel, /未打开微信、未写入状态/);
  assert.match(server, /\/api\/moments\/preflight/);
  assert.match(server, /runMomentsPreflight/);
  assert.match(app, /去年本月随机/);
});

test("技能卡操作入口遵循统一的执行、结果、设置和说明层级", () => {
  assert.match(app, /class="primary-button skill-card-execute-action"/);
  assert.match(app, /class="secondary-button skill-card-result-action/);
  assert.match(app, /class="secondary-button skill-card-settings-action"/);
  assert.match(app, /class="secondary-button skill-card-help-action"/);
  assert.match(app, /class="skill-card-utilities"/);
  assert.match(styles, /#skillsView \.skill-card-utilities/);
  assert.match(styles, /#skillsView \.skill-card-actions > button/);
});

test("文件传输技能卡直接复用设备检查与自动分发入口", () => {
  assert.match(skillsRoute, /DEVICE_TRANSFER_SKILL_ID/);
  assert.match(skillsRoute, /runDeviceFolderTransferSkill/);
  assert.match(skillsRoute, /maybeStartAutomaticDistribution/);
  assert.match(skillsRoute, /不重复发送/);
  assert.match(app, /result\.deviceTransferAction === "check_and_auto_dispatch"/);
  assert.match(app, /打开设备状态快照/);
  assert.match(app, /打开分发日志/);
  assert.match(server, /startAutomaticDistributionMonitor\(\)/);
});

test("素材下载 Skill 提供粘贴输入、执行按钮和真实任务轮询", () => {
  assert.match(app, /data-skill-material-input/);
  assert.match(app, /data-skill-download-run/);
  assert.match(app, /data-skill-download-open/);
  assert.match(app, /function openMaterialDownloadDirectory/);
  assert.match(app, /\/api\/skills\/material-download\/run/);
  assert.match(app, /\/api\/skills\/material-download\/tasks/);
  assert.match(app, /function runMaterialDownloadSkillCard/);
  assert.match(app, /\/api\/skills\/material-download\/settings/);
  assert.match(app, /data-skill-context-field="materialDownloadOutputDir"/);
  assert.match(app, /body: JSON\.stringify\(\{ text, outputDir \}\)/);
  assert.match(app, /data-skill-settings/);
  assert.match(styles, /@media \(hover: none\), \(pointer: coarse\)/);
});

test("朋友圈采集设置支持账号、UID、数量和微信加载前提", () => {
  assert.match(app, /data-skill-context-field="collectionAccount"/);
  assert.match(app, /data-skill-context-field="collectionWxid"/);
  assert.match(app, /data-skill-context-field="collectionLimit"/);
  assert.match(app, /data-skill-context-field="collectionScheduleEnabled"/);
  assert.match(app, /data-skill-context-field="collectionScheduleDay"/);
  assert.match(app, /data-skill-context-field="collectionScheduleTime"/);
  assert.match(app, /data-skill-context-field="collectionScheduleCatchUpDays"/);
  assert.match(app, /每月自动采集一次/);
  assert.match(app, /每日自动准备开始时间/);
  assert.match(app, /每日自动准备截止时间/);
  assert.match(app, /窗口内工作台每 15 秒检查一次/);
  assert.match(server, /collectionScheduleEnabled: momentsSettings\.collectionScheduleEnabled === true/);
  assert.match(server, /tickMomentsCollectionScheduler/);
  assert.match(app, /data-skill-context-field="requireWechatReady"/);
  assert.match(app, /微信号或微信昵称/);
  assert.match(app, /fullHistory: target\.fullHistory/);
  assert.match(app, /我已加载，继续采集/);
});

test("customer lead Skill UI uses preview before commit and polls one task", () => {
  assert.match(app, /data-skill-commit/);
  assert.match(app, /mode = "preview"/);
  assert.match(app, /confirm: mode === "commit"/);
  assert.match(app, /async function apiWithRetry\(path, options, \{ retries = 3, delayMs = 500 \} = \{\}/);
  assert.match(app, /const list = await apiWithRetry\(`\/api\/skills\/\$\{encodeURIComponent\(skillId\)\}\/tasks`\)/);
  assert.match(app, /\/api\/skills\/\$\{encodeURIComponent\(skillId\)\}\/tasks/);
  assert.match(app, /preview_ready/);
  assert.match(skillsRoute, /LEAD_SYNC_TIMEOUT/);
  assert.match(skillsRoute, /客资执行器超过 5 分钟未返回/);
});

test("customer lead Skill result exposes report and target-sheet actions", () => {
  assert.match(app, /data-skill-result-open/);
  assert.match(app, /data-skill-result-url/);
  assert.match(app, /打开运行报告/);
  assert.match(app, /打开飞书表格/);
  assert.match(app, /查看历史报告/);
  assert.match(app, /data-tooltip="打开已配置的飞书客资统计表，不触发同步"/);
  assert.match(app, /openPath\(button\.dataset\.skillResultOpen\)/);
  assert.match(app, /openExternal\(button\.dataset\.skillResultUrl\)/);
});

test("customer lead Skill keeps its Feishu target and dependency startup inside the skill panel", () => {
  assert.match(app, /客资表与启动设置/);
  assert.match(app, /data-skill-context-field="leadTargetUrl"/);
  assert.match(app, /data-skill-context-field="leadAutoStartDependencies"/);
  assert.match(app, /\/api\/skills\/wechat-teambuilding-conversion\/settings/);
  assert.match(app, /saveSkillContextLeadSettings/);
  assert.match(app, /正在启动/);
  assert.match(app, /preflight\.actions/);
});
