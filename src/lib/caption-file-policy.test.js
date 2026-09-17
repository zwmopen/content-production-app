const test = require("node:test");
const assert = require("node:assert/strict");
const { chooseCaptionFileName, isCaptionCandidate } = require("./caption-file-policy");

test("caption policy prefers publish copy and excludes workflow metadata", () => {
  assert.equal(chooseCaptionFileName([
    "生产对话轨迹.txt",
    "会话追踪.txt",
    "抖音文案.txt",
    "小红书文案.txt",
    "文案.txt"
  ]), "文案.txt");
  assert.equal(chooseCaptionFileName(["生产对话轨迹.txt", "小红书文案.txt"]), "小红书文案.txt");
  assert.equal(chooseCaptionFileName(["生产对话轨迹.txt", "质量报告.txt"]), "");
  assert.equal(chooseCaptionFileName(["生成提示词.txt", "会话追踪.txt"]), "");
  assert.equal(chooseCaptionFileName(["生成提示词.txt", "未知说明.txt", "另一份.txt"]), "");
  assert.equal(chooseCaptionFileName(["生成提示词.txt", "文案_20260908.txt"]), "文案_20260908.txt");
  assert.equal(isCaptionCandidate("生产对话轨迹.txt"), false);
  assert.equal(isCaptionCandidate("生成提示词.txt"), false);
  assert.equal(chooseCaptionFileName(["质量报告_20260908.txt", "会话追踪.md"]), "");
  assert.equal(chooseCaptionFileName(["会话追踪.txt", "README.md", "出图计划.md"]), "");
});

test("caption policy keeps markdown as an explicit desktop fallback", () => {
  assert.equal(chooseCaptionFileName(["会话追踪.txt", "小红书文案.md"], { allowMarkdown: true }), "小红书文案.md");
  assert.equal(chooseCaptionFileName(["生产记录.txt", "说明.md"], { allowMarkdown: true }), "说明.md");
  assert.equal(chooseCaptionFileName(["生产记录.txt", "说明.md"]), "");
});
