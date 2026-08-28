const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { fetchWithRetry, generateMinimax, generateOpenAiCompatible, generateText, imageDimensions, networkFetch, normalizeImageApiConfig, normalizeTextApiConfig, normalizeToThreeByFour } = require("./image-generation");

test("image API defaults to the verified local image gateway", () => {
  assert.deepEqual(normalizeImageApiConfig({}), {
    provider: "local-openai",
    baseUrl: "http://localhost:62104/v1",
    model: "gpt-image-2"
  });
});

test("ByteCat Image 2.0 uses the official OpenAI-compatible gateway", () => {
  assert.deepEqual(normalizeImageApiConfig({ provider: "bytecat" }), {
    provider: "bytecat",
    baseUrl: "https://bytecat.lamclod.cn/v1",
    model: "gpt-image-2"
  });
});

test("text API defaults to the selectable MiniMax copy model", () => {
  assert.deepEqual(normalizeTextApiConfig({}), {
    provider: "minimax",
    baseUrl: "https://api.minimaxi.com/v1",
    model: "MiniMax-M2.7"
  });
});

test("OpenAI-compatible generation accepts base64 images", async () => {
  const result = await generateOpenAiCompatible({
    config: normalizeImageApiConfig({}), apiKey: "secret", prompt: "团建封面",
    fetchImpl: async () => new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from("image").toString("base64") }],
      usage: { input_tokens: 12, output_tokens: 34 }
    }), { status: 200, headers: { "x-request-id": "req-image-1" } })
  });
  assert.equal(result.bytes.toString(), "image");
  assert.equal(result.requestMeta.requestCount, 1);
  assert.equal(result.requestMeta.attemptCount, 1);
  assert.equal(result.requestMeta.providerRequestId, "req-image-1");
  assert.deepEqual(result.requestMeta.usage, { input_tokens: 12, output_tokens: 34 });
});

test("local image edits send template and material as JSON image references", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "team-image-edit-"));
  const template = path.join(root, "template.png");
  const material = path.join(root, "material.jpg");
  fs.writeFileSync(template, Buffer.from([1, 2, 3]));
  fs.writeFileSync(material, Buffer.from([4, 5, 6]));
  let request;
  try {
    await generateOpenAiCompatible({
      config: normalizeImageApiConfig({ provider: "local-openai" }),
      apiKey: "secret",
      prompt: "严格母版迁移",
      referencePaths: [template, material],
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }), { status: 200 });
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const body = JSON.parse(request.options.body);
  assert.match(request.options.headers["Content-Type"], /application\/json/);
  assert.equal(body.model, "gpt-image-2");
  assert.equal(body.images.length, 2);
  assert.match(body.images[0], /^data:image\/png;base64,/);
  assert.match(body.images[1], /^data:image\/jpeg;base64,/);
});

test("ByteCat reference generation uses JSON image_url objects on the generations endpoint", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "team-bytecat-image-"));
  const reference = path.join(root, "reference.jpg");
  fs.writeFileSync(reference, Buffer.from([4, 5, 6]));
  let request;
  try {
    await generateOpenAiCompatible({
      config: normalizeImageApiConfig({ provider: "bytecat" }),
      apiKey: "secret",
      prompt: "严格母版迁移",
      referencePaths: [reference],
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }), { status: 200 });
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const body = JSON.parse(request.options.body);
  assert.match(request.url, /\/images\/generations$/);
  assert.match(request.options.headers["Content-Type"], /application\/json/);
  assert.equal(body.model, "gpt-image-2");
  assert.equal(body.images.length, 1);
  assert.match(body.images[0].image_url, /^data:image\/jpeg;base64,/);
});

test("ByteCat combines template and material into one reference board", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "team-bytecat-board-"));
  const template = path.join(root, "template.png");
  const material = path.join(root, "material.jpg");
  await sharp({ create: { width: 300, height: 400, channels: 3, background: "#34543f" } }).png().toFile(template);
  await sharp({ create: { width: 300, height: 400, channels: 3, background: "#d5bc78" } }).jpeg().toFile(material);
  let request;
  try {
    await generateOpenAiCompatible({
      config: normalizeImageApiConfig({ provider: "bytecat" }),
      apiKey: "secret",
      prompt: "母版迁移",
      referencePaths: [template, material],
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }), { status: 200 });
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const body = JSON.parse(request.options.body);
  assert.equal(body.images.length, 1);
  assert.match(body.images[0].image_url, /^data:image\/jpeg;base64,/);
  const board = Buffer.from(body.images[0].image_url.split(",", 2)[1], "base64");
  const boardMetadata = await sharp(board).metadata();
  assert.deepEqual(
    { width: boardMetadata.width, height: boardMetadata.height },
    { width: 1536, height: 1024 }
  );
  assert.match(body.prompt, /第一格是A类视觉母版/);
});

test("MiniMax uses a 3:4 request and returns downloaded bytes", async () => {
  const requests = [];
  const result = await generateMinimax({
    config: normalizeImageApiConfig({ provider: "minimax" }), apiKey: "secret", prompt: "团建封面",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.includes("image_generation")) return new Response(JSON.stringify({ data: { image_urls: ["https://cdn.example.com/a.jpg"] }, base_resp: { status_code: 0 } }), { status: 200 });
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
  });
  assert.equal(JSON.parse(requests[0].options.body).aspect_ratio, "3:4");
  assert.equal(result.bytes.length, 4);
});

test("local compatible text generation returns copy", async () => {
  const result = await generateText({
    config: normalizeImageApiConfig({}), apiKey: "secret", prompt: "写文案",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "团建文案" } }] }), { status: 200 })
  });
  assert.equal(result, "团建文案");
});

test("MiniMax OpenAI-compatible text generation returns copy", async () => {
  let request;
  const result = await generateText({
    config: normalizeTextApiConfig({ provider: "minimax" }), apiKey: "secret", prompt: "写文案",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: "MiniMax 团建文案" } }] }), { status: 200 });
    }
  });
  assert.match(request.url, /\/chat\/completions$/);
  assert.equal(JSON.parse(request.options.body).model, "MiniMax-M2.7");
  assert.equal(result, "MiniMax 团建文案");
});

test("transient image gateway errors are retried before succeeding", async () => {
  let calls = 0;
  const response = await fetchWithRetry("https://example.com/images", {}, async () => {
    calls += 1;
    if (calls < 3) return new Response("gateway timeout", { status: 504 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }, { attempts: 3, delays: [0, 0] });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
});

test("paid image requests can explicitly disable automatic retries", async () => {
  let calls = 0;
  const attempts = [];
  await assert.rejects(
    generateOpenAiCompatible({
      config: normalizeImageApiConfig({ provider: "bytecat" }),
      apiKey: "secret",
      prompt: "只生成一张校准封面",
      fetchImpl: async () => {
        calls += 1;
        return new Response("gateway timeout", { status: 504 });
      },
      retryOptions: {
        attempts: 1,
        delays: [],
        onAttempt: (entry) => attempts.push(entry)
      }
    }),
    /没有自动重试/
  );
  assert.equal(calls, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 504);
});

test("an explicit stop aborts the current request without retrying it", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    fetchWithRetry("https://example.com/images", { signal: controller.signal }, async () => {
      calls += 1;
      controller.abort();
      throw new DOMException("This operation was aborted", "AbortError");
    }, { attempts: 3, delays: [0, 0] }),
    /aborted/i
  );
  assert.equal(calls, 1);
});

test("default network requests carry the environment proxy dispatcher", async () => {
  const dispatcher = {};
  let received;
  const response = await networkFetch("https://example.com/models", { headers: { Accept: "application/json" } }, async (url, options) => {
    received = { url, options };
    return new Response("{}", { status: 200 });
  }, dispatcher);
  assert.equal(response.status, 200);
  assert.equal(received.url, "https://example.com/models");
  assert.equal(received.options.dispatcher, dispatcher);
});

test("generated portrait images are normalized to exact 3:4 publish dimensions", async () => {
  const source = await sharp({
    create: { width: 1024, height: 1536, channels: 3, background: "#8cae92" }
  }).png().toBuffer();
  const normalized = await normalizeToThreeByFour(source);
  assert.deepEqual(imageDimensions(normalized), { width: 1200, height: 1600 });
});
