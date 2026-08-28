const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildTemplateRegistry, renderTemplateRegistryMarkdown, inferTemplateTags, matchOnlineTemplate, mapOnlineTemplates } = require("./template-registry");

test("template registry keeps stable ids and marks missing or stale online mirrors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-template-registry-"));
  const file = path.join(root, "01.txt");
  fs.writeFileSync(file, "v2");
  const registry = buildTemplateRegistry([{ id: "T01", name: "母版一", type: "conversion", path: root, attachments: [file], imageCount: 1 }], {
    templates: [{ templateId: "T01", localHash: "old", onlineUrl: "https://chatgpt.com/share/example", onlineStatus: "uploaded" }]
  }, { now: "2026-08-10T12:00:00.000Z" });
  assert.equal(registry.templates[0].templateId, "T01");
  assert.equal(registry.templates[0].addedAt, "2026-08-10T12:00:00.000Z");
  assert.equal(registry.templates[0].onlineStatus, "update_required");
  assert.equal(registry.summary.updateRequired, 1);
  assert.match(renderTemplateRegistryMarkdown(registry), /在线覆盖率：0%/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("template registry maps an exact online template name", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-template-registry-"));
  const file = path.join(root, "01.txt");
  fs.writeFileSync(file, "v1");
  const registry = buildTemplateRegistry([{ id: "T02", name: "母版二", path: root, attachments: [file] }], {}, {
    onlineTemplates: [{ name: "母版二", url: "https://chatgpt.com/share/example" }]
  });
  assert.equal(registry.templates[0].onlineStatus, "uploaded");
  assert.equal(registry.summary.onlineMapped, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("template registry honors an explicit online template id when names differ", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-template-registry-"));
  const file = path.join(root, "01.txt");
  fs.writeFileSync(file, "v1");
  const online = { templateId: "T02", name: "巨型白字黑描边封面 × 无白边四宫格中置白条大字内页", url: "https://chatgpt.com/share/explicit-id" };
  const mapped = mapOnlineTemplates([{ id: "T02", name: "九宫格项目合集封面" }], [online]);
  assert.equal(mapped.get("T02").url, online.url);
  const registry = buildTemplateRegistry([{ id: "T02", name: "九宫格项目合集封面", path: root, attachments: [file] }], {}, {
    onlineTemplates: [online]
  });
  assert.equal(registry.templates[0].onlineStatus, "uploaded");
  assert.equal(registry.templates[0].onlineTitle, online.name);
  fs.rmSync(root, { recursive: true, force: true });
});

test("template registry maps a unique descriptive online variant to the stable local template", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-template-registry-"));
  const file = path.join(root, "01.txt");
  fs.writeFileSync(file, "v1");
  const online = { name: "备忘录手写大字封面 × 蓝黄荧光笔撕纸拼图内页", url: "https://chatgpt.com/share/variant" };
  assert.equal(matchOnlineTemplate({ name: "备忘录手写大字封面" }, [online]), online);
  const registry = buildTemplateRegistry([{ id: "T03", name: "备忘录手写大字封面", path: root, attachments: [file] }], {}, {
    onlineTemplates: [online]
  });
  assert.equal(registry.templates[0].onlineUrl, online.url);
  assert.equal(registry.templates[0].onlineStatus, "uploaded");
  fs.rmSync(root, { recursive: true, force: true });
});

test("template registry does not guess when a descriptive variant matches multiple local templates", () => {
  const online = { name: "航拍路线节点封面 × 新版拼图", url: "https://chatgpt.com/share/ambiguous" };
  assert.equal(matchOnlineTemplate({ name: "航拍路线节点封面" }, [online]), online);
  assert.equal(matchOnlineTemplate({ name: "航拍路线节点封面" }, [
    online,
    { name: "航拍路线节点封面 × 新版拼图", url: "https://chatgpt.com/share/ambiguous-2" }
  ]), null);
});

test("exact full-name mapping wins over a shorter local-name prefix", () => {
  const templates = [
    { id: "T03", name: "航拍路线节点封面" },
    { id: "T16", name: "航拍路线节点封面 × 黑白描边大字无白边项目拼图" }
  ];
  const online = { name: templates[1].name, url: "https://chatgpt.com/share/exact-full" };
  const mapped = mapOnlineTemplates(templates, [online]);
  assert.equal(mapped.get("T16").url, online.url);
  assert.equal(mapped.has("T03"), false);
});

test("a stale old URL duplicated by a current exact mapping is cleared", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-template-registry-"));
  const file = path.join(root, "01.txt");
  fs.writeFileSync(file, "v1");
  const sharedUrl = "https://chatgpt.com/share/shared";
  const registry = buildTemplateRegistry([
    { id: "T03", name: "航拍路线节点封面", path: root, attachments: [file] },
    { id: "T16", name: "航拍路线节点封面 × 黑白描边大字无白边项目拼图", path: root, attachments: [file] }
  ], {
    templates: [{ templateId: "T03", onlineUrl: sharedUrl }]
  }, {
    onlineTemplates: [{ name: "航拍路线节点封面 × 黑白描边大字无白边项目拼图", url: sharedUrl }]
  });
  assert.equal(registry.templates.find((item) => item.templateId === "T03").onlineUrl, "");
  assert.equal(registry.templates.find((item) => item.templateId === "T16").onlineUrl, sharedUrl);
  fs.rmSync(root, { recursive: true, force: true });
});

test("template registry infers searchable visual feature tags", () => {
  const tags = inferTemplateTags({
    name: "黄黑渐变巨字封面 × 上大下双拼无白边项目拼图",
    usage: "路线方案/报价",
    note: "封面带价格，实景大图"
  });
  assert.ok(tags.visual.includes("大字封面"));
  assert.ok(tags.visual.includes("无白边拼图"));
  assert.ok(tags.visual.includes("黄黑渐变"));
  assert.ok(tags.visual.includes("上大下双拼"));
  assert.ok(tags.visual.includes("封面带价格"));
  assert.ok(tags.all.includes("封面带价格"));
});

test("template registry infers orange strip, double-scene, multi-grid and topic-page tags", () => {
  const tags = inferTemplateTags({
    name: "橙条超大描边字双景封面 × 无白边多宫格居中黑描边话题内页",
    usage: "上海/长兴岛/一日团建/项目合集",
    note: "非小游戏模板"
  });
  assert.equal(tags.traffic, "精准流量");
  assert.equal(tags.business, "收藏类");
  assert.equal(tags.scene, "上海");
  assert.ok(tags.visual.includes("橙色信息条"));
  assert.ok(tags.visual.includes("大字封面"));
  assert.ok(tags.visual.includes("拼图版式"));
  assert.ok(tags.visual.includes("双场景封面"));
  assert.ok(tags.visual.includes("话题内页"));
});
