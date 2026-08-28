const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  inspectWorks,
  readWorkDistributionLedger,
  acquireWorkDistributionClaims,
  hasWorkDistributionClaim,
  readWorkDistributionClaimNames,
  pruneStaleWorkDistributionClaims,
  releaseWorkDistributionClaims,
  touchWorkDistributionClaims,
  recordSuccessfulWorkDistribution,
  rebaseSuccessfulWorkDistributionPaths,
  workDistributionEligibility
} = require("./work-distribution-ledger");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-work-ledger-"));
  const collection = path.join(root, "作品集001[转]");
  const first = path.join(collection, "作品A");
  const second = path.join(collection, "作品B");
  fs.mkdirSync(first, { recursive: true });
  fs.mkdirSync(second, { recursive: true });
  fs.writeFileSync(path.join(first, "01.png"), "a");
  fs.writeFileSync(path.join(first, "文案.txt"), "标题\n正文");
  fs.writeFileSync(path.join(first, "GPT作品记录.json"), JSON.stringify({ id: "work-a" }));
  fs.writeFileSync(path.join(second, "01.jpg"), "b");
  fs.writeFileSync(path.join(second, "文案.txt"), "标题2\n正文2");
  return { root, collection, first, second, ledgerFile: path.join(root, "work-distribution-ledger.json") };
}

test("作品集只是容器，扫描结果按包含图片和 TXT 的作品文件夹展开", () => {
  const data = fixture();
  try {
    const works = inspectWorks(data.collection);
    assert.equal(works.length, 2);
    assert.equal(works[0].workId, "work-a");
    assert.equal(works[0].imageCount, 1);
    assert.equal(works[0].textComplete, true);
    assert.match(works[1].workId, /^[a-f0-9]{32}$/);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test("一个 workId 首次成功后自动和手动都永久禁止重发", () => {
  const data = fixture();
  try {
    const work = inspectWorks(data.collection)[0];
    recordSuccessfulWorkDistribution(data.ledgerFile, {
      work, collection: "作品集001[转]", deviceId: "phone-a", device: "手机A", taskId: "task-1"
    });
    const eligibility = workDistributionEligibility(readWorkDistributionLedger(data.ledgerFile), work.workId);
    assert.equal(eligibility.automaticEligible, false);
    assert.equal(eligibility.manualResendRequiresConfirmation, true);
    assert.equal(eligibility.duplicateBlocked, true);
    assert.equal(eligibility.firstDistribution.deviceId, "phone-a");
    assert.throws(
      () => recordSuccessfulWorkDistribution(data.ledgerFile, {
        work, collection: "作品集001[转]", deviceId: "phone-b", device: "手机B", taskId: "task-2"
      }),
      (error) => error.code === "DUPLICATE_DISTRIBUTION_BLOCKED"
    );
    const ledger = readWorkDistributionLedger(data.ledgerFile);
    assert.equal(ledger.successes[work.workId].firstDeviceId, "phone-a");
    assert.equal(ledger.successes[work.workId].successfulAttempts.length, 1);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test("发送占用在并发入口间原子互斥，失败释放后才允许再次尝试", () => {
  const data = fixture();
  const claimRoot = path.join(data.root, "claims");
  try {
    const work = inspectWorks(data.collection)[0];
    const first = acquireWorkDistributionClaims(claimRoot, [work], {
      ledgerFile: data.ledgerFile,
      collection: "作品集001[转]",
      deviceId: "phone-a",
      taskId: "task-1"
    });
    assert.equal(first.workIds.length, 1);
    assert.equal(hasWorkDistributionClaim(claimRoot, work.workId), true);
    assert.equal(readWorkDistributionClaimNames(claimRoot).size, 1);
    assert.throws(
      () => acquireWorkDistributionClaims(claimRoot, [work], {
        ledgerFile: data.ledgerFile,
        collection: "作品集001[转]",
        deviceId: "phone-b",
        taskId: "task-2"
      }),
      (error) => error.code === "DUPLICATE_DISTRIBUTION_IN_FLIGHT"
    );
    assert.equal(releaseWorkDistributionClaims(claimRoot, first.workIds, { taskId: "task-1" }).released, 1);
    assert.equal(hasWorkDistributionClaim(claimRoot, work.workId), false);
    assert.equal(readWorkDistributionClaimNames(claimRoot).size, 0);
    const retry = acquireWorkDistributionClaims(claimRoot, [work], {
      ledgerFile: data.ledgerFile,
      collection: "作品集001[转]",
      deviceId: "phone-b",
      taskId: "task-3"
    });
    assert.equal(retry.workIds[0], work.workId);
    releaseWorkDistributionClaims(claimRoot, retry.workIds, { taskId: "task-3" });
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test("过期发送占用不应永久阻塞自动补发，并保留可追溯归档", () => {
  const data = fixture();
  const claimRoot = path.join(data.root, "claims");
  try {
    const work = inspectWorks(data.collection)[0];
    const old = acquireWorkDistributionClaims(claimRoot, [work], {
      ledgerFile: data.ledgerFile,
      collection: "作品集001[转]",
      deviceId: "phone-old",
      taskId: "task-old",
      now: "2026-08-18T00:00:00.000Z"
    });
    assert.equal(old.workIds.length, 1);
    assert.equal(
      readWorkDistributionClaimNames(claimRoot, {
        now: "2026-08-18T00:00:30.000Z",
        claimTtlMs: 60 * 60 * 1000
      }).size,
      1
    );

    const claimPath = old.paths[0];
    const claim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    claim.createdAt = "2026-08-17T00:00:00.000Z";
    claim.heartbeatAt = "2026-08-17T00:00:00.000Z";
    fs.writeFileSync(claimPath, JSON.stringify(claim, null, 2));
    assert.equal(
      readWorkDistributionClaimNames(claimRoot, {
        now: "2026-08-18T00:00:00.000Z",
        claimTtlMs: 60 * 60 * 1000
      }).size,
      0
    );

    const replacement = acquireWorkDistributionClaims(claimRoot, [work], {
      ledgerFile: data.ledgerFile,
      collection: "作品集001[转]",
      deviceId: "phone-new",
      taskId: "task-new",
      now: "2026-08-18T00:00:00.000Z",
      claimTtlMs: 60 * 60 * 1000,
      allowStaleClaimRecovery: true
    });
    assert.equal(replacement.workIds[0], work.workId);
    assert.equal(fs.readdirSync(path.join(claimRoot, "stale")).length, 1);
    touchWorkDistributionClaims(claimRoot, replacement.workIds, {
      taskId: "task-new",
      now: "2026-08-18T00:10:00.000Z"
    });
    const refreshed = JSON.parse(fs.readFileSync(replacement.paths[0], "utf8"));
    assert.equal(refreshed.heartbeatAt, "2026-08-18T00:10:00.000Z");
    releaseWorkDistributionClaims(claimRoot, replacement.workIds, { taskId: "task-new" });
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test("任务已从当前进程消失时，孤儿占用在短宽限期后回收；真实任务继续保护", () => {
  const data = fixture();
  const claimRoot = path.join(data.root, "claims");
  try {
    const work = inspectWorks(data.collection)[0];
    const old = acquireWorkDistributionClaims(claimRoot, [work], {
      ledgerFile: data.ledgerFile,
      collection: "作品集001[转]",
      deviceId: "phone-old",
      taskId: "task-old",
      now: "2026-08-18T00:00:00.000Z"
    });
    const orphanOptions = {
      now: "2026-08-18T00:31:00.000Z",
      claimTtlMs: 6 * 60 * 60 * 1000,
      orphanClaimGraceMs: 30 * 60 * 1000,
      isTaskActive: () => false
    };
    const pruned = pruneStaleWorkDistributionClaims(claimRoot, orphanOptions);
    assert.equal(pruned.archived, 1);
    assert.equal(readWorkDistributionClaimNames(claimRoot, orphanOptions).size, 0);
    assert.equal(fs.readdirSync(path.join(claimRoot, "stale")).length, 1);

    const active = acquireWorkDistributionClaims(claimRoot, [work], {
      ledgerFile: data.ledgerFile,
      collection: "作品集001[转]",
      deviceId: "phone-live",
      taskId: "task-live",
      now: "2026-08-18T00:00:00.000Z"
    });
    const activeOptions = {
      ...orphanOptions,
      isTaskActive: (taskId) => taskId === "task-live"
    };
    const kept = pruneStaleWorkDistributionClaims(claimRoot, activeOptions);
    assert.equal(kept.archived, 0);
    assert.equal(readWorkDistributionClaimNames(claimRoot, activeOptions).size, 1);
    releaseWorkDistributionClaims(claimRoot, active.workIds, { taskId: "task-live" });
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test("失败和取消不会写入成功账本", () => {
  const data = fixture();
  try {
    const work = inspectWorks(data.collection)[0];
    const eligibility = workDistributionEligibility(readWorkDistributionLedger(data.ledgerFile), work.workId);
    assert.equal(eligibility.automaticEligible, true);
    assert.equal(fs.existsSync(data.ledgerFile), false);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test("成功移动作品集后重定位账本路径并保留旧路径", () => {
  const data = fixture();
  const mobileRoot = path.join(data.root, "抖音小红书", "作品集001[转]");
  const officialRoot = path.join(data.root, "微信公众号", "作品集001[转]");
  try {
    const work = inspectWorks(data.collection)[0];
    const originalPath = path.join(mobileRoot, path.basename(work.path));
    recordSuccessfulWorkDistribution(data.ledgerFile, {
      work: { ...work, path: originalPath },
      collection: "作品集001[转]",
      deviceId: "phone-a",
      device: "手机A",
      taskId: "task-move"
    });
    const result = rebaseSuccessfulWorkDistributionPaths(data.ledgerFile, {
      collection: "作品集001[转]",
      fromRoot: mobileRoot,
      toRoot: officialRoot,
      updatedAt: "2026-08-13T09:36:08.000Z"
    });
    assert.equal(result.updatedCount, 1);
    const saved = readWorkDistributionLedger(data.ledgerFile).successes[work.workId];
    assert.equal(saved.path, path.join(officialRoot, path.basename(work.path)));
    assert.deepEqual(saved.pathHistory, [originalPath]);
    assert.equal(saved.lastPathUpdateReason, "managed_collection_stage_move");
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});
