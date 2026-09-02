import http from "node:http";

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: 9433, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
  });
}

const targets = await getJson("/json/list");
const target = targets.find((item) => item.type === "page" && item.url.includes("127.0.0.1:4333") && !item.url.includes("assistant-overlay"));
if (!target) throw new Error("C workbench target not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"));
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  waiter.resolve(message);
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function call(method, params = {}, timeoutMs = 5000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timeout`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (message) => { clearTimeout(timer); resolve(message); },
      reject
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const storageId = { securityOrigin: "http://127.0.0.1:4333", isLocalStorage: true };
const output = { target: { id: target.id, url: target.url }, calls: {} };
for (const [name, method, params] of [
  ["enable", "DOMStorage.enable", {}],
  ["items", "DOMStorage.getDOMStorageItems", { storageId }]
]) {
  try { output.calls[name] = await call(method, params); }
  catch (error) { output.calls[name] = { error: error.message }; }
}
console.log(JSON.stringify(output, null, 2));
socket.close();
