/**
 * 微信公众号贴图草稿发布器 - 后端核心模块
 *
 * 功能：
 * - 扫描作品集中的帖子（图片 + TXT文案）
 * - 解析TXT（标题=第一条非空行，正文=剩余内容）
 * - 图片自然排序
 * - 调用微信公众号官方API创建newspic草稿
 * - 原子 JSON 记录草稿历史与恢复状态
 * - 防重复（任务哈希）
 * - Dry-run测试模式
 *
 * 只创建草稿，严禁自动发表或群发。
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const { parsePlatformCopy } = require("../integrations/gpt-production-extension/gpt-automation-core");

// ─── 常量 ─────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const TXT_CANDIDATES = ["文案.txt", "copywriting.txt", "content.txt"];
const MAX_SCAN_DEPTH = 5;
const MAX_IMAGES = 10;
const MIN_IMAGES = 1;
const TITLE_TRIGGER = 24;
const TITLE_TARGET = 20;
const BODY_SOFT_LIMIT = 1000;

const WECHAT_API_BASE = "api.weixin.qq.com";
const PROCESS_INSTANCE_ID = `wechat-draft-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}
const TOKEN_CACHE_TTL = 1000 * 60 * 115; // 115分钟，提前5分钟刷新

// ─── SQLite 数据库 ────────────────────────────────────

let _db = null;
function getDbPath() {
  const root = process.env.TEAMBUILDING_DASHBOARD_RUNTIME
    || "D:\\AICode\\运行数据\\江湖有旅人\\团建工作台";
  return path.join(root, "wechat-draft-history.db");
}

function getDb() {
  if (_db) return _db;
  // 使用简单的 JSON 文件存储，避免引入 sqlite3 依赖
  // 如果需要 SQLite 可以后续升级，但 JSON 存储对本场景足够
  _db = {
    path: getDbPath().replace(/\.db$/, ".json"),
    read() {
      try {
        return JSON.parse(fs.readFileSync(this.path, "utf8"));
      } catch {
        return { records: [] };
      }
    },
    write(data) {
      writeJsonAtomic(this.path, data);
    }
  };
  return _db;
}

// ─── 设置文件 ─────────────────────────────────────────

function getSettingsPath() {
  const root = process.env.TEAMBUILDING_DASHBOARD_RUNTIME
    || "D:\\AICode\\运行数据\\江湖有旅人\\团建工作台";
  return path.join(root, "wechat-draft-settings.json");
}

function getWechatSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(getSettingsPath(), "utf8"));
    settings.engine = settings.engine === "api" ? "api" : "web";
    settings.draftType = settings.draftType === "article" ? "article" : "newspic";
    const accountKeys = Object.keys(settings.accounts || {});
    if (accountKeys.length > 0 && !settings.accounts?.[settings.defaultAccount]) {
      settings.defaultAccount = accountKeys[0];
    }
    return settings;
  } catch {
    return {
      engine: "web",
      draftType: "newspic",
      defaultAccount: "main",
      accounts: {},
      titleTrigger: TITLE_TRIGGER,
      titleTarget: TITLE_TARGET,
      bodySoftLimit: BODY_SOFT_LIMIT,
      maxImages: MAX_IMAGES
    };
  }
}

function saveWechatSettings(settings) {
  const current = getWechatSettings();
  const merged = {
    ...current,
    ...settings,
    accounts: {
      ...(current.accounts || {}),
      ...(settings.accounts || {})
    }
  };
  merged.engine = Object.prototype.hasOwnProperty.call(settings, "engine")
    ? (settings.engine === "api" ? "api" : "web")
    : (current.engine === "api" ? "api" : "web");
  merged.draftType = Object.prototype.hasOwnProperty.call(settings, "draftType")
    ? (settings.draftType === "article" ? "article" : "newspic")
    : (current.draftType === "article" ? "article" : "newspic");
  // 不允许通过API写入appSecret明文；账号编辑必须是账号级合并，不能覆盖其他账号
  for (const key of Object.keys(merged.accounts || {})) {
    merged.accounts[key] = {
      ...((current.accounts || {})[key] || {}),
      ...(merged.accounts[key] || {})
    };
    delete merged.accounts[key].appSecret;
  }
  writeJsonAtomic(getSettingsPath(), merged);
  return getWechatSettings();
}

// ─── 帖子扫描与解析 ───────────────────────────────────

/**
 * 自然排序比较器
 * 正确排序：1.jpg, 2.jpg, 10.jpg 而非 1.jpg, 10.jpg, 2.jpg
 */
function naturalCompare(a, b) {
  const collator = new Intl.Collator("zh", { numeric: true, sensitivity: "base" });
  return collator.compare(a, b);
}

/**
 * 在文件夹中查找TXT文案文件
 * 优先级：文案.txt > copywriting.txt > content.txt > 文件名含"文案"的TXT > 唯一TXT
 * 返回 { path, ambiguous } - ambiguous=true 表示有多个无法判断的TXT
 */
function findTxtFile(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const txtFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".txt"))
    .map((e) => e.name);

  if (txtFiles.length === 0) return null;

  // 按优先级查找
  for (const candidate of TXT_CANDIDATES) {
    const found = txtFiles.find((name) => name.toLowerCase() === candidate);
    if (found) return { path: path.join(dirPath, found), ambiguous: false };
  }

  // 文件名含"文案"的TXT
  const copywritingNamed = txtFiles.filter((name) => name.includes("文案"));
  if (copywritingNamed.length === 1) {
    return { path: path.join(dirPath, copywritingNamed[0]), ambiguous: false };
  }

  // 唯一TXT
  if (txtFiles.length === 1) {
    return { path: path.join(dirPath, txtFiles[0]), ambiguous: false };
  }

  // 多个无法判断
  return { path: null, ambiguous: true, candidates: txtFiles };
}

/**
 * 读取TXT文件内容，支持 UTF-8、UTF-8 BOM、GB18030
 */
function readTxtContent(filePath) {
  const buffer = fs.readFileSync(filePath);
  // 检测 BOM
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString("utf8");
  }
  // 尝试 UTF-8
  const utf8Content = buffer.toString("utf8");
  // 检测是否有乱码字符（常见 GB18030 被误解码的特征）
  if (!/\ufffd/.test(utf8Content) && !/[\u0400-\u04ff]/.test(utf8Content.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ""))) {
    return utf8Content;
  }
  // 回退到 GB18030
  try {
    const iconv = require("iconv-lite");
    return iconv.decode(buffer, "gb18030");
  } catch {
    // 没有 iconv-lite，直接返回 utf8
    return utf8Content;
  }
}

/**
 * 解析TXT内容为 { title, body }
 * 第一条非空行 = 标题，其余 = 正文（不包含标题行）
 */
function parseTxtContent(content) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const platformCopy = parsePlatformCopy(normalized);
  if (platformCopy.formatVersion === 2 && platformCopy.strict) {
    const xhs = parseTxtContent(platformCopy.xhs);
    const douyin = parseTxtContent(platformCopy.douyin);
    return {
      ...xhs,
      copyFormatVersion: 2,
      platformCopies: { xhs, douyin },
      platformCopy
    };
  }
  const lines = normalized.split("\n");

  // 找第一条非空行作为标题
  const wrapperLabel = /^(?:小红书(?:发布)?文案|发布文案)[：:]?$/i;
  const titleOnlyLabel = /^标题\s*[：:]\s*$/i;
  const bodyOnlyLabel = /^正文\s*[：:]?\s*$/i;
  let titleLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const value = lines[i].trim();
    if (value.length > 0 && !wrapperLabel.test(value) && !titleOnlyLabel.test(value)) {
      titleLine = i;
      break;
    }
  }

  if (titleLine === -1) {
    return { title: "", body: "" };
  }

  const title = lines[titleLine].trim().replace(/^标题\s*[：:]\s*/i, "").trim();
  // 正文 = 标题行之后的内容
  const bodyLines = lines.slice(titleLine + 1);
  while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
  if (bodyLines.length && bodyOnlyLabel.test(bodyLines[0].trim())) bodyLines.shift();
  let body = bodyLines.join("\n");
  // 压缩连续3个以上换行为2个
  body = body.replace(/\n{3,}/g, "\n\n");
  // 去掉首尾空白
  body = body.trim();

  return { title, body };
}

/**
 * 获取文件夹中的图片列表（自然排序）
 */
function listImages(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort(naturalCompare);
  } catch {
    return [];
  }
}

/**
 * 判断文件夹是否为有效帖子（至少1张图片 + 1个TXT）
 */
function isPostFolder(dirPath) {
  const images = listImages(dirPath);
  const txt = findTxtFile(dirPath);
  return images.length >= MIN_IMAGES && txt && !txt.ambiguous;
}

/**
 * 扫描作品集文件夹中的帖子
 * 一个作品集可能包含多个帖子（子文件夹），也可能自身就是一个帖子
 *
 * 返回 { posts, collectionName, collectionPath }
 * 每个 post: { name, path, imageCount, images, valid, invalidReason }
 */
function scanCollectionPosts(collectionPath) {
  const collectionName = path.basename(collectionPath);
  const posts = [];

  if (!fs.existsSync(collectionPath)) {
    return { collectionName, collectionPath, posts: [] };
  }

  // 先检查自身是否就是帖子
  if (isPostFolder(collectionPath)) {
    const images = listImages(collectionPath);
    const txt = findTxtFile(collectionPath);
    const content = readTxtContent(txt.path);
    const parsed = parseTxtContent(content);
    const { title, body } = parsed;
    const normalizedDraft = normalizeDraftContent(title, body);
    posts.push({
      name: collectionName,
      path: collectionPath,
      images,
      imageCount: images.length,
      valid: images.length >= MIN_IMAGES && images.length <= MAX_IMAGES,
      invalidReason: images.length > MAX_IMAGES ? `图片超过${MAX_IMAGES}张上限` : null,
      txtPath: txt.path,
      title,
      body,
      originalTitle: normalizedDraft.originalTitle,
      suggestedTitle: normalizedDraft.title,
      titleCompressed: normalizedDraft.titleCompressed,
      copyFormatVersion: parsed.copyFormatVersion || 1,
      platformCopies: parsed.platformCopies || null
    });
  }

  // 扫描子文件夹（递归最多5层）
  function scanDir(dirPath, depth) {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subPath = path.join(dirPath, entry.name);
      if (isPostFolder(subPath)) {
        // 避免重复添加（如果已经是collectionPath本身）
        if (subPath === collectionPath) continue;
        const images = listImages(subPath);
        const txt = findTxtFile(subPath);
        let title = "", body = "";
        let parsed = { copyFormatVersion: 1, platformCopies: null };
        if (txt && txt.path) {
          const content = readTxtContent(txt.path);
          parsed = parseTxtContent(content);
          title = parsed.title;
          body = parsed.body;
        }
        const normalizedDraft = normalizeDraftContent(title, body);
        posts.push({
          name: entry.name,
          path: subPath,
          images,
          imageCount: images.length,
          valid: images.length >= MIN_IMAGES && images.length <= MAX_IMAGES && txt && !txt.ambiguous,
          invalidReason: txt && txt.ambiguous ? "存在多个TXT文件，无法确定文案" : images.length > MAX_IMAGES ? `图片超过${MAX_IMAGES}张上限` : images.length < MIN_IMAGES ? "图片不足" : null,
          txtPath: txt ? txt.path : null,
          title,
          body,
          originalTitle: normalizedDraft.originalTitle,
          suggestedTitle: normalizedDraft.title,
          titleCompressed: normalizedDraft.titleCompressed,
          copyFormatVersion: parsed.copyFormatVersion || 1,
          platformCopies: parsed.platformCopies || null
        });
      } else {
        scanDir(subPath, depth + 1);
      }
    }
  }

  scanDir(collectionPath, 1);

  return { collectionName, collectionPath, posts };
}

// ─── 标题处理 ─────────────────────────────────────────

/**
 * 统计可见字符数（中文算1，Emoji算1，英文算1，空格不算）
 */
function countVisibleChars(text) {
  // 去掉空格后统计 Unicode 字符数
  // Emoji 和中文字符各算1个
  const trimmed = text.replace(/\s/g, "");
  // 使用 Array.from 正确处理 Emoji 和代理对
  return Array.from(trimmed).length;
}

/**
 * 生成超长标题建议（规则式压缩，非AI）
 */
function suggestShorterTitle(originalTitle, targetLength) {
  let title = originalTitle.trim();
  const chars = Array.from(title);

  if (chars.length <= targetLength) return title;

  // 规则1：去掉常见后缀营销词
  const marketingSuffixes = ["！快来试试", "！速来", "！收藏", "！点赞", "！关注", "！", "！！", "速来", "收藏", "点赞", "关注"];
  for (const suffix of marketingSuffixes) {
    if (title.endsWith(suffix)) {
      title = title.slice(0, -suffix.length).trim();
    }
  }

  // 规则2：如果仍超长，按目标长度截取（尽量在标点处断）
  const charsAfterRule1 = Array.from(title);
  if (charsAfterRule1.length <= targetLength) return title;

  // 找最后一个标点符号的位置（在目标长度附近）
  const punctuation = "，。！？、；：·…—~～";
  let cutPos = targetLength;
  for (let i = targetLength; i > targetLength * 0.6; i--) {
    if (punctuation.includes(charsAfterRule1[i - 1])) {
      cutPos = i;
      break;
    }
  }

  return charsAfterRule1.slice(0, cutPos).join("");
}

function normalizeDraftContent(title, body) {
  const originalTitle = String(title || "").trim();
  const sanitizedTitle = originalTitle
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0E\uFE0F\u20E3]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const normalizedBody = String(body || "").trim();
  const titleCompressed = countVisibleChars(originalTitle) > TITLE_TRIGGER;
  return {
    originalTitle,
    title: titleCompressed ? suggestShorterTitle(sanitizedTitle, TITLE_TARGET) : sanitizedTitle,
    body: normalizedBody,
    titleCompressed
  };
}

async function prepareWebDraftTask(options = {}) {
  const {
    postPath,
    title: requestedTitle,
    body: requestedBody,
    account = "web",
    draftType: requestedDraftType = "newspic",
    forceCreate = false
  } = options;
  const draftType = requestedDraftType === "article" ? "article" : "newspic";
  const normalizedContent = normalizeDraftContent(requestedTitle, requestedBody);
  const { originalTitle, body } = normalizedContent;
  let { title, titleCompressed } = normalizedContent;
  if (draftType === "newspic" && countVisibleChars(title) > 20) {
    title = suggestShorterTitle(title, 20);
    titleCompressed = true;
  }
  const images = listImages(postPath);
  if (images.length < MIN_IMAGES) return { success: false, error: "图片不足，至少需要1张" };
  if (images.length > MAX_IMAGES) return { success: false, error: `图片超过${MAX_IMAGES}张上限` };
  const imagePaths = images.map((name) => path.join(postPath, name));
  const imageHashes = [];
  for (const imagePath of imagePaths) imageHashes.push(await computeFileHash(imagePath));
  const taskHash = computeTaskHash(`${account}:${draftType}`, title, body, imageHashes);
  const existing = forceCreate ? null : findExistingDraft(taskHash);
  return {
    success: true,
    duplicate: Boolean(existing),
    previousRecord: existing || null,
    account,
    draftType,
    postPath,
    originalTitle,
    finalTitle: title,
    body,
    titleCompressed,
    imageCount: images.length,
    images,
    imagePaths,
    imageHashes,
    taskHash
  };
}

async function recordWebDraftSuccess(options = {}) {
  const prepared = await prepareWebDraftTask(options);
  if (!prepared.success) return prepared;
  if (prepared.duplicate) {
    return {
      success: true,
      duplicate: true,
      alreadyRecorded: true,
      engine: "web",
      draftType: prepared.draftType,
      dryRun: false,
      taskHash: prepared.taskHash,
      draftMediaId: prepared.previousRecord?.draftMediaId || "",
      previousRecord: prepared.previousRecord
    };
  }
  const bodyLength = countVisibleChars(prepared.body);
  const draftMediaId = `web_draft_${prepared.taskHash.slice(0, 20)}`;
  const record = {
    account: prepared.account,
    postPath: prepared.postPath,
    originalTitle: prepared.originalTitle,
    finalTitle: prepared.finalTitle,
    bodyLength,
    imageCount: prepared.imageCount,
    imageHashes: prepared.imageHashes,
    imageMediaIds: [],
    status: bodyLength > BODY_SOFT_LIMIT ? "success_with_warning" : "success",
    engine: "web",
    draftType: prepared.draftType,
    dryRun: false,
    draftMediaId,
    taskHash: prepared.taskHash
  };
  saveDraftRecord(record);
  return {
    success: true,
    duplicate: false,
    alreadyRecorded: false,
    engine: "web",
    draftType: prepared.draftType,
    dryRun: false,
    draftMediaId,
    taskHash: prepared.taskHash,
    finalTitle: prepared.finalTitle,
    titleCompressed: prepared.titleCompressed,
    bodyWarning: bodyLength > BODY_SOFT_LIMIT,
    message: "公众号原生网页已确认保存到草稿箱"
  };
}

// ─── 图片 SHA-256 ─────────────────────────────────────

function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// ─── 任务哈希（防重复）────────────────────────────────

function computeTaskHash(account, title, body, imageHashes) {
  const parts = [account, title, body, ...imageHashes];
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex");
}

// ─── 草稿历史记录 ─────────────────────────────────────

function getDraftHistory(limit = 50) {
  const db = getDb();
  const data = db.read();
  return (data.records || []).slice(-limit).reverse();
}

function saveDraftRecord(record) {
  const db = getDb();
  const data = db.read();
  if (!data.records) data.records = [];
  data.records.push({
    ...record,
    createdAt: new Date().toISOString()
  });
  // 只保留最近500条
  if (data.records.length > 500) {
    data.records = data.records.slice(-500);
  }
  db.write(data);
}

function findExistingDraft(taskHash) {
  const db = getDb();
  const data = db.read();
  return (data.records || []).find((record) => isDuplicateDraftRecord(record, taskHash));
}

function isSuccessfulDraftStatus(status) {
  return status === "success" || status === "success_with_warning";
}

function isDuplicateDraftRecord(record, taskHash) {
  return record.taskHash === taskHash
    && record.dryRun !== true
    && isSuccessfulDraftStatus(record.status);
}

// ─── 微信 API 调用 ────────────────────────────────────

let _tokenCache = new Map(); // account -> { token, expiresAt }

function applyWechatRequestTimeout(request, timeoutMs = 30_000) {
  request.setTimeout(timeoutMs, () => {
    request.destroy(new Error(`微信 API 请求超时（${Math.round(timeoutMs / 1000)} 秒）`));
  });
}

function httpRequest(method, hostname, urlPath, headers, body, isFormData = false) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      hostname,
      path: urlPath,
      headers: headers || {}
    };

    if (body && !isFormData) {
      const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
      options.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const statusCode = res.statusCode;
        resolve({ statusCode, buffer, headers: res.headers });
      });
    });
    applyWechatRequestTimeout(req);

    req.on("error", reject);

    if (body) {
      if (isFormData) {
        // body is a Buffer for form data
        req.write(body);
      } else {
        req.write(typeof body === "string" ? body : JSON.stringify(body));
      }
    }
    req.end();
  });
}

/**
 * 获取 access_token（带缓存）
 */
async function getAccessToken(appId, appSecret) {
  const cacheKey = appId;
  const cached = _tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const urlPath = `/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const result = await httpRequest("GET", WECHAT_API_BASE, urlPath, null, null);
  const data = JSON.parse(result.buffer.toString("utf8"));

  if (data.errcode) {
    throw new Error(`获取access_token失败 [${data.errcode}]: ${data.errmsg}`);
  }

  const token = data.access_token;
  const expiresIn = data.expires_in || 7200;
  _tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + (expiresIn - 300) * 1000 // 提前5分钟过期
  });

  return token;
}

/**
 * 上传永久素材图片，返回 media_id
 */
async function uploadMaterial(accessToken, imagePath) {
  const fileBuffer = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp"
  };
  const mimeType = mimeTypes[ext] || "application/octet-stream";

  const boundary = "----WebKitFormBoundary" + crypto.randomBytes(16).toString("hex");
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, footer]);

  const urlPath = `/cgi-bin/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=image`;
  const result = await httpRequest("POST", WECHAT_API_BASE, urlPath, {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": body.length
  }, body, true);

  const data = JSON.parse(result.buffer.toString("utf8"));
  if (data.errcode) {
    throw new Error(`上传素材失败 [${data.errcode}]: ${data.errmsg}（文件: ${fileName}）`);
  }
  return data.media_id;
}

/**
 * 创建 newspic 草稿
 */
async function createDraft(accessToken, article) {
  const urlPath = `/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`;
  const body = { articles: [article] };
  const result = await httpRequest("POST", WECHAT_API_BASE, urlPath, {
    "Content-Type": "application/json"
  }, body);

  const data = JSON.parse(result.buffer.toString("utf8"));
  if (data.errcode) {
    throw new Error(`创建草稿失败 [${data.errcode}]: ${data.errmsg}`);
  }
  return data.media_id;
}

// ─── 创建草稿任务（完整流程）──────────────────────────

/**
 * 完整的草稿创建流程
 *
 * @param {Object} options
 * @param {string} options.postPath - 帖子文件夹路径
 * @param {string} options.title - 最终标题
 * @param {string} options.body - 正文
 * @param {string} options.account - 账号key
 * @param {boolean} options.dryRun - 测试模式
 * @param {boolean} options.forceCreate - 强制重复创建
 * @param {string} options.appId - 微信AppID
 * @param {string} options.appSecret - 微信AppSecret
 * @returns {Object} 创建结果
 */
async function createDraftTask(options) {
  const {
    postPath,
    title: requestedTitle,
    body: requestedBody,
    account = "main",
    dryRun = true,
    forceCreate = false,
    appId,
    appSecret
  } = options;
  const normalizedContent = normalizeDraftContent(requestedTitle, requestedBody);
  const { originalTitle, title, body, titleCompressed } = normalizedContent;

  // 1. 获取图片列表（自然排序）
  const images = listImages(postPath);
  if (images.length < MIN_IMAGES) {
    return { success: false, error: "图片不足，至少需要1张" };
  }
  if (images.length > MAX_IMAGES) {
    return { success: false, error: `图片超过${MAX_IMAGES}张上限` };
  }

  // 2. 计算图片SHA-256
  const imagePaths = images.map((name) => path.join(postPath, name));
  const imageHashes = [];
  for (const imgPath of imagePaths) {
    imageHashes.push(await computeFileHash(imgPath));
  }

  // 3. 计算任务哈希，检查重复
  const taskHash = computeTaskHash(account, title, body, imageHashes);
  if (!forceCreate) {
    const existing = findExistingDraft(taskHash);
    if (existing) {
      return {
        success: false,
        duplicate: true,
        message: "该帖子已成功创建过草稿",
        previousRecord: existing
      };
    }
  }

  // 4. Dry-run 模式
  if (dryRun) {
    const mockMediaIds = imageHashes.map((h, i) => `dry_run_media_${i + 1}_${h.slice(0, 8)}`);
    const mockDraftId = `dry_run_draft_${taskHash.slice(0, 16)}`;
    const record = {
      account,
      postPath,
      originalTitle,
      finalTitle: title,
      bodyLength: countVisibleChars(body),
      imageCount: images.length,
      imageHashes,
      imageMediaIds: mockMediaIds,
      status: "success",
      dryRun: true,
      draftMediaId: mockDraftId,
      taskHash
    };
    saveDraftRecord(record);
    return {
      success: true,
      dryRun: true,
      draftMediaId: mockDraftId,
      imageMediaIds: mockMediaIds,
      taskHash,
      finalTitle: title,
      titleCompressed,
      message: "测试模式：草稿创建模拟成功"
    };
  }

  // 5. 真实模式：获取 access_token
  if (!appId || !appSecret) {
    return { success: false, error: "缺少 AppID 或 AppSecret，无法调用微信API" };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(appId, appSecret);
  } catch (error) {
    const record = {
      account, postPath, finalTitle: title, bodyLength: countVisibleChars(body),
      imageCount: images.length, imageHashes, status: "failed",
      errorCode: "TOKEN_ERROR", errorMessage: error.message, taskHash
    };
    saveDraftRecord(record);
    return { success: false, error: error.message, stage: "token" };
  }

  // 6. 上传图片素材
  let imageMediaIds = [];
  try {
    imageMediaIds = await resolveImageMediaIds({
      accessToken,
      account,
      imagePaths,
      imageHashes,
      uploadFn: uploadMaterial
    });
  } catch (error) {
    const failedImageIndex = Number.isInteger(error.failedImageIndex) ? error.failedImageIndex : imageMediaIds.length;
    const record = {
      account, postPath, finalTitle: title, bodyLength: countVisibleChars(body),
      imageCount: images.length, imageHashes,
      imageMediaIds: error.imageMediaIds || imageMediaIds,
      status: "failed_after_upload",
      errorCode: "UPLOAD_ERROR", errorMessage: error.message, taskHash,
      failedImageIndex,
      failedImageName: images[failedImageIndex]
    };
    saveDraftRecord(record);
    return { success: false, error: error.message, stage: "upload", failedImageIndex };
  }

  // 7. 创建草稿
  const article = {
    article_type: "newspic",
    title,
    content: body,
    need_open_comment: 0,
    only_fans_can_comment: 0,
    image_info: {
      image_list: imageMediaIds.map((id) => ({ image_media_id: id }))
    }
  };

  try {
    const draftMediaId = await createDraft(accessToken, article);
    const bodyLength = countVisibleChars(body);
    const isOverLimit = bodyLength > BODY_SOFT_LIMIT;
    const record = {
      account,
      postPath,
      originalTitle,
      finalTitle: title,
      bodyLength,
      imageCount: images.length,
      imageHashes,
      imageMediaIds,
      status: isOverLimit ? "success_with_warning" : "success",
      dryRun: false,
      draftMediaId,
      taskHash
    };
    saveDraftRecord(record);
    return {
      success: true,
      dryRun: false,
      draftMediaId,
      imageMediaIds,
      taskHash,
      finalTitle: title,
      titleCompressed,
      bodyWarning: isOverLimit,
      message: isOverLimit ? "草稿创建成功（正文超过1000字，请检查公众号后台）" : "草稿创建成功"
    };
  } catch (error) {
    const record = {
      account, postPath, finalTitle: title, bodyLength: countVisibleChars(body),
      imageCount: images.length, imageHashes, imageMediaIds,
      status: "failed",
      errorCode: "DRAFT_ERROR", errorMessage: error.message, taskHash
    };
    saveDraftRecord(record);
    return { success: false, error: error.message, stage: "draft" };
  }
}

// ─── 批量草稿队列 ─────────────────────────────────────

function getBatchQueuePath() {
  const root = process.env.TEAMBUILDING_DASHBOARD_RUNTIME
    || "D:\\AICode\\运行数据\\江湖有旅人\\团建工作台";
  return path.join(root, "wechat-batch-queue.json");
}

function getBatchQueue() {
  try {
    return JSON.parse(fs.readFileSync(getBatchQueuePath(), "utf8"));
  } catch {
    return { batchId: null, status: "idle", items: [], createdAt: null };
  }
}

function writeBatchQueue(data) {
  writeJsonAtomic(getBatchQueuePath(), data);
}

function createBatchQueue(posts) {
  const batchId = `batch_${Date.now()}`;
  const items = posts.map((post, index) => ({
    id: index,
    postPath: post.postPath || "",
    title: post.title || "",
    body: post.body || "",
    status: "pending",
    draftMediaId: null,
    error: null,
    processedAt: null
  }));
  const queue = {
    batchId,
    status: "pending",
    items,
    createdAt: new Date().toISOString()
  };
  writeBatchQueue(queue);
  return batchId;
}

function updateBatchItem(batchId, itemId, updates) {
  const queue = getBatchQueue();
  if (queue.batchId !== batchId) return;
  const item = queue.items.find((it) => it.id === itemId);
  if (!item) return;
  Object.assign(item, updates);
  writeBatchQueue(queue);
}

function updateBatchStatus(batchId, status) {
  const queue = getBatchQueue();
  if (queue.batchId !== batchId) return;
  queue.status = status;
  writeBatchQueue(queue);
}

function markBatchItemProcessing(batchId, itemId) {
  updateBatchItem(batchId, itemId, {
    status: "processing",
    workerId: PROCESS_INSTANCE_ID,
    startedAt: new Date().toISOString(),
    error: null
  });
}

function recoverInterruptedBatchQueue() {
  const queue = getBatchQueue();
  if (!queue.batchId || queue.status === "cancelled") return queue;

  let changed = false;
  for (const item of queue.items) {
    if (item.status !== "processing" || item.workerId === PROCESS_INSTANCE_ID) continue;
    item.status = "pending";
    item.recoveryCount = Number(item.recoveryCount || 0) + 1;
    item.error = "上次处理被中断，已自动恢复为待处理";
    item.recoveredAt = new Date().toISOString();
    item.workerId = null;
    item.startedAt = null;
    changed = true;
  }
  if (changed) {
    queue.status = "pending";
    writeBatchQueue(queue);
  }
  return queue;
}

function clearBatchQueue() {
  try {
    fs.unlinkSync(getBatchQueuePath());
  } catch {
    // 文件不存在不算错误
  }
}

// ─── 图片素材复用 ─────────────────────────────────────

function getMaterialMappingPath() {
  const root = process.env.TEAMBUILDING_DASHBOARD_RUNTIME
    || "D:\\AICode\\运行数据\\江湖有旅人\\团建工作台";
  return path.join(root, "wechat-material-mapping.json");
}

function getMaterialMapping() {
  try {
    return JSON.parse(fs.readFileSync(getMaterialMappingPath(), "utf8"));
  } catch {
    return { mappings: [] };
  }
}

function writeMaterialMapping(data) {
  writeJsonAtomic(getMaterialMappingPath(), data);
}

function recordMaterialMapping(imageHash, mediaId, account) {
  const data = getMaterialMapping();
  // 去重：相同 hash + account 更新 mediaId
  const existing = data.mappings.find(
    (m) => m.imageHash === imageHash && m.account === account
  );
  if (existing) {
    existing.mediaId = mediaId;
    existing.createdAt = new Date().toISOString();
  } else {
    data.mappings.push({
      imageHash,
      mediaId,
      account,
      createdAt: new Date().toISOString()
    });
  }
  writeMaterialMapping(data);
}

function findReusableMediaId(imageHash, account) {
  const data = getMaterialMapping();
  const found = data.mappings.find(
    (m) => m.imageHash === imageHash && m.account === account
  );
  return found ? found.mediaId : null;
}

async function resolveImageMediaIds({ accessToken, account, imagePaths, imageHashes, uploadFn = uploadMaterial }) {
  const mediaIds = [];
  for (let index = 0; index < imagePaths.length; index++) {
    const existing = findReusableMediaId(imageHashes[index], account);
    if (existing) {
      mediaIds.push(existing);
      continue;
    }
    try {
      const mediaId = await uploadFn(accessToken, imagePaths[index]);
      recordMaterialMapping(imageHashes[index], mediaId, account);
      mediaIds.push(mediaId);
    } catch (error) {
      error.failedImageIndex = index;
      error.imageMediaIds = mediaIds.slice();
      throw error;
    }
  }
  return mediaIds;
}

// ─── 导出 ─────────────────────────────────────────────

module.exports = {
  writeJsonAtomic,
  applyWechatRequestTimeout,
  // 常量
  IMAGE_EXTENSIONS,
  MAX_IMAGES,
  MIN_IMAGES,
  TITLE_TRIGGER,
  TITLE_TARGET,
  BODY_SOFT_LIMIT,
  // 设置
  getWechatSettings,
  saveWechatSettings,
  // 扫描与解析
  scanCollectionPosts,
  listImages,
  findTxtFile,
  parseTxtContent,
  parsePlatformCopy,
  readTxtContent,
  countVisibleChars,
  suggestShorterTitle,
  normalizeDraftContent,
  // 草稿创建
  createDraftTask,
  prepareWebDraftTask,
  recordWebDraftSuccess,
  getDraftHistory,
  findExistingDraft,
  isSuccessfulDraftStatus,
  isDuplicateDraftRecord,
  computeFileHash,
  computeTaskHash,
  // 微信API（供测试用）
  getAccessToken,
  uploadMaterial,
  createDraft,
  // 批量草稿队列
  createBatchQueue,
  getBatchQueue,
  updateBatchItem,
  updateBatchStatus,
  markBatchItemProcessing,
  recoverInterruptedBatchQueue,
  clearBatchQueue,
  // 图片素材复用
  recordMaterialMapping,
  findReusableMediaId,
  resolveImageMediaIds
};
