"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { publicTransferTask } = require("../../lib/transfer-progress");
const {
  confirmOfficialUpload,
  markOfficialUsed,
  renameCollectionType,
  reconcileWorkflowFolders,
  getWorkflowStageRoots,
  inspectSource
} = require("../../lib/distribution-data");

/**
 * 分发与传送路由
 * 匹配 /api/collections/*, /api/pick-*, /api/transfers/*, /api/distribution/*, /api/devices/*
 * @returns {Promise<boolean>} true 表示已匹配并处理
 */
async function handle(req, res, pathname, parsed, ctx) {
  const {
    send, sendJson, getBody, isAllowedFile, getWorkspaceSettings, PUBLISH_ROOT,
    genericTransferTasks, distributionTasks,
    updateCollectionLedger, collectionLedgerCsv, pickFolderWithWindowsDialog,
    pickFileWithWindowsDialog, recentPublicTasks, startGenericTransfer,
    cancelGenericTransfer, startDistributionTask, cancelDistributionTask,
    runDistributionAction, buildDistributionArgs, exists, updateDeviceNote, approveDistributionDevice,
    getDeviceStatus, parseOnlineDeviceStatus, registeredDevices,
    maybeStartAutomaticDistribution, recentAutomationLogs, updateWorkTags,
    assertDiscoveredDeviceTarget, resolveDeviceTransportTarget
  } = ctx;

  if (pathname === "/api/collections/ledger" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    sendJson(res, { ok: true, record: updateCollectionLedger(body) });
    return true;
  }

  if (pathname === "/api/works/tags" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    try { sendJson(res, { ok: true, record: updateWorkTags(body) }); }
    catch (error) { send(res, 400, JSON.stringify({ error: error.message })); }
    return true;
  }

  if (pathname === "/api/collections/export" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="collection-ledger.csv"',
      "Cache-Control": "no-store"
    });
    res.end(collectionLedgerCsv());
    return true;
  }

  if (pathname === "/api/pick-folder" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 8_000) || "{}");
    const selectedPath = await pickFolderWithWindowsDialog(body.description || "选择文件夹");
    sendJson(res, { ok: true, path: selectedPath });
    return true;
  }
  if (pathname === "/api/pick-file" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 8_000) || "{}");
    const selectedPath = await pickFileWithWindowsDialog(body.title || "选择要传送的文件");
    sendJson(res, { ok: true, path: selectedPath });
    return true;
  }
  if (pathname === "/api/transfers" && req.method === "GET") {
    sendJson(res, recentPublicTasks(genericTransferTasks));
    return true;
  }
  if (pathname === "/api/transfers" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 16_000) || "{}");
    if (body.confirmed !== true) { send(res, 409, JSON.stringify({ error: "需要确认本次文件传送" })); return true; }
    sendJson(res, startGenericTransfer(body.source, body.device, {
      approveDevice: body.approveDevice === true,
      deviceModel: String(body.deviceModel || ""),
      deviceLabel: String(body.deviceLabel || "")
    }));
    return true;
  }
  if (pathname.startsWith("/api/transfers/") && req.method === "DELETE") {
    const taskId = decodeURIComponent(pathname.slice("/api/transfers/".length));
    const record = genericTransferTasks.get(taskId);
    if (!record) { sendJson(res, { ok: true, removed: false }); return true; }
    if (["running", "cancelling"].includes(record.state)) {
      send(res, 409, JSON.stringify({ error: "进行中的任务不能清除，请先停止" }));
      return true;
    }
    genericTransferTasks.delete(taskId);
    sendJson(res, { ok: true, removed: true });
    return true;
  }
  if (pathname.startsWith("/api/transfers/") && req.method === "GET") {
    const taskId = decodeURIComponent(pathname.slice("/api/transfers/".length));
    const record = genericTransferTasks.get(taskId);
    if (!record) { send(res, 404, JSON.stringify({ error: "传送任务不存在" })); return true; }
    sendJson(res, publicTransferTask(record));
    return true;
  }
  if (pathname.startsWith("/api/transfers/") && pathname.endsWith("/cancel") && req.method === "POST") {
    const taskId = decodeURIComponent(
      pathname.slice("/api/transfers/".length, -"/cancel".length)
    );
    sendJson(res, cancelGenericTransfer(taskId));
    return true;
  }
  if (pathname === "/api/distribution/tasks" && req.method === "GET") {
    sendJson(res, recentPublicTasks(distributionTasks));
    return true;
  }
  if (pathname === "/api/distribution/tasks" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    if (body.confirmed !== true) {
      send(res, 409, JSON.stringify({ error: "需要在界面确认本次真实分发" }));
      return true;
    }
    try {
      sendJson(res, startDistributionTask(body));
    } catch (error) {
      const status = ["DUPLICATE_DISTRIBUTION_BLOCKED", "DUPLICATE_DISTRIBUTION_IN_FLIGHT"].includes(error.code)
        ? 409
        : 400;
      send(res, status, JSON.stringify({ error: error.message, code: error.code || "DISTRIBUTION_START_FAILED" }));
    }
    return true;
  }
  if (pathname.startsWith("/api/distribution/tasks/") && req.method === "DELETE") {
    const taskId = decodeURIComponent(pathname.slice("/api/distribution/tasks/".length));
    const record = distributionTasks.get(taskId);
    if (!record) { sendJson(res, { ok: true, removed: false }); return true; }
    if (["running", "cancelling"].includes(record.state)) {
      send(res, 409, JSON.stringify({ error: "进行中的任务不能清除，请先停止" }));
      return true;
    }
    distributionTasks.delete(taskId);
    sendJson(res, { ok: true, removed: true });
    return true;
  }
  if (pathname.startsWith("/api/distribution/tasks/") && pathname.endsWith("/cancel") && req.method === "POST") {
    const taskId = decodeURIComponent(
      pathname.slice("/api/distribution/tasks/".length, -"/cancel".length)
    );
    sendJson(res, cancelDistributionTask(taskId));
    return true;
  }
  if (pathname.startsWith("/api/distribution/tasks/") && req.method === "GET") {
    const taskId = decodeURIComponent(pathname.slice("/api/distribution/tasks/".length));
    const record = distributionTasks.get(taskId);
    if (!record) { send(res, 404, JSON.stringify({ error: "分发任务不存在" })); return true; }
    sendJson(res, publicTransferTask(record));
    return true;
  }
  if (pathname === "/api/distribution/action" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    if (body.confirmed !== true) { send(res, 409, JSON.stringify({ error: "需要在界面确认本次真实分发" })); return true; }
    if (body.action === "device-restock") {
      // The retired restock script chooses an asset internally and therefore
      // cannot participate in the work-level claim/receipt ledger. Do not
      // leave a legacy bypass that could send one work to a second account.
      if (!String(body.collection || "").trim()) {
        send(res, 409, JSON.stringify({
          error: "旧的按分类自动挑选补货入口已停用；请先选定作品集，再从统一分发任务入口发送",
          code: "DISTRIBUTION_COLLECTION_REQUIRED"
        }));
        return true;
      }
      try {
        sendJson(res, startDistributionTask({ ...body, confirmed: true }));
      } catch (error) {
        const status = ["DUPLICATE_DISTRIBUTION_BLOCKED", "DUPLICATE_DISTRIBUTION_IN_FLIGHT"].includes(error.code)
          ? 409
          : 400;
        send(res, status, JSON.stringify({ error: error.message, code: error.code || "DISTRIBUTION_START_FAILED" }));
      }
      return true;
    }
    const normalizedBody = { ...body };
    const result = await runDistributionAction(buildDistributionArgs(normalizedBody));
    if (body.action === "official-reserve") {
      const sourceMatch = String(result.output || "").match(/^原合集地址：(.+)$/m);
      const sourcePath = sourceMatch?.[1]?.trim();
      if (sourcePath && isAllowedFile(sourcePath) && exists(sourcePath)) {
        childProcess.spawn("explorer.exe", [sourcePath], {
          detached: true,
          windowsHide: true,
          stdio: "ignore"
        }).unref();
      }
    }
    sendJson(res, result);
    return true;
  }
  if (pathname === "/api/devices/note" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 8_000) || "{}");
    sendJson(res, updateDeviceNote(body));
    return true;
  }
  if (pathname === "/api/devices/approve" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 8_000) || "{}");
    if (body.confirmed !== true) {
      send(res, 409, JSON.stringify({ error: "首次自动分发前需要确认设备" }));
      return true;
    }
    sendJson(res, approveDistributionDevice(body));
    return true;
  }
  if (pathname === "/api/distribution/check" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 8_000) || "{}");
    const includeInventory = body.inventory === true;
    // The dashboard snapshot already reads the current workflow stages
    // (`抖音小红书` / `微信公众号` / `已发送`).  Do not invoke the retired
    // Junction-based `restock_device.py --check` scanner here: after the
    // stage migration its missing `发布空间/小红书` directory could turn an
    // otherwise valid device refresh into HTTP 500 and stop auto-distribution.
    const [inventory, deviceStatus] = await Promise.all([
      Promise.resolve({ ok: true, output: "" }),
      getDeviceStatus(body.force === true)
    ]);
    const onlineDevices = deviceStatus.onlineDevices || parseOnlineDeviceStatus(deviceStatus.output);
    const registryDevices = registeredDevices();
    const automationTriggered = maybeStartAutomaticDistribution(onlineDevices);
    sendJson(res, {
      ok: true,
      output: inventory.output,
      statusOutput: deviceStatus.output,
      registered: registryDevices.length,
      online: onlineDevices.filter((device) => device.current !== false).length,
      onlineDevices,
      registeredDevices: registryDevices,
      automationTriggered,
      automationHistory: recentAutomationLogs(),
      inventoryScanned: includeInventory
    });
    return true;
  }
  if (pathname === "/api/distribution/confirm-official" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    if (body.confirmed !== true) { send(res, 409, JSON.stringify({ error: "需要确认电脑上传已经完成" })); return true; }
    sendJson(res, confirmOfficialUpload({
      publishRoot: PUBLISH_ROOT,
      collection: body.collection
    }));
    return true;
  }
  if (pathname === "/api/distribution/mark-used" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    if (body.confirmed !== true) { send(res, 409, JSON.stringify({ error: "需要确认作品已经使用" })); return true; }
    sendJson(res, markOfficialUsed({
      publishRoot: PUBLISH_ROOT,
      libraryRoot: getWorkspaceSettings().workPackage.libraryPath,
      collection: body.collection
    }));
    return true;
  }
  if (pathname === "/api/distribution/classify" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    if (body.confirmed !== true) { send(res, 409, JSON.stringify({ error: "需要确认同步修改真实文件夹名称" })); return true; }
    try {
      sendJson(res, renameCollectionType({
        publishRoot: PUBLISH_ROOT,
        libraryRoot: getWorkspaceSettings().workPackage.libraryPath,
        collection: body.collection,
        type: body.type
      }));
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message }));
    }
    return true;
  }
  if (pathname === "/api/distribution/reconcile-folders" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    if (body.confirmed !== true) { send(res, 409, JSON.stringify({ error: "需要确认按历史记录整理真实文件夹" })); return true; }
    sendJson(res, reconcileWorkflowFolders({
      publishRoot: PUBLISH_ROOT,
      libraryRoot: getWorkspaceSettings().workPackage.libraryPath,
      apply: true
    }));
    return true;
  }
  if (pathname === "/api/distribution/rename-collection" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    if (!body.collection || !body.newName) { send(res, 400, JSON.stringify({ error: "需要提供 collection 和 newName" })); return true; }
    const ws = getWorkspaceSettings();
    const libraryRoot = ws.workPackage.libraryPath;
    const stageRoots = getWorkflowStageRoots(libraryRoot);
    const oldPath = path.join(stageRoots.workflowRoot, body.collection);
    const newPath = path.join(stageRoots.workflowRoot, body.newName);
    if (!exists(oldPath)) { send(res, 404, JSON.stringify({ error: `作品集 ${body.collection} 不存在` })); return true; }
    if (exists(newPath)) { send(res, 409, JSON.stringify({ error: `名称 ${body.newName} 已被占用` })); return true; }
    try {
      fs.renameSync(oldPath, newPath);
      sendJson(res, { ok: true, oldName: body.collection, newName: body.newName });
    } catch (error) {
      send(res, 500, JSON.stringify({ error: error.message }));
    }
    return true;
  }
  if (pathname === "/api/distribution/delete-collection" && req.method === "POST") {
    const body = JSON.parse(await getBody(req, 64_000) || "{}");
    if (!body.collection) { send(res, 400, JSON.stringify({ error: "需要提供 collection 名称" })); return true; }
    if (body.confirmed !== true) { send(res, 409, JSON.stringify({ error: "需要确认删除操作" })); return true; }
    const ws = getWorkspaceSettings();
    const libraryRoot = ws.workPackage.libraryPath;
    const stageRoots = getWorkflowStageRoots(libraryRoot);
    const targetPath = path.join(stageRoots.workflowRoot, body.collection);
    if (!exists(targetPath)) { send(res, 404, JSON.stringify({ error: `作品集 ${body.collection} 不存在` })); return true; }
    try {
      const inspected = inspectSource(targetPath, new Map());
      if (inspected.imageCount > 0) { send(res, 409, JSON.stringify({ error: "只能删除空作品集，该作品集包含图片" })); return true; }
      fs.rmSync(targetPath, { recursive: true, force: true });
      sendJson(res, { ok: true, deleted: body.collection });
    } catch (error) {
      send(res, 500, JSON.stringify({ error: error.message }));
    }
    return true;
  }

  return false;
}

module.exports = { handle };
