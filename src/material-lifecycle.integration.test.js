const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  initializeMaterialLifecycle,
  getMaterialLifecycleLedger,
  archiveMaterialAfterProduction,
  claimMaterialLifecycle,
  releaseMaterialLifecycleFailure,
  getMaterialMetadataLedger,
  getMaterialUsageLedger
} = require("./server");

function makePost(directory, text = "上海团建露营攻略") {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "01.png"), "same-image", "utf8");
  fs.writeFileSync(path.join(directory, "文案.txt"), text, "utf8");
}

test("initial lifecycle scan tags only complete visible posts and never moves them", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-material-lifecycle-"));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "tb-material-lifecycle-runtime-"));
  try {
    const clean = path.join(root, "0", "上海露营帖子");
    const duplicate = path.join(root, "0", "上海露营帖子-副本");
    const imageOnly = path.join(root, "0", "只有图片");
    const hidden = path.join(root, ".暂不制作", "隐藏帖子");
    makePost(clean);
    makePost(duplicate);
    fs.mkdirSync(imageOnly, { recursive: true });
    fs.writeFileSync(path.join(imageOnly, "01.png"), "image-only", "utf8");
    makePost(hidden);

    const metadataLedgerFile = path.join(runtime, "防重复账本", "material-metadata-ledger.json");
    const lifecycleLedgerFile = path.join(runtime, "material-lifecycle-ledger.json");
    const hashCacheFile = path.join(runtime, "material-hash-cache.json");
    const indexFile = path.join(runtime, "material-global-index.json");
    const result = initializeMaterialLifecycle({
      materialRoot: root,
      metadataLedgerFile,
      lifecycleLedgerFile,
      hashCacheFile,
      indexFile,
      refreshIndex: false
    });

    assert.equal(result.scanned, 2);
    assert.equal(result.moved, 0);
    assert.equal(result.conflicts, 2);
    assert.equal(fs.existsSync(path.join(clean, ".tags.json")), true);
    assert.equal(fs.existsSync(path.join(duplicate, ".tags.json")), true);
    assert.equal(fs.existsSync(path.join(imageOnly, ".tags.json")), false);
    assert.equal(fs.existsSync(path.join(hidden, ".tags.json")), false);
    assert.equal(fs.existsSync(clean), true);
    assert.equal(fs.existsSync(duplicate), true);
    const lifecycle = getMaterialLifecycleLedger(lifecycleLedgerFile);
    assert.equal(Object.keys(lifecycle.entries).length, 2);
    assert.equal(Object.values(lifecycle.entries).every((entry) => entry.lifecycleState === "待复核"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});

test("initial lifecycle scan keeps legacy .tags.json fields and manual tags", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-material-legacy-tags-"));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "tb-material-legacy-runtime-"));
  try {
    const post = path.join(root, "0", "旧标签帖子");
    makePost(post, "杭州露营团建");
    fs.writeFileSync(path.join(post, ".tags.json"), JSON.stringify({
      tags: ["人工精选", "来源:历史整理"],
      mainTag: "团建游戏",
      sourceKeyword: "旧来源",
      commentCount: 7
    }, null, 2), "utf8");
    const options = {
      materialRoot: root,
      metadataLedgerFile: path.join(runtime, "防重复账本", "material-metadata-ledger.json"),
      lifecycleLedgerFile: path.join(runtime, "material-lifecycle-ledger.json"),
      hashCacheFile: path.join(runtime, "material-hash-cache.json"),
      indexFile: path.join(runtime, "material-global-index.json"),
      refreshIndex: false
    };

    initializeMaterialLifecycle(options);

    const saved = JSON.parse(fs.readFileSync(path.join(post, ".tags.json"), "utf8"));
    assert.ok(saved.tags.includes("人工精选"));
    assert.ok(saved.tags.includes("来源:历史整理"));
    assert.equal(saved.sourceKeyword, "旧来源");
    assert.equal(saved.commentCount, 7);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});

test("archive increments usage once when the same production request is replayed", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tb-material-archive-"));
  const root = path.join(parent, "materials");
  const source = path.join(root, "0", "可归档帖子");
  const packagePath = path.join(parent, "products", "已验证成品");
  const runtime = path.join(parent, "runtime");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "01.png"), "archive-image", "utf8");
  fs.writeFileSync(path.join(source, "文案.txt"), "archive-copy", "utf8");
  fs.mkdirSync(packagePath, { recursive: true });
  const options = {
    settings: { materialRoot: root, workPackage: { libraryPath: path.join(parent, "products") } },
    metadataLedgerFile: path.join(runtime, "防重复账本", "material-metadata-ledger.json"),
    usageLedgerFile: path.join(runtime, "防重复账本", "material-usage-ledger.json"),
    hashCacheFile: path.join(runtime, "material-hash-cache.json"),
    lifecycleLedgerFile: path.join(runtime, "material-lifecycle-ledger.json"),
    indexFile: path.join(runtime, "material-global-index.json"),
    archiveLogFile: path.join(runtime, "gpt-production-archive.jsonl"),
    refreshIndex: false
  };
  const body = {
    entryPath: source,
    requestId: "archive-once",
    conversationUrl: "https://chatgpt.com/c/test",
    packagePath
  };
  try {
    const first = archiveMaterialAfterProduction(body, options);
    const second = archiveMaterialAfterProduction(body, options);
    assert.equal(first.usageCount, 1);
    assert.equal(second.idempotent, true);
    assert.equal(second.usageCount, 1);
    assert.equal(fs.existsSync(path.join(root, "1", "可归档帖子")), true);
    const metadata = getMaterialMetadataLedger(options.metadataLedgerFile);
    assert.equal(Object.values(metadata.entries)[0].usageCount, 1);
    const usage = getMaterialUsageLedger(options.usageLedgerFile);
    assert.equal(Object.values(usage.entries)[0].status, "used");
    const lifecycle = getMaterialLifecycleLedger(options.lifecycleLedgerFile);
    assert.equal(Object.values(lifecycle.entries)[0].lifecycleState, "归档完成");
    assert.equal(Object.values(lifecycle.entries)[0].archiveEvents.length, 1);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("explicit archive event key takes precedence over an older request id", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tb-material-archive-key-"));
  const root = path.join(parent, "materials");
  const sourceA = path.join(root, "0", "显式事件帖子A");
  const sourceB = path.join(root, "0", "显式事件帖子B");
  const packageA = path.join(parent, "products", "成品A");
  const packageB = path.join(parent, "products", "成品B");
  const runtime = path.join(parent, "runtime");
  for (const source of [sourceA, sourceB]) {
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "01.png"), path.basename(source), "utf8");
    fs.writeFileSync(path.join(source, "文案.txt"), "archive-copy", "utf8");
  }
  for (const packagePath of [packageA, packageB]) fs.mkdirSync(packagePath, { recursive: true });
  const options = {
    settings: { materialRoot: root, workPackage: { libraryPath: path.join(parent, "products") } },
    metadataLedgerFile: path.join(runtime, "防重复账本", "material-metadata-ledger.json"),
    usageLedgerFile: path.join(runtime, "防重复账本", "material-usage-ledger.json"),
    hashCacheFile: path.join(runtime, "material-hash-cache.json"),
    lifecycleLedgerFile: path.join(runtime, "material-lifecycle-ledger.json"),
    indexFile: path.join(runtime, "material-global-index.json"),
    archiveLogFile: path.join(runtime, "gpt-production-archive.jsonl"),
    refreshIndex: false
  };
  try {
    const first = archiveMaterialAfterProduction({
      entryPath: sourceA,
      requestId: "reused-request-id",
      archiveEventKey: "archive-event-a",
      packagePath: packageA
    }, options);
    const second = archiveMaterialAfterProduction({
      entryPath: sourceB,
      requestId: "reused-request-id",
      archiveEventKey: "archive-event-b",
      packagePath: packageB
    }, options);

    assert.equal(first.archiveEventKey, "archive-event-a");
    assert.equal(second.archiveEventKey, "archive-event-b");
    assert.equal(second.idempotent, undefined);
    assert.equal(fs.existsSync(path.join(root, "1", "显式事件帖子A")), true);
    assert.equal(fs.existsSync(path.join(root, "1", "显式事件帖子B")), true);
    assert.equal(Object.values(getMaterialUsageLedger(options.usageLedgerFile).entries).length, 2);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("archive rejects an unverified package without moving or incrementing the material", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tb-material-archive-guard-"));
  const root = path.join(parent, "materials");
  const source = path.join(root, "0", "未验证成品帖子");
  const runtime = path.join(parent, "runtime");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "01.png"), "guard-image", "utf8");
  fs.writeFileSync(path.join(source, "文案.txt"), "guard-copy", "utf8");
  const options = {
    settings: { materialRoot: root, workPackage: { libraryPath: path.join(parent, "products") } },
    metadataLedgerFile: path.join(runtime, "防重复账本", "material-metadata-ledger.json"),
    usageLedgerFile: path.join(runtime, "防重复账本", "material-usage-ledger.json"),
    hashCacheFile: path.join(runtime, "material-hash-cache.json"),
    lifecycleLedgerFile: path.join(runtime, "material-lifecycle-ledger.json"),
    indexFile: path.join(runtime, "material-global-index.json"),
    archiveLogFile: path.join(runtime, "gpt-production-archive.jsonl"),
    refreshIndex: false
  };
  try {
    assert.throws(
      () => archiveMaterialAfterProduction({
        entryPath: source,
        requestId: "archive-without-package",
        conversationUrl: "https://chatgpt.com/c/test"
      }, options),
      (error) => error.code === "MISSING_VERIFIED_PACKAGE"
    );
    assert.equal(fs.existsSync(source), true);
    assert.equal(fs.existsSync(path.join(root, "1", "未验证成品帖子")), false);
    assert.deepEqual(getMaterialMetadataLedger(options.metadataLedgerFile).entries, {});
    assert.deepEqual(getMaterialUsageLedger(options.usageLedgerFile).entries, {});
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("production claim and quota failure keep the source in place without changing usage", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tb-material-claim-"));
  const root = path.join(parent, "materials");
  const source = path.join(root, "0", "待生产帖子");
  const runtime = path.join(parent, "runtime");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "01.png"), "claim-image", "utf8");
  fs.writeFileSync(path.join(source, "文案.txt"), "杭州露营团建", "utf8");
  const options = {
    materialRoot: root,
    metadataLedgerFile: path.join(runtime, "防重复账本", "material-metadata-ledger.json"),
    lifecycleLedgerFile: path.join(runtime, "material-lifecycle-ledger.json"),
    hashCacheFile: path.join(runtime, "material-hash-cache.json"),
    indexFile: path.join(runtime, "material-global-index.json"),
    refreshIndex: false
  };
  try {
    initializeMaterialLifecycle(options);
    const claimed = claimMaterialLifecycle({ entryPath: source, owner: "account-a", requestId: "claim-1" }, options);
    assert.equal(claimed.lifecycleState, "生产中");
    const failed = releaseMaterialLifecycleFailure({
      entryPath: source,
      owner: "account-a",
      code: "GPT_QUOTA_LIMIT",
      error: "等待额度恢复"
    }, options);
    assert.equal(failed.lifecycle.operationalStatus, "等待额度");
    assert.equal(fs.existsSync(source), true);
    const lifecycle = getMaterialLifecycleLedger(options.lifecycleLedgerFile);
    const entry = Object.values(lifecycle.entries)[0];
    assert.equal(entry.usageCount, 0);
    assert.equal(entry.lifecycleState, "生产中");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
