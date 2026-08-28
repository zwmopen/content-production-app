"use strict";

const fs = require("fs");
const path = require("path");
const {
  createTaskId,
  checkAiToEarnAdapter,
  checkMcpLogin,
  getPlatformCatalog,
  getRuntimeAdapter,
  invokeHttpAdapter,
  listMcpTools,
  normalizePlatformId,
  publicPublishPackage,
  redactOutput,
  validatePublishPackage
} = require("../../lib/platform-publishing");

const tasks = new Map();
const loadedTaskRoots = new Set();
const MAX_PERSISTED_TASKS = 30;
const TASKS_FILE_NAME = "platform-publishing-tasks.json";
const PLATFORM_SOURCE_MAX_BODY = 20_000;
const PLATFORM_SOURCE_MAX_IMAGES = 30;
const PLATFORM_SOURCE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const PLATFORM_SOURCE_TEXT_EXTENSIONS = new Set([".txt", ".md"]);

function publicTask(task) {
  return {
    id: task.id,
    platform: task.platform,
    state: task.state,
    progress: task.progress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    package: task.package,
    result: task.result || null,
    error: task.error || null
  };
}

function tasksFilePath(dataRoot) {
  return path.join(dataRoot, TASKS_FILE_NAME);
}

function tasksForRoot(dataRoot) {
  return [...tasks.values()]
    .filter((task) => task.runtimeRoot === dataRoot)
    .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)))
    .slice(-MAX_PERSISTED_TASKS);
}

function persistTasks(dataRoot) {
  if (!dataRoot) return;
  try {
    fs.mkdirSync(dataRoot, { recursive: true });
    const filePath = tasksFilePath(dataRoot);
    const temporaryPath = `${filePath}.tmp`;
    const backupPath = `${filePath}.bak`;
    const payload = JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      tasks: tasksForRoot(dataRoot).map(publicTask)
    }, null, 2) + "\n";
    fs.writeFileSync(temporaryPath, payload, "utf8");
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backupPath);
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    console.warn(`[platform-publishing] 任务记录保存失败: ${error.message}`);
  }
}

function loadPersistedTasks(dataRoot) {
  if (!dataRoot || loadedTaskRoots.has(dataRoot)) return;
  loadedTaskRoots.add(dataRoot);
  const filePath = tasksFilePath(dataRoot);
  let parsed;
  try {
    if (!fs.existsSync(filePath)) return;
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`[platform-publishing] 任务记录读取失败: ${error.message}`);
    return;
  }
  if (!Array.isArray(parsed?.tasks)) return;
  let interrupted = false;
  for (const storedTask of parsed.tasks.slice(-MAX_PERSISTED_TASKS)) {
    if (!storedTask?.id || !storedTask?.platform) continue;
    const task = {
      id: String(storedTask.id),
      platform: String(storedTask.platform),
      state: String(storedTask.state || "unknown"),
      progress: Number.isFinite(Number(storedTask.progress)) ? Number(storedTask.progress) : 0,
      createdAt: String(storedTask.createdAt || new Date().toISOString()),
      updatedAt: String(storedTask.updatedAt || storedTask.createdAt || new Date().toISOString()),
      package: storedTask.package || null,
      result: storedTask.result || null,
      error: storedTask.error || null,
      runtimeRoot: dataRoot
    };
    if (task.state === "running") {
      task.state = "interrupted";
      task.progress = Math.min(task.progress, 99);
      task.error = {
        code: "PLATFORM_TASK_INTERRUPTED",
        message: "应用在任务完成前退出；请人工确认平台状态后再决定是否重试。"
      };
      task.updatedAt = new Date().toISOString();
      interrupted = true;
    }
    tasks.set(task.id, task);
  }
  if (interrupted) persistTasks(dataRoot);
}

function setTask(task, patch, dataRoot = task.runtimeRoot) {
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  persistTasks(dataRoot);
  return publicTask(task);
}

function makeRequestError(message) {
  const error = new Error(message);
  error.code = "PLATFORM_REQUEST_INVALID";
  return error;
}

async function readJsonBody(getBody, req, limit) {
  let raw;
  try {
    raw = await getBody(req, limit);
  } catch (error) {
    error.code = error.code || "PLATFORM_REQUEST_INVALID";
    throw error;
  }
  try {
    const body = JSON.parse(raw || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw makeRequestError("请求体必须是 JSON 对象");
    }
    return body;
  } catch (error) {
    if (error.code === "PLATFORM_REQUEST_INVALID") throw error;
    throw makeRequestError("请求体不是有效的 JSON");
  }
}

function taskResultError(result) {
  if (result?.ok !== false) return null;
  const error = new Error(result.message || "外部适配器返回失败");
  error.code = "PLATFORM_ADAPTER_RESULT_FAILED";
  error.detail = result.message;
  return error;
}

function platformSourceError(message) {
  const error = new Error(message);
  error.code = "PLATFORM_SOURCE_INVALID";
  return error;
}

function readPlatformSource(input, { isAllowedFile, exists }) {
  const workId = String(input.workId || "").trim();
  if (!workId || !isAllowedFile(workId) || !exists(workId)) {
    throw platformSourceError("当前成品目录不存在或不在允许读取范围内");
  }
  let workStat;
  try {
    workStat = fs.statSync(workId);
  } catch {
    throw platformSourceError("当前成品目录无法读取");
  }
  if (!workStat.isDirectory()) throw platformSourceError("当前成品不是可读取的成品目录");

  let entries;
  try {
    entries = fs.readdirSync(workId, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  } catch {
    throw platformSourceError("当前成品目录无法列出文件");
  }
  const imageEntries = entries
    .filter((entry) => entry.isFile() && PLATFORM_SOURCE_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .slice(0, PLATFORM_SOURCE_MAX_IMAGES);
  const textEntries = entries
    .filter((entry) => entry.isFile() && PLATFORM_SOURCE_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
  const copyEntry = textEntries.find((entry) => /小红书文案|文案/i.test(entry.name)) || textEntries[0];
  let body = "";
  if (copyEntry) {
    const copyPath = path.join(workId, copyEntry.name);
    if (!isAllowedFile(copyPath) || !exists(copyPath)) throw platformSourceError("当前成品文案文件不在允许读取范围内");
    try {
      body = fs.readFileSync(copyPath, "utf8").trim().slice(0, PLATFORM_SOURCE_MAX_BODY);
    } catch {
      throw platformSourceError("当前成品文案无法读取");
    }
  }
  return {
    workId,
    title: path.basename(workId),
    body,
    images: imageEntries.map((entry) => path.join(workId, entry.name)),
    video: "",
    sourceCollection: String(input.sourceCollection || "").trim().slice(0, 240),
    textFile: copyEntry ? path.join(workId, copyEntry.name) : ""
  };
}

function configPath(ctx) {
  return path.join(ctx.DATA_ROOT, "platform-publishing.json");
}

function findPlatform(catalog, id) {
  return catalog.find((item) => item.id === id) || null;
}

async function handle(req, res, pathname, parsed, ctx) {
  const { send, sendJson, getBody, DATA_ROOT, isAllowedFile, exists, recordPlatformUsage } = ctx;
  const runtimeConfigPath = configPath({ DATA_ROOT });
  const catalog = () => getPlatformCatalog({ configPath: runtimeConfigPath });
  loadPersistedTasks(DATA_ROOT);

  if (pathname === "/api/platform-publishing/platforms" && req.method === "GET") {
    sendJson(res, { ok: true, platforms: catalog(), configFile: "运行数据/platform-publishing.json" });
    return true;
  }

  if (pathname === "/api/platform-publishing/tasks" && req.method === "GET") {
    sendJson(res, tasksForRoot(DATA_ROOT).reverse().map(publicTask));
    return true;
  }

  if (pathname === "/api/platform-publishing/check" && req.method === "POST") {
    try {
      const body = await readJsonBody(getBody, req, 8_000);
      const platformId = normalizePlatformId(body.platform);
      const adapter = getRuntimeAdapter(runtimeConfigPath, platformId);
      if (!platformId || !adapter || adapter.invalid) {
        send(res, 409, JSON.stringify({ error: "当前平台尚未配置有效适配器", code: "PLATFORM_ADAPTER_NOT_CONFIGURED" }));
        return true;
      }
      if (!["mcp-http", "aitoearn-rest"].includes(adapter.mode)) {
        send(res, 409, JSON.stringify({ error: "当前适配器暂不支持登录状态探测", code: "PLATFORM_ADAPTER_PROBE_UNSUPPORTED" }));
        return true;
      }
      const result = adapter.mode === "aitoearn-rest"
        ? await checkAiToEarnAdapter(adapter)
        : await checkMcpLogin(adapter);
      sendJson(res, { ok: result.ok !== false, platform: findPlatform(catalog(), platformId), result });
    } catch (error) {
      const status = error.code === "PLATFORM_REQUEST_INVALID" ? 400 : 502;
      send(res, status, JSON.stringify({ error: error.message, code: error.code || "PLATFORM_ADAPTER_PROBE_FAILED", detail: redactOutput(error.detail) }), "application/json; charset=utf-8");
    }
    return true;
  }

  if (pathname === "/api/platform-publishing/tools" && req.method === "POST") {
    try {
      const body = await readJsonBody(getBody, req, 8_000);
      const platformId = normalizePlatformId(body.platform);
      const adapter = getRuntimeAdapter(runtimeConfigPath, platformId);
      if (!platformId || !adapter || adapter.invalid || adapter.mode !== "mcp-http") {
        send(res, 409, JSON.stringify({ error: "当前平台没有可探测的 MCP 适配器", code: "PLATFORM_ADAPTER_NOT_CONFIGURED" }));
        return true;
      }
      sendJson(res, { ok: true, platform: findPlatform(catalog(), platformId), tools: await listMcpTools(adapter) });
    } catch (error) {
      const status = error.code === "PLATFORM_REQUEST_INVALID" ? 400 : 502;
      send(res, status, JSON.stringify({ error: error.message, code: error.code || "PLATFORM_ADAPTER_TOOLS_FAILED", detail: redactOutput(error.detail) }), "application/json; charset=utf-8");
    }
    return true;
  }

  if (pathname === "/api/platform-publishing/source" && req.method === "POST") {
    try {
      const body = await readJsonBody(getBody, req, 8_000);
      sendJson(res, { ok: true, source: readPlatformSource(body, { isAllowedFile, exists }) });
    } catch (error) {
      const status = error.code === "PLATFORM_REQUEST_INVALID" ? 400 : 400;
      send(res, status, JSON.stringify({ error: error.message, code: error.code || "PLATFORM_SOURCE_INVALID" }), "application/json; charset=utf-8");
    }
    return true;
  }

  if (pathname === "/api/platform-publishing/mark-used" && req.method === "POST") {
    try {
      const body = await readJsonBody(getBody, req, 16_000);
      if (body.confirmed !== true) {
        send(res, 409, JSON.stringify({ error: "请在官方平台完成发布后，再明确确认记录使用状态", code: "PLATFORM_USAGE_CONFIRMATION_REQUIRED" }));
        return true;
      }
      const platformId = normalizePlatformId(body.platform);
      const platform = findPlatform(catalog(), platformId);
      if (!platform) {
        send(res, 400, JSON.stringify({ error: "当前平台不在多平台分发目录中", code: "PLATFORM_INVALID" }));
        return true;
      }
      if (typeof recordPlatformUsage !== "function") {
        send(res, 503, JSON.stringify({ error: "平台使用记录服务尚未接入", code: "PLATFORM_USAGE_UNAVAILABLE" }));
        return true;
      }
      const record = recordPlatformUsage({
        workId: body.workId,
        platform: platformId,
        source: body.source || "manual_confirmation",
        sourceCollection: body.sourceCollection || ""
      });
      sendJson(res, { ok: true, state: "recorded", platform, record });
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message, code: error.code || "PLATFORM_USAGE_RECORD_FAILED" }));
    }
    return true;
  }

  if (pathname === "/api/platform-publishing/prepare" && req.method === "POST") {
    try {
      const body = await readJsonBody(getBody, req, 64_000);
      const packageData = validatePublishPackage(body, { isAllowedFile, exists });
      const platform = findPlatform(catalog(), packageData.platform);
      sendJson(res, {
        ok: true,
        state: "prepared",
        platform,
        package: publicPublishPackage(packageData),
        next: platform?.manualHandoff
          ? platform.id === "ctrip"
            ? "可从左侧批量打开官方图文编辑器并保存草稿；正式发布仍由你确认"
            : "可复制内容并打开官方平台页面，在页面内完成上传、预览和发布确认"
          : platform?.configured
            ? "可在明确确认后调用外部适配器"
            : "先配置外部适配器端点"
      });
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message, code: error.code || "PUBLISH_PACKAGE_INVALID" }));
    }
    return true;
  }

  if (pathname === "/api/platform-publishing/publish" && req.method === "POST") {
    try {
      const body = await readJsonBody(getBody, req, 64_000);
      if (body.confirmed !== true) {
        send(res, 409, JSON.stringify({ error: "真实平台发布必须在工作台中明确确认本次操作", code: "PUBLISH_CONFIRMATION_REQUIRED" }));
        return true;
      }
      const packageData = validatePublishPackage(body, { isAllowedFile, exists });
      const platform = findPlatform(catalog(), packageData.platform);
      if (platform?.manualHandoff) {
        send(res, 409, JSON.stringify({
          error: `${platform.name || "当前平台"}需要在官方页面内由你完成上传和发布确认`,
          code: "PLATFORM_MANUAL_HANDOFF_REQUIRED",
          platform
        }));
        return true;
      }
      const adapter = getRuntimeAdapter(runtimeConfigPath, packageData.platform);
      if (!platform || !platform.engine || !adapter || adapter.invalid) {
        send(res, 409, JSON.stringify({
          error: platform?.note || "当前平台尚未配置真实适配器",
          code: adapter?.invalid ? "PLATFORM_ADAPTER_CONFIG_INVALID" : "PLATFORM_ADAPTER_NOT_CONFIGURED",
          platform
        }));
        return true;
      }
      const task = {
        id: createTaskId(),
        platform: packageData.platform,
        state: "running",
        progress: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        package: publicPublishPackage(packageData),
        result: null,
        error: null,
        runtimeRoot: DATA_ROOT
      };
      tasks.set(task.id, task);
      persistTasks(DATA_ROOT);
      send(res, 202, JSON.stringify(publicTask(task)), "application/json; charset=utf-8");
      invokeHttpAdapter(adapter, packageData)
        .then((result) => {
          const resultError = taskResultError(result);
          if (resultError) throw resultError;
          if (result?.state === "waiting-user-action") {
            return setTask(task, { state: "waiting-user-action", progress: 75, result, error: null }, DATA_ROOT);
          }
          if (typeof recordPlatformUsage === "function") {
            recordPlatformUsage({
              workId: packageData.workId,
              platform: packageData.platform,
              source: "platform_adapter_success",
              sourceCollection: packageData.sourceCollection
            });
          }
          return setTask(task, { state: "succeeded", progress: 100, result }, DATA_ROOT);
        })
        .catch((error) => setTask(task, {
          state: "failed",
          progress: 100,
          error: { code: error.code || "PLATFORM_ADAPTER_FAILED", message: error.message, detail: redactOutput(error.detail) }
        }, DATA_ROOT));
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message, code: error.code || "PLATFORM_PUBLISH_FAILED" }), "application/json; charset=utf-8");
    }
    return true;
  }

  if (pathname.startsWith("/api/platform-publishing/tasks/") && req.method === "GET") {
    const taskId = decodeURIComponent(pathname.slice("/api/platform-publishing/tasks/".length));
    const task = tasks.get(taskId);
    if (!task || task.runtimeRoot !== DATA_ROOT) { send(res, 404, JSON.stringify({ error: "平台发布任务不存在" })); return true; }
    sendJson(res, publicTask(task));
    return true;
  }

  return false;
}

module.exports = { handle, tasks };
