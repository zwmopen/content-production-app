#!/usr/bin/env node

/**
 * Backfill sourceMaterialPath on existing GPT作品记录.json files.
 *
 * Only exact packagePath matches from the production archive are applied.
 * This intentionally refuses to guess from a title or folder name so an
 * existing record can never be linked to the wrong source material.
 */
const fs = require("node:fs");
const path = require("node:path");

const productRoot = process.argv[2] || "D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目\\成品库（GPT+本地脚本制作）";
const archiveFile = process.argv[3] || "D:\\AICode\\运行数据\\江湖有旅人\\图文生产控制台\\gpt-production-archive.jsonl";
const checkpointFile = process.argv[4] || "D:\\AICode\\运行数据\\江湖有旅人\\图文生产控制台\\gpt-production-checkpoints.json";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function walkRecords(root) {
  const result = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name === "GPT作品记录.json") result.push(file);
    }
  };
  if (fs.existsSync(root) && fs.statSync(root).isDirectory()) visit(root);
  return result;
}

const archiveByPackage = new Map();
if (fs.existsSync(archiveFile)) {
  for (const line of fs.readFileSync(archiveFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const packagePath = String(record.packagePath || "").trim();
      const sourcePath = String(record.from || "").trim();
      if (packagePath && sourcePath && !archiveByPackage.has(path.resolve(packagePath))) {
        archiveByPackage.set(path.resolve(packagePath), record);
      }
    } catch {
      // Keep processing the remaining archive lines; a malformed history line
      // must not prevent safe backfill of exact matches.
    }
  }
}

let scanned = 0;
let updated = 0;
let skipped = 0;
const sourceByPackage = new Map();
for (const file of walkRecords(productRoot)) {
  scanned += 1;
  let record;
  try {
    record = readJson(file);
  } catch {
    skipped += 1;
    continue;
  }
  if (String(record.sourceMaterialPath || "").trim()) {
    skipped += 1;
    continue;
  }
  const packagePath = String(record.packagePath || path.dirname(file)).trim();
  const archived = archiveByPackage.get(path.resolve(packagePath));
  const sourcePath = String(archived?.from || "").trim();
  if (!sourcePath) {
    skipped += 1;
    continue;
  }
  record.sourceMaterialPath = sourcePath;
  record.sourceMaterialName = path.basename(sourcePath);
  if (String(archived.to || "").trim()) record.sourceMaterialArchivePath = String(archived.to).trim();
  record.sourceMaterialBackfilledAt = new Date().toISOString();
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  updated += 1;
  sourceByPackage.set(path.resolve(packagePath), record);
}

// Keep the user-visible production history aligned with the package records.
// Older checkpoints had no source path even when the package itself did.
let checkpointsUpdated = 0;
if (fs.existsSync(checkpointFile)) {
  try {
    const checkpoints = readJson(checkpointFile);
    for (const item of Object.values(checkpoints.items || {})) {
      const packagePath = String(item?.packagePath || "").trim();
      if (!packagePath || String(item.sourceMaterialPath || "").trim()) continue;
      const recordFile = path.join(packagePath, "GPT作品记录.json");
      let record = sourceByPackage.get(path.resolve(packagePath));
      if (!record && fs.existsSync(recordFile)) {
        try { record = readJson(recordFile); } catch { record = null; }
      }
      const sourcePath = String(record?.sourceMaterialPath || archiveByPackage.get(path.resolve(packagePath))?.from || "").trim();
      if (!sourcePath) continue;
      item.sourceMaterialPath = sourcePath;
      if (String(record?.sourceMaterialArchivePath || "").trim()) item.sourceMaterialArchivePath = record.sourceMaterialArchivePath;
      checkpointsUpdated += 1;
    }
    if (checkpointsUpdated) {
      checkpoints.updatedAt = new Date().toISOString();
      fs.writeFileSync(checkpointFile, `${JSON.stringify(checkpoints, null, 2)}\n`, "utf8");
    }
  } catch {
    // Checkpoints are auxiliary UI state; never fail the safe package repair.
  }
}

console.log(JSON.stringify({ productRoot, archiveFile, checkpointFile, scanned, updated, checkpointsUpdated, skipped }, null, 2));
