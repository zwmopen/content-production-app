"use strict";

const path = require("node:path");

const PREFERRED_CAPTION_NAMES = Object.freeze([
  "文案.txt",
  "小红书文案.txt",
  "小红书发布文案.txt",
  "抖音文案.txt",
  "抖音发布文案.txt",
  "text.txt",
  "copywriting.txt",
  "content.txt"
]);

const METADATA_TEXT_NAMES = new Set([
  "会话追踪.txt",
  "生产对话轨迹.txt",
  "生产记录.txt",
  "质量报告.txt",
  "作品标签.txt",
  "标签.txt",
  "元数据.txt",
  "metadata.txt",
  "manifest.txt",
  "日志.txt",
  "log.txt",
  "readme.md",
  "changelog.md",
  "出图计划.md",
  "生成提示词.txt",
  "出图提示词.txt",
  "提示词.txt",
  "溯源说明.md",
  "质检说明.md",
  "自检.md",
  "gpt作品记录.md",
  "制作说明.md",
  "维护说明.md",
  "交接.md",
  "handoff.md",
  "metadata.md",
  "manifest.md",
  "log.md",
  "production-turns.txt",
  "session-tracking.txt"
].map((name) => name.toLowerCase()));

const METADATA_TEXT_PREFIXES = Object.freeze([
  "会话追踪", "生产对话轨迹", "生产记录", "质量报告", "作品标签", "标签", "元数据",
  "metadata", "manifest", "日志", "log", "production-turns", "session-tracking",
  "readme", "changelog", "出图计划", "溯源说明", "质检说明", "自检", "gpt作品记录",
  "制作说明", "维护说明", "交接", "handoff", "生成提示词", "出图提示词", "提示词"
]);

function normalizedName(name) {
  return path.basename(String(name || "").trim()).toLowerCase();
}

function isMetadataTextName(name) {
  const normalized = normalizedName(name);
  const extension = path.extname(normalized);
  if (!extension || ![".txt", ".md"].includes(extension)) return false;
  if (METADATA_TEXT_NAMES.has(normalized)) return true;
  const stem = path.basename(normalized, extension);
  return METADATA_TEXT_PREFIXES.some((prefix) => stem === prefix || stem.startsWith(`${prefix}-`)
    || stem.startsWith(`${prefix}_`) || stem.startsWith(`${prefix} `)
    || stem.startsWith(`${prefix}(`) || stem.startsWith(`${prefix}（`));
}

function isCaptionCandidate(name, options = {}) {
  const normalized = normalizedName(name);
  const extension = path.extname(normalized);
  const allowed = extension === ".txt" || (options.allowMarkdown === true && extension === ".md");
  return Boolean(normalized) && allowed && !isMetadataTextName(normalized);
}

function chooseCaptionFileName(names, options = {}) {
  const values = Array.from(new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name || "").trim())
    .filter((name) => isCaptionCandidate(name, options))));
  for (const preferred of PREFERRED_CAPTION_NAMES) {
    const preferredStem = path.basename(preferred, path.extname(preferred)).toLowerCase();
    const match = values.find((name) => path.basename(name, path.extname(name)).toLowerCase() === preferredStem);
    if (match) return match;
  }

  const named = values.filter((name) => /文案|copywriting|content/i.test(path.basename(name, path.extname(name))));
  if (named.length === 1) return named[0];
  if (values.length === 1) return values[0];
  return "";
}

module.exports = {
  METADATA_TEXT_NAMES,
  PREFERRED_CAPTION_NAMES,
  chooseCaptionFileName,
  isCaptionCandidate,
  isMetadataTextName
};
