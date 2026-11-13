const path = require("node:path");

function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveAuthorizedDownloadRoot(requestedRoot, options = {}) {
  const defaultRoot = path.resolve(String(options.defaultRoot || "").trim());
  const configuredValue = String(options.configuredRoot || "").trim();
  const configuredRoots = configuredValue
    ? configuredValue.split(";").map((p) => p.trim()).filter(Boolean).map((p) => path.resolve(p))
    : [];
  const requestedValue = String(requestedRoot || "").trim();
  const targetRoot = requestedValue ? path.resolve(requestedValue) : (configuredRoots[0] || defaultRoot);
  const authorizedRoots = [...new Set([defaultRoot, ...configuredRoots].filter(Boolean))];
  if (!authorizedRoots.some((root) => isPathInside(root, targetRoot))) {
    throw new Error("下载目录未获授权；只能使用工作台默认目录或打包程序已配置的图片目录");
  }
  return targetRoot;
}

module.exports = {
  resolveAuthorizedDownloadRoot
};
