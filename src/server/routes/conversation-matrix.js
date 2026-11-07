'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// 1. 应用自包含内部数据路径 (Priority 1: 确保应用与数据独立成套，便于打包推送与跨电脑直接运行)
const APP_ROOT = path.resolve(__dirname, '../../../');
const INTERNAL_AUDITED_FILE = path.join(APP_ROOT, 'data/matrix/all_real_audited_274.json');
const INTERNAL_EXCEL_PATH = path.join(APP_ROOT, 'data/matrix/GPT模板会话状态总览表.xlsx');

// 2. 外部兼容与兜底路径 (Fallback)
const EXTERNAL_AUDITED_FILE_1 = 'd:/AICode/all_real_audited_274.json';
const EXTERNAL_AUDITED_FILE_2 = 'D:/AICode/运行数据/江湖有旅人/内容生产App/all_real_audited_274.json';
const EXTERNAL_AUDITED_FILE_BACKUP = 'd:/AICode/all_real_audited_219.json';
const EXTERNAL_EXCEL_PATH_1 = 'd:/AICode/GPT模板会话状态总览表.xlsx';
const EXTERNAL_EXCEL_PATH_2 = 'D:/AICode/运行数据/江湖有旅人/内容生产App/GPT模板会话状态总台账.xlsx';

let schedulerState = {
  enabled: false,
  intervalHours: 3,
  batchSizePerAccount: 3,
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
      } else if (st.includes('完工') || st.includes('归档')) {
        st = '图文完工归档';
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
      } else if (st === '图文完工归档') {
        if (!analysis) analysis = tp ? `全套排版图片与小红书正文/标签均已交付（主题「${tp}」）；生产闭环，本地已落盘归档。` : `会话历史中已包含整套图文成果与发布文案，全流程闭环完工。`;
        statusCounts.completed++;
        accountBreakdowns[acc].completed++;
      } else {
        // 等待补充原料出计划
        if (!analysis) analysis = `母版就绪或历史单页废弃残留，当前无在途任务，等待注入新素材原料重新出计划。`;
        statusCounts.awaitingMaterial++;
        accountBreakdowns[acc].awaitingMaterial++;
      }

      accountBreakdowns[acc].total++;

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
        analysis
      });
    }
  }

  return {
    summary: {
      total: allItems.length,
      accountBreakdowns,
      statusCounts,
      excelPath: getActiveExcelPath(),
      scheduler: schedulerState
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
  if (pathname === '/api/production/conversation-matrix' && req.method === 'GET') {
    const data = loadMatrixData();
    ctx.sendJson(res, { ok: true, data });
    return true;
  }

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
        schedulerState.nextRunAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
      } else {
        schedulerState.nextRunAt = null;
      }
      ctx.sendJson(res, { ok: true, scheduler: schedulerState });
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
      if (body.intervalHours !== undefined) schedulerState.intervalHours = Number(body.intervalHours) || 3;
      if (body.batchSizePerAccount !== undefined) schedulerState.batchSizePerAccount = Number(body.batchSizePerAccount) || 3;
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

module.exports = { handle, loadMatrixData, sendWindowsToast };
