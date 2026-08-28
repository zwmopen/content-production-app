const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

// Windows 上 tar.exe 不一定在 PATH 中（Electron 环境 PATH 可能缺失 System32），需解析完整路径
let _tarExe = null;
function tarExe() {
  if (_tarExe) return _tarExe;
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const candidates = [
    path.join(systemRoot, "System32", "tar.exe"),
    "tar.exe",
  ];
  for (const candidate of candidates) {
    try {
      const result = childProcess.spawnSync(candidate, ["--version"], {
        windowsHide: true,
        timeout: 5000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      if (result.status === 0 && /bsdtar|tar/i.test(result.stdout || result.stderr || "")) {
        _tarExe = candidate;
        return candidate;
      }
    } catch {
      // 继续尝试下一个候选
    }
  }
  _tarExe = "tar.exe";
  return _tarExe;
}

const PLATFORM_DIRS = {
  xhs: "小红书",
  douyin: "抖音",
  officialAccount: "公众号",
  used: "已使用",
  douyinArchive: path.join("归档", "抖音")
};

const WORKFLOW_STAGE_DIRS = {
  mobile: "抖音小红书",
  official: "微信公众号",
  used: "已发送"
};

function getWorkflowStageRoots(libraryRoot) {
  const resolvedLibraryRoot = path.resolve(libraryRoot || "");
  const stageDirectoryNames = new Set(Object.values(WORKFLOW_STAGE_DIRS));
  const workflowRoot = stageDirectoryNames.has(path.basename(resolvedLibraryRoot))
    ? path.dirname(resolvedLibraryRoot)
    : resolvedLibraryRoot;
  return {
    workflowRoot,
    mobile: path.join(workflowRoot, WORKFLOW_STAGE_DIRS.mobile),
    official: path.join(workflowRoot, WORKFLOW_STAGE_DIRS.official),
    used: path.join(workflowRoot, WORKFLOW_STAGE_DIRS.used)
  };
}

function classifyCollectionName(name) {
  const value = String(name || "");
  const hidden = value.startsWith(".");
  if (/\[泛\]$/.test(value)) {
    return { type: "traffic", typeLabel: "泛流量", hidden, labelled: true };
  }
  if (/\[转\]$/.test(value)) {
    return { type: "conversion", typeLabel: "精准流量", hidden, labelled: true };
  }
  return { type: "unclassified", typeLabel: "未分类", hidden, labelled: false };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] || ""])
  ));
}

function readCsv(filePath) {
  try {
    return parseCsv(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

function listDirectoryNames(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function listArchiveNames(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.zip$/i.test(entry.name))
      .map((entry) => entry.name.replace(/\.zip$/i, ""));
  } catch {
    return [];
  }
}

function normalizeRealPath(value) {
  return path.resolve(String(value || "")).toLowerCase();
}

function inspectSource(sourcePath, cache) {
  if (!sourcePath) return { valid: false, itemCount: 0, fileCount: 0, bytes: 0, items: [] };
  const key = normalizeRealPath(sourcePath);
  if (cache.has(key)) return cache.get(key);
  const result = { valid: false, itemCount: 0, fileCount: 0, bytes: 0, items: [] };
  try {
    const stat = fs.statSync(sourcePath);
    if (!stat.isDirectory()) {
      cache.set(key, result);
      return result;
    }
    const children = fs.readdirSync(sourcePath, { withFileTypes: true });
    const itemDirectories = children.filter((entry) => (
      entry.isDirectory() || entry.isSymbolicLink()
    ));
    const inspectedItems = itemDirectories.map((entry) => {
      const itemPath = path.join(sourcePath, entry.name);
      let previewPath = "";
      let imageCount = 0;
      let textPath = "";
      try {
        const files = fs.readdirSync(itemPath, { withFileTypes: true });
        const images = files.filter((file) => file.isFile() && /\.(png|jpe?g|webp)$/i.test(file.name));
        const texts = files.filter((file) => file.isFile() && /\.(txt|md)$/i.test(file.name));
        imageCount = images.length;
        previewPath = images[0] ? path.join(itemPath, images[0].name) : "";
        textPath = texts[0] ? path.join(itemPath, texts[0].name) : "";
      } catch {
        // A work folder can temporarily be unavailable while it is moved.
      }
      return { name: entry.name, path: itemPath, previewPath, textPath, imageCount };
    });
    result.itemCount = inspectedItems.filter((item) => item.imageCount > 0).length;
    result.items = inspectedItems.slice(0, 50);
    const stack = [sourcePath];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          result.fileCount += 1;
          try {
            result.bytes += fs.statSync(fullPath).size;
          } catch {
            // A file may disappear while a live folder is being scanned.
          }
        }
      }
    }
    result.valid = result.itemCount > 0;
  } catch {
    // Broken Junctions and temporarily unavailable folders remain invalid.
  }
  cache.set(key, result);
  return result;
}

function inspectPlatformEntry(publishRoot, relativeDirectory, name, sourceCache) {
  const entryPath = path.join(publishRoot, relativeDirectory, name);
  if (!fs.existsSync(entryPath)) {
    try {
      fs.lstatSync(entryPath);
    } catch {
      return { present: false, valid: false, path: entryPath, sourcePath: "" };
    }
  }
  let stat;
  try {
    stat = fs.lstatSync(entryPath);
  } catch {
    return { present: false, valid: false, path: entryPath, sourcePath: "" };
  }
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    const source = inspectSource(entryPath, sourceCache);
    return {
      present: true,
      valid: source.valid,
      path: entryPath,
      sourcePath: entryPath,
      physical: true,
      ...source,
      reason: source.valid ? "" : "作品文件夹为空或不可用"
    };
  }
  if (!stat.isSymbolicLink()) {
    return { present: true, valid: false, path: entryPath, sourcePath: "", reason: "不是作品文件夹" };
  }
  try {
    const sourcePath = fs.realpathSync.native(entryPath);
    const source = inspectSource(sourcePath, sourceCache);
    return {
      present: true,
      valid: source.valid,
      path: entryPath,
      sourcePath,
      ...source,
      reason: source.valid ? "" : "源目录为空或不可用"
    };
  } catch {
    return { present: true, valid: false, path: entryPath, sourcePath: "", reason: "Junction 已断开" };
  }
}

function latestRowsByCollection(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const name = row["作品集"] || row["源作品集"] || "";
    if (!name) return;
    const existing = grouped.get(name);
    if (!existing || String(row["时间"] || "") >= String(existing["时间"] || "")) {
      grouped.set(name, row);
    }
  });
  return grouped;
}

function officialStateFromRow(row) {
  const status = String(row?.["状态"] || "");
  if (/待.*上传|已领取/.test(status)) return "reserved_pending_upload";
  if (/已使用|已发布|上传完成/.test(status)) return "confirmed_published";
  if (/恢复|失败/.test(status)) return "available";
  return row ? "unknown" : null;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isPortfolioCollectionName(name) {
  const value = String(name || "");
  if (value.startsWith("_")) return false;
  return /^\.?作品集[_-]?\d+/i.test(value) || /\[(?:泛|转)\]$/.test(value);
}

function recordDeviceDistribution(options = {}) {
  const publishRoot = path.resolve(options.publishRoot || "");
  const collection = String(options.collection || "").trim();
  const taskId = String(options.taskId || "").trim();
  if (!collection) throw new Error("作品集名称不能为空");
  const logFile = path.join(publishRoot, "device-usage-log.csv");
  const operation = taskId ? `工作台接收确认 ${taskId}` : "工作台接收确认";
  const rows = readCsv(logFile);
  if (taskId && rows.some((row) => String(row["操作"] || "").includes(taskId))) {
    return { ok: true, duplicate: true, logFile };
  }
  fs.mkdirSync(publishRoot, { recursive: true });
  const header = "时间,设备名,设备型号,源作品集,源路径,文件数,字节数,传输协议,接收确认,操作";
  if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, `${header}\n`, "utf8");
  const fields = [
    options.now || new Date().toISOString(),
    options.device || "",
    options.deviceModel || "",
    collection,
    options.sourcePath || "",
    Number(options.fileCount || 0),
    Number(options.bytes || 0),
    options.transport || "LAN",
    options.confirmation || "接收端已提交确认",
    operation
  ];
  const existing = fs.readFileSync(logFile, "utf8");
  const prefix = existing.endsWith("\n") || existing.endsWith("\r") ? "" : "\n";
  fs.appendFileSync(logFile, `${prefix}${fields.map(csvCell).join(",")}\n`, "utf8");
  return { ok: true, duplicate: false, logFile };
}

function confirmOfficialUpload(options = {}) {
  const publishRoot = path.resolve(options.publishRoot || "");
  const collection = String(options.collection || "").trim();
  if (!collection) throw new Error("缺少作品集名称");
  const logFile = path.join(publishRoot, "official-account-usage-log.csv");
  const rows = readCsv(logFile);
  const latest = latestRowsByCollection(rows).get(collection);
  if (officialStateFromRow(latest) !== "reserved_pending_upload") {
    throw new Error("该作品集不是待上传状态");
  }
  const fields = [
    options.now || new Date().toISOString().slice(0, 19),
    latest["公众号账号"],
    latest["承载设备"],
    collection,
    latest["源路径"],
    latest["文件数"],
    latest["字节数"],
    latest["小红书抖音连接剩余数"],
    "公众号已使用",
    "人工确认电脑上传完成"
  ];
  const existing = fs.readFileSync(logFile, "utf8");
  const prefix = existing.endsWith("\n") || existing.endsWith("\r") ? "" : "\n";
  fs.appendFileSync(logFile, `${prefix}${fields.map(csvCell).join(",")}\n`, "utf8");
  return {
    ok: true,
    collection,
    status: "confirmed_published"
  };
}

function archiveAndRemoveCollection(sourcePath, archiveRoot, collection) {
  const targetPath = path.join(archiveRoot, `${collection}.zip`);
  const temporaryPath = path.join(archiveRoot, `.${collection}.${Date.now()}.tmp.zip`);
  fs.mkdirSync(archiveRoot, { recursive: true });
  if (fs.existsSync(targetPath)) throw new Error("已发送文件夹已有同名压缩包，已停止归档");
  const sourceStat = fs.lstatSync(sourcePath);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error("只能归档真实作品文件夹");
  }
  try {
    childProcess.execFileSync(
      tarExe(),
      ["-a", "-c", "-f", temporaryPath, "-C", path.dirname(sourcePath), path.basename(sourcePath)],
      { windowsHide: true, stdio: "pipe" }
    );
    const archiveStat = fs.statSync(temporaryPath);
    if (!archiveStat.isFile() || archiveStat.size <= 0) throw new Error("生成的压缩包为空");
    fs.renameSync(temporaryPath, targetPath);
    fs.rmSync(sourcePath, { recursive: true, force: false });
    return targetPath;
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Keep the original folder even if temporary-file cleanup fails.
    }
    throw new Error(`压缩归档失败，原文件夹已保留：${error.message}`);
  }
}

function workflowOperationLogFile(stageRoots) {
  return path.join(stageRoots.workflowRoot, "_portfolio_move_logs", "operation-history.jsonl");
}

function appendWorkflowOperation(stageRoots, operation = {}) {
  const logFile = workflowOperationLogFile(stageRoots);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const row = { time: new Date().toISOString(), status: "completed", ...operation };
  fs.appendFileSync(logFile, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

function readWorkflowOperations(stageRoots) {
  const logFile = workflowOperationLogFile(stageRoots);
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    })
    .slice(-200)
    .reverse();
}

function moveCollectionSourceToStage(options = {}) {
  const publishRoot = path.resolve(options.publishRoot || "");
  const libraryRoot = path.resolve(options.libraryRoot || "");
  const collection = String(options.collection || "").trim();
  const stage = options.stage === "used" ? "used" : "official";
  if (!collection || path.basename(collection) !== collection || /[\\/\r\n\0]/.test(collection)) {
    throw new Error("作品集名称无效");
  }
  const snapshot = getDistributionSnapshot({ publishRoot, libraryRoot });
  const item = snapshot.collections.find((entry) => entry.name === collection);
  if (!item?.sourceValid || !item.sourcePath) throw new Error("没有找到可移动的原始作品文件夹");
  const sourcePath = fs.realpathSync.native(item.sourcePath);
  const stageRoots = getWorkflowStageRoots(libraryRoot);
  const targetDirectory = stageRoots[stage];
  const targetPath = stage === "used"
    ? path.join(targetDirectory, `${collection}.zip`)
    : path.join(targetDirectory, collection);
  fs.mkdirSync(targetDirectory, { recursive: true });
  if (stage !== "used" && normalizeRealPath(sourcePath) === normalizeRealPath(targetPath)) {
    return { ok: true, collection, sourcePath, targetPath, stage };
  }
  if (fs.existsSync(targetPath)) {
    const targetReal = fs.realpathSync.native(targetPath);
    if (normalizeRealPath(targetReal) !== normalizeRealPath(sourcePath)) throw new Error("目标文件夹已有同名作品，已停止移动");
    const targetStat = fs.lstatSync(targetPath);
    if (targetStat.isSymbolicLink()) fs.unlinkSync(targetPath);
    else throw new Error("目标文件夹已经是原始作品位置");
  }
  if (!fs.existsSync(sourcePath)) throw new Error("移动前原始作品已经不存在");
  if (stage === "used") {
    archiveAndRemoveCollection(sourcePath, targetDirectory, collection);
  } else {
    fs.renameSync(sourcePath, targetPath);
  }
  appendWorkflowOperation(stageRoots, {
    action: stage === "used" ? "压缩归档并删除源文件夹" : "移动到微信公众号",
    collection,
    from: sourcePath,
    to: targetPath,
    stage
  });
  return { ok: true, collection, sourcePath, targetPath, stage };
}

function renameCollectionType(options = {}) {
  const publishRoot = path.resolve(options.publishRoot || "");
  const libraryRoot = path.resolve(options.libraryRoot || "");
  const collection = String(options.collection || "").trim();
  const type = ["traffic", "conversion", "unclassified"].includes(options.type) ? options.type : "";
  if (!type) throw new Error("只能归为泛流量帖、精准流量帖或未分类");
  if (!collection || path.basename(collection) !== collection || /[\\/\r\n\0]/.test(collection)) {
    throw new Error("作品集名称无效");
  }
  const snapshot = getDistributionSnapshot({ publishRoot, libraryRoot });
  const item = snapshot.collections.find((entry) => entry.name === collection);
  if (!item?.sourcePath || !["mobile", "official"].includes(item.workflowStage)) {
    throw new Error("只能修改抖音小红书或微信公众号里的真实作品集");
  }
  const stageRoots = getWorkflowStageRoots(libraryRoot);
  const sourcePath = fs.realpathSync.native(item.sourcePath);
  const sourceStat = fs.lstatSync(sourcePath);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error("只能修改真实作品文件夹");
  const cleanName = collection.replace(/\[(?:泛|转)\]/g, "");
  const targetName = `${cleanName}${type === "conversion" ? "[转]" : type === "traffic" ? "[泛]" : ""}`;
  if (targetName === collection) return { ok: true, collection, targetName, sourcePath, targetPath: sourcePath };
  const targetPath = path.join(path.dirname(sourcePath), targetName);
  if (fs.existsSync(targetPath)) throw new Error(`已存在同名作品集：${targetName}`);
  fs.renameSync(sourcePath, targetPath);
  appendWorkflowOperation(stageRoots, {
    action: "修改作品集分类",
    collection,
    targetCollection: targetName,
    from: sourcePath,
    to: targetPath,
    stage: item.workflowStage,
    type
  });
  return { ok: true, collection, targetName, sourcePath, targetPath, type, stage: item.workflowStage };
}

function reconcileWorkflowFolders(options = {}) {
  const publishRoot = path.resolve(options.publishRoot || "");
  const libraryRoot = path.resolve(options.libraryRoot || "");
  const apply = options.apply === true;
  const stageRoots = getWorkflowStageRoots(libraryRoot);
  Object.values(WORKFLOW_STAGE_DIRS).forEach((name) => {
    fs.mkdirSync(path.join(stageRoots.workflowRoot, name), { recursive: true });
  });
  const officialRows = readCsv(path.join(publishRoot, "official-account-usage-log.csv"));
  const deviceRows = readCsv(path.join(publishRoot, "device-usage-log.csv"));
  const latestOfficial = latestRowsByCollection(officialRows);
  const deviceCollections = new Set(deviceRows.map((row) => row["源作品集"]).filter(Boolean));
  const actions = [];
  const archivedCollections = new Set(listArchiveNames(stageRoots.used));

  archivedCollections.forEach((collection) => {
    const archivePath = path.join(stageRoots.used, `${collection}.zip`);
    let archiveValid = false;
    try {
      archiveValid = fs.statSync(archivePath).size > 0;
    } catch {
      archiveValid = false;
    }
    if (!archiveValid) return;
    [
      path.join(stageRoots.workflowRoot, collection),
      path.join(stageRoots.mobile, collection),
      path.join(stageRoots.official, collection),
      path.join(stageRoots.used, collection)
    ].forEach((sourcePath) => {
      let sourceStat;
      try {
        sourceStat = fs.lstatSync(sourcePath);
      } catch {
        return;
      }
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) return;
      const action = {
        collection,
        stage: "used",
        sourcePath,
        targetPath: archivePath,
        status: apply ? "removed-after-verified-archive" : "planned-archive-cleanup"
      };
      if (apply) {
        fs.rmSync(sourcePath, { recursive: true, force: false });
      }
      actions.push(action);
    });
  });

  listDirectoryNames(stageRoots.workflowRoot)
    .filter((name) => /^\.?作品集[_-]?\d+/i.test(name))
    .filter((name) => !archivedCollections.has(name))
    .forEach((collection) => {
      const sourcePath = path.join(stageRoots.workflowRoot, collection);
      let sourceStat;
      try {
        sourceStat = fs.lstatSync(sourcePath);
      } catch {
        return;
      }
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) return;
      const officialState = officialStateFromRow(latestOfficial.get(collection));
      const stage = officialState === "confirmed_published"
        ? "used"
        : officialState === "reserved_pending_upload" || deviceCollections.has(collection)
          ? "official"
          : "mobile";
      const targetPath = stage === "used"
        ? path.join(stageRoots.used, `${collection}.zip`)
        : path.join(stageRoots[stage], collection);
      if (fs.existsSync(targetPath)) {
        actions.push({ collection, stage, sourcePath, targetPath, status: "conflict" });
        return;
      }
      const action = { collection, stage, sourcePath, targetPath, status: apply ? "moved" : "planned" };
      if (apply) {
        if (stage === "used") archiveAndRemoveCollection(sourcePath, stageRoots.used, collection);
        else fs.renameSync(sourcePath, targetPath);
      }
      actions.push(action);
    });

  if (apply && actions.some((action) => action.status === "moved")) {
    const logRoot = path.join(stageRoots.workflowRoot, "_portfolio_move_logs");
    fs.mkdirSync(logRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      path.join(logRoot, `workflow-stage-migration-${stamp}.json`),
      JSON.stringify({ createdAt: new Date().toISOString(), stageRoots, actions }, null, 2),
      "utf8"
    );
  }
  return {
    ok: !actions.some((action) => action.status === "conflict"),
    applied: apply,
    stageRoots: {
      mobile: stageRoots.mobile,
      official: stageRoots.official,
      used: stageRoots.used
    },
    summary: {
      total: actions.length,
      mobile: actions.filter((action) => action.stage === "mobile").length,
      official: actions.filter((action) => action.stage === "official").length,
      used: actions.filter((action) => action.stage === "used").length,
      conflicts: actions.filter((action) => action.status === "conflict").length
    },
    actions
  };
}

function markOfficialUsed(options = {}) {
  const publishRoot = path.resolve(options.publishRoot || "");
  const libraryRoot = path.resolve(options.libraryRoot || "");
  const collection = String(options.collection || "").trim();
  const snapshot = getDistributionSnapshot({ publishRoot, libraryRoot });
  const item = snapshot.collections.find((entry) => entry.name === collection);
  if (!item || item.workflowStage !== "official") throw new Error("该作品当前不在微信公众号文件夹");
  const moved = moveCollectionSourceToStage({ publishRoot, libraryRoot, collection, stage: "used" });
  const logFile = path.join(publishRoot, "official-account-usage-log.csv");
  const rows = readCsv(logFile);
  const latest = latestRowsByCollection(rows).get(collection) || {};
  const header = "时间,公众号账号,承载设备,作品集,源路径,文件数,字节数,小红书抖音连接剩余数,状态,操作";
  if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, `${header}\n`, "utf8");
  const fields = [
    options.now || new Date().toISOString().slice(0, 19),
    latest["公众号账号"] || "江湖有旅人团建策划师",
    latest["承载设备"] || "",
    collection,
    moved.targetPath,
    item.fileCount || 0,
    item.bytes || 0,
    0,
    "公众号已使用",
    "工作台标记并移动到已发送"
  ];
  const existing = fs.readFileSync(logFile, "utf8");
  const prefix = existing.endsWith("\n") || existing.endsWith("\r") ? "" : "\n";
  fs.appendFileSync(logFile, `${prefix}${fields.map(csvCell).join(",")}\n`, "utf8");
  return { ...moved, status: "confirmed_published" };
}

function stateForPlatform(entry, absentState = "used") {
  if (!entry.present) return absentState;
  return entry.valid ? "available" : "invalid";
}

function getDistributionSnapshot(options = {}) {
  const publishRoot = path.resolve(options.publishRoot || "");
  const libraryRoot = path.resolve(options.libraryRoot || "");
  const additionalRootEntries = [];
  const seenAdditionalRoots = new Set();
  (Array.isArray(options.additionalRoots) ? options.additionalRoots : []).forEach((entry) => {
    const rawRoot = typeof entry === "string" ? entry : entry?.root;
    const root = path.resolve(String(rawRoot || "").trim());
    if (!root || root === libraryRoot || seenAdditionalRoots.has(root.toLowerCase())) return;
    const category = typeof entry === "string"
      ? ""
      : ["traffic", "conversion"].includes(entry?.category) ? entry.category : "";
    seenAdditionalRoots.add(root.toLowerCase());
    additionalRootEntries.push({ root, category });
  });
  const additionalRoots = additionalRootEntries.map((entry) => entry.root);
  const stageRoots = getWorkflowStageRoots(libraryRoot);
  const sourceCache = new Map();
  const officialRows = readCsv(path.join(publishRoot, "official-account-usage-log.csv"));
  const deviceRows = readCsv(path.join(publishRoot, "device-usage-log.csv"));
  const latestOfficial = latestRowsByCollection(officialRows);
  const names = new Set();
  const addCollectionName = (name) => {
    if (isPortfolioCollectionName(name)) names.add(name);
  };

  Object.values(PLATFORM_DIRS).forEach((relativeDirectory) => {
    listDirectoryNames(path.join(publishRoot, relativeDirectory)).forEach(addCollectionName);
  });
  Object.values(WORKFLOW_STAGE_DIRS).forEach((relativeDirectory) => {
    listDirectoryNames(path.join(stageRoots.workflowRoot, relativeDirectory)).forEach(addCollectionName);
  });
  listArchiveNames(stageRoots.used).forEach(addCollectionName);
  listDirectoryNames(libraryRoot)
    .forEach(addCollectionName);
  additionalRootEntries.forEach(({ root }) => listDirectoryNames(root).forEach(addCollectionName));
  officialRows.forEach((row) => addCollectionName(row["作品集"]));
  deviceRows.forEach((row) => addCollectionName(row["源作品集"]));
  names.delete("");

  const collections = [...names].map((name) => {
    const classification = classifyCollectionName(name);
    const entries = {
      xhs: inspectPlatformEntry(publishRoot, PLATFORM_DIRS.xhs, name, sourceCache),
      douyin: inspectPlatformEntry(publishRoot, PLATFORM_DIRS.douyin, name, sourceCache),
      officialAccount: inspectPlatformEntry(publishRoot, PLATFORM_DIRS.officialAccount, name, sourceCache),
      used: inspectPlatformEntry(publishRoot, PLATFORM_DIRS.used, name, sourceCache),
      douyinArchive: inspectPlatformEntry(publishRoot, PLATFORM_DIRS.douyinArchive, name, sourceCache)
    };
    const workflowEntries = {
      mobile: inspectPlatformEntry(stageRoots.workflowRoot, WORKFLOW_STAGE_DIRS.mobile, name, sourceCache),
      official: inspectPlatformEntry(stageRoots.workflowRoot, WORKFLOW_STAGE_DIRS.official, name, sourceCache),
      used: inspectPlatformEntry(stageRoots.workflowRoot, WORKFLOW_STAGE_DIRS.used, name, sourceCache)
    };
    const usedArchivePath = path.join(stageRoots.used, `${name}.zip`);
    const usedArchivePresent = (() => {
      try {
        const stat = fs.statSync(usedArchivePath);
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    })();
    const activeSources = [
      workflowEntries.mobile,
      workflowEntries.official,
      workflowEntries.used,
      entries.xhs,
      entries.douyin,
      entries.officialAccount,
      entries.used,
      entries.douyinArchive
    ]
      .filter((entry) => entry.valid && entry.sourcePath);
    const recordedSourcePath = latestOfficial.get(name)?.["源路径"] || deviceRows
      .filter((row) => row["源作品集"] === name)
      .at(-1)?.["源路径"] || "";
    const recordedSource = inspectSource(recordedSourcePath, sourceCache);
    const directSourcePath = path.join(libraryRoot, name);
    const directSource = inspectSource(directSourcePath, sourceCache);
    const additionalSources = additionalRootEntries
      .map(({ root, category }) => {
        const sourcePath = path.join(root, name);
        const source = inspectSource(sourcePath, sourceCache);
        return source.valid ? { sourcePath, sendRootCategory: category, ...source } : null;
      })
      .filter(Boolean);
    activeSources.push(...additionalSources);
    const externalSource = additionalSources.length > 0;
    const externalCategoryAllowed = additionalSources.length === 0
      || additionalSources.some((entry) => !entry.sendRootCategory || entry.sendRootCategory === classification.type);
    const presentWorkflowSource = Object.values(workflowEntries)
      .find((entry) => entry.present && entry.sourcePath);
    const source = activeSources[0]
      || presentWorkflowSource
      || (directSource.valid ? { sourcePath: directSourcePath, ...directSource } : null)
      || additionalSources[0]
      || (recordedSource.valid ? { sourcePath: recordedSourcePath, ...recordedSource } : {});
    const sameDualTarget = entries.xhs.valid
      && entries.douyin.valid
      && normalizeRealPath(entries.xhs.sourcePath) === normalizeRealPath(entries.douyin.sourcePath);
    const officialHistory = officialRows.filter((row) => row["作品集"] === name);
    const deviceHistory = deviceRows.filter((row) => row["源作品集"] === name);
    const previouslySentToDevice = deviceHistory.length > 0;
    const officialLogState = officialStateFromRow(latestOfficial.get(name));
    const exclusionReasons = [];
    if (!classification.labelled) exclusionReasons.push("缺少[泛]/[转]标签");
    if (externalSource && !externalCategoryAllowed) exclusionReasons.push("发送目录分类不匹配");
    if (!source.valid) exclusionReasons.push("没有可用源目录");
    const occupiedWorkflowStages = Object.values(workflowEntries).filter((entry) => entry.present).length
      + (usedArchivePresent ? 1 : 0);
    if (occupiedWorkflowStages > 1) exclusionReasons.push("三个阶段文件夹存在同名作品冲突");
    if (entries.xhs.valid && entries.douyin.valid && !sameDualTarget) exclusionReasons.push("小红书与抖音目标不一致");
    [entries.xhs, entries.douyin, entries.officialAccount, entries.used, entries.douyinArchive].forEach((entry) => {
      if (entry.present && !entry.valid && entry.reason && !exclusionReasons.includes(entry.reason)) {
        exclusionReasons.push(entry.reason);
      }
    });

    let officialAccount = workflowEntries.official.valid
      ? "available"
      : stateForPlatform(entries.officialAccount);
    if (!entries.officialAccount.present && officialLogState) officialAccount = officialLogState;
    const douyin = entries.douyinArchive.present
      ? (entries.douyinArchive.valid ? "archived" : "invalid")
      : stateForPlatform(entries.douyin);
    const sourceValid = Boolean(source.valid);
    if (previouslySentToDevice) exclusionReasons.push("已有手机分发记录");
    const workflowStage = usedArchivePresent || workflowEntries.used.present
      ? "used"
      : workflowEntries.official.present
        ? "official"
        : workflowEntries.mobile.present
          ? "mobile"
          : sameDualTarget && entries.xhs.valid && entries.douyin.valid
            ? "mobile"
            : (entries.officialAccount.valid || officialLogState === "reserved_pending_upload")
              ? "official"
              : (entries.used.valid || officialLogState === "confirmed_published" || previouslySentToDevice)
                ? "used"
                : "mobile";
    const automaticEligible = classification.labelled
      && externalCategoryAllowed
      && !previouslySentToDevice
      && occupiedWorkflowStages <= 1
      && workflowStage === "mobile"
      && Boolean(activeSources.length);
    const manualEligible = classification.labelled
      && externalCategoryAllowed
      && !previouslySentToDevice
      && occupiedWorkflowStages <= 1
      && workflowStage === "mobile"
      && sourceValid;

    return {
      name,
      ...classification,
      sourcePath: source.sourcePath || recordedSourcePath,
      sourceValid,
      itemCount: source.itemCount || 0,
      fileCount: source.fileCount || 0,
      bytes: source.bytes || 0,
      items: source.items || [],
      xhs: previouslySentToDevice ? "used" : workflowEntries.mobile.valid ? "available" : stateForPlatform(entries.xhs),
      douyin: previouslySentToDevice ? "used" : workflowEntries.mobile.valid ? "available" : douyin,
      officialAccount,
      workflowStage,
      // A configured default-send root is an explicit source of ready-to-send
      // collections; it does not need platform junctions to be eligible.
      dualPlatformEligible: automaticEligible && (externalSource || workflowEntries.mobile.valid || sameDualTarget),
      manualEligible,
      automaticEligible,
      exclusionReasons,
      deviceHistoryCount: deviceHistory.length,
      officialAccountHistoryCount: officialHistory.length,
      latestDeviceRecord: deviceHistory.at(-1) || null,
      latestOfficialAccountRecord: latestOfficial.get(name) || null,
      archivePath: usedArchivePresent ? usedArchivePath : ""
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  const eligible = collections.filter((item) => item.automaticEligible);
  const summary = {
    total: collections.length,
    automaticEligible: eligible.length,
    dualPlatformAvailable: collections.filter((item) => item.dualPlatformEligible).length,
    traffic: collections.filter((item) => item.dualPlatformEligible && item.type === "traffic").length,
    conversion: collections.filter((item) => item.dualPlatformEligible && item.type === "conversion").length,
    unclassified: collections.filter((item) => item.type === "unclassified").length,
    douyinArchived: collections.filter((item) => {
      const entryPath = path.join(publishRoot, PLATFORM_DIRS.douyinArchive, item.name);
      try {
        return fs.lstatSync(entryPath).isSymbolicLink();
      } catch {
        return false;
      }
    }).length,
    douyinArchiveInvalid: collections.filter((item) => {
      const entryPath = path.join(publishRoot, PLATFORM_DIRS.douyinArchive, item.name);
      try {
        return fs.lstatSync(entryPath).isSymbolicLink() && item.douyin === "invalid";
      } catch {
        return false;
      }
    }).length,
    officialAvailable: collections.filter((item) => item.officialAccount === "available" && item.automaticEligible).length,
    officialPending: collections.filter((item) => item.officialAccount === "reserved_pending_upload").length,
    officialConfirmed: collections.filter((item) => item.officialAccount === "confirmed_published").length
  };

  return {
    publishRoot,
    libraryRoot,
    additionalRoots,
    workflowRoot: stageRoots.workflowRoot,
    stageRoots: {
      mobile: stageRoots.mobile,
      official: stageRoots.official,
      used: stageRoots.used
    },
    generatedAt: new Date().toISOString(),
    summary,
    collections,
    deviceHistory: deviceRows.slice().reverse(),
    officialAccountHistory: officialRows.slice().reverse(),
    operationHistory: readWorkflowOperations(stageRoots)
  };
}

module.exports = {
  appendWorkflowOperation,
  classifyCollectionName,
  confirmOfficialUpload,
  getWorkflowStageRoots,
  getDistributionSnapshot,
  markOfficialUsed,
  moveCollectionSourceToStage,
  recordDeviceDistribution,
  renameCollectionType,
  parseCsv,
  readWorkflowOperations,
  reconcileWorkflowFolders
};
