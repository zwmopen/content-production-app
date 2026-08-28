"use strict";

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const PLATFORM_DEFINITIONS = Object.freeze([
  {
    id: "wechat",
    name: "公众号",
    status: "connected",
    statusLabel: "已接入",
    engine: "wechat-native",
    capabilities: ["image-text"],
    note: "沿用工作台现有公众号草稿链路。"
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    engine: "xiaohongshu-mcp",
    recommendedEndpoint: "http://127.0.0.1:18060/mcp",
    recommendedMode: "mcp-http",
    capabilities: ["image-text", "video"],
    note: "优先复用开源小红书 MCP；需在本机配置适配器端点。"
  },
  {
    id: "douyin",
    name: "抖音",
    status: "assisted",
    statusLabel: "可手动发布",
    engine: "douyin-creator-web",
    handoffUrl: "https://creator.douyin.com/",
    capabilities: ["video", "image-text"],
    manualHandoff: true,
    note: "接入抖音创作者中心：复用当前成品并打开官方发布页，由你在已有登录态内完成上传、预览和发布确认。"
  },
  {
    id: "x",
    name: "X / 推特",
    status: "assisted",
    statusLabel: "可手动发布",
    engine: "x-web",
    handoffUrl: "https://x.com/compose/post",
    capabilities: ["text", "image", "video"],
    manualHandoff: true,
    note: "接入 X / 推特官方发帖页：复用当前成品并打开官方页面，由你在已有登录态内完成上传、预览和发布确认。"
  },
  {
    id: "ctrip",
    name: "携程旅行",
    status: "assisted",
    statusLabel: "可手动发布",
    engine: "ctrip-content-center",
    handoffUrl: "https://we.ctrip.com/publish/contentManagement",
    capabilities: ["image-text"],
    manualHandoff: true,
    note: "接入原生携程内容中心：复用左侧成品，逐篇打开官方图文编辑器并只保存到草稿箱；正式发布仍由你人工确认。"
  }
]);

const ENGINE_DEFINITIONS = Object.freeze({
  "wechat-native": {
    name: "工作台公众号链路",
    repository: null,
    kind: "built-in"
  },
  "xiaohongshu-mcp": {
    name: "小红书 MCP",
    repository: "https://github.com/xpzouying/xiaohongshu-mcp",
    kind: "external"
  },
  aitoearn: {
    name: "AiToEarn",
    repository: "https://github.com/yikart/AiToEarn",
    kind: "external"
  },
  "douyin-creator-web": {
    name: "抖音创作者中心（原生网页）",
    repository: "https://creator.douyin.com/",
    kind: "official-web"
  },
  "x-web": {
    name: "X / 推特（原生网页）",
    repository: "https://x.com/compose/post",
    kind: "official-web"
  },
  "ctrip-content-center": {
    name: "携程内容中心（原生网页）",
    repository: "https://we.ctrip.com/publish/contentManagement",
    kind: "official-web"
  }
});

const PLATFORM_ALIASES = Object.freeze({
  wechat: "wechat",
  official: "wechat",
  "公众号": "wechat",
  xiaohongshu: "xiaohongshu",
  xhs: "xiaohongshu",
  "小红书": "xiaohongshu",
  douyin: "douyin",
  "抖音": "douyin",
  x: "x",
  twitter: "x",
  "推特": "x",
  "x/twitter": "x",
  ctrip: "ctrip",
  trip: "ctrip",
  "携程": "ctrip",
  "携程旅行": "ctrip"
});

function normalizePlatformId(value) {
  const key = String(value || "").trim().toLowerCase();
  return PLATFORM_ALIASES[key] || "";
}

function readRuntimeConfig(configPath) {
  if (!configPath) return { adapters: {}, invalid: false };
  try {
    if (!fs.existsSync(configPath)) return { adapters: {}, invalid: false };
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const adapters = parsed && typeof parsed.adapters === "object" ? parsed.adapters : {};
    return { adapters, invalid: false };
  } catch {
    return { adapters: {}, invalid: true };
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost"
    || host === "127.0.0.1"
    || host === "[::1]"
    || host === "::1";
}

function normalizeAdapter(raw) {
  if (!raw || typeof raw !== "object") return null;
  const endpoint = String(raw.endpoint || "").trim();
  if (!endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    const local = isLoopbackHost(parsed.hostname);
    const remoteAllowed = raw.allowRemote === true && parsed.protocol === "https:";
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:") || (!local && !remoteAllowed)) {
      return { invalid: true };
    }
    const headers = raw.headers && typeof raw.headers === "object" ? raw.headers : {};
    return {
      mode: raw.mode || "http-json",
      endpoint: parsed.toString(),
      engine: String(raw.engine || "").trim() || null,
      tool: String(raw.tool || "").trim() || null,
      platformKey: String(raw.platformKey || "").trim() || null,
      accountId: String(raw.accountId || "").trim() || null,
      accountIds: raw.accountIds && typeof raw.accountIds === "object"
        ? Object.fromEntries(Object.entries(raw.accountIds)
          .filter(([key, value]) => /^[a-z0-9_-]+$/i.test(key) && typeof value === "string" && value.trim())
          .slice(0, 20))
        : {},
      uploadFileField: String(raw.uploadFileField || "file").trim() || "file",
      timeoutMs: Math.min(Math.max(Number(raw.timeoutMs) || 30_000, 1_000), 120_000),
      pollIntervalMs: Math.min(Math.max(Number(raw.pollIntervalMs) || 5_000, 1_000), 30_000),
      pollTimeoutMs: Math.min(Math.max(Number(raw.pollTimeoutMs) || 120_000, 5_000), 600_000),
      headers: Object.fromEntries(Object.entries(headers)
        .filter(([key, value]) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) && typeof value === "string")
        .slice(0, 20))
    };
  } catch {
    return { invalid: true };
  }
}

function publicEngine(engineId) {
  if (!engineId) return null;
  const engine = ENGINE_DEFINITIONS[engineId];
  if (!engine) return { id: engineId, name: engineId, repository: null, kind: "external" };
  return { id: engineId, ...engine };
}

function getPlatformCatalog(options = {}) {
  const runtime = readRuntimeConfig(options.configPath);
  return PLATFORM_DEFINITIONS.map((definition) => {
    const configured = normalizeAdapter(runtime.adapters[definition.id]);
    const builtin = definition.id === "wechat";
    const manualHandoff = Boolean(definition.manualHandoff && configured?.engine !== "aitoearn");
    let status = definition.status || "pending";
    let statusLabel = definition.statusLabel || "待接入";
    let reason = definition.note;
    if (!builtin && !manualHandoff && definition.engine && configured && !configured.invalid) {
      status = "configured";
      statusLabel = "已配置·待实测";
      reason = "已找到外部适配器配置；真实发布前仍需人工确认并完成一次实测。";
    } else if (!builtin && !manualHandoff && configured?.invalid) {
      status = "invalid-config";
      statusLabel = "配置无效";
      reason = "适配器端点必须是本机 HTTP/HTTPS，或明确允许的 HTTPS 远端端点。";
    } else if (!builtin && definition.engine && !manualHandoff) {
      status = "pending";
      statusLabel = "待配置";
      reason = definition.note;
    }
    return {
      id: definition.id,
      name: definition.name,
      status,
      statusLabel,
      engine: publicEngine(configured?.engine || definition.engine),
      adapterMode: configured?.mode || null,
      recommendedEndpoint: definition.recommendedEndpoint || null,
      recommendedMode: definition.recommendedMode || null,
      handoffUrl: definition.handoffUrl || null,
      manualHandoff,
      capabilities: [...definition.capabilities],
      note: reason,
      configured: Boolean(builtin || (configured && !configured.invalid && !manualHandoff))
    };
  });
}

function getRuntimeAdapter(configPath, platformId) {
  const runtime = readRuntimeConfig(configPath);
  return normalizeAdapter(runtime.adapters[platformId]);
}

function cleanText(value, maxLength, fieldName) {
  const text = String(value || "").trim();
  if (text.length > maxLength) {
    const error = new Error(`${fieldName} 不能超过 ${maxLength} 个字符`);
    error.code = "PUBLISH_PACKAGE_INVALID";
    throw error;
  }
  return text;
}

function validatePublishPackage(input = {}, options = {}) {
  const platform = normalizePlatformId(input.platform);
  if (!platform) {
    const error = new Error("未识别的发布平台");
    error.code = "PUBLISH_PLATFORM_INVALID";
    throw error;
  }
  const title = cleanText(input.title, 200, "标题");
  const body = cleanText(input.body, 20_000, "正文");
  if (!title && platform !== "x") {
    const error = new Error("发布包缺少标题");
    error.code = "PUBLISH_PACKAGE_INVALID";
    throw error;
  }
  if (!body) {
    const error = new Error("发布包缺少正文");
    error.code = "PUBLISH_PACKAGE_INVALID";
    throw error;
  }
  const images = Array.isArray(input.images) ? input.images.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 30) : [];
  const video = String(input.video || "").trim();
  for (const file of [...images, ...(video ? [video] : [])]) {
    if (typeof options.isAllowedFile === "function" && (!options.isAllowedFile(file) || options.exists && !options.exists(file))) {
      const error = new Error("发布包包含不允许或不存在的本地文件");
      error.code = "PUBLISH_ASSET_NOT_ALLOWED";
      throw error;
    }
  }
  if (!images.length && !video && platform !== "x") {
    const error = new Error("发布包至少需要一张图片或一个视频");
    error.code = "PUBLISH_PACKAGE_INVALID";
    throw error;
  }
  return {
    platform,
    title,
    body,
    images,
    video,
    sourceCollection: cleanText(input.sourceCollection, 240, "来源作品集"),
    workId: cleanText(input.workId, 160, "作品 ID")
  };
}

function publicPublishPackage(packageData) {
  return {
    platform: packageData.platform,
    title: packageData.title,
    bodyLength: packageData.body.length,
    imageCount: packageData.images.length,
    hasVideo: Boolean(packageData.video),
    sourceCollection: packageData.sourceCollection,
    workId: packageData.workId
  };
}

function createTaskId() {
  return `platform-publish-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function redactOutput(value) {
  return String(value || "")
    .replace(/(authorization|token|secret|cookie|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 2_000);
}

function adapterConnectionError(adapter, error, protocolLabel = "外部适配器") {
  if (error?.code) return error;
  const endpoint = String(adapter?.endpoint || "未配置端点");
  const wrapped = new Error(`${protocolLabel}无法连接：${endpoint}。请确认服务已启动、端口可访问，再重试。`);
  wrapped.code = error?.name === "AbortError" ? "PLATFORM_ADAPTER_TIMEOUT" : "PLATFORM_ADAPTER_UNREACHABLE";
  wrapped.detail = redactOutput(error?.message || error);
  return wrapped;
}

function aiToEarnUrl(adapter, pathname) {
  const base = new URL(adapter.endpoint);
  const basePath = base.pathname.replace(/\/+$/, "");
  return new URL(`${basePath}${pathname.startsWith("/") ? pathname : `/${pathname}`}`, base.origin).toString();
}

async function aiToEarnRequest(adapter, pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), adapter.timeoutMs);
  try {
    const headers = { Accept: "application/json", ...adapter.headers };
    const request = { method: options.method || "GET", headers, signal: controller.signal };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(options.body);
    }
    const response = await fetch(aiToEarnUrl(adapter, pathname), request);
    const responseText = await response.text();
    let responseBody = null;
    try { responseBody = responseText ? JSON.parse(responseText) : null; } catch { responseBody = null; }
    if (!response.ok || (responseBody && responseBody.code !== undefined && Number(responseBody.code) !== 0)) {
      const error = new Error(responseBody?.message || `AiToEarn 适配器返回 HTTP ${response.status}`);
      error.code = "PLATFORM_ADAPTER_FAILED";
      error.detail = redactOutput(responseBody ? JSON.stringify(responseBody) : responseText);
      throw error;
    }
    return responseBody;
  } catch (error) {
    throw adapterConnectionError(adapter, error, "AiToEarn 适配器");
  } finally {
    clearTimeout(timer);
  }
}

function assetMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm"
  }[extension] || "application/octet-stream";
}

async function uploadAiToEarnAsset(adapter, filePath) {
  let stat;
  let bytes;
  try {
    stat = fs.statSync(filePath);
    bytes = fs.readFileSync(filePath);
  } catch {
    const error = new Error(`本地素材无法读取：${filePath}`);
    error.code = "PLATFORM_ASSET_READ_FAILED";
    throw error;
  }
  const filename = path.basename(filePath);
  const signed = await aiToEarnRequest(adapter, "/api/assets/uploadSign", {
    method: "POST",
    body: { filename, type: "temp", size: stat.size }
  });
  const upload = signed?.data;
  if (!upload?.id || !upload.uploadUrl) {
    const error = new Error("AiToEarn 没有返回可用的素材上传地址");
    error.code = "PLATFORM_ADAPTER_PROTOCOL_INVALID";
    throw error;
  }
  const form = new FormData();
  Object.entries(upload.uploadFields || {}).forEach(([key, value]) => form.append(key, String(value)));
  form.append(adapter.uploadFileField, new Blob([bytes], { type: assetMimeType(filePath) }), filename);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), adapter.timeoutMs);
  try {
    const uploadResponse = await fetch(upload.uploadUrl, { method: "POST", body: form, signal: controller.signal });
    if (!uploadResponse.ok) {
      const error = new Error(`AiToEarn 素材直传失败 HTTP ${uploadResponse.status}`);
      error.code = "PLATFORM_ADAPTER_FAILED";
      throw error;
    }
  } catch (error) {
    throw adapterConnectionError(adapter, error, "AiToEarn 素材上传");
  } finally {
    clearTimeout(timer);
  }
  const confirmed = await aiToEarnRequest(adapter, `/api/assets/${encodeURIComponent(upload.id)}/confirm`, { method: "POST" });
  const asset = confirmed?.data;
  if (!asset?.url) {
    const error = new Error("AiToEarn 素材确认没有返回访问地址");
    error.code = "PLATFORM_ADAPTER_PROTOCOL_INVALID";
    throw error;
  }
  return { url: asset.url, type: assetMimeType(filePath).startsWith("video/") ? "video" : "image" };
}

function aiToEarnPlatformKey(packageData, adapter) {
  if (adapter.platformKey) return adapter.platformKey;
  return packageData.platform === "x" ? "twitter" : packageData.platform;
}

async function resolveAiToEarnAccount(adapter, packageData, platformKey) {
  const configured = adapter.accountIds?.[packageData.platform] || adapter.accountId;
  if (configured) return configured;
  const accounts = await aiToEarnRequest(adapter, "/api/v2/channels/accounts");
  const list = Array.isArray(accounts?.data) ? accounts.data : Array.isArray(accounts?.data?.items) ? accounts.data.items : [];
  const aliases = new Set([platformKey.toLowerCase(), packageData.platform.toLowerCase(), packageData.platform === "x" ? "x" : ""]);
  const match = list.find((item) => aliases.has(String(item.platform || item.channel || "").toLowerCase()) && item.id);
  if (match) return String(match.id);
  const error = new Error(`AiToEarn 没有找到已授权的${packageData.platform === "x" ? "X / 推特" : packageData.platform}账号；请先授权账号，或在运行配置中填写 accountId`);
  error.code = "PLATFORM_ACCOUNT_NOT_CONFIGURED";
  error.detail = `platform=${platformKey}`;
  throw error;
}

function aiToEarnTaskState(task) {
  const status = Number(task?.status);
  if ([-1, 5, 9].includes(status) || task?.errorMsg) return "failed";
  if (status === 8) return "waiting-user-action";
  if ([0, 2, 6].includes(status)) return "running";
  if (task?.platformWorkId || task?.workLink) return "succeeded";
  return "running";
}

async function pollAiToEarnFlow(adapter, flowId, platformKey) {
  const deadline = Date.now() + adapter.pollTimeoutMs;
  let latest = null;
  while (Date.now() <= deadline) {
    latest = await aiToEarnRequest(adapter, `/api/v2/channels/publish/flows/${encodeURIComponent(flowId)}`);
    const tasks = Array.isArray(latest?.data?.tasks) ? latest.data.tasks : [];
    if (tasks.length) {
      const states = tasks.map(aiToEarnTaskState);
      if (states.includes("failed")) {
        const failed = tasks.find((task) => aiToEarnTaskState(task) === "failed");
        const error = new Error(`AiToEarn ${platformKey} 发布失败：${failed?.errorMsg || "平台任务返回失败"}`);
        error.code = "PLATFORM_ADAPTER_FAILED";
        error.detail = redactOutput(JSON.stringify(failed || {}));
        throw error;
      }
      if (states.includes("waiting-user-action")) {
        const waiting = tasks.find((task) => aiToEarnTaskState(task) === "waiting-user-action");
        let userAction = null;
        if (waiting?.id) {
          try {
            const action = await aiToEarnRequest(adapter, `/api/v2/channels/publish/records/${encodeURIComponent(waiting.id)}/user-action`);
            userAction = action?.data || null;
          } catch (error) {
            userAction = { error: error.message };
          }
        }
        return {
          ok: true,
          state: "waiting-user-action",
          pending: true,
          statusCode: 200,
          remoteId: flowId,
          url: null,
          userAction,
          message: `AiToEarn 已创建${platformKey === "douyin" ? "抖音" : platformKey === "twitter" ? "X / 推特" : platformKey}任务，等待手机端确认；尚未视为发布成功。`
        };
      }
      if (states.every((state) => state === "succeeded")) {
        const completed = tasks.find((task) => task.platformWorkId || task.workLink) || tasks[0];
        return {
          ok: true,
          state: "succeeded",
          statusCode: 200,
          remoteId: flowId,
          url: completed?.workLink || null,
          message: "AiToEarn 平台任务已完成"
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, adapter.pollIntervalMs));
  }
  const error = new Error(`AiToEarn 发布任务尚未完成：${flowId}。请在 AiToEarn 后台继续查看，不会自动重复提交。`);
  error.code = "PLATFORM_ADAPTER_TIMEOUT";
  error.detail = flowId;
  throw error;
}

async function invokeAiToEarnRestAdapter(adapter, packageData) {
  const platformKey = aiToEarnPlatformKey(packageData, adapter);
  const accountId = await resolveAiToEarnAccount(adapter, packageData, platformKey);
  const mediaPaths = packageData.video ? [packageData.video] : packageData.images;
  const coverPaths = packageData.video ? packageData.images.slice(0, 1) : [];
  const assets = [];
  for (const filePath of [...mediaPaths, ...coverPaths]) assets.push(await uploadAiToEarnAsset(adapter, filePath));
  const media = assets.slice(0, mediaPaths.length).map((asset) => ({ url: asset.url, metadata: { type: asset.type } }));
  const cover = assets[mediaPaths.length]
    ? { url: assets[mediaPaths.length].url, metadata: { type: assets[mediaPaths.length].type } }
    : null;
  const content = {
    title: packageData.title,
    body: packageData.body,
    media
  };
  if (cover) content.cover = cover;
  const flow = await aiToEarnRequest(adapter, "/api/v2/channels/publish/flows", {
    method: "POST",
    body: {
      content,
      context: {
        type: packageData.video ? "video" : "image-text",
        ...(packageData.video ? { videoUrl: media[0]?.url } : {}),
        source: "teambuilding-workflow"
      },
      items: [{ accountId, platform: platformKey, overrides: content }]
    }
  });
  const flowId = flow?.data?.flowId;
  if (!flowId) {
    const error = new Error("AiToEarn 创建发布 Flow 没有返回 flowId");
    error.code = "PLATFORM_ADAPTER_PROTOCOL_INVALID";
    throw error;
  }
  return pollAiToEarnFlow(adapter, flowId, platformKey);
}

async function checkAiToEarnAdapter(adapter) {
  const result = await aiToEarnRequest(adapter, "/api/v2/channels/platforms");
  // The platform catalog is public on AiToEarn and can return HTTP 200 even
  // when the API key is missing. Probe the authenticated account endpoint as
  // well, otherwise the workbench would show a false-positive login state.
  const accountsResult = await aiToEarnRequest(adapter, "/api/v2/channels/accounts");
  const platforms = Array.isArray(result?.data) ? result.data : [];
  const accountData = accountsResult?.data;
  const accountItems = Array.isArray(accountData)
    ? accountData
    : Array.isArray(accountData?.items)
      ? accountData.items
      : null;
  return {
    ok: true,
    statusCode: 200,
    message: `AiToEarn 连接正常，已读取 ${platforms.length} 个平台元数据${accountItems ? `和 ${accountItems.length} 个授权账号` : "及授权账号状态"}`,
    platforms: platforms.map((item) => String(item.platform || "")).filter(Boolean).slice(0, 30),
    accountCount: accountItems ? accountItems.length : null
  };
}

async function invokeHttpAdapter(adapter, packageData) {
  if (adapter.mode === "mcp-http") return invokeMcpHttpAdapter(adapter, packageData);
  if (adapter.mode === "aitoearn-rest") return invokeAiToEarnRestAdapter(adapter, packageData);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), adapter.timeoutMs);
  try {
    const response = await fetch(adapter.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adapter.headers },
      body: JSON.stringify({
        platform: packageData.platform,
        title: packageData.title,
        body: packageData.body,
        images: packageData.images,
        video: packageData.video || null,
        source: {
          collection: packageData.sourceCollection || null,
          workId: packageData.workId || null
        }
      }),
      signal: controller.signal
    });
    const responseText = await response.text();
    let responseBody = null;
    try { responseBody = responseText ? JSON.parse(responseText) : null; } catch { responseBody = null; }
    if (!response.ok) {
      const error = new Error(`外部适配器返回 HTTP ${response.status}`);
      error.code = "PLATFORM_ADAPTER_FAILED";
      error.detail = redactOutput(responseBody ? JSON.stringify(responseBody) : responseText);
      throw error;
    }
    return {
      ok: true,
      statusCode: response.status,
      remoteId: responseBody?.remoteId || responseBody?.id || null,
      url: responseBody?.url || null,
      message: redactOutput(responseBody?.message || "外部适配器已接受发布任务")
    };
  } catch (error) {
    throw adapterConnectionError(adapter, error);
  } finally {
    clearTimeout(timer);
  }
}

function parseMcpPayload(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const dataLines = raw.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  for (let index = dataLines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(dataLines[index]); } catch {}
  }
  return null;
}

async function mcpRequest(adapter, payload, sessionId = "") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), adapter.timeoutMs);
  try {
    const headers = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Protocol-Version": "2024-11-05",
      ...adapter.headers
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    const response = await fetch(adapter.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const responseText = await response.text();
    if (!response.ok) {
      const error = new Error(`MCP 适配器返回 HTTP ${response.status}`);
      error.code = "PLATFORM_ADAPTER_FAILED";
      error.detail = redactOutput(responseText);
      throw error;
    }
    return {
      payload: parseMcpPayload(responseText),
      sessionId: response.headers.get("mcp-session-id") || sessionId
    };
  } catch (error) {
    throw adapterConnectionError(adapter, error, "MCP 适配器");
  } finally {
    clearTimeout(timer);
  }
}

function mcpError(payload) {
  if (!payload?.error) return null;
  const error = new Error(payload.error.message || "MCP 工具调用失败");
  error.code = "PLATFORM_ADAPTER_FAILED";
  error.detail = redactOutput(JSON.stringify(payload.error));
  return error;
}

async function openMcpSession(adapter) {
  const initialized = await mcpRequest(adapter, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "teambuilding-workflow-dashboard", version: "0.17.2" }
    }
  });
  if (!initialized.payload) {
    const error = new Error("MCP 初始化没有返回 JSON-RPC 结果");
    error.code = "PLATFORM_ADAPTER_PROTOCOL_INVALID";
    throw error;
  }
  const initError = mcpError(initialized.payload);
  if (initError) throw initError;
  await mcpRequest(adapter, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {}
  }, initialized.sessionId);
  return initialized.sessionId;
}

async function callMcpTool(adapter, name, argumentsValue = {}) {
  const sessionId = await openMcpSession(adapter);
  const called = await mcpRequest(adapter, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: argumentsValue }
  }, sessionId);
  const callError = mcpError(called.payload);
  if (callError) throw callError;
  return called.payload;
}

function mcpResultSummary(payload, fallbackMessage) {
  const content = Array.isArray(payload?.result?.content) ? payload.result.content : [];
  const text = content.filter((item) => item?.type === "text").map((item) => item.text).join("\n");
  let structured = null;
  try { structured = text ? JSON.parse(text) : null; } catch {}
  return {
    ok: payload?.result?.isError !== true,
    statusCode: 200,
    remoteId: structured?.remoteId || structured?.id || null,
    url: structured?.url || null,
    message: redactOutput(text || fallbackMessage)
  };
}

function mcpResultError(result, fallbackMessage = "MCP 工具返回失败") {
  if (result?.ok !== false) return null;
  const error = new Error(result.message || fallbackMessage);
  error.code = "PLATFORM_ADAPTER_TOOL_FAILED";
  error.detail = result.message;
  return error;
}

async function invokeMcpHttpAdapter(adapter, packageData) {
  const tool = adapter.tool
    || (adapter.engine === "xiaohongshu-mcp" ? (packageData.video ? "publish_with_video" : "publish_content") : "");
  if (!tool) {
    const error = new Error("MCP 适配器未配置发布工具；请先点击“发现 MCP 工具”，再在运行配置中填写 tool");
    error.code = "PLATFORM_ADAPTER_TOOL_NOT_CONFIGURED";
    throw error;
  }
  const argumentsValue = {
    title: packageData.title,
    content: packageData.body,
    ...(packageData.video ? { video: packageData.video } : { images: packageData.images })
  };
  const payload = await callMcpTool(adapter, tool, argumentsValue);
  const result = mcpResultSummary(payload, "MCP 已接受发布任务");
  const resultError = mcpResultError(result, "MCP 发布工具返回失败");
  if (resultError) throw resultError;
  return result;
}

async function checkMcpLogin(adapter) {
  const payload = await callMcpTool(adapter, adapter.loginTool || "check_login_status");
  const result = mcpResultSummary(payload, "已完成 MCP 登录状态探测");
  const resultError = mcpResultError(result, "MCP 登录状态探测失败");
  if (resultError) throw resultError;
  return result;
}

async function listMcpTools(adapter) {
  const sessionId = await openMcpSession(adapter);
  const listed = await mcpRequest(adapter, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  }, sessionId);
  const listError = mcpError(listed.payload);
  if (listError) throw listError;
  return Array.isArray(listed.payload?.result?.tools)
    ? listed.payload.result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      inputSchema: tool.inputSchema || null
    }))
    : [];
}

module.exports = {
  ENGINE_DEFINITIONS,
  PLATFORM_DEFINITIONS,
  checkAiToEarnAdapter,
  aiToEarnTaskState,
  createTaskId,
  checkMcpLogin,
  getPlatformCatalog,
  getRuntimeAdapter,
  invokeHttpAdapter,
  listMcpTools,
  normalizePlatformId,
  normalizeAdapter,
  publicPublishPackage,
  redactOutput,
  validatePublishPackage
};
