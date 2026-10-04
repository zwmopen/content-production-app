const http = require("http");
const cdpViewportService = require("./cdp-viewport-service");

const GATEWAY_PORT = Number(process.env.CDP_GATEWAY_PORT || 9433);

const server = http.createServer((req, res) => {
  // Add CORS headers so webview / container / iframe can call from 4332 or anywhere
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = requestUrl.pathname;
  const parsed = {
    pathname,
    query: Object.fromEntries(requestUrl.searchParams.entries())
  };

  // Route directly using cdpViewportService
  // Standardize /frame -> /api/cdp/frame
  let normalizedPath = pathname;
  if (!normalizedPath.startsWith("/api/cdp")) {
    normalizedPath = `/api/cdp${normalizedPath.startsWith("/") ? "" : "/"}${normalizedPath}`;
  }

  cdpViewportService.handleRoute(req, res, normalizedPath, parsed).catch(err => {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(GATEWAY_PORT, "127.0.0.1", () => {
  console.log(`[CDP Gateway] Live on http://127.0.0.1:${GATEWAY_PORT}`);
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.log(`[CDP Gateway] Port ${GATEWAY_PORT} already in use, running.`);
  } else {
    console.error(`[CDP Gateway] Error:`, err);
  }
});

module.exports = server;
