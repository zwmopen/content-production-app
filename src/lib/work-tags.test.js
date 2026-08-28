"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  TAG_REGISTRY,
  TAG_REGISTRY_PATH,
  TAG_GROUPS,
  MATERIAL_TAG_RULES,
  inferWorkTagGroups,
  deriveSystemTagGroups,
  normalizePlatformUsageId,
  platformUsageCount,
  platformUsageEligibility,
  platformUsageTagGroups,
  recordPlatformUsage,
  matchesTagSelection,
  mergeWorkTagGroups,
  readWorkTagLedger,
  syncWorkTagLedger,
  updateWorkTagLedger
} = require("./work-tags");

test("标准标签字典从 JSON 注册表加载并保留扩展素材规则", () => {
  assert.equal(fs.existsSync(TAG_REGISTRY_PATH), true);
  assert.equal(TAG_REGISTRY.version, 1);
  assert.deepEqual(TAG_REGISTRY.groups.business.map((group) => group.id), ["content", "game", "location", "duration", "scene"]);
  assert.ok(MATERIAL_TAG_RULES.some(([tag, keywords]) => tag === "西山岛" && keywords.includes("西山岛")));
  assert.ok(MATERIAL_TAG_RULES.some(([tag, keywords]) => tag === "轰趴" && keywords.includes("KTV")));
});

test("标签注册表按业务组组织并把发布状态限制在设备分发", () => {
  assert.deepEqual(TAG_GROUPS.business.map((group) => group.id), ["content", "game", "location", "duration", "scene"]);
  assert.ok(TAG_GROUPS.business.find((group) => group.id === "game").options.includes("破冰"));
  assert.ok(TAG_GROUPS.business.find((group) => group.id === "location").options.includes("安吉"));
  assert.ok(TAG_GROUPS.business.find((group) => group.id === "duration").options.includes("两天一夜"));
  const publishOptions = TAG_GROUPS.distribution.find((group) => group.id === "publish").options;
  assert.ok(publishOptions.includes("已发抖音小红书"));
  assert.ok(publishOptions.includes("已发携程"));
  assert.ok(publishOptions.includes("已发X"));
});

test("从作品名称和正文自动识别内容、游戏、地点、时间与场景标签", () => {
  const groups = inferWorkTagGroups({
    name: "安吉两天一夜破冰团建",
    text: "公司在莫干山露营，安排无道具暖场游戏"
  });
  assert.deepEqual(groups.content, ["团建游戏"]);
  assert.deepEqual(groups.game, ["破冰", "暖场", "无道具"]);
  assert.deepEqual(groups.location, ["安吉", "莫干山"]);
  assert.deepEqual(groups.duration, ["两天一夜"]);
  assert.deepEqual(groups.scene, ["露营"]);
});

test("已有真实内容分类优先于正文里顺带出现的游戏词", () => {
  assert.deepEqual(inferWorkTagGroups({
    name: "安吉公司团建方案",
    text: "行程中安排破冰暖场游戏",
    collectionType: "conversion"
  }).content, ["精准流量"]);
  assert.deepEqual(inferWorkTagGroups({ name: "办公室小游戏", collectionType: "traffic" }).content, ["团建游戏"]);
});

test("筛选时同一标签组为或关系，不同标签组为且关系，不限不形成条件", () => {
  const work = {
    content: ["团建转化"],
    location: ["安吉"],
    duration: ["两天一夜"],
    scene: ["漂流"]
  };
  assert.equal(matchesTagSelection(work, { location: ["安吉", "莫干山"], duration: ["两天一夜"] }), true);
  assert.equal(matchesTagSelection(work, { location: ["安吉", "莫干山"], duration: ["一日"] }), false);
  assert.equal(matchesTagSelection(work, { location: ["不限"], duration: [] }), true);
});

test("人工标签按组覆盖自动识别，未人工修改的组继续自动更新", () => {
  const merged = mergeWorkTagGroups(
    { content: ["精准流量"], location: ["安吉"], duration: ["一日"] },
    { location: ["上海"], duration: [] }
  );
  assert.deepEqual(merged, { content: ["精准流量"], location: ["上海"], duration: [] });
});

test("目录移动和真实账本自动生成使用、阶段与分发状态标签", () => {
  assert.deepEqual(deriveSystemTagGroups({
    imageCount: 9,
    textCount: 1,
    usageCount: 2,
    workflowStage: "mobile",
    distributed: false
  }), {
    integrity: ["完整"],
    usage: ["使用2次"],
    stage: ["待发手机"],
    distribution: ["未分发"]
  });
  assert.deepEqual(deriveSystemTagGroups({
    imageCount: 0,
    textCount: 1,
    workflowStage: "used",
    distributed: true
  }).integrity, ["缺图片"]);
});

test("作品标签账本以 workId 持久化人工覆盖，不依赖会变化的目录", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-work-tags-"));
  const ledgerFile = path.join(root, "work-tag-ledger.json");
  updateWorkTagLedger(ledgerFile, {
    workId: "work-001",
    name: "安吉团建",
    automatic: { location: ["安吉"] },
    manual: { location: ["莫干山"], duration: ["两天一夜"] }
  });
  const ledger = readWorkTagLedger(ledgerFile);
  assert.deepEqual(ledger.entries["work-001"].manual.location, ["莫干山"]);
  assert.deepEqual(ledger.entries["work-001"].effective.location, ["莫干山"]);
  assert.deepEqual(ledger.entries["work-001"].effective.duration, ["两天一夜"]);
});

test("批量自动打标保留已有人工覆盖并更新移动后的路径", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-work-tag-sync-"));
  const ledgerFile = path.join(root, "work-tag-ledger.json");
  updateWorkTagLedger(ledgerFile, { workId: "w1", manual: { location: ["上海"] } });
  const result = syncWorkTagLedger(ledgerFile, [{
    workId: "w1", name: "安吉露营", path: "D:/new/location/w1", automatic: { location: ["安吉"], scene: ["露营"] }
  }]);
  assert.equal(result.changed, true);
  assert.equal(result.ledger.entries.w1.path, "D:/new/location/w1");
  assert.deepEqual(result.ledger.entries.w1.effective.location, ["上海"]);
  assert.deepEqual(result.ledger.entries.w1.effective.scene, ["露营"]);
});

test("抖音和小红书共享平台使用状态，携程使用过后自动失去候选资格", () => {
  assert.equal(normalizePlatformUsageId("douyin"), "douyin_xiaohongshu");
  assert.equal(normalizePlatformUsageId("twitter"), "x");
  assert.equal(platformUsageEligibility({ tags: ["已发携程"] }, "ctrip").eligible, false);
  assert.equal(platformUsageEligibility({ tags: ["已发抖音小红书"] }, "xiaohongshu").eligible, false);
  assert.equal(platformUsageEligibility({ tags: ["已发抖音小红书"] }, "ctrip").eligible, true);
  assert.deepEqual(platformUsageTagGroups({ douyin_xiaohongshu: {}, ctrip: {} }).publish, ["已发抖音小红书", "已发携程"]);
});

test("平台使用次数按平台记录计算，物理阶段本身不制造使用次数", () => {
  assert.equal(platformUsageCount({}), 0);
  assert.equal(platformUsageCount({ douyin_xiaohongshu: { source: "device_distribution" } }), 1);
  assert.equal(platformUsageCount({ ctrip: { useCount: 2 }, wechat: {} }), 3);
  assert.equal(platformUsageEligibility({ platformUsage: { ctrip: { useCount: 2 } } }, "ctrip").useCount, 2);
  assert.equal(platformUsageEligibility({ platformUsage: {} }, "ctrip").useCount, 0);
});

test("记录平台使用同时更新标签账本和已有作品 JSON，不为老作品凭空创建 JSON", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-usage-"));
  const ledgerFile = path.join(root, "work-tag-ledger.json");
  const withManifest = path.join(root, "有记录作品");
  const legacyWork = path.join(root, "老作品");
  try {
    fs.mkdirSync(withManifest, { recursive: true });
    fs.mkdirSync(legacyWork, { recursive: true });
    fs.writeFileSync(path.join(withManifest, "GPT作品记录.json"), JSON.stringify({ id: "manifest-work", tags: ["已制作"] }));
    const first = recordPlatformUsage(ledgerFile, {
      work: { workId: "manifest-work", name: "有记录作品", path: withManifest },
      platform: "ctrip",
      source: "manual_confirmation",
      collection: "公众号"
    });
    assert.equal(first.label, "已发携程");
    assert.equal(first.manifestUpdated, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(withManifest, "GPT作品记录.json"), "utf8"));
    assert.ok(manifest.tags.includes("已发携程"));
    assert.equal(manifest.platformUsage.ctrip.useCount, 1);

    const second = recordPlatformUsage(ledgerFile, {
      work: { workId: "legacy-work", name: "老作品", path: legacyWork },
      platform: "douyin",
      source: "device_distribution"
    });
    assert.equal(second.manifestUpdated, false);
    assert.equal(fs.existsSync(path.join(legacyWork, "GPT作品记录.json")), false);
    const ledger = readWorkTagLedger(ledgerFile);
    assert.equal(ledger.entries["legacy-work"].platformUsage.douyin_xiaohongshu.label, "已发抖音小红书");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
