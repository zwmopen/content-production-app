const fs = require("node:fs");

const DEFAULT_REPOSITORY_CONFIG = {
  schemaVersion: 1,
  repository: {
    id: "template-repository",
    name: "图文模板仓库",
    mode: "ai-maintained",
    description: "跨项目、跨平台沉淀可复用的内容模板结构与视觉规则"
  },
  defaultScope: {
    projectId: "default-project",
    projectName: "默认项目",
    platformId: "other",
    platformName: "其他平台",
    categoryId: "all",
    categoryName: "全部"
  },
  projects: [],
  platforms: [],
  categories: [{ id: "all", name: "全部", status: "active" }],
  automation: {
    intake: "ai-first",
    manualEntry: false,
    autoDownload: true,
    autoAnalyze: true,
    autoTag: true,
    autoSync: true,
    sourceOfTruth: "local-template-folders-and-template-json"
  }
};

function mergeConfig(base, value) {
  if (Array.isArray(base)) return Array.isArray(value) ? value : base;
  if (base && typeof base === "object") {
    const next = { ...base };
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, item]) => {
        next[key] = key in next ? mergeConfig(next[key], item) : item;
      });
    }
    return next;
  }
  return value === undefined ? base : value;
}

function normalizeItems(items, fallback = []) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return source
    .filter((item) => item && item.id && item.name)
    .map((item) => ({ ...item, id: String(item.id), name: String(item.name) }));
}

function readTemplateRepositoryConfig(filePath = "") {
  let value = {};
  if (filePath && fs.existsSync(filePath)) {
    try { value = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { value = {}; }
  }
  const config = mergeConfig(DEFAULT_REPOSITORY_CONFIG, value);
  config.repository = { ...DEFAULT_REPOSITORY_CONFIG.repository, ...(config.repository || {}) };
  config.defaultScope = { ...DEFAULT_REPOSITORY_CONFIG.defaultScope, ...(config.defaultScope || {}) };
  config.projects = normalizeItems(config.projects);
  config.platforms = normalizeItems(config.platforms);
  config.categories = normalizeItems(config.categories, DEFAULT_REPOSITORY_CONFIG.categories);
  config.automation = { ...DEFAULT_REPOSITORY_CONFIG.automation, ...(config.automation || {}) };
  return config;
}

function normalizeScope(scope = {}, config = DEFAULT_REPOSITORY_CONFIG) {
  const fallback = config.defaultScope || DEFAULT_REPOSITORY_CONFIG.defaultScope;
  return {
    projectId: String(scope.projectId || fallback.projectId || "default-project"),
    projectName: String(scope.projectName || fallback.projectName || "默认项目"),
    platformId: String(scope.platformId || fallback.platformId || "other"),
    platformName: String(scope.platformName || fallback.platformName || "其他平台"),
    categoryId: String(scope.categoryId || fallback.categoryId || "all"),
    categoryName: String(scope.categoryName || fallback.categoryName || "全部")
  };
}

function scopeForTemplate(item = {}, config = DEFAULT_REPOSITORY_CONFIG) {
  return normalizeScope(item.scope || item.repositoryScope || {}, config);
}

module.exports = {
  DEFAULT_REPOSITORY_CONFIG,
  mergeConfig,
  normalizeScope,
  readTemplateRepositoryConfig,
  scopeForTemplate
};
