'use strict';

const http = require('node:http');
const { WebSocket } = require('undici');
const PORTS = new Set([9431, 9432, 9433, 9434]);
const PREVIEW_PORT = 9440;

function allowedOrigin(origin) {
  return !origin || /^http:\/\/127\.0\.0\.1:(433[1-4]|9440)$/.test(origin);
}

async function findTarget(port) {
  if (!PORTS.has(port)) throw new Error('实例端口无效');
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1800) });
  if (!response.ok) throw new Error('实例调试服务不可用');
  const targets = await response.json();
  const target = targets.find(t => t.type === 'page' && /^https:\/\/chatgpt\.com(?:\/|$)/.test(t.url || ''));
  if (!target) throw new Error('实例已启动，但没有打开 ChatGPT 网页');
  if (!new RegExp(`^ws://127\\.0\\.0\\.1:${port}/`).test(target.webSocketDebuggerUrl || '')) throw new Error('实例调试地址无效');
  return target;
}

function callTarget(target, commands, Socket = WebSocket) {
  return new Promise((resolve, reject) => {
    const ws = new Socket(target.webSocketDebuggerUrl);
    let index = 0;
    let closed = false;
    let connected = false;
    const timer = setTimeout(() => finish(new Error(connected ? '实例已连接，但画面没有返回（请用独立窗口检查网页）' : '实例画面通道连接超时')), 5000);
    function finish(error, value) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      ws.close();
      error ? reject(error) : resolve(value);
    }
    function sendNext() {
      const command = commands[index];
      ws.send(JSON.stringify({ id: index + 1, method: command.method, params: command.params || {} }));
    }
    ws.addEventListener('open', () => { connected = true; sendNext(); });
    ws.addEventListener('error', () => finish(new Error('实例画面连接失败')));
    ws.addEventListener('close', () => { if (!closed) finish(new Error('实例画面连接已断开')); });
    ws.addEventListener('message', event => {
      let result;
      try { result = JSON.parse(String(event.data)); } catch { return; }
      if (result.id !== index + 1) return;
      if (result.error) return finish(new Error(result.error.message));
      index += 1;
      if (index < commands.length) sendNext(); else finish(null, result.result);
    });
  });
}

function inputCommands(body) {
  if (body.type === 'text') {
    if (typeof body.text !== 'string' || body.text.length > 4000) throw new Error('文本无效');
    return [{ method: 'Input.insertText', params: { text: body.text } }];
  }
  if (body.type === 'key') {
    const codes = { Enter: 13, Backspace: 8, Delete: 46, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35 };
    if (!codes[body.key]) throw new Error('按键无效');
    return ['keyDown', 'keyUp'].map(type => ({ method: 'Input.dispatchKeyEvent', params: { type, key: body.key, windowsVirtualKeyCode: codes[body.key], modifiers: body.shift ? 8 : 0 } }));
  }
  const x = Number(body.x), y = Number(body.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 20000 || y > 20000) throw new Error('坐标无效');
  if (body.type === 'click') return ['mousePressed', 'mouseReleased'].map(type => ({ method: 'Input.dispatchMouseEvent', params: { type, x, y, button: 'left', clickCount: 1 } }));
  if (body.type === 'wheel') return [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x, y, deltaX: 0, deltaY: Math.max(-1200, Math.min(1200, Number(body.deltaY) || 0)) } }];
  throw new Error('不支持的交互');
}

function createPreviewServer({ getTarget = findTarget, call = callTarget } = {}) {
  return http.createServer(async (req, res) => {
    if (!allowedOrigin(req.headers.origin) || req.headers.host !== `127.0.0.1:${PREVIEW_PORT}`) {
      res.writeHead(403).end('Forbidden'); return;
    }
    if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'X-Viewport-Width, X-Viewport-Height');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PREVIEW_PORT}`);
      if (!['/frame', '/status', '/input', '/activate', '/action'].includes(url.pathname)) { res.writeHead(404).end(); return; }
      if (['/frame', '/status'].includes(url.pathname) && req.method !== 'GET' || ['/input', '/activate', '/action'].includes(url.pathname) && req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw new Error('请求过大'); }
        body = raw ? JSON.parse(raw) : {};
      }
      const port = Number(body.port || url.searchParams.get('port'));
      const target = await getTarget(port);
      if (url.pathname === '/frame') {
        const layout = await call(target, [{ method: 'Page.getLayoutMetrics' }]);
        const viewport = layout?.cssLayoutViewport || layout?.layoutViewport;
        const commands = [];
        // A detached native WebContentsView has no drawable viewport. Provide a display
        // viewport for the local preview instead of activating or navigating the production window.
        if (!viewport?.clientWidth || !viewport?.clientHeight) commands.push({ method: 'Emulation.setDeviceMetricsOverride', params: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false } });
        commands.push({ method: 'Page.captureScreenshot', params: { format: 'jpeg', quality: 80, fromSurface: true, captureBeyondViewport: false } });
        const frame = await call(target, commands);
        if (!frame?.data) throw new Error('实例未返回画面');
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'X-Viewport-Width': viewport?.clientWidth || 1280,
          'X-Viewport-Height': viewport?.clientHeight || 800 }).end(Buffer.from(frame.data, 'base64')); return;
      }
      if (url.pathname === '/input') await call(target, inputCommands(body));
      if (url.pathname === '/activate') await call(target, [{ method: 'Page.bringToFront' }]);
      if (url.pathname === '/action') {
        if (body.action === 'reload') await call(target, [{ method: 'Page.reload' }]);
        else if (body.action === 'home') await call(target, [{ method: 'Page.navigate', params: { url: 'https://chatgpt.com/' } }]);
        else if (['back', 'forward'].includes(body.action)) {
          const history = await call(target, [{ method: 'Page.getNavigationHistory' }]);
          const entry = history.entries?.[history.currentIndex + (body.action === 'back' ? -1 : 1)];
          if (entry) await call(target, [{ method: 'Page.navigateToHistoryEntry', params: { entryId: entry.id } }]);
        } else throw new Error('不支持的导航操作');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, instance: String.fromCharCode(65 + port - 9431), target: { title: target.title, url: target.url } }));
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
}

if (require.main === module) {
  const server = createPreviewServer();
  server.on('error', error => { if (error.code === 'EADDRINUSE') process.exit(0); else { console.error(error.message); process.exitCode = 1; } });
  server.listen(PREVIEW_PORT, '127.0.0.1', () => console.log(`CDP preview listening on ${PREVIEW_PORT}`));
}
module.exports = { PREVIEW_PORT, allowedOrigin, findTarget, callTarget, inputCommands, createPreviewServer };
