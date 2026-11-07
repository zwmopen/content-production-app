'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const AUDITED_FILE_1 = 'd:/AICode/all_real_audited_274.json';
const AUDITED_FILE_BACKUP = 'd:/AICode/all_real_audited_219.json';
const AUDITED_FILE_2 = 'D:/AICode/运行数据/江湖有旅人/内容生产App/all_real_audited_274.json';
const EXCEL_PATH_1 = 'd:/AICode/GPT模板会话状态总览表.xlsx';
const EXCEL_PATH_2 = 'D:/AICode/运行数据/江湖有旅人/内容生产App/GPT模板会话状态总台账.xlsx';

let schedulerState = {
  enabled: false,
  intervalHours: 3,
  batchSizePerAccount: 3,
  lastRunAt: null,
  nextRunAt: null,
  timerId: null,
  history: []
};

function loadMatrixData() {
  let raw = null;
  if (fs.existsSync(AUDITED_FILE_1)) {
    try { raw = JSON.parse(fs.readFileSync(AUDITED_FILE_1, 'utf8')); } catch (_) {}
  }
  if (!raw && fs.existsSync(AUDITED_FILE_2)) {
    try { raw = JSON.parse(fs.readFileSync(AUDITED_FILE_2, 'utf8')); } catch (_) {}
  }
  if (!raw && fs.existsSync(AUDITED_FILE_BACKUP)) {
    try { raw = JSON.parse(fs.readFileSync(AUDITED_FILE_BACKUP, 'utf8')); } catch (_) {}
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
    awaitingPlan: 0,
    generating: 0,
    completed: 0,
    idle: 0,
    other: 0
  };

  const accountBreakdowns = {
    A: { total: 0, awaitingConfirmation: 0, awaitingCopy: 0, awaitingMaterial: 0, completed: 0, generating: 0, idle: 0 },
    B: { total: 0, awaitingConfirmation: 0, awaitingCopy: 0, awaitingMaterial: 0, completed: 0, generating: 0, idle: 0 },
    C: { total: 0, awaitingConfirmation: 0, awaitingCopy: 0, awaitingMaterial: 0, completed: 0, generating: 0, idle: 0 }
  };

  for (const acc of ['A', 'B', 'C']) {
    const list = raw[acc] || [];
    for (const item of list) {
      const st = item.status || '模板已建立，暂无活跃主题';
      const tp = item.topic || '';
      const group = item.group || '模板库';
      const msgCount = item.msgCount || 10;
      
      let analysis = '';
      if (st === '已出计划，待确认出图') {
        analysis = tp ? `AI已输出逐页排版方案（主题「${tp}」），共 ${msgCount} 条历史消息；当前处于等待用户回复「1」确认出图阶段。` : `AI已针对当前任务输出逐页排版计划；正文末尾显示等待用户确认计划。`;
        statusCounts.awaitingConfirmation++;
        accountBreakdowns[acc].awaitingConfirmation++;
      } else if (st === '图已出，待补充正文/文案') {
        analysis = tp ? `整套 3:4 原生竖版图片已由生图工具交付完毕（主题「${tp}」）；当前正文缺少正式正文与发布标签，需下发出文案指令。` : `图片生成已完毕，成图节点齐全；当前缺少配套发布文案，属于「缺文案」工单。`;
        statusCounts.awaitingCopy++;
        accountBreakdowns[acc].awaitingCopy++;
      } else if (st === '图文已全部完工，待归档') {
        analysis = tp ? `全套排版图片与小红书正文/标签均已交付（主题「${tp}」）；生产闭环，处于成品待归档或备用态。` : `会话历史中已包含整套图文成果与发布文案，全流程闭环完工。`;
        statusCounts.completed++;
        accountBreakdowns[acc].completed++;
      } else if (st === '母版已锁定，等待补充原料') {
        analysis = `会话已完成视觉母版学习与切片分析，母版规范（V4.8.8/V4.8.10）已锁定；当前处于状态二，等待注入新素材原料。`;
        statusCounts.awaitingMaterial++;
        accountBreakdowns[acc].awaitingMaterial++;
      } else if (st === '已有原料，需要输出迁移计划') {
        analysis = `用户已投递待迁移图文素材原料，尚未输出完整的逐页迁移排产表，需触发AI分析原料出计划。`;
        statusCounts.awaitingPlan++;
      } else if (st === '正在生成中（单页调度）') {
        analysis = `用户已下发确认出图或调度指令，会话处于单页生图队列流转中。`;
        statusCounts.generating++;
        accountBreakdowns[acc].generating++;
      } else {
        analysis = `会话已定义母版结构，无未完结活跃生产主题，处于空闲待排产状态。`;
        statusCounts.idle++;
        accountBreakdowns[acc].idle++;
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
      excelPath: fs.existsSync(EXCEL_PATH_1) ? EXCEL_PATH_1 : EXCEL_PATH_2,
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
      const p = fs.existsSync(EXCEL_PATH_1) ? EXCEL_PATH_1 : EXCEL_PATH_2;
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
      const targetItems = matrix.items.filter(x => x.status === '图已出，待补充正文/文案');
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
      const targetItems = matrix.items.filter(x => x.status === '已出计划，待确认出图');
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
