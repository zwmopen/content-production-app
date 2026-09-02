import http from "node:http";

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: 9433, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    req.on("error", reject);
  });
}

const targets = await getJson("/json/list");
const target = targets.find((item) => item.type === "page" && /^https:\/\/chatgpt\.com/.test(item.url));
if (!target) throw new Error("C ChatGPT target not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"));
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  waiter.resolve(message);
});
function call(method, params = {}, timeoutMs = 5000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const requestId = "gpt-root-rebind-1787987729077-g9rkgs";
const expression = `(() => { const message = ${JSON.stringify({ source: "teambuilding-workbench", type: "tb-workbench-pause-before-submit", requestId })}; window.postMessage(message, "*"); document.dispatchEvent(new CustomEvent("tb-workbench-pause-before-submit", { detail: message })); return { ok: true, requestId: message.requestId, href: location.href }; })()`;
const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false });
console.log(JSON.stringify({ target: { id: target.id, url: target.url }, result }, null, 2));
socket.close();
