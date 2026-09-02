const DEFAULT_ELECTRON_PROXY = "http://127.0.0.1:7897";
const ELECTRON_PROXY_BYPASS_LIST = "localhost;127.0.0.1;[::1]";
const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks5:"]);

function resolveElectronProxy(value) {
  const raw = value === undefined || value === null
    ? DEFAULT_ELECTRON_PROXY
    : String(value).trim();

  if (!raw || /^(direct|off|none)$/i.test(raw)) {
    return Object.freeze({ enabled: false, proxyServer: "", proxyBypassList: ELECTRON_PROXY_BYPASS_LIST, error: "direct-mode" });
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return Object.freeze({ enabled: false, proxyServer: "", proxyBypassList: ELECTRON_PROXY_BYPASS_LIST, error: "invalid-proxy-url" });
  }

  if (!SUPPORTED_PROXY_PROTOCOLS.has(parsed.protocol)
    || !parsed.hostname
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password) {
    return Object.freeze({ enabled: false, proxyServer: "", proxyBypassList: ELECTRON_PROXY_BYPASS_LIST, error: "unsupported-proxy-url" });
  }

  return Object.freeze({ enabled: true, proxyServer: `${parsed.protocol}//${parsed.host}`, proxyBypassList: ELECTRON_PROXY_BYPASS_LIST, error: "" });
}

module.exports = { DEFAULT_ELECTRON_PROXY, ELECTRON_PROXY_BYPASS_LIST, resolveElectronProxy };
