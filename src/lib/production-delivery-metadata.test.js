const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  updateOnlineSourceArchiveMetadata,
  writeOnlineDeliveryMetadata
} = require("./production-delivery-metadata");

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("online package records source, destination, template, hashes and honest QA state", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "online-delivery-metadata-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imagePath = path.join(root, "作品_D01.png");
  const copyPath = path.join(root, "文案.txt");
  const imageBytes = Buffer.from("image-bytes");
  const copyBytes = Buffer.from([
    "<<<COPY_FORMAT:MULTI>>>",
    "<<<VERSION_START:红书自然>>>", "这是一段测试正文。", "<<<VERSION_END>>>",
    "<<<VERSION_START:抖音攻略>>>", "这是另一段测试正文。", "<<<VERSION_END>>>"
  ].join("\n"), "utf8");
  fs.writeFileSync(imagePath, imageBytes);
  fs.writeFileSync(copyPath, copyBytes);
  fs.writeFileSync(path.join(root, "GPT作品记录.json"), JSON.stringify({
    batchId: "20261012-120000-ab12",
    status: "completed",
    completedAt: "2026-10-12T04:00:00.000Z",
    copyTitle: "测试作品",
    textSha256: sha(copyBytes),
    actualImages: 1
  }));

  const result = writeOnlineDeliveryMetadata({
    packagePath: root,
    request: {
      batchId: "20261012-120000-ab12",
      sourceMaterialPath: "D:/素材/测试素材",
      title: "测试作品",
      templateId: "T43",
      templateName: "固定模板",
      templateUrl: "https://chatgpt.com/c/template-conversation",
      templatePath: "D:/模板/T43",
      templateP1Path: "D:/模板/T43/P1.png",
      templateP2Path: "D:/模板/T43/P2.png",
      templateSelectionMode: "fixed",
      productionMode: "在线模式",
      conversationUrl: "https://chatgpt.com/c/test"
    },
    imageValidation: { valid: true, actualImageCount: 1, expectedImageCount: 1 }
  });

  assert.equal(result.metadataStatus, "WRITTEN_AND_READ_BACK");
  const sidecar = JSON.parse(fs.readFileSync(path.join(root, "metadata.json"), "utf8"));
  const meta = sidecar.deliveryMetadata;
  assert.equal(meta.source.originalFolderPath, "D:/素材/测试素材");
  assert.equal(meta.product.formalPath, root);
  assert.equal(meta.template.templates[0].id, "T43");
  assert.equal(meta.template.templates[0].p1Path, "D:/模板/T43/P1.png");
  assert.equal(meta.template.templates[0].url, "https://chatgpt.com/c/template-conversation");
  assert.equal(meta.outputs.images[0].sha256, sha(imageBytes));
  assert.equal(meta.outputs.images[0].role, "UNMAPPED");
  assert.equal(meta.source.pageMappingStatus, "UNVERIFIED");
  assert.equal(meta.outputs.copy.sha256MatchesPackageRecord, true);
  assert.equal(meta.outputs.copy.versionCount, 2);
  assert.equal(meta.quality.imageQaStatus, "UNVERIFIED");
  assert.equal(meta.quality.overallStatus, "NOT_FORMALLY_ACCEPTED");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "GPT作品记录.json"), "utf8")).deliveryMetadata, meta);
});

test("online page labels and source mappings are recorded only from explicit evidence", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "online-page-mapping-metadata-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imageBytes = Buffer.from("cover-image");
  const copyBytes = Buffer.from("copy", "utf8");
  const sourceRoot = path.join(root, "sources");
  fs.mkdirSync(sourceRoot);
  const sourcePath = path.join(sourceRoot, "source-P1.png");
  const outputPath = path.join(root, "result_P1.png");
  fs.writeFileSync(sourcePath, imageBytes);
  fs.writeFileSync(outputPath, imageBytes);
  fs.writeFileSync(path.join(root, "文案.txt"), copyBytes);
  fs.writeFileSync(path.join(root, "GPT作品记录.json"), JSON.stringify({
    batchId: "batch-page-map",
    textSha256: sha(copyBytes),
    pageMappings: [{ page: "P1", outputFileName: "result_P1.png", sourcePath, sourceSha256: sha(imageBytes) }]
  }));

  writeOnlineDeliveryMetadata({
    packagePath: root,
    request: { batchId: "batch-page-map", templateP1Path: "D:/模板/T43/P1.png" },
    imageValidation: { valid: true }
  });
  const meta = JSON.parse(fs.readFileSync(path.join(root, "metadata.json"), "utf8")).deliveryMetadata;
  assert.equal(meta.outputs.images[0].page, "P1");
  assert.equal(meta.outputs.images[0].role, "cover");
  assert.equal(meta.outputs.images[0].templatePagePath, "D:/模板/T43/P1.png");
  assert.equal(meta.outputs.images[0].sourcePath, sourcePath);
  assert.equal(meta.source.pageMappingStatus, "RECORDED");
  assert.equal(meta.outputs.images[0].qaStatus, "UNVERIFIED");
});

test("online source archive updates keep the original and current paths distinct", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "online-source-archive-metadata-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const copy = Buffer.from("title and copy", "utf8");
  fs.writeFileSync(path.join(root, "page.jpg"), Buffer.from("image"));
  fs.writeFileSync(path.join(root, "copy.txt"), copy);
  fs.writeFileSync(path.join(root, "GPT作品记录.json"), JSON.stringify({
    batchId: "batch-1", status: "completed", textSha256: sha(copy), actualImages: 1
  }));
  writeOnlineDeliveryMetadata({ packagePath: root, request: { batchId: "batch-1", sourceMaterialPath: "D:/source/original" }, imageValidation: { valid: true } });

  const archived = updateOnlineSourceArchiveMetadata({
    packagePath: root,
    originalPath: "D:/source/original",
    archivedPath: "D:/source/已使用素材/原始素材",
    archivedAt: "2026-10-12T05:00:00.000Z"
  });
  assert.equal(archived.updated, true);
  const meta = JSON.parse(fs.readFileSync(path.join(root, "metadata.json"), "utf8")).deliveryMetadata;
  assert.equal(meta.source.originalFolderPath, "D:/source/original");
  assert.equal(meta.source.currentFolderPath, "D:/source/已使用素材/原始素材");
  assert.equal(meta.source.archiveStatus, "ARCHIVED");
});
