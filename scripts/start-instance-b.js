const child_process = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const runtimeDir = "D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-B";
const sharedMaterialRoot = "D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\shared-material";
const userDataRoot = path.join(runtimeDir, "electron-userdata");

fs.mkdirSync(runtimeDir, { recursive: true });
fs.mkdirSync(userDataRoot, { recursive: true });

const env = {
  ...process.env,
  CONTENT_INSTANCE_ID: "B",
  CONTENT_INSTANCE_LABEL: "实例 B · 账号2",
  PORT: "4332",
  TB_REMOTE_DEBUGGING_PORT: "9432",
  TEAMBUILDING_DASHBOARD_RUNTIME: runtimeDir,
  TEAMBUILDING_SHARED_MATERIAL_ROOT: sharedMaterialRoot,
  TB_USER_DATA_ROOT: userDataRoot,
  CONTENT_ACCOUNT_IDS: "account-2",
  CONTENT_ONLY_MODE: "1",
  TB_MAIN_WINDOW_SANDBOX: "0"
};

let electronProcess = null;
let shuttingDown = false;

function checkIsRunning(port = 9432) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startElectron() {
  if (shuttingDown) return;
  const running = await checkIsRunning(9432);
  if (running) {
    console.log("[Instance B] Electron already listening on 9432.");
    return;
  }

  const electronPath = path.join(srcDir, "node_modules", "electron", "dist", "electron.exe");
  const electronOut = fs.openSync(path.join(runtimeDir, "electron.stdout.log"), "a");
  const electronErr = fs.openSync(path.join(runtimeDir, "electron.stderr.log"), "a");

  console.log("[Instance B] Starting Electron on 9432 (HTTP 4332)...");
  electronProcess = child_process.spawn(
    electronPath,
    ["--no-sandbox", path.join(srcDir, "desktop", "main.js")],
    {
      cwd: srcDir,
      env,
      stdio: ["ignore", electronOut, electronErr]
    }
  );

  electronProcess.on("exit", async (code, signal) => {
    console.log(`[Instance B] Electron process exited with code=${code}, signal=${signal}`);
    electronProcess = null;
    if (!shuttingDown) {
      setTimeout(async () => {
        const stillLive = await checkIsRunning(9432);
        if (!stillLive) startElectron();
      }, 5000);
    }
  });
}

startElectron();

process.on("SIGINT", () => {
  shuttingDown = true;
  try { if (electronProcess) electronProcess.kill(); } catch {}
  process.exit(0);
});

process.on("SIGTERM", () => {
  shuttingDown = true;
  try { if (electronProcess) electronProcess.kill(); } catch {}
  process.exit(0);
});
