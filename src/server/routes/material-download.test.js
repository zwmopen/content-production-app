const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const route = require("./material-download");

test("素材下载技能目录绑定现有万能下载器 V2", () => {
  const skill = route.catalog()[0];
  assert.equal(skill.id, "material-download");
  assert.equal(skill.skillId, "universal-downloader");
  assert.equal(skill.mode, "cautious");
  assert.match(skill.sourceRoot, /xhs-dl/i);
  assert.match(skill.script, /download\.py$/i);
});

test("素材下载默认目录是当前用户 Downloads", () => {
  const expected = path.join(os.homedir(), "Downloads");
  assert.equal(route.defaultOutputDir(), expected);
  assert.equal(route.safeOutputDir(""), path.resolve(expected));
  assert.equal(route.safeOutputDir(path.join(expected, "素材下载测试")), path.resolve(expected, "素材下载测试"));
});

test("素材下载拒绝工作台外的任意输出路径", () => {
  assert.throws(
    () => route.safeOutputDir(path.join(os.tmpdir(), "material-download-test")),
    (error) => error.code === "MATERIAL_DOWNLOAD_OUTPUT_NOT_ALLOWED"
  );
});
