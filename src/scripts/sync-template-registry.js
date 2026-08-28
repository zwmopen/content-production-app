const fs = require("node:fs");
const path = require("node:path");
const { getTemplateLibrary, readOnlineTemplates } = require("../server");
const { buildTemplateRegistry, renderTemplateRegistryMarkdown } = require("../lib/template-registry");
const { syncTemplateMetadata } = require("../lib/template-metadata");
const { readTemplateRepositoryConfig } = require("../lib/template-repository");
const { generateTemplateCatalog } = require("./generate-template-catalog");

const library = getTemplateLibrary();
const templateRoot = path.dirname(library.csv);
const registryPath = path.join(templateRoot, "templates-registry.json");
const recordPath = path.join(templateRoot, "模板记录.md");
const changelogPath = path.join(templateRoot, "模板更新记录.md");
const repositoryConfigPath = path.join(templateRoot, "模板仓库配置.json");
const repositoryConfig = readTemplateRepositoryConfig(repositoryConfigPath);
const existing = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, "utf8")) : {};
const online = readOnlineTemplates();
const registry = buildTemplateRegistry(library.templates, existing, { onlineTemplates: online.templates });
registry.repository = repositoryConfig.repository;
registry.scope = repositoryConfig.defaultScope;
const metadata = syncTemplateMetadata({
  templateRoot,
  registry,
  repositoryConfig,
  materialCsvPath: path.join(path.dirname(templateRoot), "01-素材库", "素材链接记录.csv"),
  generatedAt: registry.lastScannedAt
});

fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
fs.writeFileSync(recordPath, renderTemplateRegistryMarkdown(registry), "utf8");
if (!fs.existsSync(changelogPath)) {
  fs.writeFileSync(changelogPath, "# 团建模板更新记录\n\n> 追加记录模板新增、修改、上传、失效与恢复。\n\n", "utf8");
}
fs.appendFileSync(changelogPath, `- ${registry.lastScannedAt}｜全量扫描｜本地 ${registry.summary.localTotal}｜在线 ${registry.summary.onlineMapped}｜缺失 ${registry.summary.missingOnline}｜仓库：${repositoryConfig.repository.name}｜来源：AI维护同步\n`, "utf8");
const catalog = generateTemplateCatalog({ templateRoot, registryPath });
process.stdout.write(`${JSON.stringify({ templateRoot, registryPath, recordPath, changelogPath, metadata, catalog, summary: registry.summary }, null, 2)}\n`);
