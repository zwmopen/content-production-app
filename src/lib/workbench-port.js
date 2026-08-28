function classifyWorkbenchPortProbe({ statusCode, errorCode, timedOut } = {}) {
  if (statusCode === 200) return "ready";
  if (Number.isInteger(statusCode)) return "occupied";
  if (timedOut) return "unknown";
  if (errorCode === "ECONNREFUSED" || errorCode === "ECONNRESET") return "free";
  return "unknown";
}

function formatPortInUseMessage(port) {
  return `本地工作台端口 ${port} 已被其他服务占用，请关闭占用该端口的程序后再启动图文工作台。`;
}

module.exports = {
  classifyWorkbenchPortProbe,
  formatPortInUseMessage
};
