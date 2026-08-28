const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { directoryIndex, historyIndex, resolveWorkPackagePath } = require("./work-package-locator");

test("作品移动进作品集后通过永久历史编号找到当前路径", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-work-locator-"));
  const folder = "20260809_120000_杭州团建";
  const moved = path.join(root, "作品集_055[转]", folder);
  fs.mkdirSync(moved, { recursive: true });
  const historyFile = path.join(root, "history.json");
  fs.writeFileSync(historyFile, JSON.stringify({ entries: [{ id: "work-1", packageFolder: folder, packagePath: moved }] }));
  const result = resolveWorkPackagePath(path.join(root, folder), { libraryRoot: root, historyFile });
  assert.equal(result.path, moved);
  assert.equal(result.moved, true);
  assert.equal(result.workId, "work-1");
  assert.equal(result.source, "history");
  fs.rmSync(root, { recursive: true, force: true });
});

test("仍在原位置的作品优先使用真实目录", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-work-locator-"));
  const current = path.join(root, "work-a");
  fs.mkdirSync(current);
  const result = resolveWorkPackagePath(current, { libraryRoot: root, index: historyIndex(path.join(root, "missing.json")) });
  assert.equal(result.path, current);
  assert.equal(result.moved, false);
  assert.equal(result.source, "original");
  assert.match(result.workId, /^[a-f0-9]{32}$/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("derived work identity stays stable after the package folder moves", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-work-locator-"));
  const folder = "20260809_140000_stable-work";
  const original = path.join(root, folder);
  fs.mkdirSync(original);
  const before = resolveWorkPackagePath(original, { libraryRoot: root, index: { byFolder: new Map() } });
  const moved = path.join(root, "collection", folder);
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  fs.renameSync(original, moved);
  const after = resolveWorkPackagePath(original, {
    libraryRoot: root,
    index: { byFolder: new Map([[folder, { packagePath: moved }]]) }
  });
  assert.equal(before.workId, after.workId);
  fs.rmSync(root, { recursive: true, force: true });
});

test("历史路径越出成品库时拒绝跟随", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-work-locator-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "tb-work-outside-"));
  const folder = "work-b";
  fs.mkdirSync(path.join(outside, folder));
  const result = resolveWorkPackagePath(path.join(root, folder), {
    libraryRoot: root,
    index: { byFolder: new Map([[folder, { id: "work-2", packagePath: path.join(outside, folder) }]]) }
  });
  assert.equal(result.source, "unresolved");
  assert.equal(result.path, path.join(root, folder));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test("历史数据库路径也过期时用一次目录索引找到作品集中的真实目录", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-work-locator-"));
  const folder = "20260809_130000_湖州团建";
  const moved = path.join(root, "抖音小红书", "作品集_060[转]", folder);
  fs.mkdirSync(moved, { recursive: true });
  fs.writeFileSync(path.join(moved, "GPT作品记录.json"), "{}");
  const result = resolveWorkPackagePath(path.join(root, folder), {
    libraryRoot: root,
    index: { byFolder: new Map([[folder, { id: "work-3", packagePath: path.join(root, "作品集_060[转]", folder) }]]) },
    directoryIndex: directoryIndex(root)
  });
  assert.equal(result.path, moved);
  assert.equal(result.workId, "work-3");
  assert.equal(result.source, "directory-index");
  fs.rmSync(root, { recursive: true, force: true });
});
