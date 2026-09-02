const path = require("node:path");

const srcDir = path.resolve(__dirname, "..", "src");
const runtimeDir = "D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-B";
const sharedMaterialRoot = "D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\shared-material";
const userDataRoot = path.join(runtimeDir, "electron-userdata");

process.env.CONTENT_INSTANCE_ID = "B";
process.env.CONTENT_INSTANCE_LABEL = "实例 B · 账号2";
process.env.PORT = "4332";
process.env.TB_REMOTE_DEBUGGING_PORT = "9432";
process.env.TEAMBUILDING_DASHBOARD_RUNTIME = runtimeDir;
process.env.TEAMBUILDING_SHARED_MATERIAL_ROOT = sharedMaterialRoot;
process.env.TB_USER_DATA_ROOT = userDataRoot;
process.env.CONTENT_ACCOUNT_IDS = "account-2";
process.env.CONTENT_ONLY_MODE = "1";
process.env.TB_MAIN_WINDOW_SANDBOX = "0";

const child_process = require("node:child_process");

const child = child_process.spawn(process.execPath, [path.join(srcDir, "server.js")], {
  cwd: srcDir,
  env: process.env,
  stdio: "inherit"
});

child.on("exit", (code) => {
  process.exit(code || 0);
});

