"use strict";

/**
 * 小红书聚光模板采集的纯逻辑层。
 * 版本：0.19.65
 * 用途：把页面卡片的可见证据规范化，供用户脚本、工作台接口和测试共享。
 * 更新地址：本项目 src/lib/xhs-template-collector.js
 */

const NOTE_ID_RE = /^[a-f0-9]{24}$/i;

function textOf(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function parseNoteIdFromTrackImpression(value) {
  if (!value) return "";
  try {
    const payload = typeof value === "string" ? JSON.parse(value) : value;
    const id = textOf(payload?.attributes?.triggerValue);
    return NOTE_ID_RE.test(id) ? id.toLowerCase() : "";
  } catch {
    return "";
  }
}

function parseMetric(value) {
  const text = textOf(value).replace(/,/g, "");
  const match = text.match(/\d+(?:\.\d+)?(?:万|k|K)?/);
  return match ? match[0] : "";
}

function parseNoteIdFromHref(value) {
  const match = String(value || "").match(/\/explore\/([a-f0-9]{24})(?:[/?#]|$)/i);
  return match ? match[1].toLowerCase() : "";
}

function sourceUrlFromHref(value, noteId) {
  const raw = textOf(value);
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://www.xiaohongshu.com/");
    const hostname = url.hostname.toLowerCase();
    const allowed = ["xhslink.cn", "www.xhslink.cn", "xhslink.com", "www.xhslink.com", "xiaohongshu.com", "www.xiaohongshu.com"];
    if (!allowed.includes(hostname) || parseNoteIdFromHref(url.href) !== textOf(noteId).toLowerCase()) return "";
    url.pathname = url.pathname.replace(/\/explore\/[a-f0-9]{24}/i, `/explore/${textOf(noteId).toLowerCase()}`);
    return url.href;
  } catch {
    return "";
  }
}

function normalizeStats(stats = {}) {
  return {
    imageCount: Number(stats.imageCount || 0) || 0,
    likes: parseMetric(stats.likes),
    collections: parseMetric(stats.collections),
    comments: parseMetric(stats.comments)
  };
}

function canonicalExploreUrl(noteId) {
  const id = textOf(noteId).toLowerCase();
  return NOTE_ID_RE.test(id) ? `https://www.xiaohongshu.com/explore/${id}` : "";
}

function dedupeKey(input = {}) {
  const noteId = textOf(input.noteId).toLowerCase();
  if (NOTE_ID_RE.test(noteId)) return `xhs:${noteId}`;
  const sourceUrl = textOf(input.sourceUrl).toLowerCase();
  return sourceUrl ? `url:${sourceUrl}` : "";
}

function normalizeCollectorInput(input = {}) {
  const noteId = textOf(input.noteId).toLowerCase();
  const title = textOf(input.title).slice(0, 240);
  const sourcePageUrl = textOf(input.sourcePageUrl).slice(0, 1000);
  const sourceUrl = textOf(input.sourceUrl).slice(0, 2000);
  const stats = normalizeStats(input.stats || input);
  const imageCount = Math.max(Number(input.imageCount || 0) || 0, stats.imageCount);
  return {
    noteId: NOTE_ID_RE.test(noteId) ? noteId : "",
    title,
    sourcePageUrl,
    sourceUrl,
    imageCount,
    stats: { ...stats, imageCount },
    source: "xiaohongshu-juguang",
    dedupeKey: dedupeKey({ noteId, sourceUrl }),
    canonicalUrl: canonicalExploreUrl(noteId)
  };
}

function extractCardRecord(card) {
  if (!card) return null;
  const getText = (selectors) => {
    for (const selector of selectors) {
      const value = textOf(card.querySelector?.(selector)?.textContent);
      if (value) return value;
    }
    return "";
  };
  const tags = [...(card.querySelectorAll?.(".note-meta .d-tag-content") || [])]
    .map((node) => parseMetric(node.textContent));
  const imageCount = [...(card.querySelectorAll?.(".note-image-item") || [])].length;
  const noteId = [
    parseNoteIdFromTrackImpression(card.getAttribute?.("data-track-impression")),
    textOf(card.getAttribute?.("data-note-id")),
    textOf(card.getAttribute?.("data-id")),
    ...[...(card.querySelectorAll?.("a[href*='/explore/']") || [])]
      .map((node) => parseNoteIdFromHref(node.getAttribute?.("href")))
  ].find((value) => NOTE_ID_RE.test(value)) || "";
  const sourceUrl = [...(card.querySelectorAll?.("a[href*='/explore/']") || [])]
    .map((node) => sourceUrlFromHref(node.getAttribute?.("href"), noteId))
    .find(Boolean) || "";
  const title = getText([".note-meta > span", ".note-meta span", "[data-note-title]", "h3", "h4"]);
  if (!noteId || !title) return null;
  return normalizeCollectorInput({
    noteId,
    title,
    imageCount,
    stats: {
      imageCount: tags[0] || imageCount,
      likes: tags[1] || "",
      collections: tags[2] || "",
      comments: tags[3] || ""
    },
    sourceUrl,
    sourcePageUrl: typeof location !== "undefined" ? location.href : ""
  });
}

module.exports = {
  NOTE_ID_RE,
  parseNoteIdFromTrackImpression,
  parseNoteIdFromHref,
  sourceUrlFromHref,
  parseMetric,
  normalizeStats,
  canonicalExploreUrl,
  dedupeKey,
  normalizeCollectorInput,
  extractCardRecord
};
