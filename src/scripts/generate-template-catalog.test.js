const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { generateTemplateCatalog } = require("./generate-template-catalog");

test("模板仓库同时生成新入口和旧台账兼容入口，并包含描述与复制操作", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-catalog-"));
  try {
    const local = path.join(root, "已命名模板", "测试模板");
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, "P1.jpg"), "cover");
    fs.writeFileSync(path.join(local, "P2.jpg"), "inner");
    fs.writeFileSync(path.join(root, "templates-registry.json"), JSON.stringify({
      templates: [{
        templateId: "T01",
        name: "测试模板",
        localPath: local,
        imageCount: 2,
        textCount: 1,
        description: "实景大图封面与四宫格项目内页",
        tags: { all: ["精准流量", "四宫格"] }
      }]
    }), "utf8");
    fs.writeFileSync(path.join(root, "链接模板.txt"), "测试模板\thttps://chatgpt.com/share/abc123\n", "utf8");
    fs.writeFileSync(path.join(root, "模板仓库配置.json"), JSON.stringify({
      repository: { name: "测试模板仓库" },
      defaultScope: { projectName: "测试项目", platformName: "小红书", categoryId: "teambuilding", categoryName: "团建" },
      categories: [{ id: "all", name: "全部" }, { id: "teambuilding", name: "团建" }, { id: "travel", name: "旅行" }],
      platforms: [{ id: "xiaohongshu", name: "小红书", status: "active" }, { id: "douyin", name: "抖音", status: "planned" }]
    }), "utf8");

    const result = generateTemplateCatalog({ templateRoot: root });
    const html = fs.readFileSync(result.output, "utf8");
    const legacyHtml = fs.readFileSync(result.legacyOutput, "utf8");
    assert.equal(path.basename(result.output), "模板仓库.html");
    assert.equal(path.basename(result.legacyOutput), "模板台账.html");
    assert.match(html, /<title>模板仓库<\/title>/);
    assert.match(html, /测试模板仓库/);
    assert.match(html, /data-category="travel"/);
    assert.match(html, /AI维护：自动采集/);
    assert.match(html, /抖音（待接入）/);
    assert.match(html, /<th>模板描述<\/th>/);
    assert.match(html, /<th>添加时间<\/th>/);
    assert.match(html, /实景大图封面与四宫格项目内页/);
    assert.match(html, /复制链接/);
    assert.match(html, /复制地址/);
    assert.match(html, /☾/);
    assert.match(html, /white-space:normal;overflow-wrap:anywhere/);
    assert.match(html, /tag-list\{display:flex;flex-wrap:wrap/);
    assert.doesNotMatch(html, /在线标题：/);
    assert.match(html, /navigator\.clipboard/);
    assert.equal(legacyHtml, html);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
