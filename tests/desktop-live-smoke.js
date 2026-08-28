const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DEBUG_URL = process.env.TB_DEBUG_URL || "http://127.0.0.1:9333/json";
const APP_URL = process.env.TB_APP_URL || "http://127.0.0.1:4327/";
const ARTIFACT_ROOT = process.env.TB_SMOKE_ARTIFACTS
  || path.resolve(__dirname, "..", "artifacts", "desktop-smoke");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectLocalWorkspace() {
  const targets = await fetch(DEBUG_URL).then((response) => response.json());
  const appOrigin = new URL(APP_URL).origin;
  const target = targets.find((item) => {
    if (!["page", "webview"].includes(item.type)) return false;
    try {
      const url = new URL(item.url);
      return url.origin === appOrigin && url.pathname === "/" && item.title === "团建工作台";
    } catch {
      return false;
    }
  });
  assert(target, `未找到桌面工作台页面：${APP_URL}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const browserErrors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") {
      browserErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "页面异常");
    }
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      browserErrors.push(`${message.params.entry.text} ${message.params.entry.url || ""}`.trim());
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} 超过 20 秒没有返回`));
    }, 20_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const screenshot = async (name) => {
    const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
    const output = path.join(ARTIFACT_ROOT, `${name}.png`);
    fs.writeFileSync(output, Buffer.from(result.data, "base64"));
    return output;
  };
  return { socket, send, evaluate, screenshot, browserErrors };
}

async function main() {
  const { socket, send, evaluate, screenshot, browserErrors } = await connectLocalWorkspace();
  const checks = [];
  const check = async (name, expression) => {
    const value = await evaluate(expression);
    assert(value, name);
    checks.push({ name, value });
  };

  try {
    browserErrors.length = 0;
    await evaluate("location.reload(); true");
    await wait(500);
    let ready = false;
    let readyStreak = 0;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      ready = await evaluate(`document.readyState === 'complete'
        && Boolean(document.querySelector('#gptTestMaterialFolders'))
        && Boolean(document.querySelector('[data-gpt-library-expand="material"]'))
        && document.querySelectorAll('.tab[data-tab]').length === 4`);
      readyStreak = ready ? readyStreak + 1 : 0;
      if (readyStreak >= 2) break;
      await wait(250);
    }
    assert.equal(readyStreak >= 2, true, "工作台主界面在 30 秒内未稳定就绪");

    const tabs = await evaluate(`[...document.querySelectorAll('.tab[data-tab]')].map((el) => el.dataset.tab)`);
    assert.deepEqual(tabs, ["gptProductionTest", "distribution", "conversion", "settings"]);
    checks.push({ name: "主工作流入口", value: tabs });

    for (const tab of tabs) {
      process.stdout.write(`[desktop-smoke] checking ${tab}\n`);
      await evaluate(`document.querySelector('.tab[data-tab="${tab}"]').click(); true`);
      await wait(tab === "conversion" ? 650 : 180);
      const state = await evaluate(`(() => {
        const view = document.querySelector('.view.active');
        const visible = (el) => el && getComputedStyle(el).display !== 'none'
          && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
        const clipped = [...view.querySelectorAll('button, .tab, .segmented-button, .setting-label')]
          .filter(visible)
          .filter((el) => el.scrollWidth > el.clientWidth + 4)
          .map((el) => (el.textContent || '').trim()).filter(Boolean).slice(0, 8);
        return {
          tab: document.querySelector('.tab.active')?.dataset.tab,
          view: view?.id,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          clipped
        };
      })()`);
      assert.equal(state.tab, tab, `${tab} 未切换成功`);
      assert(state.view, `${tab} 没有活动界面`);
      assert.equal(state.horizontalOverflow, false, `${tab} 存在整页横向溢出`);
      assert.deepEqual(state.clipped, [], `${tab} 有按钮或标签文字被裁切`);
      checks.push({ name: `${tab} 布局`, value: state });
      if (["gptProductionTest", "distribution"].includes(tab)) {
        await screenshot(tab);
      } else {
        checks.push({ name: `${tab} 视觉截图`, value: "使用结构和交互检查，避免内嵌原生页面触发 Chromium 合成截图阻塞" });
      }
      process.stdout.write(`[desktop-smoke] finished ${tab}\n`);
    }

    await evaluate(`document.querySelector('.tab[data-tab="gptProductionTest"]').click(); true`);
    await wait(250);
    await check("旧 API 生产页已退役", `!document.querySelector('[data-tab="dashboard"]')
      && !document.querySelector('#dashboardView')
      && !document.querySelector('#dashboardLegacyView')`);
    await check("GPT 素材与模板面板可放大恢复", `Boolean(document.querySelector('[data-gpt-library-expand="material"]')
      && document.querySelector('[data-gpt-library-expand="template"]'))`);

    await evaluate(`document.querySelector('.tab[data-tab="conversion"]').click(); true`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const loaded = await evaluate(`Boolean(document.querySelector('#conversionContent')?.textContent.trim()
        && !document.querySelector('#conversionContent .conversion-loading'))`);
      if (loaded) break;
      await wait(250);
    }
    await check("流量转化使用同层原生工作区", `Boolean(document.querySelector('#conversionView.active .conversion-native-shell')
      && document.querySelectorAll('[data-conversion-module]').length === 4
      && !document.querySelector('#conversionAppFrame'))`);
    await check("流量转化同源数据已加载", `Boolean(document.querySelector('#conversionContent')?.textContent.trim()
      && !document.querySelector('#conversionContent .conversion-loading'))`);

    await evaluate(`document.querySelector('.tab[data-tab="distribution"]').click(); true`);
    await wait(300);
    await check("内容分发包含设备、三阶段与记录", `(() => {
      const labels = [...document.querySelectorAll('#distributionTabs [data-panel]')].map((item) => item.textContent);
      return ['设备','抖音小红书','微信公众号','已全部发送','操作记录']
        .every((label) => labels.some((text) => text.includes(label)));
    })()`);
    await check("设备操作遵守在线和信任状态", `(() => {
      const rows = [...document.querySelectorAll('.device-row')];
      return rows.every((row) => {
        const disabled = [...row.querySelectorAll('.device-actions button')].every((button) => button.disabled);
        return row.classList.contains('is-online') && !row.classList.contains('is-untrusted') ? true : disabled;
      });
    })()`);

    await check("插件市场已退役且生产扩展仍在", `!document.querySelector('.tab[data-tab="plugins"]')
      && !document.querySelector('#pluginsView')
      && typeof window.gptWorkbench === 'object'`);

    await evaluate(`document.querySelector('.tab[data-tab="settings"]').click(); true`);
    await wait(200);
    await check("设置移除旧接口并保留备份与软件信息", `Boolean(document.querySelector('#cloudBackupStatus')
      && document.querySelector('#settingsVersion'))
      && !document.querySelector('#settingsApiSection')
      && !document.querySelector('#productionApiProvider')
      && !document.querySelector('#settingsMaterialRoot')
      && !document.querySelector('#settingsPortfolioRoot')`);
    await check("帮助图标统一为小圆按钮", `(() => {
      const buttons = [...document.querySelectorAll('[data-page-help]')];
      const visibleButtons = buttons.filter((button) => button.getBoundingClientRect().width > 0);
      return buttons.length >= 3 && visibleButtons.length >= 1 && visibleButtons.every((button) => {
        const rect = button.getBoundingClientRect();
        const radius = parseFloat(getComputedStyle(button).borderRadius);
        return Math.abs(rect.width - rect.height) <= 2 && radius >= rect.width * 0.45;
      });
    })()`);
    await check("坚果云状态与备份恢复入口齐全", `Boolean(document.querySelector('#cloudBackupStatus')?.textContent.trim()
      && document.querySelector('#runCloudBackupBtn')
      && document.querySelector('#inspectCloudBackupBtn')
      && document.querySelector('#restoreCloudBackupBtn'))`);

    await send("Emulation.setDeviceMetricsOverride", {
      width: 1180,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false
    });
    for (const tab of tabs) {
      await evaluate(`document.querySelector('.tab[data-tab="${tab}"]').click(); true`);
      await wait(tab === "conversion" ? 450 : 100);
      const compact = await evaluate(`(() => {
        const view = document.querySelector('.view.active');
        const visible = (el) => el && getComputedStyle(el).display !== 'none'
          && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
        return {
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          clippedButtons: [...view.querySelectorAll('.page-heading button, .settings-actions button, .production-controls button, .production-toolbar button, .distribution-page-tabs button, .segmented-control button')].filter(visible)
            .filter((el) => el.scrollWidth > el.clientWidth + 4)
            .map((el) => (el.textContent || '').trim()).filter(Boolean).slice(0, 5)
        };
      })()`);
      assert.equal(compact.overflow, false, `${tab} 在 1180px 下出现横向溢出`);
      assert.deepEqual(compact.clippedButtons, [], `${tab} 在 1180px 下有按钮文字被裁切`);
      checks.push({ name: `${tab} 紧凑屏幕`, value: compact });
    }
    await evaluate(`document.querySelector('.tab[data-tab="gptProductionTest"]').click(); true`);
    await wait(120);
    await screenshot("gptProductionTest-1180");
    await send("Emulation.clearDeviceMetricsOverride");

    const apiChecks = await evaluate(`Promise.all([
      fetch('/api/dashboard').then((r) => r.status),
      fetch('/api/cloud-backup/status').then((r) => r.status),
      fetch('/api/distribution/tasks').then((r) => r.status)
    ])`);
    assert(apiChecks.every((status) => status === 200), "有核心 API 入口不可用");
    checks.push({ name: "核心 API", value: apiChecks });

    assert.deepEqual(browserErrors, [], `浏览器控制台出现错误：${browserErrors.join(" | ")}`);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      checkedAt: new Date().toISOString(),
      artifacts: ARTIFACT_ROOT,
      checks
    }, null, 2)}\n`);
  } finally {
    socket.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
