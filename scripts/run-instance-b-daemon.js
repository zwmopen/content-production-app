const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// [2026-09-23] 显式清除会强制 electron 以 node 模式运行的环境变量，
// 否则在 WorkBuddy 沙箱等带 ELECTRON_RUN_AS_NODE=1 的 shell 里拉起时，
// electron 会报 "bad option: --remote-debugging-port" 并直接退出（B 长期 OFFLINE 的根因之一）。
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.NODE_OPTIONS;

const env = {
  ...process.env,
  CONTENT_INSTANCE_ID: 'B',
  CONTENT_INSTANCE_LABEL: '实例 B · account-2',
  PORT: '4332',
  TB_REMOTE_DEBUGGING_PORT: '9432',
  // [2026-09-25 修] 7890/7891/7892 均已无服务监听，Clash 实际只听 7897（netstat 实测）。
  // 实例 B 今天上午的 ERR_PROXY_CONNECTION_FAILED 即此根因。
  CONTENT_HTTP_PROXY: 'http://127.0.0.1:7897',
  TEAMBUILDING_DASHBOARD_RUNTIME: 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-B',
  TEAMBUILDING_SHARED_MATERIAL_ROOT: 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\shared-material',
  TB_USER_DATA_ROOT: 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-B\\electron-userdata',
  CONTENT_ACCOUNT_IDS: 'account-2',
  CONTENT_ONLY_MODE: '1',
  TB_MAIN_WINDOW_SANDBOX: '0',
  // [2026-09-25 修] 用户要求：实例默认后台最小化运行，严禁自动置顶/抢焦点。
  TB_DESKTOP_HIDDEN: '1'
};

const electronPath = 'D:\\AICode\\工具开发\\projects\\content-production-app\\src\\node_modules\\electron\\dist\\electron.exe';
const mainPath = 'D:\\AICode\\工具开发\\projects\\content-production-app\\src\\desktop\\main.js';

function start() {
  console.log('[Instance B Daemon] 正在启动实例 B Electron 进程 (可视化窗口模式)...');
  
  const lock = path.join(env.TB_USER_DATA_ROOT, 'SingletonLock');
  if (fs.existsSync(lock)) {
    try { fs.unlinkSync(lock); } catch(e) {}
  }

  // [2026-09-25 修] 移除 '--show'：旧主进程收到 second-instance(--show) 会 restore+focus 抢前台。
  const proc = spawn(electronPath, ['--remote-debugging-port=9432', '--no-sandbox', mainPath], {
    env,
    cwd: 'D:\\AICode\\工具开发\\projects\\content-production-app\\src'
  });

  proc.stdout.on('data', d => console.log('[Instance B STDOUT]', d.toString().trim().slice(0, 300)));
  proc.stderr.on('data', d => {
    const s = d.toString().trim();
    if (!s.includes('ExtensionLoadWarning') && !s.includes('deprecated')) {
      console.error('[Instance B STDERR]', s.slice(0, 300));
    }
  });

  proc.on('exit', (c, sig) => {
    console.warn('[Instance B Daemon] 退出 code=' + c + ', sig=' + sig + '，5秒后自动重启...');
    setTimeout(start, 5000);
  });
}

start();
