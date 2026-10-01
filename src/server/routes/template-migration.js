"use strict";

const fs = require("fs");
const path = require("path");
const {
  createSession,
  scanMaterialLibrary,
  confirmSession,
  advanceSession
} = require("../../lib/template-migration");

const SESSION_FILE_NAME = "template-migration-session.json";

function sessionFile(ctx) {
  return path.join(ctx.DATA_ROOT, SESSION_FILE_NAME);
}

function readSession(ctx) {
  try {
    const raw = fs.readFileSync(sessionFile(ctx), "utf8");
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch (_) {
    return null;
  }
}

function saveSession(ctx, session) {
  fs.mkdirSync(ctx.DATA_ROOT, { recursive: true });
  ctx.writeJson(sessionFile(ctx), session);
  return session;
}

function publicSession(session) {
  if (!session) return { ok: true, session: null };
  return {
    ok: true,
    session: {
      ...session,
      scan: {
        ...session.scan,
        materials: Array.isArray(session.scan?.materials)
          ? session.scan.materials.map((item) => ({
            ...item,
            facts: item.facts && typeof item.facts === "object" ? item.facts : {}
          }))
          : []
      }
    }
  };
}

async function readJsonBody(ctx, req) {
  const raw = await ctx.getBody(req, 160_000);
  try {
    const body = JSON.parse(raw || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求体必须是 JSON 对象");
    return body;
  } catch (error) {
    error.code = error.code || "TEMPLATE_MIGRATION_REQUEST_INVALID";
    throw error;
  }
}

function sendError(ctx, res, error, status = 400) {
  ctx.send(res, status, JSON.stringify({
    ok: false,
    error: String(error?.message || error),
    code: error?.code || "TEMPLATE_MIGRATION_ERROR"
  }), "application/json; charset=utf-8");
  return true;
}

async function handle(req, res, pathname, parsed, ctx) {
  if (!pathname.startsWith("/api/template-migration")) return false;

  if (pathname === "/api/template-migration/session" && req.method === "GET") {
    ctx.sendJson(res, publicSession(readSession(ctx)));
    return true;
  }

  if (pathname === "/api/template-migration/session" && req.method === "POST") {
    try {
      const body = await readJsonBody(ctx, req);
      const session = createSession(body);
      fs.mkdirSync(session.outputLibrary, { recursive: true });
      saveSession(ctx, session);
      ctx.sendJson(res, publicSession(session));
      return true;
    } catch (error) {
      return sendError(ctx, res, error);
    }
  }

  if (pathname === "/api/template-migration/session/refresh" && req.method === "POST") {
    try {
      const session = readSession(ctx);
      if (!session) throw new Error("还没有模板迁移批次，请先建立批次");
      const scan = scanMaterialLibrary(session.materialRoot);
      const selectedPaths = new Set((session.scan?.materials || []).map((item) => path.resolve(item.path)));
      session.scan = {
        ...scan,
        materials: selectedPaths.size
          ? scan.materials.filter((item) => selectedPaths.has(path.resolve(item.path)))
          : scan.materials
      };
      session.selection.resolved = session.scan.materials.length;
      session.progress.total = session.scan.materials.length;
      session.updatedAt = new Date().toISOString();
      saveSession(ctx, session);
      ctx.sendJson(res, publicSession(session));
      return true;
    } catch (error) {
      return sendError(ctx, res, error);
    }
  }

  if (pathname === "/api/template-migration/session/confirm" && req.method === "POST") {
    try {
      const body = await readJsonBody(ctx, req);
      if (String(body.confirmation || body.value || "").trim() !== "1") {
        const error = new Error("模板迁移必须输入 1 确认计划后才能进入生产");
        error.code = "TEMPLATE_MIGRATION_CONFIRMATION_REQUIRED";
        return sendError(ctx, res, error, 409);
      }
      const session = confirmSession(readSession(ctx), body.selectedMaterialPaths);
      fs.mkdirSync(session.outputLibrary, { recursive: true });
      saveSession(ctx, session);
      ctx.sendJson(res, publicSession(session));
      return true;
    } catch (error) {
      return sendError(ctx, res, error, error.code === "TEMPLATE_MIGRATION_CONFIRMATION_REQUIRED" ? 409 : 400);
    }
  }

  if (pathname === "/api/template-migration/session/advance" && req.method === "POST") {
    try {
      const body = await readJsonBody(ctx, req);
      const session = advanceSession(readSession(ctx), body.action, body.note);
      saveSession(ctx, session);
      ctx.sendJson(res, publicSession(session));
      return true;
    } catch (error) {
      return sendError(ctx, res, error);
    }
  }

  return false;
}

module.exports = { handle, publicSession };
