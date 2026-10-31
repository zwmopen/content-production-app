'use strict';

const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '../prompts');

function loadPrompts() {
  const v488Path = path.join(PROMPTS_DIR, 'v4.8.8.txt');
  const step1Path = path.join(PROMPTS_DIR, 'step1_material_dispatch.txt');
  const step2Path = path.join(PROMPTS_DIR, 'step2_confirm_plan.txt');
  const step3Path = path.join(PROMPTS_DIR, 'step3_copywriting.txt');

  return {
    v488: fs.existsSync(v488Path) ? fs.readFileSync(v488Path, 'utf8') : '',
    step1: fs.existsSync(step1Path) ? fs.readFileSync(step1Path, 'utf8') : '',
    step2: fs.existsSync(step2Path) ? fs.readFileSync(step2Path, 'utf8') : '',
    step3: fs.existsSync(step3Path) ? fs.readFileSync(step3Path, 'utf8') : ''
  };
}

async function getChatGptTabs(port = 9431) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const list = await res.json();
    return list.filter(t => t.type === 'page' && typeof t.url === 'string' && t.url.includes('chatgpt.com'));
  } catch (err) {
    return [];
  }
}

async function executeCdpCommand(debuggerUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    let closed = false;
    const timer = setTimeout(() => {
      if (closed) return;
      closed = true;
      try { ws.close(); } catch (_) {}
      reject(new Error(`CDP command timeout: ${method}`));
    }, 8000);

    const ws = new WebSocket(debuggerUrl);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
    ws.addEventListener('message', (event) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      try {
        const data = JSON.parse(String(event.data));
        ws.close();
        if (data.error) reject(new Error(data.error.message || 'CDP Error'));
        else resolve(data.result);
      } catch (err) {
        ws.close();
        reject(err);
      }
    });
    ws.addEventListener('error', (err) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function sendPromptToChatGpt(options = {}) {
  const { targetId, promptText, files = [], port = 9431 } = options;
  const tabs = await getChatGptTabs(port);
  if (!tabs.length) {
    return { ok: false, error: '未找到运行中的 ChatGPT 网页标签页' };
  }

  let targetTab = null;
  if (targetId) {
    targetTab = tabs.find(t => t.id === targetId);
  }
  if (!targetTab) {
    targetTab = tabs[0];
  }

  const wsUrl = targetTab.webSocketDebuggerUrl;
  if (!wsUrl) {
    return { ok: false, error: '目标标签页未暴露调试 WebSocket 地址' };
  }

  // 1. 如果有待上传文件，通过 DOM.describeNode 获取 backendNodeId 后调用 DOM.setFileInputFiles
  if (Array.isArray(files) && files.length > 0) {
    try {
      await executeCdpCommand(wsUrl, 'DOM.enable');
      const evalInputRes = await executeCdpCommand(wsUrl, 'Runtime.evaluate', {
        expression: "document.querySelector('input[type=\"file\"]')",
        returnByValue: false
      });
      const objectId = evalInputRes?.result?.objectId;
      if (objectId) {
        const descRes = await executeCdpCommand(wsUrl, 'DOM.describeNode', { objectId });
        const backendNodeId = descRes?.node?.backendNodeId;
        if (backendNodeId) {
          await executeCdpCommand(wsUrl, 'DOM.setFileInputFiles', { backendNodeId, files });
          // 等待文件上传解析
          await new Promise(r => setTimeout(r, 2500));
        }
      }
    } catch (uploadErr) {
      console.warn('[production-prompt-service] Upload files warning:', uploadErr.message);
    }
  }

  // 2. 聚焦输入框并注入提示词文本（支持现代 ProseMirror 与传统 #prompt-textarea）
  try {
    const focusRes = await executeCdpCommand(wsUrl, 'Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.ProseMirror, #prompt-textarea, [contenteditable="true"]');
        if (!el) return { ok: false, error: '未找到输入框' };
        el.focus();
        return { ok: true };
      })()`,
      returnByValue: true
    });

    if (focusRes?.result?.value?.ok && promptText) {
      await executeCdpCommand(wsUrl, 'Input.insertText', { text: promptText });
      await new Promise(r => setTimeout(r, 400));
    }

    // 3. 点击发送按钮或触发回车
    const sendRes = await executeCdpCommand(wsUrl, 'Runtime.evaluate', {
      expression: `(() => {
        const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"]');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          return { ok: true, method: 'button-click' };
        }
        const el = document.querySelector('.ProseMirror, #prompt-textarea, [contenteditable="true"]');
        if (el) {
          const enterEvt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
          el.dispatchEvent(enterEvt);
          return { ok: true, method: 'enter-event' };
        }
        return { ok: false, error: '未找到发送按钮' };
      })()`,
      returnByValue: true
    });

    return {
      ok: true,
      tabId: targetTab.id,
      tabTitle: targetTab.title,
      details: sendRes?.result?.value
    };
  } catch (evalErr) {
    return { ok: false, error: `注入指令失败: ${evalErr.message}` };
  }
}

async function getLatestConversationState(options = {}) {
  const { targetId, port = 9431 } = options;
  const tabs = await getChatGptTabs(port);
  if (!tabs.length) return { ok: false, error: '未找到 ChatGPT 标签页' };

  const targetTab = targetId ? tabs.find(t => t.id === targetId) : tabs[0];
  if (!targetTab?.webSocketDebuggerUrl) return { ok: false, error: '无有效 WebSocket' };

  const readScript = `(() => {
    const isGenerating = Boolean(document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]'));
    const mainText = document.querySelector('main')?.innerText || '';
    
    // 检查是否包含显性计划与等待确认状态
    const hasPlan = mainText.includes('逐页迁移计划') || mainText.includes('显性逐页迁移计划') || mainText.includes('阶段一｜素材读取与显性迁移计划');
    const waitingForConfirm = mainText.includes('回复「1」') || mainText.includes('回复 "1"') || mainText.includes('回复 1') || mainText.includes('等待你回复') || mainText.includes('等待我回复');
    
    // 提取最后 3000 字
    const lastText = mainText.slice(-3000);
    
    // 提取所有图片
    const imgEls = Array.from(document.querySelectorAll('main img[src^="http"], main img[src^="blob:"]'));
    const images = imgEls.filter(img => !img.src.includes('avatar') && !img.alt.includes('avatar') && (img.width > 80 || img.naturalWidth > 80)).map(i => i.src);

    return {
      isGenerating,
      hasPlan,
      waitingForConfirm,
      lastText,
      images: Array.from(new Set(images))
    };
  })()`;

  try {
    const evalRes = await executeCdpCommand(targetTab.webSocketDebuggerUrl, 'Runtime.evaluate', {
      expression: readScript,
      returnByValue: true
    });
    return { ok: true, state: evalRes?.result?.value };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  loadPrompts,
  getChatGptTabs,
  sendPromptToChatGpt,
  getLatestConversationState
};
