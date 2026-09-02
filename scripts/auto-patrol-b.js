const child_process = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const rootDir = path.resolve(__dirname, "..");
const runtimeDir = "D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-B";
const patrolLogFile = path.join(runtimeDir, "auto-patrol.log");
const startScript = path.join(rootDir, "scripts", "start-instance-b.js");
const aiControlScript = path.join(rootDir, "scripts", "ai-control.js");
const cdpEvalScript = path.join(rootDir, "scripts", "cdp-eval.js");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(patrolLogFile, line, "utf8");
  } catch {}
  console.log(line.trim());
}

function checkPort(port, pathName = "/") {
  return new Promise((resolve) => {
    const req = http.get({
      host: "127.0.0.1",
      port,
      path: pathName,
      timeout: 3000
    }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve) => {
    child_process.execFile(process.execPath, [scriptPath, ...args], {
      cwd: rootDir,
      timeout: 30000
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code,
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim()
      });
    });
  });
}

let lastProgressStage = "";
let lastProgressPercent = 0;
let lastProgressTaskId = "";
let lastProgressTime = Date.now();
let consecutiveErrors = 0;

async function patrolCycle() {
  try {
    const httpAlive = await checkPort(4332, "/");
    const cdpAlive = await checkPort(9432, "/json/version");

    if (!httpAlive || !cdpAlive) {
      log(`[Patrol] 发现服务或调试端口异常 (HTTP 4332: ${httpAlive}, CDP 9432: ${cdpAlive})，尝试启动守护进程...`);
      runNodeScript(startScript);
      return;
    }

    const statusResult = await runNodeScript(aiControlScript, ["status", "9432"]);
    if (!statusResult.ok || !statusResult.stdout) {
      log(`[Patrol] 获取状态失败: ${statusResult.stderr || "空响应"}`);
      return;
    }

    let statusData;
    try {
      statusData = JSON.parse(statusResult.stdout);
    } catch (e) {
      log(`[Patrol] 解析状态 JSON 失败: ${statusResult.stdout.slice(0, 100)}`);
      return;
    }

    const wb = statusData.workbench || {};
    const currentTask = wb.currentTask || {};
    const autoRunning = Boolean(wb.autoRunning);
    const queueIndex = Number(wb.queueIndex || 0);
    const totalTasks = Number(wb.totalTasks || 0);
    const currentTaskId = currentTask.requestId || "";
    const currentStage = currentTask.stage || "";
    const currentPercent = Number(currentTask.percent || 0);

    // 检查进度是否有变化
    const progressChanged = currentTaskId !== lastProgressTaskId
      || currentStage !== lastProgressStage
      || currentPercent !== lastProgressPercent;

    if (progressChanged && autoRunning) {
      lastProgressTaskId = currentTaskId;
      lastProgressStage = currentStage;
      lastProgressPercent = currentPercent;
      lastProgressTime = Date.now();
      consecutiveErrors = 0;
      log(`[Patrol] 任务推进中: [${queueIndex + 1}/${totalTasks}] ${currentTask.name || "未命名"} | 阶段: ${currentStage || "初始"} (${currentPercent}%)`);
    } else {
      const stagnantMs = Date.now() - lastProgressTime;
      const stagnantMin = Math.round(stagnantMs / 60000);

      if (!autoRunning || totalTasks === 0) {
        log(`[Patrol] 检测到自动队列未运行或队列为空 (autoRunning=${autoRunning}, totalTasks=${totalTasks})，自动补仓并启动...`);
        if (totalTasks === 0) {
          const refillCode = `(async () => {
            const key = 'account-2';
            const workerState = typeof gptWindowWorkerState === 'function' ? gptWindowWorkerState(key) : null;
            const settings = typeof gptWindowSettings === 'function' ? gptWindowSettings(key) : {};
            if (typeof buildGptProductionQueueForWindow === 'function') {
              await buildGptProductionQueueForWindow(workerState, settings);
            }
            if (typeof runIndependentGptWindow === 'function') {
              runIndependentGptWindow(key, { force: true, userInitiated: true });
            }
            return { ok: true, count: workerState?.queue?.length || 0 };
          })()`;
          const refillRes = await runNodeScript(cdpEvalScript, ["9432", refillCode]);
          log(`[Patrol] 补仓启动结果: ${refillRes.stdout}`);
        } else {
          const startRes = await runNodeScript(aiControlScript, ["start", "9432"]);
          log(`[Patrol] 启动结果: ${startRes.stdout}`);
        }
        lastProgressTime = Date.now();
      } else if (stagnantMs > 12 * 60 * 1000) {
        // 卡在同一阶段超过 12 分钟
        log(`[Patrol] 警告：任务在阶段 [${currentStage}] 已停留 ${stagnantMin} 分钟无进展，尝试自动重试推进...`);
        const retryRes = await runNodeScript(aiControlScript, ["retry", "9432"]);
        log(`[Patrol] 重试结果: ${retryRes.stdout}`);
        lastProgressTime = Date.now();
        consecutiveErrors++;

        if (consecutiveErrors >= 3) {
          log(`[Patrol] 连续重试 3 次仍卡住，尝试跳过当前卡住任务进入下一项...`);
          const skipRes = await runNodeScript(aiControlScript, ["skip", "9432"]);
          log(`[Patrol] 跳过结果: ${skipRes.stdout}`);
          consecutiveErrors = 0;
          lastProgressTime = Date.now();
        }
      } else {
        log(`[Patrol] 运行正常: [${queueIndex + 1}/${totalTasks}] 阶段: ${currentStage || "进行中"} (${currentPercent}%)，已耗时 ${stagnantMin} 分钟`);
      }
    }
  } catch (err) {
    log(`[Patrol] 巡检异常: ${err.message}`);
  }
}

log("[Patrol] 实例 B 智能看门狗巡检服务已启动 (巡检周期: 60 秒)");
patrolCycle();
setInterval(patrolCycle, 60 * 1000);
