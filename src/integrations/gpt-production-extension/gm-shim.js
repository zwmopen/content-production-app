(() => {
  const prefix = "tb-extension-gm:";
  const menuCommands = new Map();
  const downloadCallbacks = new Map();
  let nextMenuId = 1;

  function storageKey(key) {
    return `${prefix}${key}`;
  }

  function read(key, fallback) {
    const raw = localStorage.getItem(storageKey(key));
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  globalThis.unsafeWindow = window;
  globalThis.GM_getValue = read;
  globalThis.GM_setValue = (key, value) => {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
  };
  globalThis.GM_deleteValue = (key) => localStorage.removeItem(storageKey(key));
  globalThis.GM_listValues = () => Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
  globalThis.GM_registerMenuCommand = (label, handler) => {
    const id = nextMenuId++;
    menuCommands.set(id, { label, handler });
    return id;
  };
  globalThis.GM_unregisterMenuCommand = (id) => menuCommands.delete(id);
  globalThis.GM_download = (options) => {
    const normalized = typeof options === "string" ? { url: options } : options;
    const requestId = `tb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    downloadCallbacks.set(requestId, normalized);
    chrome.runtime.sendMessage({
      type: "tb-download",
      baseUrl: /^http:\/\/127\.0\.0\.1:\d+$/.test(localStorage.getItem("tb-workbench-api-root") || "")
        ? localStorage.getItem("tb-workbench-api-root")
        : undefined,
      requestId,
      url: normalized.url,
      filename: normalized.name
    }).then((result) => {
      if (!result?.ok) {
        downloadCallbacks.delete(requestId);
        normalized.onerror?.(result?.error || "download failed");
      }
    }).catch((error) => {
      downloadCallbacks.delete(requestId);
      normalized.onerror?.(error);
    });
    return {
      abort: () => (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage)
        ? chrome.runtime.sendMessage({ type: "tb-download-cancel", requestId }).catch(() => {})
        : null
    };
  };
  if (typeof chrome !== "undefined" && chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "tb-download-status") return;
    const callbacks = downloadCallbacks.get(message.requestId);
    if (!callbacks) return;
    if (message.status === "progress") {
      callbacks.onprogress?.({
        loaded: Number(message.loaded || 0),
        total: Number(message.total || 0),
        lengthComputable: Number(message.total || 0) > 0
      });
      return;
    }
      downloadCallbacks.delete(message.requestId);
      if (message.status === "complete") callbacks.onload?.({ finalUrl: message.filename || "" });
      else callbacks.onerror?.(message.error || "download failed");
    });
  }
  globalThis.GM_xmlhttpRequest = (options) => {
    const controller = new AbortController();
    fetch(options.url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.data,
      signal: controller.signal
    }).then(async (response) => {
      const responseText = await response.text();
      options.onload?.({
        status: response.status,
        responseText,
        response: responseText,
        finalUrl: response.url
      });
    }).catch((error) => options.onerror?.(error));
    return { abort: () => controller.abort() };
  };
})();
