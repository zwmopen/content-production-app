"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { run, scanImageOnlyFolders } = require("./analyze-no-text-materials");

test("只扫描图片目录并生成可复用的 JSON/Markdown 报告，不改动素材目录", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-no-text-report-"));
  const candidate = path.join(root, "0", "溧阳团建两天一夜");
  const complete = path.join(root, "0", "完整帖子");
  const nested = path.join(root, "1", "宜兴漂流团建");
  fs.mkdirSync(candidate, { recursive: true });
  fs.mkdirSync(complete, { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(candidate, "1.jpg"), "image");
  fs.writeFileSync(path.join(candidate, "2.png"), "image");
  fs.writeFileSync(path.join(complete, "1.jpg"), "image");
  fs.writeFileSync(path.join(complete, "文案.txt"), "copy");
  fs.writeFileSync(path.join(nested, "1.jpg"), "image");
  const before = fs.readdirSync(candidate).sort();
  const scan = scanImageOnlyFolders(root);
  assert.equal(scan.candidates.length, 2);
  assert.deepEqual(scan.candidates.map((item) => item.name), ["溧阳团建两天一夜", "宜兴漂流团建"]);
  const output = path.join(root, "reports", "analysis.json");
  const report = run(["--root", root, "--output", output]);
  assert.equal(report.summary.candidateCount, 2);
  assert.equal(fs.existsSync(output), true);
  assert.equal(fs.existsSync(output.replace(/\.json$/, ".md")), true);
  assert.deepEqual(fs.readdirSync(candidate).sort(), before);
});
