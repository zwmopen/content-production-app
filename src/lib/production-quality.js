const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { parsePlatformCopy, validatePlatformCopy } = require("../integrations/gpt-production-extension/gpt-automation-core");

const RISKY_COPY_PHRASES = [
  "私信",
  "加微信",
  "评论区领取",
  "免费定制",
  "领取方案",
  "咨询报价",
  "预约下单",
  "一站式",
  "全包",
  "全国可接"
];

function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function inputImageHashes(plan) {
  const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif"]);
  const sources = [plan?.templatePath, plan?.materialPath].filter(Boolean);
  const hashes = new Map();
  for (const source of sources) {
    if (!fs.existsSync(source)) continue;
    const stack = [source];
    let checked = 0;
    while (stack.length && checked < 80) {
      const current = stack.pop();
      const stats = fs.statSync(current);
      if (stats.isDirectory()) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) continue;
          stack.push(path.join(current, entry.name));
        }
        continue;
      }
      if (!imageExtensions.has(path.extname(current).toLowerCase())) continue;
      hashes.set(fileHash(current), current);
      checked += 1;
    }
  }
  return hashes;
}

async function inspectProductionQuality({ plan, outputRoot, results = [], startedAt = "", finishedAt = "" }) {
  const failures = [];
  const warnings = [];
  const passed = [];
  const imageReports = [];
  const expectedPages = Array.isArray(plan?.pages) ? plan.pages : [];
  const workResults = results.filter((item) => item.work === plan.materialName);
  const imageResultMap = new Map();
  for (const item of workResults.filter((entry) => entry.type === "image")) {
    if (item.page) imageResultMap.set(item.page, item);
  }
  const imageResults = [...imageResultMap.values()];
  const copyResult = workResults.filter((item) => item.type === "copy").at(-1);
  const seenHashes = new Map();
  const sourceHashes = inputImageHashes(plan);

  for (const page of expectedPages) {
    const result = imageResults.find((item) => item.page === page.code);
    if (!result?.outputFile || !fs.existsSync(result.outputFile)) {
      failures.push(`${page.code} ${page.title} 缺少成品图片`);
      imageReports.push({ page: page.code, title: page.title, status: "missing" });
      continue;
    }
    try {
      const stats = fs.statSync(result.outputFile);
      const metadata = await sharp(result.outputFile).metadata();
      const width = Number(metadata.width || 0);
      const height = Number(metadata.height || 0);
      const ratio = width && height ? width / height : 0;
      const hash = fileHash(result.outputFile);
      const duplicatePage = seenHashes.get(hash);
      if (!width || !height) failures.push(`${page.code} 无法读取图片尺寸`);
      else if (Math.abs(ratio - 0.75) > 0.012) failures.push(`${page.code} 不是 3:4 成品比例`);
      else passed.push(`${page.code} 图片可读且为 3:4`);
      if (width < 1080 || height < 1440) warnings.push(`${page.code} 分辨率偏低（${width}×${height}）`);
      if (stats.size < 80 * 1024) warnings.push(`${page.code} 文件体积异常偏小`);
      if (duplicatePage) failures.push(`${page.code} 与 ${duplicatePage} 图片内容完全重复`);
      else seenHashes.set(hash, page.code);
      if (sourceHashes.has(hash)) {
        failures.push(`${page.code} 与输入母版或素材原图完全相同，不是独立 AI 成品`);
      } else if (sourceHashes.size) {
        passed.push(`${page.code} 与输入原图文件指纹不同`);
      }
      imageReports.push({
        page: page.code,
        title: page.title,
        status: "readable",
        width,
        height,
        bytes: stats.size,
        hash: hash.slice(0, 16)
      });
    } catch (error) {
      failures.push(`${page.code} 图片损坏或无法读取`);
      imageReports.push({
        page: page.code,
        title: page.title,
        status: "unreadable",
        detail: String(error?.message || error).slice(0, 180)
      });
    }
  }

  if (imageResults.length !== expectedPages.length) {
    failures.push(`计划 ${expectedPages.length} 张，实际检测到 ${imageResults.length} 张`);
  } else {
    passed.push(`图片数量与计划一致（${expectedPages.length} 张）`);
  }

  const copyCandidates = [
    copyResult?.outputFile,
    path.join(outputRoot, "文案.txt"),
    path.join(outputRoot, "小红书文案.txt")
  ].filter(Boolean);
  const copyFile = copyCandidates.find((candidate) => fs.existsSync(candidate)) || copyCandidates[0] || path.join(outputRoot, "文案.txt");
  let copyCharacters = 0;
  let riskyPhrases = [];
  let copyFormatVersion = 0;
  let platformHashtags = { xhs: 0, douyin: 0 };
  if (!fs.existsSync(copyFile)) {
    failures.push("缺少文案 TXT");
  } else {
    const copy = fs.readFileSync(copyFile, "utf8").trim();
    copyCharacters = copy.length;
    const parsedCopy = parsePlatformCopy(copy);
    copyFormatVersion = parsedCopy.formatVersion;
    if (parsedCopy.formatVersion === 2) {
      const validation = validatePlatformCopy(copy, { minimumSectionLength: 80 });
      platformHashtags = { xhs: validation.xhsHashtags, douyin: validation.douyinHashtags };
      if (!validation.valid) failures.push(`双平台文案 TXT 未通过机器协议：${validation.issues.join("、")}`);
      else passed.push("双平台文案 TXT 协议、区段和话题数量通过");
      riskyPhrases = RISKY_COPY_PHRASES.filter((phrase) => `${parsedCopy.xhs}\n${parsedCopy.douyin}`.includes(phrase));
    } else {
      riskyPhrases = RISKY_COPY_PHRASES.filter((phrase) => copy.includes(phrase));
      if (copyCharacters < 120) warnings.push("小红书文案过短，建议人工确认信息是否完整");
      else passed.push("旧版小红书文案已生成（未升级为双平台协议）");
    }
    if (riskyPhrases.length) warnings.push(`文案含需复核表达：${riskyPhrases.join("、")}`);
  }

  const manualChecks = [
    "母版字体、色块、标题位置和拼图骨架是否一致",
    "真实景点、建筑、道路和核心空间是否未被重绘",
    "人物、静物和道具是否按规则完成去重",
    "图片中的中文是否准确、无乱码和无虚构价格",
    "整套是否像真实小红书原生轮播，而不是 AI 广告海报"
  ];
  const status = failures.length ? "needs-rework" : warnings.length ? "manual-review" : "passed";
  return {
    schema: "teambuilding-production-quality-v1",
    createdAt: new Date().toISOString(),
    startedAt,
    finishedAt,
    work: plan.materialName,
    template: plan.templateName,
    status,
    summary: {
      expectedImages: expectedPages.length,
      actualImages: imageResults.length,
      passedChecks: passed.length,
      warnings: warnings.length,
      failures: failures.length,
      copyCharacters,
      durationMs: startedAt && finishedAt
        ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
        : 0,
      copyFormatVersion,
      platformHashtags
    },
    passed: unique(passed),
    warnings: unique(warnings),
    failures: unique(failures),
    riskyPhrases,
    images: imageReports,
    manualChecks
  };
}

function qualityReportText(report) {
  const statusLabel = {
    passed: "自动检查通过",
    "manual-review": "自动检查通过，仍需人工看图",
    "needs-rework": "存在缺页或文件问题，需要返工"
  }[report.status] || report.status;
  const lines = [
    `生产质量报告｜${report.work}`,
    `状态：${statusLabel}`,
    `图片：${report.summary.actualImages}/${report.summary.expectedImages}`,
    `耗时：${Math.round((report.summary.durationMs || 0) / 1000)} 秒`,
    ""
  ];
  if (report.failures.length) lines.push("需要返工", ...report.failures.map((item) => `- ${item}`), "");
  if (report.warnings.length) lines.push("自动提醒", ...report.warnings.map((item) => `- ${item}`), "");
  lines.push("发布前人工看图", ...report.manualChecks.map((item) => `- ${item}`), "");
  lines.push("说明：自动检查会核对数量、文件、尺寸、重复图片和文案风险词；母版一致性、真实场景和 AI 味仍需最终看图确认。");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  inspectProductionQuality,
  qualityReportText
};
