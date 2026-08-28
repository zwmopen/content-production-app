const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EnvHttpProxyAgent, fetch: undiciFetch } = require("undici");

const LIFE_GAME_EXE = "D:\\AICode\\工具开发\\projects\\人生游戏管理系统\\electron\\release\\win-unpacked\\人生游戏系统.exe";
const LIFE_GAME_DEBUG_URL = "http://127.0.0.1:9334/json";
const DEFAULT_URL = "https://dav.jianguoyun.com/dav/";
const proxyDispatcher = (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY)
  ? new EnvHttpProxyAgent()
  : null;

function networkFetch(input, options = {}) {
  return undiciFetch(input, proxyDispatcher ? { ...options, dispatcher: proxyDispatcher } : options);
}

const dpapiProtectScript = [
  "Add-Type -AssemblyName System.Security",
  "$encoded = [Console]::In.ReadToEnd()",
  "$bytes = [Convert]::FromBase64String($encoded)",
  "$encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Convert]::ToBase64String($encrypted)"
].join("; ");

const dpapiUnprotectScript = [
  "Add-Type -AssemblyName System.Security",
  "$encoded = [Console]::In.ReadToEnd()",
  "$bytes = [Convert]::FromBase64String($encoded)",
  "$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Convert]::ToBase64String($plain)"
].join("; ");

const POWERSHELL_EXE = (() => {
  // powershell.exe is not always in PATH (e.g. when spawned from Node test
  // runner or Electron).  Resolve the full path from the System32 location.
  const sysRoot = process.env.SystemRoot || "C:\\Windows";
  const full = path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return fs.existsSync(full) ? full : "powershell.exe";
})();

function powershellWithInput(script, input) {
  const result = childProcess.spawnSync(POWERSHELL_EXE, [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ], {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim();
    throw new Error(`Windows 安全存储不可用${detail ? `：${detail}` : ""}`);
  }
  return String(result.stdout || "").trim();
}

function saveSecureConfig(filePath, config) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const plainBase64 = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  const encrypted = powershellWithInput(dpapiProtectScript, plainBase64);
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    protection: "windows-current-user",
    encrypted
  }, null, 2), "utf8");
}

function saveManualConfig(filePath, input = {}) {
  const url = String(input.url || DEFAULT_URL).trim();
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("坚果云 WebDAV 地址格式不正确"); }
  if (parsed.protocol !== "https:") throw new Error("坚果云 WebDAV 必须使用 HTTPS");
  const username = String(input.username || "").trim();
  const password = String(input.password || "");
  if (!username || !password) throw new Error("请填写坚果云账号和应用密码");
  const normalized = {
    url: parsed.toString(),
    username,
    password,
    basePath: String(input.basePath || "/团建工作台备份").trim().slice(0, 300),
    importedFrom: "团建工作台本机安全设置",
    importedAt: new Date().toISOString()
  };
  saveSecureConfig(filePath, normalized);
  return normalized;
}

function readSecureConfig(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const container = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!container?.encrypted) return null;
  const plainBase64 = powershellWithInput(dpapiUnprotectScript, container.encrypted);
  return JSON.parse(Buffer.from(plainBase64, "base64").toString("utf8"));
}

function evpBytesToKey(password, salt, keyLength = 32, ivLength = 16) {
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < keyLength + ivLength) {
    block = crypto.createHash("md5").update(Buffer.concat([block, Buffer.from(password), salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  return { key: derived.subarray(0, keyLength), iv: derived.subarray(keyLength, keyLength + ivLength) };
}

function decryptCryptoJs(cipherText, password) {
  const payload = Buffer.from(cipherText, "base64");
  if (payload.subarray(0, 8).toString("ascii") !== "Salted__") throw new Error("人生游戏配置格式无法识别");
  const salt = payload.subarray(8, 16);
  const { key, iv } = evpBytesToKey(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(payload.subarray(16)), decipher.final()]).toString("utf8");
}

async function waitForDebugTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await networkFetch(LIFE_GAME_DEBUG_URL).then((response) => response.json());
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // The life-game app may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("没有连接到人生游戏系统，请先确认它能正常启动");
}

async function readLifeGameLocalStorage() {
  let target;
  try {
    target = await waitForDebugTarget();
  } catch {
    if (!fs.existsSync(LIFE_GAME_EXE)) throw new Error("没有找到人生游戏系统");
    childProcess.spawn(LIFE_GAME_EXE, ["--remote-debugging-port=9334"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    target = await waitForDebugTarget();
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const result = await new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      if (message.error || message.result?.exceptionDetails) reject(new Error("人生游戏配置读取失败"));
      else resolve(message.result.result.value);
    });
    socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `JSON.stringify({
          deviceId: localStorage.getItem("_device_id"),
          encrypted: localStorage.getItem("webdav-config"),
          legacyUrl: localStorage.getItem("webdav-url"),
          legacyUsername: localStorage.getItem("webdav-username"),
          legacyPassword: localStorage.getItem("webdav-password")
        })`,
        returnByValue: true
      }
    }));
  });
  socket.close();
  return JSON.parse(result);
}

async function importLifeGameConfig(configFile) {
  const stored = await readLifeGameLocalStorage();
  let config;
  if (stored.encrypted && stored.deviceId) {
    const key = crypto.pbkdf2Sync(stored.deviceId, "life_game_system", 1000, 32, "sha256").toString("hex");
    config = JSON.parse(decryptCryptoJs(stored.encrypted, key));
  } else if (stored.legacyUsername && stored.legacyPassword) {
    config = {
      url: stored.legacyUrl || DEFAULT_URL,
      username: stored.legacyUsername,
      password: stored.legacyPassword,
      basePath: ""
    };
  }
  if (!config?.username || !config?.password) throw new Error("人生游戏系统里没有可用的坚果云配置");
  const normalized = {
    url: config.url || DEFAULT_URL,
    username: config.username,
    password: config.password,
    basePath: config.basePath || "/人生游戏管理系统",
    importedFrom: "人生游戏系统",
    importedAt: new Date().toISOString()
  };
  saveSecureConfig(configFile, normalized);
  return normalized;
}

function webdavUrl(config, remotePath = "") {
  const base = new URL(config.url || DEFAULT_URL);
  const clean = [config.basePath || "", "团建内容工作台", remotePath]
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/${clean}`;
  return base.toString();
}

function authHeaders(config, extra = {}) {
  return {
    Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
    ...extra
  };
}

async function testConnection(config) {
  const response = await networkFetch(config.url || DEFAULT_URL, {
    method: "PROPFIND",
    headers: authHeaders(config, { Depth: "0" })
  });
  if (![200, 207].includes(response.status)) throw new Error(`坚果云连接失败（${response.status}）`);
  return true;
}

async function ensureRemoteCollections(config) {
  return ensureRemotePath(config, "");
}

async function ensureRemotePath(config, remotePath = "") {
  const parts = [config.basePath || "", "团建内容工作台", remotePath]
    .join("/")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    const base = new URL(config.url || DEFAULT_URL);
    base.pathname = `${base.pathname.replace(/\/+$/, "")}${current}`;
    const response = await networkFetch(base, { method: "MKCOL", headers: authHeaders(config) });
    if (![200, 201, 204, 301, 405].includes(response.status)) {
      throw new Error(`无法建立坚果云备份目录（${response.status}）`);
    }
  }
}

function largeUploadErrorMessage(status) {
  if (Number(status) === 403) {
    return "坚果云拒绝上传（403）：可能已达到云端上传流量/空间额度，或当前目录无写入权限；已上传清单会保留，可在额度恢复后继续";
  }
  if (Number(status) === 507) {
    return "坚果云空间不足（507）：已上传清单会保留，释放空间后可以继续";
  }
  return `坚果云大文件上传失败（${status}）`;
}

async function uploadFile(config, localPath, remotePath) {
  const stats = fs.statSync(localPath);
  if (!stats.isFile()) throw new Error("大文件备份来源不是文件");
  await ensureRemotePath(config, path.posix.dirname(String(remotePath).replace(/\\/g, "/")));
  const response = await networkFetch(webdavUrl(config, remotePath), {
    method: "PUT",
    headers: authHeaders(config, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stats.size)
    }),
    body: fs.createReadStream(localPath),
    duplex: "half"
  });
  if (![200, 201, 204].includes(response.status)) {
    throw new Error(largeUploadErrorMessage(response.status));
  }
  return { size: stats.size, remotePath };
}

async function uploadBackup(config, payload, fileName) {
  await ensureRemoteCollections(config);
  const body = JSON.stringify(payload, null, 2);
  for (const target of [fileName, "latest.json"]) {
    const response = await networkFetch(webdavUrl(config, target), {
      method: "PUT",
      headers: authHeaders(config, { "Content-Type": "application/json; charset=utf-8" }),
      body
    });
    if (![200, 201, 204].includes(response.status)) throw new Error(`坚果云上传失败（${response.status}）`);
  }
}

async function downloadBackup(config, fileName = "latest.json") {
  const response = await networkFetch(webdavUrl(config, fileName), {
    method: "GET",
    headers: authHeaders(config, { Accept: "application/json" })
  });
  if (response.status === 404) throw new Error("云端还没有可恢复的团建工作台备份");
  if (!response.ok) throw new Error(`坚果云备份读取失败（${response.status}）`);
  const payload = await response.json();
  if (payload?.schema !== "teambuilding-workbench-backup-v1" || !payload.records) {
    throw new Error("云端最新文件不是可识别的团建工作台备份");
  }
  return payload;
}

function publicStatus(config, metadata = {}) {
  if (!config) return { configured: false, provider: "坚果云 WebDAV", ...metadata };
  const [name, domain = ""] = String(config.username).split("@");
  const masked = name ? `${name.slice(0, 2)}***${domain ? `@${domain}` : ""}` : "已配置";
  return {
    configured: true,
    provider: "坚果云 WebDAV",
    account: masked,
    basePath: `${config.basePath || ""}/团建内容工作台`.replace(/\/+/g, "/"),
    importedFrom: config.importedFrom || "本机配置",
    ...metadata
  };
}

module.exports = {
  downloadBackup,
  ensureRemotePath,
  importLifeGameConfig,
  publicStatus,
  readSecureConfig,
  saveManualConfig,
  saveSecureConfig,
  testConnection,
  uploadBackup,
  uploadFile,
  largeUploadErrorMessage
};
