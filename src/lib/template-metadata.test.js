const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { syncTemplateMetadata } = require("./template-metadata");

test("template metadata keeps source note fields and one-link GPT account binding", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-meta-"));
  const templateRoot = path.join(root, "02-模板库");
  const folder = path.join(templateRoot, "已命名模板", "示例模板");
  const sourceFolder = path.join(root, "01-素材库", "0", "评1-赞2-示例标题-示例账号");
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(sourceFolder, { recursive: true });
  fs.writeFileSync(path.join(folder, "P1.jpg"), "image");
  fs.writeFileSync(path.join(folder, "P2.jpg"), "image");
  fs.writeFileSync(path.join(folder, "text.txt"), "copy");
  fs.writeFileSync(path.join(sourceFolder, "文案.txt"), "标题：示例标题\n话题：#宁波团建 #溪畔农庄");
  const csv = path.join(root, "01-素材库", "素材链接记录.csv");
  fs.mkdirSync(path.dirname(csv), { recursive: true });
  fs.writeFileSync(csv, [
    '"添加时间","素材ID","标题","来源类型","链接","原始素材路径","素材文件夹","状态","模板ID","成品路径","备注"',
    `"2026-08-14 12:00:00","XHS-1","示例标题","小红书公开采集","http://xhslink.cn/o/demo","${sourceFolder}","${sourceFolder}","已入模板库","T01","",""`
  ].join("\n"), "utf8");
  const result = syncTemplateMetadata({
    templateRoot,
    materialCsvPath: csv,
    registry: {
      repository: { id: "test-repository", name: "测试模板仓库", mode: "ai-maintained" },
      scope: { projectId: "p1", projectName: "测试项目", platformId: "xiaohongshu", platformName: "小红书", categoryId: "teambuilding", categoryName: "团建" },
      templates: [{
        templateId: "T01",
        name: "示例模板",
        category: "conversion",
        enabled: true,
        localPath: folder,
        imageCount: 2,
        textCount: 1,
        localVersion: "abc123",
        onlineStatus: "uploaded",
        onlineUrl: "https://chatgpt.com/share/demo",
        onlineProvider: "chatgpt",
        onlineAccountId: "GPT-A",
        description: "示例模板描述",
        tags: { all: ["精准流量", "转化类"] }
      }]
    },
    repositoryConfig: {
      repository: { id: "test-repository", name: "测试模板仓库", mode: "ai-maintained" },
      defaultScope: { projectId: "p1", projectName: "测试项目", platformId: "xiaohongshu", platformName: "小红书", categoryId: "teambuilding", categoryName: "团建" }
    },
    generatedAt: "2026-08-14T00:00:00.000Z"
  });
  const metadata = JSON.parse(fs.readFileSync(path.join(folder, "template.json"), "utf8"));
  assert.equal(result.total, 1);
  assert.equal(metadata.source.originalTitle, "示例标题");
  assert.equal(metadata.source.originalNoteUrl, "http://xhslink.cn/o/demo");
  assert.equal(metadata.source.account, "示例账号");
  assert.equal(metadata.template.description, "示例模板描述");
  assert.equal(metadata.repository.name, "测试模板仓库");
  assert.equal(metadata.repository.scope.categoryName, "团建");
  assert.deepEqual(metadata.tags.note, ["宁波团建", "溪畔农庄"]);
  assert.equal(metadata.online.shareUrl, "https://chatgpt.com/share/demo");
  assert.equal(metadata.online.gptAccount, "GPT-A");
  assert.equal(metadata.online.conversationUrl, "");
  assert.match(metadata.online.accountBinding, /一个在线链接/);
});
