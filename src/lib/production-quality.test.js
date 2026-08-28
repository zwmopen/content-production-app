const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");
const { formatPlatformCopy } = require("../integrations/gpt-production-extension/gpt-automation-core");
const { inspectProductionQuality, qualityReportText } = require("./production-quality");

async function writePublishImage(filePath) {
  const width = 1080;
  const height = 1440;
  await sharp(crypto.randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 }
  }).jpeg({ quality: 88 }).toFile(filePath);
}

test("quality inspection accepts a complete 3:4 work and keeps manual visual checks", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-quality-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imageFile = path.join(root, "P1_cover.jpg");
  const copyFile = path.join(root, "小红书文案.txt");
  await writePublishImage(imageFile);
  fs.writeFileSync(copyFile, "杭州周边一日团建路线参考。".repeat(20), "utf8");
  const plan = {
    materialName: "测试素材",
    templateName: "测试母版",
    pages: [{ code: "P1", title: "封面" }]
  };
  const report = await inspectProductionQuality({
    plan,
    outputRoot: root,
    results: [
      { type: "image", work: "测试素材", page: "P1", outputFile: imageFile },
      { type: "copy", work: "测试素材", outputFile: copyFile }
    ]
  });
  assert.equal(report.status, "passed");
  assert.equal(report.summary.actualImages, 1);
  assert.equal(report.failures.length, 0);
  assert.ok(report.manualChecks.some((item) => item.includes("真实景点")));
  assert.match(qualityReportText(report), /发布前人工看图/);
});

test("quality inspection validates one dual-platform TXT and its 10/5 hashtag contract", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-quality-dual-copy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imageFile = path.join(root, "P1_cover.jpg");
  const copyFile = path.join(root, "文案.txt");
  await writePublishImage(imageFile);
  const tags = (prefix, count) => Array.from({ length: count }, (_, index) => `#${prefix}${index + 1}`).join(" ");
  fs.writeFileSync(copyFile, formatPlatformCopy({
    xhs: `杭州团建玩法参考\n${"小红书正文事实。".repeat(16)}\n${tags("X", 10)}`,
    douyin: `杭州周边怎么玩\n${"抖音正文事实。".repeat(16)}\n${tags("D", 5)}`
  }), "utf8");
  const report = await inspectProductionQuality({
    plan: {
      materialName: "双平台测试",
      templateName: "测试母版",
      pages: [{ code: "P1", title: "封面" }]
    },
    outputRoot: root,
    results: [
      { type: "image", work: "双平台测试", page: "P1", outputFile: imageFile },
      { type: "copy", work: "双平台测试", outputFile: copyFile }
    ]
  });
  assert.equal(report.status, "passed");
  assert.equal(report.summary.copyFormatVersion, 2);
  assert.deepEqual(report.summary.platformHashtags, { xhs: 10, douyin: 5 });
  assert.equal(report.failures.length, 0);
});

test("quality inspection blocks missing and duplicate images", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-quality-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = path.join(root, "P1.jpg");
  const second = path.join(root, "P2.jpg");
  await writePublishImage(first);
  fs.copyFileSync(first, second);
  fs.writeFileSync(path.join(root, "小红书文案.txt"), "团建路线参考。".repeat(30), "utf8");
  const plan = {
    materialName: "测试素材",
    templateName: "测试母版",
    pages: [
      { code: "P1", title: "封面" },
      { code: "P2", title: "内页" },
      { code: "P3", title: "结尾" }
    ]
  };
  const report = await inspectProductionQuality({
    plan,
    outputRoot: root,
    results: [
      { type: "image", work: "测试素材", page: "P1", outputFile: first },
      { type: "image", work: "测试素材", page: "P2", outputFile: second }
    ]
  });
  assert.equal(report.status, "needs-rework");
  assert.ok(report.failures.some((item) => item.includes("P3") && item.includes("缺少")));
  assert.ok(report.failures.some((item) => item.includes("完全重复")));
});

test("quality inspection counts one finished page once after a task resume", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-quality-resume-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imageFile = path.join(root, "P1.jpg");
  const copyFile = path.join(root, "小红书文案.txt");
  await writePublishImage(imageFile);
  fs.writeFileSync(copyFile, "江浙沪公司团建路线参考。".repeat(20), "utf8");
  const plan = {
    materialName: "恢复测试",
    templateName: "测试母版",
    pages: [{ code: "P1", title: "封面" }]
  };
  const duplicateResult = { type: "image", work: "恢复测试", page: "P1", outputFile: imageFile };
  const report = await inspectProductionQuality({
    plan,
    outputRoot: root,
    results: [
      duplicateResult,
      { ...duplicateResult, durationMs: 3000 },
      { type: "copy", work: "恢复测试", outputFile: copyFile }
    ]
  });
  assert.equal(report.status, "passed");
  assert.equal(report.summary.actualImages, 1);
  assert.equal(report.failures.length, 0);
});

test("quality inspection rejects an input image copied as the finished AI page", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-quality-input-copy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const materialRoot = path.join(root, "material");
  const templateRoot = path.join(root, "template");
  const outputRoot = path.join(root, "output");
  fs.mkdirSync(materialRoot);
  fs.mkdirSync(templateRoot);
  fs.mkdirSync(outputRoot);
  const inputFile = path.join(materialRoot, "source.png");
  await writePublishImage(inputFile);
  const copiedOutput = path.join(outputRoot, "P1.png");
  fs.copyFileSync(inputFile, copiedOutput);
  const copyFile = path.join(outputRoot, "小红书文案.txt");
  fs.writeFileSync(copyFile, "这是一份用于测试图片来源核验的小红书文案。".repeat(8), "utf8");
  const plan = {
    materialName: "来源核验",
    materialPath: materialRoot,
    templatePath: templateRoot,
    templateName: "测试母版",
    pages: [{ code: "P1", title: "封面" }]
  };
  const report = await inspectProductionQuality({
    plan,
    outputRoot,
    results: [
      { type: "image", work: "来源核验", page: "P1", outputFile: copiedOutput },
      { type: "copy", work: "来源核验", outputFile: copyFile }
    ]
  });
  assert.equal(report.status, "needs-rework");
  assert.ok(report.failures.some((item) => item.includes("不是独立 AI 成品")));
});
