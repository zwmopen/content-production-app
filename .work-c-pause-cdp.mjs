import http from "node:http";

function getJson(path) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: 9433, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
  });
}

const targets = await getJson("/json/list");
const target = targets.find((item) => (
  item.type === "page"
  && item.url.includes("127.0.0.1:4333")
  && !item.url.includes("assistant-overlay")
));
if (!target) throw new Error("C workbench target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
let evaluateId = 0;
let evaluateReply = null;
let layoutId = 0;
let layoutReply = null;
let storageId = 0;
let storageReply = null;
let screenshotId = 0;
let screenshotReply = null;
let dialogEvent = null;
let dialogReplyId = 0;

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return id;
}

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Page.javascriptDialogOpening") {
    dialogEvent = {
      type: message.params.type,
      message: message.params.message
    };
    dialogReplyId = send("Page.handleJavaScriptDialog", { accept: true });
    return;
  }
  if (message.id === evaluateId) evaluateReply = message;
  if (message.id === layoutId) layoutReply = message;
  if (message.id === storageId) storageReply = message;
  if (message.id === screenshotId) screenshotReply = message;
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

send("Page.enable");
send("Runtime.enable");
send("Runtime.terminateExecution");
await new Promise((resolve) => setTimeout(resolve, 250));
layoutId = send("Page.getLayoutMetrics");
storageId = send("DOMStorage.getDOMStorageItems", { storageId: { securityOrigin: "http://127.0.0.1:4333", isLocalStorage: true } });
screenshotId = send("Page.captureScreenshot", { format: "png", fromSurface: true });
evaluateId = send("Runtime.evaluate", {
  expression: `(() => {
    const button = document.querySelector("#gptStopQueueBtn");
    if (!button || button.hidden || button.disabled) return { ok: false, reason: "stop-button-unavailable" };
    button.click();
    return { ok: true, clicked: true, text: button.textContent };
  })()`,
  returnByValue: true,
  awaitPromise: false
});

await new Promise((resolve) => setTimeout(resolve, 8000));
console.log(JSON.stringify({
  target: { id: target.id, url: target.url },
  evaluateReply,
  layoutReply,
  storageReply: storageReply ? { error: storageReply.error, result: storageReply.result ? { entries: storageReply.result.entries } : undefined } : null,
  screenshotReply: screenshotReply ? { error: screenshotReply.error, result: screenshotReply.result ? { dataLength: String(screenshotReply.result.data || "").length } : undefined } : null,
  dialogEvent,
  dialogReplyId
}, null, 2));
socket.close();
