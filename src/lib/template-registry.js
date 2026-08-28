const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ONLINE_STATES = new Set([
  "missing_online", "uploaded", "update_required", "invalid_online", "uploading", "error"
]);

function hashTemplateFiles(files = []) {
  const hash = crypto.createHash("sha256");
  [...new Set(files)].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).forEach((file) => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
    hash.update(path.basename(file));
    hash.update(fs.readFileSync(file));
  });
  return hash.digest("hex");
}

function normalizeTemplateName(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[|｜]/g, "×");
}

function matchOnlineTemplate(localTemplate = {}, onlineTemplates = []) {
  const localName = normalizeTemplateName(localTemplate.name);
  if (!localName) return null;
  const candidates = onlineTemplates.filter((item) => item?.url && item?.name);
  const exact = candidates.filter((item) => normalizeTemplateName(item.name) === localName);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const prefixed = candidates.filter((item) => {
    const onlineName = normalizeTemplateName(item.name);
    return onlineName.startsWith(`${localName}×`) || localName.startsWith(`${onlineName}×`);
  });
  return prefixed.length === 1 ? prefixed[0] : null;
}

function mapOnlineTemplates(templates = [], onlineTemplates = []) {
  const mapped = new Map();
  const assignedTemplateIds = new Set();
  const candidates = onlineTemplates.filter((item) => item?.url && item?.name);
  const tryAssign = (online, matcher) => {
    const matches = templates.filter((template) => matcher(template, online));
    if (matches.length !== 1) return;
    const templateId = String(matches[0].id);
    if (assignedTemplateIds.has(templateId)) return;
    mapped.set(templateId, online);
    assignedTemplateIds.add(templateId);
  };
  candidates.forEach((online) => {
    const explicitId = String(online.templateId || "").trim();
    if (!explicitId || assignedTemplateIds.has(explicitId)) return;
    const matches = templates.filter((template) => String(template.id) === explicitId);
    if (matches.length === 1) {
      mapped.set(explicitId, online);
      assignedTemplateIds.add(explicitId);
    }
  });
  candidates.forEach((online) => {
    if ([...mapped.values()].some((item) => item.url === online.url)) return;
    tryAssign(online, (template, item) => normalizeTemplateName(template.name) === normalizeTemplateName(item.name));
  });
  candidates.forEach((online) => {
    if ([...mapped.values()].some((item) => item.url === online.url)) return;
    tryAssign(online, (template, item) => {
      const localName = normalizeTemplateName(template.name);
      const onlineName = normalizeTemplateName(item.name);
      return onlineName.startsWith(`${localName}×`) || localName.startsWith(`${onlineName}×`);
    });
  });
  return mapped;
}

function inferTemplateTags(template = {}) {
  const text = [template.name, template.usage, template.note, template.path].filter(Boolean).join(" ");
  const has = (patterns) => patterns.some((pattern) => pattern.test(text));
  const isExplicitlyNonGame = /非\s*(?:小游戏|游戏模板)/i.test(text);
  const isGame = !isExplicitlyNonGame && has([/小游戏|游戏|破冰|真心话|大冒险|年会/i]);
  const tags = {
    traffic: has([/精准|路线|报价|预算|HR|行政|上海|长兴岛|莫干山|杭州|安吉|千岛湖|桐庐|一日团建|两天一夜/i]) ? "精准流量" : has([/合集|排行|TOP|清单|泛流量/i]) ? "泛流量" : "待确认",
    business: has([/转化|报价|预算|价格|私信|高转化/i]) ? "转化类" : has([/收藏|清单|攻略|避坑|项目合集/i]) ? "收藏类" : "待确认",
    content: isGame ? "小游戏" : has([/高奢|高端定制|定制游|奢华旅行/i]) ? "高奢定制游" : has([/水上|漂流|桨板|皮划艇|摩托艇|龙舟|玩水/i]) ? "水上团建" : has([/路线|一日游|两天一夜|目的地/i]) ? "路线方案" : has([/合集|项目总览|项目清单/i]) ? "项目合集" : "待确认",
    audience: has([/HR|行政|预算|报价|方案|团建/i]) ? "HR/行政" : has([/高奢|高端定制|定制游|高客单|商务车/i]) ? "高净值客户/企业定制" : "待确认",
    scene: has([/夏季|玩水|漂流|水上/i]) ? "夏季玩水" : has([/莫干山|长兴岛|上海|杭州|安吉|千岛湖|桐庐/i]) ? (text.match(/莫干山|长兴岛|上海|杭州|安吉|千岛湖|桐庐/) || ["地域待确认"])[0] : has([/酒店|住宿|商务车|文化体验|洱海|大理|云南/i]) ? "高端旅行场景" : "待确认",
    visual: [
      [/航拍|湖面|水域/, "航拍/湖面"],
      [/大字|标题|巨字|超大描边字/, "大字封面"],
      [/黑白描边|黑描边/, "黑白描边"],
      [/无白边/, "无白边拼图"],
      [/九宫格/, "九宫格"],
      [/四宫格|多宫格|拼图/, "拼图版式"],
      [/价格|报价|人均|\d+\s*元|\d+\s*\/人/, "封面带价格"],
      [/黄黑渐变|黄黑|黑黄/, "黄黑渐变"],
      [/黄块|黄色块|黄底/, "黄色信息块"],
      [/橙条|橙色信息条/, "橙色信息条"],
      [/蓝描边|蓝色描边/, "蓝描边"],
      [/上1下2|上大下双拼|上下双拼|上大下/, "上大下双拼"],
      [/路线节点|节点|路线/, "路线节点"],
      [/信息清单|清单|列表/, "信息清单"],
      [/全景|大景|实景大图/, "实景大图/全景"],
      [/高奢|暗色|深色|画册/, "高奢暗色画册"],
      [/双层|叠图|叠加/, "双层叠图"]
      ,[/顶部白字描边|顶部白字|白字描边/, "顶部白字描边"]
      ,[/中置白条黑粗字|白条黑粗字|中置白条/, "中置白条黑粗字"]
      ,[/双景|双场景/, "双场景封面"]
      ,[/话题内页|话题页/, "话题内页"]
    ].filter(([pattern]) => pattern.test(text)).map(([, tag]) => tag)
  };
  tags.all = [tags.traffic, tags.business, tags.content, tags.audience, tags.scene, ...tags.visual].filter((tag, index, all) => tag !== "待确认" && all.indexOf(tag) === index);
  return tags;
}

function buildTemplateRegistry(templates = [], existing = {}, options = {}) {
  const previous = new Map((existing.templates || []).map((item) => [String(item.templateId), item]));
  const onlineByTemplateId = mapOnlineTemplates(templates, options.onlineTemplates || []);
  const currentOnlineUrls = new Set([...onlineByTemplateId.values()].map((item) => String(item?.url || "").trim()).filter(Boolean));
  const now = options.now || new Date().toISOString();
  const rows = templates.filter((item) => item?.path && fs.existsSync(item.path)).map((template) => {
    const old = previous.get(String(template.id)) || {};
    const online = onlineByTemplateId.get(String(template.id)) || {};
    const files = Array.isArray(template.attachments) ? template.attachments : [];
    const localHash = hashTemplateFiles(files);
    const previousOnlineUrl = String(old.onlineUrl || "").trim();
    const onlineUrl = String(online.url || (currentOnlineUrls.has(previousOnlineUrl) ? "" : previousOnlineUrl)).trim();
    const onlineTitleCandidate = String(online.name || "").trim();
    const onlineTitle = onlineTitleCandidate && normalizeTemplateName(onlineTitleCandidate) !== normalizeTemplateName(template.name)
      ? onlineTitleCandidate
      : String(old.onlineTitle || "");
    let onlineStatus = onlineUrl ? (old.localHash && old.localHash !== localHash ? "update_required" : "uploaded") : "missing_online";
    if (ONLINE_STATES.has(old.onlineStatus) && ["invalid_online", "uploading", "error"].includes(old.onlineStatus)) {
      onlineStatus = old.onlineStatus;
    }
    const stats = files.filter((file) => fs.existsSync(file)).map((file) => fs.statSync(file));
    const updatedAt = stats.length ? new Date(Math.max(...stats.map((stat) => stat.mtimeMs))).toISOString() : "";
    return {
      templateId: String(template.id),
      name: String(template.name || path.basename(template.path)),
      // 记录首次进入模板仓库的时间；旧记录没有该字段时以本次扫描时间补齐。
      // 后续同步会沿用旧值，不会因为文件变动而重置“添加时间”。
      addedAt: String(old.addedAt || now),
      category: String(template.type || "unclassified"),
      enabled: template.status !== "停用",
      localPath: path.resolve(template.path),
      localVersion: localHash.slice(0, 12),
      localHash,
      localUpdatedAt: updatedAt,
      imageCount: Number(template.imageCount || 0),
      textCount: Number(template.textCount || 0),
      onlineStatus,
      onlineUrl,
      onlineTitle,
      onlineProvider: onlineUrl ? "chatgpt" : "",
      onlineAccountId: String(online.accountId || old.onlineAccountId || ""),
      onlineVersion: onlineUrl && onlineStatus === "uploaded" ? localHash.slice(0, 12) : String(old.onlineVersion || ""),
      onlineHash: onlineUrl && onlineStatus === "uploaded" ? localHash : String(old.onlineHash || ""),
      lastUploadedAt: String(old.lastUploadedAt || ""),
      lastVerifiedAt: onlineUrl ? now : "",
      description: String(template.description || template.note || old.description || old.notes || ""),
      notes: String(template.note || old.notes || old.description || "")
      ,tags: inferTemplateTags(template)
    };
  });
  const enabled = rows.filter((item) => item.enabled);
  const onlineMapped = enabled.filter((item) => item.onlineStatus === "uploaded").length;
  return {
    schemaVersion: 1,
    lastScannedAt: now,
    summary: {
      localTotal: enabled.length,
      onlineMapped,
      missingOnline: enabled.filter((item) => item.onlineStatus === "missing_online").length,
      updateRequired: enabled.filter((item) => item.onlineStatus === "update_required").length,
      disabled: rows.length - enabled.length,
      coveragePercent: enabled.length ? Number((onlineMapped / enabled.length * 100).toFixed(1)) : 0
    },
    templates: rows
  };
}

function renderTemplateRegistryMarkdown(registry) {
  const s = registry.summary;
  const lines = [
    "# 团建模板记录",
    "",
    `- 本地有效模板总数：${s.localTotal}`,
    `- 已存在有效在线链接：${s.onlineMapped}`,
    `- 缺少在线链接：${s.missingOnline}`,
    `- 本地已更新、在线待同步：${s.updateRequired}`,
    `- 已停用：${s.disabled}`,
    `- 在线覆盖率：${s.coveragePercent}%`,
    `- 最后扫描时间：${registry.lastScannedAt}`,
    "",
    "| ID | 模板名称 | 类型 | 图片/文本 | 在线状态 | 在线链接 | 本地版本 | 标签 | 模板描述 |",
    "|---|---|---|---:|---|---|---|---|---|"
  ];
  registry.templates.forEach((item) => lines.push(
    `| ${item.templateId} | ${item.name.replace(/\|/g, "\\|")} | ${item.category} | ${item.imageCount}/${item.textCount} | ${item.onlineStatus} | ${item.onlineUrl || "—"} | ${item.localVersion} | ${item.tags?.all?.join("、") || "待确认"} | ${(item.description || item.notes || "待补描述").replace(/\|/g, "\\|")} |`
  ));
  lines.push("", "> 本地模板库是资产真源；在线链接仅是镜像映射。`missing_online` 不会影响本地生产，但表示在线镜像尚未补齐。", "");
  return lines.join("\n");
}

module.exports = {
  buildTemplateRegistry,
  hashTemplateFiles,
  renderTemplateRegistryMarkdown,
  inferTemplateTags,
  matchOnlineTemplate,
  mapOnlineTemplates,
  normalizeTemplateName
};
