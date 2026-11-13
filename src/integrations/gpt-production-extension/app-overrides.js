// =====================================================================
// 内容制作 App 对 ChatGPT 作品助手的宿主定制层
// ---------------------------------------------------------------------
// 目的：让 vendor/chatgpt-conversation-tree.user.js 保持与上游完全一致，
//       所有 App 专属行为都写在这里，于是升级只需整文件替换 vendor。
//
// 必须在 vendor 脚本之前加载（manifest 的 js 顺序保证），
// 它只做一件事：把 window.__CGPT_APP_HOOKS__ 挂上去。
//
// 目前提供的钩子：
//   saveFile(url, name) -> Promise<boolean>
//     把图片交给本地工作台服务（默认 127.0.0.1:4327）落盘。
//     返回 true 表示已保存，脚本不再走浏览器下载；
//     返回 false / 抛错 时脚本自动回落自己的通道。
// =====================================================================
(() => {
  'use strict';

  const DEFAULT_API_ROOT = 'http://127.0.0.1:4327';
  const SAVE_ENDPOINT = '/api/extension/save-generated-image';
  const REQUEST_TIMEOUT = 60000;
  const DEFAULT_DOWNLOAD_ROOT = 'C:\\Users\\z\\Downloads';

  function resolveApiRoot() {
    try {
      const saved = String(localStorage.getItem('tb-workbench-api-root') || '').trim();
      if (/^http:\/\/127\.0\.0\.1:\d+$/.test(saved)) return saved;
    } catch {}
    return DEFAULT_API_ROOT;
  }

  function resolveDownloadRoot() {
    try {
      return String(localStorage.getItem('tb-manual-download-root') || DEFAULT_DOWNLOAD_ROOT);
    } catch {
      return DEFAULT_DOWNLOAD_ROOT;
    }
  }

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  async function saveViaWorkbench(url, name) {
    if (!url || !name) return false;
    let response;
    try {
      response = await withTimeout(
        fetch(url, { credentials: 'include', cache: 'no-store' }),
        REQUEST_TIMEOUT,
        '读取图片'
      );
    } catch (error) {
      console.warn('[App 直存] 读取图片失败：', error);
      return false;
    }
    if (!response.ok) {
      console.warn('[App 直存] 图片响应异常：HTTP', response.status);
      return false;
    }

    const contentType = String(response.headers.get('content-type') || 'image/png');
    if (!/^image\/(?:png|jpe?g|webp)$/i.test(contentType)) {
      console.warn('[App 直存] 响应类型不是图片，交回脚本处理：', contentType);
      return false;
    }

    let payload;
    try {
      payload = {
        filename: name,
        requestId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        contentType,
        data: bufferToBase64(await response.arrayBuffer()),
        sourceUrl: url,
        downloadRoot: resolveDownloadRoot(),
      };
    } catch (error) {
      console.warn('[App 直存] 编码图片失败：', error);
      return false;
    }

    try {
      const saveResponse = await withTimeout(
        fetch(`${resolveApiRoot()}${SAVE_ENDPOINT}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        REQUEST_TIMEOUT,
        '写入工作台'
      );
      const result = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok || !result?.ok || !result?.filename) {
        console.warn('[App 直存] 工作台拒绝保存：', result?.error || saveResponse.status);
        return false;
      }
      return true;
    } catch (error) {
      console.warn('[App 直存] 工作台不可用，交回脚本通道：', error);
      return false;
    }
  }

  try {
    globalThis.__CGPT_APP_HOOKS__ = Object.assign({}, globalThis.__CGPT_APP_HOOKS__, {
      saveFile: saveViaWorkbench,
      version: '1.0.0',
      appRoot: resolveApiRoot(),
    });
    // 暴露一个可观测标记，便于 CDP / 诊断确认覆盖层确实加载了
    document.documentElement.dataset.cgptAppHooks = '1.0.0';
  } catch (error) {
    console.warn('[App 直存] 注册钩子失败：', error);
  }
})();
