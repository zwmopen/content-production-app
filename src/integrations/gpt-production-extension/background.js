chrome.action?.onClicked?.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: "tb-sidebar-toggle" }).catch(() => {});
});

const pendingByDownloadId = new Map();
const downloadIdByRequestId = new Map();
const LOCAL_ROOT = "http://127.0.0.1:4327";

function allowedLocalRoot(value) {
  const candidate = String(value || "").trim();
  return /^http:\/\/127\.0\.0\.1:\d+$/.test(candidate) ? candidate : LOCAL_ROOT;
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function localRequest(message) {
  const localRoot = allowedLocalRoot(message.baseUrl);
  const target = new URL(message.path, localRoot);
  if (target.origin !== localRoot) throw new Error("local request target rejected");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(message.timeoutMs || 60_000)));
  try {
    const response = await fetch(target.href, {
      method: message.method || "GET",
      headers: message.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: message.body === undefined ? undefined : JSON.stringify(message.body),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `local request failed: ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (message.responseType === "base64") {
      return { ok: true, contentType, data: bytesToBase64(await response.arrayBuffer()) };
    }
    if (message.responseType === "text") {
      return { ok: true, contentType, data: await response.text() };
    }
    return { ok: true, contentType, data: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

async function notifyDownload(task, payload) {
  if (!task?.tabId) return;
  await chrome.tabs.sendMessage(task.tabId, {
    type: "tb-download-status",
    requestId: task.requestId,
    ...payload
  }).catch(() => {});
}

async function recordCompletedDownload(item, task) {
  if (!item?.filename) return;
  await fetch(`${allowedLocalRoot(task?.baseUrl)}/api/extension/download-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      downloadId: item.id,
      requestId: task.requestId,
      filename: item.filename,
      url: item.url,
      finalUrl: item.finalUrl,
      totalBytes: item.totalBytes,
      conversationUrl: task.pageUrl,
      completedAt: new Date().toISOString()
    })
  }).catch(() => {});
}

chrome.downloads?.onChanged?.addListener(async (delta) => {
  const task = pendingByDownloadId.get(delta.id);
  if (!task) return;
  if (delta.bytesReceived) {
    const [item] = await chrome.downloads.search({ id: delta.id });
    await notifyDownload(task, {
      status: "progress",
      loaded: item?.bytesReceived || delta.bytesReceived.current || 0,
      total: item?.totalBytes || 0
    });
  }
  if (delta.state?.current === "complete") {
    const [item] = await chrome.downloads.search({ id: delta.id });
    await recordCompletedDownload(item, task);
    await notifyDownload(task, {
      status: "complete",
      filename: item?.filename || task.filename || ""
    });
    pendingByDownloadId.delete(delta.id);
    downloadIdByRequestId.delete(task.requestId);
  }
  if (delta.state?.current === "interrupted") {
    await notifyDownload(task, {
      status: "error",
      error: delta.error?.current || "download interrupted"
    });
    pendingByDownloadId.delete(delta.id);
    downloadIdByRequestId.delete(task.requestId);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "tb-work-package") {
    localRequest({
      path: "/api/extension/work-package",
      method: "POST",
      body: message.body || {},
      baseUrl: message.baseUrl
    }).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  if (message?.type === "tb-local-request") {
    localRequest(message).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  if (message?.type === "tb-download-cancel") {
    if (!chrome.downloads?.cancel) {
      sendResponse({ ok: false, error: "当前内置浏览器不提供下载管理接口" });
      return false;
    }
    const id = downloadIdByRequestId.get(message.requestId);
    if (!id) {
      sendResponse({ ok: false, error: "download not found" });
      return false;
    }
    chrome.downloads.cancel(id).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  if (message?.type === "tb-download") {
    if (!chrome.downloads?.download) {
      sendResponse({ ok: false, error: "当前内置浏览器不提供下载管理接口" });
      return false;
    }
    chrome.downloads.download({
      url: message.url,
      filename: message.filename || undefined,
      saveAs: false
    }).then(
      (id) => {
        const task = {
          requestId: message.requestId,
          filename: message.filename || "",
          tabId: _sender.tab?.id,
          pageUrl: _sender.tab?.url || "",
          baseUrl: message.baseUrl
        };
        pendingByDownloadId.set(id, task);
        downloadIdByRequestId.set(task.requestId, id);
        sendResponse({ ok: true, id, status: "started" });
      },
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  return false;
});
