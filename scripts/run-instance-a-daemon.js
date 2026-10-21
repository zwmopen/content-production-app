const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { findListeningPort } = require('../src/lib/instance-daemon-guard');

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.NODE_OPTIONS;

const RUNTIME_ROOT = 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\unified-runtime';
const USER_DATA_ROOT = path.join(RUNTIME_ROOT, 'electron-userdata');

const env = {
  ...process.env,
  CONTENT_INSTANCE_ID: 'A',
  CONTENT_INSTANCE_LABEL: '统一核心 · 全账号矩阵',
  PORT: '4331',
  TB_REMOTE_DEBUGGING_PORT: '9431',
  CONTENT_HTTP_PROXY: process.env.CONTENT_HTTP_PROXY || 'http://127.0.0.1:7897',
  TEAMBUILDING_DASHBOARD_RUNTIME: RUNTIME_ROOT,
  TEAMBUILDING_SHARED_MATERIAL_ROOT: 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\shared-material',
  TB_USER_DATA_ROOT: USER_DATA_ROOT,
  CONTENT_ACCOUNT_IDS: '',
  CONTENT_ONLY_MODE: '0',
  TB_MAIN_WINDOW_SANDBOX: '0',
  TB_DESKTOP_HIDDEN: '1'
};

const electronPath = 'D:\\AICode\\工具开发\\projects\\content-production-app\\src\\node_modules\\electron\\dist\\electron.exe';
const mainPath = 'D:\\AICode\\工具开发\\projects\\content-production-app\\src\\desktop\\main.js';

let checking = false;

function scheduleStart(delayMs) {
  setTimeout(() => { void start(); }, delayMs);
}

function cleanSingletonLocks() {
  try {
    for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const p = path.join(USER_DATA_ROOT, lock);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (_) {}
}

async function start() {
  if (checking) return;
  checking = true;
  try {
    const occupiedPort = await findListeningPort([9431]);
    if (occupiedPort) {
      console.log(`[Unified Engine Daemon] 统一核心已占用 CDP ${occupiedPort}，跳过重复启动；15秒后复查。`);
      scheduleStart(15000);
      return;
    }
  } catch (error) {
    console.error('[Unified Engine Daemon] 端口检查失败，保留现场；15秒后复查。', error.message);
    scheduleStart(15000);
    return;
  } finally {
    checking = false;
  }

  console.log('[Unified Engine Daemon] 正在启动统一多账号内容生产引擎 (单核心全矩阵)...');
  cleanSingletonLocks();

  const proc = spawn(electronPath, [
    '--remote-debugging-port=9431',
    '--no-sandbox',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--run-all-compositor-stages-before-draw',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    mainPath
  ], {
    env,
    cwd: 'D:\\AICode\\工具开发\\projects\\content-production-app\\src'
  });

  proc.stdout.on('data', d => console.log('[Unified Engine STDOUT]', d.toString().trim().slice(0, 300)));
  proc.stderr.on('data', d => {
    const s = d.toString().trim();
    if (!s.includes('ExtensionLoadWarning') && !s.includes('deprecated')) {
      console.error('[Unified Engine STDERR]', s.slice(0, 300));
    }
  });

  proc.on('exit', (c, sig) => {
    console.warn('[Unified Engine Daemon] 退出 code=' + c + ', sig=' + sig + '，5秒后复查状态...');
    scheduleStart(5000);
  });
  proc.on('error', (error) => {
    console.error('[Unified Engine Daemon] 启动错误，15秒后复查。', error.message);
    scheduleStart(15000);
  });
}

void start();
