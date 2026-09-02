const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([".avif", ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".webp"]);

function normalizeFileName(value) {
  return path.basename(String(value || "").trim()).toLowerCase();
}

function parseAttachmentPreviewName(label) {
  const value = String(label || "").trim();
  if (!/(?:remove\s+file|移除文件)/i.test(value)) return "";
  const separator = Math.max(value.lastIndexOf("："), value.lastIndexOf(":"));
  return normalizeFileName(separator >= 0 ? value.slice(separator + 1) : value.replace(/^(?:remove\s+file|移除文件)\s*\d*\s*/i, ""));
}

function reconcileGptAttachmentPaths(filePaths, previewLabels) {
  const expected = (Array.isArray(filePaths) ? filePaths : []).map((filePath) => ({
    filePath: String(filePath || "").trim(),
    name: normalizeFileName(filePath),
    matched: false
  })).filter((item) => item.filePath && item.name);
  const previewNames = (Array.isArray(previewLabels) ? previewLabels : [])
    .map(parseAttachmentPreviewName)
    .filter(Boolean);
  for (const previewName of previewNames) {
    const match = expected.find((item) => !item.matched && item.name === previewName);
    if (!match) {
      return {
        ok: false,
        existingCount: previewNames.length,
        missingPaths: [],
        error: `GPT 输入框存在不属于当前任务的附件：${previewName}`
      };
    }
    match.matched = true;
  }
  return {
    ok: true,
    existingCount: previewNames.length,
    missingPaths: expected.filter((item) => !item.matched).map((item) => item.filePath)
  };
}

function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase());
}

function inputAcceptsPath(accept, filePath) {
  const value = String(accept || "").trim().toLowerCase();
  if (!value || value === "*/*") return true;
  const extension = path.extname(String(filePath || "")).toLowerCase();
  const image = isImagePath(filePath);
  return value.split(",").map((item) => item.trim()).filter(Boolean).some((token) => {
    if (token === "*/*") return true;
    if (token.startsWith(".")) return token === extension;
    if (token === "image/*") return image;
    if (token === "text/*") return !image && [".txt", ".csv", ".md", ".json"].includes(extension);
    if (token === "text/plain") return extension === ".txt" || extension === ".md";
    if (token === "application/json") return extension === ".json";
    if (token === "text/csv") return extension === ".csv";
    return false;
  });
}

function selectGptFileInputCandidate(candidates, filePaths, kind = "mixed") {
  const files = (Array.isArray(filePaths) ? filePaths : []).filter(Boolean);
  const eligible = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => files.every((filePath) => inputAcceptsPath(candidate.accept, filePath)));
  if (!eligible.length) return null;
  return eligible.sort((left, right) => {
    const score = (candidate) => {
      const accept = String(candidate.accept || "").toLowerCase();
      const id = String(candidate.id || "").toLowerCase();
      const photoUploadEnabled = candidate.photoUploadEnabled === true
        || String(candidate.dataPhotoUploadEnabled || "").toLowerCase() === "true";
      let result = candidate.multiple ? 20 : 0;
      // ChatGPT exposes several hidden file inputs.  The image-specific
      // inputs are visually convenient, but the production composer is wired
      // to the unified #upload-files input (marked with
      // data-photo-upload-enabled).  Prefer that production path whenever it
      // can accept the files; otherwise a later image/document-specific
      // candidate remains a valid fallback.
      if (photoUploadEnabled || id === "upload-files") result += 100;
      if (kind === "image" && /image/.test(accept)) result += 40;
      if (kind === "document" && !accept) result += 40;
      if (kind === "document" && /text|file|txt|csv|json|pdf/.test(accept)) result += 50;
      if (kind === "mixed" && !accept) result += 50;
      return result;
    };
    return score(right) - score(left);
  })[0];
}

function planGptFileInputOperations(candidates, filePaths) {
  const files = (Array.isArray(filePaths) ? filePaths : []).filter(Boolean);
  const images = files.filter(isImagePath);
  const documents = files.filter((filePath) => !isImagePath(filePath));
  const operations = [];
  if (documents.length) {
    const candidate = selectGptFileInputCandidate(candidates, documents, "document");
    if (!candidate) return { ok: false, operations: [], error: "GPT 当前页面没有可接收 TXT/文档的附件入口" };
    // ChatGPT processes every selected document asynchronously. Keep each TXT
    // isolated so a second change cannot replace the first before React has
    // consumed it, even when the DOM input advertises `multiple`.
    documents.forEach((filePath) => operations.push({ kind: "document", files: [filePath] }));
  }
  if (images.length) {
    const candidate = selectGptFileInputCandidate(candidates, images, "image");
    if (!candidate) return { ok: false, operations: [], error: "GPT 当前页面没有可接收图片的附件入口" };
    // A single native change event makes ChatGPT inspect every image before
    // React can yield back to the Electron bridge. Keep the same small batch
    // boundary as the renderer fallback; the caller verifies the accumulated
    // composer previews before it proceeds to the next workflow action.
    const batchSize = candidate.multiple ? 2 : 1;
    for (let index = 0; index < images.length; index += batchSize) {
      operations.push({ kind: "image", files: images.slice(index, index + batchSize) });
    }
  }
  return { ok: true, operations };
}

function selectCompactTemplateImages(templateAttachments) {
  const images = (Array.isArray(templateAttachments) ? templateAttachments : []).filter(isImagePath);
  if (images.length <= 4) return images;
  const byName = new Map(images.map((filePath) => [normalizeFileName(filePath), filePath]));
  const semanticFour = ["1.jpg", "2.jpg", "3.jpg", "10.jpg"].map((name) => byName.get(name)).filter(Boolean);
  return semanticFour.length === 4 ? semanticFour : images.slice(0, 4);
}

function prepareGptTaskUpload(task, readTextFile) {
  const attachments = (Array.isArray(task?.attachments) ? task.attachments : []).map(String).filter(Boolean);
  const templateAttachments = (Array.isArray(task?.templateAttachments) ? task.templateAttachments : []).map(String).filter(Boolean);
  const selectedTemplateImages = selectCompactTemplateImages(templateAttachments);
  const templateSet = new Set(templateAttachments.map((filePath) => path.resolve(filePath).toLowerCase()));
  const templateImageSet = new Set(templateAttachments.filter(isImagePath).map((filePath) => path.resolve(filePath).toLowerCase()));
  const allMaterialImages = attachments.filter((filePath) => isImagePath(filePath)
    && !templateImageSet.has(path.resolve(filePath).toLowerCase()));
  const materialImages = allMaterialImages.slice(0, Math.max(0, 10 - selectedTemplateImages.length));
  const textAttachments = attachments.filter((filePath) => path.extname(filePath).toLowerCase() === ".txt");
  const textSections = textAttachments.map((filePath) => {
    const role = templateSet.has(path.resolve(filePath).toLowerCase()) ? "母版文案" : "本轮素材文案";
    const content = String(readTextFile(filePath) || "").replace(/^\uFEFF/u, "").trim();
    return `\n\n<<<${role}：${path.basename(filePath)}>>>\n${content}\n<<<${role}结束>>>`;
  });
  return {
    attachments: [...selectedTemplateImages, ...materialImages],
    templateAttachments: selectedTemplateImages,
    prompt: `${String(task?.prompt || "").trim()}${textSections.join("")}`,
    embeddedTextCount: textAttachments.length,
    removedTemplateImageCount: Math.max(0, templateAttachments.filter(isImagePath).length - selectedTemplateImages.length),
    removedMaterialImageCount: Math.max(0, allMaterialImages.length - materialImages.length)
  };
}

module.exports = {
  inputAcceptsPath,
  isImagePath,
  parseAttachmentPreviewName,
  planGptFileInputOperations,
  prepareGptTaskUpload,
  reconcileGptAttachmentPaths,
  selectCompactTemplateImages,
  selectGptFileInputCandidate
};
