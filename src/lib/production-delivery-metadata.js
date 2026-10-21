const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readJson(filePath, fallback = null) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJsonReadback(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(5).toString("hex")}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
    const readback = readJson(filePath, null);
    if (JSON.stringify(readback) !== JSON.stringify(value)) {
      throw new Error("production_metadata_readback_mismatch");
    }
    return readback;
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
}

function listPackageFiles(packagePath) {
  return fs.readdirSync(packagePath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, path: path.join(packagePath, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
}

function templateInfo(request = {}, packageRecord = {}) {
  const selected = request.template && typeof request.template === "object" ? request.template : {};
  const saved = packageRecord.template && typeof packageRecord.template === "object" ? packageRecord.template : {};
  const get = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || null;
  const item = {
    id: get(request.templateId, selected.id, selected.templateId, packageRecord.templateId, saved.id),
    name: get(request.templateName, selected.name, selected.templateName, packageRecord.templateName, saved.name),
    url: get(request.templateUrl, selected.url, selected.templateUrl, packageRecord.templateUrl, saved.url),
    rootPath: get(request.templatePath, selected.rootPath, selected.path, packageRecord.templatePath, saved.rootPath),
    p1Path: get(request.templateP1Path, selected.p1Path, packageRecord.templateP1Path, saved.p1Path),
    p1Sha256: get(request.templateP1Sha256, selected.p1Sha256, packageRecord.templateP1Sha256, saved.p1Sha256),
    p2Path: get(request.templateP2Path, selected.p2Path, packageRecord.templateP2Path, saved.p2Path),
    p2Sha256: get(request.templateP2Sha256, selected.p2Sha256, packageRecord.templateP2Sha256, saved.p2Sha256),
    selectionMode: get(request.templateSelectionMode, selected.selectionMode, selected.mode,
      packageRecord.templateSelectionMode, packageRecord.templateMode)
  };
  const hasAny = Object.values(item).some(Boolean);
  item.status = !hasAny ? "UNVERIFIED" : (item.rootPath || item.url || item.p1Path || item.p2Path ? "RECORDED" : "IDENTITY_ONLY");
  return item;
}

function versionNames(copyText) {
  const found = [];
  for (const match of String(copyText || "").matchAll(/<<<VERSION_START:\s*([^>\r\n]+?)\s*>>>/g)) {
    const name = match[1].trim();
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

function buildOnlineDeliveryMetadata({ packagePath, request = {}, packageRecord = {}, imageValidation = {} }) {
  const formalPath = path.resolve(packagePath);
  const files = listPackageFiles(formalPath);
  const images = files.filter((file) => /\.(?:png|jpe?g|webp)$/i.test(file.name));
  const textFiles = files.filter((file) => /\.txt$/i.test(file.name));
  const selectedText = textFiles.find((file) => {
    const expected = text(packageRecord.textSha256);
    return expected && sha256File(file.path) === expected.toLowerCase();
  }) || (textFiles.length === 1 ? textFiles[0] : null);
  const copyBody = selectedText ? fs.readFileSync(selectedText.path, "utf8") : "";
  const names = versionNames(copyBody);
  const sourcePath = text(request.sourceMaterialPath || packageRecord.sourceMaterialPath);
  const template = templateInfo(request, packageRecord);
  const batchId = text(request.batchId || packageRecord.batchId);
  const copySha256 = selectedText ? sha256File(selectedText.path) : null;
  const expectedCopySha256 = text(packageRecord.textSha256)?.toLowerCase() || null;
  const copyHashMatches = Boolean(copySha256 && expectedCopySha256 && copySha256 === expectedCopySha256);
  const imageRows = images.map((file, index) => {
    const explicitPage = file.name.match(/(?:^|[_-])(P\d+)(?:[_\-.]|$)/i)?.[1]?.toUpperCase() || null;
    const mappings = [
      ...(Array.isArray(packageRecord.pageMappings) ? packageRecord.pageMappings : []),
      ...(Array.isArray(packageRecord.sourcePageMap) ? packageRecord.sourcePageMap : [])
    ];
    const mapping = mappings.find((entry) => entry && (
      entry.fileName === file.name || entry.outputFileName === file.name
      || entry.path === file.path || entry.outputPath === file.path
      || (entry.outputPath && path.basename(entry.outputPath) === file.name)
    ));
    const page = explicitPage || text(mapping?.page);
    return {
      page,
      sequence: index + 1,
      role: page === "P1" ? "cover" : page ? "interior" : "UNMAPPED",
      fileName: file.name,
      path: file.path,
      sha256: sha256File(file.path),
      sourcePath: text(mapping?.sourcePath),
      sourceSha256: text(mapping?.sourceSha256),
      qaStatus: "UNVERIFIED",
      templateId: text(mapping?.templateId) || template.id,
      templatePagePath: text(mapping?.templatePath)
        || (page === "P1" ? template.p1Path : page === "P2" ? template.p2Path : null)
    };
  });
  const mappedImageCount = imageRows.filter((row) => row.sourcePath).length;
  const packageValidationPassed = imageValidation.valid === true
    && images.length > 0
    && Boolean(selectedText)
    && copyHashMatches;
  const recordFilePath = path.join(formalPath, "GPT作品记录.json");
  const metadataFilePath = path.join(formalPath, "metadata.json");
  return {
    schemaVersion: 1,
    identity: {
      workId: batchId,
      batchId,
      title: text(packageRecord.copyTitle || request.title),
      createdAt: text(packageRecord.createdAt),
      finishedAt: text(packageRecord.completedAt)
    },
    production: {
      line: "在线模式",
      platform: "GPT 网页/CDP",
      mode: text(request.productionMode) || "GPT 网页模式",
      instance: text(request.instance || request.instanceName || packageRecord.instance) || "UNVERIFIED",
      conversationUrl: text(request.conversationUrl || packageRecord.conversationUrl),
      startedAt: text(packageRecord.createdAt),
      finishedAt: text(packageRecord.completedAt)
    },
    source: {
      originalFolderPath: sourcePath,
      currentFolderPath: sourcePath,
      archivedFolderPath: null,
      archiveStatus: "NOT_ARCHIVED",
      title: text(packageRecord.sourceMaterialName || (sourcePath ? path.basename(sourcePath) : "")),
      pageMappingStatus: imageRows.length > 0 && mappedImageCount === imageRows.length
        ? "RECORDED"
        : mappedImageCount > 0 ? "PARTIAL" : "UNVERIFIED"
    },
    template: {
      status: template.status,
      selectionMode: template.selectionMode,
      templates: template.id || template.name || template.rootPath || template.url || template.p1Path || template.p2Path
        ? [{ id: template.id, name: template.name, rootPath: template.rootPath, url: template.url,
          p1Path: template.p1Path, p1Sha256: template.p1Sha256,
          p2Path: template.p2Path, p2Sha256: template.p2Sha256 }]
        : [],
      note: template.status === "UNVERIFIED" ? "模板信息未由调用端提供；不得按默认模板推断。" : null
    },
    product: {
      formalPath,
      recordPath: recordFilePath,
      metadataPath: metadataFilePath,
      status: packageValidationPassed ? "PACKAGE_VALIDATED" : "PACKAGE_NEEDS_REVIEW",
      packageLayout: { imageCount: images.length, textFileCount: textFiles.length }
    },
    outputs: {
      images: imageRows,
      copy: {
        path: selectedText?.path || null,
        sha256: copySha256,
        expectedSha256: expectedCopySha256,
        sha256MatchesPackageRecord: copyHashMatches,
        versionCount: names.length,
        versionNames: names,
        qaStatus: "UNVERIFIED"
      }
    },
    quality: {
      packageStructure: packageValidationPassed ? "PASS" : "UNVERIFIED",
      imageQaStatus: "UNVERIFIED",
      copyQaStatus: "UNVERIFIED",
      overallStatus: "NOT_FORMALLY_ACCEPTED",
      note: "包内文件数量与文案 SHA 已核对；尚未写入逐页人工/视觉 QA 凭证。"
    },
    sync: {
      feishu: { status: "UNVERIFIED" },
      notification: { status: "UNVERIFIED" }
    }
  };
}

function writeOnlineDeliveryMetadata({ packagePath, request = {}, imageValidation = {} }) {
  const formalPath = path.resolve(packagePath);
  const recordFilePath = path.join(formalPath, "GPT作品记录.json");
  const metadataFilePath = path.join(formalPath, "metadata.json");
  const packageRecord = readJson(recordFilePath, {});
  const deliveryMetadata = buildOnlineDeliveryMetadata({
    packagePath: formalPath,
    request,
    packageRecord,
    imageValidation
  });
  const existing = readJson(metadataFilePath, null);
  const existingWorkId = existing?.deliveryMetadata?.identity?.workId;
  if (existing && existingWorkId && existingWorkId !== deliveryMetadata.identity.workId) {
    throw new Error("production_metadata_identity_conflict");
  }
  const sidecar = { schemaVersion: 1, metadataType: "production-delivery", deliveryMetadata };
  packageRecord.deliveryMetadata = deliveryMetadata;
  writeJsonReadback(metadataFilePath, sidecar);
  writeJsonReadback(recordFilePath, packageRecord);
  const sidecarReadback = readJson(metadataFilePath, null);
  const recordReadback = readJson(recordFilePath, null);
  if (JSON.stringify(sidecarReadback?.deliveryMetadata) !== JSON.stringify(recordReadback?.deliveryMetadata)) {
    throw new Error("production_metadata_record_projection_mismatch");
  }
  return { metadataPath: metadataFilePath, metadataStatus: "WRITTEN_AND_READ_BACK", deliveryMetadata };
}

function updateOnlineSourceArchiveMetadata({ packagePath, originalPath, archivedPath, archivedAt = new Date().toISOString() }) {
  const formalPath = path.resolve(packagePath);
  const metadataFilePath = path.join(formalPath, "metadata.json");
  const recordFilePath = path.join(formalPath, "GPT作品记录.json");
  const sidecar = readJson(metadataFilePath, null);
  if (!sidecar?.deliveryMetadata) return { updated: false, reason: "metadata-sidecar-not-present" };
  const deliveryMetadata = sidecar.deliveryMetadata;
  deliveryMetadata.source = {
    ...deliveryMetadata.source,
    originalFolderPath: text(originalPath) || deliveryMetadata.source?.originalFolderPath || null,
    currentFolderPath: text(archivedPath) || deliveryMetadata.source?.currentFolderPath || null,
    archivedFolderPath: text(archivedPath),
    archiveStatus: "ARCHIVED",
    archivedAt: text(archivedAt)
  };
  const packageRecord = readJson(recordFilePath, {});
  packageRecord.deliveryMetadata = deliveryMetadata;
  packageRecord.sourceMaterialPath ||= text(originalPath);
  packageRecord.sourceMaterialArchivePath = text(archivedPath);
  packageRecord.sourceMaterialUpdatedAt = text(archivedAt);
  writeJsonReadback(metadataFilePath, sidecar);
  writeJsonReadback(recordFilePath, packageRecord);
  const sidecarReadback = readJson(metadataFilePath, null);
  const recordReadback = readJson(recordFilePath, null);
  if (JSON.stringify(sidecarReadback?.deliveryMetadata) !== JSON.stringify(recordReadback?.deliveryMetadata)) {
    throw new Error("production_metadata_archive_readback_mismatch");
  }
  return { updated: true, metadataPath: metadataFilePath, archivedFolderPath: archivedPath };
}

module.exports = {
  buildOnlineDeliveryMetadata,
  updateOnlineSourceArchiveMetadata,
  writeOnlineDeliveryMetadata
};
