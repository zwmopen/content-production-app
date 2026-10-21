// dump-all-target-cookies.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('D:/AICode/工具开发/projects/content-production-app/src/node_modules/undici').WebSocket || globalThis.WebSocket;

async function getBrowserWsUrl(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.webSocketDebuggerUrl);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function dumpTargetCookies(port, outFile) {
  const wsUrl = await getBrowserWsUrl(port);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Network.getCookies',
        params: { urls: ['https://chatgpt.com', 'https://openai.com', 'https://auth0.openai.com'] }
      }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === 1) {
          const cookies = msg.result?.cookies || [];
          console.log(`Port ${port} Network.getCookies count: ${cookies.length}`);
          fs.writeFileSync(outFile, JSON.stringify(cookies, null, 2), 'utf8');
          ws.close();
          resolve(cookies);
        }
      } catch (err) {
        reject(err);
      }
    };
    ws.onerror = (err) => reject(err);
  });
}

async function main() {
  const outDir = 'D:/AICode/运行数据/江湖有旅人/内容生产App/_SAFE_LOGIN_BACKUP_LIVE';
  await dumpTargetCookies(9431, path.join(outDir, 'account-1-chatgpt-cookies.json'));
  await dumpTargetCookies(9432, path.join(outDir, 'account-2-chatgpt-cookies.json'));
}

main().catch(console.error);
