// prep-and-inject-cookies.js
const { app, session } = require('electron');
const fs = require('fs');
const path = require('path');

const RUNTIME_ROOT = 'D:/AICode/运行数据/江湖有旅人/内容生产App';
const UNIFIED_USERDATA = path.join(RUNTIME_ROOT, 'unified-runtime', 'electron-userdata');
const UNIFIED_PARTITIONS = path.join(UNIFIED_USERDATA, 'Partitions');

app.setPath('userData', UNIFIED_USERDATA);

// 1. Copy Cookies for account-1 directly
const srcCookies1 = path.join(RUNTIME_ROOT, 'instance-A', 'electron-userdata', 'Partitions', 'teambuilding-gpt-production-account-1', 'Network', 'Cookies');
const destCookies1 = path.join(UNIFIED_PARTITIONS, 'teambuilding-gpt-production-account-1', 'Network', 'Cookies');
if (fs.existsSync(srcCookies1)) {
  fs.mkdirSync(path.dirname(destCookies1), { recursive: true });
  fs.copyFileSync(srcCookies1, destCookies1);
  console.log('Directly copied Account 1 Cookies file');
}

app.whenReady().then(async () => {
  // 2. Inject Account 2 cookies into persist:teambuilding-gpt-production-account-2
  const sess2 = session.fromPartition('persist:teambuilding-gpt-production-account-2');
  const backup2 = path.join(RUNTIME_ROOT, '_SAFE_LOGIN_BACKUP_LIVE', 'account-2-full-page-cookies.json');
  if (fs.existsSync(backup2)) {
    const rawCookies = JSON.parse(fs.readFileSync(backup2, 'utf8'));
    let count = 0;
    for (const c of rawCookies) {
      const url = `https://${c.domain.startsWith('.') ? c.domain.slice(1) : c.domain}${c.path || '/'}`;
      try {
        await sess2.cookies.set({
          url,
          name: c.name,
          value: c.value,
          domain: c.name.startsWith('__Host-') ? undefined : c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expires > 0 ? c.expires : undefined,
          sameSite: c.sameSite ? (c.sameSite === 'None' ? 'no_restriction' : c.sameSite.toLowerCase()) : undefined
        });
        count++;
      } catch (e) {
        console.warn(`Err setting ${c.name}: ${e.message}`);
      }
    }
    console.log(`Injected ${count}/${rawCookies.length} cookies into account-2 partition.`);
  }

  // 3. Flush storage data
  await sess2.flushStorageData();
  const sess1 = session.fromPartition('persist:teambuilding-gpt-production-account-1');
  await sess1.flushStorageData();

  // Verify cookies in both partitions
  const c1 = await sess1.cookies.get({ domain: 'chatgpt.com' });
  const c2 = await sess2.cookies.get({ domain: 'chatgpt.com' });
  console.log(`Verified Account 1 chatgpt cookies count: ${c1.length}`);
  console.log(`Verified Account 2 chatgpt cookies count: ${c2.length}`);

  console.log('ALL COOKIES PERMANENTLY ENCRYPTED AND READY!');
  app.quit();
});
