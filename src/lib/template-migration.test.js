"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  scanMaterialLibrary,
  summarizeTemplate,
  createSession,
  confirmSession,
  advanceSession,
  workFolderName
} = require("./template-migration");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-migration-"));
  const materialRoot = path.join(root, "素材库");
  const category = path.join(materialRoot, "江浙沪", "湖州");
  const material = path.join(category, "青山湖秋日团建");
  const second = path.join(materialRoot, "上海", "朱家角");
  const template = path.join(root, "模板");
  fs.mkdirSync(material, { recursive: true });
  fs.mkdirSync(second, { recursive: true });
  fs.mkdirSync(template, { recursive: true });
  fs.writeFileSync(path.join(material, "P1.jpg"), "image");
  fs.writeFileSync(path.join(material, "文案.txt"), "青山湖团队活动");
  fs.writeFileSync(path.join(material, ".tags.json"), JSON.stringify({ tags: ["湖州", "德清"], location: "浙江省湖州市" }));
  fs.writeFileSync(path.join(second, "P1.png"), "image");
  fs.writeFileSync(path.join(template, "cover.png"), "image");
  fs.writeFileSync(path.join(template, "template.json"), JSON.stringify({ name: "秋日拼图母版" }));
  return { root, materialRoot, material, second, template, outputRoot: path.join(root, "成品库") };
}

test("template migration scans recursive categories and preserves source tags", () => {
  const paths = fixture();
  try {
    const scan = scanMaterialLibrary(paths.materialRoot);
    assert.equal(scan.total, 2);
    assert.ok(scan.categories.some((item) => item.path.includes("江浙沪")));
    const item = scan.materials.find((entry) => entry.path === paths.material);
    assert.deepEqual(item.tags, ["湖州", "德清", "浙江省湖州市"]);
    assert.equal(item.imageCount, 1);
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test("template migration creates a locked template session and a named output folder after 1", () => {
  const paths = fixture();
  try {
    const template = summarizeTemplate(paths.template);
    assert.equal(template.locked, true);
    const session = createSession({
      templatePath: paths.template,
      materialRoot: paths.materialRoot,
      outputRoot: paths.outputRoot,
      selectedMaterialPaths: [paths.material]
    });
    assert.equal(session.scan.materials.length, 1);
    assert.equal(session.progress.currentIndex, 0);
    assert.equal(session.plan.maxPagesPerSet, 10);
    assert.match(session.outputLibrary, /_套板迁移$/);
    fs.mkdirSync(session.outputLibrary, { recursive: true });
    const confirmed = confirmSession(session);
    assert.equal(confirmed.status, "confirmed");
    assert.equal(fs.existsSync(confirmed.progress.currentWorkFolder), true);
    const manifest = JSON.parse(fs.readFileSync(path.join(confirmed.progress.currentWorkFolder, "manifest.json"), "utf8"));
    assert.equal(manifest.templatePath, paths.template);
    assert.equal(manifest.materialPath, paths.material);
    assert.deepEqual(manifest.sourceTags, ["湖州", "德清", "浙江省湖州市"]);
    assert.match(path.basename(confirmed.progress.currentWorkFolder), /^\d{8}_\d{6}-/);
    assert.match(workFolderName("a:b"), /^\d{8}_\d{6}-ab$/);
    const completed = advanceSession(confirmed, "complete");
    assert.equal(completed.status, "completed");
    assert.equal(completed.progress.completed, 1);
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});
