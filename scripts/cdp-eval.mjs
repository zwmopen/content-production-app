#!/usr/bin/env node

const [, , targetTitle = "团建工作台", expressionInput = "location.href", actionAccountId = "account-1"] = process.argv;
const expressionAliases = {
  profiles: "window.gptWorkbench.profiles()",
  accounts: "JSON.parse(localStorage.getItem('teambuilding-gpt-accounts') || '[]')",
  "work-package": "({workPackage: dashboard?.workspaceSettings?.workPackage, stageRoots: dashboard?.distribution?.stageRoots})",
  "queue-state": "({running:gptAutoRunning,autoPaused:gptAutoPaused,queuePaused:gptQueuePaused,index:gptTestQueueIndex,length:gptTestQueue.length,mode:gptAutoSettings?.mode,task:gptTestQueue[gptTestQueueIndex]||null})",
  "page-text-tail": "document.body?.innerText?.slice(-1500) || ''",
  "assistant-image-turns": `Array.from(document.querySelectorAll('[data-turn="assistant"]')).filter((turn) => !turn.parentElement?.closest?.('[data-turn]')).slice(-16).map((turn, index) => ({
    index,
    text: String(turn.innerText || '').slice(0, 320),
    images: Array.from((turn.closest?.('[data-testid^="conversation-turn"]') || turn).querySelectorAll('img')).map((img) => ({
      alt: String(img.alt || ''),
      src: String(img.currentSrc || img.src || '')
    })).filter((item) => /backend-api|image|dalle|oaiusercontent/i.test(item.src))
  }))`,
  "gpt-diagnostic-direct": "window.tbGptDiagnostic?.() || window.CGPTImageDownloadDebug?.diagnostic?.() || null",
  "workflow-status": `window.gptWorkbench.workflowStatus(${JSON.stringify(actionAccountId)})`,
  "inspect-status": `window.gptWorkbench.inspectStatus(${JSON.stringify(actionAccountId)})`,
  diagnostic: `window.gptWorkbench.diagnostic(${JSON.stringify(actionAccountId)})`,
  "skip-current": "document.getElementById('gptSkipTaskBtn')?.click() ?? true",
  "start-account": "document.getElementById('gptStopQueueBtn')?.click() ?? true",
  "force-skip-current": "(() => { gptCurrentManualTask = null; gptSemiAutoPendingTask = null; gptAutoPaused = false; gptQueuePaused = false; gptTestQueueIndex = Math.min(gptTestQueue.length, gptTestQueueIndex + 1); if (gptTestQueue[gptTestQueueIndex - 1]) gptTestQueue[gptTestQueueIndex - 1]._status = 'skipped'; persistGptQueue(); updateGptTestQueueStatus('已跳过已归档但残留的旧断点，可以继续剩余任务'); return { queueIndex: gptTestQueueIndex, queueLength: gptTestQueue.length }; })()",
  "restart-with-login-backup": `window.gptWorkbench.createLoginRecovery(${JSON.stringify(actionAccountId)})`
};
const expression = expressionAliases[expressionInput] || expressionInput;
const requestTimeoutMs = Math.max(1_000, Number(process.env.TB_CDP_TIMEOUT_MS || 15_000));
const cdpRequest = expressionInput === "dismiss-dialog"
  ? { method: "Page.handleJavaScriptDialog", params: { accept: false } }
  : expressionInput === "accept-dialog"
    ? { method: "Page.handleJavaScriptDialog", params: { accept: true } }
  : expressionInput === "terminate-execution"
    ? { method: "Runtime.terminateExecution", params: {} }
  : { method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } };
const targets = await fetch("http://127.0.0.1:9333/json/list").then((response) => response.json());
const target = targetTitle.startsWith("url:")
  ? targets.find((item) => item.type === "page" && item.url === targetTitle.slice(4))
  : targets.find((item) => item.type === "page" && item.title.includes(targetTitle));
if (!target) throw new Error(`找不到调试页面：${targetTitle}`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const id = 1;
const resultPromise = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`CDP 执行超过 ${requestTimeoutMs}ms`)), requestTimeoutMs);
  socket.addEventListener("message", async (event) => {
    try {
      const raw = typeof event.data === "string"
        ? event.data
        : event.data instanceof Blob
          ? await event.data.text()
          : Buffer.from(event.data).toString("utf8");
      const payload = JSON.parse(raw);
      if (payload.id !== id) return;
      clearTimeout(timer);
      resolve(payload);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
});
socket.send(JSON.stringify({
  id,
  ...cdpRequest
}));
const payload = await resultPromise;
socket.close();
if (payload.error) throw new Error(payload.error.message);
if (payload.result?.exceptionDetails) {
  throw new Error(payload.result.exceptionDetails.exception?.description || "页面表达式执行失败");
}
const value = ["dismiss-dialog", "accept-dialog", "terminate-execution"].includes(expressionInput)
  ? payload.result
  : payload.result?.result?.value;
process.stdout.write(`${JSON.stringify(value ?? null, null, 2)}\n`);
