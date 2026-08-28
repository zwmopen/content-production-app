"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { handle, tasks } = require("./platform-publishing");

function response() {
  return {
    status: 0,
    body: "",
    headersSent: false,
    writeHead(status) { this.status = status; },
    end(body) { this.body = String(body || ""); this.headersSent = true; }
  };
}

function context(runtimeRoot) {
  return {
    DATA_ROOT: runtimeRoot,
    getBody: async (_req) => _req.body || "{}",
    isAllowedFile: () => true,
    exists: () => true,
    send(res, status, body) { res.writeHead(status); res.end(body); },
    sendJson(res, body) { res.writeHead(200); res.end(JSON.stringify(body)); }
  };
}

test("platform publishing route rejects malformed JSON without throwing", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-invalid-request-"));
  const result = response();
  await handle({ method: "POST", body: "{not-json" }, result, "/api/platform-publishing/publish", {}, context(runtimeRoot));
  assert.equal(result.status, 400);
  assert.match(result.body, /PLATFORM_REQUEST_INVALID/);
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("AiToEarn login probe verifies authenticated accounts instead of trusting public platform metadata", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-aitoearn-check-"));
  let authorized = false;
  const server = http.createServer((req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.method === "GET" && req.url === "/api/v2/channels/platforms") {
      send(200, { code: 0, data: [{ platform: "douyin" }, { platform: "twitter" }] });
      return;
    }
    if (req.method === "GET" && req.url === "/api/v2/channels/accounts") {
      if (!authorized) {
        send(200, { code: 401, data: {}, message: "Unauthorized" });
        return;
      }
      send(200, { code: 0, data: { items: [{ id: "douyin-account", platform: "douyin" }] } });
      return;
    }
    send(404, { code: 404, message: "Not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  fs.writeFileSync(path.join(runtimeRoot, "platform-publishing.json"), JSON.stringify({
    adapters: {
      douyin: {
        engine: "aitoearn",
        mode: "aitoearn-rest",
        endpoint: `http://127.0.0.1:${port}`,
        allowRemote: false,
        headers: { "X-Api-Key": "test-key" }
      }
    }
  }), "utf8");

  const denied = response();
  await handle({ method: "POST", body: JSON.stringify({ platform: "douyin" }) }, denied, "/api/platform-publishing/check", {}, context(runtimeRoot));
  assert.equal(denied.status, 502);
  assert.match(denied.body, /PLATFORM_ADAPTER_FAILED/);

  authorized = true;
  const ready = response();
  await handle({ method: "POST", body: JSON.stringify({ platform: "douyin" }) }, ready, "/api/platform-publishing/check", {}, context(runtimeRoot));
  assert.equal(ready.status, 200);
  const payload = JSON.parse(ready.body);
  assert.equal(payload.result.accountCount, 1);
  assert.match(payload.result.message, /1 个授权账号/);
  server.close();
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("platform publishing source route loads the full copy and image paths from a product work", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-source-"));
  const workPath = path.join(runtimeRoot, "成品-完整文案");
  fs.mkdirSync(workPath, { recursive: true });
  fs.writeFileSync(path.join(workPath, "小红书文案.md"), "第一段\n\n第二段：完整正文", "utf8");
  fs.writeFileSync(path.join(workPath, "01.png"), "image", "utf8");
  fs.writeFileSync(path.join(workPath, "02.webp"), "image", "utf8");
  fs.writeFileSync(path.join(workPath, "README.md"), "不应优先于文案文件", "utf8");
  const result = response();
  await handle({ method: "POST", body: JSON.stringify({ workId: workPath, sourceCollection: "团建合集" }) }, result, "/api/platform-publishing/source", {}, context(runtimeRoot));
  assert.equal(result.status, 200);
  const payload = JSON.parse(result.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.source.title, "成品-完整文案");
  assert.equal(payload.source.body, "第一段\n\n第二段：完整正文");
  assert.deepEqual(payload.source.images, [path.join(workPath, "01.png"), path.join(workPath, "02.webp")]);
  assert.equal(payload.source.sourceCollection, "团建合集");
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("platform publishing source route rejects an unavailable work", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-source-invalid-"));
  const result = response();
  await handle({ method: "POST", body: JSON.stringify({ workId: path.join(runtimeRoot, "missing") }) }, result, "/api/platform-publishing/source", {}, context(runtimeRoot));
  assert.equal(result.status, 400);
  assert.match(result.body, /PLATFORM_SOURCE_INVALID/);
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("platform usage route requires explicit confirmation and records the canonical platform", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-mark-used-"));
  const calls = [];
  const ctx = {
    ...context(runtimeRoot),
    recordPlatformUsage(input) {
      calls.push(input);
      return { workId: input.workId, platform: input.platform, label: "已发携程" };
    }
  };
  const denied = response();
  await handle({ method: "POST", body: JSON.stringify({ platform: "ctrip", workId: "work-1" }) }, denied, "/api/platform-publishing/mark-used", {}, ctx);
  assert.equal(denied.status, 409);
  assert.match(denied.body, /PLATFORM_USAGE_CONFIRMATION_REQUIRED/);

  const recorded = response();
  await handle({ method: "POST", body: JSON.stringify({ confirmed: true, platform: "ctrip", workId: "work-1", sourceCollection: "公众号" }) }, recorded, "/api/platform-publishing/mark-used", {}, ctx);
  assert.equal(recorded.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    workId: "work-1",
    platform: "ctrip",
    source: "manual_confirmation",
    sourceCollection: "公众号"
  });
  assert.equal(JSON.parse(recorded.body).state, "recorded");
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("Ctrip route prepares a manual handoff and refuses hidden automatic publish", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-ctrip-handoff-"));
  const payload = {
    platform: "ctrip",
    title: "杭州团建路线",
    body: "一份适合团队出行的杭州路线。",
    images: ["C:\\content\\hangzhou.png"]
  };
  const prepared = response();
  await handle({ method: "POST", body: JSON.stringify(payload) }, prepared, "/api/platform-publishing/prepare", {}, context(runtimeRoot));
  assert.equal(prepared.status, 200);
  assert.match(prepared.body, /携程内容中心/);
  assert.match(prepared.body, /批量打开官方图文编辑器并保存草稿/);

  const published = response();
  await handle({ method: "POST", body: JSON.stringify({ ...payload, confirmed: true }) }, published, "/api/platform-publishing/publish", {}, context(runtimeRoot));
  assert.equal(published.status, 409);
  assert.match(published.body, /PLATFORM_MANUAL_HANDOFF_REQUIRED/);
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("Douyin and X use the official web handoff without an AiToEarn key", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-web-handoff-"));
  for (const [platform, name] of [["douyin", "抖音"], ["x", "X / 推特"]]) {
    const payload = {
      platform,
      title: `${name}测试标题`,
      body: "这是官方网页接力测试正文。",
      images: ["C:\\content\\cover.png"]
    };
    const prepared = response();
    await handle({ method: "POST", body: JSON.stringify(payload) }, prepared, "/api/platform-publishing/prepare", {}, context(runtimeRoot));
    assert.equal(prepared.status, 200);
    assert.match(prepared.body, /官方平台页面/);
    assert.doesNotMatch(prepared.body, /API Key/);

    const published = response();
    await handle({ method: "POST", body: JSON.stringify({ ...payload, confirmed: true }) }, published, "/api/platform-publishing/publish", {}, context(runtimeRoot));
    assert.equal(published.status, 409);
    assert.match(published.body, new RegExp(name));
    assert.match(published.body, /PLATFORM_MANUAL_HANDOFF_REQUIRED/);
  }
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("platform publishing route gates confirmation and runs a configured local adapter", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-route-"));
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      assert.equal(req.method, "POST");
      assert.equal(JSON.parse(body).platform, "xiaohongshu");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, remoteId: "xhs-test-1", url: "https://example.invalid/xhs-test-1" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  fs.writeFileSync(path.join(runtimeRoot, "platform-publishing.json"), JSON.stringify({
    adapters: { xiaohongshu: { endpoint: `http://127.0.0.1:${port}/publish` } }
  }), "utf8");
  const usageCalls = [];
  const ctx = context(runtimeRoot);
  ctx.recordPlatformUsage = (input) => {
    usageCalls.push(input);
    return { platform: input.platform };
  };

  const denied = response();
  await handle({ method: "POST", body: JSON.stringify({ platform: "xhs", title: "标题", body: "正文", images: ["C:\\x.png"] }) }, denied, "/api/platform-publishing/publish", {}, ctx);
  assert.equal(denied.status, 409);
  assert.match(denied.body, /PUBLISH_CONFIRMATION_REQUIRED/);

  const accepted = response();
  await handle({ method: "POST", body: JSON.stringify({
    platform: "xhs",
    title: "标题",
    body: "正文",
    images: ["C:\\x.png"],
    confirmed: true
  }) }, accepted, "/api/platform-publishing/publish", {}, ctx);
  assert.equal(accepted.status, 202);
  const task = JSON.parse(accepted.body);
  assert.equal(task.state, "running");

  await new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const current = tasks.get(task.id);
      if (current?.state === "succeeded") return resolve();
      if (current?.state === "failed") return reject(new Error(JSON.stringify(current.error)));
      if (Date.now() - started > 2_000) return reject(new Error("adapter task timed out"));
      setTimeout(poll, 10);
    };
    poll();
  });
  assert.equal(tasks.get(task.id).result.remoteId, "xhs-test-1");
  assert.equal(usageCalls.length, 1);
  assert.equal(usageCalls[0].platform, "xiaohongshu");
  const persisted = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "platform-publishing-tasks.json"), "utf8"));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.tasks.find((item) => item.id === task.id).state, "succeeded");
  server.close();
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("AiToEarn REST adapter uploads assets, creates a flow, and polls completion", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-aitoearn-rest-"));
  const assetPath = path.join(runtimeRoot, "cover.png");
  const videoPath = path.join(runtimeRoot, "clip.mp4");
  fs.writeFileSync(assetPath, "fake-png-bytes", "utf8");
  fs.writeFileSync(videoPath, "fake-mp4-bytes", "utf8");
  const calls = [];
  let flowRequest = null;
  let flowCount = 0;
  let serverPort = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      calls.push(`${req.method} ${req.url}`);
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.method === "GET" && req.url === "/api/v2/channels/platforms") {
        send(200, { code: 0, data: [{ platform: "douyin" }, { platform: "twitter" }] });
        return;
      }
      if (req.method === "GET" && req.url === "/api/v2/channels/accounts") {
        send(200, { code: 0, data: { items: [{ id: "douyin-account-1", platform: "douyin" }] } });
        return;
      }
      if (req.method === "POST" && req.url === "/api/assets/uploadSign") {
        send(200, {
          code: 0,
          data: {
            id: "asset-1",
            uploadUrl: `http://127.0.0.1:${serverPort}/upload/asset-1`,
            uploadFields: { key: "asset-1" }
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/upload/asset-1") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/api/assets/asset-1/confirm") {
        send(200, { code: 0, data: { id: "asset-1", url: "https://assets.example.invalid/asset-1.png" } });
        return;
      }
      if (req.method === "POST" && req.url === "/api/v2/channels/publish/flows") {
        flowRequest = JSON.parse(body);
        flowCount += 1;
        const flowId = `flow-${flowCount}`;
        send(200, { code: 0, data: { flowId, tasks: [{ id: `task-${flowCount}`, platform: "douyin", status: 0 }] } });
        return;
      }
      if (req.method === "GET" && req.url === "/api/v2/channels/publish/flows/flow-1") {
        send(200, {
          code: 0,
          data: {
            flowId: "flow-1",
            tasks: [{ id: "task-1", platform: "douyin", status: 1, platformWorkId: "douyin-work-1", workLink: "https://example.invalid/douyin-work-1" }]
          }
        });
        return;
      }
      if (req.method === "GET" && req.url === "/api/v2/channels/publish/flows/flow-2") {
        send(200, {
          code: 0,
          data: { flowId: "flow-2", tasks: [{ id: "task-2", platform: "douyin", status: 8 }] }
        });
        return;
      }
      if (req.method === "GET" && req.url === "/api/v2/channels/publish/records/task-2/user-action") {
        send(200, { code: 0, data: { shortLink: "https://example.invalid/douyin-confirm" } });
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverPort = server.address().port;
  fs.writeFileSync(path.join(runtimeRoot, "platform-publishing.json"), JSON.stringify({
    adapters: {
      douyin: {
        engine: "aitoearn",
        mode: "aitoearn-rest",
        endpoint: `http://127.0.0.1:${serverPort}`,
        platformKey: "douyin",
        accountId: "douyin-account-1",
        pollIntervalMs: 1_000,
        pollTimeoutMs: 5_000
      }
    }
  }), "utf8");
  const ctx = context(runtimeRoot);
  const accepted = response();
  await handle({ method: "POST", body: JSON.stringify({
    platform: "douyin",
    title: "AiToEarn 测试标题",
    body: "AiToEarn 测试正文",
    images: [assetPath],
    confirmed: true
  }) }, accepted, "/api/platform-publishing/publish", {}, ctx);
  assert.equal(accepted.status, 202);
  const task = JSON.parse(accepted.body);
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const current = tasks.get(task.id);
      if (current?.state === "succeeded") return resolve();
      if (current?.state === "failed") return reject(new Error(JSON.stringify(current.error)));
      if (Date.now() - started > 3_000) return reject(new Error("AiToEarn REST task timed out"));
      setTimeout(poll, 10);
    };
    poll();
  });
  assert.equal(flowRequest.items[0].accountId, "douyin-account-1");
  assert.equal(flowRequest.items[0].platform, "douyin");
  assert.equal(flowRequest.items[0].overrides.media[0].url, "https://assets.example.invalid/asset-1.png");
  assert.equal(tasks.get(task.id).result.remoteId, "flow-1");
  assert.ok(calls.includes("POST /api/assets/uploadSign"));
  assert.ok(calls.includes("POST /api/assets/asset-1/confirm"));
  assert.ok(calls.includes("POST /api/v2/channels/publish/flows"));
  assert.ok(calls.includes("GET /api/v2/channels/publish/flows/flow-1"));

  const waitingResponse = response();
  await handle({ method: "POST", body: JSON.stringify({
    platform: "douyin",
    title: "AiToEarn 等待确认",
    body: "等待手机端确认",
    images: [assetPath],
    video: videoPath,
    confirmed: true
  }) }, waitingResponse, "/api/platform-publishing/publish", {}, ctx);
  assert.equal(waitingResponse.status, 202);
  const waitingTask = JSON.parse(waitingResponse.body);
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const current = tasks.get(waitingTask.id);
      if (current?.state === "waiting-user-action") return resolve();
      if (current?.state === "failed") return reject(new Error(JSON.stringify(current.error)));
      if (Date.now() - started > 3_000) return reject(new Error("AiToEarn waiting task timed out"));
      setTimeout(poll, 10);
    };
    poll();
  });
  assert.equal(tasks.get(waitingTask.id).result.userAction.shortLink, "https://example.invalid/douyin-confirm");
  assert.equal(flowRequest.content.media[0].metadata.type, "video");
  assert.equal(flowRequest.content.cover.metadata.type, "image");
  assert.equal(flowRequest.context.videoUrl, flowRequest.content.media[0].url);

  const check = response();
  await handle({ method: "POST", body: JSON.stringify({ platform: "douyin" }) }, check, "/api/platform-publishing/check", {}, ctx);
  assert.equal(check.status, 200);
  assert.match(check.body, /已读取 2 个平台元数据和 1 个授权账号/);
  assert.deepEqual(JSON.parse(check.body).result.platforms, ["douyin", "twitter"]);
  const history = response();
  await handle({ method: "GET" }, history, "/api/platform-publishing/tasks", {}, ctx);
  assert.equal(history.status, 200);
  assert.ok(JSON.parse(history.body).some((item) => item.platform === "douyin"));
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("platform publishing route speaks MCP HTTP for publish, login probe, and tool discovery", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-mcp-"));
  const requests = [];
  let publishFailure = false;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      requests.push({ payload, sessionId: req.headers["mcp-session-id"] || "" });
      const sendJsonRpc = (result) => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "fake-session"
        });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
      };
      if (payload.method === "initialize") {
        sendJsonRpc({
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-xiaohongshu-mcp", version: "test" }
        });
        return;
      }
      if (payload.method === "notifications/initialized") {
        res.writeHead(202);
        res.end();
        return;
      }
      if (payload.method === "tools/call" && payload.params?.name === "publish_content") {
        assert.deepEqual(payload.params.arguments, {
          title: "测试标题",
          content: "测试正文",
          images: ["C:\\test.png"]
        });
        if (publishFailure) {
          sendJsonRpc({ isError: true, content: [{ type: "text", text: "平台拒绝发布" }] });
          return;
        }
        sendJsonRpc({ content: [{ type: "text", text: JSON.stringify({ remoteId: "mcp-xhs-1", url: "https://example.invalid/mcp-xhs-1" }) }] });
        return;
      }
      if (payload.method === "tools/call" && payload.params?.name === "check_login_status") {
        sendJsonRpc({ content: [{ type: "text", text: "已登录" }] });
        return;
      }
      if (payload.method === "tools/list") {
        sendJsonRpc({
          tools: [
            { name: "check_login_status", description: "检查登录状态" },
            { name: "publish_content", description: "发布图文" }
          ]
        });
        return;
      }
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "unknown test method" } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  fs.writeFileSync(path.join(runtimeRoot, "platform-publishing.json"), JSON.stringify({
    adapters: {
      xiaohongshu: {
        mode: "mcp-http",
        endpoint: "http://127.0.0.1:" + port + "/mcp",
        tool: "publish_content"
      }
    }
  }), "utf8");
  const ctx = context(runtimeRoot);

  const accepted = response();
  await handle({ method: "POST", body: JSON.stringify({
    platform: "xhs",
    title: "测试标题",
    body: "测试正文",
    images: ["C:\\test.png"],
    confirmed: true
  }) }, accepted, "/api/platform-publishing/publish", {}, ctx);
  assert.equal(accepted.status, 202);
  const task = JSON.parse(accepted.body);
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const current = tasks.get(task.id);
      if (current?.state === "succeeded") return resolve();
      if (current?.state === "failed") return reject(new Error(JSON.stringify(current.error)));
      if (Date.now() - started > 2_000) return reject(new Error("MCP task timed out"));
      setTimeout(poll, 10);
    };
    poll();
  });
  assert.equal(tasks.get(task.id).result.remoteId, "mcp-xhs-1");
  assert.deepEqual(requests.slice(0, 3).map((item) => item.payload.method), [
    "initialize",
    "notifications/initialized",
    "tools/call"
  ]);
  assert.equal(requests[2].sessionId, "fake-session");
  assert.equal(requests[2].payload.params.name, "publish_content");

  publishFailure = true;
  const failedResponse = response();
  await handle({ method: "POST", body: JSON.stringify({
    platform: "xhs",
    title: "测试标题",
    body: "测试正文",
    images: ["C:\\test.png"],
    confirmed: true
  }) }, failedResponse, "/api/platform-publishing/publish", {}, ctx);
  assert.equal(failedResponse.status, 202);
  const failedTask = JSON.parse(failedResponse.body);
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const current = tasks.get(failedTask.id);
      if (current?.state === "failed") return resolve();
      if (current?.state === "succeeded") return reject(new Error("MCP tool error was marked as succeeded"));
      if (Date.now() - started > 2_000) return reject(new Error("MCP failure task timed out"));
      setTimeout(poll, 10);
    };
    poll();
  });
  assert.equal(tasks.get(failedTask.id).error.code, "PLATFORM_ADAPTER_TOOL_FAILED");

  const check = response();
  await handle({ method: "POST", body: JSON.stringify({ platform: "xiaohongshu" }) }, check, "/api/platform-publishing/check", {}, ctx);
  assert.equal(check.status, 200);
  assert.equal(JSON.parse(check.body).result.message, "已登录");

  const toolsResponse = response();
  await handle({ method: "POST", body: JSON.stringify({ platform: "xhs" }) }, toolsResponse, "/api/platform-publishing/tools", {}, ctx);
  assert.equal(toolsResponse.status, 200);
  assert.deepEqual(JSON.parse(toolsResponse.body).tools.map((tool) => tool.name), ["check_login_status", "publish_content"]);
  assert.ok(requests.some((item) => item.payload.method === "tools/list"));
  assert.ok(requests.every((item) => item.payload.jsonrpc === "2.0"));
  assert.ok(requests.every((item) => item.payload.method === "initialize" || item.payload.method === "notifications/initialized" || item.payload.method === "tools/call" || item.payload.method === "tools/list"));
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("platform publishing route marks persisted running tasks as interrupted on reload", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-recovery-"));
  const task = {
    id: "platform-publish-recovery-test",
    platform: "xiaohongshu",
    state: "running",
    progress: 42,
    createdAt: "2026-08-14T10:00:00.000Z",
    updatedAt: "2026-08-14T10:00:01.000Z",
    package: { platform: "xiaohongshu", title: "恢复测试", bodyLength: 4, imageCount: 1, hasVideo: false, sourceCollection: "", workId: "" },
    result: null,
    error: null
  };
  fs.writeFileSync(path.join(runtimeRoot, "platform-publishing-tasks.json"), JSON.stringify({ version: 1, tasks: [task] }), "utf8");
  const result = response();
  await handle({ method: "GET" }, result, "/api/platform-publishing/tasks", {}, context(runtimeRoot));
  assert.equal(result.status, 200);
  const restored = JSON.parse(result.body);
  assert.equal(restored[0].state, "interrupted");
  assert.equal(restored[0].error.code, "PLATFORM_TASK_INTERRUPTED");
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("platform publishing route explains an unreachable MCP adapter", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-unreachable-"));
  fs.writeFileSync(path.join(runtimeRoot, "platform-publishing.json"), JSON.stringify({
    adapters: {
      xiaohongshu: {
        mode: "mcp-http",
        endpoint: "http://127.0.0.1:1/mcp",
        tool: "publish_content",
        timeoutMs: 1_000
      }
    }
  }), "utf8");
  const result = response();
  await handle({ method: "POST", body: JSON.stringify({ platform: "xiaohongshu" }) }, result, "/api/platform-publishing/check", {}, context(runtimeRoot));
  assert.equal(result.status, 502);
  assert.match(result.body, /PLATFORM_ADAPTER_UNREACHABLE|PLATFORM_ADAPTER_TIMEOUT/);
  assert.match(result.body, /MCP 适配器无法连接/);
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});
