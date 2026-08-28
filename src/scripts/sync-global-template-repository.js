const fs = require("node:fs");
const path = require("node:path");
const { buildRows, readOnlineRows, renderHtml } = require("./generate-template-catalog");
const { readTemplateRepositoryConfig } = require("../lib/template-repository");

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sourceScope(source, registry) {
  return {
    projectId: source.projectId || source.id || registry.scope?.projectId || "unknown-project",
    projectName: source.name || registry.scope?.projectName || source.id || "未命名项目",
    platformId: source.platformId || registry.scope?.platformId || "other",
    platformName: source.platformName || registry.scope?.platformName || "其他平台",
    categoryId: source.categoryId || registry.scope?.categoryId || "all",
    categoryName: source.categoryName || registry.scope?.categoryName || "全部"
  };
}

function aggregateTemplateRepository({ configPath, outputPath, indexPath } = {}) {
  const globalRoot = path.resolve("D:\\AICode\\项目推进\\模板仓库");
  const resolvedConfigPath = path.resolve(configPath || path.join(globalRoot, "模板仓库配置.json"));
  const config = readTemplateRepositoryConfig(resolvedConfigPath);
  const sourceEntries = Array.isArray(config.sources) ? config.sources : [];
  const combinedTemplates = [];
  const combinedOnlineRows = [];
  const sourceReports = [];

  sourceEntries.filter((source) => source.status !== "disabled").forEach((source) => {
    const projectRoot = source.projectRoot ? path.resolve(source.projectRoot) : null;
    const materialRoot = source.materialRoot ? path.resolve(source.materialRoot) : null;
    const templateRoot = path.resolve(source.templateRoot);
    const registryPath = path.join(templateRoot, "templates-registry.json");
    const onlinePath = path.join(templateRoot, "链接模板.txt");
    const registry = readJson(registryPath, { templates: [] });
    const scope = sourceScope(source, registry);
    const templates = Array.isArray(registry.templates) ? registry.templates : [];
    templates.forEach((item) => {
      combinedTemplates.push({
        ...item,
        globalTemplateId: `${source.id || scope.projectId}-${item.templateId}`,
        scope: { ...scope, ...(item.scope || {}) },
        repositorySource: source.id || scope.projectId,
        repositorySourceName: source.name || scope.projectName
      });
    });
    const onlineRows = readOnlineRows(onlinePath).map((row) => ({
      ...row,
      repositorySource: source.id || scope.projectId,
      repositorySourceName: source.name || scope.projectName
    }));
    combinedOnlineRows.push(...onlineRows);
    sourceReports.push({
      id: source.id || scope.projectId,
      name: source.name || scope.projectName,
      projectRoot,
      materialRoot,
      templateRoot,
      registryPath,
      status: fs.existsSync(registryPath) ? "ok" : "missing-registry",
      templateCount: templates.length,
      onlineCount: onlineRows.length
    });
  });

  const combinedRegistry = {
    schemaVersion: 1,
    repository: config.repository,
    templates: combinedTemplates,
    sources: sourceReports,
    generatedAt: new Date().toISOString()
  };
  const rows = buildRows(combinedRegistry, combinedOnlineRows, config);
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const html = renderHtml(rows, combinedRegistry, generatedAt, config);
  const resolvedOutputPath = path.resolve(outputPath || path.join(globalRoot, "模板仓库.html"));
  const resolvedIndexPath = path.resolve(indexPath || path.join(globalRoot, "模板仓库索引.json"));
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.mkdirSync(path.dirname(resolvedIndexPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, html, "utf8");
  fs.writeFileSync(resolvedIndexPath, JSON.stringify({
    ...combinedRegistry,
    summary: {
      total: rows.length,
      complete: rows.filter((row) => row.status === "齐全").length,
      missingOnline: rows.filter((row) => row.status.includes("缺在线链接")).length,
      missingLocal: rows.filter((row) => row.status.includes("缺本地") || row.status.includes("缺预览")).length
    }
  }, null, 2) + "\n", "utf8");
  return {
    configPath: resolvedConfigPath,
    output: resolvedOutputPath,
    index: resolvedIndexPath,
    sources: sourceReports,
    total: rows.length,
    complete: rows.filter((row) => row.status === "齐全").length
  };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(aggregateTemplateRepository(), null, 2)}\n`);
}

module.exports = { aggregateTemplateRepository, sourceScope };
