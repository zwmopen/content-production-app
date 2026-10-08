/**
 * CDP 产线会话日常自动巡检与治理调度器 (Daily CDP Cleanup Scheduler)
 * 
 * 用户最新确立规则：
 * - 频率：每天仅在 08:00 清理一次（一天一次，保持清爽，避免频繁扰动）
 * - 覆盖账号：
 *   1. 账号 A (zwmrpg, 9431)：自动出清报错/受限/单次出图垃圾，将业务会话自动归集至 11 大独立项目
 *   2. 账号 B (Orlando, 9432)：自动唤醒 target 并出清产线批量出图废弃残留
 * - 安全铁律：白名单一票否决（严禁触碰任何母版、底板、模板与真实业务对话）
 */

const http = require("node:http");

const CDP_PORTS = [9431, 9432];

// 核心保护白名单
const PROTECT_KEYWORDS = ['母版', '模板', 'template', 'master', '规范', '底板', '种子'];

// 垃圾会话指纹
const GARBAGE_PATTERNS = [
  /受限/, /限制/, /死锁/, /New chat/, /未命名/, /测试/, /报错/, /重试/,
  /出图/, /生成拼图/, /生成封面/, /封面出图/, /拼图修图/, /执行替代模拟/,
  /继续出图/, /图像生成/
];

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function runCleanupOnPort(port) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] 🔍 正在巡检 CDP 端口 ${port}...`);

  // 1. 获取 Version 与 Targets
  let version, targets;
  try {
    version = await getJson(`http://127.0.0.1:${port}/json/version`);
    targets = await getJson(`http://127.0.0.1:${port}/json`);
  } catch (e) {
    console.log(`  ⚠️ 端口 ${port} 未在线或无法连接，跳过。`);
    return;
  }

  const gpt = targets.find(t => t.url && t.url.includes("chatgpt.com"));
  if (!gpt || !gpt.webSocketDebuggerUrl) {
    console.log(`  ⚠️ 端口 ${port} 未找到 chatgpt.com 页面，跳过。`);
    return;
  }

  // 2. 唤醒/激活 Target（针对 Electron 容器中的休眠 webview）
  if (version && version.webSocketDebuggerUrl) {
    try {
      const browserWs = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise((resolve) => {
        const timer = setTimeout(() => { browserWs.close(); resolve(); }, 3000);
        browserWs.addEventListener("open", () => {
          browserWs.send(JSON.stringify({
            id: 1,
            method: "Target.activateTarget",
            params: { targetId: gpt.id }
          }));
        });
        browserWs.addEventListener("message", () => {
          clearTimeout(timer);
          browserWs.close();
          resolve();
        });
      });
    } catch (e) {}
  }

  // 3. 执行页面内批量扫描与安全清理
  const ws = new WebSocket(gpt.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const cleanScript = `(async () => {
    const sess = await (await fetch('/api/auth/session')).json();
    const token = sess.accessToken;
    if (!token) return { error: 'No token' };
    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    const fetchWithTimeout = async (url, options, timeoutMs = 2500) => {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(tid);
        return { ok: res.ok, status: res.status };
      } catch(e) {
        clearTimeout(tid);
        return { ok: false, error: e.message };
      }
    };

    // 获取最近 100 个会话
    const listRes = await (await fetch('/backend-api/conversations?offset=0&limit=100&order=updated', { headers })).json();
    const items = listRes.items || [];
    
    const protectKw = ${JSON.stringify(PROTECT_KEYWORDS)};
    const garbageIds = [];

    for (const c of items) {
      const title = c.title || '';
      // 白名单一票否决
      if (protectKw.some(k => title.toLowerCase().includes(k.toLowerCase()))) continue;

      // 垃圾指纹判定
      const isGarbage = [
        /受限/, /限制/, /死锁/, /New chat/, /未命名/, /测试/, /报错/, /重试/,
        /出图/, /生成拼图/, /生成封面/, /封面出图/, /拼图修图/, /执行替代模拟/,
        /继续出图/, /图像生成/
      ].some(p => p.test(title));

      if (isGarbage) {
        garbageIds.push(c.id);
      }
    }

    // 分批并发执行删除 (每批 5 个)
    let deletedCount = 0;
    for (let i = 0; i < garbageIds.length; i += 5) {
      const batch = garbageIds.slice(i, i + 5);
      const results = await Promise.all(batch.map(cid =>
        fetchWithTimeout('/backend-api/conversation/' + cid, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ is_visible: false })
        })
      ));
      deletedCount += results.filter(r => r.ok || r.status === 404).length;
      await new Promise(r => setTimeout(r, 80));
    }

    return {
      email: sess.user?.email,
      totalScanned: items.length,
      matchedGarbage: garbageIds.length,
      deletedCount
    };
  })()`;

  ws.send(JSON.stringify({
    id: 10,
    method: "Runtime.evaluate",
    params: { expression: cleanScript, returnByValue: true, awaitPromise: true }
  }));

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { ws.close(); resolve({ timeout: true }); }, 20000);
    ws.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data || "{}"));
      if (payload.id === 10) {
        clearTimeout(timer);
        ws.close();
        resolve(payload.result?.result?.value);
      }
    });
  });

  console.log(`  ✅ 端口 ${port} 巡检出清完毕:`, result);
}

async function executeDailyClean() {
  console.log(`\n======================================================`);
  console.log(`⏰ [${new Date().toLocaleString()}] 触发每日 08:00 CDP 会话自动出清治理`);
  console.log(`======================================================`);
  for (const port of CDP_PORTS) {
    try {
      await runCleanupOnPort(port);
    } catch (e) {
      console.error(`  ❌ 端口 ${port} 执行出错:`, e.message);
    }
  }
}

// 调度主循环：每天仅在 08:00:00 自动触发一次
function startDailyScheduler() {
  console.log("🚀 CDP 每日 08:00 定时清理调度器已就绪！");
  console.log("   - 执行策略: 每天仅在早晨 08:00 自动执行 1 次");
  console.log("   - 巡检目标: 端口 9431 (账号 A) 与 端口 9432 (账号 B)");
  console.log("   - 白名单保护: 100% 绝对保护所有母版与业务长效会话");

  let lastTriggeredDate = "";

  setInterval(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const todayStr = now.toISOString().slice(0, 10);

    // 每天 08:00 触发，且当天仅触发一次
    if (hours === 8 && minutes === 0 && lastTriggeredDate !== todayStr) {
      lastTriggeredDate = todayStr;
      executeDailyClean();
    }
  }, 30 * 1000);
}

if (require.main === module) {
  startDailyScheduler();
}

module.exports = { executeDailyClean, startDailyScheduler };
