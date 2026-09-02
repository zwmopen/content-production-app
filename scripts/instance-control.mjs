#!/usr/bin/env node

/**
 * Multi-instance CLI Controller for Content Production App (Instances A, B, C, D)
 * Usage:
 *   node scripts/instance-control.mjs status [A|B|C|D]
 *   node scripts/instance-control.mjs logs <A|B|C|D> [lines]
 *   node scripts/instance-control.mjs nav <A|B|C|D> [url]
 *   node scripts/instance-control.mjs pause <A|B|C|D>
 *   node scripts/instance-control.mjs resume <A|B|C|D>
 *   node scripts/instance-control.mjs skip <A|B|C|D>
 *   node scripts/instance-control.mjs force-new-chat <A|B|C|D>
 *   node scripts/instance-control.mjs eval <A|B|C|D> <workbench|chatgpt> <expression>
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const PROJECT_ROOT = "D:\\AICode\\工具开发\\projects\\content-production-app";

const INSTANCE_CONFIGS = {
  A: { id: "A", accountId: "account-1", httpPort: 4331, cdpPorts: [9431, 9333], runtime: "D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-A" },
  B: { id: "B", accountId: "account-2", httpPort: 4332, cdpPorts: [9432], runtime: "D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-B" },
  C: { id: "C", accountId: "account-3", httpPort: 4333, cdpPorts: [9433], runtime: "D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-C" },
  D: { id: "D", accountId: "account-4", httpPort: 4334, cdpPorts: [9434], runtime: "D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-D" },
};

async function getAvailableCdpPort(inst) {
  for (const port of inst.cdpPorts) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return port;
    } catch {}
  }
  return null;
}

async function getCdpTargets(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
    return await res.json();
  } catch (err) {
    return [];
  }
}

async function cdpSend(debuggerUrl, method, params = {}, timeoutMs = 8000) {
  const socket = new WebSocket(debuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const id = Math.floor(Math.random() * 1000000);
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`)), timeoutMs);
    socket.addEventListener("message", async (e) => {
      try {
        const raw = typeof e.data === "string" ? e.data : Buffer.from(e.data).toString("utf8");
        const payload = JSON.parse(raw);
        if (payload.id !== id) return;
        clearTimeout(timer);
        if (payload.error) reject(new Error(JSON.stringify(payload.error)));
        else resolve(payload.result);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });

  socket.send(JSON.stringify({ id, method, params }));
  const result = await promise;
  socket.close();
  return result;
}

async function cdpEval(debuggerUrl, expression, timeoutMs = 8000) {
  const res = await cdpSend(debuggerUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs);
  if (res?.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || "CDP evaluation exception");
  }
  return res?.result?.value;
}

async function getInstanceState(instKey) {
  const inst = INSTANCE_CONFIGS[instKey.toUpperCase()];
  if (!inst) throw new Error(`Unknown instance: ${instKey}`);

  const cdpPort = await getAvailableCdpPort(inst);
  const targets = cdpPort ? await getCdpTargets(cdpPort) : [];
  const workbenchTarget = targets.find(t => t.type === "page" && !t.url.includes("assistant-overlay") && (t.url.includes(`:${inst.httpPort}`) || t.title.includes("内容生产")));
  const chatgptTarget = targets.find(t => t.type === "page" && t.url.includes("chatgpt.com"));

  let diskRuntime = null;
  const runtimePath = path.join(inst.runtime, "gpt-production-runtime.json");
  if (fs.existsSync(runtimePath)) {
    try { diskRuntime = JSON.parse(fs.readFileSync(runtimePath, "utf8")); } catch {}
  }

  let workbenchLive = null;
  if (workbenchTarget) {
    try {
      workbenchLive = await cdpEval(workbenchTarget.webSocketDebuggerUrl, `(() => ({
        queueRunning: typeof gptAutoRunning !== 'undefined' ? Boolean(gptAutoRunning) : null,
        queuePaused: typeof gptQueuePaused !== 'undefined' ? Boolean(gptQueuePaused) : null,
        autoPaused: typeof gptAutoPaused !== 'undefined' ? Boolean(gptAutoPaused) : null,
        queueIndex: typeof gptTestQueueIndex !== 'undefined' ? gptTestQueueIndex : null,
        totalTasks: typeof gptTestQueue !== 'undefined' ? gptTestQueue.length : 0,
        activeTask: typeof gptTestQueue !== 'undefined' && gptTestQueue[gptTestQueueIndex] ? {
          name: gptTestQueue[gptTestQueueIndex].name,
          status: gptTestQueue[gptTestQueueIndex]._status,
          stage: gptTestQueue[gptTestQueueIndex]._stage,
          percent: gptTestQueue[gptTestQueueIndex]._percent,
          lastError: gptTestQueue[gptTestQueueIndex]._materialLifecycleClaim?.lastError || gptTestQueue[gptTestQueueIndex]._error || '',
          conversationUrl: gptTestQueue[gptTestQueueIndex].conversationUrl || gptTestQueue[gptTestQueueIndex].templateConversationUrl || ''
        } : null
      }))()`, 4000);
    } catch {}
  }

  let chatgptLive = null;
  if (chatgptTarget) {
    try {
      chatgptLive = await cdpEval(chatgptTarget.webSocketDebuggerUrl, `(() => ({
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        hasTextarea: Boolean(document.querySelector('#prompt-textarea, textarea, div[contenteditable="true"]')),
        turnsCount: document.querySelectorAll('[data-message-author-role]').length
      }))()`, 3000);
    } catch (e) {
      chatgptLive = { url: chatgptTarget.url, error: e.message };
    }
  }

  return {
    instance: inst.id,
    accountId: inst.accountId,
    httpPort: inst.httpPort,
    cdpPort,
    cdpAlive: Boolean(cdpPort),
    workbenchTarget: Boolean(workbenchTarget),
    chatgptTarget: Boolean(chatgptTarget),
    workbenchLive,
    chatgptLive,
    diskRuntime: diskRuntime?.queue ? {
      running: diskRuntime.queue.running,
      paused: diskRuntime.queue.paused,
      totalTasks: diskRuntime.queue.tasks?.length || 0,
      activeTask: diskRuntime.queue.tasks?.[0] ? {
        name: diskRuntime.queue.tasks[0].name,
        status: diskRuntime.queue.tasks[0]._status,
        stage: diskRuntime.queue.tasks[0]._stage,
        percent: diskRuntime.queue.tasks[0]._percent,
        lastError: diskRuntime.queue.tasks[0]._materialLifecycleClaim?.lastError || diskRuntime.queue.tasks[0]._error || ''
      } : null
    } : null
  };
}

async function showStatus(targetInstKey) {
  const keys = targetInstKey ? [targetInstKey.toUpperCase()] : Object.keys(INSTANCE_CONFIGS);
  for (const key of keys) {
    const state = await getInstanceState(key);
    console.log(`\n================ 实例 ${state.instance} (${state.accountId}) ================`);
    console.log(`HTTP 端口: ${state.httpPort} | CDP 调试端口: ${state.cdpPort || '未监听'} | 进程状态: ${state.cdpAlive ? '🟢 运行中' : '🔴 未运行'}`);
    
    if (state.workbenchLive) {
      const q = state.workbenchLive;
      const act = q.activeTask;
      console.log(`队列状态: running=${q.queueRunning}, paused=${q.queuePaused || q.autoPaused}, 任务数=${q.totalTasks}, 当前索引=${q.queueIndex}`);
      if (act) {
        console.log(`活跃任务: [${act.status}] ${act.name}`);
        console.log(`  阶段: ${act.stage} (${act.percent}%)`);
        if (act.lastError) console.log(`  异常: ${act.lastError}`);
        if (act.conversationUrl) console.log(`  对话URL: ${act.conversationUrl}`);
      }
    } else if (state.diskRuntime) {
      const q = state.diskRuntime;
      const act = q.activeTask;
      console.log(`[离线快照] 队列状态: running=${q.running}, paused=${q.paused}, 任务数=${q.totalTasks}`);
      if (act) {
        console.log(`[离线快照] 活跃任务: [${act.status}] ${act.name} | 阶段: ${act.stage} (${act.percent}%)`);
        if (act.lastError) console.log(`  异常: ${act.lastError}`);
      }
    }

    if (state.chatgptLive) {
      const cg = state.chatgptLive;
      if (cg.error) {
        console.log(`ChatGPT 网页: ⚠️ 无响应 (${cg.error}) | URL: ${cg.url}`);
      } else {
        console.log(`ChatGPT 网页: 🟢 就绪 (${cg.readyState}) | 输入框: ${cg.hasTextarea ? '可用' : '无'} | URL: ${cg.url}`);
      }
    }
  }
}

async function showLogs(instKey, lines = 40) {
  const inst = INSTANCE_CONFIGS[instKey?.toUpperCase()];
  if (!inst) throw new Error("Please specify instance: A, B, C, or D");
  const logFile = path.join(inst.runtime, "desktop.log");
  if (!fs.existsSync(logFile)) {
    console.log(`Log file not found: ${logFile}`);
    return;
  }
  const content = fs.readFileSync(logFile, "utf8");
  const logLines = content.trim().split("\n");
  const tail = logLines.slice(-Number(lines));
  console.log(`\n=== 实例 ${inst.id} 最近 ${tail.length} 条日志 (${logFile}) ===\n`);
  console.log(tail.join("\n"));
}

async function forceNavigate(instKey, url = "https://chatgpt.com/") {
  const inst = INSTANCE_CONFIGS[instKey?.toUpperCase()];
  if (!inst) throw new Error("Please specify instance: A, B, C, or D");
  const cdpPort = await getAvailableCdpPort(inst);
  if (!cdpPort) throw new Error(`Instance ${inst.id} CDP is not running`);
  const targets = await getCdpTargets(cdpPort);
  const chatgptTarget = targets.find(t => t.type === "page" && t.url.includes("chatgpt.com"));
  if (!chatgptTarget) throw new Error(`Instance ${inst.id} ChatGPT page target not found`);

  console.log(`Navigating instance ${inst.id} ChatGPT view to: ${url}`);
  const navRes = await cdpSend(chatgptTarget.webSocketDebuggerUrl, "Page.navigate", { url }, 10000);
  console.log("Navigation result:", navRes);
}

async function forceNewChat(instKey, autoStart = true) {
  const inst = INSTANCE_CONFIGS[instKey?.toUpperCase()];
  if (!inst) throw new Error("Please specify instance: A, B, C, or D");
  const cdpPort = await getAvailableCdpPort(inst);
  if (!cdpPort) throw new Error(`Instance ${inst.id} CDP is not running`);
  const targets = await getCdpTargets(cdpPort);
  const wbTarget = targets.find(t => t.type === "page" && !t.url.includes("assistant-overlay") && (t.url.includes(`:${inst.httpPort}`) || t.title.includes("内容生产")));
  const cgTarget = targets.find(t => t.type === "page" && t.url.includes("chatgpt.com"));

  console.log(`Resetting queue & tasks on Instance ${inst.id} to use fresh chat...`);
  if (wbTarget) {
    const res = await cdpEval(wbTarget.webSocketDebuggerUrl, `(() => {
      let resetCount = 0;
      if (typeof gptTestQueue !== 'undefined' && Array.isArray(gptTestQueue)) {
        gptTestQueue.forEach((task, idx) => {
          if (task) {
            task.conversationUrl = '';
            task.templateConversationUrl = '';
            task.sessionPolicy = 'new-conversation';
            task.navigation = 'new-chat';
            task._freshConversationBootstrap = true;
            task.forceUpload = true;
            if (task._status === 'running' || task._status === 'paused') {
              task._status = 'queued';
              task._stage = '等待生产';
              task._percent = 0;
            }
            if (task._materialLifecycleClaim) {
              task._materialLifecycleClaim.lastError = '';
            }
            resetCount++;
          }
        });
        gptQueuePaused = false;
        gptAutoPaused = false;
        if (typeof activeGptAccountId !== 'undefined' && typeof writeGptWindowRuntime === 'function') {
          writeGptWindowRuntime(activeGptAccountId, { conversationUrl: '', status: 'running', currentStage: '等待生产', currentPercent: 0, lastError: '' });
        }
        if (typeof persistGptQueue === 'function') persistGptQueue();
        if (typeof updateGptTestQueueStatus === 'function') updateGptTestQueueStatus('已全部重置为新对话模式，准备开始');
        return { ok: true, resetCount, queueLength: gptTestQueue.length, activeIndex: gptTestQueueIndex };
      }
      return { ok: false, error: '未找到队列' };
    })()`);
    console.log("Workbench tasks reset result:", res);
  }

  if (cgTarget) {
    console.log("Navigating ChatGPT view to https://chatgpt.com/ ...");
    await cdpSend(cgTarget.webSocketDebuggerUrl, "Page.navigate", { url: "https://chatgpt.com/" }, 10000);
    console.log("Waiting 4 seconds for ChatGPT page to stabilize...");
    await new Promise(r => setTimeout(r, 4000));
  }

  if (autoStart && wbTarget) {
    console.log("Starting automatic production queue on Instance " + inst.id + "...");
    const startRes = await cdpEval(wbTarget.webSocketDebuggerUrl, `(() => {
      const startBtn = document.getElementById('btnStartGptAuto') || document.querySelector('.btn-start');
      if (startBtn) {
        startBtn.click();
        return { started: true, method: 'button-click' };
      }
      gptQueuePaused = false;
      gptAutoPaused = false;
      gptAutoRunning = true;
      if (typeof persistGptQueue === 'function') persistGptQueue();
      if (typeof startNextGptTask === 'function') {
        startNextGptTask();
      }
      return { started: true, method: 'direct-queue' };
    })()`);
    console.log("Start queue result:", startRes);
  }

  console.log(`✅ 实例 ${inst.id} 已完全重置为「新对话」模式，并已自动启动生产！`);
}

async function pauseQueue(instKey) {
  const inst = INSTANCE_CONFIGS[instKey?.toUpperCase()];
  if (!inst) throw new Error("Please specify instance: A, B, C, or D");
  const cdpPort = await getAvailableCdpPort(inst);
  if (!cdpPort) throw new Error(`Instance ${inst.id} CDP is not running`);
  const targets = await getCdpTargets(cdpPort);
  const wbTarget = targets.find(t => t.type === "page" && !t.url.includes("assistant-overlay") && (t.url.includes(`:${inst.httpPort}`) || t.title.includes("内容生产")));
  if (!wbTarget) throw new Error("Workbench page not found");

  const res = await cdpEval(wbTarget.webSocketDebuggerUrl, `(() => {
    const pauseBtn = document.getElementById('btnPauseGptAuto') || document.querySelector('.btn-pause');
    if (pauseBtn) { pauseBtn.click(); return { clicked: true }; }
    gptQueuePaused = true;
    gptAutoPaused = true;
    if (typeof persistGptQueue === 'function') persistGptQueue();
    return { manual: true };
  })()`);
  console.log(`Instance ${inst.id} queue paused:`, res);
}

async function resumeQueue(instKey) {
  const inst = INSTANCE_CONFIGS[instKey?.toUpperCase()];
  if (!inst) throw new Error("Please specify instance: A, B, C, or D");
  const cdpPort = await getAvailableCdpPort(inst);
  if (!cdpPort) throw new Error(`Instance ${inst.id} CDP is not running`);
  const targets = await getCdpTargets(cdpPort);
  const wbTarget = targets.find(t => t.type === "page" && !t.url.includes("assistant-overlay") && (t.url.includes(`:${inst.httpPort}`) || t.title.includes("内容生产")));
  if (!wbTarget) throw new Error("Workbench page not found");

  const res = await cdpEval(wbTarget.webSocketDebuggerUrl, `(() => {
    gptQueuePaused = false;
    gptAutoPaused = false;
    gptAutoRunning = true;
    if (typeof sendNextGptTestTask === 'function') {
      sendNextGptTestTask({ userInitiated: true, allowWindowSwitch: true });
      return { triggered: 'sendNextGptTestTask' };
    }
    const startBtn = document.getElementById('btnStartGptAuto') || document.querySelector('.btn-start');
    if (startBtn) { startBtn.click(); return { clicked: true }; }
    if (typeof persistGptQueue === 'function') persistGptQueue();
    return { manual: true };
  })()`);
  console.log(`Instance ${inst.id} queue resumed:`, res);
}

async function skipCurrentTask(instKey) {
  const inst = INSTANCE_CONFIGS[instKey?.toUpperCase()];
  if (!inst) throw new Error("Please specify instance: A, B, C, or D");
  const cdpPort = await getAvailableCdpPort(inst);
  if (!cdpPort) throw new Error(`Instance ${inst.id} CDP is not running`);
  const targets = await getCdpTargets(cdpPort);
  const wbTarget = targets.find(t => t.type === "page" && !t.url.includes("assistant-overlay") && (t.url.includes(`:${inst.httpPort}`) || t.title.includes("内容生产")));
  if (!wbTarget) throw new Error("Workbench page not found");

  const res = await cdpEval(wbTarget.webSocketDebuggerUrl, `(() => {
    if (typeof gptTestQueue !== 'undefined' && gptTestQueue[gptTestQueueIndex]) {
      const skipped = gptTestQueue[gptTestQueueIndex];
      skipped._status = 'skipped';
      gptTestQueueIndex = Math.min(gptTestQueue.length, gptTestQueueIndex + 1);
      if (typeof persistGptQueue === 'function') persistGptQueue();
      if (typeof updateGptTestQueueStatus === 'function') updateGptTestQueueStatus('已跳过当前卡住的任务');
      return { ok: true, skippedTask: skipped.name, nextIndex: gptTestQueueIndex };
    }
    return { ok: false, error: '没有可以跳过的任务' };
  })()`);
  console.log(`Instance ${inst.id} task skipped:`, res);
}

async function kickstartInstance(instKey) {
  const inst = INSTANCE_CONFIGS[instKey?.toUpperCase()];
  if (!inst) throw new Error("Please specify instance: A, B, C, or D");
  const cdpPort = await getAvailableCdpPort(inst);
  if (!cdpPort) throw new Error(`Instance ${inst.id} CDP is not running`);
  const targets = await getCdpTargets(cdpPort);
  const wbTarget = targets.find(t => t.type === "page" && !t.url.includes("assistant-overlay") && (t.url.includes(`:${inst.httpPort}`) || t.title.includes("内容生产")));
  
  if (wbTarget) {
    console.log(`[实例 ${inst.id}] 正在重载工作台以应用 24/7 全天候连续生产代码...`);
    try {
      await cdpSend(wbTarget.webSocketDebuggerUrl, "Page.reload", { ignoreCache: true }, 8000);
      await new Promise(r => setTimeout(r, 2500));
    } catch (e) {
      console.warn(`[实例 ${inst.id}] 工作台重载轻量提醒: ${e.message}`);
    }
  }

  await forceNewChat(inst.id, true);
}

async function kickstartAll() {
  console.log("=== 🚀 正在一键唤醒并启动 A/B/C/D 四路实例持续生产 ===");
  for (const key of Object.keys(INSTANCE_CONFIGS)) {
    try {
      await kickstartInstance(key);
    } catch (err) {
      console.error(`❌ 实例 ${key} 唤醒失败:`, err.message);
    }
  }
  console.log("\n=== ✅ 四路实例已全部踢入「新对话」满负荷生产模式 ===");
}

async function injectExtension(instKey) {
  const extDir = path.join(PROJECT_ROOT, "src", "integrations", "gpt-production-extension");
  const scripts = ["gm-shim.js", "patrol-stage.js", "gpt-automation-core.js", "sidebar.js"];
  
  const keys = instKey ? [instKey.toUpperCase()] : ["A", "B", "C", "D"];
  for (const key of keys) {
    const inst = INSTANCE_CONFIGS[key];
    if (!inst) continue;
    try {
      const cdpPort = await getAvailableCdpPort(inst);
      if (!cdpPort) continue;
      const targets = await getCdpTargets(cdpPort);
      const cgTarget = targets.find(t => t.type === "page" && t.url.includes("chatgpt.com"));
      if (!cgTarget) continue;
      for (const s of scripts) {
        const code = fs.readFileSync(path.join(extDir, s), "utf-8");
        await cdpEval(cgTarget.webSocketDebuggerUrl, code, 12000);
      }
      console.log(`✅ 实例 ${inst.id} ChatGPT 页面 4 个扩展脚本全部注入成功！`);
    } catch (e) {
      console.log(`❌ 实例 ${inst.id} 注入失败:`, e.message);
    }
  }
}

async function dismissModals(instKey) {
  const keys = instKey ? [instKey.toUpperCase()] : ["A", "B", "C", "D"];
  for (const key of keys) {
    const inst = INSTANCE_CONFIGS[key];
    if (!inst) continue;
    try {
      const cdpPort = await getAvailableCdpPort(inst);
      if (!cdpPort) continue;
      const targets = await getCdpTargets(cdpPort);
      const cgTarget = targets.find(t => t.type === "page" && t.url.includes("chatgpt.com"));
      if (!cgTarget) continue;
      await cdpEval(cgTarget.webSocketDebuggerUrl, `(() => {
        const btns = [...document.querySelectorAll('button')].filter(b => /^(?:确定|知道了|Close|关闭|OK)$/i.test(b.innerText.trim()));
        btns.forEach(b => { try { b.click(); } catch {} });
        return btns.length;
      })()`);
    } catch {}
  }
}

// CLI Routing
const [,, command = "status", arg1, arg2] = process.argv;

(async () => {
  switch (command.toLowerCase()) {
    case "dismiss-modals":
    case "dismiss":
      await dismissModals(arg1);
      break;
    case "inject-ext":
    case "inject":
      await injectExtension(arg1);
      break;
    case "status":
      await showStatus(arg1);
      break;
    case "kickstart":
    case "kickstart-all":
    case "start-all":
      if (arg1) {
        await kickstartInstance(arg1);
      } else {
        await kickstartAll();
      }
      break;
    case "logs":
    case "log":
      await showLogs(arg1, arg2);
      break;
    case "nav":
    case "navigate":
      await forceNavigate(arg1, arg2);
      break;
    case "force-new-chat":
    case "new-chat":
    case "reset":
      await forceNewChat(arg1);
      break;
    case "pause":
      await pauseQueue(arg1);
      break;
    case "resume":
    case "start":
      await resumeQueue(arg1);
      break;
    case "eval": {
      const inst = INSTANCE_CONFIGS[arg1?.toUpperCase()];
      if (!inst) throw new Error("Please specify instance: A, B, C, or D");
      const cdpPort = await getAvailableCdpPort(inst);
      if (!cdpPort) throw new Error(`Instance ${inst.id} CDP is not running`);
      const targets = await getCdpTargets(cdpPort);
      const target = arg2 === "chatgpt"
        ? targets.find(t => t.type === "page" && t.url.includes("chatgpt.com"))
        : targets.find(t => t.type === "page" && !t.url.includes("assistant-overlay") && (t.url.includes(`:${inst.httpPort}`) || t.title.includes("内容生产")));
      if (!target) throw new Error(`Target ${arg2} not found on instance ${inst.id}`);
      const evalExpr = process.argv.slice(5).join(" ");
      const val = await cdpEval(target.webSocketDebuggerUrl, evalExpr);
      console.log(`[Eval ${inst.id} ${arg2}] Result:`, val);
      break;
    }
    case "skip":
      await skipCurrentTask(arg1);
      break;
    default:
      console.log(`
Multi-instance CLI Controller for Content Production App:
  node scripts/instance-control.mjs kickstart [A|B|C|D]       - 一键重载并唤醒四路（或指定）实例开启 24/7 生产
  node scripts/instance-control.mjs eval <A|B|C|D> <wb|cg> <js> - 在工作台或ChatGPT中执行JS表达式
  node scripts/instance-control.mjs status [A|B|C|D]          - 查看实例健康状态、队列与页面就绪情况
  node scripts/instance-control.mjs logs <A|B|C|D> [lines]     - 查看指定实例最近运行日志
  node scripts/instance-control.mjs nav <A|B|C|D> [url]        - 强制将 ChatGPT 网页导航到指定 URL（默认首页）
  node scripts/instance-control.mjs new-chat <A|B|C|D>         - 清除卡死的旧会话绑定，将当前任务重置为「新对话」模式
  node scripts/instance-control.mjs pause <A|B|C|D>            - 暂停队列
  node scripts/instance-control.mjs resume <A|B|C|D>           - 启动 / 恢复队列
  node scripts/instance-control.mjs skip <A|B|C|D>             - 跳过当前卡住的任务进入下一帖
      `);
  }
})().catch((err) => {
  console.error("❌ 执行失败:", err.message);
  process.exit(1);
});
