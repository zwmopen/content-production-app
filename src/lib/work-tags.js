"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TAG_REGISTRY_PATH = path.join(__dirname, "tag-registry.json");
const TAG_REGISTRY = require(TAG_REGISTRY_PATH);

function freezeTagGroup(group) {
  return Object.freeze({
    id: String(group?.id || ""),
    label: String(group?.label || ""),
    options: Object.freeze((Array.isArray(group?.options) ? group.options : []).map(String))
  });
}

const TAG_GROUPS = Object.freeze(Object.fromEntries(
  Object.entries(TAG_REGISTRY.groups || {}).map(([groupId, groups]) => [
    groupId,
    Object.freeze((Array.isArray(groups) ? groups : []).map(freezeTagGroup))
  ])
));

const PLATFORM_USAGE_DEFINITIONS = Object.freeze(Object.fromEntries(
  Object.entries(TAG_REGISTRY.platformUsage?.definitions || {}).map(([platform, definition]) => [
    platform,
    Object.freeze({
      label: String(definition?.label || ""),
      platforms: Object.freeze((Array.isArray(definition?.platforms) ? definition.platforms : []).map(String))
    })
  ])
));

const PLATFORM_USAGE_ALIASES = Object.freeze(Object.fromEntries(
  Object.entries(TAG_REGISTRY.platformUsage?.aliases || {}).map(([alias, platform]) => [String(alias), String(platform)])
));

const MATERIAL_TAG_RULES = Object.freeze((Array.isArray(TAG_REGISTRY.materialRules) ? TAG_REGISTRY.materialRules : [])
  .map(([tag, keywords]) => Object.freeze([String(tag), Object.freeze((Array.isArray(keywords) ? keywords : []).map(String))])));

const BUSINESS_GROUP_IDS = TAG_GROUPS.business.map((group) => group.id);
const ALL_GROUP_IDS = [...BUSINESS_GROUP_IDS, ...TAG_GROUPS.system.map((group) => group.id), ...TAG_GROUPS.distribution.map((group) => group.id)];

const KEYWORDS = Object.freeze(TAG_REGISTRY.inference || {});
const CONTENT_TYPE_TO_TAG = Object.freeze(KEYWORDS.content?.explicitTypeToTag || {});
const CONTENT_KEYWORDS = Object.freeze(KEYWORDS.content?.keywords || {});
const GUIDE_PATTERN = new RegExp(String(KEYWORDS.content?.guidePattern || "合集|攻略|top\\s*\\d+|清单"));

function uniqueKnown(groupId, values) {
  const registry = [...TAG_GROUPS.business, ...TAG_GROUPS.system, ...TAG_GROUPS.distribution].find((group) => group.id === groupId);
  const allowed = new Set(registry?.options || []);
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter((value) => allowed.has(value)))];
}

function normalizeTagGroups(groups = {}, options = {}) {
  const ids = options.businessOnly === true ? BUSINESS_GROUP_IDS : ALL_GROUP_IDS;
  return Object.fromEntries(ids.filter((id) => Object.prototype.hasOwnProperty.call(groups || {}, id))
    .map((id) => [id, uniqueKnown(id, groups[id])]));
}

function normalizePlatformUsageId(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[\s/-]+/g, "_");
  return PLATFORM_USAGE_ALIASES[key] || "";
}

function platformUsageFromTags(tags = []) {
  const values = new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag || "").trim()));
  const result = {};
  if (["已发抖音小红书", "小红书已发布", "抖音已发布", "抖音小红书已发布", "已发抖音", "已发小红书"].some((tag) => values.has(tag))) {
    result.douyin_xiaohongshu = {};
  }
  if (["已发公众号", "公众号已发布"].some((tag) => values.has(tag))) result.wechat = {};
  if (["已发携程", "携程已发布"].some((tag) => values.has(tag))) result.ctrip = {};
  if (["已发X", "X已发布", "推特已发布"].some((tag) => values.has(tag))) result.x = {};
  return result;
}

function mergePlatformUsage(...sources) {
  const result = {};
  sources.forEach((source) => {
    if (Array.isArray(source)) {
      Object.assign(result, platformUsageFromTags(source));
      return;
    }
    if (!source || typeof source !== "object") return;
    Object.entries(source).forEach(([rawPlatform, detail]) => {
      const platform = normalizePlatformUsageId(rawPlatform);
      if (!platform) return;
      result[platform] = {
        ...(result[platform] || {}),
        ...(detail && typeof detail === "object" ? detail : {})
      };
    });
  });
  return result;
}

function platformUsageTagGroups(platformUsage = {}) {
  const normalized = mergePlatformUsage(platformUsage);
  return {
    publish: Object.keys(PLATFORM_USAGE_DEFINITIONS)
      .filter((platform) => normalized[platform])
      .map((platform) => PLATFORM_USAGE_DEFINITIONS[platform].label)
  };
}

function platformUsageCount(platformUsage = {}) {
  const normalized = mergePlatformUsage(platformUsage);
  return Object.values(normalized).reduce((total, detail) => {
    const explicitCount = Number(detail?.useCount || 0);
    return total + (Number.isFinite(explicitCount) && explicitCount > 0 ? explicitCount : 1);
  }, 0);
}

function platformUsageEligibility(work = {}, platform = "") {
  const normalizedPlatform = normalizePlatformUsageId(platform);
  const usage = mergePlatformUsage(work.platformUsage, work.tags);
  const definition = PLATFORM_USAGE_DEFINITIONS[normalizedPlatform];
  const detail = normalizedPlatform ? usage[normalizedPlatform] : null;
  const used = Boolean(detail);
  const useCount = detail ? Math.max(1, Number(detail.useCount || 0)) : 0;
  return {
    platform: normalizedPlatform,
    used,
    eligible: !used,
    useCount: Number.isFinite(useCount) ? useCount : 1,
    firstUsedAt: String(detail?.firstUsedAt || ""),
    lastUsedAt: String(detail?.lastUsedAt || ""),
    source: String(detail?.source || ""),
    label: definition?.label || normalizedPlatform || String(platform || ""),
    reason: used ? `${definition?.label || normalizedPlatform}已记录，本平台不再自动复用` : ""
  };
}

function matchedTags(haystack, keywordMap) {
  return Object.entries(keywordMap).filter(([, words]) => words.some((word) => haystack.includes(String(word).toLowerCase())))
    .map(([tag]) => tag);
}

function inferWorkTagGroups(input = {}) {
  const haystack = `${input.name || ""} ${input.text || ""} ${(input.tags || []).join(" ")}`.normalize("NFKC").toLowerCase();
  const game = matchedTags(haystack, KEYWORDS.game);
  const contentMatches = matchedTags(haystack, CONTENT_KEYWORDS);
  const guide = GUIDE_PATTERN.test(haystack);
  const explicitContent = String(input.contentType || input.collectionType || "").toLowerCase();
  const explicitContentTag = CONTENT_TYPE_TO_TAG[explicitContent];
  const content = explicitContentTag ? [explicitContentTag]
        : contentMatches.includes("团建游戏") || game.length ? ["团建游戏"]
          : guide ? ["合集攻略"] : ["精准流量"];
  return normalizeTagGroups({
    content,
    game,
    location: matchedTags(haystack, KEYWORDS.location),
    duration: matchedTags(haystack, KEYWORDS.duration),
    scene: matchedTags(haystack, KEYWORDS.scene)
  }, { businessOnly: true });
}

function deriveSystemTagGroups(input = {}) {
  const imageCount = Number(input.imageCount || 0);
  const textCount = Number(input.textCount || 0);
  const integrity = imageCount <= 0 ? ["缺图片"] : textCount <= 0 ? ["缺文案"] : ["完整"];
  const usageCount = Math.max(0, Number(input.usageCount || 0));
  const usage = usageCount <= 0 ? ["未使用"] : usageCount >= 8 ? ["使用8次以上"] : [`使用${usageCount}次`];
  const stageMap = { material: "素材库", works: "作品库", mobile: "待发手机", official: "公众号待处理", used: "已归档" };
  const stage = stageMap[String(input.workflowStage || "")] ? [stageMap[String(input.workflowStage)]] : [];
  const groups = { integrity, usage, stage };
  if (typeof input.distributed === "boolean") groups.distribution = [input.distributed ? "已分发" : "未分发"];
  return groups;
}

function mergeWorkTagGroups(automatic = {}, manual = {}) {
  const auto = normalizeTagGroups(automatic, { businessOnly: true });
  const override = normalizeTagGroups(manual, { businessOnly: true });
  const result = { ...auto };
  Object.keys(manual || {}).forEach((groupId) => {
    if (BUSINESS_GROUP_IDS.includes(groupId)) result[groupId] = override[groupId] || [];
  });
  return result;
}

function matchesTagSelection(groups = {}, selection = {}) {
  return Object.entries(selection || {}).every(([groupId, selected]) => {
    const wanted = (Array.isArray(selected) ? selected : []).map(String).filter((value) => value && value !== "不限" && value !== "全部");
    if (!wanted.length) return true;
    const actual = new Set(Array.isArray(groups[groupId]) ? groups[groupId].map(String) : []);
    return wanted.some((value) => actual.has(value));
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

function readWorkTagLedger(file) {
  const value = readJson(file, { version: 1, entries: {} });
  return {
    version: 1,
    updatedAt: String(value.updatedAt || ""),
    entries: value.entries && typeof value.entries === "object" ? value.entries : {}
  };
}

function updateWorkTagLedger(file, input = {}) {
  const workId = String(input.workId || "").trim();
  if (!workId) throw new Error("作品缺少稳定 workId，不能保存标签");
  const ledger = readWorkTagLedger(file);
  const previous = ledger.entries[workId] || {};
  const automatic = normalizeTagGroups(input.automatic ?? previous.automatic ?? {}, { businessOnly: true });
  const manual = normalizeTagGroups(input.manual ?? previous.manual ?? {}, { businessOnly: true });
  const platformUsage = mergePlatformUsage(input.platformUsage ?? previous.platformUsage ?? {});
  const now = new Date().toISOString();
  ledger.entries[workId] = {
    workId,
    name: String(input.name || previous.name || ""),
    path: String(input.path || previous.path || ""),
    automatic,
    manual,
    platformUsage,
    effective: mergeWorkTagGroups(automatic, manual),
    updatedAt: now
  };
  ledger.updatedAt = now;
  writeJsonAtomic(file, ledger);
  return ledger.entries[workId];
}

function syncWorkTagLedger(file, works = []) {
  const before = readWorkTagLedger(file);
  const ledger = JSON.parse(JSON.stringify(before));
  let changed = false;
  const now = new Date().toISOString();
  (Array.isArray(works) ? works : []).forEach((work) => {
    const workId = String(work?.workId || "").trim();
    if (!workId) return;
    const previous = ledger.entries[workId] || {};
    const automatic = normalizeTagGroups(work.automatic || {}, { businessOnly: true });
    const manual = normalizeTagGroups(previous.manual || {}, { businessOnly: true });
    const platformUsage = mergePlatformUsage(previous.platformUsage || {}, work.platformUsage || {}, work.tags || []);
    const next = {
      workId,
      name: String(work.name || previous.name || ""),
      path: String(work.path || previous.path || ""),
      automatic,
      manual,
      platformUsage,
      effective: mergeWorkTagGroups(automatic, manual),
      updatedAt: previous.updatedAt || now
    };
    const comparablePrevious = { ...previous, updatedAt: next.updatedAt };
    if (JSON.stringify(comparablePrevious) !== JSON.stringify(next)) {
      next.updatedAt = now;
      changed = true;
    }
    ledger.entries[workId] = next;
  });
  if (changed || !fs.existsSync(file)) {
    ledger.updatedAt = now;
    writeJsonAtomic(file, ledger);
  }
  return { changed, ledger };
}

function recordPlatformUsage(file, input = {}) {
  const work = input.work || {};
  const workId = String(work.workId || "").trim();
  const platform = normalizePlatformUsageId(input.platform);
  const definition = PLATFORM_USAGE_DEFINITIONS[platform];
  if (!workId) throw new Error("作品缺少稳定 workId，不能记录平台使用");
  if (!platform || !definition) throw new Error("缺少受支持的平台标识，不能记录平台使用");
  const now = String(input.usedAt || new Date().toISOString());
  const ledger = readWorkTagLedger(file);
  const previous = ledger.entries[workId] || {};
  const platformUsage = mergePlatformUsage(work.platformUsage, previous.platformUsage, work.tags);
  const previousUsage = platformUsage[platform] || {};
  platformUsage[platform] = {
    ...previousUsage,
    label: definition.label,
    firstUsedAt: String(previousUsage.firstUsedAt || now),
    lastUsedAt: now,
    useCount: Math.max(0, Number(previousUsage.useCount || 0)) + 1,
    source: String(input.source || previousUsage.source || "manual_confirmation"),
    collection: String(input.collection || previousUsage.collection || "")
  };
  const effective = mergeWorkTagGroups(previous.automatic || {}, previous.manual || {});
  ledger.entries[workId] = {
    ...previous,
    workId,
    name: String(work.name || previous.name || ""),
    path: String(work.path || previous.path || ""),
    automatic: normalizeTagGroups(previous.automatic || {}, { businessOnly: true }),
    manual: normalizeTagGroups(previous.manual || {}, { businessOnly: true }),
    platformUsage,
    effective,
    updatedAt: now
  };
  ledger.updatedAt = now;
  writeJsonAtomic(file, ledger);

  let manifestUpdated = false;
  const workPath = String(work.path || "").trim();
  if (workPath) {
    const manifestFile = path.join(workPath, "GPT作品记录.json");
    const manifest = readJson(manifestFile, null);
    if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
      const tags = Array.isArray(manifest.tags) ? manifest.tags.map(String) : [];
      manifest.tags = [...new Set([...tags, definition.label])];
      manifest.platformUsage = mergePlatformUsage(manifest.platformUsage, platformUsage);
      manifest.platformUsageUpdatedAt = now;
      writeJsonAtomic(manifestFile, manifest);
      manifestUpdated = true;
    }
  }
  return {
    workId,
    platform,
    label: definition.label,
    record: ledger.entries[workId],
    manifestUpdated
  };
}

module.exports = {
  TAG_REGISTRY,
  TAG_REGISTRY_PATH,
  TAG_GROUPS,
  MATERIAL_TAG_RULES,
  PLATFORM_USAGE_DEFINITIONS,
  deriveSystemTagGroups,
  inferWorkTagGroups,
  mergePlatformUsage,
  matchesTagSelection,
  mergeWorkTagGroups,
  normalizeTagGroups,
  normalizePlatformUsageId,
  platformUsageCount,
  platformUsageEligibility,
  platformUsageFromTags,
  platformUsageTagGroups,
  recordPlatformUsage,
  readWorkTagLedger,
  syncWorkTagLedger,
  updateWorkTagLedger
};
