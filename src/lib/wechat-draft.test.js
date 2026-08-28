const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const wechatDraft = require("./wechat-draft");

test("wechat account settings merge accounts and never persist AppSecret", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-draft-settings-"));
  const previousRuntime = process.env.TEAMBUILDING_DASHBOARD_RUNTIME;
  process.env.TEAMBUILDING_DASHBOARD_RUNTIME = runtime;
  try {
    wechatDraft.saveWechatSettings({
      defaultAccount: "main",
      accounts: {
        main: {
          name: "主公众号",
          appId: "wx_main",
          appSecretEnv: "WECHAT_MAIN_APP_SECRET",
          appSecret: "must-not-persist"
        }
      }
    });
    const saved = wechatDraft.saveWechatSettings({
      defaultAccount: "secondary",
      accounts: {
        secondary: {
          name: "备用公众号",
          appId: "wx_secondary",
          appSecretEnv: "WECHAT_SECONDARY_APP_SECRET",
          appSecret: "also-must-not-persist"
        }
      }
    });
    assert.equal(saved.defaultAccount, "secondary");
    assert.equal(saved.accounts.main.name, "主公众号");
    assert.equal(saved.accounts.secondary.name, "备用公众号");
    assert.equal(saved.accounts.main.appSecret, undefined);
    assert.equal(saved.accounts.secondary.appSecret, undefined);
  } finally {
    if (previousRuntime == null) delete process.env.TEAMBUILDING_DASHBOARD_RUNTIME;
    else process.env.TEAMBUILDING_DASHBOARD_RUNTIME = previousRuntime;
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});

// ─── 批量草稿队列测试 ──────────────────────────────────

function setupRuntime() {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-batch-"));
  const previous = process.env.TEAMBUILDING_DASHBOARD_RUNTIME;
  process.env.TEAMBUILDING_DASHBOARD_RUNTIME = runtime;
  return { runtime, previous, cleanup() {
    if (previous == null) delete process.env.TEAMBUILDING_DASHBOARD_RUNTIME;
    else process.env.TEAMBUILDING_DASHBOARD_RUNTIME = previous;
    fs.rmSync(runtime, { recursive: true, force: true });
  }};
}

test("createBatchQueue persists multiple posts and returns a batch id", () => {
  const ctx = setupRuntime();
  try {
    const batchId = wechatDraft.createBatchQueue([
      { postPath: "D:\\fake\\post1", title: "标题一", body: "正文一" },
      { postPath: "D:\\fake\\post2", title: "标题二", body: "正文二" },
      { postPath: "D:\\fake\\post3", title: "标题三", body: "正文三" }
    ]);
    assert.ok(batchId, "batchId should be returned");
    assert.match(batchId, /^batch_\d+/, "batchId starts with batch_");

    const queue = wechatDraft.getBatchQueue();
    assert.equal(queue.batchId, batchId);
    assert.equal(queue.status, "pending");
    assert.equal(queue.items.length, 3);
    assert.equal(queue.items[0].postPath, "D:\\fake\\post1");
    assert.equal(queue.items[0].title, "标题一");
    assert.equal(queue.items[0].status, "pending");
    assert.equal(queue.items[2].title, "标题三");
  } finally {
    ctx.cleanup();
  }
});

test("getBatchQueue returns empty state when no batch exists", () => {
  const ctx = setupRuntime();
  try {
    const queue = wechatDraft.getBatchQueue();
    assert.equal(queue.batchId, null);
    assert.equal(queue.status, "idle");
    assert.equal(queue.items.length, 0);
  } finally {
    ctx.cleanup();
  }
});

test("updateBatchItem marks items as success or failed with details", () => {
  const ctx = setupRuntime();
  try {
    const batchId = wechatDraft.createBatchQueue([
      { postPath: "D:\\fake\\post1", title: "标题一", body: "正文一" },
      { postPath: "D:\\fake\\post2", title: "标题二", body: "正文二" }
    ]);
    wechatDraft.updateBatchItem(batchId, 0, {
      status: "success",
      draftMediaId: "media_001",
      processedAt: new Date().toISOString()
    });
    wechatDraft.updateBatchItem(batchId, 1, {
      status: "failed",
      error: "上传素材失败",
      processedAt: new Date().toISOString()
    });

    const queue = wechatDraft.getBatchQueue();
    assert.equal(queue.items[0].status, "success");
    assert.equal(queue.items[0].draftMediaId, "media_001");
    assert.equal(queue.items[1].status, "failed");
    assert.equal(queue.items[1].error, "上传素材失败");
  } finally {
    ctx.cleanup();
  }
});

test("updateBatchStatus sets the overall batch status", () => {
  const ctx = setupRuntime();
  try {
    const batchId = wechatDraft.createBatchQueue([
      { postPath: "D:\\fake\\post1", title: "标题一", body: "正文一" }
    ]);
    wechatDraft.updateBatchStatus(batchId, "running");
    assert.equal(wechatDraft.getBatchQueue().status, "running");

    wechatDraft.updateBatchStatus(batchId, "completed");
    assert.equal(wechatDraft.getBatchQueue().status, "completed");
  } finally {
    ctx.cleanup();
  }
});

test("clearBatchQueue removes the persisted batch", () => {
  const ctx = setupRuntime();
  try {
    wechatDraft.createBatchQueue([
      { postPath: "D:\\fake\\post1", title: "标题一", body: "正文一" }
    ]);
    assert.ok(wechatDraft.getBatchQueue().batchId);

    wechatDraft.clearBatchQueue();
    const queue = wechatDraft.getBatchQueue();
    assert.equal(queue.batchId, null);
    assert.equal(queue.items.length, 0);
    assert.equal(queue.status, "idle");
  } finally {
    ctx.cleanup();
  }
});

test("batch queue survives across calls (persistence check)", () => {
  const ctx = setupRuntime();
  try {
    const batchId = wechatDraft.createBatchQueue([
      { postPath: "D:\\fake\\post1", title: "标题一", body: "正文一" }
    ]);
    // Simulate a "restart" by clearing the in-memory cache if any
    // The queue should be read back from disk
    const queue = wechatDraft.getBatchQueue();
    assert.equal(queue.batchId, batchId);
    assert.equal(queue.items.length, 1);
  } finally {
    ctx.cleanup();
  }
});

// ─── 图片素材复用测试 ──────────────────────────────────

test("recordMaterialMapping stores and retrieves media_id by image hash", () => {
  const ctx = setupRuntime();
  try {
    const hash1 = "abc123def456";
    const hash2 = "789xyz000aaa";

    wechatDraft.recordMaterialMapping(hash1, "media_id_001", "main");
    wechatDraft.recordMaterialMapping(hash2, "media_id_002", "main");

    const found1 = wechatDraft.findReusableMediaId(hash1, "main");
    assert.equal(found1, "media_id_001");

    const found2 = wechatDraft.findReusableMediaId(hash2, "main");
    assert.equal(found2, "media_id_002");

    const notFound = wechatDraft.findReusableMediaId("nonexistent_hash", "main");
    assert.equal(notFound, null);
  } finally {
    ctx.cleanup();
  }
});

test("findReusableMediaId is account-scoped", () => {
  const ctx = setupRuntime();
  try {
    const hash = "shared_hash_value";
    wechatDraft.recordMaterialMapping(hash, "media_main", "main");
    wechatDraft.recordMaterialMapping(hash, "media_secondary", "secondary");

    assert.equal(wechatDraft.findReusableMediaId(hash, "main"), "media_main");
    assert.equal(wechatDraft.findReusableMediaId(hash, "secondary"), "media_secondary");
    assert.equal(wechatDraft.findReusableMediaId(hash, "third"), null);
  } finally {
    ctx.cleanup();
  }
});

test("wechat settings default to the native web engine while retaining API as an option", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-draft-engine-"));
  const previousRuntime = process.env.TEAMBUILDING_DASHBOARD_RUNTIME;
  process.env.TEAMBUILDING_DASHBOARD_RUNTIME = runtime;
  try {
    assert.equal(wechatDraft.getWechatSettings().engine, "web");
    assert.equal(wechatDraft.getWechatSettings().draftType, "newspic");
    assert.equal(wechatDraft.saveWechatSettings({ engine: "api" }).engine, "api");
    assert.equal(wechatDraft.saveWechatSettings({ draftType: "article" }).draftType, "article");
    assert.equal(wechatDraft.saveWechatSettings({ defaultAccount: "secondary" }).engine, "api");
    assert.equal(wechatDraft.getWechatSettings().draftType, "article");
    assert.equal(wechatDraft.saveWechatSettings({ engine: "invalid" }).engine, "web");
  } finally {
    if (previousRuntime == null) delete process.env.TEAMBUILDING_DASHBOARD_RUNTIME;
    else process.env.TEAMBUILDING_DASHBOARD_RUNTIME = previousRuntime;
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});

test("getWechatSettings falls back to the first configured account when default is stale", () => {
  const ctx = setupRuntime();
  try {
    fs.writeFileSync(path.join(ctx.runtime, "wechat-draft-settings.json"), JSON.stringify({
      defaultAccount: "main",
      accounts: {
        2: { name: "江浙沪团建策划", appId: "wx_account_2", appSecretEnv: "WECHAT_MAIN_APP_SECRET" }
      }
    }), "utf8");

    const settings = wechatDraft.getWechatSettings();
    assert.equal(settings.defaultAccount, "2");
  } finally {
    ctx.cleanup();
  }
});

test("recoverInterruptedBatchQueue only requeues work claimed by an older process", () => {
  const ctx = setupRuntime();
  try {
    const batchId = wechatDraft.createBatchQueue([
      { postPath: "D:\\fake\\old", title: "旧进程", body: "正文" },
      { postPath: "D:\\fake\\current", title: "当前进程", body: "正文" }
    ]);
    wechatDraft.updateBatchItem(batchId, 0, {
      status: "processing",
      workerId: "old-process",
      startedAt: "2026-08-10T00:00:00.000Z"
    });
    wechatDraft.markBatchItemProcessing(batchId, 1);

    const recovered = wechatDraft.recoverInterruptedBatchQueue();
    assert.equal(recovered.items[0].status, "pending");
    assert.equal(recovered.items[0].recoveryCount, 1);
    assert.match(recovered.items[0].error, /中断/);
    assert.equal(recovered.items[1].status, "processing");
  } finally {
    ctx.cleanup();
  }
});

test("recoverInterruptedBatchQueue preserves a cancelled queue", () => {
  const ctx = setupRuntime();
  try {
    const batchId = wechatDraft.createBatchQueue([
      { postPath: "D:\\fake\\post", title: "已取消", body: "正文" }
    ]);
    wechatDraft.updateBatchItem(batchId, 0, {
      status: "processing",
      workerId: "old-process",
      startedAt: "2026-08-10T00:00:00.000Z"
    });
    wechatDraft.updateBatchStatus(batchId, "cancelled");

    const recovered = wechatDraft.recoverInterruptedBatchQueue();
    assert.equal(recovered.status, "cancelled");
    assert.equal(recovered.items[0].status, "processing");
  } finally {
    ctx.cleanup();
  }
});

test("resolveImageMediaIds reuses known materials and records newly uploaded ones", async () => {
  const ctx = setupRuntime();
  try {
    wechatDraft.recordMaterialMapping("hash-known", "media-known", "2");
    const uploads = [];
    const mediaIds = await wechatDraft.resolveImageMediaIds({
      accessToken: "token",
      account: "2",
      imagePaths: ["D:\\fake\\known.jpg", "D:\\fake\\new.jpg"],
      imageHashes: ["hash-known", "hash-new"],
      uploadFn: async (_token, imagePath) => {
        uploads.push(imagePath);
        return "media-new";
      }
    });

    assert.deepEqual(mediaIds, ["media-known", "media-new"]);
    assert.deepEqual(uploads, ["D:\\fake\\new.jpg"]);
    assert.equal(wechatDraft.findReusableMediaId("hash-new", "2"), "media-new");
  } finally {
    ctx.cleanup();
  }
});

test("parseTxtContent skips standalone title/body labels", () => {
  const parsed = wechatDraft.parseTxtContent([
    "小红书发布文案",
    "标题：",
    "杭州团建怎么玩｜9条路线一次搞定",
    "正文：",
    "第一段正文",
    "",
    "第二段正文"
  ].join("\n"));

  assert.equal(parsed.title, "杭州团建怎么玩｜9条路线一次搞定");
  assert.equal(parsed.body, "第一段正文\n\n第二段正文");
});

test("parseTxtContent strips inline title prefix", () => {
  const parsed = wechatDraft.parseTxtContent("标题：苏州年会团建攻略\n正文：\n场地与玩法一次看懂");
  assert.equal(parsed.title, "苏州年会团建攻略");
  assert.equal(parsed.body, "场地与玩法一次看懂");
});

test("parseTxtContent reads XHS from the dual-platform TXT and exposes both variants", () => {
  const content = [
    "<<<COPY_FORMAT:2>>>",
    "",
    "<<<XHS_START>>>",
    "杭州团建玩法参考",
    "小红书正文",
    "#杭州团建 #周边游",
    "<<<XHS_END>>>",
    "",
    "<<<DOUYIN_START>>>",
    "杭州周边怎么玩",
    "抖音正文",
    "#杭州 #玩法分享",
    "<<<DOUYIN_END>>>"
  ].join("\n");
  const parsed = wechatDraft.parseTxtContent(content);
  assert.equal(parsed.copyFormatVersion, 2);
  assert.equal(parsed.title, "杭州团建玩法参考");
  assert.equal(parsed.body, "小红书正文\n#杭州团建 #周边游");
  assert.equal(parsed.platformCopies.xhs.title, "杭州团建玩法参考");
  assert.equal(parsed.platformCopies.douyin.title, "杭州周边怎么玩");
});

test("normalizeDraftContent compresses an overlong title and keeps the original", () => {
  const normalized = wechatDraft.normalizeDraftContent(
    "江浙沪周边团建方案整理｜秋冬季8大热门团建地推荐🍂",
    "正文内容"
  );
  assert.equal(normalized.originalTitle, "江浙沪周边团建方案整理｜秋冬季8大热门团建地推荐🍂");
  assert.ok(wechatDraft.countVisibleChars(normalized.title) <= 20);
  assert.equal(normalized.body, "正文内容");
  assert.equal(normalized.titleCompressed, true);
  assert.doesNotMatch(normalized.title, /🍂/u);
});

test("normalizeDraftContent removes platform-forbidden emoji from a short title", () => {
  const normalized = wechatDraft.normalizeDraftContent("安吉团建攻略🌿", "正文内容");
  assert.equal(normalized.originalTitle, "安吉团建攻略🌿");
  assert.equal(normalized.title, "安吉团建攻略");
  assert.equal(normalized.titleCompressed, false);
});

test("successful draft statuses include warning successes for deduplication", () => {
  assert.equal(wechatDraft.isSuccessfulDraftStatus("success"), true);
  assert.equal(wechatDraft.isSuccessfulDraftStatus("success_with_warning"), true);
  assert.equal(wechatDraft.isSuccessfulDraftStatus("failed"), false);
});

test("dry-run records never block a later formal draft", () => {
  const hash = "same-task";
  assert.equal(wechatDraft.isDuplicateDraftRecord({ taskHash: hash, status: "success", dryRun: true }, hash), false);
  assert.equal(wechatDraft.isDuplicateDraftRecord({ taskHash: hash, status: "success", dryRun: false }, hash), true);
  assert.equal(wechatDraft.isDuplicateDraftRecord({ taskHash: hash, status: "success_with_warning", dryRun: false }, hash), true);
});

test("scanCollectionPosts exposes the exact final title used for an overlong post", () => {
  const ctx = setupRuntime();
  try {
    const post = path.join(ctx.runtime, "post");
    fs.mkdirSync(post);
    fs.writeFileSync(path.join(post, "1.jpg"), "image");
    fs.writeFileSync(path.join(post, "文案.txt"), "江浙沪周边团建方案整理｜秋冬季8大热门团建地推荐🍂\n正文内容", "utf8");

    const [scanned] = wechatDraft.scanCollectionPosts(post).posts;
    assert.equal(scanned.originalTitle, "江浙沪周边团建方案整理｜秋冬季8大热门团建地推荐🍂");
    assert.ok(wechatDraft.countVisibleChars(scanned.suggestedTitle) <= 20);
    assert.equal(scanned.titleCompressed, true);
  } finally {
    ctx.cleanup();
  }
});

test("scanCollectionPosts keeps parsed copy metadata for child post folders", () => {
  const ctx = setupRuntime();
  try {
    const collection = path.join(ctx.runtime, "collection");
    const post = path.join(collection, "post-01");
    fs.mkdirSync(post, { recursive: true });
    fs.writeFileSync(path.join(post, "1.jpg"), "image");
    fs.writeFileSync(path.join(post, "文案.txt"), "标题：办公室团建小游戏\n正文：\n先做一个热身游戏。", "utf8");

    const [scanned] = wechatDraft.scanCollectionPosts(collection).posts;
    assert.equal(scanned.title, "办公室团建小游戏");
    assert.equal(scanned.body, "先做一个热身游戏。");
    assert.equal(scanned.copyFormatVersion, 1);
    assert.equal(scanned.platformCopies, null);
  } finally {
    ctx.cleanup();
  }
});

test("writeJsonAtomic replaces state without leaving a partial temp file", () => {
  const ctx = setupRuntime();
  try {
    const target = path.join(ctx.runtime, "state.json");
    fs.writeFileSync(target, JSON.stringify({ version: 1 }), "utf8");
    wechatDraft.writeJsonAtomic(target, { version: 2, items: ["safe"] });
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { version: 2, items: ["safe"] });
    assert.deepEqual(fs.readdirSync(ctx.runtime).filter((name) => name.includes(".tmp-")), []);
  } finally {
    ctx.cleanup();
  }
});

test("WeChat API requests have a bounded timeout with an explicit error", () => {
  let timeoutMs = 0;
  let timeoutHandler = null;
  let destroyedWith = null;
  const request = {
    setTimeout(ms, handler) { timeoutMs = ms; timeoutHandler = handler; },
    destroy(error) { destroyedWith = error; }
  };

  wechatDraft.applyWechatRequestTimeout(request, 1234);
  timeoutHandler();
  assert.equal(timeoutMs, 1234);
  assert.match(destroyedWith.message, /超时/);
});

test("native web completion records a formal draft and becomes idempotently deduplicated", async () => {
  const ctx = setupRuntime();
  try {
    const post = path.join(ctx.runtime, "web-post");
    fs.mkdirSync(post);
    fs.writeFileSync(path.join(post, "1.jpg"), "image-one");
    fs.writeFileSync(path.join(post, "文案.txt"), "网页草稿标题\n网页草稿正文", "utf8");
    const input = { postPath: post, title: "网页草稿标题", body: "网页草稿正文", account: "web-main" };

    const prepared = await wechatDraft.prepareWebDraftTask(input);
    assert.equal(prepared.success, true);
    assert.equal(prepared.duplicate, false);
    assert.equal(prepared.draftType, "newspic");
    assert.equal(prepared.imageCount, 1);

    const completed = await wechatDraft.recordWebDraftSuccess(input);
    assert.equal(completed.success, true);
    assert.equal(completed.dryRun, false);
    assert.equal(completed.engine, "web");
    assert.equal(completed.draftType, "newspic");

    const duplicate = await wechatDraft.prepareWebDraftTask(input);
    assert.equal(duplicate.duplicate, true);
    const repeatedCompletion = await wechatDraft.recordWebDraftSuccess(input);
    assert.equal(repeatedCompletion.success, true);
    assert.equal(repeatedCompletion.alreadyRecorded, true);
    assert.equal(wechatDraft.getDraftHistory(10).filter((record) => record.engine === "web").length, 1);

    const article = await wechatDraft.prepareWebDraftTask({ ...input, draftType: "article" });
    assert.equal(article.duplicate, false);
    assert.notEqual(article.taskHash, prepared.taskHash);
  } finally {
    ctx.cleanup();
  }
});
