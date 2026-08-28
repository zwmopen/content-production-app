const debugPort = Number(process.argv[2] || 9335);
const appPort = Number(process.argv[3] || 4338);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findWorkbenchTarget() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === "page" && item.url.startsWith(`http://127.0.0.1:${appPort}/`));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // The packaged app may still be extracting and starting.
    }
    await wait(500);
  }
  throw new Error("Packaged workbench DevTools target was not found");
}

async function main() {
  const target = await findWorkbenchTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Unable to connect to packaged workbench DevTools"));
  });
  const evaluate = (expression, awaitPromise = false) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise, returnByValue: true }
    }));
  });
  await evaluate('document.querySelector(\'[data-tab="gptProductionTest"]\')?.click()');
  await wait(6000);
  const statusResult = await evaluate("window.gptWorkbench.status('account-1')", true);
  const uiResult = await evaluate(`({
    active: document.querySelector('#gptProductionTestView')?.classList.contains('active') || false,
    state: document.querySelector('#gptEmbeddedState')?.textContent || '',
    accountTabs: document.querySelectorAll('#gptAccountTabs .gpt-account-tab').length,
    browserControls: ['gptBrowserBackBtn', 'gptBrowserForwardBtn', 'gptBrowserReloadBtn', 'gptBrowserHomeBtn']
      .filter((id) => document.getElementById(id)).length,
    settingsButton: Boolean(document.querySelector('[data-open-page-settings="gptAuto"]'))
  })`);
  await evaluate("window.close()");
  socket.close();
  const status = statusResult?.result?.value || {};
  const ui = uiResult?.result?.value || {};
  if (!ui.active) throw new Error("GPT production test view did not become active");
  if (!status.available || !status.loaded || !status.extensionLoaded) {
    throw new Error(`Embedded GPT is incomplete: ${JSON.stringify({ status, ui })}`);
  }
  if (ui.accountTabs !== 1 || ui.browserControls !== 4 || !ui.settingsButton) {
    throw new Error(`GPT production controls are incomplete: ${JSON.stringify(ui)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, status, ui }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
