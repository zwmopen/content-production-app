const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { mapOnlineTemplates } = require("../lib/template-registry");
const { readTemplateRepositoryConfig, scopeForTemplate } = require("../lib/template-repository");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fileUrl(filePath) {
  return pathToFileURL(path.resolve(filePath)).href;
}

function displayId(id) {
  const match = String(id || "").match(/^T(\d+)$/i);
  return match ? String(Number(match[1])) : String(id || "");
}

function formatAddedAt(value) {
  const raw = String(value || "").trim();
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return raw || "今天";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function readOnlineRows(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return text.split(/\r?\n/).map((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) return null;
    const match = clean.match(/https:\/\/chatgpt\.com\/(?:c|share)\/[a-z0-9-]+\/?/i);
    if (!match) return null;
    const before = clean.slice(0, match.index).replace(/(?:[\t|｜]+\s*)+$/g, "").trim();
    const explicitIdMatch = before.match(/^\[([A-Za-z0-9_-]+)\]\s*/);
    const templateId = explicitIdMatch?.[1] || "";
    const name = before.replace(/^\[[A-Za-z0-9_-]+\]\s*/, "");
    const after = clean.slice(match.index + match[0].length).replace(/^[\t|｜]+/g, "").trim();
    return { templateId, name, url: match[0], nickname: /^[a-z0-9_-]+$/i.test(after) ? after : "" };
  }).filter(Boolean);
}

function listImages(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
}

function buildRows(registry, onlineRows, repositoryConfig = readTemplateRepositoryConfig()) {
  const onlineByName = new Map(onlineRows.map((row) => [row.name.trim(), row]));
  const localRows = (registry.templates || []).map((item) => ({
    id: item.globalTemplateId || item.templateId,
    name: item.name,
    addedAt: item.addedAt || new Date().toISOString(),
    localPath: item.localPath,
    onlineUrl: item.onlineUrl || onlineByName.get(item.name)?.url || "",
    onlineTitle: item.onlineTitle || "",
    nickname: onlineByName.get(item.name)?.nickname || "",
    imageCount: Number(item.imageCount || 0),
    textCount: Number(item.textCount || 0),
    tags: item.tags?.all || [],
    description: item.description || item.notes || "",
    scope: scopeForTemplate(item, repositoryConfig),
    notes: item.notes || "",
    source: "local"
  }));
  const localNames = new Set(localRows.map((row) => row.name.trim()));
  const mappedOnlineUrls = new Set([
    ...localRows.map((row) => row.onlineUrl).filter(Boolean),
    ...mapOnlineTemplates(localRows, onlineRows).values().map((row) => row.url)
  ]);
  onlineRows.filter((row) => {
    if (localNames.has(row.name.trim()) || mappedOnlineUrls.has(row.url)) return false;
    return true;
  }).forEach((row) => {
    localRows.push({
      id: `ONLINE-${String(localRows.length + 1).padStart(2, "0")}`,
      name: row.name,
      addedAt: new Date().toISOString(),
      localPath: "",
      onlineUrl: row.url,
      nickname: row.nickname || "",
      imageCount: 0,
      textCount: 0,
      tags: [],
      description: "在线清单中存在，但本地模板尚未匹配",
      scope: scopeForTemplate({}, repositoryConfig),
      notes: "在线清单中存在，但本地模板尚未匹配",
      source: "online-only"
    });
  });
  return localRows.map((row) => {
    const images = listImages(row.localPath);
    const hasLocal = Boolean(row.localPath && fs.existsSync(row.localPath));
    const hasImages = images.length > 0;
    const hasOnline = Boolean(row.onlineUrl);
    const gaps = [];
    if (!hasLocal) gaps.push("缺本地目录");
    if (!hasImages) gaps.push("缺预览图片");
    if (!hasOnline) gaps.push("缺在线链接");
    return {
      ...row,
      images,
      coverPreview: images[0] || "",
      innerPreview: images[1] || "",
      localUrl: hasLocal ? fileUrl(row.localPath) : "",
      scope: scopeForTemplate(row.scope, repositoryConfig),
      status: gaps.length ? gaps.join("、") : "齐全",
      statusClass: gaps.length ? "warn" : "ok"
    };
  });
}

function renderHtml(rows, registry, generatedAt, repositoryConfig = readTemplateRepositoryConfig()) {
  const json = JSON.stringify(rows.map((row) => ({
    ...row,
    images: undefined
  }))).replace(/<\//g, "<\\/");
  const total = rows.length;
  const complete = rows.filter((row) => row.status === "齐全").length;
  const missingOnline = rows.filter((row) => row.status.includes("缺在线链接")).length;
  const missingLocal = rows.filter((row) => row.status.includes("缺本地") || row.status.includes("缺预览")).length;
  const categories = (repositoryConfig.categories || []).map((category) => {
    const isAll = category.id === "all";
    return `<button class="category-button${isAll ? " active" : ""}" type="button" data-category="${esc(category.id)}" title="切换${esc(category.name)}模板视图" aria-current="${isAll ? "page" : "false"}">${esc(category.name)}</button>`;
  }).join("");
  const platformSummary = (repositoryConfig.platforms || [])
    .map((platform) => `${platform.name}${platform.status === "active" ? "（已接入）" : "（待接入）"}`)
    .join(" · ");
  const repositoryName = repositoryConfig.repository?.name || "模板仓库";
  const defaultScope = scopeForTemplate(repositoryConfig.defaultScope || {}, repositoryConfig);
  const bodyRows = rows.map((row) => {
    const tags = row.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("");
    const makePreview = (filePath, label) => filePath
      ? `<span class="preview-label">${label}</span><img loading="lazy" src="${esc(fileUrl(filePath))}" alt="${esc(row.name)}${label}">`
      : `<span class="preview-label">${label}</span><div class="no-preview">暂无<br>预览</div>`;
    const coverPreview = makePreview(row.coverPreview, "封面");
    const innerPreview = makePreview(row.innerPreview, "内页1");
    const online = row.onlineUrl
      ? `<div class="actions"><a class="link" href="${esc(row.onlineUrl)}" target="_blank">打开链接</a><button class="copy-button" type="button" data-copy="${esc(row.onlineUrl)}" title="复制在线链接">复制链接</button></div>`
      : `<span class="muted">待补</span>`;
    const local = row.localUrl
      ? `<div class="actions"><a class="link" href="${esc(row.localUrl)}">打开文件夹</a><button class="copy-button" type="button" data-copy="${esc(row.localPath)}" title="复制本地地址">复制地址</button></div><div class="path" title="${esc(row.localPath)}">${esc(row.localPath)}</div>`
      : `<span class="muted">待补本地目录</span>`;
    const secondary = row.onlineTitle || row.nickname || "未填写";
    return `<tr data-category="${esc(row.scope.categoryId)}" data-platform="${esc(row.scope.platformId)}" data-search="${esc([row.id, displayId(row.id), row.name, row.onlineTitle, row.nickname, row.status, row.tags.join(" "), row.description, row.scope.projectName, row.scope.platformName, row.scope.categoryName, row.localPath].join(" ").toLowerCase())}">
      <td class="id" title="内部 ID：${esc(row.id)}">${esc(displayId(row.id))}</td>
      <td class="name"><strong>${esc(row.name)}</strong><small>${secondary}</small></td>
      <td class="added-at">${esc(formatAddedAt(row.addedAt))}</td>
      <td class="preview">${coverPreview}</td>
      <td class="preview">${innerPreview}</td>
      <td>${online}<div class="url" title="${esc(row.onlineUrl)}">${esc(row.onlineUrl || "—")}</div></td>
      <td>${local}</td>
      <td><span class="status ${row.statusClass}">${esc(row.status)}</span><small>${row.imageCount} 图 / ${row.textCount} 文本</small></td>
      <td class="tags"><div class="tag-list">${tags || '<span class="muted">待判定</span>'}</div></td>
      <td class="description">${row.description ? esc(row.description) : '<span class="muted">待补描述</span>'}</td>
    </tr>`;
  }).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>模板仓库</title>
 <style>
 :root{font-family:Inter,"Microsoft YaHei",system-ui,sans-serif;color:var(--text);background:var(--bg);--bg:#f5f7fb;--surface:#fff;--surface-alt:#f8faff;--border:#e1e6ef;--line:#edf0f5;--text:#172033;--muted:#667085;--muted-2:#8a94a6;--input-border:#d9dfeb;--tag-bg:#eef4ff;--tag-text:#3561a8;color-scheme:light}:root[data-theme="dark"]{--bg:#111827;--surface:#1f2937;--surface-alt:#273449;--border:#3b4a61;--line:#334155;--text:#f3f4f6;--muted:#cbd5e1;--muted-2:#94a3b8;--input-border:#475569;--tag-bg:#1e3a5f;--tag-text:#bfdbfe;color-scheme:dark}*{box-sizing:border-box}body{margin:0;padding:28px;background:var(--bg);color:var(--text);transition:background .2s ease,color .2s ease}header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}h1{margin:0 0 6px;font-size:26px}p{margin:0;color:var(--muted)}.header-actions{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;justify-content:flex-end}.category-nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.category-button,.theme-toggle{border:1px solid var(--input-border);border-radius:999px;padding:8px 12px;background:var(--surface);color:var(--text);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.theme-toggle{width:38px;height:38px;padding:0;display:grid;place-items:center;font-size:18px;line-height:1}.category-button:hover,.theme-toggle:hover{border-color:#2563eb}.category-button.active{border-color:#2563eb;background:#2563eb;color:#fff}.meta{font-size:12px;color:var(--muted-2)}.scope-info{margin-top:8px;color:var(--muted-2);font-size:12px;line-height:1.55}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:16px 0}.toolbar input{width:min(460px,100%);padding:11px 13px;border:1px solid var(--input-border);border-radius:10px;font-size:14px;background:var(--surface);color:var(--text)}.summary{display:flex;gap:8px;flex-wrap:wrap}.metric{padding:8px 11px;background:var(--surface);border:1px solid var(--border);border-radius:9px;font-size:13px}.metric b{font-size:18px;margin-right:4px}.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:auto;box-shadow:0 5px 20px #1f3b6710}table{width:100%;border-collapse:separate;border-spacing:0;min-width:1760px}th,td{padding:12px 13px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:13px}th{position:sticky;top:0;background:var(--surface-alt);color:var(--muted);font-weight:600;z-index:1}tr:last-child td{border-bottom:0}.id{font-weight:700;color:#2563eb;white-space:nowrap}.name{min-width:240px}.name strong{display:block;line-height:1.45}.name small,td small{display:block;color:var(--muted-2);margin-top:5px}.preview{width:112px}.preview-label{display:block;color:var(--muted-2);font-size:11px;margin-bottom:5px}.preview img{width:84px;height:112px;object-fit:cover;border-radius:7px;background:var(--surface-alt);display:block}.no-preview{width:84px;height:112px;border-radius:7px;background:var(--surface-alt);color:var(--muted-2);display:grid;place-content:center;text-align:center;font-size:11px}.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.link{color:#2563eb;text-decoration:none;white-space:nowrap}.link:hover{text-decoration:underline}.copy-button{border:1px solid var(--input-border);border-radius:6px;padding:4px 7px;background:var(--surface);color:var(--muted);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}.copy-button:hover{border-color:#2563eb;color:#2563eb}.copy-button.copied{border-color:#16803d;color:#16803d}.url,.path{max-width:240px;margin-top:5px;color:var(--muted-2);font-size:11px;line-height:1.35;word-break:break-all}.status{display:inline-block;padding:4px 8px;border-radius:99px;font-size:12px;white-space:nowrap}.status.ok{background:#e9f8ef;color:#16803d}.status.warn{background:#fff3d6;color:#9a6500}.tags{width:220px;min-width:180px;max-width:260px;white-space:normal;overflow-wrap:anywhere}.tag-list{display:flex;flex-wrap:wrap;gap:4px;max-width:100%;align-items:flex-start}.description{min-width:300px;max-width:420px;line-height:1.55;color:var(--muted)}.tag{display:inline-block;max-width:100%;margin:0;padding:4px 7px;border-radius:6px;background:var(--tag-bg);color:var(--tag-text);font-size:11px;line-height:1.25;white-space:normal;overflow-wrap:anywhere;vertical-align:top}.muted{color:var(--muted-2)}.empty{padding:32px;text-align:center;color:var(--muted-2);display:none}
 .name{min-width:180px;width:180px;max-width:180px;overflow-wrap:anywhere}
 </style></head><body>
 <header><div><h1>${esc(repositoryName)}</h1><p>跨项目、跨平台的可复用模板资产；当前范围：${esc(defaultScope.projectName)} · ${esc(defaultScope.platformName)}。页面显示简短编号，内部 Txx ID 仍是主键。</p><div class="scope-info">平台接入：${esc(platformSummary || defaultScope.platformName)}<br>AI维护：自动采集、分析、打标签、同步；手工录入关闭</div></div><div class="header-actions"><nav class="category-nav" aria-label="模板分类">${categories}</nav><button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false" aria-label="切换深色模式" title="切换深色模式">☾</button><div class="meta">生成时间：${esc(generatedAt)}<br>数据源：templates-registry.json + template.json + 模板仓库配置.json</div></div></header>
<div class="summary"><div class="metric"><b>${total}</b>条记录</div><div class="metric"><b>${complete}</b>齐全</div><div class="metric"><b>${missingOnline}</b>缺在线链接</div><div class="metric"><b>${missingLocal}</b>缺本地/预览</div></div>
<div class="toolbar"><input id="search" type="search" placeholder="搜索编号、ID、模板名称、标签、缺口…"><span class="meta">直接补对应行即可，补完后重新运行模板同步即可刷新。</span></div>
<div class="card"><table><thead><tr><th>编号</th><th>名称 / 昵称</th><th>添加时间</th><th>封面预览</th><th>内页1预览</th><th>在线链接</th><th>本地文件地址</th><th>状态</th><th>标签</th><th>模板描述</th></tr></thead><tbody id="rows">${bodyRows}</tbody></table><div id="empty" class="empty">没有匹配记录</div></div>
 <script>const rows=${json};const root=document.documentElement;const themeToggle=document.querySelector('#theme-toggle');function setTheme(theme){const dark=theme==='dark';root.dataset.theme=dark?'dark':'light';themeToggle.textContent=dark?'☀':'☾';themeToggle.setAttribute('aria-pressed',String(dark));themeToggle.setAttribute('aria-label',dark?'切换浅色模式':'切换深色模式');themeToggle.title=dark?'切换浅色模式':'切换深色模式'}let savedTheme='';try{savedTheme=localStorage.getItem('template-ledger-theme')||''}catch{}const preferredTheme=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';setTheme(savedTheme||preferredTheme);themeToggle.addEventListener('click',()=>{const next=root.dataset.theme==='dark'?'light':'dark';setTheme(next);try{localStorage.setItem('template-ledger-theme',next)}catch{}});async function copyText(value,button){let ok=false;try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);ok=true}}catch{}if(!ok){const textarea=document.createElement('textarea');textarea.value=value;textarea.style.position='fixed';textarea.style.opacity='0';document.body.appendChild(textarea);textarea.focus();textarea.select();try{ok=document.execCommand('copy')}catch{}textarea.remove()}const old=button.textContent;button.textContent=ok?'已复制':'复制失败';button.classList.toggle('copied',ok);window.setTimeout(()=>{button.textContent=old;button.classList.remove('copied')},1200)}document.querySelectorAll('.copy-button').forEach(button=>button.addEventListener('click',()=>copyText(button.dataset.copy||'',button)));const input=document.querySelector('#search');const trs=[...document.querySelectorAll('#rows tr')];const empty=document.querySelector('#empty');const categoryButtons=[...document.querySelectorAll('.category-button')];let activeCategory='all';function filter(){const q=input.value.trim().toLowerCase();let n=0;trs.forEach(tr=>{const categoryOk=activeCategory==='all'||tr.dataset.category===activeCategory;const queryOk=!q||tr.dataset.search.includes(q);const yes=categoryOk&&queryOk;tr.style.display=yes?'':'none';if(yes)n++});empty.style.display=n?'none':'block'}input.addEventListener('input',filter);categoryButtons.forEach(button=>button.addEventListener('click',()=>{categoryButtons.forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-current',item===button?'page':'false')});activeCategory=button.dataset.category||'all';filter()}));filter();</script>
</body></html>`;
}

function generateTemplateCatalog({ templateRoot, registryPath, onlinePath } = {}) {
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  const root = path.resolve(templateRoot || path.join(projectRoot, "02-模板库"));
  const registryFile = registryPath || path.join(root, "templates-registry.json");
  const onlineFile = onlinePath || path.join(root, "链接模板.txt");
  const repositoryConfigPath = path.join(root, "模板仓库配置.json");
  const output = path.join(root, "模板仓库.html");
  const legacyOutput = path.join(root, "模板台账.html");
  const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  const repositoryConfig = readTemplateRepositoryConfig(repositoryConfigPath);
  const rows = buildRows(registry, readOnlineRows(onlineFile), repositoryConfig);
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const html = renderHtml(rows, registry, generatedAt, repositoryConfig);
  fs.writeFileSync(output, html, "utf8");
  if (legacyOutput !== output) fs.writeFileSync(legacyOutput, html, "utf8");
  return { output, legacyOutput, repositoryConfigPath, total: rows.length, complete: rows.filter((row) => row.status === "齐全").length };
}

if (require.main === module) {
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  const templateRoot = path.join(projectRoot, "02-模板库");
  process.stdout.write(`${JSON.stringify(generateTemplateCatalog({ templateRoot }), null, 2)}\n`);
}

module.exports = { generateTemplateCatalog, buildRows, renderHtml, readOnlineRows };
