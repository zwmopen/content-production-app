const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const LEDGER_VERSION = 1;

function hashText(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function productionHistoryStatus(historyFile) {
  const history = readJson(historyFile, null);
  if (!history || !Array.isArray(history.entries)) {
    return {
      historyPath: historyFile,
      schemaVersion: null,
      uniqueImageGroups: 0,
      exactHashGroups: 0,
      perceptualHashGroups: 0,
      updatedAt: "",
      available: false
    };
  }
  const entries = history.entries;
  return {
    historyPath: historyFile,
    schemaVersion: history.schemaVersion ?? null,
    uniqueImageGroups: entries.length,
    exactHashGroups: entries.filter((entry) =>
      /^[a-f0-9]{64}$/i.test(String(entry.imageSetSha256 || ""))
      && Array.isArray(entry.imageSha256)
      && entry.imageSha256.length > 0
    ).length,
    perceptualHashGroups: entries.filter((entry) =>
      Array.isArray(entry.imagePerceptualHash)
      && entry.imagePerceptualHash.some((hash) => /^[a-f0-9]{16}$/i.test(String(hash || "")))
    ).length,
    updatedAt: history.updatedAt || "",
    available: true
  };
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows
    .filter((values) => values.some((value) => String(value).trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function readCsv(file) {
  if (!file || !fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, "utf8"));
}

function fileTime(file) {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return "";
  }
}

function collectPackagedTextFiles(libraryRoot) {
  if (!libraryRoot || !fs.existsSync(libraryRoot)) return [];
  const results = [];
  const visited = new Set();
  const excluded = new Set(["发布空间", "已发送", "_portfolio_move_logs", ".distribution-claims"]);

  function visit(directory) {
    let real;
    try {
      real = fs.realpathSync.native(directory).toLowerCase();
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.forEach((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name) && !entry.name.startsWith(".workpkg_")) visit(full);
        return;
      }
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".txt" && path.basename(entry.name, ".txt").startsWith("文案")) {
        results.push(full);
      }
    });
  }

  visit(path.resolve(libraryRoot));
  return results;
}

function uniqueByKey(records) {
  const result = new Map();
  records.forEach((record) => {
    if (!record?.key) return;
    const previous = result.get(record.key);
    if (!previous || String(record.recordedAt || "") < String(previous.recordedAt || "")) {
      result.set(record.key, record);
    }
  });
  return [...result.values()];
}

function downloadRecords(libraryRoot, downloadRoot) {
  const records = collectPackagedTextFiles(libraryRoot).map((file) => {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
    const textHash = hashText(text);
    return {
      key: `text-sha256:${textHash}`,
      textHash,
      path: file,
      title: text.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 120) || path.basename(path.dirname(file)),
      recordedAt: fileTime(file),
      source: "legacy-packaged-text"
    };
  }).filter(Boolean);

  const lastHashFile = path.join(downloadRoot || "", ".workpkg_last_text.sha256");
  if (fs.existsSync(lastHashFile)) {
    const textHash = fs.readFileSync(lastHashFile, "utf8").trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(textHash)) {
      records.push({
        key: `text-sha256:${textHash}`,
        textHash,
        path: lastHashFile,
        title: "旧工作包最后一次文案",
        recordedAt: fileTime(lastHashFile),
        source: "legacy-last-text-hash"
      });
    }
  }
  return uniqueByKey(records);
}

function mobileDistributionRecords(publishRoot) {
  const file = path.join(publishRoot || "", "device-usage-log.csv");
  return readCsv(file).map((row, index) => {
    const collection = row["源作品集"] || "";
    const confirmation = row["接收确认"] || "";
    const count = Number(row["文件数"] || 0);
    const used = count > 0 || /收到|入库|作品数/.test(confirmation);
    return {
      key: `mobile:${hashText(`${row["源路径"] || collection}|${row["时间"] || index}|${row["设备名"] || ""}`)}`,
      collection,
      sourcePath: row["源路径"] || "",
      device: row["设备名"] || "",
      group: "mobile",
      status: used ? "已使用" : "待核对",
      used,
      recordedAt: row["时间"] || fileTime(file),
      source: "device-usage-log.csv"
    };
  });
}

function officialDistributionRecords(publishRoot) {
  const file = path.join(publishRoot || "", "official-account-usage-log.csv");
  return readCsv(file).map((row, index) => {
    const status = row["状态"] || "";
    const collection = row["作品集"] || "";
    return {
      key: `official:${hashText(`${row["源路径"] || collection}|${row["时间"] || index}|${status}`)}`,
      collection,
      sourcePath: row["源路径"] || "",
      device: row["承载设备"] || "",
      group: "official",
      status,
      used: /已使用|上传已完成/.test(status),
      opened: /领取|打开/.test(status),
      recordedAt: row["时间"] || fileTime(file),
      source: "official-account-usage-log.csv"
    };
  });
}

function archiveRecords(libraryRoot) {
  const file = path.join(libraryRoot || "", "已发送", "cleanup-log.csv");
  return readCsv(file).map((row, index) => {
    const sha256 = String(row["ZIP SHA-256"] || "").trim().toLowerCase();
    const archivePath = row["已发送ZIP"] || "";
    return {
      key: sha256 ? `archive-sha256:${sha256}` : `archive:${hashText(`${archivePath}|${row["时间"] || index}`)}`,
      collection: row["作品集"] || "",
      sha256,
      path: archivePath,
      recordedAt: row["时间"] || fileTime(file),
      source: "cleanup-log.csv"
    };
  });
}

function ledgerStatus(ledger) {
  const mobileUsed = new Set(
    (ledger.distributions || []).filter((item) => item.group === "mobile" && item.used).map((item) => item.collection)
  );
  const officialUsed = new Set(
    (ledger.distributions || []).filter((item) => item.group === "official" && item.used).map((item) => item.collection)
  );
  return {
    downloaded: (ledger.downloads || []).length,
    mobileUsed: mobileUsed.size,
    officialUsed: officialUsed.size,
    archived: (ledger.archives || []).length,
    sources: (ledger.imports || []).length,
    updatedAt: ledger.updatedAt || ""
  };
}

function syncDedupLedger({ ledgerFile, libraryRoot, downloadRoot, publishRoot }) {
  const existing = readJson(ledgerFile, { downloads: [], distributions: [], archives: [] });
  const preservedDownloads = (existing.downloads || []).filter((item) => item.source === "software");
  const preservedDistributions = (existing.distributions || []).filter((item) => item.source === "software");
  const downloads = uniqueByKey([...preservedDownloads, ...downloadRecords(libraryRoot, downloadRoot)]);
  const distributions = uniqueByKey([
    ...preservedDistributions,
    ...mobileDistributionRecords(publishRoot),
    ...officialDistributionRecords(publishRoot)
  ]);
  const archives = uniqueByKey(archiveRecords(libraryRoot));
  const now = new Date().toISOString();
  const imports = [
    { type: "packaged-text", path: libraryRoot, count: downloads.filter((item) => item.source !== "software").length },
    { type: "mobile-distribution", path: path.join(publishRoot, "device-usage-log.csv"), count: distributions.filter((item) => item.group === "mobile" && item.source !== "software").length },
    { type: "official-distribution", path: path.join(publishRoot, "official-account-usage-log.csv"), count: distributions.filter((item) => item.group === "official" && item.source !== "software").length },
    { type: "sent-archives", path: path.join(libraryRoot, "已发送", "cleanup-log.csv"), count: archives.length }
  ].map((item) => ({ ...item, syncedAt: now }));
  const ledger = {
    version: LEDGER_VERSION,
    updatedAt: now,
    localOnly: true,
    downloads,
    distributions,
    archives,
    imports
  };
  ledger.status = ledgerStatus(ledger);
  writeJsonAtomic(ledgerFile, ledger);
  return ledger;
}

function isDownloadedText(ledger, text) {
  const textHash = hashText(text);
  const record = (ledger?.downloads || []).find((item) => item.textHash === textHash);
  return { duplicate: Boolean(record), textHash, record: record || null };
}

function registerDownloadedText(ledgerFile, text, metadata = {}) {
  const ledger = readJson(ledgerFile, {
    version: LEDGER_VERSION,
    downloads: [],
    distributions: [],
    archives: [],
    imports: []
  });
  const duplicate = isDownloadedText(ledger, text);
  if (duplicate.duplicate) return { ...duplicate, ledger };
  ledger.downloads = uniqueByKey([...(ledger.downloads || []), {
    key: `text-sha256:${duplicate.textHash}`,
    textHash: duplicate.textHash,
    title: String(metadata.title || "").slice(0, 120),
    path: String(metadata.path || ""),
    conversationUrl: String(metadata.conversationUrl || ""),
    recordedAt: new Date().toISOString(),
    source: "software"
  }]);
  ledger.updatedAt = new Date().toISOString();
  ledger.status = ledgerStatus(ledger);
  writeJsonAtomic(ledgerFile, ledger);
  return { duplicate: false, textHash: duplicate.textHash, ledger };
}

module.exports = {
  collectPackagedTextFiles,
  hashText,
  isDownloadedText,
  ledgerStatus,
  parseCsv,
  productionHistoryStatus,
  registerDownloadedText,
  syncDedupLedger
};
