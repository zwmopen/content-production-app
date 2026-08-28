const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { aggregateTemplateRepository } = require("./sync-global-template-repository");

test("aggregateTemplateRepository merges source registries into a global index and HTML", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "global-template-repository-"));
  const sourceRoot = path.join(root, "source");
  const templateFolder = path.join(sourceRoot, "模板A");
  fs.mkdirSync(templateFolder, { recursive: true });
  fs.writeFileSync(path.join(templateFolder, "cover.jpg"), "image");
  fs.writeFileSync(path.join(sourceRoot, "templates-registry.json"), JSON.stringify({
    scope: { projectId: "p1", projectName: "项目一", platformId: "p", platformName: "平台一", categoryId: "c", categoryName: "分类一" },
    templates: [{ templateId: "T01", name: "模板A", localPath: templateFolder, imageCount: 1, textCount: 0, tags: { all: ["大字"] } }]
  }), "utf8");
  fs.writeFileSync(path.join(sourceRoot, "链接模板.txt"), "模板A | https://chatgpt.com/share/abc-123\n", "utf8");
  const configPath = path.join(root, "模板仓库配置.json");
  fs.writeFileSync(configPath, JSON.stringify({
    repository: { id: "global", name: "总模板仓库" },
    defaultScope: { projectId: "all", projectName: "全部项目", platformId: "all", platformName: "全部平台", categoryId: "all", categoryName: "全部" },
    sources: [{ id: "p1", name: "项目一", status: "active", projectRoot: root, materialRoot: sourceRoot, templateRoot: sourceRoot, platformId: "p", platformName: "平台一", categoryId: "c", categoryName: "分类一" }],
    categories: [{ id: "all", name: "全部", status: "active" }, { id: "c", name: "分类一", status: "active" }]
  }), "utf8");
  const output = path.join(root, "模板仓库.html");
  const index = path.join(root, "模板仓库索引.json");
  const result = aggregateTemplateRepository({ configPath, outputPath: output, indexPath: index });
  assert.equal(result.total, 1);
  assert.equal(result.complete, 1);
  assert.match(fs.readFileSync(output, "utf8"), /总模板仓库/);
  const indexData = JSON.parse(fs.readFileSync(index, "utf8"));
  assert.equal(indexData.templates[0].globalTemplateId, "p1-T01");
  assert.equal(indexData.sources[0].projectRoot, root);
  assert.equal(indexData.sources[0].materialRoot, sourceRoot);
  assert.equal(indexData.summary.total, 1);
});
