const fs = require('fs');
const file = 'D:/AICode/工具开发/projects/content-production-app/src/desktop/main.js';
let content = fs.readFileSync(file, 'utf8');

const target = `  const stealthPreloadPath = path.join(__dirname, "stealth-fingerprint.js");
  const fingerprintProfile = getFingerprintProfile(CONTENT_INSTANCE_ID);
  account.view = new WebContentsView({
    webPreferences: {
      partition: account.partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: stealthPreloadPath,
      additionalArguments: [
        \`--content-instance-id=\${CONTENT_INSTANCE_ID}\`,
        \`--fingerprint-config=\${encodeURIComponent(JSON.stringify(fingerprintProfile))}\`
      ],
      // Automatic production must continue while the workbench is minimized
      // to the tray. Chromium otherwise heavily throttles or suspends timers
      // in this hidden WebContentsView and the workflow appears stuck after 1.
      backgroundThrottling: false
    }
  });`;

const replacement = `  // 关键：账号登录状态无损保活与自动还原 (从安全凭证快照原子导入 Cookie Jar，确保账号不掉)
  try {
    const backupDir = "D:\\\\AICode\\\\运行数据\\\\江湖有旅人\\\\内容生产App\\\\_SAFE_LOGIN_BACKUP_LIVE";
    const cookieFile = path.join(backupDir, \`\${id}-full-page-cookies.json\`);
    if (fs.existsSync(cookieFile)) {
      const existingCookies = await account.session.cookies.get({ domain: "chatgpt.com" });
      if (existingCookies.length === 0) {
        const rawCookies = JSON.parse(fs.readFileSync(cookieFile, "utf8"));
        for (const c of rawCookies) {
          const url = \`https://\${c.domain.startsWith(".") ? c.domain.slice(1) : c.domain}\${c.path || "/"}\`;
          try {
            await account.session.cookies.set({
              url,
              name: c.name,
              value: c.value,
              domain: c.name.startsWith("__Host-") ? undefined : c.domain,
              path: c.path,
              secure: c.secure,
              httpOnly: c.httpOnly,
              expirationDate: c.expires > 0 ? c.expires : undefined,
              sameSite: c.sameSite ? (c.sameSite === "None" ? "no_restriction" : c.sameSite.toLowerCase()) : undefined
            });
          } catch (_) {}
        }
        appendDesktopLog("gpt-cookies-restored", \`\${id} (\${rawCookies.length} cookies)\`);
      }
    }
  } catch (err) {
    appendDesktopLog("gpt-cookies-restore-error", \`\${id} \${err.message}\`);
  }

  const stealthPreloadPath = path.join(__dirname, "stealth-fingerprint.js");
  const fingerprintProfile = getFingerprintProfile(id);
  account.view = new WebContentsView({
    webPreferences: {
      partition: account.partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: stealthPreloadPath,
      additionalArguments: [
        \`--content-instance-id=\${id}\`,
        \`--fingerprint-config=\${encodeURIComponent(JSON.stringify(fingerprintProfile))}\`
      ],
      // Automatic production must continue while the workbench is minimized
      // to the tray. Chromium otherwise heavily throttles or suspends timers
      // in this hidden WebContentsView and the workflow appears stuck after 1.
      backgroundThrottling: false
    }
  });`;

const normContent = content.replace(/\r\n/g, '\n');
const normTarget = target.replace(/\r\n/g, '\n');
const normReplacement = replacement.replace(/\r\n/g, '\n');

if (!normContent.includes(normTarget)) {
  console.error('Target not found in main.js');
  process.exit(1);
}

const updated = normContent.replace(normTarget, normReplacement).replace(/\n/g, '\r\n');
fs.writeFileSync(file, updated, 'utf8');
console.log('Successfully updated main.js with cookie restore & per-account fingerprint');
