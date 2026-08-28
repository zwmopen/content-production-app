const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  resolveInitialTab,
  inferSelectionMode,
  categoryCountLabel,
  buildMaterialTree,
  buildChatGptInstruction,
  filterMomentAssets,
  buildMomentPreview,
  buildMomentPrepareRequest
} = require("./material-workspace");

test("production scope follows selected material folders without exposing set/batch UI", () => {
  assert.deepEqual(inferSelectionMode(["D:\\posts\\a"]), {
    mode: "set",
    workCount: 1,
    label: "已选 1 个素材文件夹"
  });
  assert.deepEqual(inferSelectionMode(["D:\\posts\\a", "D:\\posts\\b", "D:\\posts\\a"]), {
    mode: "batch",
    workCount: 2,
    label: "已选 2 个素材文件夹"
  });
});

test("unloaded material categories are not presented as zero", () => {
  assert.equal(categoryCountLabel({ loaded: false, countKnown: false, count: 0 }), "未读取");
  assert.equal(categoryCountLabel({ loaded: true, countKnown: true, count: 0 }), "0");
  assert.equal(categoryCountLabel({ loaded: false, countKnown: true, count: 12 }), "12");
});

test("旧版模块状态迁移到独立内容 App 的可用入口", () => {
  ["overview", "products", "dashboard", "conversion", "wechat", "works", "publishing", "moments", "plugins", "", "unknown"].forEach((tab) => {
    assert.equal(resolveInitialTab(tab), "gptProductionTest");
  });
  assert.equal(resolveInitialTab("gptProductionTest"), "gptProductionTest");
});

test("独立内容 App 只暴露内容制作入口，素材与模板留在生产页", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const workspaceSource = fs.readFileSync(path.join(__dirname, "material-workspace.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(html, /data-tab="gptProductionTest"/);
  assert.match(html, /id="materialLibraryView"/);
  assert.match(html, /id="materialLibraryCollectInput"/);
  assert.match(html, /id="materialLibraryPreviewBtn"/);
  assert.match(html, /id="materialLibrarySettingsBtn"/);
  assert.match(workspaceSource, /const allowedTabs = new Set\(\["gptProductionTest"\]\)/);
  assert.doesNotMatch(workspaceSource, /"templateRepository"/);
  assert.doesNotMatch(workspaceSource, /"settings"/);
  assert.match(workspaceSource, /const productionTab = document\.querySelector\('\[data-tab="gptProductionTest"\]'\)/);
  assert.match(workspaceSource, /view\.id === "gptProductionTestView"/);
  assert.doesNotMatch(workspaceSource, /const materialTab = document\.querySelector/);
  assert.match(workspaceSource, /if \(!allowedTabs\.has\(tab\.dataset\.tab\)\) tab\.remove\(\)/);
  assert.match(app, /\/api\/skills\/material-download\/run/);
  assert.match(app, /\/api\/skills\/jianghu-toolbox-material-ingestion\/run/);
});

test("流量转化作为同源模块融入工作台，不暴露独立服务地址", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(html, /data-tab="conversion"/);
  assert.doesNotMatch(html, /id="conversionAppFrame"/);
  assert.doesNotMatch(html, /src="http:\/\/127\.0\.0\.1:8765/);
  assert.match(html, /class="conversion-native-shell"/);
  assert.match(html, /id="conversionContent"/);
  assert.match(html, /data-conversion-module="search"/);
  assert.match(html, /id="globalThemeCycleBtn"/);
  assert.doesNotMatch(html, /rail-theme-switch[^]*data-theme="glass"/);
  assert.match(app, /loadConversionHub\(\)/);
  assert.doesNotMatch(app, /\/conversion-integrated\/\?embedded=1&theme=/);
  assert.match(html, /id="conversionMobileEntryBtn"/);
  assert.match(app, /\/api\/conversion\/mobile-link/);
  assert.match(app, /手机与电脑连接同一 Wi-Fi/);
  assert.match(html, /id="conversionApiText">内置 SOP 已就绪/);
  assert.match(html, /内置转化 SOP 已就绪/);
});

test("朋友圈面板按分类、标签和日期策略筛选，不改变原素材顺序数据", () => {
  const items = [
    { workId: "2026-a", name: "安吉团建", category: "团建", tags: ["漂流"], season: "夏季", place: "安吉", activityType: "团建", usageCount: 1, year: 2026, month: 8, day: 14, publishedAt: "2026-08-14T08:00:00+08:00", text: "安吉" },
    { workId: "2025-a", name: "去年今天", category: "团建", tags: ["漂流"], season: "夏季", place: "安吉", activityType: "团建", usageCount: 0, year: 2025, month: 8, day: 14, publishedAt: "2025-08-14T08:00:00+08:00", text: "去年" },
    { workId: "2024-month", name: "更早同月", category: "团建", tags: ["漂流"], season: "夏季", place: "安吉", activityType: "团建", usageCount: 0, year: 2024, month: 8, day: 20, publishedAt: "2024-08-20T08:00:00+08:00", text: "更早" },
    { workId: "2026-b", name: "杭州攻略", category: "攻略", tags: ["城市"], season: "夏季", place: "杭州", activityType: "攻略", usageCount: 3, year: 2026, month: 7, day: 1, publishedAt: "2026-07-01T08:00:00+08:00", text: "杭州" }
  ];
  assert.deepEqual(filterMomentAssets(items, { category: "团建", tag: "漂流", policy: "current-year", today: "2026-08-14" }).map((item) => item.workId), ["2026-a"]);
  assert.deepEqual(filterMomentAssets(items, { policy: "anniversary", today: "2026-08-14" }).map((item) => item.workId), ["2025-a"]);
  assert.deepEqual(filterMomentAssets(items, { season: "夏季", place: "安吉", activity: "团建", usage: "1", policy: "all" }).map((item) => item.workId), ["2026-a"]);
});

test("朋友圈标签筛选在默认日期没有命中时可切换到全部历史后生效", () => {
  const items = [
    { workId: "2025-old", tags: ["安吉"], year: 2025, month: 8, day: 12, publishedAt: "2025-08-12T08:00:00+08:00" },
    { workId: "2025-today", tags: ["杭州"], year: 2025, month: 8, day: 14, publishedAt: "2025-08-14T08:00:00+08:00" }
  ];
  assert.deepEqual(
    filterMomentAssets(items, { tag: "安吉", policy: "last-year-day", today: "2026-08-14" }).map((item) => item.workId),
    []
  );
  assert.deepEqual(
    filterMomentAssets(items, { tag: "安吉", policy: "all", today: "2026-08-14" }).map((item) => item.workId),
    ["2025-old"]
  );
});

test("朋友圈周年规则没有去年同日时优先回退到历史同月", () => {
  const items = [
    { workId: "2025-08-20", year: 2025, month: 8, day: 20, publishedAt: "2025-08-20T08:00:00+08:00" },
    { workId: "2024-08-25", year: 2024, month: 8, day: 25, publishedAt: "2024-08-25T08:00:00+08:00" },
    { workId: "2025-07-20", year: 2025, month: 7, day: 20, publishedAt: "2025-07-20T08:00:00+08:00" },
    { workId: "2026-08-15", year: 2026, month: 8, day: 15, publishedAt: "2026-08-15T08:00:00+08:00" }
  ];
  assert.deepEqual(
    filterMomentAssets(items, { policy: "anniversary", today: "2026-08-16" }).map((item) => item.workId),
    ["2025-08-20"]
  );
});

test("朋友圈周年规则历史同月耗尽时回退到今年未使用素材", () => {
  const items = [
    { workId: "2026-08-15", year: 2026, month: 8, day: 15, publishedAt: "2026-08-15T08:00:00+08:00" },
    { workId: "2026-07-20", year: 2026, month: 7, day: 20, publishedAt: "2026-07-20T08:00:00+08:00" }
  ];
  assert.deepEqual(
    filterMomentAssets(items, { policy: "anniversary", today: "2026-08-24" }).map((item) => item.workId),
    ["2026-08-15", "2026-07-20"]
  );
});

test("朋友圈快捷选材支持去年今天、往年今天和去年本月规则", () => {
  const items = [
    { workId: "2025-08-16", publishedAt: "2025-08-16T08:00:00+08:00" },
    { workId: "2025-08-20", publishedAt: "2025-08-20T08:00:00+08:00" },
    { workId: "2025-07-16", publishedAt: "2025-07-16T08:00:00+08:00" },
    { workId: "2026-08-16", publishedAt: "2026-08-16T08:00:00+08:00" }
  ];
  assert.deepEqual(
    filterMomentAssets(items, { policy: "last-year-day", today: "2026-08-16" }).map((item) => item.workId),
    ["2025-08-16"]
  );
  assert.deepEqual(
    filterMomentAssets([
      ...items,
      { workId: "2024-08-16", publishedAt: "2024-08-16T08:00:00+08:00" }
    ], { policy: "historical-day", today: "2026-08-16" }).map((item) => item.workId),
    ["2025-08-16", "2024-08-16"]
  );
  assert.deepEqual(
    filterMomentAssets(items, { policy: "last-year-month", today: "2026-08-16" }).map((item) => item.workId),
    ["2025-08-20", "2025-08-16"]
  );
});

test("朋友圈预览固定最多九张图，并把发送边界显式带入请求", () => {
  const item = {
    workId: "2026-demo",
    name: "九宫格测试",
    category: "团建",
    tags: ["测试"],
    text: "原始文案",
    images: Array.from({ length: 12 }, (_, index) => ({ name: `${index + 1}.jpg`, url: `/media/${index + 1}` })),
    imageCount: 12,
    status: "QUEUED"
  };
  assert.equal(buildMomentPreview(item).images.length, 9);
  assert.deepEqual(buildMomentPrepareRequest(item), {
    workId: "2026-demo",
    name: "九宫格测试",
    imageCount: 12,
    textLength: 4,
    humanConfirmationRequired: true,
    finalPublishButton: "never-clicked-by-v1",
    retryFailed: false
  });
  assert.equal(buildMomentPrepareRequest({ ...item, status: "FAILED" }).retryFailed, true);
});

test("朋友圈预览保留历史日期、来源和筛选维度", () => {
  const preview = buildMomentPreview({
    workId: "2025-history",
    category: "团建",
    tags: ["漂流"],
    season: "夏季",
    place: "杭州",
    activityType: "团建",
    usageCount: 2,
    sourceLabel: "WeFlow历史采集",
    publishedAt: "2025-08-15T10:00:00+08:00",
    text: "历史文案",
    images: [{ name: "01.jpg", url: "/media/01" }],
    status: "QUEUED"
  });
  assert.equal(preview.publishedAt, "2025-08-15T10:00:00+08:00");
  assert.equal(preview.sourceLabel, "WeFlow历史采集");
  assert.equal(preview.place, "杭州");
  assert.equal(preview.usageCount, 2);
});

test("朋友圈面板接入真实作品库 API，并保留人工最终确认边界", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const panel = fs.readFileSync(path.join(__dirname, "moments-publisher-panel.js"), "utf8");
  assert.match(html, /id="momentsView"/);
  assert.match(html, /朋友圈采集整理与发布/);
  assert.doesNotMatch(html, /momentsRecommendationList/);
  assert.match(panel, /去年今天/);
  assert.match(html, /id="momentsCategoryFilter"/);
  assert.match(html, /id="momentsTagFilter"/);
  assert.match(html, /id="momentsSeasonFilter"/);
  assert.match(html, /id="momentsPlaceFilter"/);
  assert.match(html, /id="momentsActivityFilter"/);
  assert.match(html, /id="momentsUsageFilter"/);
  assert.doesNotMatch(html, /id="momentsPageSettings"|id="momentsTriggerMode"|id="momentsSelectionRule"/);
  assert.match(html, /data-skill-moments-settings/);
  assert.match(app, /data-skill-context-field="scheduleTimes"/);
  assert.match(app, /定时触发（自动准备）/);
  assert.match(html, /id="momentsPreviewGrid"/);
  assert.match(styles, /\.moments-preview-grid\s*\{[\s\S]*?width:\s*min\(100%,\s*285px\)[\s\S]*?max-width:\s*285px/);
  assert.match(html, /只准备，不自动发表/);
  assert.match(server, /\/api\/moments\/library/);
  assert.match(server, /\/api\/moments\/media/);
  assert.match(server, /\/api\/moments\/prepare/);
  assert.match(server, /WAITING_FOR_HUMAN_LOGIN/);
  assert.match(server, /不会自动换下一条/);
  assert.match(server, /retryFailed/);
  assert.match(server, /startMomentsScheduler/);
  assert.match(server, /selectionPolicyForRule/);
  assert.match(panel, /随机挑选今年素材/);
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.doesNotMatch(panel, /window\.alert\(result\.message/);
  assert.match(panel, /不自动发表/);
  assert.match(panel, /手动重试该作品/);
  assert.match(panel, /prepareSelected\(\{ notify = true \} = \{\}\)/);
  assert.match(panel, /if \(!notify\) throw error/);
});

test("工作台模块在桌面隔离环境中优先挂载到 window，保证技能中心可调用朋友圈面板", () => {
  const workspaceSource = fs.readFileSync(path.join(__dirname, "material-workspace.js"), "utf8");
  assert.match(workspaceSource, /document\.defaultView/);
  assert.match(workspaceSource, /typeof self !== "undefined"/);
  assert.match(workspaceSource, /typeof window !== "undefined"/);
  assert.match(workspaceSource, /root\.MaterialWorkspace = api/);
});

test("朋友圈采集整理与发布保留在工作台，并由技能中心专属设置控制入口与接口", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const skills = fs.readFileSync(path.join(__dirname, "..", "server", "routes", "skills.js"), "utf8");
  assert.doesNotMatch(html, /id="momentsPageSettings"|id="momentsFeatureEnabledPage"|id="momentsOrganizeBtn"/);
  assert.match(html, /data-skill-moments-settings/);
  assert.match(app, /openMomentsSkillSettingsPanel/);
  assert.match(app, /保存朋友圈设置/);
  assert.match(app, /朋友圈采集整理与发布已关闭，请从技能中心的朋友圈设置重新启用/);
  assert.match(app, /data-moments-skill-action="collect"/);
  assert.match(app, /requestMomentsCollectDetails/);
  const momentsAction = app.slice(app.indexOf("async function runMomentsSkillAction"), app.indexOf("async function loadSkillsCatalog"));
  assert.doesNotMatch(momentsAction, /window\.prompt\(/);
  assert.match(app, /data-moments-skill-action="organize"/);
  assert.match(app, /data-moments-skill-action="prepare"/);
  assert.match(styles, /moments-skill-actions/);
  assert.match(skills, /wechat-moments-library/);
  assert.match(server, /\/api\/moments\/collect/);
  assert.match(server, /朋友圈模块已在技能中心的朋友圈设置中关闭/);
});

test("流量转化先使用内置文字知识，外部资料异常不再把整页变成离线占位", () => {
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.doesNotMatch(app, /转化知识库未连接/);
  assert.doesNotMatch(app, /启动转化知识库/);
  assert.match(app, /BUILTIN_CONVERSION_ROLES/);
  assert.match(app, /createBuiltinConversionSnapshot/);
  assert.match(app, /内置 SOP 已就绪/);
  assert.match(app, /外部资料稍后重试/);
  assert.match(app, /conversionLoadInFlight/);
  assert.doesNotMatch(app, /conversionStartServiceBtn/);
  assert.doesNotMatch(app, /流量转化模块暂时不可用/);
});

test("流量转化状态不再暴露旧版独立助手措辞", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.doesNotMatch(html, /正在连接江湖团建转化助手/);
  assert.doesNotMatch(appSource, /转化助手暂时没有连接/);
  assert.match(html, /id="conversionServiceStatus"/);
  assert.doesNotMatch(html, /id="conversionEmbeddedStatus"/);
  assert.doesNotMatch(html, /正在加载流量转化/);
});

test("设置页用产品化入口组织生产配置并继续移除旧工作包杂项", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.doesNotMatch(html, /id="settingsMaterialRoot"/);
  assert.doesNotMatch(html, /id="settingsPortfolioRoot"/);
  assert.match(html, /id="cloudBackupStatus"/);
  assert.match(html, /id="inspectCloudBackupBtn"/);
  assert.match(html, /id="restoreCloudBackupBtn"/);
  assert.doesNotMatch(html, /id="dedupProductionGroups"/);
  assert.match(html, /id="settingsVersion"/);
  assert.doesNotMatch(html, /id="productionApiProvider"/);
  assert.doesNotMatch(html, /id="productionTextModel"/);
  assert.doesNotMatch(html, /appearance-card/);
  assert.doesNotMatch(html, /id="settingsBatchSize"/);
  assert.doesNotMatch(html, /id="settingsAutoGroup"/);
  assert.doesNotMatch(html, /id="settingsAutoZip"/);
  assert.doesNotMatch(html, /id="runExistingWorkPackageBtn"/);
  assert.doesNotMatch(html, /id="openExtensionRootBtn"/);
  assert.match(html, /id="checkAppUpdateBtn"/);
  // 发布目录是当前版本检查/移动端更新的真实入口，不属于已废弃的旧工作包入口。
  assert.match(html, /id="openReleaseRootBtn"/);
  assert.match(html, /id="settingsStartCard"/);
  assert.match(html, /settings-advanced-card/);
  assert.match(html, /id="gptDeveloperSettings"/);
});

test("素材分类会转换为可展开的本地文件树", () => {
  const categories = [{
    name: "夏季团建",
    path: "D:\\素材\\夏季团建",
    count: 2,
    items: [
      { id: "a", name: "安吉两天一夜", path: "D:\\素材\\夏季团建\\安吉两天一夜", imageCount: 9 },
      { id: "b", name: "杭州周边团建", path: "D:\\素材\\夏季团建\\杭州周边团建", imageCount: 7 }
    ]
  }];

  const tree = buildMaterialTree(categories, "b", ["D:\\素材\\夏季团建"]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].expanded, true);
  assert.equal(tree[0].items.length, 2);
  assert.equal(tree[0].items[1].selected, true);
  assert.equal(tree[0].items[1].imageCount, 7);
});

test("传 GPT 指令包含帖子文件夹路径和真实操作边界", () => {
  const instruction = buildChatGptInstruction(
    { name: "安吉两天一夜", path: "D:\\素材\\安吉两天一夜", imageCount: 9 },
    { name: "夏季团建" },
    "T04"
  );

  assert.match(instruction, /安吉两天一夜/);
  assert.match(instruction, /D:\\素材\\安吉两天一夜/);
  assert.match(instruction, /T04/);
  assert.match(instruction, /本地文件夹/);
});
