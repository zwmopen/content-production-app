const http = require("node:http");

const debugPort = Number(process.argv[2] || 9431);

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

async function evaluate(webSocketDebuggerUrl, expression) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const id = 1;
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP evaluate timeout")), 8000);
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data || "{}"));
      if (payload.id !== id) return;
      clearTimeout(timer);
      resolve(payload);
    });
  });
  socket.close();
  return result?.result?.result?.value;
}

(async () => {
  const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
  const contentTarget = targets.find((item) => item.type === "page" && /^http:\/\/127\.0\.0\.1:43(?:31|32|33)\/(?:\?|$)/.test(item.url));
  const chatTarget = targets.find((item) => item.type === "page" && /chatgpt\.com/.test(item.url));
  const target = (debugPort === 9431 || debugPort === 9433) ? chatTarget : contentTarget;
  if (!target) throw new Error(`No content renderer on debug port ${debugPort}`);
  const result = await evaluate(target.webSocketDebuggerUrl, `(() => ({
    title: document.title,
    readyState: document.readyState,
    bodyText: String(document.body?.innerText || '').slice(0, 5000),
    bodyTextTail: String(document.body?.innerText || '').slice(-5000),
    images: Array.from(document.images || []).map((img) => ({ src: img.currentSrc || img.src || '', alt: img.alt || '', width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0 })).slice(-30),
    accounts: typeof gptBrowserProfiles !== 'undefined' ? gptBrowserProfiles.map((item) => ({ id: item.id, name: item.name, mode: item.mode, workflowVariant: item.workflowVariant })) : [],
    activeAccountId: typeof activeGptBrowserId !== 'undefined' ? activeGptBrowserId : '',
    queue: typeof gptProductionQueue !== 'undefined' ? { running: Boolean(gptProductionQueue.running), paused: Boolean(gptProductionQueue.paused), tasks: gptProductionQueue.tasks?.length || 0 } : null
  }))()`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
