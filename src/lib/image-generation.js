const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { EnvHttpProxyAgent, fetch: undiciFetch } = require("undici");

let environmentProxyAgent;

function networkFetch(url, options = {}, fetchImpl = undiciFetch, dispatcher) {
  if (!environmentProxyAgent) environmentProxyAgent = new EnvHttpProxyAgent();
  return fetchImpl(url, {
    ...options,
    dispatcher: dispatcher || environmentProxyAgent
  });
}

const PROVIDER_DEFAULTS = {
  "local-openai": { baseUrl: "http://localhost:62104/v1", model: "gpt-image-2" },
  bytecat: { baseUrl: "https://bytecat.lamclod.cn/v1", model: "gpt-image-2" },
  minimax: { baseUrl: "https://api.minimaxi.com/v1", model: "image-01" }
};

const TEXT_PROVIDER_DEFAULTS = {
  "local-openai": { baseUrl: "http://localhost:62104/v1", model: "gpt-5.6-terra" },
  bytecat: { baseUrl: "https://bytecat.lamclod.cn/v1", model: "gpt-5.6-terra" },
  minimax: { baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7" }
};

function normalizeImageApiConfig(value = {}) {
  const provider = Object.hasOwn(PROVIDER_DEFAULTS, value.provider) ? value.provider : "local-openai";
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    provider,
    baseUrl: String(value.baseUrl || defaults.baseUrl).replace(/\/+$/, ""),
    model: String(value.model || defaults.model)
  };
}

function normalizeTextApiConfig(value = {}) {
  const provider = Object.hasOwn(TEXT_PROVIDER_DEFAULTS, value.provider) ? value.provider : "minimax";
  const defaults = TEXT_PROVIDER_DEFAULTS[provider];
  return {
    provider,
    baseUrl: String(value.baseUrl || defaults.baseUrl).replace(/\/+$/, ""),
    model: String(value.model || defaults.model)
  };
}

function assertSafeUrl(value, label = "接口地址") {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label}格式不正确`); }
  if (parsed.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error(`${label}必须使用 HTTPS；本机接口可使用 localhost`);
  }
  return parsed;
}

async function readJsonResponse(response) {
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!response.ok) {
    if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`生图服务暂时不可用（HTTP ${response.status}）；本次付费请求没有自动重试`);
    }
    const detail = data?.error?.message || data?.error || data?.base_resp?.status_msg || raw || `HTTP ${response.status}`;
    throw new Error(String(detail).slice(0, 500));
  }
  return data || {};
}

function isTransientStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

async function wait(delayMs) {
  if (!delayMs) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchWithRetry(url, options, fetchImpl = networkFetch, retryOptions = {}) {
  const attempts = Math.max(1, Number(retryOptions.attempts ?? 3));
  const delays = retryOptions.delays || [1200, 3500];
  const timeoutMs = Math.max(1_000, Number(retryOptions.timeoutMs || 480_000));
  const onAttempt = typeof retryOptions.onAttempt === "function" ? retryOptions.onAttempt : null;
  const reportAttempt = (entry) => {
    try { onAttempt?.(entry); } catch { /* Audit callbacks must never break a request. */ }
  };
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: options?.signal || AbortSignal.timeout(timeoutMs)
      });
      reportAttempt({
        attempt,
        status: response.status,
        durationMs: Date.now() - startedAt,
        transient: isTransientStatus(response.status)
      });
      if (!isTransientStatus(response.status) || attempt === attempts) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      reportAttempt({
        attempt,
        status: 0,
        durationMs: Date.now() - startedAt,
        transient: true,
        error: String(error?.message || error).slice(0, 300)
      });
      if (options?.signal?.aborted) throw error;
      if (attempt === attempts) throw error;
    }
    await wait(Number(delays[Math.min(attempt - 1, delays.length - 1)] || 0));
  }
  throw lastError || new Error("生图服务连接失败");
}

function providerRequestId(response) {
  const names = ["x-request-id", "x-oneapi-request-id", "request-id", "trace-id", "x-trace-id"];
  for (const name of names) {
    const value = response.headers.get(name);
    if (value) return String(value).slice(0, 300);
  }
  return "";
}

function safeUsage(value) {
  if (!value || typeof value !== "object") return null;
  try {
    const json = JSON.stringify(value);
    if (json.length > 20_000) return { truncated: true };
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function imageExtension(bytes, contentType = "") {
  if (String(contentType).includes("webp")) return ".webp";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ".png";
  return ".jpg";
}

function imageMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function imageDataUrl(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error("参考图不存在或超过 20 MB");
  return `data:${imageMimeType(filePath)};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

async function referenceSheetDataUrl(referencePaths) {
  const files = referencePaths.slice(0, 4);
  if (files.length === 1) return imageDataUrl(files[0]);
  const columns = 2;
  const rows = Math.ceil(files.length / columns);
  // Every cell is exactly 3:4 and touches its neighbours. Padding or a
  // letterboxed card is easily copied by image models as an unwanted white
  // seam in the finished four-grid layout.
  const cellWidth = 768;
  const cellHeight = 1024;
  const canvasWidth = columns * cellWidth;
  const canvasHeight = rows * cellHeight;
  const composites = await Promise.all(files.map(async (filePath, index) => ({
    input: await sharp(filePath, { failOn: "none" })
      .rotate()
      .resize(cellWidth, cellHeight, { fit: "cover", position: "attention" })
      .jpeg({ quality: 70, chromaSubsampling: "4:2:0" })
      .toBuffer(),
    left: (index % columns) * cellWidth,
    top: Math.floor(index / columns) * cellHeight
  })));
  const sheet = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: "#1c211f"
    }
  }).composite(composites).jpeg({ quality: 68, chromaSubsampling: "4:2:0" }).toBuffer();
  return `data:image/jpeg;base64,${sheet.toString("base64")}`;
}

function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      if (!length) break;
      offset += length + 2;
    }
  }
  return { width: 0, height: 0 };
}

async function normalizeToThreeByFour(bytes) {
  return sharp(bytes, { failOn: "warning" })
    .rotate()
    .resize(1200, 1600, { fit: "cover", position: "centre" })
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toBuffer();
}

async function saveBytes(bytes, outputRoot, index, contentType = "") {
  if (!bytes.length || bytes.length > 40 * 1024 * 1024) throw new Error("生成图片为空或超过 40 MB");
  fs.mkdirSync(outputRoot, { recursive: true });
  const normalizedBytes = await normalizeToThreeByFour(bytes);
  const ext = ".png";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = path.join(outputRoot, `api-image-${stamp}-${String(index + 1).padStart(2, "0")}${ext}`);
  fs.writeFileSync(outputFile, normalizedBytes);
  return {
    outputFile,
    bytes: normalizedBytes.length,
    ...imageDimensions(normalizedBytes),
    sourceDimensions: imageDimensions(bytes)
  };
}

async function fetchImageBytes(imageUrl, fetchImpl = networkFetch, retryOptions = {}) {
  assertSafeUrl(imageUrl, "图片下载地址");
  const response = await fetchWithRetry(imageUrl, { redirect: "follow" }, fetchImpl, retryOptions);
  if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "" };
}

async function generateOpenAiCompatible({
  config,
  apiKey,
  prompt,
  referencePaths = [],
  fetchImpl = networkFetch,
  retryOptions = {},
  signal
}) {
  const useEdit = referencePaths.length > 0;
  const bytecatReferenceGeneration = useEdit && config.provider === "bytecat";
  const endpoint = `${config.baseUrl}/images/${useEdit && !bytecatReferenceGeneration ? "edits" : "generations"}`;
  assertSafeUrl(endpoint);
  let body;
  let headers = { Accept: "application/json", Authorization: `Bearer ${apiKey}` };
  if (useEdit) {
    if (config.provider === "local-openai" || bytecatReferenceGeneration) {
      headers["Content-Type"] = "application/json";
      const imageReferences = bytecatReferenceGeneration
        ? [{ image_url: await referenceSheetDataUrl(referencePaths) }]
        : referencePaths.slice(0, 8).map(imageDataUrl);
      body = JSON.stringify({
        model: config.model,
        prompt: bytecatReferenceGeneration && referencePaths.length > 1
          ? `${prompt}\n\n参考板说明：参考图由多张原图拼成。第一格是A类视觉母版，其余格是B类内容素材；只迁移母版骨架，不沿用素材排版。`
          : prompt,
        images: imageReferences,
        n: 1,
        size: "1024x1536",
        response_format: "b64_json"
      });
    } else {
      body = new FormData();
      body.append("model", config.model);
      body.append("prompt", prompt);
      body.append("n", "1");
      body.append("size", "1024x1536");
      for (const filePath of referencePaths.slice(0, 8)) {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error("参考图不存在或超过 20 MB");
        body.append("image", new Blob([fs.readFileSync(filePath)], { type: imageMimeType(filePath) }), path.basename(filePath));
      }
    }
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ model: config.model, prompt, n: 1, size: "1024x1536", response_format: "b64_json" });
  }
  const generationAttempts = [];
  const externalAttemptReporter = typeof retryOptions.onAttempt === "function" ? retryOptions.onAttempt : null;
  const response = await fetchWithRetry(
    endpoint,
    { method: "POST", headers, body, signal },
    fetchImpl,
    {
      ...retryOptions,
      onAttempt: (entry) => {
        generationAttempts.push(entry);
        externalAttemptReporter?.(entry);
      }
    }
  );
  const data = await readJsonResponse(response);
  const item = data.data?.[0];
  if (!item?.b64_json && !item?.url) throw new Error("接口没有返回图片数据");
  const requestMeta = {
    requestCount: 1,
    attemptCount: generationAttempts.length,
    attempts: generationAttempts,
    providerRequestId: providerRequestId(response),
    referenceCount: referencePaths.length,
    endpoint: new URL(endpoint).pathname,
    usage: safeUsage(data.usage || item.usage)
  };
  if (item.b64_json) {
    return {
      bytes: Buffer.from(item.b64_json, "base64"),
      contentType: "image/png",
      requestMeta
    };
  }
  return {
    ...await fetchImageBytes(item.url, fetchImpl, retryOptions),
    requestMeta
  };
}

async function generateMinimax({ config, apiKey, prompt, fetchImpl = networkFetch, retryOptions = {}, signal }) {
  const endpoint = `${config.baseUrl}/image_generation`;
  assertSafeUrl(endpoint);
  const generationAttempts = [];
  const externalAttemptReporter = typeof retryOptions.onAttempt === "function" ? retryOptions.onAttempt : null;
  const response = await fetchWithRetry(
    endpoint,
    {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, prompt, aspect_ratio: "3:4", response_format: "url", n: 1, prompt_optimizer: true }),
      signal
    },
    fetchImpl,
    {
      ...retryOptions,
      onAttempt: (entry) => {
        generationAttempts.push(entry);
        externalAttemptReporter?.(entry);
      }
    }
  );
  const data = await readJsonResponse(response);
  if (data.base_resp && Number(data.base_resp.status_code) !== 0) {
    throw new Error(String(data.base_resp.status_msg || `MiniMax 状态码 ${data.base_resp.status_code}`).slice(0, 500));
  }
  const imageUrl = data.data?.image_urls?.[0];
  if (!imageUrl) throw new Error("MiniMax 没有返回图片地址");
  return {
    ...await fetchImageBytes(imageUrl, fetchImpl, retryOptions),
    requestMeta: {
      requestCount: 1,
      attemptCount: generationAttempts.length,
      attempts: generationAttempts,
      providerRequestId: providerRequestId(response),
      referenceCount: 0,
      endpoint: new URL(endpoint).pathname,
      usage: safeUsage(data.usage)
    }
  };
}

async function generateText({ config, apiKey, prompt, model = "", fetchImpl = networkFetch }) {
  if (!apiKey) throw new Error("没有找到本机 API 密钥");
  if (!["local-openai", "bytecat", "minimax"].includes(config.provider)) throw new Error("当前文案生成只支持 OpenAI 兼容接口");
  const endpoint = `${config.baseUrl}/chat/completions`;
  assertSafeUrl(endpoint);
  const selectedModel = String(model || (config.provider === "minimax" ? "MiniMax-M2.7" : "gpt-5.6-terra"));
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: selectedModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    }),
    signal: AbortSignal.timeout(180_000)
  });
  const data = await readJsonResponse(response);
  const content = data.choices?.[0]?.message?.content;
  if (!String(content || "").trim()) throw new Error("文案接口没有返回正文");
  return String(content).trim();
}

async function generateImages(options) {
  const config = normalizeImageApiConfig(options.config);
  if (!options.apiKey) throw new Error("没有找到本机生图 API 密钥");
  const count = [1, 2, 6].includes(Number(options.count)) ? Number(options.count) : 1;
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const generated = config.provider === "minimax"
      ? await generateMinimax({ ...options, config })
      : await generateOpenAiCompatible({ ...options, config });
    results.push({
      ...await saveBytes(generated.bytes, options.outputRoot, index, generated.contentType),
      provider: config.provider,
      model: config.model,
      requestMeta: generated.requestMeta || null
    });
  }
  return results;
}

module.exports = {
  PROVIDER_DEFAULTS,
  TEXT_PROVIDER_DEFAULTS,
  generateImages,
  generateMinimax,
  generateOpenAiCompatible,
  generateText,
  fetchWithRetry,
  imageDimensions,
  networkFetch,
  normalizeToThreeByFour,
  normalizeImageApiConfig,
  normalizeTextApiConfig,
  referenceSheetDataUrl
};
