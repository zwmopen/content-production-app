"use strict";

// One-time, idempotent repair for the real 2026-08-10 partial-image incident.
// The five downloaded images are preserved under _待复核, while the source
// material and its usage ledgers are rolled back from layer 2 to layer 1.

const fs = require("fs");
const path = require("path");

const requestId = "gpt-1786316406983-nhogzc";
const materialName = "3_夏季玩水金华9大刺激漂流🌊大合集❓什么叫激流勇进🌊❓什么叫「随波逐流」🛶❓什么叫狂欢";
const runtimeRoot = "D:\\AICode\\运行数据\\江湖有旅人\\团建工作台";
const materialRoot = "D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目\\01-素材库";
const productRoot = "D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目\\成品库（GPT+本地脚本制作）";
const originalPackage = path.join(productRoot, "20260810_154254_金华周边9大漂流合集🌊夏季团建玩水直接抄这份");
const reviewRoot = path.join(productRoot, "_待复核", "缺图");
const reviewedPackage = path.join(reviewRoot, path.basename(originalPackage));
const sourceLayer2 = path.join(materialRoot, "2", materialName);
const sourceLayer1 = path.join(materialRoot, "1", materialName);
const repairRoot = path.join(runtimeRoot, "repairs", "20260810-v0.16.24-partial-package");
const repairedAt = new Date().toISOString();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  const temporary = `${file}.repairing-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function backup(file) {
  fs.mkdirSync(repairRoot, { recursive: true });
  const target = path.join(repairRoot, path.basename(file));
  if (!fs.existsSync(target)) fs.copyFileSync(file, target);
}

function pathKey(value) {
  return path.resolve(value).toLowerCase();
}

const checkpointsFile = path.join(runtimeRoot, "gpt-production-checkpoints.json");
const usageFile = path.join(runtimeRoot, "防重复账本", "material-usage-ledger.json");
const metadataFile = path.join(runtimeRoot, "防重复账本", "material-metadata-ledger.json");
const globalIndexFile = path.join(runtimeRoot, "material-global-index.json");
const archiveFile = path.join(runtimeRoot, "gpt-production-archive.jsonl");
const currentPackage = fs.existsSync(originalPackage) ? originalPackage : reviewedPackage;
const manifestFile = path.join(currentPackage, "GPT作品记录.json");

for (const file of [checkpointsFile, usageFile, metadataFile, globalIndexFile, archiveFile, manifestFile]) {
  if (!fs.existsSync(file)) throw new Error(`修复所需文件不存在：${file}`);
  backup(file);
}

const manifest = readJson(manifestFile);
if (currentPackage === reviewedPackage
  && manifest.status === "incomplete"
  && manifest.incompleteReason === "planned-10-actual-5") {
  console.log(JSON.stringify({
    ok: true,
    alreadyRepaired: true,
    requestId,
    reviewedPackage,
    restoredMaterialPath: sourceLayer1,
    backupRoot: repairRoot
  }, null, 2));
  process.exit(0);
}
const imageCount = fs.readdirSync(currentPackage).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).length;
if (imageCount !== 5 || Number(manifest.actualImages || 0) !== 5) {
  throw new Error(`现场已变化，拒绝修复：图片实物 ${imageCount}，记录 ${manifest.actualImages}`);
}

if (fs.existsSync(sourceLayer2) && !fs.existsSync(sourceLayer1)) {
  fs.renameSync(sourceLayer2, sourceLayer1);
} else if (!fs.existsSync(sourceLayer1)) {
  throw new Error("素材既不在使用层 2，也不在预期恢复层 1，拒绝猜测移动");
}

fs.mkdirSync(reviewRoot, { recursive: true });
if (currentPackage === originalPackage) {
  if (fs.existsSync(reviewedPackage)) throw new Error(`待复核目录已有同名作品：${reviewedPackage}`);
  fs.renameSync(originalPackage, reviewedPackage);
}

const finalManifestFile = path.join(reviewedPackage, "GPT作品记录.json");
manifest.status = "incomplete";
manifest.valid = false;
manifest.expectedImageCount = 10;
manifest.actualImages = 5;
manifest.incompleteReason = "planned-10-actual-5";
manifest.repairedAt = repairedAt;
manifest.packagePath = reviewedPackage;
manifest.packageFolder = path.basename(reviewedPackage);
manifest.sourceMaterialPath = sourceLayer1;
manifest.sourceMaterialArchivePath = sourceLayer1;
manifest.sourceMaterialUpdatedAt = repairedAt;
writeJson(finalManifestFile, manifest);

const checkpoints = readJson(checkpointsFile);
const checkpoint = checkpoints.items?.[requestId];
if (!checkpoint) throw new Error(`找不到检查点：${requestId}`);
Object.assign(checkpoint, {
  stage: "图片没有补齐",
  percent: 64,
  taskState: "needs-review-partial-images",
  detectedImageCount: 5,
  packagePath: reviewedPackage,
  sourceMaterialPath: sourceLayer1,
  sourceMaterialArchivePath: "",
  usageUpdated: false,
  updatedAt: repairedAt
});
checkpoints.updatedAt = repairedAt;
writeJson(checkpointsFile, checkpoints);

const usage = readJson(usageFile);
const matchingUsage = Object.entries(usage.entries || {}).filter(([, record]) =>
  record?.name === materialName || String(record?.entryPath || "").includes(materialName)
);
if (matchingUsage.length !== 1) throw new Error(`使用账本匹配数量异常：${matchingUsage.length}`);
const [oldUsageKey, usageRecord] = matchingUsage[0];
delete usage.entries[oldUsageKey];
Object.assign(usageRecord, {
  entryPath: sourceLayer1,
  status: "prepared",
  usedAt: "",
  updatedAt: repairedAt,
  repairReason: "partial-images-5-of-10"
});
usage.entries[pathKey(sourceLayer1)] = usageRecord;
usage.events = [...(usage.events || []), {
  entryPath: sourceLayer1,
  status: "prepared",
  action: "repair-partial-package",
  requestId,
  recordedAt: repairedAt
}].slice(-2000);
usage.updatedAt = repairedAt;
writeJson(usageFile, usage);

const metadata = readJson(metadataFile);
const matchingMetadata = Object.values(metadata.entries || {}).filter((record) =>
  record?.name === materialName || String(record?.entryPath || "").includes(materialName)
);
if (matchingMetadata.length !== 1) throw new Error(`素材元数据匹配数量异常：${matchingMetadata.length}`);
const metadataRecord = matchingMetadata[0];
Object.assign(metadataRecord, {
  entryPath: sourceLayer1,
  usageCount: 1,
  usageSource: "repaired-incomplete-package",
  updatedAt: repairedAt
});
metadata.events = [...(metadata.events || []), {
  folderHash: metadataRecord.folderHash,
  entryPath: sourceLayer1,
  action: "repair-partial-package",
  mainTag: metadataRecord.mainTag || "",
  usageCount: 1,
  requestId,
  recordedAt: repairedAt
}].slice(-3000);
metadata.updatedAt = repairedAt;
writeJson(metadataFile, metadata);

const globalIndex = readJson(globalIndexFile);
const indexMatches = (globalIndex.items || []).filter((item) =>
  item?.name === materialName || String(item?.path || "").includes(materialName)
);
for (const item of indexMatches) {
  item.path = sourceLayer1;
  item.usageCount = 1;
  item.usageSource = "repaired-incomplete-package";
}
globalIndex.metadataUpdatedAt = repairedAt;
writeJson(globalIndexFile, globalIndex);

const correction = {
  recordedAt: repairedAt,
  event: "archive-corrected-partial-images",
  requestId,
  plannedImageCount: 10,
  actualImageCount: 5,
  invalidatedPackagePath: reviewedPackage,
  restoredMaterialPath: sourceLayer1
};
fs.appendFileSync(archiveFile, `${JSON.stringify(correction)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  requestId,
  imageCount,
  reviewedPackage,
  restoredMaterialPath: sourceLayer1,
  backupRoot: repairRoot,
  indexMatches: indexMatches.length
}, null, 2));
