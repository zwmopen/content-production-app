const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function isDirectory(value) {
  try { return fs.statSync(value).isDirectory(); } catch { return false; }
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stableWorkId(folder = "") {
  const normalized = String(folder || "").normalize("NFKC").trim().toLowerCase();
  return normalized ? crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32) : "";
}

function historyIndex(historyFile) {
  const history = readJson(historyFile, { entries: [] });
  const entries = Array.isArray(history.entries) ? history.entries : [];
  const byFolder = new Map();
  for (const entry of entries) {
    const folder = String(entry?.packageFolder || path.basename(String(entry?.packagePath || ""))).trim();
    if (!folder) continue;
    const previous = byFolder.get(folder);
    if (!previous || String(entry.recordedAt || "") > String(previous.recordedAt || "")) byFolder.set(folder, entry);
  }
  return { updatedAt: String(history.updatedAt || ""), byFolder };
}

function directoryIndex(libraryRoot, options = {}) {
  const root = path.resolve(String(libraryRoot || ""));
  const maximumDirectories = Math.max(100, Number(options.maximumDirectories || 20_000));
  const maximumDepth = Math.max(1, Number(options.maximumDepth || 5));
  const byFolder = new Map();
  if (!isDirectory(root)) return { byFolder, inspected: 0 };
  const queue = [{ directory: root, depth: 0 }];
  let inspected = 0;
  while (queue.length && inspected < maximumDirectories) {
    const current = queue.shift();
    inspected += 1;
    if (fs.existsSync(path.join(current.directory, "GPT作品记录.json"))) {
      const folder = path.basename(current.directory);
      if (!byFolder.has(folder)) byFolder.set(folder, current.directory);
    }
    if (current.depth >= maximumDepth) continue;
    let entries = [];
    try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (/^(?:\.workpkg_staging_|_作品历史数据|_logs|logs$)/i.test(entry.name)) continue;
      queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
    }
  }
  return { byFolder, inspected };
}

function resolveWorkPackagePath(packagePath, options = {}) {
  const originalPath = String(packagePath || "").trim();
  const libraryRoot = path.resolve(String(options.libraryRoot || ""));
  if (!originalPath || !String(options.libraryRoot || "").trim()) {
    return { path: originalPath, originalPath, moved: false, workId: "", source: "missing" };
  }
  const original = path.resolve(originalPath);
  const derivedWorkId = stableWorkId(path.basename(original));
  if (isInside(libraryRoot, original) && isDirectory(original)) {
    return { path: original, originalPath: original, moved: false, workId: derivedWorkId, source: "original" };
  }
  const index = options.index || historyIndex(options.historyFile);
  const entry = index.byFolder.get(path.basename(original));
  const candidate = String(entry?.packagePath || "").trim();
  if (candidate) {
    const resolved = path.resolve(candidate);
    if (isInside(libraryRoot, resolved) && isDirectory(resolved)) {
      return {
        path: resolved,
        originalPath: original,
        moved: resolved.toLowerCase() !== original.toLowerCase(),
        workId: String(entry.id || derivedWorkId),
        source: "history"
      };
    }
  }
  const indexedPath = String(options.directoryIndex?.byFolder?.get(path.basename(original)) || "").trim();
  if (indexedPath) {
    const resolved = path.resolve(indexedPath);
    if (isInside(libraryRoot, resolved) && isDirectory(resolved)) {
      return {
        path: resolved,
        originalPath: original,
        moved: resolved.toLowerCase() !== original.toLowerCase(),
        workId: String(entry?.id || derivedWorkId),
        source: "directory-index"
      };
    }
  }
  return { path: original, originalPath: original, moved: false, workId: String(entry?.id || derivedWorkId), source: "unresolved" };
}

module.exports = { directoryIndex, historyIndex, resolveWorkPackagePath, stableWorkId };
