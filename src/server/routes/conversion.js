/**
 * 流量转化路由
 * handleEarly: 匹配 /mobile-conversion（在远程访问检查之前执行，允许手机访问）
 * handle: 匹配 /conversion-integrated, /api/conversion/*（仅本机访问）
 */

async function handleEarly(req, res, pathname, parsed, ctx) {
  const {
    send, sendJson, sendExtensionJson, getBody,
    PUBLIC_ROOT,
    hasMobileConversionAccess, mobileConversionToken,
    requestConversionService,
  } = ctx;

  const path = require("path");
  const fs = require("fs");

  if (pathname === "/mobile-conversion") {
    if (!hasMobileConversionAccess(req, parsed)) {
      return send(res, 403, "手机入口无效，请回到电脑端重新复制手机入口。", "text/plain; charset=utf-8");
    }
    res.writeHead(302, {
      "Location": "/mobile-conversion/app",
      "Set-Cookie": `tb_mobile_access=${encodeURIComponent(mobileConversionToken())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
      "Cache-Control": "no-store"
    });
    return res.end();
  }

  if (pathname.startsWith("/mobile-conversion/")) {
    if (!hasMobileConversionAccess(req, parsed)) {
      return send(res, 403, "手机入口无效，请回到电脑端重新复制手机入口。", "text/plain; charset=utf-8");
    }
    if (pathname === "/mobile-conversion/app" && req.method === "GET") {
      const mobileFile = path.join(PUBLIC_ROOT, "mobile-conversion.html");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return fs.createReadStream(mobileFile).pipe(res);
    }
    if (pathname === "/mobile-conversion/api/search" && req.method === "POST") {
      const body = JSON.parse(await getBody(req, 64_000) || "{}");
      const question = String(body.question || body.问题 || "").trim();
      const role = body.role === "后端转化" ? "后端转化" : "前端运营";
      if (!question) return send(res, 400, JSON.stringify({ error: "请先粘贴客户原话" }), "application/json; charset=utf-8");
      if (question.length > 3_000) return send(res, 400, JSON.stringify({ error: "客户原话过长，请先精简到 3000 字以内" }), "application/json; charset=utf-8");
      try {
        return sendJson(res, await requestConversionService("/api/智能匹配", {
          method: "POST",
          body: { 问题: question, 身份: role },
          timeoutMs: 60_000
        }));
      } catch (error) {
        return send(res, 502, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
      }
    }
    return send(res, 404, "not found", "text/plain; charset=utf-8");
  }

  return false;
}

async function handle(req, res, pathname, parsed, ctx) {
  const {
    send, sendJson, sendExtensionJson, getBody, exists,
    LISTEN_HOST,
    CONVERSION_ASSISTANT_LAUNCHER, CONVERSION_ASSISTANT_ROOT,
    mobileConversionLink, localIPv4Addresses,
    proxyIntegratedConversion, isIntegratedConversionCompatibilityPath,
    requestConversionService, getConversionSnapshot, ensureConversionService,
  } = ctx;

  if (pathname === "/conversion-integrated" || pathname.startsWith("/conversion-integrated/")) {
    await proxyIntegratedConversion(req, res, parsed, pathname);
    return true;
  }
  if (isIntegratedConversionCompatibilityPath(pathname)) {
    await proxyIntegratedConversion(req, res, parsed, `/conversion-integrated${pathname}`);
    return true;
  }

  if (pathname === "/api/conversion/snapshot" && req.method === "GET") {
    return sendExtensionJson(req, res, await getConversionSnapshot({
      includeLargeIndexes: parsed.query.lite !== "1"
    }));
  }

  if (pathname === "/api/conversion/search-index" && req.method === "GET") {
    try {
      return sendExtensionJson(req, res, await requestConversionService("/api/搜索快照", {
        timeoutMs: 45_000
      }));
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
    }
  }

  if (pathname === "/api/conversion/plan-index" && req.method === "GET") {
    try {
      return sendExtensionJson(req, res, await requestConversionService("/api/方案索引", {
        timeoutMs: 30_000
      }));
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
    }
  }

  if (pathname === "/api/conversion/mobile-link" && req.method === "GET") {
    return sendJson(res, {
      ok: true,
      enabled: LISTEN_HOST === "0.0.0.0" || LISTEN_HOST === "::",
      url: mobileConversionLink(),
      network: localIPv4Addresses()[0] || "",
      note: "手机与电脑需连接同一 Wi-Fi；链接只允许进入流量转化。"
    });
  }

  if (pathname === "/api/conversion/proposal" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    const demand = String(body.demand || body.需求 || "").trim();
    if (!demand) return send(res, 400, JSON.stringify({ error: "请先写下客户需求" }), "application/json; charset=utf-8");
    if (demand.length > 6_000) return send(res, 400, JSON.stringify({ error: "客户需求过长，请先精简到 6000 字以内" }), "application/json; charset=utf-8");
    try {
      return sendJson(res, await requestConversionService("/api/方案策划", {
        method: "POST",
        body: { 需求: demand },
        timeoutMs: 90_000
      }));
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
    }
  }

  if (pathname === "/api/conversion/search" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    const question = String(body.question || body.问题 || "").trim();
    const role = body.role === "后端转化" ? "后端转化" : "前端运营";
    if (!question) return send(res, 400, JSON.stringify({ error: "请先输入客户问题" }), "application/json; charset=utf-8");
    if (question.length > 3_000) return send(res, 400, JSON.stringify({ error: "客户问题过长，请先精简到 3000 字以内" }), "application/json; charset=utf-8");
    try {
      return sendJson(res, await requestConversionService("/api/智能匹配", {
        method: "POST",
        body: { 问题: question, 身份: role },
        timeoutMs: 60_000
      }));
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
    }
  }

  if (pathname === "/api/conversion/start" && req.method === "POST") {
    try {
      return sendJson(res, await ensureConversionService());
    } catch (error) {
      return send(res, 503, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
    }
  }

  return false;
}

module.exports = { handleEarly, handle };
