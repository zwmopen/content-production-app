const fs = require("node:fs");
const path = require("node:path");
const sharp = require("../src/node_modules/sharp");
const {
  generateMinimax,
  generateOpenAiCompatible,
  networkFetch,
  normalizeImageApiConfig
} = require("../src/lib/image-generation");

const RUNTIME_ROOT = process.env.TEAMBUILDING_DASHBOARD_RUNTIME
  || "D:\\AICode\\运行数据\\江湖有旅人\\图文生产控制台";
const SECRET_FILE = path.join(RUNTIME_ROOT, "secrets", "image-api.local.env");

function readSecrets() {
  if (!fs.existsSync(SECRET_FILE)) return {};
  return Object.fromEntries(
    fs.readFileSync(SECRET_FILE, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]])
  );
}

function credential(provider, secrets) {
  if (provider === "bytecat") {
    return secrets.BYTECAT_IMAGE_API_KEY || process.env.TEAMBUILDING_BYTECAT_IMAGE_API_KEY || "";
  }
  if (provider === "minimax") {
    return secrets.MINIMAX_IMAGE_API_KEY || process.env.TEAMBUILDING_MINIMAX_IMAGE_API_KEY
      || process.env.MINIMAXI_API_KEY || process.env.MINIMAX_API_KEY || "";
  }
  return secrets.LOCAL_IMAGE_API_KEY || process.env.TEAMBUILDING_IMAGE_API_KEY || "";
}

async function main() {
  const provider = String(process.argv[2] || "local-openai");
  const referencePath = String(process.argv[3] || "");
  const protocol = String(process.argv[4] || "default");
  const secondReferencePath = String(process.argv[5] || "");
  const baseUrl = String(process.argv[6] || "");
  const outputPath = String(process.argv[7] || "");
  const config = normalizeImageApiConfig({ provider, baseUrl });
  const apiKey = credential(provider, readSecrets());
  if (!apiKey) throw new Error(`${provider} 未配置本机密钥`);
  const remoteReference = /^https:\/\//i.test(referencePath);
  if (referencePath && !remoteReference && !fs.existsSync(referencePath)) throw new Error("参考图不存在");
  if (secondReferencePath && !fs.existsSync(secondReferencePath)) throw new Error("第二张参考图不存在");

  const options = {
    config,
    apiKey,
    prompt: "真实手机摄影质感的企业团建场景，画面自然克制，无品牌、无水印、无文字，3:4 竖图。",
    referencePaths: [referencePath, secondReferencePath].filter(Boolean),
    retryOptions: { attempts: 1, timeoutMs: 180_000 }
  };
  const startedAt = Date.now();
  let generated;
  if (protocol === "json-edit" || protocol === "json-generation-images") {
    const dataUrl = remoteReference
      ? referencePath
      : `data:image/${path.extname(referencePath).toLowerCase() === ".png" ? "png" : "jpeg"};base64,${fs.readFileSync(referencePath).toString("base64")}`;
    const endpoint = protocol === "json-generation-images" ? "generations" : "edits";
    const response = await networkFetch(`${config.baseUrl}/images/${endpoint}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        prompt: options.prompt,
        images: [{ image_url: dataUrl }],
        n: 1,
        size: "1024x1536",
        response_format: "b64_json"
      })
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }
    if (!response.ok) throw new Error(data?.error?.message || data?.error || raw || `HTTP ${response.status}`);
    const item = data.data?.[0];
    generated = {
      bytes: item?.b64_json ? Buffer.from(item.b64_json, "base64") : Buffer.alloc(0)
    };
  } else {
    generated = provider === "minimax"
      ? await generateMinimax(options)
      : await generateOpenAiCompatible(options);
  }
  if (outputPath && generated.bytes?.length) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await sharp(generated.bytes, { failOn: "none" })
      .rotate()
      .resize(1200, 1600, { fit: "cover", position: "centre" })
      .png({ compressionLevel: 8, adaptiveFiltering: true })
      .toFile(outputPath);
  }
  console.log(JSON.stringify({
    ok: true,
    provider,
    model: config.model,
    mode: referencePath ? protocol === "json-edit" ? "json-edit" : "edit" : "generation",
    bytes: generated.bytes?.length || 0,
    durationMs: Date.now() - startedAt,
    outputPath
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: String(error?.message || error).slice(0, 500),
    cause: String(error?.cause?.message || "").slice(0, 500),
    causeCode: String(error?.cause?.code || "")
  }));
  process.exitCode = 1;
});
