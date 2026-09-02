import http from "node:http";
const targets = await new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port: 9433, path: "/json/list" }, (res) => {
    let body = "";
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => resolve(JSON.parse(body)));
  }).on("error", reject);
});
const target = targets.find((item) => item.type === "page" && item.url.includes("127.0.0.1:4333") && !item.url.includes("assistant-overlay"));
if (!target) throw new Error("C workbench target not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let id = 0;
const calls = {};
function call(method, params = {}) {
  const requestId = ++id;
  calls[requestId] = { method, sentAt: new Date().toISOString() };
  socket.send(JSON.stringify({ id: requestId, method, params }));
}
socket.addEventListener("message", (event) => {
  const message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"));
  if (message.id && calls[message.id]) calls[message.id].reply = message;
});
call("Page.stopLoading");
call("Runtime.terminateExecution");
call("Page.getNavigationHistory");
await new Promise((resolve) => setTimeout(resolve, 5000));
console.log(JSON.stringify({ target: { id: target.id, url: target.url }, calls }, null, 2));
socket.close();
