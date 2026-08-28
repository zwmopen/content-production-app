const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { getDistributionSnapshot, recordDeviceDistribution } = require("./distribution-data");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "distribution-scan-validity-"));
  const libraryRoot = path.join(root, "作品集");
  const publishRoot = path.join(root, "发布空间");
  ["小红书", "抖音", "公众号", "已使用", path.join("归档", "抖音")].forEach((name) => {
    fs.mkdirSync(path.join(publishRoot, name), { recursive: true });
  });
  ["抖音小红书", "微信公众号", "已发送"].forEach((name) => {
    fs.mkdirSync(path.join(libraryRoot, name), { recursive: true });
  });
  return { root, libraryRoot, publishRoot };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function collection(snapshot, name) {
  return snapshot.collections.find((item) => item.name === name);
}

test("empty portfolio folders are not treated as distributable collections", () => {
  const fixture = makeFixture();
  try {
    const mobileRoot = path.join(fixture.libraryRoot, "抖音小红书");
    fs.mkdirSync(path.join(mobileRoot, "作品集_080[转]"), { recursive: true });
    fs.mkdirSync(path.join(mobileRoot, "作品集_081[转]", "空作品A"), { recursive: true });
    fs.mkdirSync(path.join(mobileRoot, "作品集_082[转]", "只有文案"), { recursive: true });
    fs.writeFileSync(path.join(mobileRoot, "作品集_082[转]", "只有文案", "小红书文案.txt"), "只有文字，没有图片", "utf8");
    fs.mkdirSync(path.join(mobileRoot, "作品集_083[转]", "完整作品A"), { recursive: true });
    fs.writeFileSync(path.join(mobileRoot, "作品集_083[转]", "完整作品A", "P1.jpg"), "image bytes");

    const snapshot = getDistributionSnapshot({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot
    });

    assert.equal(collection(snapshot, "作品集_080[转]").sourceValid, false);
    assert.equal(collection(snapshot, "作品集_081[转]").sourceValid, false);
    assert.equal(collection(snapshot, "作品集_082[转]").sourceValid, false);
    assert.equal(collection(snapshot, "作品集_083[转]").sourceValid, true);
    assert.equal(collection(snapshot, "作品集_080[转]").automaticEligible, false);
    assert.equal(collection(snapshot, "作品集_081[转]").automaticEligible, false);
    assert.equal(collection(snapshot, "作品集_082[转]").automaticEligible, false);
    assert.equal(collection(snapshot, "作品集_083[转]").automaticEligible, true);
    assert.deepEqual(
      snapshot.collections.filter((item) => item.automaticEligible).map((item) => item.name),
      ["作品集_083[转]"]
    );
    assert.equal(snapshot.summary.conversion, 1);
  } finally {
    cleanup(fixture.root);
  }
});

test("portfolio validity is computed from all child folders, not only previewed items", () => {
  const fixture = makeFixture();
  try {
    const source = path.join(fixture.libraryRoot, "抖音小红书", "作品集_084[泛]");
    for (let index = 0; index < 50; index += 1) {
      fs.mkdirSync(path.join(source, `${String(index).padStart(2, "0")}-empty`), { recursive: true });
    }
    fs.mkdirSync(path.join(source, "zz-valid-work"), { recursive: true });
    fs.writeFileSync(path.join(source, "zz-valid-work", "P1.png"), "image bytes");

    const snapshot = getDistributionSnapshot({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot
    });
    const item = collection(snapshot, "作品集_084[泛]");

    assert.equal(item.sourceValid, true);
    assert.equal(item.itemCount, 1);
    assert.equal(item.automaticEligible, true);
  } finally {
    cleanup(fixture.root);
  }
});

test("workflow metadata folders are never exposed as portfolio collections", () => {
  const fixture = makeFixture();
  try {
    const mobileRoot = path.join(fixture.libraryRoot, "抖音小红书");
    fs.mkdirSync(path.join(mobileRoot, "_portfolio_move_logs"), { recursive: true });
    fs.mkdirSync(path.join(mobileRoot, "_portfolio_move_logs[转]"), { recursive: true });
    fs.mkdirSync(path.join(mobileRoot, "作品集_085[转]", "完整作品A"), { recursive: true });
    fs.writeFileSync(path.join(mobileRoot, "作品集_085[转]", "完整作品A", "P1.jpg"), "image bytes");

    const snapshot = getDistributionSnapshot({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot
    });

    assert.deepEqual(snapshot.collections.map((item) => item.name), ["作品集_085[转]"]);
  } finally {
    cleanup(fixture.root);
  }
});

test("a valid legacy root collection remains manually sendable but is not auto-distributed", () => {
  const fixture = makeFixture();
  try {
    const source = path.join(fixture.libraryRoot, "作品集_055[转]");
    fs.mkdirSync(path.join(source, "完整作品A"), { recursive: true });
    fs.writeFileSync(path.join(source, "完整作品A", "P1.png"), "image bytes");

    const snapshot = getDistributionSnapshot({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot
    });
    const item = collection(snapshot, "作品集_055[转]");

    assert.equal(item.sourceValid, true);
    assert.equal(item.workflowStage, "mobile");
    assert.equal(item.manualEligible, true);
    assert.equal(item.automaticEligible, false);
  } finally {
    cleanup(fixture.root);
  }
});

test("configured external send roots expose tagged collections without moving the source", () => {
  const fixture = makeFixture();
  const sendRoot = path.join(fixture.root, "default-send");
  try {
    const source = path.join(sendRoot, "作品集_090[转]", "作品A");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "P1.png"), "image bytes");

    const snapshot = getDistributionSnapshot({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot,
      additionalRoots: [sendRoot]
    });
    const item = collection(snapshot, "作品集_090[转]");

    assert.equal(item.sourcePath, path.join(sendRoot, "作品集_090[转]"));
    assert.equal(item.sourceValid, true);
    assert.equal(item.type, "conversion");
    assert.equal(item.dualPlatformEligible, true);
    assert.equal(item.automaticEligible, true);
    assert.equal(fs.existsSync(source), true);
  } finally {
    cleanup(fixture.root);
  }
});

test("tagged external collections do not need the legacy 作品集 number prefix", () => {
  const fixture = makeFixture();
  const sendRoot = path.join(fixture.root, "generic-send");
  try {
    const source = path.join(sendRoot, "安吉周末团建[泛]", "作品A");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "P1.png"), "image bytes");

    const snapshot = getDistributionSnapshot({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot,
      additionalRoots: [{ root: sendRoot, category: "traffic" }]
    });
    const item = collection(snapshot, "安吉周末团建[泛]");

    assert.equal(item?.type, "traffic");
    assert.equal(item?.automaticEligible, true);
  } finally {
    cleanup(fixture.root);
  }
});

test("a receiver-confirmed delivery is recorded once and blocks an accidental resend", () => {
  const fixture = makeFixture();
  try {
    const source = path.join(fixture.libraryRoot, "抖音小红书", "作品集_056[转]");
    fs.mkdirSync(path.join(source, "完整作品A"), { recursive: true });
    fs.writeFileSync(path.join(source, "完整作品A", "P1.png"), "image bytes");
    const payload = {
      publishRoot: fixture.publishRoot,
      taskId: "distribution-test-056",
      device: "测试手机",
      collection: "作品集_056[转]",
      sourcePath: source,
      fileCount: 1,
      bytes: 11
    };

    assert.equal(recordDeviceDistribution(payload).duplicate, false);
    assert.equal(recordDeviceDistribution(payload).duplicate, true);
    const snapshot = getDistributionSnapshot({
      publishRoot: fixture.publishRoot,
      libraryRoot: fixture.libraryRoot
    });
    const item = collection(snapshot, "作品集_056[转]");

    assert.equal(item.deviceHistoryCount, 1);
    assert.equal(item.manualEligible, false);
    assert.equal(item.automaticEligible, false);
  } finally {
    cleanup(fixture.root);
  }
});
