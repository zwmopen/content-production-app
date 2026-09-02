const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_ELECTRON_PROXY,
  ELECTRON_PROXY_BYPASS_LIST,
  resolveElectronProxy
} = require("./lib/electron-network-proxy");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const EXPECTED_INSTANCES = [
  { id: "A", accountId: "account-1", label: "实例 A · 账号1", port: "4331", remoteDebuggingPort: "9431" },
  { id: "B", accountId: "account-2", label: "实例 B · 账号2", port: "4332", remoteDebuggingPort: "9432" },
  { id: "C", accountId: "account-3", label: "实例 C · 账号3", port: "4333", remoteDebuggingPort: "9433" },
  { id: "D", accountId: "account-4", label: "实例 D · 账号4", port: "4334", remoteDebuggingPort: "9434" }
];

function startupSource(id) {
  return fs.readFileSync(path.join(PROJECT_ROOT, `start-instance-${id.toLowerCase()}.ps1`), "utf8");
}

test("A-D startup scripts bind one account and one isolated runtime tuple each", () => {
  const sources = EXPECTED_INSTANCES.map((entry) => ({ entry, source: startupSource(entry.id) }));
  const seen = new Set();

  for (const { entry, source } of sources) {
    assert.match(source, new RegExp(`\\$env:CONTENT_INSTANCE_ID = "${entry.id}"`));
    assert.match(source, new RegExp(`\\$env:CONTENT_INSTANCE_LABEL = "${entry.label}"`));
    assert.match(source, new RegExp(`\\$env:PORT = "${entry.port}"`));
    assert.match(source, new RegExp(`\\$env:TB_REMOTE_DEBUGGING_PORT = "${entry.remoteDebuggingPort}"`));
    assert.match(source, new RegExp(`\\$env:CONTENT_ACCOUNT_IDS = "${entry.accountId}"`));
    assert.match(source, new RegExp(`TEAMBUILDING_DASHBOARD_RUNTIME = ".*\\\\instance-${entry.id}"`));
    assert.match(source, new RegExp(`TB_USER_DATA_ROOT = ".*\\\\instance-${entry.id}\\\\electron-userdata"`));
    assert.match(source, /TEAMBUILDING_SHARED_MATERIAL_ROOT = ".*\\shared-material"/);
    assert.match(source, /CONTENT_ONLY_MODE = "1"/);
    assert.match(source, /Start-Process -FilePath \$node/);
    assert.match(source, /electron\.cmd(?: --no-sandbox)? desktop\\main\.js/);
    if (entry.id === "A") {
      assert.match(source, /electron\.cmd --no-sandbox desktop\\main\.js/);
    } else {
      assert.doesNotMatch(source, /electron\.cmd --no-sandbox desktop\\main\.js/);
    }
    assert.doesNotMatch(source, /account-6/);

    for (const field of [entry.accountId, entry.port, entry.remoteDebuggingPort, `instance-${entry.id}`, `instance-${entry.id}\\electron-userdata`]) {
      assert.equal(seen.has(field), false, `实例隔离键重复: ${field}`);
      seen.add(field);
    }
  }
});

test("content-only auto-login uses the instance wrapper so A keeps its isolated runtime environment", () => {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, "src", "desktop", "main.js"), "utf8");
  assert.match(source, /if \(CONTENT_ONLY_MODE\)/);
  assert.match(source, /start-instance-\$\{CONTENT_INSTANCE_ID\.toLowerCase\(\)\}\.ps1/);
  assert.match(source, /WindowsPowerShell/);
  assert.match(source, /TB_REMOTE_DEBUGGING_PORT/);
  assert.match(source, /TB_USER_DATA_ROOT/);
});

test("A instance wrapper is UTF-8 BOM safe for Windows PowerShell 5.1", () => {
  const bytes = fs.readFileSync(path.join(PROJECT_ROOT, "start-instance-a.ps1"));
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
});

test("A-D startup scripts share only the material root and never the browser/runtime roots", () => {
  const sources = EXPECTED_INSTANCES.map((entry) => startupSource(entry.id));
  const sharedRoots = sources.map((source) => source.match(/TEAMBUILDING_SHARED_MATERIAL_ROOT = "([^"]+)"/)?.[1] || "");
  assert.ok(sharedRoots.every(Boolean));
  assert.equal(new Set(sharedRoots).size, 1);

  const runtimeRoots = sources.map((source) => source.match(/TEAMBUILDING_DASHBOARD_RUNTIME = "([^"]+)"/)?.[1] || "");
  const userDataRoots = sources.map((source) => source.match(/TB_USER_DATA_ROOT = "([^"]+)"/)?.[1] || "");
  assert.equal(new Set(runtimeRoots).size, EXPECTED_INSTANCES.length);
  assert.equal(new Set(userDataRoots).size, EXPECTED_INSTANCES.length);
});

test("Electron instances use the local proxy while bypassing local workbench traffic", () => {
  const config = resolveElectronProxy();
  assert.equal(config.enabled, true);
  assert.equal(config.proxyServer, DEFAULT_ELECTRON_PROXY);
  assert.equal(config.proxyBypassList, ELECTRON_PROXY_BYPASS_LIST);
  assert.match(startupSource("A"), /CONTENT_HTTP_PROXY = "http:\/\/127\.0\.0\.1:7897"/);
});
