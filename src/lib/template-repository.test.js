const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readTemplateRepositoryConfig, scopeForTemplate } = require("./template-repository");

test("模板仓库配置提供项目、平台、分类和 AI 维护默认范围", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-repository-"));
  try {
    assert.equal(readTemplateRepositoryConfig().repository.name, "图文模板仓库");
    const file = path.join(root, "模板仓库配置.json");
    fs.writeFileSync(file, JSON.stringify({
      repository: { name: "测试仓库" },
      defaultScope: { projectId: "p1", projectName: "项目一", platformId: "xhs", platformName: "小红书", categoryId: "travel", categoryName: "旅行" },
      categories: [{ id: "all", name: "全部" }, { id: "travel", name: "旅行" }],
      automation: { autoSync: true }
    }), "utf8");
    const config = readTemplateRepositoryConfig(file);
    assert.equal(config.repository.name, "测试仓库");
    assert.equal(config.defaultScope.categoryId, "travel");
    assert.equal(config.automation.intake, "ai-first");
    assert.equal(scopeForTemplate({}, config).platformName, "小红书");
    assert.equal(scopeForTemplate({ scope: { categoryId: "teambuilding", categoryName: "团建" } }, config).categoryName, "团建");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
