"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const childProcess = require("child_process");

const DOWNLOAD_SKILL_ID = "universal-downloader";
const DOWNLOAD_SKILL_NAME = "素材下载";
const DOWNLOAD_PROJECT_ROOT = process.env.TEAMBUILDING_UNIVERSAL_DOWNLOADER_ROOT
  || "D:\\AICode\\工具开发\\projects\\xhs-dl";
const DOWNLOAD_SKILL_ROOT = process.env.TEAMBUILDING_UNIVERSAL_DOWNLOADER_SKILL_ROOT
  || "D:\\AICode\\AI\\skills\\技能包\\技能\\universal-downloader";
const DOWNLOAD_SCRIPT = path.join(DOWNLOAD_PROJECT_ROOT, "skills", "universal-downloader", "scripts", "download.py");
const DOWNLOAD_FALLBACK_SCRIPT = path.join(DOWNLOAD_SKILL_ROOT, "scripts", "download.py");
const MAX_INPUT_LENGTH = 240_000;
const MAX_TASKS = 30;
const JOB_TIMEOUT_MS = 12 * 60 * 1000;
const jobs = new Map();

function defaultOutputDir() {
  return process.env.TEAMBUILDING_MATERIAL_DOWNLOAD_OUTPUT
    || path.join(os.homedir(), "Downloads");
}

function projectRoot() {
  return path.resolve(DOWNLOAD_PROJECT_ROOT);
}

function scriptPath() {
  if (fs.existsSync(DOWNLOAD_SCRIPT)) return DOWNLOAD_SCRIPT;
  return DOWNLOAD_FALLBACK_SCRIPT;
}

function catalog() {
  const script = scriptPath();
  return [{
    id: "material-download",
    skillId: DOWNLOAD_SKILL_ID,
    name: DOWNLOAD_SKILL_NAME,
    displayName: DOWNLOAD_SKILL_NAME,
     description: "粘贴公开素材分享文案或链接，调用已连接的万能下载器，结果保存到素材下载设置指定的目录。",
    input: "分享文案 / 一个或多个公开链接",
    output: "图片、视频、文案.txt 与集中历史记录",
    mode: "cautious",
    defaultOutputDir: defaultOutputDir(),
    sourceRoot: projectRoot(),
    script: script,
    available: fs.existsSync(script) && fs.existsSync(projectRoot()),
    loginRequired: false,
    destructive: false
  }];
}

function publicResult(result) {
  if (!result || typeof result !== "object") return result || null;
  return {
    success: Number(result.success || 0),
    failed: Number(result.failed || 0),
    total: Number(result.total || 0),
    output_dir: result.output_dir ? String(result.output_dir) : "",
    items: Array.isArray(result.items) ? result.items.slice(0, 100).map((item) => ({
      url: item?.url ? String(item.url) : "",
      success: Boolean(item?.success),
      title: item?.title ? String(item.title) : "",
      note_id: item?.note_id ? String(item.note_id) : "",
      save_dir: item?.save_dir ? String(item.save_dir) : "",
      image_count: Number(item?.image_count || 0),
      media_format: item?.media_format ? String(item.media_format) : "",
      error: item?.error ? String(item.error) : ""
    })) : []
  };
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    state: job.state,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    outputDir: job.outputDir,
    inputCount: job.inputCount,
    result: publicResult(job.result),
    error: job.error || null
  };
}

function createJobId() {
  return `material-download-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  while (jobs.size > MAX_TASKS) {
    const oldest = [...jobs.values()].sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))[0];
    if (!oldest || oldest.id === job.id || oldest.state === "running") break;
    jobs.delete(oldest.id);
  }
  return publicJob(job);
}

function parseProcessPayload(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const start = text.lastIndexOf("{");
  if (start >= 0) {
    try { return JSON.parse(text.slice(start)); } catch {}
  }
  return null;
}

function countInputUrls(text) {
  return (String(text || "").match(/https?:\/\/[^\s]+/gi) || []).length;
}

function safeOutputDir(input) {
  const requested = String(input || "").trim();
  const target = path.resolve(requested || defaultOutputDir());
  const allowedRoots = [
    path.resolve(defaultOutputDir()),
    path.resolve("D:\\Download"),
    path.resolve("D:\\Download\\素材下载")
  ];
  if (!allowedRoots.some((root) => target === root || target.startsWith(`${root}${path.sep}`))) {
    const error = new Error("素材下载只能保存到默认下载目录或 D:\\Download 下的目录");
    error.code = "MATERIAL_DOWNLOAD_OUTPUT_NOT_ALLOWED";
    throw error;
  }
  return target;
}

function startProcess(job, text, ctx, inputFile) {
  const script = scriptPath();
  const python = ctx.pythonExe ? ctx.pythonExe() : "python";
  const child = childProcess.spawn(python, [
    script,
    "--file", inputFile,
    "--output", job.outputDir,
    "--mode", "cautious",
    "--timeout", "300"
  ], {
    cwd: projectRoot(),
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONPATH: [projectRoot(), process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  const finish = (patch) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { fs.rmSync(inputFile, { force: true }); } catch {}
    updateJob(job, patch);
  };
  const timer = setTimeout(() => {
    try { child.kill(); } catch {}
    finish({
      state: "failed",
      progress: 100,
      error: { code: "MATERIAL_DOWNLOAD_TIMEOUT", message: "下载超过 12 分钟，进程已停止；已完成的文件会保留。" },
      result: parseProcessPayload(stdout)
    });
  }, JOB_TIMEOUT_MS);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-2_000_000); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-40_000); });
  child.on("error", (error) => finish({
    state: "failed",
    progress: 100,
    error: { code: error.code || "MATERIAL_DOWNLOAD_PROCESS_ERROR", message: error.message },
    result: null
  }));
  child.on("close", (code) => {
    const result = parseProcessPayload(stdout);
    const failed = Number(result?.failed || 0);
    const success = Number(result?.success || 0);
    const ok = code === 0 && failed === 0 && success > 0;
    finish({
      state: ok ? "succeeded" : "failed",
      progress: 100,
      result: result || { success, failed, stdout, stderr },
      error: ok ? null : {
        code: "MATERIAL_DOWNLOAD_FAILED",
        message: result?.error || (stderr.trim() || `下载进程退出（${code ?? "未知"}）`)
      }
    });
  });
}

async function readJsonBody(getBody, req) {
  const raw = await getBody(req, MAX_INPUT_LENGTH + 20_000);
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("请求体必须是 JSON 对象");
    return parsed;
  } catch (error) {
    error.code = error.code || "MATERIAL_DOWNLOAD_REQUEST_INVALID";
    throw error;
  }
}

async function handle(req, res, pathname, parsed, ctx) {
  const { send, sendJson, DATA_ROOT, getBody, getPageSettings, savePageSettings } = ctx;
  if (pathname === "/api/skills" && req.method === "GET") {
    return sendJson(res, { ok: true, skills: catalog() });
  }
  if (pathname === "/api/skills/material-download/status" && req.method === "GET") {
    const savedOutputDir = getPageSettings?.().skills?.materialDownloadOutputDir || "";
    return sendJson(res, {
      ok: true,
      skill: catalog()[0],
      settings: { outputDir: savedOutputDir || defaultOutputDir() },
      activeJobs: [...jobs.values()].filter((job) => job.state === "running").length
    });
  }
  if (pathname === "/api/skills/material-download/settings") {
    if (req.method === "GET") {
      const savedOutputDir = getPageSettings?.().skills?.materialDownloadOutputDir || "";
      return sendJson(res, { ok: true, outputDir: savedOutputDir || defaultOutputDir() });
    }
    if (req.method === "POST") {
      try {
        const body = await readJsonBody(getBody, req);
        const outputDir = safeOutputDir(body.outputDir);
        const currentSkills = getPageSettings?.().skills || {};
        const settings = savePageSettings
          ? savePageSettings({ skills: { ...currentSkills, materialDownloadOutputDir: outputDir } })
          : null;
        return sendJson(res, { ok: true, outputDir, settings: settings?.skills || null });
      } catch (error) {
        return send(res, 400, JSON.stringify({ ok: false, error: error.message, code: error.code || "MATERIAL_DOWNLOAD_SETTINGS_INVALID" }));
      }
    }
    return send(res, 405, JSON.stringify({ ok: false, error: "method not allowed" }));
  }
  if (pathname === "/api/skills/material-download/run" && req.method === "POST") {
    try {
      const body = await readJsonBody(getBody, req);
      const text = String(body.text || "").trim();
      if (!text) throw new Error("请先粘贴素材分享文案或链接");
      if (text.length > MAX_INPUT_LENGTH) throw new Error(`输入内容过长，请控制在 ${MAX_INPUT_LENGTH.toLocaleString()} 字以内`);
      const skill = catalog()[0];
      if (!skill.available) throw new Error("万能下载器 V2 技能入口不可用，请先检查 xhs-dl 项目");
      const outputDir = safeOutputDir(body.outputDir);
      const runRoot = path.join(DATA_ROOT, "skill-runs", "material-download");
      fs.mkdirSync(runRoot, { recursive: true });
      const id = createJobId();
      const inputFile = path.join(runRoot, `${id}.txt`);
      fs.writeFileSync(inputFile, text, "utf8");
      const now = new Date().toISOString();
      const job = {
        id,
        state: "running",
        progress: 5,
        createdAt: now,
        updatedAt: now,
        outputDir,
        inputCount: countInputUrls(text),
        result: null,
        error: null
      };
      jobs.set(id, job);
      startProcess(job, text, ctx, inputFile);
      return send(res, 202, JSON.stringify({ ok: true, job: publicJob(job), skill }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 400, JSON.stringify({ ok: false, error: error.message, code: error.code || "MATERIAL_DOWNLOAD_FAILED" }));
    }
  }
  if (pathname.startsWith("/api/skills/material-download/tasks/") && req.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/api/skills/material-download/tasks/".length));
    const job = jobs.get(id);
    if (!job) return send(res, 404, JSON.stringify({ ok: false, error: "素材下载任务不存在" }));
    return sendJson(res, { ok: true, job: publicJob(job) });
  }
  return false;
}

module.exports = {
  handle,
  catalog,
  defaultOutputDir,
  projectRoot,
  scriptPath,
  safeOutputDir,
  jobs
};
