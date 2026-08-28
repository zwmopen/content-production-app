function normalizeWorkPackageTitle(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\[object Object\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function publishTitleFromClipboard(clipboardText, fallbackTitle = "") {
  const firstCopyLine = String(clipboardText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(?:标题|title)\s*[：:]\s*/i, "").trim())
    .find((line) => line && !/^(?:标题|正文|话题|title|body|hashtags?)$/i.test(line));
  return normalizeWorkPackageTitle(firstCopyLine) || normalizeWorkPackageTitle(fallbackTitle);
}

module.exports = {
  normalizeWorkPackageTitle,
  publishTitleFromClipboard
};
