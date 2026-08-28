const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  inferMaterialUsageCountFromPath,
  inferMaterialTags,
  readMaterialTagText,
  materialCategoryCountMap,
  materialCategoryIndex,
  materialTreeSignature,
  materialMetadataProfile,
  scanMaterialFolderDiagnostics,
  scanPostFolders
} = require("./server");

test("physical usage archive folders provide a minimum usage count", () => {
  assert.equal(inferMaterialUsageCountFromPath("D:\\materials\\已使用一次\\post-a"), 1);
  assert.equal(inferMaterialUsageCountFromPath("D:\\materials\\已上传 2 次\\post-b"), 2);
  assert.equal(inferMaterialUsageCountFromPath("D:\\materials\\已制作三次GPT\\post-c"), 3);
  assert.equal(inferMaterialUsageCountFromPath("D:\\materials\\1\\post-d", "", { materialRoot: "D:\\materials" }), 1);
  assert.equal(inferMaterialUsageCountFromPath("D:\\materials\\0\\post-zero", "", { materialRoot: "D:\\materials" }), 0);
  assert.equal(inferMaterialUsageCountFromPath("D:\\materials\\4\\post-e", "", { materialRoot: "D:\\materials" }), 4);
  assert.equal(inferMaterialUsageCountFromPath("D:\\materials\\fresh\\2026\\post-f", "", { materialRoot: "D:\\materials" }), 0);
  assert.equal(inferMaterialUsageCountFromPath("D:\\materials\\fresh\\post-d"), 0);
});

test("material location tags read the full TXT, including text after the preview", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-tags-"));
  try {
    const post = path.join(root, "绍兴团建合集");
    fs.mkdirSync(post, { recursive: true });
    fs.writeFileSync(path.join(post, "text.txt"), `${"普通文案 ".repeat(80)}\n团建地点：绍兴柯岩`, "utf8");
    const fullText = readMaterialTagText(post);
    assert.match(fullText, /绍兴柯岩/);
    assert.ok(inferMaterialTags("0", path.basename(post), fullText).includes("绍兴"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("scanPostFolders recursively finds folders containing images and text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-scan-"));
  try {
    const post = path.join(root, "夏季团建", "安吉", "帖子A");
    const imagesOnly = path.join(root, "夏季团建", "只有图片");
    const hiddenPost = path.join(root, ".暂时不制作", "隐藏帖子");
    fs.mkdirSync(post, { recursive: true });
    fs.mkdirSync(imagesOnly, { recursive: true });
    fs.mkdirSync(hiddenPost, { recursive: true });
    fs.writeFileSync(path.join(post, "01.jpg"), "image");
    fs.writeFileSync(path.join(post, "文案.txt"), "copy");
    fs.writeFileSync(path.join(imagesOnly, "01.jpg"), "image");
    fs.writeFileSync(path.join(hiddenPost, "01.jpg"), "image");
    fs.writeFileSync(path.join(hiddenPost, "文案.txt"), "copy");

    const result = scanPostFolders(root);
    assert.deepEqual(result.map((item) => item.path), [post]);
    assert.equal(result[0].imageCount, 1);
    assert.equal(result[0].textCount, 1);
    assert.equal(result[0].relativeDepth, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("material diagnostics identify non-production folders and explain why", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-diagnostics-"));
  try {
    const ready = path.join(root, "ready");
    const missingText = path.join(root, "missing-text");
    const missingImage = path.join(root, "missing-image");
    const empty = path.join(root, "empty");
    const hidden = path.join(root, ".hidden-ready");
    [ready, missingText, missingImage, empty, hidden].forEach((folder) => fs.mkdirSync(folder, { recursive: true }));
    fs.writeFileSync(path.join(ready, "01.jpg"), "image");
    fs.writeFileSync(path.join(ready, "copy.txt"), "copy");
    fs.writeFileSync(path.join(missingText, "01.jpg"), "image");
    fs.writeFileSync(path.join(missingImage, "copy.txt"), "copy");
    fs.writeFileSync(path.join(hidden, "01.jpg"), "image");
    fs.writeFileSync(path.join(hidden, "copy.txt"), "copy");

    const result = scanMaterialFolderDiagnostics(root);
    assert.equal(result.readyCount, 1);
    assert.equal(result.invalidCount, 3);
    assert.deepEqual(result.reasons, { missingText: 1, missingImage: 1, empty: 1 });
    assert.deepEqual(result.issues.map((item) => item.reason).sort(), ["empty", "missing-image", "missing-text"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("materialTreeSignature changes when a top-level material category is renamed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-signature-"));
  try {
    const oldCategory = path.join(root, "信息流素材（高转化）");
    const newCategory = path.join(root, "转化素材-信息流素材（高转化）");
    fs.mkdirSync(oldCategory, { recursive: true });
    const before = materialTreeSignature(root);
    fs.renameSync(oldCategory, newCategory);
    const after = materialTreeSignature(root);
    assert.notEqual(after, before);
    assert.match(after, /转化素材-信息流素材/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("material category index stays shallow so opening the workbench does not scan every post", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-lazy-index-"));
  try {
    const first = path.join(root, "素材甲", "帖子一");
    const second = path.join(root, "素材乙", "帖子二");
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    fs.writeFileSync(path.join(first, "封面.png"), "image");
    fs.writeFileSync(path.join(first, "文案.txt"), "copy");
    fs.writeFileSync(path.join(second, "封面.png"), "image");
    fs.writeFileSync(path.join(second, "文案.txt"), "copy");

    const categories = materialCategoryIndex(root);
    assert.deepEqual(categories.map((item) => item.folderCount), [1, 1]);
    assert.deepEqual(categories.map((item) => item.name), ["素材甲", "素材乙"]);
    assert.deepEqual(scanPostFolders(categories[0].path).map((item) => item.name), ["帖子一"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("saved global index supplies real parent-folder counts without rescanning every post", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-count-index-"));
  const first = path.join(root, "精准流量贴");
  const second = path.join(root, "泛流量贴");
  try {
    fs.mkdirSync(path.join(first, "帖子一"), { recursive: true });
    fs.mkdirSync(path.join(second, "帖子二"), { recursive: true });
    const counts = materialCategoryCountMap(root, {
      root,
      categories: [
        { path: first, count: 31, sourceSignature: materialTreeSignature(first) },
        { path: second, count: 18, sourceSignature: materialTreeSignature(second) },
        { path: path.join(root, "损坏数据"), count: -1 }
      ]
    });

    assert.equal(counts.get(path.resolve(first)), 31);
    assert.equal(counts.get(path.resolve(second)), 18);
    assert.equal(counts.has(path.resolve(root, "损坏数据")), false);
    assert.equal(materialCategoryCountMap(path.join(root, "另一个素材库"), {
      root,
      categories: [{ path: first, count: 31, sourceSignature: materialTreeSignature(first) }]
    }).size, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("material metadata profile preserves complete integrity when a post has images and text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-global-integrity-"));
  const post = path.join(root, "0", "安吉两天一夜");
  const ledgerFile = path.join(root, "runtime", "material-metadata-ledger.json");
  const cacheFile = path.join(root, "runtime", "material-hash-cache.json");
  try {
    fs.mkdirSync(post, { recursive: true });
    fs.writeFileSync(path.join(post, "01.png"), "image");
    fs.writeFileSync(path.join(post, "文案.txt"), "安吉两天一夜漂流团建");
    const item = scanPostFolders(root)[0];
    const profile = materialMetadataProfile(item, "0", {
      materialRoot: root,
      ledgerFile,
      cacheFile
    });
    assert.equal(item.imageCount, 1);
    assert.equal(item.textCount, 1);
    assert.deepEqual(profile.tagGroups.integrity, ["完整"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
