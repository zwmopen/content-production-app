"use strict";

/**
 * 工作台设置与本地备份路由
 * 匹配 /api/settings/paths, /api/page-settings, /api/local-backup/*
 * @returns {Promise<boolean>} true 表示已匹配并处理
 */
async function handle(req, res, pathname, parsed, ctx) {
  const {
    send, sendJson, getBody,
    saveWorkspaceSettings, getPageSettings, savePageSettings,
    buildCloudBackupPayload, restoreBackupPayload
  } = ctx;

  if (pathname === "/api/settings/paths" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    sendJson(res, { ok: true, settings: saveWorkspaceSettings(body) });
    return true;
  }
  if (pathname === "/api/page-settings" && req.method === "GET") {
    sendJson(res, { ok: true, settings: getPageSettings() });
    return true;
  }
  if (pathname === "/api/page-settings" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    sendJson(res, { ok: true, settings: savePageSettings(body) });
    return true;
  }

  if (pathname === "/api/local-backup/export" && req.method === "GET") {
    sendJson(res, { ok: true, backup: buildCloudBackupPayload() });
    return true;
  }

  if (pathname === "/api/local-backup/import" && req.method === "POST") {
    try {
      const body = JSON.parse(await getBody(req, 8_000_000) || "{}");
      const payload = body.backup || body;
      const restored = restoreBackupPayload(payload);
      sendJson(res, {
        ok: true,
        restoredRecords: restored.restored,
        localSnapshot: restored.localSnapshot,
        message: `已恢复 ${restored.restored} 份本地设置和记录`
      });
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
    }
    return true;
  }

  return false;
}

module.exports = { handle };
