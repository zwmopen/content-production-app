const http = require("node:http");

const debugPort = Number(process.env.TB_REMOTE_DEBUGGING_PORT || process.argv[3] || 9432);
const command = String(process.argv[2] || "status").toLowerCase();

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

async function cdpEval(webSocketDebuggerUrl, expression) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const id = 1;
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: { expression, returnByValue: true, awaitPromise: true }
  }));
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP evaluate timeout")), 12000);
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data || "{}"));
      if (payload.id !== id) return;
      clearTimeout(timer);
      resolve(payload);
    });
  });
  socket.close();
  if (result?.error) throw new Error(JSON.stringify(result.error));
  if (result?.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result?.result?.result?.value;
}

async function main() {
  const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
  const wbTarget = targets.find((item) => item.type === "page"
    && /127\.0\.0\.1:43(?:31|32|33|34)\//.test(item.url)
    && !String(item.url).includes("assistant-overlay.html"));
  const gptTarget = targets.find((item) => item.type === "page" && item.url.includes("chatgpt.com"));

  if (!wbTarget) {
    throw new Error(`在调试端口 ${debugPort} 上未找到图文工作台主页面`);
  }

  if (command === "status") {
    const wbInfo = await cdpEval(wbTarget.webSocketDebuggerUrl, `(() => {
      const key = window.activeGptAccountId || 'account-2';
      const state = typeof gptWindowWorkerState === 'function' ? gptWindowWorkerState(key) : null;
      const account = (typeof gptAccounts !== 'undefined' ? gptAccounts : []).find(a => a.id === key);
      return {
        instanceTitle: document.title,
        accountId: key,
        accountName: account?.name || '',
        autoRunning: Boolean(state?.autoRunning),
        pausedByUser: Boolean(state?.pausedByUser),
        stoppedByUser: Boolean(state?.stoppedByUser),
        queueIndex: state?.queueIndex || 0,
        totalTasks: state?.queue?.length || 0,
        currentTaskId: state?.currentTaskId || '',
        lastError: state?.lastError || '',
        currentTask: state?.queue?.[state?.queueIndex || 0] ? {
          requestId: state.queue[state.queueIndex].requestId,
          name: state.queue[state.queueIndex].name,
          stage: state.queue[state.queueIndex]._stage,
          percent: state.queue[state.queueIndex]._percent,
          status: state.queue[state.queueIndex]._status
        } : null
      };
    })()`);

    let gptInfo = null;
    if (gptTarget) {
      gptInfo = await cdpEval(gptTarget.webSocketDebuggerUrl, `(() => ({
        url: location.href,
        title: document.title,
        extensionReady: document.documentElement.dataset.tbGptProductionExtension === "ready" || Boolean(document.getElementById("tb-gpt-production-extension-marker")),
        extensionVersion: document.documentElement.dataset.tbGptProductionExtensionVersion || document.getElementById("tb-gpt-production-extension-marker")?.content || "",
        composerReady: Boolean(document.querySelector('#prompt-textarea, textarea[data-id="root"], [contenteditable="true"]')),
        isLoggedIn: !document.querySelector('button[data-testid="login-button"], a[href*="login"]')
      }))()`).catch((e) => ({ error: e.message }));
    }

    process.stdout.write(JSON.stringify({ ok: true, workbench: wbInfo, gpt: gptInfo }, null, 2) + "\n");
    return;
  }

  if (command === "resume" || command === "continue" || command === "start") {
    const result = await cdpEval(wbTarget.webSocketDebuggerUrl, `(() => {
      const key = window.activeGptAccountId || 'account-2';
      if (typeof continueGptQueueFromUser === 'function') {
        continueGptQueueFromUser();
        return { ok: true, action: "continueGptQueueFromUser" };
      }
      if (typeof runIndependentGptWindow === 'function') {
        runIndependentGptWindow(key, { force: true, automaticResume: true });
        return { ok: true, action: "runIndependentGptWindow" };
      }
      return { ok: false, error: "未找到继续生产控制函数" };
    })()`);
    process.stdout.write(JSON.stringify({ ok: true, result }, null, 2) + "\n");
    return;
  }

  if (command === "pause") {
    const result = await cdpEval(wbTarget.webSocketDebuggerUrl, `(() => {
      const key = window.activeGptAccountId || 'account-2';
      if (typeof toggleGptQueueFromUser === 'function') {
        toggleGptQueueFromUser();
        return { ok: true, action: "toggleGptQueueFromUser" };
      }
      return { ok: false, error: "未找到暂停控制函数" };
    })()`);
    process.stdout.write(JSON.stringify({ ok: true, result }, null, 2) + "\n");
    return;
  }

  if (command === "retry") {
    const result = await cdpEval(wbTarget.webSocketDebuggerUrl, `(() => {
      const key = window.activeGptAccountId || 'account-2';
      if (typeof retryCurrentGptTask === 'function') {
        retryCurrentGptTask();
        return { ok: true, action: "retryCurrentGptTask" };
      }
      if (typeof retryIndependentGptWindowTask === 'function') {
        retryIndependentGptWindowTask(key);
        return { ok: true, action: "retryIndependentGptWindowTask" };
      }
      return { ok: false, error: "未找到重试控制函数" };
    })()`);
    process.stdout.write(JSON.stringify({ ok: true, result }, null, 2) + "\n");
    return;
  }

  if (command === "skip") {
    const result = await cdpEval(wbTarget.webSocketDebuggerUrl, `(() => {
      const key = window.activeGptAccountId || 'account-2';
      if (typeof skipCurrentGptTaskFromUser === 'function') {
        skipCurrentGptTaskFromUser();
        return { ok: true, action: "skipCurrentGptTaskFromUser" };
      }
      return { ok: false, error: "未找到跳过控制函数" };
    })()`);
    process.stdout.write(JSON.stringify({ ok: true, result }, null, 2) + "\n");
    return;
  }

  throw new Error(`不支持的命令: ${command}。支持: status | resume | pause | retry | skip`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
