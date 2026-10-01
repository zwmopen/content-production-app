const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// [2026-09-23] 与 B 守护同步加固：显式清除会强制 electron 以 node 模式运行的环境变量。
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.NODE_OPTIONS;

const env = {
  ...process.env,
  CONTENT_INSTANCE_ID: 'A',
  CONTENT_INSTANCE_LABEL: '实例 A · account-1',
  PORT: '4331',
  TB_REMOTE_DEBUGGING_PORT: '9431',
  // [2026-09-25 修] 7890/7891/7892 均已无服务监听，Clash 实际只听 7897（netstat 实测 PID 随 Clash 重启变化）。
  // electron 连不上代理 -> chatgpt 页面落在 chrome-error -> 找不到上传节点 -> 队列被连续判废。
  // 改回 7897（Clash Party / mihomo 当前混合端口）。
  CONTENT_HTTP_PROXY: 'http://127.0.0.1:7897',
  TEAMBUILDING_DASHBOARD_RUNTIME: 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-A',
  TEAMBUILDING_SHARED_MATERIAL_ROOT: 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\shared-material',
  TB_USER_DATA_ROOT: 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-A\\electron-userdata',
  CONTENT_ACCOUNT_IDS: 'account-1',
  CONTENT_ONLY_MODE: '1',
  TB_MAIN_WINDOW_SANDBOX: '0',
  // [2026-09-25 修] 用户要求：实例默认后台最小化运行，严禁自动置顶/抢焦点。
  // TB_DESKTOP_HIDDEN=1 -> 窗口不创建前台实例，只进托盘；second-instance 的 --show 之外的唤醒全部忽略。
  TB_DESKTOP_HIDDEN: '1'
};

const electronPath = 'D:\\AICode\\工具开发\\projects\\content-production-app\\src\\node_modules\\electron\\dist\\electron.exe';
const mainPath = 'D:\\AICode\\工具开发\\projects\\content-production-app\\src\\desktop\\main.js';

function start() {
  console.log('[Instance A Daemon] 正在启动实例 A Electron 进程 (后台隐藏模式)...');
  
  const lock = path.join(env.TB_USER_DATA_ROOT, 'SingletonLock');
  if (fs.existsSync(lock)) {
    try { fs.unlinkSync(lock); } catch(e) {}
  }

  // [2026-09-25 修] 移除 '--show'：旧主进程收到 second-instance(--show) 会 restore+focus 抢前台，
  // 这就是"每 5 秒弹一次窗口"的根因。后台模式下严禁传 --show。
  const proc = spawn(electronPath, ['--remote-debugging-port=9431', '--no-sandbox', mainPath], {
    env,
    cwd: 'D:\\AICode\\工具开发\\projects\\content-production-app\\src'
  });

  proc.stdout.on('data', d => console.log('[Instance A STDOUT]', d.toString().trim().slice(0, 300)));
  proc.stderr.on('data', d => {
    const s = d.toString().trim();
    if (!s.includes('ExtensionLoadWarning') && !s.includes('deprecated')) {
      console.error('[Instance A STDERR]', s.slice(0, 300));
    }
  });

  proc.on('exit', (c, sig) => {
    console.warn('[Instance A Daemon] 退出 code=' + c + ', sig=' + sig + '，5秒后自动重启...');
    setTimeout(start, 5000);
  });
}

start();
