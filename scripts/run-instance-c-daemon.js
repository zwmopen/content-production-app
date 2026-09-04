const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const env = {
  ...process.env,
  CONTENT_INSTANCE_ID: 'C',
  CONTENT_INSTANCE_LABEL: '实例 C · account-3',
  PORT: '4333',
  TB_REMOTE_DEBUGGING_PORT: '9433',
  CONTENT_HTTP_PROXY: 'http://127.0.0.1:7897',
  TEAMBUILDING_DASHBOARD_RUNTIME: 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-C',
  TEAMBUILDING_SHARED_MATERIAL_ROOT: 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\shared-material',
  TB_USER_DATA_ROOT: 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\instance-C\\electron-userdata',
  CONTENT_ACCOUNT_IDS: 'account-3',
  CONTENT_ONLY_MODE: '1',
  TB_MAIN_WINDOW_SANDBOX: '0'
};

const electronPath = 'D:\\AICode\\工具开发\\projects\\content-production-app\\src\\node_modules\\electron\\dist\\electron.exe';
const mainPath = 'D:\\AICode\\工具开发\\projects\\content-production-app\\src\\desktop\\main.js';

function start() {
  console.log('[Instance C Daemon] 正在启动实例 C Electron 进程...');
  
  const lock = path.join(env.TB_USER_DATA_ROOT, 'SingletonLock');
  if (fs.existsSync(lock)) {
    try { fs.unlinkSync(lock); } catch(e) {}
  }

  const proc = spawn(electronPath, ['--no-sandbox', mainPath], {
    env,
    cwd: 'D:\\AICode\\工具开发\\projects\\content-production-app\\src'
  });

  proc.stdout.on('data', d => console.log('[Instance C STDOUT]', d.toString().trim().slice(0, 300)));
  proc.stderr.on('data', d => {
    const s = d.toString().trim();
    if (!s.includes('ExtensionLoadWarning') && !s.includes('deprecated')) {
      console.error('[Instance C STDERR]', s.slice(0, 300));
    }
  });

  proc.on('exit', (c, sig) => {
    console.warn('[Instance C Daemon] 退出 code=' + c + ', sig=' + sig + '，5秒后自动重启...');
    setTimeout(start, 5000);
  });
}

start();
