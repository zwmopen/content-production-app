"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  analyzeCollectionCandidates,
  buildCollectionQueries,
  extractCollectionKeywords,
  normalizeCollectionTitle
} = require("./material-collection-keywords");

test("标题清洗会去掉采集序号和互动数，但保留地点与主题词", () => {
  const title = normalizeCollectionTitle("1_赞23评4【溧阳团建｜两天一夜】");
  assert.equal(title, "溧阳团建|两天一夜");
  const keywords = extractCollectionKeywords(title);
  assert.deepEqual(keywords.locations, ["溧阳"]);
  assert.ok(keywords.formats.includes("团建"));
  assert.ok(keywords.formats.includes("两天一夜"));
});

test("地点、时长和活动组合成稳定的采集关键词", () => {
  const keywords = extractCollectionKeywords("宜兴团建 露营 两天一夜");
  assert.deepEqual(buildCollectionQueries(keywords).slice(0, 4), [
    "宜兴团建",
    "宜兴两天一夜团建",
    "宜兴露营团建",
    "宜兴团建攻略"
  ]);
});

test("无 TXT 候选只做采集分析，不改变生产资格", () => {
  const result = analyzeCollectionCandidates([
    { name: "溧阳团建两天一夜", path: "D:/素材/0/溧阳团建两天一夜", imageCount: 8, textCount: 0 },
    { name: "宜兴漂流团建", path: "D:/素材/0/宜兴漂流团建", imageCount: 6, textCount: 0 },
    { name: "完整帖子", path: "D:/素材/0/完整帖子", imageCount: 8, textCount: 1 }
  ]);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.recognizedLocationCount, 2);
  assert.deepEqual(result.locations.slice(0, 2).sort((left, right) => left.value.localeCompare(right.value, "zh-Hans-CN")), [
    { value: "溧阳", count: 1 },
    { value: "宜兴", count: 1 }
  ].sort((left, right) => left.value.localeCompare(right.value, "zh-Hans-CN")));
  assert.equal(result.candidates[0].textCount, 0);
  assert.ok(result.queries.some((item) => item.query === "溧阳两天一夜团建"));
});
