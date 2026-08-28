"use strict";

const {
  importLifeGameConfig,
  publicStatus: publicCloudBackupStatus,
  readSecureConfig,
  saveManualConfig,
  testConnection: testCloudBackupConnection
} = require("../../lib/webdav-backup");

/**
 * 云备份路由
 * 匹配 /api/cloud-backup/*
 * @returns {Promise<boolean>} true 表示已匹配并处理
 */
async function handle(req, res, pathname, parsed, ctx) {
  const {
    send, sendJson, getBody,
    getCloudBackupStatus, runCloudBackupNow, inspectLatestCloudBackup,
    restoreLatestCloudBackup, getPageSettings, startLargeCloudBackup, readJson,
    getLargeCloudBackupTask,
    WEBDAV_CONFIG_FILE, CLOUD_LARGE_BACKUP_MANIFEST_FILE
  } = ctx;

  if (pathname === "/api/cloud-backup/status" && req.method === "GET") {
    sendJson(res, getCloudBackupStatus());
    return true;
  }

  if (pathname === "/api/cloud-backup/config" && req.method === "POST") {
    try {
      const body = JSON.parse(await getBody(req, 32_000) || "{}");
      const config = saveManualConfig(WEBDAV_CONFIG_FILE, body);
      await testCloudBackupConnection(config);
      sendJson(res, publicCloudBackupStatus(config, {
        lastResult: "坚果云配置已加密保存在当前 Windows 账户，并已通过连接测试"
      }));
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message || "坚果云配置没有保存" }));
    }
    return true;
  }

  if (pathname === "/api/cloud-backup/import-life-game" && req.method === "POST") {
    try {
      const config = await importLifeGameConfig(WEBDAV_CONFIG_FILE);
      sendJson(res, publicCloudBackupStatus(config, {
        lastBackupAt: "",
        lastBackupFile: "",
        lastResult: "已安全导入人生游戏系统的坚果云配置"
      }));
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message || "坚果云配置没有导入" }));
    }
    return true;
  }

  if (pathname === "/api/cloud-backup/test" && req.method === "POST") {
    try {
      const config = readSecureConfig(WEBDAV_CONFIG_FILE);
      if (!config) throw new Error("请先配置坚果云 WebDAV");
      await testCloudBackupConnection(config);
      sendJson(res, { ok: true, message: "坚果云连接正常" });
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message || "坚果云连接失败" }));
    }
    return true;
  }

  if (pathname === "/api/cloud-backup/run" && req.method === "POST") {
    try {
      sendJson(res, await runCloudBackupNow());
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message || "坚果云备份失败" }));
    }
    return true;
  }
  if (pathname === "/api/cloud-backup/inspect-latest" && req.method === "POST") {
    try {
      sendJson(res, await inspectLatestCloudBackup());
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message || "云端备份无法读取" }));
    }
    return true;
  }
  if (pathname === "/api/cloud-backup/restore-latest" && req.method === "POST") {
    try {
      const body = JSON.parse(await getBody(req, 8_000) || "{}");
      if (body.confirmed !== true) throw new Error("恢复前需要明确确认");
      sendJson(res, await restoreLatestCloudBackup());
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message || "云端备份恢复失败" }));
    }
    return true;
  }
  if (pathname === "/api/cloud-backup/run-large" && req.method === "POST") {
    try {
      const settings = getPageSettings().backup || {};
      if (!settings.sourceRoot) throw new Error("请先设置方案/大文件来源目录");
      sendJson(res, { ok: true, task: startLargeCloudBackup() });
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message || "大文件备份启动失败" }));
    }
    return true;
  }
  if (pathname === "/api/cloud-backup/large-status" && req.method === "GET") {
    sendJson(res, {
      task: getLargeCloudBackupTask() || readJson(CLOUD_LARGE_BACKUP_MANIFEST_FILE, {}).lastTask || null
    });
    return true;
  }

  return false;
}

module.exports = { handle };
