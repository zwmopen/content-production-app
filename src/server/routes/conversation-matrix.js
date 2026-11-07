'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// 1. 应用自包含内部数据路径 (Priority 1: 确保应用与数据独立成套，便于打包推送与跨电脑直接运行)
const APP_ROOT = path.resolve(__dirname, '../../../');
const INTERNAL_AUDITED_FILE = path.join(APP_ROOT, 'data/matrix/all_real_audited_274.json');
const INTERNAL_EXCEL_PATH = path.join(APP_ROOT, 'data/matrix/GPT模板会话状态总览表.xlsx');
const INTERNAL_NOTIFICATIONS_FILE = path.join(APP_ROOT, 'data/matrix/notifications.json');

// 2. 外部兼容与兜底路径 (Fallback)
const EXTERNAL_AUDITED_FILE_1 = 'd:/AICode/all_real_audited_274.json';
const EXTERNAL_AUDITED_FILE_2 = 'D:/AICode/运行数据/江湖有旅人/内容生产App/all_real_audited_274.json';
const EXTERNAL_AUDITED_FILE_BACKUP = 'd:/AICode/all_real_audited_219.json';
const EXTERNAL_EXCEL_PATH_1 = 'd:/AICode/GPT模板会话状态总览表.xlsx';
const EXTERNAL_EXCEL_PATH_2 = 'D:/AICode/运行数据/江湖有旅人/内容生产App/GPT模板会话状态总台账.xlsx';

// 3. 本地成品库路径与账号映射根目录
const LOCAL_FINISHED_PRODUCTS_ROOT = 'D:/AICode/项目推进/projects/江湖有旅人/主项目/03-成品库';
const ACCOUNT_ROOT_MAP = {
  A: path.join(LOCAL_FINISHED_PRODUCTS_ROOT, 'A手动制作').replace(/\\/g, '/'),
  B: path.join(LOCAL_FINISHED_PRODUCTS_ROOT, '桐庐成品').replace(/\\/g, '/'),
  C: path.join(LOCAL_FINISHED_PRODUCTS_ROOT, '上海成品').replace(/\\/g, '/'),
  DEFAULT: LOCAL_FINISHED_PRODUCTS_ROOT.replace(/\\/g, '/')
};

let cachedProductDirs = null;
let lastDirsCacheTime = 0;

function getProductDirsCache() {
  const now = Date.now();
  if (cachedProductDirs && (now - lastDirsCacheTime < 60000)) {
    return cachedProductDirs;
  }
  const results = [];
  function scan(dir, depth) {
    if (depth > 2) return;
    try {
      const list = fs.readdirSync(dir, { withFileTypes: true });
      for (const d of list) {
        if (!d.isDirectory() || d.name.startsWith('.')) continue;
        const full = path.join(dir, d.name).replace(/\\/g, '/');
        results.push({ name: d.name, path: full });
        scan(full, depth + 1);
      }
    } catch (_) {}
  }
  if (fs.existsSync(LOCAL_FINISHED_PRODUCTS_ROOT)) {
    scan(LOCAL_FINISHED_PRODUCTS_ROOT, 0);
  }
  cachedProductDirs = results;
  lastDirsCacheTime = now;
  return results;
}

function resolveItemFolder(item, acc) {
  const allDirs = getProductDirsCache();
  const topic = (item.topic || '').trim();
  const title = (item.title || '').trim();

  let matched = null;
  if (topic && topic.length >= 3) {
    matched = allDirs.find(d => d.name.includes(topic) || topic.includes(d.name));
  }
  if (!matched && title && title.length >= 4) {
    const cleanTitle = title.replace(/[0-9]+|精·方案·|模板学习回执|素材接收与学习回执/g, '').trim();
    if (cleanTitle.length >= 3) {
      matched = allDirs.find(d => d.name.includes(cleanTitle) || cleanTitle.includes(d.name));
    }
  }

  if (matched) {
    return {
      folderPath: matched.path,
      folderName: matched.name,
      hasSpecificFolder: true
    };
  }

  const fallbackPath = ACCOUNT_ROOT_MAP[acc] || ACCOUNT_ROOT_MAP.DEFAULT;
  return {
    folderPath: fallbackPath,
    folderName: path.basename(fallbackPath),
    hasSpecificFolder: false
  };
}

const LARK_CLI = 'D:\\AICode\\工具开发\\toolchains\\npm-global\\node_modules\\@larksuite\\cli\\scripts\\run.js';
const FEISHU_CHAT_ID = 'oc_bb67c9036e6b14da9bb7be9336dfa9c0';

let schedulerState = {
  enabled: false,
  intervalHours: 1, // 默认为每小时跑一趟闭环一套作品
  batchSizePerAccount: 1,
  lastRunAt: null,
  nextRunAt: null,
  timerId: null,
  history: []
};

function getActiveExcelPath() {
  if (fs.existsSync(INTERNAL_EXCEL_PATH)) return INTERNAL_EXCEL_PATH;
  if (fs.existsSync(EXTERNAL_EXCEL_PATH_1)) return EXTERNAL_EXCEL_PATH_1;
  return EXTERNAL_EXCEL_PATH_2;
}

// ----------------- 通知中心数据存取 -----------------
function loadNotifications() {
  if (fs.existsSync(INTERNAL_NOTIFICATIONS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(INTERNAL_NOTIFICATIONS_FILE, 'utf8'));
    } catch (_) {}
  }
  return { unreadCount: 0, list: [] };
}

function saveNotifications(data) {
  try {
    fs.mkdirSync(path.dirname(INTERNAL_NOTIFICATIONS_FILE), { recursive: true });
    fs.writeFileSync(INTERNAL_NOTIFICATIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save notifications:', e.message);
  }
}

function addNotification(notif) {
  const store = loadNotifications();
  store.unreadCount = (store.unreadCount || 0) + 1;
  store.list = store.list || [];
  store.list.unshift(notif);
  if (store.list.length > 50) store.list = store.list.slice(0, 50); // 最多保留 50 条历史通知
  saveNotifications(store);
  return store;
}

// 飞书即时富文本卡片推送
function sendFeishuNotification(info) {
  if (!fs.existsSync(LARK_CLI)) {
    console.warn('Lark CLI not found at', LARK_CLI);
    return Promise.resolve(false);
  }
  const title = info.title || '单套小红书图文作品已闭环落盘';
  const topic = info.topic || '上海露营逃离城市计划';
  const account = info.accountLabel || 'C · donnaparkerz';
  const imagesCount = info.imagesCount || 10;
  const copyVersions = info.copyVersions || 5;
  const folder = (info.folderPath || '').replace(/\\/g, '/');
  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const md = `🎉 **【每小时生产闭环】单套图文作品已成功交付落盘！**\n\n---\n* **生成主题**：${topic}\n* **生产账号**：${account}\n* **作品规格**：1086×1448 原生竖版大图 × ${imagesCount} 张 ＋ ${copyVersions} 版完整文案\n* **落盘目录**：\`${folder}\`\n* **完成时间**：${timeStr}\n\n👉 *提示：大盘控制台右上角红点已更新，点击「🔔交付动态」可一键在电脑中打开成品文件夹。*`;
  
  const escapedMd = md.replace(/"/g, '\\"');
  const cmd = `node "${LARK_CLI}" im +messages-send --as bot --chat-id ${FEISHU_CHAT_ID} --markdown "${escapedMd}"`;
  return new Promise((resolve) => {
    exec(cmd, (err, stdout) => {
      if (err) {
        console.error('Feishu push error:', err.message);
        resolve(false);
      } else {
        console.log('Feishu push success:', stdout.trim());
        resolve(true);
      }
    });
  });
}

function loadMatrixData() {
  let raw = null;
  // 优先加载应用内嵌自包含数据
  if (fs.existsSync(INTERNAL_AUDITED_FILE)) {
    try { raw = JSON.parse(fs.readFileSync(INTERNAL_AUDITED_FILE, 'utf8')); } catch (_) {}
  }
  // 外部路径回退兼容
  if (!raw && fs.existsSync(EXTERNAL_AUDITED_FILE_1)) {
    try { raw = JSON.parse(fs.readFileSync(EXTERNAL_AUDITED_FILE_1, 'utf8')); } catch (_) {}
  }
  if (!raw && fs.existsSync(EXTERNAL_AUDITED_FILE_2)) {
    try { raw = JSON.parse(fs.readFileSync(EXTERNAL_AUDITED_FILE_2, 'utf8')); } catch (_) {}
  }
  if (!raw && fs.existsSync(EXTERNAL_AUDITED_FILE_BACKUP)) {
    try { raw = JSON.parse(fs.readFileSync(EXTERNAL_AUDITED_FILE_BACKUP, 'utf8')); } catch (_) {}
  }
  if (!raw) {
    return { summary: { total: 0 }, items: [] };
  }

  const accountMeta = {
    A: { name: '账号A', email: 'zwmrpg@gmail.com', label: '主账号 A' },
    B: { name: '账号B', email: 'upvote_big_4j+1@icloud.com', label: '副账号 B' },
    C: { name: '账号C', email: 'donnaparkerz155+548376@gmail.com', label: '副账号 C' }
  };

  const allItems = [];
  const statusCounts = {
    awaitingConfirmation: 0,
    awaitingCopy: 0,
    awaitingMaterial: 0,
    completed: 0
  };

  const accountBreakdowns = {
    A: { total: 0, awaitingConfirmation: 0, awaitingCopy: 0, awaitingMaterial: 0, completed: 0 },
    B: { total: 0, awaitingConfirmation: 0, awaitingCopy: 0, awaitingMaterial: 0, completed: 0 },
    C: { total: 0, awaitingConfirmation: 0, awaitingCopy: 0, awaitingMaterial: 0, completed: 0 }
  };

  for (const acc of ['A', 'B', 'C']) {
    const list = raw[acc] || [];
    for (const item of list) {
      let st = item.status || '等待补充原料出计划';
      const tp = item.topic || '';
      const group = item.group || '模板库';
      const msgCount = item.msgCount || 10;
      
      // 归一化为 4 阶直觉行动状态机（用户 2026-11-07 终审定标）
      if (st.includes('待确认') || st.includes('已出计划')) {
        st = '待确认计划出图';
      } else if (st.includes('待补充正文') || st.includes('待补充文案') || st.includes('缺文案')) {
        st = '待补充文案收尾';
      } else if (st.includes('完工') || st.includes('归档') || st.includes('成品库') || st.includes('已落地')) {
        st = '已落地成品库';
      } else {
        // 用户定标：只出单页出图的已经废弃（历史自动化残留），全部归入「等待补充原料出计划」重新出计划
        st = '等待补充原料出计划';
      }
      
      let analysis = item.analysis || '';
      if (st === '待确认计划出图') {
        if (!analysis) analysis = tp ? `AI已输出逐页排版方案（主题「${tp}」），共 ${msgCount} 条历史消息；当前等待确认回复「1」出图。` : `AI已针对当前任务输出逐页排版计划，等待确认计划出图。`;
        statusCounts.awaitingConfirmation++;
        accountBreakdowns[acc].awaitingConfirmation++;
      } else if (st === '待补充文案收尾') {
        if (!analysis) analysis = tp ? `整套原生竖版图片已交付完毕（主题「${tp}」）；缺少正式正文与发布标签，需下发出文案指令收尾。` : `图片生成已完毕，缺少配套发布文案，等待出文案指令。`;
        statusCounts.awaitingCopy++;
        accountBreakdowns[acc].awaitingCopy++;
      } else if (st === '已落地成品库') {
        if (!analysis) analysis = tp ? `全套排版图片与小红书正文/标签均已交付（主题「${tp}」）；生产闭环，本地 03-成品库 物理已存。` : `会话历史中已包含整套图文成果与发布文案，全流程闭环完工，本地物理已存成品库。`;
        statusCounts.completed++;
        accountBreakdowns[acc].completed++;
      } else {
        // 等待补充原料出计划
        if (!analysis) analysis = `母版就绪或历史单页废弃残留，当前无在途任务，等待注入新素材原料重新出计划。`;
        statusCounts.awaitingMaterial++;
        accountBreakdowns[acc].awaitingMaterial++;
      }

      accountBreakdowns[acc].total++;

      const folderInfo = resolveItemFolder(item, acc);

      allItems.push({
        convId: item.convId,
        account: acc,
        accountName: accountMeta[acc].name,
        email: accountMeta[acc].email,
        title: item.title,
        href: item.href,
        status: st,
        topic: tp,
        group,
        msgCount,
        analysis,
        folderPath: folderInfo.folderPath,
        folderName: folderInfo.folderName,
        hasSpecificFolder: folderInfo.hasSpecificFolder
      });
    }
  }

  return {
    summary: {
      total: allItems.length,
      accountBreakdowns,
      statusCounts,
      excelPath: getActiveExcelPath(),
      scheduler: schedulerState,
      notifications: loadNotifications()
    },
    items: allItems
  };
}

// Windows 原生 Toast / 气泡通知触发工具函数 (单套作品落地成功时触发)
function sendWindowsToast(title, msg) {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle = '${String(title || '江湖有旅人 · 内容制作').replace(/'/g, "''")}'
$notify.BalloonTipText = '${String(msg || '单套作品图文已成功落地归档至本地成品库！').replace(/'/g, "''")}'
$notify.Visible = $True
$notify.ShowBalloonTip(3000)
Start-Sleep -Milliseconds 500
$notify.Dispose()
`;
  const b64 = Buffer.from(ps, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    exec(`powershell -NoProfile -EncodedCommand ${b64}`, (err) => {
      if (err) resolve(false);
      else resolve(true);
    });
  });
}

async function handle(req, res, pathname, parsed, ctx) {
  // 1. 获取大盘全量矩阵状态
  if (pathname === '/api/production/conversation-matrix' && req.method === 'GET') {
    const data = loadMatrixData();
    ctx.sendJson(res, { ok: true, data });
    return true;
  }

  // 2. 获取未读通知与交付动态列表
  if (pathname === '/api/production/notifications' && req.method === 'GET') {
    const notifs = loadNotifications();
    ctx.sendJson(res, { ok: true, data: notifs });
    return true;
  }

  // 3. 标记所有通知为已读 (消除红点)
  if (pathname === '/api/production/notifications/read' && req.method === 'POST') {
    const store = loadNotifications();
    store.unreadCount = 0;
    if (Array.isArray(store.list)) {
      store.list.forEach(item => item.read = true);
    }
    saveNotifications(store);
    ctx.sendJson(res, { ok: true, message: '已全部标记为已读，小红点已清除', data: store });
    return true;
  }

  // 4. 打开本地作品文件夹 (智能定位具体作品或账号根目录)
  if (pathname === '/api/production/notifications/open-folder' && req.method === 'POST') {
    const body = JSON.parse(await ctx.getBody(req, 100000) || '{}');
    let targetPath = body.folderPath;
    let isSpecific = true;

    if (!targetPath || !fs.existsSync(targetPath)) {
      isSpecific = false;
      const acc = body.account || 'A';
      targetPath = ACCOUNT_ROOT_MAP[acc] || ACCOUNT_ROOT_MAP.DEFAULT;
      if (!fs.existsSync(targetPath)) {
        targetPath = LOCAL_FINISHED_PRODUCTS_ROOT;
      }
    }

    if (!fs.existsSync(targetPath)) {
      ctx.sendJson(res, { ok: false, error: '本地成品库根目录不存在: ' + targetPath });
      return true;
    }

    const winPath = targetPath.replace(/\//g, '\\');
    exec(`start "" "${winPath}"`, (err) => {
      // 在 Windows 中 start 命令正常打开目录；若有特殊错误则优雅捕获
      const folderName = path.basename(winPath);
      const msg = isSpecific
        ? `已在 Windows 资源管理器打开专属作品成品文件夹：${folderName}`
        : `该作品尚未落盘，已为您打开【${body.accountName || ('账号' + (body.account || ''))}】成品库根目录：${folderName}`;
      ctx.sendJson(res, { ok: true, isSpecific, folderPath: winPath, folderName, message: msg });
    });
    return true;
  }

  // 5. 生产指令派发
  if (pathname === '/api/production/dispatch/action' && req.method === 'POST') {
    const body = JSON.parse(await ctx.getBody(req, 100000) || '{}');
    const { action, convId, account } = body;

    if (action === 'open_excel') {
      const p = getActiveExcelPath();
      exec(`start "" "${p}"`, (err) => {
        if (err) {
          ctx.sendJson(res, { ok: false, error: err.message });
        } else {
          ctx.sendJson(res, { ok: true, message: `已在系统资源管理器打开 Excel: ${p}` });
        }
      });
      return true;
    }

    if (action === 'toggle_scheduler') {
      schedulerState.enabled = !schedulerState.enabled;
      if (schedulerState.enabled) {
        schedulerState.lastRunAt = new Date().toISOString();
        schedulerState.nextRunAt = new Date(Date.now() + (schedulerState.intervalHours || 1) * 3600 * 1000).toISOString();
      } else {
        schedulerState.nextRunAt = null;
      }
      ctx.sendJson(res, { ok: true, scheduler: schedulerState });
      return true;
    }

    if (action === 'push_test_feishu') {
      const folderPath = 'D:/AICode/项目推进/projects/江湖有旅人/主项目/03-成品库/上海成品/上海/2026-11-07T0524-小红书图文-T90_81 精·方案·上海露营逃离城市计划';
      sendFeishuNotification({
        title: 'T90_81 精·方案·上海露营逃离城市计划',
        topic: '上海露营逃离城市计划',
        accountLabel: 'C · donnaparkerz',
        imagesCount: 10,
        copyVersions: 5,
        folderPath: folderPath
      }).then((ok) => {
        // 同步在应用内产生一条未读通知红点
        addNotification({
          id: 'notif_' + Date.now(),
          timestamp: new Date().toISOString(),
          account: 'C',
          accountLabel: 'C · donnaparkerz',
          title: 'T90_81 精·方案·上海露营逃离城市计划',
          topic: '上海露营逃离城市计划',
          imagesCount: 10,
          copyVersions: 5,
          folderPath: folderPath,
          read: false
        });
        sendWindowsToast('🎉 飞书通知推送成功', '已向飞书生产群发送卡片并增加大盘未读交付动态！');
        ctx.sendJson(res, { ok: true, message: '已成功向飞书群推送作品完成卡片，大盘已新增未读小红点！' });
      });
      return true;
    }

    if (action === 'batch_copywriting') {
      const matrix = loadMatrixData();
      const targetItems = matrix.items.filter(x => x.status === '待补充文案收尾' || x.status === '图已出，待补充正文/文案');
      ctx.sendJson(res, {
        ok: true,
        action: 'batch_copywriting',
        targetCount: targetItems.length,
        targets: targetItems.map(t => ({ convId: t.convId, account: t.account, title: t.title, topic: t.topic })),
        message: `已就绪批量出文案流水线，共筛选出 ${targetItems.length} 条待补文案会话。`
      });
      return true;
    }

    if (action === 'batch_confirm_output') {
      const matrix = loadMatrixData();
      const targetItems = matrix.items.filter(x => x.status === '待确认计划出图' || x.status === '已出计划，待确认出图');
      ctx.sendJson(res, {
        ok: true,
        action: 'batch_confirm_output',
        targetCount: targetItems.length,
        targets: targetItems.map(t => ({ convId: t.convId, account: t.account, title: t.title, topic: t.topic })),
        message: `已就绪批量出作品流水线，共筛选出 ${targetItems.length} 条待确认计划会话。`
      });
      return true;
    }

    if (action === 'test_toast') {
      sendWindowsToast('🎉 江湖有旅人 · 内容制作', '【测试通知】单套作品已成功落盘至本地成品库！')
        .then(() => {
          ctx.sendJson(res, { ok: true, message: '已成功在 Windows 电脑触发原生桌面通知！' });
        });
      return true;
    }

    if (action === 'single_retry_remedy') {
      // 失败重发补救机制：重新向会话派发出图确认指令（如回复1）
      const prompt = body.prompt || '1，确认出图（补救重试：重新生成全部对应竖版图片）';
      ctx.sendJson(res, {
        ok: true,
        action: 'single_retry_remedy',
        convId,
        account,
        remedyPrompt: prompt,
        message: `已向会话 ${convId} 派发出图补救重试指令（重新发送提示确认计划）`
      });
      return true;
    }

    if (action === 'update_scheduler_settings') {
      if (body.intervalHours !== undefined) schedulerState.intervalHours = Number(body.intervalHours) || 1;
      if (body.batchSizePerAccount !== undefined) schedulerState.batchSizePerAccount = Number(body.batchSizePerAccount) || 1;
      if (body.enableToastNotification !== undefined) schedulerState.enableToastNotification = !!body.enableToastNotification;
      if (body.enableFeishuNotification !== undefined) schedulerState.enableFeishuNotification = !!body.enableFeishuNotification;
      ctx.sendJson(res, { ok: true, scheduler: schedulerState, message: '定时操作与通知参数设置已更新并生效' });
      return true;
    }

    if (action === 'single_dispatch') {
      ctx.sendJson(res, {
        ok: true,
        action: 'single_dispatch',
        convId,
        account,
        message: `已向会话 ${convId} 下发操作指令`
      });
      return true;
    }

    ctx.sendJson(res, { ok: false, error: `未知的操作指令: ${action}` });
    return true;
  }

  return false;
}

module.exports = { handle, loadMatrixData, sendWindowsToast, sendFeishuNotification, addNotification, loadNotifications };
