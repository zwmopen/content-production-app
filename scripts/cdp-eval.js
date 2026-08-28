const http = require("node:http");

const debugPort = Number(process.argv[2] || 9431);
const expression = process.argv.slice(3).join(" ") || "document.title";
const reloadOnly = expression === "--reload" || expression === "--reload-ignore-cache";
const reloadIgnoreCache = expression === "--reload-ignore-cache";

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

async function evaluate(targetUrl, source) {
  const socket = new WebSocket(targetUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression: source, returnByValue: true, awaitPromise: true }
  }));
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP evaluate timeout")), 10000);
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data || "{}"));
      if (payload.id !== 1) return;
      clearTimeout(timer);
      resolve(payload);
    });
  });
  socket.close();
  if (result?.error) throw new Error(JSON.stringify(result.error));
  return result?.result?.result?.value;
}

async function sendCommand(targetUrl, method, params = {}) {
  const socket = new WebSocket(targetUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.send(JSON.stringify({ id: 1, method, params }));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 10000);
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data || "{}"));
      if (payload.id !== 1) return;
      clearTimeout(timer);
      if (payload.error) reject(new Error(JSON.stringify(payload.error)));
      else resolve(payload);
    });
  });
  socket.close();
}

(async () => {
  const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find((item) => item.type === "page"
    && /127\.0\.0\.1:43(?:31|32)\//.test(item.url)
    && !String(item.url).includes("assistant-overlay.html"));
  if (!target) throw new Error(`No content renderer on debug port ${debugPort}`);
  if (reloadOnly) {
    await sendCommand(target.webSocketDebuggerUrl, "Page.reload", { ignoreCache: reloadIgnoreCache });
    process.stdout.write(`${JSON.stringify({ reloaded: true, ignoreCache: reloadIgnoreCache })}\n`);
    return;
  }
  const result = await evaluate(target.webSocketDebuggerUrl, expression);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
