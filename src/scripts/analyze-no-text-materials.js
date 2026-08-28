"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { analyzeCollectionCandidates } = require("../lib/material-collection-keywords");

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const TEXT_EXTS = new Set([".txt", ".md"]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || "");
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !String(next).startsWith("--")) {
      args[key] = String(next);
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function safeEntries(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function scanImageOnlyFolders(rootPath, options = {}) {
  const root = path.resolve(rootPath);
  const maxDirectories = Number(options.maxDirectories || 10000);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`素材根目录不存在或不是文件夹：${root}`);
  }
  const queue = [{ directory: root, depth: 0 }];
  const candidates = [];
  let visited = 0;
  while (queue.length && visited < maxDirectories) {
    const current = queue.shift();
    visited += 1;
    const entries = safeEntries(current.directory);
    const files = entries.filter((entry) => entry.isFile());
    const directories = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
    const imageCount = files.filter((entry) => IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())).length;
    const textCount = files.filter((entry) => TEXT_EXTS.has(path.extname(entry.name).toLowerCase())).length;
    const relativePath = path.relative(root, current.directory);
    if (relativePath && imageCount > 0 && textCount === 0) {
      candidates.push({
        name: path.basename(current.directory),
        path: current.directory,
        relativePath,
        bucket: relativePath.split(path.sep).filter(Boolean)[0] || "",
        imageCount,
        textCount
      });
      continue;
    }
    directories.forEach((entry) => queue.push({
      directory: path.join(current.directory, entry.name),
      depth: current.depth + 1
    }));
  }
  return { root, visited, candidates };
}

function markdownReport(report) {
  const summary = report.summary;
  const lines = [
    `# 无 TXT 素材采集候选分析`,
    ``,
    `- 生成时间：${report.generatedAt}`,
    `- 扫描根目录：\`${report.sourceRoot}\``,
    `- 判定边界：有图片且无 TXT/MD；仅做标题采集分析，不代表可直接生产。`,
    `- 安全边界：本次只读扫描，没有移动、删除、重命名或写入素材目录。`,
    ``,
    `## 汇总`,
    ``,
    `- 候选文件夹：${summary.candidateCount}`,
    `- 识别到地点：${summary.recognizedLocationCount}`,
    `- 待人工判断地点：${summary.unclassifiedCount}`,
    `- 图片总数：${summary.imageCount}`,
    ``,
    `## 地点分布`,
    ``,
    ...(report.collection.locations.length ? report.collection.locations.map((item) => `- ${item.value}：${item.count}`) : [`- 暂未识别到标准地点`]),
    ``,
    `## 推荐采集关键词`,
    ``,
    ...(report.collection.queries.length ? report.collection.queries.map((item) => `- ${item.query}（${item.count} 个标题命中）`) : [`- 暂无可生成关键词`]),
    ``,
    `## 标题样本（前 200 条）`,
    ``,
    `| # | 标题 | 图片 | 关键词 | 建议采集词 |`,
    `|---:|---|---:|---|---|`,
    ...report.collection.candidates.slice(0, 200).map((item, index) => `| ${index + 1} | ${item.name.replace(/\|/g, "\\|")} | ${item.imageCount} | ${(item.keywords.all || []).join("、") || "待人工判断"} | ${(item.suggestedQueries || []).slice(0, 3).join("、") || "-"} |`),
    ``,
    `完整候选明细见同名 JSON 文件。`
  ];
  return lines.join("\n");
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = String(args.root || "").trim();
  if (!root) throw new Error("用法：node scripts/analyze-no-text-materials.js --root <素材目录> [--output <报告.json>]");
  const scan = scanImageOnlyFolders(root);
  const collection = analyzeCollectionCandidates(scan.candidates, { maxCandidates: 10000 });
  const imageCount = scan.candidates.reduce((total, item) => total + item.imageCount, 0);
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceRoot: scan.root,
    visitedDirectories: scan.visited,
    readOnly: true,
    criteria: "有图片且无 TXT/MD；标题仅用于生成采集候选，不进入生产队列",
    summary: {
      candidateCount: collection.candidateCount,
      recognizedLocationCount: collection.recognizedLocationCount,
      unclassifiedCount: collection.unclassifiedCount,
      imageCount
    },
    collection
  };
  const output = String(args.output || "").trim();
  if (output) {
    const jsonPath = path.resolve(output.toLowerCase().endsWith(".json") ? output : `${output}.json`);
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const markdownPath = jsonPath.replace(/\.json$/i, ".md");
    fs.writeFileSync(markdownPath, `${markdownReport(report)}\n`, "utf8");
    return { ...report, output: { json: jsonPath, markdown: markdownPath } };
  }
  return report;
}

if (require.main === module) {
  try {
    const report = run();
    if (report.output) {
      console.log(JSON.stringify({ ok: true, summary: report.summary, output: report.output }, null, 2));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  markdownReport,
  parseArgs,
  run,
  scanImageOnlyFolders
};
