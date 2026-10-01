// [2026-09-25 修] 代理端口自动探测（根治"Clash 换端口 -> 整条产线瘫痪"）：
// 09-23 把 7897 改到 7890，09-25 Clash 又只听 7897 -> 7890 连接失败 -> ChatGPT 页面
// 全部 ERR_PROXY_CONNECTION_FAILED，A/B 双实例当天停产。每次靠人肉改配置太脆弱，
// 现在启动时按优先级探测本机端口，谁活着用谁；探测失败再退回原值（行为不劣于旧版）。
const { spawnSync } = require("child_process");

const DEFAULT_ELECTRON_PROXY = "http://127.0.0.1:7890";
const ELECTRON_PROXY_BYPASS_LIST = "localhost;127.0.0.1;[::1]";
const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks5:"]);
// 本机 Clash 系（Clash Party / mihomo / verge）历史上出现过的混合端口，按新旧优先级排列
const LOCAL_PROXY_FALLBACK_PORTS = [7897, 7890, 7891, 7892];

let cachedLivePort = null;

// 同步探测：electron 主进程模块加载期需要同步拿到代理配置（proxy-server switch 必须在 app ready 前注册），
// 所以用 spawnSync 跑一次性 node 探针；探测失败/超时/被禁一律退回原端口，绝不阻塞启动超过 6 秒。
function probeFirstLiveLocalProxyPort(preferredPort) {
  if (cachedLivePort) return cachedLivePort;
  const ports = [...new Set([preferredPort, ...LOCAL_PROXY_FALLBACK_PORTS])].filter(
    (p) => Number.isInteger(p) && p > 0 && p < 65536
  );
  if (!ports.length) return null;
  try {
    const probeScript = `const net=require("net");const ports=${JSON.stringify(ports)};
(async()=>{for(const p of ports){const ok=await new Promise(res=>{const s=net.connect({port:p,host:"127.0.0.1"});s.setTimeout(500,()=>{s.destroy();res(null)});s.on("connect",()=>{s.destroy();res(p)});s.on("error",()=>res(null))});if(ok){console.log(String(ok));process.exit(0)}}process.exit(1)})();`;
    const result = spawnSync(process.execPath, ["-e", probeScript], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 6000,
      encoding: "utf8"
    });
    if (result.status === 0) {
      const port = parseInt(String(result.stdout || "").trim(), 10);
      if (Number.isInteger(port) && port > 0) {
        cachedLivePort = port;
        return port;
      }
    }
  } catch (_) {
    // 探测环境异常（如测试沙箱禁 spawn）：静默退回原端口
  }
  return null;
}

function resolveElectronProxy(value) {
  const raw = value === undefined || value === null
    ? DEFAULT_ELECTRON_PROXY
    : String(value).trim();

  if (!raw || /^(direct|off|none)$/i.test(raw)) {
    return Object.freeze({
      enabled: false,
      proxyServer: "",
      proxyBypassList: ELECTRON_PROXY_BYPASS_LIST,
      error: "direct-mode"
    });
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return Object.freeze({
      enabled: false,
      proxyServer: "",
      proxyBypassList: ELECTRON_PROXY_BYPASS_LIST,
      error: "invalid-proxy-url"
    });
  }

  if (!SUPPORTED_PROXY_PROTOCOLS.has(parsed.protocol)
    || !parsed.hostname
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password) {
    return Object.freeze({
      enabled: false,
      proxyServer: "",
      proxyBypassList: ELECTRON_PROXY_BYPASS_LIST,
      error: "unsupported-proxy-url"
    });
  }

  // 仅对本机回环代理做端口探测；远程代理无法安全探测，保持原值
  const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  const requestedPort = parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
  let effectivePort = requestedPort;
  let probeNote = "";
  if (isLoopback) {
    const livePort = probeFirstLiveLocalProxyPort(requestedPort);
    if (livePort && livePort !== requestedPort) {
      effectivePort = livePort;
      probeNote = `requested-port-${requestedPort}-dead-fallback-to-${livePort}`;
    }
  }

  return Object.freeze({
    enabled: true,
    proxyServer: `${parsed.protocol}//${parsed.hostname}:${effectivePort}`,
    proxyBypassList: ELECTRON_PROXY_BYPASS_LIST,
    error: probeNote
  });
}

module.exports = {
  DEFAULT_ELECTRON_PROXY,
  ELECTRON_PROXY_BYPASS_LIST,
  resolveElectronProxy
};
