const fs = require("node:fs");
const path = require("node:path");
const { inferTemplateTags } = require("./template-registry");
const { normalizeScope } = require("./template-repository");

const TEMPLATE_METADATA_FILENAME = "template.json";
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const TEXT_EXTS = new Set([".txt", ".md"]);

function parseCsv(text = "") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text).replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function readMaterialRows(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function listFiles(folder, extensions) {
  if (!folder || !fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(folder, entry.name));
}

function imageCount(folder) {
  return listFiles(folder, IMAGE_EXTS).length;
}

function textCount(folder) {
  return listFiles(folder, TEXT_EXTS).length;
}

function sourceAccountFromFolder(folder = "") {
  const name = path.basename(String(folder || ""));
  const tagged = name.match(/-(TUTU-.+)$/i);
  if (tagged?.[1]) return tagged[1].trim();
  const match = name.match(/^评[^-]*-赞[^-]*-(.+)-([^-]+)$/);
  return match?.[2]?.trim() || "";
}

function extractNoteTags(folder = "") {
  const text = listFiles(folder, TEXT_EXTS)
    .map((file) => {
      try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
    })
    .join("\n");
  const tags = [];
  const seen = new Set();
  const add = (value) => {
    const tag = String(value || "").replace(/^#/, "").replace(/[\[\]话题：:，。！？!、；;].*$/, "").trim();
    if (!tag || tag.length > 40 || seen.has(tag)) return;
    seen.add(tag);
    tags.push(tag);
  };
  for (const match of text.matchAll(/#[\p{Script=Han}A-Za-z0-9_+&-]+/gu)) add(match[0]);
  return tags;
}

function sourcePlatform(sourceType = "", url = "") {
  if (/小红书|xhs/i.test(`${sourceType} ${url}`)) return "xiaohongshu";
  return sourceType || "";
}

function compactMaterial(row) {
  return {
    materialId: row["素材ID"] || "",
    originalTitle: row["标题"] || "",
    originalNoteUrl: row["链接"] || "",
    sourceType: row["来源类型"] || "",
    originalMaterialPath: row["原始素材路径"] || "",
    folder: row["素材文件夹"] || "",
    addedAt: row["添加时间"] || "",
    status: row["状态"] || "",
    templateId: row["模板ID"] || ""
  };
}

function buildTemplateMetadata({ template, registryItem = {}, materialRows = [], templateRoot, existing = {}, generatedAt, repositoryConfig = {} }) {
  const folder = path.resolve(template.path || registryItem.localPath || "");
  const linked = materialRows
    .filter((row) => String(row["模板ID"] || "").trim() === String(registryItem.templateId || template.id || "").trim())
    .sort((a, b) => String(b["添加时间"] || "").localeCompare(String(a["添加时间"] || "")));
  const primary = linked.find((row) => row["链接"] || row["素材文件夹"]) || linked[0] || {};
  const primaryFolder = primary["原始素材路径"] || primary["素材文件夹"] || "";
  const primaryFolderName = primary["素材文件夹"] || path.basename(primaryFolder);
  const noteTags = extractNoteTags(primaryFolder && fs.existsSync(primaryFolder) ? primaryFolder : "");
  const registryTags = registryItem.tags || inferTemplateTags({
    name: registryItem.name || template.name || path.basename(folder),
    usage: template.usage || "",
    note: registryItem.notes || template.note || "",
    path: folder
  });
  const oldSource = existing.source || {};
  const oldOnline = existing.online || {};
  const id = String(registryItem.templateId || template.id || "");
  const name = String(registryItem.name || template.name || path.basename(folder));
  const scope = normalizeScope(registryItem.scope || template.scope || {}, repositoryConfig);
  const metadata = {
    schemaVersion: 1,
    managedBy: "teambuilding-workflow-dashboard",
    generatedAt,
    template: {
      id,
      name,
      category: String(registryItem.category || template.type || "unclassified"),
      enabled: registryItem.enabled !== false,
      status: registryItem.onlineStatus || (id ? "registered" : "unregistered"),
      description: String(registryItem.description || registryItem.notes || template.description || template.note || existing.template?.description || ""),
      notes: String(registryItem.notes || template.note || existing.template?.notes || ""),
      scope
    },
    repository: {
      id: String(repositoryConfig.repository?.id || "template-repository"),
      name: String(repositoryConfig.repository?.name || "图文模板仓库"),
      mode: String(repositoryConfig.repository?.mode || "ai-maintained"),
      scope
    },
    tags: {
      template: registryTags,
      note: noteTags.length ? noteTags : (oldSource.noteTags || []),
      all: [...new Set([...(registryTags.all || []), ...noteTags])]
    },
    source: {
      platform: sourcePlatform(primary["来源类型"], primary["链接"]),
      originalTitle: primary["标题"] || oldSource.originalTitle || "",
      originalNoteUrl: primary["链接"] || oldSource.originalNoteUrl || "",
      account: sourceAccountFromFolder(primaryFolderName) || oldSource.account || "",
      materialId: primary["素材ID"] || oldSource.materialId || "",
      materialFolder: primaryFolder || oldSource.materialFolder || "",
      materialFolderName: primaryFolderName || oldSource.materialFolderName || "",
      capturedAt: primary["添加时间"] || oldSource.capturedAt || "",
      noteTags: noteTags.length ? noteTags : (oldSource.noteTags || [])
    },
    online: {
      provider: String(registryItem.onlineProvider || oldOnline.provider || ""),
      shareUrl: String(registryItem.onlineUrl || oldOnline.shareUrl || ""),
      templateName: String(registryItem.onlineTitle || oldOnline.templateName || ""),
      gptAccount: String(registryItem.onlineAccountId || oldOnline.gptAccount || ""),
      conversationUrl: String(oldOnline.conversationUrl || ""),
      status: String(registryItem.onlineStatus || oldOnline.status || "missing_online"),
      accountBinding: "一个在线链接只绑定它自身记录的 GPT 账号，不跨模板复用"
    },
    local: {
      absolutePath: folder,
      relativePath: templateRoot ? path.relative(templateRoot, folder).split(path.sep).join("/") : "",
      imageCount: Number(registryItem.imageCount || template.imageCount || imageCount(folder)),
      textCount: Number(registryItem.textCount || template.textCount || textCount(folder)),
      version: String(registryItem.localVersion || ""),
      preview: {
        cover: fs.existsSync(path.join(folder, "P1.jpg")) ? "P1.jpg" : "",
        innerFirst: fs.existsSync(path.join(folder, "P2.jpg")) ? "P2.jpg" : ""
      }
    },
    materials: linked.map(compactMaterial)
  };
  return metadata;
}

function syncTemplateMetadata({ templateRoot, registry, materialCsvPath, metadataFileName = TEMPLATE_METADATA_FILENAME, generatedAt = new Date().toISOString(), repositoryConfig = {} }) {
  const roots = ["已命名模板", "定制游模板"]
    .map((name) => path.join(templateRoot, name))
    .filter((root) => fs.existsSync(root));
  const folders = roots.flatMap((root) => fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name)));
  const registeredByPath = new Map((registry.templates || []).map((item) => [path.resolve(item.localPath), item]));
  const materialRows = readMaterialRows(materialCsvPath);
  let written = 0;
  let registered = 0;
  let unregistered = 0;
  folders.forEach((folder) => {
    const registryItem = registeredByPath.get(path.resolve(folder));
    if (registryItem) registered += 1;
    else unregistered += 1;
    const existingPath = path.join(folder, metadataFileName);
    const existing = readJson(existingPath);
    const template = registryItem || { id: "", name: path.basename(folder), path: folder, type: "unclassified" };
    const metadata = buildTemplateMetadata({ template, registryItem, materialRows, templateRoot, existing, generatedAt, repositoryConfig });
    const next = `${JSON.stringify(metadata, null, 2)}\n`;
    const previous = fs.existsSync(existingPath) ? fs.readFileSync(existingPath, "utf8") : "";
    if (previous !== next) {
      fs.writeFileSync(existingPath, next, "utf8");
      written += 1;
    }
  });
  return { metadataFileName, total: folders.length, registered, unregistered, written };
}

module.exports = {
  TEMPLATE_METADATA_FILENAME,
  parseCsv,
  extractNoteTags,
  sourceAccountFromFolder,
  buildTemplateMetadata,
  syncTemplateMetadata
};
