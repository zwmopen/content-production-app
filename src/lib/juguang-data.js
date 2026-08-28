const fs = require("fs");
const path = require("path");

const DEFAULT_PROJECT_ROOT = "D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目";

const KEYWORD_COLUMNS = {
  keyword: "关键词",
  reason: "推荐理由",
  competition: "竞争指数",
  monthlySearch: "月搜索指数",
  marketBid: "市场出价"
};

const NOTE_COLUMNS = {
  noteId: "笔记ID",
  title: "标题",
  reads: "阅读量_历史总计",
  readRate: "阅读率",
  interactions: "互动量_历史总计",
  interactionRate: "互动率",
  clickCost14d: "点击成本_近14天"
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

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

  const headers = (rows.shift() || []).map((header) => header.replace(/^\uFEFF/, ""));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function numberValue(value) {
  const parsed = Number(String(value || "").replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestFile(directory, prefix, extension) {
  if (!fs.existsSync(directory)) return "";
  return fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith(extension))
    .map((name) => {
      const fullPath = path.join(directory, name);
      return { fullPath, mtime: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)[0]?.fullPath || "";
}

function readCsv(file) {
  return file && fs.existsSync(file) ? parseCsv(fs.readFileSync(file, "utf8")) : [];
}

function keywordScore(item) {
  const reason = item[KEYWORD_COLUMNS.reason] || "";
  const search = numberValue(item[KEYWORD_COLUMNS.monthlySearch]);
  const bid = numberValue(item[KEYWORD_COLUMNS.marketBid]);
  const competition = item[KEYWORD_COLUMNS.competition] || "";

  let score = Math.log10(search + 10) * 18;
  if (reason.includes("蓝海词")) score += 28;
  if (reason.includes("高点击")) score += 16;
  if (reason.includes("同行买词")) score += 8;
  if (competition === "低") score += 18;
  else if (competition === "中") score += 8;
  if (bid > 0 && bid <= 0.6) score += 8;

  return Math.round(score * 10) / 10;
}

function publicKeyword(item) {
  return {
    keyword: item[KEYWORD_COLUMNS.keyword] || "",
    reason: item[KEYWORD_COLUMNS.reason] || "",
    competition: item[KEYWORD_COLUMNS.competition] || "",
    monthlySearch: numberValue(item[KEYWORD_COLUMNS.monthlySearch]),
    marketBid: numberValue(item[KEYWORD_COLUMNS.marketBid]),
    score: keywordScore(item)
  };
}

function buildRecommendations(keywords) {
  const businessTerms = ["团建", "公司", "企业", "年会", "轰趴", "露营", "漂流", "溯溪", "安吉", "杭州", "江浙沪"];
  return keywords.map(publicKeyword)
    .filter((item) => item.keyword && businessTerms.some((term) => item.keyword.includes(term)))
    .filter((item, index, array) => array.findIndex((other) => other.keyword === item.keyword) === index)
    .sort((a, b) => b.score - a.score || b.monthlySearch - a.monthlySearch)
    .slice(0, 12)
    .map((item) => ({
      ...item,
      action: item.reason.includes("蓝海词") ? "优先做搜索截流笔记" : "用于标题/话题词匹配",
      titlePattern: `${item.keyword} + 人群痛点 + 路线/玩法 + 决策参考`
    }));
}

function readLeadSummary(projectRoot) {
  const leadDir = path.join(projectRoot, "05-知识库", "07-销售转化与策划师承接系统", "05-分析与复盘", "来源与月报");
  const file = latestFile(leadDir, "聚光线索汇总_", ".md");
  if (!file) return { total: 0, attributed: 0, file: "" };

  const text = fs.readFileSync(file, "utf8");
  return {
    total: numberValue(text.match(/(?:总计|总数|合计)[^\d]*(\d+)/)?.[1]),
    attributed: numberValue(text.match(/(?:归因|有效)[^\d]*(\d+)/)?.[1]),
    file,
    privacy: "只读取汇总数字，不暴露原始私信隐私内容"
  };
}

function getJuguangSnapshot(projectRoot = process.env.TEAMBUILDING_ROOT || DEFAULT_PROJECT_ROOT) {
  const snapshotDir = path.join(projectRoot, "05-知识库", "03-策略研究", "03-SEO关键词库", "聚光数据快照");
  const plannerDir = path.join(projectRoot, "05-知识库", "03-策略研究", "03-SEO关键词库", "聚光关键词规划工具");

  const allFile = latestFile(plannerDir, "聚光关键词规划工具_所有词_", ".csv");
  const blueFile = latestFile(snapshotDir, "聚光蓝海词包_", ".csv");
  const clickFile = latestFile(snapshotDir, "聚光高点击词包_", ".csv");
  const peerFile = latestFile(snapshotDir, "聚光同行买词包_", ".csv");
  const noteFile = latestFile(snapshotDir, "聚光笔记级数据_", ".csv");

  const all = readCsv(allFile);
  const blue = readCsv(blueFile);
  const highClick = readCsv(clickFile);
  const peer = readCsv(peerFile);
  const notes = readCsv(noteFile);
  const latestMtime = [allFile, blueFile, clickFile, peerFile, noteFile]
    .filter(Boolean)
    .map((file) => fs.statSync(file).mtime)
    .sort((a, b) => b - a)[0];

  return {
    mode: process.env.XHS_JUGUANG_ACCESS_TOKEN ? "api-configured" : "local-snapshot",
    api: {
      configured: Boolean(process.env.XHS_JUGUANG_ACCESS_TOKEN),
      appConfigured: Boolean(process.env.XHS_JUGUANG_APP_ID && process.env.XHS_JUGUANG_APP_SECRET),
      message: process.env.XHS_JUGUANG_ACCESS_TOKEN
        ? "已配置聚光 API 凭证，可扩展为在线刷新。"
        : "当前使用本地聚光快照；在线 Marketing API 后续再接。"
    },
    updatedAt: latestMtime?.toISOString() || null,
    counts: {
      all: all.length,
      blueOcean: blue.length,
      highClick: highClick.length,
      peerBuying: peer.length,
      notes: notes.length
    },
    topKeywords: [...blue, ...highClick]
      .map(publicKeyword)
      .filter((item, index, array) => item.keyword && array.findIndex((other) => other.keyword === item.keyword) === index)
      .sort((a, b) => b.score - a.score || b.monthlySearch - a.monthlySearch)
      .slice(0, 20),
    recommendations: buildRecommendations([...blue, ...highClick, ...peer, ...all]),
    noteSignals: notes.slice(0, 20).map((item) => ({
      noteId: item[NOTE_COLUMNS.noteId] || "",
      title: item[NOTE_COLUMNS.title] || "",
      reads: numberValue(item[NOTE_COLUMNS.reads]),
      readRate: numberValue(item[NOTE_COLUMNS.readRate]),
      interactions: numberValue(item[NOTE_COLUMNS.interactions]),
      interactionRate: numberValue(item[NOTE_COLUMNS.interactionRate]),
      clickCost14d: numberValue(item[NOTE_COLUMNS.clickCost14d])
    })),
    leads: readLeadSummary(projectRoot),
    nextActions: [
      "优先用蓝海词补搜索型团建笔记",
      "把高点击词写进标题、封面大字和话题词",
      "同行买词可用于判断信息流素材测试方向",
      "线索复盘仍以用户人工确认的数据为准"
    ],
    sources: { allFile, blueFile, clickFile, peerFile, noteFile }
  };
}

function queryKeywords(query = {}, projectRoot) {
  const snapshot = getJuguangSnapshot(projectRoot);
  const text = String(query.text || "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const keywords = snapshot.topKeywords.concat(snapshot.recommendations)
    .filter((item, index, array) => array.findIndex((other) => other.keyword === item.keyword) === index)
    .filter((item) => !text || item.keyword.toLowerCase().includes(text) || item.reason.toLowerCase().includes(text))
    .slice(0, limit);

  return { query: text, count: keywords.length, keywords, updatedAt: snapshot.updatedAt };
}

module.exports = { getJuguangSnapshot, parseCsv, queryKeywords };
