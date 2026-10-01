"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);
const METADATA_NAMES = new Set([
  ".tags.json",
  "tags.json",
  "metadata.json",
  "meta.json",
  "manifest.json"
]);
const DEFAULT_SCAN_LIMITS = Object.freeze({
  maxDepth: 12,
  maxDirectories: 5000,
  maxMaterials: 500,
  maxFilesPerMaterial: 80,
  maxTextBytes: 96 * 1024
});

function absolutePath(value, fieldName) {
  const raw = String(value || "").trim();
  if (!raw || !path.isAbsolute(raw)) {
    const error = new Error(`${fieldName} 必须是绝对路径`);
    error.code = "TEMPLATE_MIGRATION_PATH_REQUIRED";
    throw error;
  }
  return path.resolve(raw);
}

function existingDirectory(value, fieldName) {
  const target = absolutePath(value, fieldName);
  let stat;
  try { stat = fs.statSync(target); } catch (error) {
    error.message = `${fieldName} 不存在：${target}`;
    error.code = "TEMPLATE_MIGRATION_PATH_NOT_FOUND";
    throw error;
  }
  if (!stat.isDirectory()) {
    const error = new Error(`${fieldName} 不是目录：${target}`);
    error.code = "TEMPLATE_MIGRATION_PATH_NOT_DIRECTORY";
    throw error;
  }
  return target;
}

function optionalExistingPath(value, fieldName) {
  const target = absolutePath(value, fieldName);
  if (!fs.existsSync(target)) {
    const error = new Error(`${fieldName} 不存在：${target}`);
    error.code = "TEMPLATE_MIGRATION_PATH_NOT_FOUND";
    throw error;
  }
  return target;
}

function fileExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

function fileKind(filePath) {
  const extension = fileExtension(filePath);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (extension === ".json") return "metadata";
  return "other";
}

function safeLabel(value, fallback = "未命名") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 96);
  return cleaned || fallback;
}

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function workFolderName(title, date = new Date()) {
  return `${localTimestamp(date)}-${safeLabel(title, "未命名套板")}`;
}

function stableId(value) {
  return crypto.createHash("sha1").update(String(value || ""), "utf8").digest("hex").slice(0, 16);
}

function readJsonFile(filePath, maxBytes = DEFAULT_SCAN_LIMITS.maxTextBytes) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function collectStrings(value, keys, output = [], keyHint = "") {
  if (output.length >= 40 || value === null || value === undefined) return output;
  if (typeof value === "string") {
    const text = value.trim();
    if (text && (keys.has(keyHint) || /[#，,、]|(省|市|区|县|镇|乡)$/.test(text))) output.push(text.slice(0, 80));
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, keys, output, keyHint));
    return output;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => collectStrings(child, keys, output, key));
  }
  return output;
}

function metadataSummary(directory, limits) {
  const tags = [];
  const metadataFiles = [];
  let title = "";
  let facts = {};
  let directEntries = [];
  try { directEntries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return { title, tags, metadataFiles, facts }; }
  const tagKeys = new Set([
    "tags", "labels", "businessTags", "location", "city", "district", "county", "area",
    "administrativeRegion", "行政区", "地点", "城市", "地区", "目的地", "主题"
  ]);
  directEntries
    .filter((entry) => entry.isFile() && METADATA_NAMES.has(entry.name.toLowerCase()))
    .slice(0, 8)
    .forEach((entry) => {
      const filePath = path.join(directory, entry.name);
      const parsed = readJsonFile(filePath, limits.maxTextBytes);
      metadataFiles.push(entry.name);
      if (!parsed || typeof parsed !== "object") return;
      if (!title && typeof parsed.title === "string") title = parsed.title.trim().slice(0, 120);
      if (!title && typeof parsed.name === "string") title = parsed.name.trim().slice(0, 120);
      facts = { ...facts, ...parsed };
      collectStrings(parsed, tagKeys, tags);
    });
  return {
    title,
    tags: [...new Set(tags)].slice(0, 24),
    metadataFiles,
    facts: Object.keys(facts).length ? facts : {}
  };
}

function directFiles(directory, limits) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .slice(0, limits.maxFilesPerMaterial)
      .map((entry) => {
        const filePath = path.join(directory, entry.name);
        return { name: entry.name, path: filePath, kind: fileKind(filePath), size: safeFileSize(filePath) };
      });
  } catch (_) {
    return [];
  }
}

function safeFileSize(filePath) {
  try { return fs.statSync(filePath).size; } catch (_) { return 0; }
}

function materialFromDirectory(directory, root, limits) {
  const files = directFiles(directory, limits);
  const images = files.filter((file) => file.kind === "image");
  const texts = files.filter((file) => file.kind === "text");
  if (!images.length && !texts.length) return null;
  const relativePath = path.relative(root, directory) || ".";
  const metadata = metadataSummary(directory, limits);
  const displayName = metadata.title || path.basename(directory) || path.basename(root);
  return {
    id: `material-${stableId(directory)}`,
    name: safeLabel(displayName),
    path: directory,
    relativePath,
    categoryPath: path.dirname(relativePath) === "." ? "" : path.dirname(relativePath),
    imageCount: images.length,
    textCount: texts.length,
    files: files.map(({ name, kind, size }) => ({ name, kind, size })),
    tags: metadata.tags,
    metadataFiles: metadata.metadataFiles,
    facts: metadata.facts
  };
}

function scanMaterialLibrary(rootPath, options = {}) {
  const limits = { ...DEFAULT_SCAN_LIMITS, ...options };
  const root = existingDirectory(rootPath, "素材库路径");
  const queue = [{ directory: root, depth: 0 }];
  const materials = [];
  const categories = new Map();
  let visitedDirectories = 0;
  while (queue.length && visitedDirectories < limits.maxDirectories && materials.length < limits.maxMaterials) {
    const current = queue.shift();
    visitedDirectories += 1;
    const item = materialFromDirectory(current.directory, root, limits);
    if (item) {
      materials.push(item);
      const categoryPath = item.categoryPath;
      if (categoryPath) {
        const segments = categoryPath.split(path.sep).filter(Boolean);
        for (let index = 0; index < segments.length; index += 1) {
          const prefix = segments.slice(0, index + 1).join(path.sep);
          categories.set(prefix, (categories.get(prefix) || 0) + 1);
        }
      }
    }
    if (current.depth >= limits.maxDepth) continue;
    let entries = [];
    try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); } catch (_) { continue; }
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
      .forEach((entry) => queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 }));
  }
  const categoryList = [...categories.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([relativePath, materialCount]) => ({
      id: `category-${stableId(relativePath)}`,
      name: relativePath.split(path.sep).filter(Boolean).at(-1) || "根目录",
      path: relativePath,
      materialCount
    }));
  return {
    root,
    scannedAt: new Date().toISOString(),
    truncated: queue.length > 0 || visitedDirectories >= limits.maxDirectories,
    visitedDirectories,
    total: materials.length,
    categories: categoryList,
    materials
  };
}

function summarizeTemplate(templateInput, options = {}) {
  const limits = { ...DEFAULT_SCAN_LIMITS, maxDepth: 8, maxMaterials: 1, ...options };
  const target = optionalExistingPath(templateInput, "模板路径");
  const stat = fs.statSync(target);
  const files = [];
  if (stat.isFile()) {
    files.push({ name: path.basename(target), path: target, kind: fileKind(target), size: safeFileSize(target) });
  } else {
    const queue = [{ directory: target, depth: 0 }];
    while (queue.length && files.length < 120) {
      const current = queue.shift();
      directFiles(current.directory, limits).forEach((file) => {
        if (file.kind === "image" || file.kind === "text" || file.kind === "metadata") files.push(file);
      });
      if (current.depth >= limits.maxDepth) continue;
      let entries = [];
      try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); } catch (_) { continue; }
      entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
        .forEach((entry) => queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 }));
    }
  }
  const images = files.filter((file) => file.kind === "image");
  const textFiles = files.filter((file) => file.kind === "text");
  return {
    name: safeLabel(path.basename(target) || target),
    path: target,
    kind: stat.isFile() ? fileKind(target) : "directory",
    imageCount: images.length,
    textCount: textFiles.length,
    files: files.map(({ name, kind, size, path: filePath }) => ({ name, kind, size, path: filePath })),
    locked: true,
    lockedAt: new Date().toISOString()
  };
}

function createSession(input, options = {}) {
  const materialRoot = existingDirectory(input.materialRoot, "素材库路径");
  const outputRoot = absolutePath(input.outputRoot, "成品库路径");
  const template = summarizeTemplate(input.templatePath);
  const scan = scanMaterialLibrary(materialRoot, options.scan);
  const selected = new Set((Array.isArray(input.selectedMaterialPaths) ? input.selectedMaterialPaths : [])
    .map((item) => path.resolve(String(item || ""))));
  const materials = selected.size
    ? scan.materials.filter((item) => selected.has(path.resolve(item.path)))
    : scan.materials;
  return {
    id: `tm-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    mode: "template-migration",
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    template,
    materialRoot,
    outputRoot,
    outputLibrary: path.join(outputRoot, "_套板迁移"),
    scan: { ...scan, materials },
    selection: { requested: selected.size, resolved: materials.length },
    progress: {
      total: materials.length,
      currentIndex: materials.length ? 0 : -1,
      completed: 0,
      failed: 0,
      currentSetStatus: materials.length ? "ready" : "waiting-materials",
      currentWorkFolder: ""
    },
    plan: {
      waitingForConfirmation: true,
      confirmationText: "1",
      maxPagesPerSet: 10,
      templateControls: "视觉结构、页面职责、字体、颜色、标题位置和版式",
      materialControls: "事实、图片、文案和原有标签",
      factsPolicy: "只使用素材明确提供的事实；未知字段留空，不补写"
    },
    note: String(input.note || "").trim().slice(0, 500)
  };
}

function createCurrentWorkFolder(session, now = new Date()) {
  const material = session?.scan?.materials?.[session?.progress?.currentIndex];
  if (!material) return "";
  const title = material.name || path.basename(material.path);
  const directory = path.join(session.outputLibrary, workFolderName(title, now));
  fs.mkdirSync(directory, { recursive: true });
  const manifestPath = path.join(directory, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify({
      workId: `template-migration-${stableId(`${session.id}:${material.path}`)}`,
      title,
      productionMode: "template-migration-production",
      lifecycleStatus: "CONFIRMED_WAITING_PRODUCTION",
      templatePath: session.template?.path || "",
      materialPath: material.path,
      outputPath: directory,
      sourceTags: material.tags || [],
      sourceMetadataFiles: material.metadataFiles || [],
      sourceFacts: material.facts || {},
      progress: {
        plannedImageCount: null,
        completedImageCount: 0,
        currentSetIndex: Number(session.progress.currentIndex || 0),
        pageLimit: Number(session.plan?.maxPagesPerSet || 10)
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    }, null, 2), "utf8");
  }
  return directory;
}

function confirmSession(session, selectedMaterialPaths) {
  if (!session || typeof session !== "object") throw new Error("没有可确认的模板迁移批次");
  if (!session.scan?.materials?.length) throw new Error("当前批次没有可生产素材");
  if (Array.isArray(selectedMaterialPaths)) {
    const selected = new Set(selectedMaterialPaths.map((item) => path.resolve(String(item || ""))));
    session.scan.materials = session.scan.materials.filter((item) => selected.has(path.resolve(item.path)));
    if (!session.scan.materials.length) throw new Error("至少选择一个素材包后才能确认");
    session.selection = { requested: selected.size, resolved: session.scan.materials.length };
    session.progress.total = session.scan.materials.length;
    session.progress.currentIndex = 0;
    session.progress.completed = 0;
    session.progress.failed = 0;
  }
  session.status = "confirmed";
  session.updatedAt = new Date().toISOString();
  session.plan.waitingForConfirmation = false;
  session.progress.currentSetStatus = "ready-to-produce";
  if (!session.progress.currentWorkFolder) session.progress.currentWorkFolder = createCurrentWorkFolder(session);
  return session;
}

function advanceSession(session, action, note = "") {
  const normalized = String(action || "").trim().toLowerCase();
  if (!session || !session.progress || !Array.isArray(session.scan?.materials)) throw new Error("没有可推进的模板迁移批次");
  const allowed = new Set(["complete", "failed", "skip", "pause"]);
  if (!allowed.has(normalized)) throw new Error("不支持的进度动作");
  if (normalized === "pause") {
    session.status = "paused";
    session.progress.currentSetStatus = "paused";
  } else {
    if (normalized === "complete") session.progress.completed += 1;
    if (normalized === "failed") session.progress.failed += 1;
    session.progress.currentIndex += 1;
    if (session.progress.currentIndex >= session.progress.total) {
      session.status = "completed";
      session.progress.currentSetStatus = "completed";
      session.progress.currentWorkFolder = "";
    } else {
      session.status = "confirmed";
      session.progress.currentSetStatus = normalized === "skip" ? "skipped" : "ready-to-produce";
      session.progress.currentWorkFolder = createCurrentWorkFolder(session);
    }
  }
  session.updatedAt = new Date().toISOString();
  session.lastAction = { action: normalized, note: String(note || "").slice(0, 300), at: session.updatedAt };
  return session;
}

module.exports = {
  DEFAULT_SCAN_LIMITS,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
  absolutePath,
  safeLabel,
  localTimestamp,
  workFolderName,
  scanMaterialLibrary,
  summarizeTemplate,
  createSession,
  confirmSession,
  advanceSession,
  createCurrentWorkFolder
};
