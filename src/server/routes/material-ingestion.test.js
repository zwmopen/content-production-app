const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MATERIAL_INGESTION_SKILL_ID,
  materialIngestionCommandArgs,
  parseMaterialIngestionOutput,
  materialIngestionSkillStatus
} = require("./skills");

test("素材处理技能是独立可执行入口，并默认使用预览模式", () => {
  const preview = materialIngestionCommandArgs("preview");
  const commit = materialIngestionCommandArgs("commit");
  assert.equal(MATERIAL_INGESTION_SKILL_ID, "jianghu-toolbox-material-ingestion");
  assert.ok(preview.some((item) => item.includes("-Preview")));
  assert.ok(!commit.some((item) => item.includes("-Preview")));
  assert.ok(preview.some((item) => item.includes("-ConfigPath")));
});

test("素材整理输出会归一化为预览和执行摘要", () => {
  const output = "识别到：3 个可入库帖子，1 个空帖子目录，2 个残留待确认目录。\n"
    + "已移动 3 个帖子；已删除 1 个空帖子目录；保留 2 个残留目录（视频/TXT 等）待确认。";
  const preview = parseMaterialIngestionOutput(output, "preview");
  assert.equal(preview.kind, "material_ingestion");
  assert.equal(preview.status, "preview_ready");
  assert.equal(preview.completePosts, 3);
  assert.equal(preview.emptyPosts, 1);
  assert.equal(preview.residualDirs, 2);
  assert.equal(preview.moved, 3);
  const commit = parseMaterialIngestionOutput(output, "commit");
  assert.equal(commit.status, "completed");
  assert.equal(commit.previewPreserved, false);
});

test("素材技能状态不泄漏秘密，并在缺少配置时阻断", () => {
  const status = materialIngestionSkillStatus({
    id: MATERIAL_INGESTION_SKILL_ID,
    sourcePath: "C:\\missing\\SKILL.md"
  });
  assert.equal(status.canRun, false);
  assert.ok(["blocked", "disabled"].includes(status.overallStatus));
  assert.equal(JSON.stringify(status).includes("access_token"), false);
});
