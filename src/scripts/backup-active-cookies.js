// backup-active-cookies.js
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

async function dumpCookiesFromCdp(port, outFile) {
  const wsUrl = await getBrowserWsUrl(port);
  console.log(`Connecting to CDP port ${port}: ${wsUrl}`);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      // Send Storage.getCookies
      ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === 1) {
          const cookies = msg.result?.cookies || [];
          console.log(`Port ${port}: captured ${cookies.length} cookies.`);
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
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  try {
    await dumpCookiesFromCdp(9431, path.join(outDir, 'account-1-cookies.json'));
    console.log('Account 1 cookies saved!');
  } catch (e) {
    console.error('Account 1 backup error:', e.message);
  }

  try {
    await dumpCookiesFromCdp(9432, path.join(outDir, 'account-2-cookies.json'));
    console.log('Account 2 cookies saved!');
  } catch (e) {
    console.error('Account 2 backup error:', e.message);
  }
}

main().catch(console.error);
