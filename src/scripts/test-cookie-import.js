// test-cookie-import.js
const { app, session } = require('electron');
const fs = require('fs');
const path = require('path');

const logFile = 'D:/AICode/运行数据/江湖有旅人/内容生产App/_SAFE_LOGIN_BACKUP_LIVE/import-test.log';
function log(msg) {
  fs.appendFileSync(logFile, msg + '\n');
}

app.whenReady().then(async () => {
  fs.writeFileSync(logFile, 'Start test\n');
  const sess = session.fromPartition('persist:test-cookie-import');
  const backupPath = 'D:/AICode/运行数据/江湖有旅人/内容生产App/_SAFE_LOGIN_BACKUP_LIVE/account-2-full-page-cookies.json';
  const cookies = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  log(`Loaded ${cookies.length} cookies from backup.`);
  let count = 0;
  for (const c of cookies) {
    const url = `https://${c.domain.startsWith('.') ? c.domain.slice(1) : c.domain}${c.path || '/'}`;
    try {
      await sess.cookies.set({
        url,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expires > 0 ? c.expires : undefined,
        sameSite: c.sameSite ? (c.sameSite === 'None' ? 'no_restriction' : c.sameSite.toLowerCase()) : undefined
      });
      count++;
    } catch (e) {
      log(`Failed to set cookie ${c.name}: ${e.message}`);
    }
  }
  log(`Successfully set ${count}/${cookies.length} cookies into test session.`);

  const verified = await sess.cookies.get({ domain: 'chatgpt.com' });
  log(`Verified ${verified.length} cookies retrieved from test session for chatgpt.com:`);
  log(JSON.stringify(verified.map(x => x.name)));

  app.quit();
});
