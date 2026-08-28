"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  getDistributionSnapshot,
  moveCollectionSourceToStage,
  renameCollectionType,
  reconcileWorkflowFolders,
  markOfficialUsed
} = require("./distribution-data");

// ── Fixture helpers ──────────────────────────────────────────────

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "junction-removal-"));
  const publishRoot = path.join(root, "发布空间");
  const libraryRoot = path.join(root, "素材库");
  // Platform dirs (发布空间)
  ["小红书", "抖音", "公众号", "已使用", path.join("归档", "抖音")].forEach((name) => {
    fs.mkdirSync(path.join(publishRoot, name), { recursive: true });
  });
  // Workflow stage dirs (素材库)
  ["抖音小红书", "微信公众号", "已发送"].forEach((name) => {
    fs.mkdirSync(path.join(libraryRoot, name), { recursive: true });
  });
  return { root, publishRoot, libraryRoot };
}

function createCollection(libraryRoot, stage, name, imageCount = 3) {
  const stageDirs = { mobile: "抖音小红书", official: "微信公众号", used: "已发送" };
  const source = path.join(libraryRoot, stageDirs[stage], name);
  fs.mkdirSync(source, { recursive: true });
  for (let i = 1; i <= imageCount; i++) {
    const itemDir = path.join(source, String(i).padStart(2, "0"));
    fs.mkdirSync(itemDir);
    // Create a minimal fake jpg (1x1 pixel)
    fs.writeFileSync(path.join(itemDir, "1.jpg"), Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
      0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
      0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
      0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
      0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
      0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
      0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
      0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
      0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
      0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
      0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
      0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
      0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
      0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
      0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
      0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
      0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
      0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
      0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
      0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
      0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
      0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
      0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd2, 0x8a, 0x28, 0xa0, 0xff, 0xd9
    ]));
    fs.writeFileSync(path.join(itemDir, "文案.txt"), `帖子 ${i} 文案`);
  }
  return source;
}

function listJunctions(dir) {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

// ── Tests ────────────────────────────────────────────────────────

test("T1: moveCollectionSourceToStage to official does not create junctions", () => {
  const fixture = makeFixture();
  try {
    createCollection(fixture.libraryRoot, "mobile", "作品集_001[泛]");

    const result = moveCollectionSourceToStage({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot,
      collection: "作品集_001[泛]",
      stage: "official"
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "official");

    // Real folder moved to official stage
    const officialPath = path.join(fixture.libraryRoot, "微信公众号", "作品集_001[泛]");
    assert.ok(fs.existsSync(officialPath), "folder should be in official stage");

    // No longer in mobile stage
    const mobilePath = path.join(fixture.libraryRoot, "抖音小红书", "作品集_001[泛]");
    assert.ok(!fs.existsSync(mobilePath), "folder should have left mobile stage");

    // No junctions created in any platform dir
    ["小红书", "抖音", "公众号", "已使用"].forEach((platform) => {
      const junctions = listJunctions(path.join(fixture.publishRoot, platform));
      assert.deepEqual(junctions, [], `no junctions should exist in ${platform}`);
    });
  } finally {
    cleanup(fixture.root);
  }
});

test("T2: moveCollectionSourceToStage to used does not create junctions", () => {
  const fixture = makeFixture();
  try {
    createCollection(fixture.libraryRoot, "official", "作品集_002[转]");

    // The core assertion: no junctions should be created regardless of
    // whether archiving succeeds or fails. We wrap in try/catch because
    // archiveAndRemoveCollection depends on tar.exe which may behave
    // differently across environments.
    try {
      moveCollectionSourceToStage({
        publishRoot: fixture.publishRoot,
        libraryRoot: fixture.libraryRoot,
        collection: "作品集_002[转]",
        stage: "used"
      });
    } catch (error) {
      // If archiving fails, the error message should be about archiving,
      // NOT about junction/link creation
      assert.ok(
        /压缩归档失败|同名压缩包|tar/i.test(String(error.message)),
        `error should be about archiving, not junctions: ${error.message}`
      );
    }

    // No junctions in any platform dir — this is the key assertion
    ["小红书", "抖音", "公众号", "已使用"].forEach((platform) => {
      const junctions = listJunctions(path.join(fixture.publishRoot, platform));
      assert.deepEqual(junctions, [], `no junctions should exist in ${platform}`);
    });
  } finally {
    cleanup(fixture.root);
  }
});

test("T3: renameCollectionType does not create junctions", () => {
  const fixture = makeFixture();
  try {
    createCollection(fixture.libraryRoot, "mobile", "作品集_003[泛]");

    const result = renameCollectionType({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot,
      collection: "作品集_003[泛]",
      type: "conversion"
    });

    assert.equal(result.ok, true);
    assert.equal(result.targetName, "作品集_003[转]");

    // Folder renamed in mobile stage
    const newPath = path.join(fixture.libraryRoot, "抖音小红书", "作品集_003[转]");
    assert.ok(fs.existsSync(newPath), "folder should be renamed");

    // Old name gone
    const oldPath = path.join(fixture.libraryRoot, "抖音小红书", "作品集_003[泛]");
    assert.ok(!fs.existsSync(oldPath), "old folder name should not exist");

    // No junctions in any platform dir
    ["小红书", "抖音", "公众号", "已使用"].forEach((platform) => {
      const junctions = listJunctions(path.join(fixture.publishRoot, platform));
      assert.deepEqual(junctions, [], `no junctions should exist in ${platform}`);
    });
  } finally {
    cleanup(fixture.root);
  }
});

test("T4: reconcileWorkflowFolders moves scattered folders without creating junctions", () => {
  const fixture = makeFixture();
  try {
    // Create a scattered collection at workflow root level
    const scatteredPath = path.join(fixture.libraryRoot, "作品集_004[泛]");
    fs.mkdirSync(scatteredPath, { recursive: true });
    const itemDir = path.join(scatteredPath, "01");
    fs.mkdirSync(itemDir);
    fs.writeFileSync(path.join(itemDir, "1.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const result = reconcileWorkflowFolders({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot,
      apply: true
    });

    assert.equal(result.applied, true);

    // Folder should have been moved to a stage (mobile since no official/device records)
    const mobilePath = path.join(fixture.libraryRoot, "抖音小红书", "作品集_004[泛]");
    assert.ok(fs.existsSync(mobilePath), "scattered folder should be moved to mobile stage");

    // No longer at workflow root
    assert.ok(!fs.existsSync(scatteredPath), "scattered folder should be gone from root");

    // No junctions in any platform dir
    ["小红书", "抖音", "公众号", "已使用"].forEach((platform) => {
      const junctions = listJunctions(path.join(fixture.publishRoot, platform));
      assert.deepEqual(junctions, [], `no junctions should exist in ${platform}`);
    });
  } finally {
    cleanup(fixture.root);
  }
});

test("T5: getDistributionSnapshot still reads legacy junctions correctly", () => {
  const fixture = makeFixture();
  try {
    const sourcePath = createCollection(fixture.libraryRoot, "mobile", "作品集_005[泛]");

    // Create a legacy junction in 小红书 pointing to the mobile source
    const linkPath = path.join(fixture.publishRoot, "小红书", "作品集_005[泛]");
    try {
      fs.symlinkSync(sourcePath, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch {
      // Some environments don't support junctions; skip this test
      return;
    }

    const snapshot = getDistributionSnapshot({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot
    });

    const item = snapshot.collections.find((c) => c.name === "作品集_005[泛]");
    assert.ok(item, "collection should be in snapshot");
    assert.equal(item.workflowStage, "mobile");
    // The legacy junction should be detected (xhs available or at least present)
    assert.ok(item.sourceValid, "source should be valid");
  } finally {
    cleanup(fixture.root);
  }
});

test("T6: getDistributionSnapshot works without any junctions", () => {
  const fixture = makeFixture();
  try {
    createCollection(fixture.libraryRoot, "mobile", "作品集_006[泛]");
    createCollection(fixture.libraryRoot, "mobile", "作品集_007[转]");

    const snapshot = getDistributionSnapshot({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot
    });

    assert.ok(snapshot.collections.length >= 2, "should find collections");

    const item6 = snapshot.collections.find((c) => c.name === "作品集_006[泛]");
    assert.ok(item6, "作品集_006 should be in snapshot");
    assert.equal(item6.workflowStage, "mobile");
    assert.equal(item6.type, "traffic");
    assert.ok(item6.sourceValid, "source should be valid");

    const item7 = snapshot.collections.find((c) => c.name === "作品集_007[转]");
    assert.ok(item7, "作品集_007 should be in snapshot");
    assert.equal(item7.workflowStage, "mobile");
    assert.equal(item7.type, "conversion");
  } finally {
    cleanup(fixture.root);
  }
});

test("T7: markOfficialUsed does not create junctions", () => {
  const fixture = makeFixture();
  try {
    createCollection(fixture.libraryRoot, "official", "作品集_008[转]");

    // Create official-account-usage-log.csv with a pending upload record
    const logFile = path.join(fixture.publishRoot, "official-account-usage-log.csv");
    const sourcePath = path.join(fixture.libraryRoot, "微信公众号", "作品集_008[转]");
    const header = "时间,公众号账号,承载设备,作品集,源路径,文件数,字节数,小红书抖音连接剩余数,状态,操作";
    fs.writeFileSync(logFile, `${header}\n`, "utf8");
    const row = [
      new Date().toISOString().slice(0, 19),
      "测试账号",
      "1号",
      "作品集_008[转]",
      sourcePath,
      "3",
      "100",
      "0",
      "已领取待电脑上传",
      "测试预留"
    ].join(",");
    fs.appendFileSync(logFile, `${row}\n`, "utf8");

    // markOfficialUsed internally calls moveCollectionSourceToStage({ stage: "used" })
    // which depends on tar.exe. The core assertion is: no junctions created.
    try {
      markOfficialUsed({
        publishRoot: fixture.publishRoot,
        libraryRoot: fixture.libraryRoot,
        collection: "作品集_008[转]"
      });
    } catch (error) {
      // If archiving fails, the error should be about archiving, not junctions
      assert.ok(
        /压缩归档失败|同名压缩包|tar|没有找到|不在/i.test(String(error.message)),
        `error should be about archiving, not junctions: ${error.message}`
      );
    }

    // No junctions in any platform dir — this is the key assertion
    ["小红书", "抖音", "公众号", "已使用"].forEach((platform) => {
      const junctions = listJunctions(path.join(fixture.publishRoot, platform));
      assert.deepEqual(junctions, [], `no junctions should exist in ${platform}`);
    });
  } finally {
    cleanup(fixture.root);
  }
});
