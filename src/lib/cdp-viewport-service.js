const http = require("http");

let cachedPort = null;
let lastPortProbeAt = 0;

class CdpSession {
  constructor() {
    this.ws = null;
    this.target = null;
    this.reqId = 1000;
    this.pending = new Map();
    this.lastFrame = null;
    this.lastFrameAt = 0;
    this.connecting = null;
  }

  async getTarget(port) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      const tabs = await res.json();
      if (!Array.isArray(tabs)) return null;

      let target = tabs.find(t => t.url && /chatgpt\.com|chat\.openai\.com/i.test(t.url));
      if (!target) {
        target = tabs.find(t => t.type === "page" && !t.url.includes("assistant-overlay"));
      }
      return target || null;
    } catch (_) {
      return null;
    }
  }

  async ensureConnection(port) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return true;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = (async () => {
      try {
        const target = await this.getTarget(port);
        if (!target || !target.webSocketDebuggerUrl) {
          return false;
        }
        this.target = target;

        if (this.ws) {
          try { this.ws.close(); } catch (_) {}
          this.ws = null;
        }

        const ws = new WebSocket(target.webSocketDebuggerUrl);

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.id && this.pending.has(msg.id)) {
              const { resolve, reject, timer } = this.pending.get(msg.id);
              clearTimeout(timer);
              this.pending.delete(msg.id);
              if (msg.error) reject(new Error(msg.error.message || "CDP Error"));
              else resolve(msg.result || {});
            }
          } catch (_) {}
        };

        ws.onerror = () => {
          this.cleanup();
        };

        ws.onclose = () => {
          this.cleanup();
        };

        await new Promise((resolve, reject) => {
          const openTimer = setTimeout(() => {
            try { ws.close(); } catch (_) {}
            reject(new Error("WS open timeout"));
          }, 3000);

          ws.onopen = () => {
            clearTimeout(openTimer);
            this.ws = ws;
            resolve();
          };
        });

        // Initialize Page domain
        await this.send("Page.enable").catch(() => {});
        return true;
      } catch (_) {
        this.cleanup();
        return false;
      } finally {
        this.connecting = null;
      }
    })();

    return this.connecting;
  }

  cleanup() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("CDP connection closed"));
    }
    this.pending.clear();
  }

  send(method, params = {}, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("CDP WebSocket is not open"));
      }

      const id = ++this.reqId;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP command timeout: ${method}`));
        }
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async captureFrame(port) {
    const now = Date.now();
    if (this.lastFrame && (now - this.lastFrameAt < 250)) {
      return this.lastFrame;
    }

    const connected = await this.ensureConnection(port);
    if (!connected) {
      if (this.lastFrame) return this.lastFrame;
      throw new Error("CDP ChatGPT target not connected");
    }

    try {
      const res = await this.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 55,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 1280, height: 800, scale: 1 }
      }, 5000);

      if (res && res.data) {
        const buf = Buffer.from(res.data, "base64");
        this.lastFrame = buf;
        this.lastFrameAt = Date.now();
        return buf;
      }
    } catch (err) {
      if (this.lastFrame) return this.lastFrame;
      throw err;
    }

    if (this.lastFrame) return this.lastFrame;
    throw new Error("No frame data returned");
  }

  async dispatchClick(port, x, y, button = "left") {
    const connected = await this.ensureConnection(port);
    if (!connected) throw new Error("Not connected");

    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: Math.round(x),
      y: Math.round(y),
      button,
      clickCount: 1
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: Math.round(x),
      y: Math.round(y),
      button,
      clickCount: 1
    });
    return { ok: true };
  }

  async dispatchWheel(port, x, y, deltaX = 0, deltaY = 0) {
    const connected = await this.ensureConnection(port);
    if (!connected) throw new Error("Not connected");

    await this.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Math.round(x),
      y: Math.round(y),
      deltaX: Math.round(deltaX),
      deltaY: Math.round(deltaY)
    });
    return { ok: true };
  }

  async insertText(port, text) {
    const connected = await this.ensureConnection(port);
    if (!connected) throw new Error("Not connected");

    await this.send("Input.insertText", { text: String(text || "") });
    return { ok: true };
  }

  async reload(port) {
    const connected = await this.ensureConnection(port);
    if (!connected) throw new Error("Not connected");
    await this.send("Page.reload", {});
    return { ok: true };
  }

  async navigate(port, url) {
    const connected = await this.ensureConnection(port);
    if (!connected) throw new Error("Not connected");
    await this.send("Page.navigate", { url });
    return { ok: true };
  }

  async evaluate(port, expression) {
    const connected = await this.ensureConnection(port);
    if (!connected) throw new Error("Not connected");
    return this.send("Runtime.evaluate", { expression, returnByValue: true });
  }
}

const cdpSession = new CdpSession();

async function probeCdpPort() {
  const now = Date.now();
  if (cachedPort && (now - lastPortProbeAt < 60000)) {
    return cachedPort;
  }

  const portsToTry = [
    Number(process.env.TB_REMOTE_DEBUGGING_PORT),
    9432,
    9333,
    9334
  ].filter(p => Number.isInteger(p) && p > 0);

  for (const port of portsToTry) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1800) });
      if (res.ok) {
        cachedPort = port;
        lastPortProbeAt = now;
        return port;
      }
    } catch (_) {}
  }

  return cachedPort || 9432;
}

const streamClients = new Set();
let streamInterval = null;

function ensureStreamPump(port) {
  if (streamInterval) return;
  streamInterval = setInterval(async () => {
    if (streamClients.size === 0) {
      clearInterval(streamInterval);
      streamInterval = null;
      return;
    }
    try {
      const buf = await cdpSession.captureFrame(port);
      const header = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
      const footer = Buffer.from("\r\n");
      for (const client of streamClients) {
        try {
          client.write(header);
          client.write(buf);
          client.write(footer);
        } catch (_) {
          streamClients.delete(client);
        }
      }
    } catch (_) {}
  }, 800); // ~1.2 fps continuous stream, very gentle on CPU
}

async function handleRoute(req, res, pathname, parsed) {
  // CORS for all responses
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const port = await probeCdpPort();

  if (pathname === "/api/cdp/status" && req.method === "GET") {
    const target = await cdpSession.getTarget(port);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
      ok: true,
      online: Boolean(target),
      port,
      instance: process.env.CONTENT_INSTANCE_ID || "B",
      target: target ? {
        id: target.id,
        title: target.title,
        url: target.url,
        ready: true
      } : null
    }));
  }

  if (pathname === "/api/cdp/frame" && req.method === "GET") {
    try {
      const buf = await cdpSession.captureFrame(port);
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Content-Length": buf.length
      });
      return res.end(buf);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (pathname === "/api/cdp/stream" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=--frame",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "Pragma": "no-cache"
    });

    streamClients.add(res);
    ensureStreamPump(port);

    // Send immediate first frame if available
    if (cdpSession.lastFrame) {
      const buf = cdpSession.lastFrame;
      res.write(Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`));
      res.write(buf);
      res.write(Buffer.from("\r\n"));
    }

    req.on("close", () => {
      streamClients.delete(res);
    });
    return;
  }

  if (pathname === "/api/cdp/input" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const { type, x = 0, y = 0, deltaX = 0, deltaY = 0, text = "" } = payload;

        if (type === "click") {
          await cdpSession.dispatchClick(port, x, y);
        } else if (type === "wheel") {
          await cdpSession.dispatchWheel(port, x, y, deltaX, deltaY);
        } else if (type === "type") {
          await cdpSession.insertText(port, text);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === "/api/cdp/action" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const { action } = payload;

        if (action === "reload") {
          await cdpSession.reload(port);
        } else if (action === "home") {
          await cdpSession.navigate(port, "https://chatgpt.com/");
        } else if (action === "back") {
          await cdpSession.evaluate(port, "history.back()");
        } else if (action === "forward") {
          await cdpSession.evaluate(port, "history.forward()");
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, action }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unknown CDP endpoint" }));
}

module.exports = {
  probeCdpPort,
  cdpSession,
  handleRoute
};
