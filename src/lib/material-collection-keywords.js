"use strict";

const tagRegistry = require("./tag-registry.json");

const registeredLocations = (tagRegistry.groups?.business || [])
  .find((group) => group.id === "location")?.options || [];

// 这是“采集候选”词典，不是生产标签字典。生产资格仍由图片 + TXT/MD
// 判定；这里仅用于帮助用户从无 TXT 文件夹的标题中整理回采关键词。
const DEFAULT_COLLECTION_KEYWORD_RULES = Object.freeze({
  locations: Object.freeze([
    ...registeredLocations,
    "溧阳", "宜兴", "无锡", "常州", "义乌", "富阳", "崇明", "舟山", "象山",
    "天目湖", "南山竹海", "西山岛", "太湖", "宁国", "黄山", "湖州南浔", "江浙沪", "长三角", "苏南", "浙北"
  ]),
  formats: Object.freeze([
    "公司团建", "团建方案", "团建攻略", "团建", "周边游", "本地生活",
    "两天一夜", "2天1夜", "两日一夜", "2日1夜", "2天一晚", "一日团建", "一日游",
    "周末游", "攻略", "方案"
  ]),
  activities: Object.freeze([
    "露营", "烧烤", "漂流", "玩水", "温泉", "竹海", "徒步", "爬山", "登山", "山野",
    "轰趴", "民宿", "包栋", "别墅", "溯溪", "采摘", "农场", "古镇", "茶山", "茶园",
    "点茶", "滑雪", "冰雪", "卡丁", "越野", "飞盘", "拓展", "真人CS", "骑行",
    "游船", "泛舟", "环湖", "皮划艇", "划船", "桨板"
  ]),
  seasons: Object.freeze(["夏季", "夏天", "暑假", "避暑", "秋季", "秋天", "赏秋", "冬季", "冬天", "春季", "春天", "踏青"]),
  intents: Object.freeze(["公司", "企业", "HR", "团队", "定制", "预算", "路线", "行程"])
});

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeCollectionTitle(value) {
  let title = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  // 采集站点常把互动数或下载序号加在标题前面，这些数字不应变成关键词。
  for (let index = 0; index < 4; index += 1) {
    const next = title
      .replace(/^[\s._、-]+/, "")
      .replace(/^(?:\d+\s*[_.、-]\s*)+/, "")
      .replace(/^(?:(?:赞|评|收藏|转发)\s*\d+\s*)+/, "")
      .replace(/^(?:[【\[（(]\s*)+/, "")
      .replace(/^(?:[】\]）)]\s*)+/, "")
      .replace(/(?:\s*[】\]）)]+)+$/, "")
      .trim();
    if (next === title) break;
    title = next;
  }
  return title;
}

function matchedTerms(text, terms) {
  const haystack = String(text || "").toLowerCase();
  return unique((Array.isArray(terms) ? terms : [])
    .map((term) => String(term || "").trim())
    .filter((term) => term && haystack.includes(term.toLowerCase())));
}

function extractCollectionKeywords(title, rules = DEFAULT_COLLECTION_KEYWORD_RULES) {
  const normalizedTitle = normalizeCollectionTitle(title);
  const locations = matchedTerms(normalizedTitle, rules.locations);
    // 长地点优先，避免“湖州南浔”与“湖州”同时成为主关键词。
  const reducedLocations = locations.filter((term) => !locations.some((other) => other !== term && other.includes(term)));
  const result = {
    normalizedTitle,
    locations: reducedLocations,
    formats: matchedTerms(normalizedTitle, rules.formats),
    activities: matchedTerms(normalizedTitle, rules.activities),
    seasons: matchedTerms(normalizedTitle, rules.seasons),
    intents: matchedTerms(normalizedTitle, rules.intents)
  };
  result.all = unique([
    ...result.locations,
    ...result.formats,
    ...result.activities,
    ...result.seasons,
    ...result.intents
  ]);
  return result;
}

function addQuery(queries, query) {
  const clean = String(query || "").replace(/\s+/g, "").trim();
  if (!clean || clean.length < 2 || queries.includes(clean)) return;
  queries.push(clean);
}

function buildCollectionQueries(profile = {}, options = {}) {
  const queries = [];
  const places = unique(profile.locations);
  const formats = unique(profile.formats);
  const activities = unique(profile.activities);
  const durations = formats.filter((term) => /(?:两天一夜|2天1夜|两日一夜|2日1夜|2天一晚)/.test(term));
  const hasTeamBuilding = formats.some((term) => /团建/.test(term));
  const limit = Math.max(1, Number(options.limit || 12));

  places.forEach((place) => {
    addQuery(queries, `${place}团建`);
    durations.forEach((duration) => addQuery(queries, `${place}${duration}团建`));
    activities.slice(0, 3).forEach((activity) => addQuery(queries, `${place}${activity}团建`));
    if (hasTeamBuilding || formats.length === 0) addQuery(queries, `${place}团建攻略`);
  });

  return queries.slice(0, limit);
}

function incrementCount(map, values) {
  unique(values).forEach((value) => { map[value] = Number(map[value] || 0) + 1; });
}

function sortedCounts(map, limit = 20) {
  return Object.entries(map)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-Hans-CN"))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function analyzeCollectionCandidates(entries = [], options = {}) {
  const candidates = (Array.isArray(entries) ? entries : [])
    .filter((entry) => Number(entry?.imageCount || 0) > 0 && Number(entry?.textCount || 0) === 0)
    .map((entry) => {
      const keywords = extractCollectionKeywords(entry.name || entry.title || "", options.rules || DEFAULT_COLLECTION_KEYWORD_RULES);
      return {
        name: String(entry.name || entry.title || ""),
        path: String(entry.path || ""),
        relativePath: String(entry.relativePath || ""),
        bucket: String(entry.bucket || ""),
        imageCount: Number(entry.imageCount || 0),
        textCount: Number(entry.textCount || 0),
        normalizedTitle: keywords.normalizedTitle,
        keywords,
        suggestedQueries: buildCollectionQueries(keywords, { limit: 8 })
      };
    });
  const locationCounts = {};
  const formatCounts = {};
  const activityCounts = {};
  const seasonCounts = {};
  const queryCounts = {};
  candidates.forEach((candidate) => {
    incrementCount(locationCounts, candidate.keywords.locations);
    incrementCount(formatCounts, candidate.keywords.formats);
    incrementCount(activityCounts, candidate.keywords.activities);
    incrementCount(seasonCounts, candidate.keywords.seasons);
    candidate.suggestedQueries.forEach((query) => { queryCounts[query] = Number(queryCounts[query] || 0) + 1; });
  });
  const maxCandidates = Math.max(0, Number(options.maxCandidates || candidates.length));
  return {
    candidateCount: candidates.length,
    recognizedLocationCount: candidates.filter((candidate) => candidate.keywords.locations.length > 0).length,
    unclassifiedCount: candidates.filter((candidate) => candidate.keywords.locations.length === 0).length,
    locations: sortedCounts(locationCounts, options.maxBreakdown || 30),
    formats: sortedCounts(formatCounts, options.maxBreakdown || 30),
    activities: sortedCounts(activityCounts, options.maxBreakdown || 30),
    seasons: sortedCounts(seasonCounts, options.maxBreakdown || 30),
    queries: sortedCounts(queryCounts, options.maxQueries || 30).map(({ value, count }) => ({ query: value, count })),
    candidates: candidates.slice(0, maxCandidates)
  };
}

module.exports = {
  DEFAULT_COLLECTION_KEYWORD_RULES,
  analyzeCollectionCandidates,
  buildCollectionQueries,
  extractCollectionKeywords,
  normalizeCollectionTitle
};
