const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const collector = require("./xhs-template-collector");

test("聚光卡片可从 data-track-impression 提取稳定笔记 ID与统计", () => {
  const nodes = {
    ".note-meta > span": { textContent: "杭州团建 | 西湖团建，20人起团建方案🔥" },
    ".note-meta .d-tag-content": [
      { textContent: "9" }, { textContent: "3" }, { textContent: "1" }, { textContent: "0" }
    ],
    ".note-image-item": [{}, {}, {}, {}, {}, {}, {}, {}, {}]
  };
  const card = {
    getAttribute(name) {
      return name === "data-track-impression"
        ? JSON.stringify({ attributes: { triggerValue: "6A0018530000000036032176" } })
        : "";
    },
    querySelector(selector) {
      return nodes[selector] && !Array.isArray(nodes[selector]) ? nodes[selector] : null;
    },
    querySelectorAll(selector) { return nodes[selector] || []; }
  };
  const record = collector.extractCardRecord(card);
  assert.equal(record.noteId, "6a0018530000000036032176");
  assert.equal(record.title, "杭州团建 | 西湖团建，20人起团建方案🔥");
  assert.equal(record.imageCount, 9);
  assert.deepEqual(record.stats, { imageCount: 9, likes: "3", collections: "1", comments: "0" });
  assert.equal(record.dedupeKey, "xhs:6a0018530000000036032176");
  assert.equal(record.canonicalUrl, "https://www.xiaohongshu.com/explore/6a0018530000000036032176");
});

test("无效笔记 ID 不会生成下载地址", () => {
  assert.equal(collector.canonicalExploreUrl("not-a-note"), "");
  assert.equal(collector.parseNoteIdFromTrackImpression("{}"), "");
  assert.equal(collector.parseNoteIdFromHref("https://www.xiaohongshu.com/explore/not-a-note"), "");
  assert.equal(collector.parseNoteIdFromHref("https://www.xiaohongshu.com/explore/6A0018530000000036032176?xsec_source=pc"), "6a0018530000000036032176");
  assert.equal(collector.sourceUrlFromHref("/explore/6A0018530000000036032176?xsec_source=pc", "6a0018530000000036032176"), "https://www.xiaohongshu.com/explore/6a0018530000000036032176?xsec_source=pc");
});

test("聚光卡片 DOM 变化时可从 data-note-id 和 explore 链接兜底识别", () => {
  const card = {
    getAttribute(name) {
      return { "data-note-id": "6A0018530000000036032176" }[name] || "";
    },
    querySelector(selector) {
      if (selector === "[data-note-title]") return { textContent: "安吉团建真实卡片" };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "a[href*='/explore/']") return [{ getAttribute: () => "https://www.xiaohongshu.com/explore/6a0018530000000036032176" }];
      if (selector === ".note-meta .d-tag-content") return [{ textContent: "9" }, { textContent: "3" }, { textContent: "1" }, { textContent: "0" }];
      if (selector === ".note-image-item") return [];
      return [];
    }
  };
  const record = collector.extractCardRecord(card);
  assert.equal(record.noteId, "6a0018530000000036032176");
  assert.equal(record.title, "安吉团建真实卡片");
  assert.equal(record.sourceUrl, "https://www.xiaohongshu.com/explore/6a0018530000000036032176");
});

test("模板采集输入用笔记 ID去重，不把观察到的统计当成来源链接", () => {
  const first = collector.normalizeCollectorInput({ noteId: "6a0018530000000036032176", title: "团建", likes: "3" });
  const second = collector.normalizeCollectorInput({ noteId: "6A0018530000000036032176", title: "团建变体", likes: "99" });
  assert.equal(first.dedupeKey, second.dedupeKey);
  assert.equal(first.canonicalUrl, second.canonicalUrl);
});

test("聚光采集用户脚本只绑定目标页面，并提供动态卡片按钮与本地队列入口", () => {
  const scriptPath = path.join(__dirname, "..", "integrations", "xhs-template-collector", "xhs-inspire-template-collector.user.js");
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /@match\s+https:\/\/ad\.xiaohongshu\.com\/microapp\/creativity\/inspire\*/);
  assert.match(source, /@run-at\s+document-idle/);
  assert.match(source, /api\/template-collector\/queue/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /bottom:\s*8px/);
  assert.match(source, /event\.stopPropagation\(\)/);
});
