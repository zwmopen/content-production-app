"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const wechatDraft = require("../../lib/wechat-draft");
const { getDistributionSnapshot } = require("../../lib/distribution-data");

/**
 * 微信公众号草稿路由
 * 匹配 /api/wechat-draft/*
 * @returns {Promise<boolean>} true 表示已匹配并处理
 */
async function handle(req, res, pathname, parsed, ctx) {
  const { send, sendJson, getBody, isAllowedFile, PUBLISH_ROOT, getWorkspaceSettings } = ctx;

  if (pathname === "/api/wechat-draft/settings" && req.method === "GET") {
    sendJson(res, wechatDraft.getWechatSettings());
    return true;
  }
  if (pathname === "/api/wechat-draft/settings" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    sendJson(res, wechatDraft.saveWechatSettings(body));
    return true;
  }
  if (pathname === "/api/wechat-draft/set-secret" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    const envVar = String(body.envVar || "").trim();
    const value = String(body.value || "").trim();
    if (!envVar || !value) {
      send(res, 400, JSON.stringify({ success: false, error: "envVar 和 value 不能为空" }));
      return true;
    }
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(envVar)) {
      send(res, 400, JSON.stringify({ success: false, error: "环境变量名格式不合法" }));
      return true;
    }
    try {
      const setxPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "setx.exe");
      childProcess.execSync(`"${setxPath}" ${envVar} "${value.replace(/"/g, '\\"')}"`, { windowsHide: true });
      process.env[envVar] = value;
      sendJson(res, { success: true, message: `环境变量 ${envVar} 已设置，重启工作台后永久生效` });
    } catch (error) {
      send(res, 500, JSON.stringify({ success: false, error: error.message }));
    }
    return true;
  }
  // 账号状态检查：返回每个账号的 AppID 和 AppSecret 环境变量配置情况
  if (pathname === "/api/wechat-draft/account-status" && req.method === "GET") {
    const settings = wechatDraft.getWechatSettings();
    const accountKeys = Object.keys(settings.accounts || {});
    const status = accountKeys.map((key) => {
      const acc = settings.accounts[key];
      const envVar = acc.appSecretEnv || `WECHAT_${key.toUpperCase()}_APP_SECRET`;
      return {
        key,
        name: acc.name || key,
        appId: acc.appId || "",
        appIdSet: !!(acc.appId && acc.appId.trim()),
        appSecretEnv: envVar,
        appSecretSet: !!process.env[envVar],
        ready: !!(acc.appId && acc.appId.trim() && process.env[envVar])
      };
    });
    sendJson(res, {
      defaultAccount: settings.defaultAccount || "main",
      accounts: status,
      anyReady: status.some((s) => s.ready),
      allReady: status.length > 0 && status.every((s) => s.ready)
    });
    return true;
  }
  // 测试连接：调用微信 API 获取 access_token，验证配置是否有效
  if (pathname === "/api/wechat-draft/test-connection" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 8_000) || "{}");
    const settings = wechatDraft.getWechatSettings();
    const accountKey = body.account || settings.defaultAccount || "main";
    const account = settings.accounts?.[accountKey];
    if (!account || !account.appId) {
      send(res, 400, JSON.stringify({ success: false, error: `账号 ${accountKey} 未配置 AppID，请先在账号设置中填写` }));
      return true;
    }
    const envVar = account.appSecretEnv || `WECHAT_${accountKey.toUpperCase()}_APP_SECRET`;
    const appSecret = process.env[envVar] || "";
    if (!appSecret) {
      send(res, 400, JSON.stringify({
        success: false,
        error: `环境变量 ${envVar} 未设置。请回到账号设置重新填写 AppSecret 并保存，然后重启工作台。`
      }));
      return true;
    }
    try {
      await wechatDraft.getAccessToken(account.appId, appSecret);
      sendJson(res, {
        success: true,
        message: `连接成功！账号「${account.name || accountKey}」的 AppID 和 AppSecret 验证通过，可以创建草稿了。`
      });
    } catch (error) {
      const errMsg = String(error.message || error);
      let hint = "";
      if (errMsg.includes("40164")) {
        hint = "问题原因：当前电脑的 IP 地址不在公众号白名单里。请到公众号后台 → 开发 → 基本配置 → IP白名单，添加本机 IP。";
      } else if (errMsg.includes("40001") || errMsg.includes("40125")) {
        hint = "问题原因：AppSecret 不正确。请到公众号后台重新复制 AppSecret，回到账号设置重新填写。";
      } else if (errMsg.includes("40013")) {
        hint = "问题原因：AppID 不正确。请检查 AppID 是否以 wx 开头，是否复制完整。";
      }
      send(res, 400, JSON.stringify({ success: false, error: errMsg, hint }));
    }
    return true;
  }
  if (pathname === "/api/wechat-draft/history" && req.method === "GET") {
    sendJson(res, { records: wechatDraft.getDraftHistory(50) });
    return true;
  }
  if (pathname.startsWith("/api/wechat-draft/posts/") && req.method === "GET") {
    const collectionName = decodeURIComponent(pathname.slice("/api/wechat-draft/posts/".length));
    const settings = getWorkspaceSettings();
    const libraryRoot = settings.workPackage.libraryPath;
    // 先尝试从分发快照中获取作品集的实际源路径
    let collectionPath = "";
    try {
      const snapshot = getDistributionSnapshot({ publishRoot: PUBLISH_ROOT, libraryRoot });
      const entry = (snapshot.collections || []).find((item) => item.name === collectionName);
      if (entry && entry.sourcePath) {
        collectionPath = entry.sourcePath;
      }
    } catch { /* 忽略快照错误，回退到默认路径 */ }
    // 回退：使用公众号工作流阶段目录
    if (!collectionPath) {
      collectionPath = path.join(libraryRoot, "微信公众号", collectionName);
    }
    // 安全检查：防止路径穿越
    if (/[\\/]wp-content|[\\/]system32/i.test(collectionPath)) {
      send(res, 400, JSON.stringify({ error: "无效的作品集名称" }));
      return true;
    }
    try {
      const result = wechatDraft.scanCollectionPosts(collectionPath);
      sendJson(res, result);
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message }));
    }
    return true;
  }
  if (pathname === "/api/wechat-draft/image-preview" && req.method === "GET") {
    // 图片预览：通过文件路径返回图片内容
    const imgPath = parsed.query.path;
    if (!imgPath || !isAllowedFile(imgPath)) { send(res, 403, JSON.stringify({ error: "path not allowed" })); return true; }
    if (!fs.existsSync(imgPath)) { send(res, 404, JSON.stringify({ error: "file not found" })); return true; }
    const ext = path.extname(imgPath).toLowerCase();
    const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
    const mime = mimeTypes[ext] || "application/octet-stream";
    const buffer = fs.readFileSync(imgPath);
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "max-age=3600" });
    res.end(buffer);
    return true;
  }
  if (pathname === "/api/wechat-draft/create" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 256_000) || "{}");
    // 获取账号配置
    const settings = wechatDraft.getWechatSettings();
    const accountKey = body.account || settings.defaultAccount || "main";
    const account = settings.accounts?.[accountKey];
    if (!body.dryRun && (!account || !account.appId)) {
      send(res, 400, JSON.stringify({ error: `账号 ${accountKey} 未配置 AppID` }));
      return true;
    }
    // 读取 AppSecret（从环境变量）
    let appSecret = "";
    if (!body.dryRun && account) {
      const envVar = account.appSecretEnv || `WECHAT_${accountKey.toUpperCase()}_APP_SECRET`;
      appSecret = process.env[envVar] || "";
      if (!appSecret) {
        send(res, 400, JSON.stringify({ error: `环境变量 ${envVar} 未设置，无法获取 AppSecret` }));
        return true;
      }
    }
    try {
      const result = await wechatDraft.createDraftTask({
        postPath: body.postPath,
        title: body.title,
        body: body.body,
        account: accountKey,
        dryRun: body.dryRun !== false,
        forceCreate: body.forceCreate === true,
        appId: account?.appId,
        appSecret
      });
      sendJson(res, result);
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message }));
    }
    return true;
  }

  if (pathname === "/api/wechat-draft/web/prepare" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 256_000) || "{}");
    try {
      const result = await wechatDraft.prepareWebDraftTask({
        postPath: body.postPath,
        title: body.title,
        body: body.body,
        account: body.account || "web",
        draftType: body.draftType === "article" ? "article" : "newspic",
        forceCreate: body.forceCreate === true
      });
      sendJson(res, result);
    } catch (error) {
      send(res, 400, JSON.stringify({ success: false, error: error.message }));
    }
    return true;
  }

  if (pathname === "/api/wechat-draft/web/complete" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 256_000) || "{}");
    try {
      const result = await wechatDraft.recordWebDraftSuccess({
        postPath: body.postPath,
        title: body.title,
        body: body.body,
        account: body.account || "web",
        draftType: body.draftType === "article" ? "article" : "newspic",
        forceCreate: body.forceCreate === true
      });
      sendJson(res, result);
    } catch (error) {
      send(res, 400, JSON.stringify({ success: false, error: error.message }));
    }
    return true;
  }

  // ─── 微信公众号草稿 - 批量队列 ──────────────────────
  if (pathname === "/api/wechat-draft/batch/create" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 256_000) || "{}");
    const posts = Array.isArray(body.posts) ? body.posts : [];
    if (!posts.length) {
      send(res, 400, JSON.stringify({ error: "帖子列表不能为空" }));
      return true;
    }
    const batchId = wechatDraft.createBatchQueue(posts);
    sendJson(res, { batchId, count: posts.length });
    return true;
  }

  if (pathname === "/api/wechat-draft/batch/status" && req.method === "GET") {
    const queue = wechatDraft.getBatchQueue();
    const summary = {
      batchId: queue.batchId,
      status: queue.status,
      total: queue.items.length,
      pending: queue.items.filter((it) => it.status === "pending").length,
      success: queue.items.filter((it) => it.status === "success").length,
      failed: queue.items.filter((it) => it.status === "failed").length,
      skipped: queue.items.filter((it) => it.status === "skipped").length,
      processing: queue.items.filter((it) => it.status === "processing").length,
      items: queue.items
    };
    sendJson(res, summary);
    return true;
  }

  if (pathname === "/api/wechat-draft/batch/claim-next" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    const queue = wechatDraft.recoverInterruptedBatchQueue();
    if (!queue.batchId || (body.batchId && body.batchId !== queue.batchId)) {
      send(res, 409, JSON.stringify({ error: "批量队列不存在或已被新的队列替换" }));
      return true;
    }
    if (queue.status === "cancelled") {
      sendJson(res, { done: true, cancelled: true, message: "批量任务已取消" });
      return true;
    }
    const nextItem = queue.items.find((item) => item.status === "pending");
    if (!nextItem) {
      const processing = queue.items.some((item) => item.status === "processing");
      if (!processing) wechatDraft.updateBatchStatus(queue.batchId, "completed");
      sendJson(res, { done: !processing, busy: processing, message: processing ? "已有帖子正在处理" : "所有帖子已处理完毕" });
      return true;
    }
    wechatDraft.markBatchItemProcessing(queue.batchId, nextItem.id);
    wechatDraft.updateBatchStatus(queue.batchId, "running");
    sendJson(res, { done: false, item: wechatDraft.getBatchQueue().items.find((item) => item.id === nextItem.id) });
    return true;
  }

  if (pathname === "/api/wechat-draft/batch/update" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    const queue = wechatDraft.getBatchQueue();
    const allowedStatuses = new Set(["pending", "success", "failed", "skipped"]);
    if (!queue.batchId || body.batchId !== queue.batchId) {
      send(res, 409, JSON.stringify({ error: "批量队列不存在或已被新的队列替换" }));
      return true;
    }
    if (!allowedStatuses.has(body.status)) {
      send(res, 400, JSON.stringify({ error: "无效的批量任务状态" }));
      return true;
    }
    const item = queue.items.find((candidate) => candidate.id === Number(body.itemId));
    if (!item) {
      send(res, 404, JSON.stringify({ error: "批量任务项不存在" }));
      return true;
    }
    wechatDraft.updateBatchItem(queue.batchId, item.id, {
      status: body.status,
      draftMediaId: String(body.draftMediaId || "") || null,
      error: String(body.error || "") || null,
      processedAt: body.status === "pending" ? null : new Date().toISOString(),
      workerId: null,
      startedAt: null
    });
    const updated = wechatDraft.getBatchQueue();
    if (!updated.items.some((candidate) => ["pending", "processing"].includes(candidate.status))) {
      wechatDraft.updateBatchStatus(updated.batchId, "completed");
    }
    sendJson(res, { ok: true, item: wechatDraft.getBatchQueue().items.find((candidate) => candidate.id === item.id) });
    return true;
  }

  if (pathname === "/api/wechat-draft/batch/process-next" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    const queue = wechatDraft.recoverInterruptedBatchQueue();
    if (!queue.batchId) {
      sendJson(res, { done: true, message: "没有活跃的批量队列" });
      return true;
    }
    if (queue.status === "cancelled") {
      sendJson(res, { done: true, cancelled: true, message: "批量任务已取消" });
      return true;
    }
    const nextItem = queue.items.find((it) => it.status === "pending");
    if (!nextItem) {
      wechatDraft.updateBatchStatus(queue.batchId, "completed");
      sendJson(res, { done: true, message: "所有帖子已处理完毕" });
      return true;
    }

    // 标记为处理中
    wechatDraft.markBatchItemProcessing(queue.batchId, nextItem.id);
    if (queue.status !== "running") {
      wechatDraft.updateBatchStatus(queue.batchId, "running");
    }

    // 获取账号配置
    const settings = wechatDraft.getWechatSettings();
    const accountKey = body.account || settings.defaultAccount || "main";
    const account = settings.accounts?.[accountKey];
    const dryRun = body.dryRun !== false;

    if (!dryRun && (!account || !account.appId)) {
      wechatDraft.updateBatchItem(queue.batchId, nextItem.id, {
        status: "failed",
        error: `账号 ${accountKey} 未配置 AppID`,
        processedAt: new Date().toISOString()
      });
      sendJson(res, { done: false, item: nextItem, error: `账号 ${accountKey} 未配置 AppID` });
      return true;
    }

    // 读取 AppSecret
    let appSecret = "";
    if (!dryRun && account) {
      const envVar = account.appSecretEnv || `WECHAT_${accountKey.toUpperCase()}_APP_SECRET`;
      appSecret = process.env[envVar] || "";
      if (!appSecret) {
        wechatDraft.updateBatchItem(queue.batchId, nextItem.id, {
          status: "failed",
          error: `环境变量 ${envVar} 未设置`,
          processedAt: new Date().toISOString()
        });
        sendJson(res, { done: false, item: nextItem, error: `环境变量 ${envVar} 未设置` });
        return true;
      }
    }

    try {
      const result = await wechatDraft.createDraftTask({
        postPath: nextItem.postPath,
        title: nextItem.title,
        body: nextItem.body,
        account: accountKey,
        dryRun,
        forceCreate: body.forceCreate === true,
        appId: account?.appId,
        appSecret
      });

      if (result.success) {
        wechatDraft.updateBatchItem(queue.batchId, nextItem.id, {
          status: "success",
          draftMediaId: result.draftMediaId,
          processedAt: new Date().toISOString()
        });
      } else if (result.duplicate) {
        wechatDraft.updateBatchItem(queue.batchId, nextItem.id, {
          status: "skipped",
          error: result.message || "重复帖子已跳过",
          processedAt: new Date().toISOString()
        });
      } else {
        wechatDraft.updateBatchItem(queue.batchId, nextItem.id, {
          status: "failed",
          error: result.error || "未知错误",
          processedAt: new Date().toISOString()
        });
      }

      const updatedQueue = wechatDraft.getBatchQueue();
      const remaining = updatedQueue.items.filter((it) => it.status === "pending").length;
      sendJson(res, {
        done: remaining === 0,
        item: updatedQueue.items.find((it) => it.id === nextItem.id),
        remaining,
        result
      });
    } catch (error) {
      wechatDraft.updateBatchItem(queue.batchId, nextItem.id, {
        status: "failed",
        error: error.message,
        processedAt: new Date().toISOString()
      });
      sendJson(res, { done: false, item: nextItem, error: error.message });
    }
    return true;
  }

  if (pathname === "/api/wechat-draft/batch/cancel" && req.method === "POST") {
    const queue = wechatDraft.getBatchQueue();
    if (queue.batchId) {
      wechatDraft.updateBatchStatus(queue.batchId, "cancelled");
    }
    sendJson(res, { ok: true });
    return true;
  }

  if (pathname === "/api/wechat-draft/batch/clear" && req.method === "POST") {
    wechatDraft.clearBatchQueue();
    sendJson(res, { ok: true });
    return true;
  }

  return false;
}

module.exports = { handle };
