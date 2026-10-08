import os
import json
import re
from pathlib import Path
from datetime import datetime
from urllib.parse import quote

ROOT = Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\02-模板库")
HTML_FILE = ROOT / "模板仓库.html"
REG_FILE = ROOT / "templates-registry.json"

with open(REG_FILE, "r", encoding="utf-8") as f:
    reg_data = json.load(f)

templates = reg_data.get("templates", [])

# 构建规范化的前端 DATA 结构
formal_list = []
for t in templates:
    rel_path = t.get("relPath", "")
    folder_group = t.get("folderGroup", "")
    img_names = [Path(img).name for img in t.get("images", [])]
    
    # 转换为适合 file:// 访问的相对 URL 编码
    imgs_payload = []
    for idx, img_name in enumerate(img_names):
        encoded_rel = f"{quote(folder_group)}/{quote(t['name'])}/{quote(img_name)}"
        imgs_payload.append({
            "name": img_name,
            "url": encoded_rel,
            "label": f"P{idx+1} " + ("封面" if idx == 0 else ("内页" if idx == 1 else f"页{idx+1}"))
        })
    
    cover_url = imgs_payload[0]["url"] if imgs_payload else ""
    inner_url = imgs_payload[1]["url"] if len(imgs_payload) > 1 else ""
    
    formal_list.append({
        "id": t.get("id") or t.get("templateId"),
        "name": t.get("name"),
        "cat": t.get("category", "精准流量团建"),
        "folderGroup": folder_group,
        "layout": t.get("layout", "拼图大字多宫格"),
        "layoutType": t.get("layoutType", "standard_pair"),
        "color": "青绿",
        "added": t.get("addedAt", "2026-08-17"),
        "mtime": t.get("mtime", "2026-10-08 12:00:00"),
        "cover": cover_url,
        "inner": inner_url,
        "nimg": len(imgs_payload),
        "images": imgs_payload,
        "path": t.get("localPath", "").replace("/", "\\"),
        "relpath": f"{folder_group}/{t['name']}",
        "tags": t.get("tags", []),
        "desc": t.get("description", ""),
        "feat": t.get("description", "") or "视觉母版",
        "ctr": "9.5分"
    })

print(f"准备注入 {len(formal_list)} 套模板到 模板仓库.html ...")

# 备份旧 html
bak_html = ROOT / f"模板仓库.html.bak-{datetime.now().strftime('%Y%m%d_%H%M%S')}"
import shutil
shutil.copy2(str(HTML_FILE), str(bak_html))
print(f"已备份旧 HTML: {bak_html.name}")

# 生成升级版 模板仓库.html
html_content = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>母版仓库 · 团队工作台</title>
<style>
:root{{
  --bg:#e8edf3;--surface:#e2eaf2;--alt:#edf2f6;--border:#d1dbe4;--line:#d1dbe4;
  --text:#242c38;--muted:#61758a;--m2:#94a3b8;--in:#cbd5e1;
  --tag:#eff6ff;--tagt:#1d4ed8;--acc:#2563eb;--acc-hover:#1d4ed8;
  --ok:#059669;--okbg:#ecfdf5;--warn:#d97706;--warnbg:#fffbeb;--star:#f59e0b;
  --purple:#7c3aed;--purplebg:#f5f3ff;
  --shadow-sm:3px 3px 8px #cbd5e1, -3px -3px 8px #ffffff;
  --shadow-md:6px 6px 16px #cbd5e1, -6px -6px 16px #ffffff;
  --shadow-lg:0 10px 25px rgba(0,0,0,0.12);
  color-scheme:light;
}}
:root[data-theme=dark], :root[data-theme=midnight], :root[data-theme=midnight-glass],
body.theme-midnight, body.theme-dark, body.theme-midnight-glass {{
  --bg:#0e141d;--surface:#16202e;--alt:#1d293a;--border:rgba(255,255,255,0.08);--line:rgba(255,255,255,0.06);
  --text:#e2e8f0;--muted:#8b9cb3;--m2:#64748b;--in:#334155;
  --tag:#172554;--tagt:#93c5fd;--acc:#3b82f6;--acc-hover:#60a5fa;
  --ok:#10b981;--okbg:#064e3b;--warn:#f59e0b;--warnbg:#451a03;--star:#fbbf24;
  --purple:#a78bfa;--purplebg:#2e1065;
  --shadow-sm:3px 3px 8px #090d13, -3px -3px 8px #1d2a3c;
  --shadow-md:6px 6px 16px #090d13, -6px -6px 16px #1b2737;
  --shadow-lg:0 12px 28px rgba(0,0,0,0.5);
  color-scheme:dark;
}}
:root[data-theme=glass], body.theme-glass {{
  --bg:#f0f4f9;--surface:rgba(235, 242, 248, 0.78);--alt:rgba(255, 255, 255, 0.70);--border:rgba(209, 219, 228, 0.65);--line:rgba(209, 219, 228, 0.50);
  --text:#1e293b;--muted:#64748b;--m2:#94a3b8;--in:#cbd5e1;
  --tag:#eff6ff;--tagt:#1d4ed8;--acc:#2563eb;--acc-hover:#1d4ed8;
  --shadow-sm:0 4px 16px rgba(31, 38, 135, 0.05);
  --shadow-md:0 8px 32px rgba(31, 38, 135, 0.08);
  color-scheme:light;
}}
*{{box-sizing:border-box}}
body{{margin:0;padding:20px 24px;background:var(--bg);color:var(--text);font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-size:13.5px;line-height:1.5}}
header{{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:14px}}
h1{{margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:-0.02em;display:flex;align-items:center;gap:10px}}
h1 span.badge{{font-size:12px;padding:3px 9px;border-radius:999px;background:var(--tag);color:var(--tagt);font-weight:600}}
p.sub{{margin:0;color:var(--muted);font-size:13px}}
.hr{{display:flex;gap:8px;align-items:center;flex-wrap:wrap}}

button,input,select{{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:pointer;transition:all .15s ease}}
button:hover{{border-color:var(--acc);color:var(--acc)}}
button.active{{background:var(--acc);border-color:var(--acc);color:#fff}}
button.active:hover{{background:var(--acc-hover);color:#fff}}
#toggle{{width:36px;height:36px;padding:0;border-radius:999px;display:grid;place-items:center;font-size:16px}}

.metrics{{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}}
.m{{padding:7px 12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;font-size:12px;box-shadow:var(--shadow-sm);display:flex;align-items:center;gap:6px}}
.m b{{font-size:14px;color:var(--acc)}}
.m.ok b{{color:var(--ok)}}
.m.purple b{{color:var(--purple)}}
.m.star b{{color:var(--star)}}

/* 工具栏与右上角筛选排序控制区 */
.toolbar{{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-sm)}}
.toolbar .grp{{display:flex;gap:6px;align-items:center;flex-wrap:wrap}}
.lab{{font-size:11.5px;color:var(--muted);font-weight:500}}
#search{{width:min(240px,100%);border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:text}}
.view-btn{{padding:6px 10px;font-size:12px}}

/* 右上角分类筛选胶囊 */
.cat-pill-group{{display:flex;gap:5px;align-items:center;background:var(--alt);padding:3px;border-radius:9px;border:1px solid var(--border)}}
.cat-pill{{padding:5px 11px;font-size:12px;border-radius:7px;border:none;background:transparent;color:var(--muted);font-weight:600;cursor:pointer;transition:all .2s ease}}
.cat-pill:hover{{color:var(--text);background:rgba(0,0,0,0.05)}}
.cat-pill.active{{background:var(--acc);color:#fff;box-shadow:0 2px 6px rgba(37,99,235,0.25)}}

/* 右上角排序控件 */
.sort-select-wrap{{display:flex;align-items:center;gap:6px;margin-left:auto}}
#sortSel{{padding:6px 10px;font-size:12px;border-radius:8px;font-weight:500;border:1px solid var(--border);background:var(--surface)}}

/* 表格视图 */
.card{{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow-sm)}}
table{{width:100%;border-collapse:collapse;font-size:12.5px}}
th,td{{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}}
th{{background:var(--alt);font-size:12px;color:var(--muted);font-weight:600;position:sticky;top:0;z-index:2}}
tr:hover td{{background:var(--alt)}}
.id-badge{{font-weight:700;color:var(--acc);background:var(--tag);padding:2px 8px;border-radius:6px;font-size:12px;display:inline-block}}
.id-badge.guide{{color:#7c3aed;background:#f5f3ff}}
.id-badge.game{{color:#059669;background:#ecfdf5}}
.ctr-tag{{background:var(--warnbg);color:var(--warn);padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;margin-left:4px}}
.pv-thumb{{width:64px;height:85px;object-fit:cover;border-radius:5px;border:1px solid var(--line);background:var(--alt);display:block;cursor:pointer}}
.pv-duo{{display:flex;gap:6px}}
.action-btn{{padding:4px 9px;font-size:11.5px;border-radius:6px;border:1px solid var(--border);background:var(--surface);display:inline-flex;align-items:center;gap:4px}}
.action-btn.primary{{background:var(--acc);color:#fff;border-color:var(--acc)}}
.action-btn.primary:hover{{background:var(--acc-hover);color:#fff}}

/* 画廊网格 */
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}}

/* 标准卡片（精准流量团建 · 双图紧凑模式） */
.tpl-card{{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow-sm);transition:transform .2s ease,box-shadow .2s ease}}
.tpl-card:hover{{transform:translateY(-2px);box-shadow:var(--shadow-md);border-color:var(--in)}}
.tpl-card-imgs{{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px;background:var(--alt)}}
.tpl-card-img-wrap{{position:relative;aspect-ratio:3/4;border-radius:8px;overflow:hidden;background:var(--surface)}}
.tpl-card-img-wrap img{{width:100%;height:100%;object-fit:cover;display:block;cursor:pointer;transition:transform .3s ease}}
.tpl-card-img-wrap img:hover{{transform:scale(1.04)}}
.tpl-card-img-tag{{position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;padding:1px 5px;border-radius:4px;backdrop-filter:blur(4px)}}
.tpl-card-body{{padding:12px;flex:1;display:flex;flex-direction:column;gap:8px}}
.tpl-card-header{{display:flex;justify-content:space-between;align-items:flex-start;gap:6px}}
.tpl-card-title{{font-weight:600;font-size:13.5px;line-height:1.4;color:var(--text);margin-top:2px}}
.tpl-card-feat{{font-size:11.5px;color:var(--muted);background:var(--alt);padding:6px 8px;border-radius:6px;line-height:1.4}}
.tpl-card-meta{{display:flex;gap:5px;flex-wrap:wrap;align-items:center}}
.chip{{font-size:11px;padding:2px 7px;border-radius:6px;background:var(--tag);color:var(--tagt);font-weight:500}}
.chip.c-guide{{background:#f5f3ff;color:#7c3aed}}
.chip.c-game{{background:#ecfdf5;color:#059669}}
.chip.c-color{{background:var(--alt);color:var(--muted)}}
.tpl-card-actions{{display:flex;gap:6px;margin-top:auto;padding-top:8px;border-top:1px solid var(--line)}}

/* ⭐ 多图画册卡片（泛流量个人攻略 / 泛流量小游戏 · 一行放一个） */
.tpl-card.album-fullwidth{{
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1.5px solid rgba(124, 58, 237, 0.25);
  box-shadow: var(--shadow-md);
  border-radius: 16px;
}}
.album-banner{{
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: linear-gradient(90deg, rgba(124, 58, 237, 0.08), rgba(37, 99, 235, 0.05));
  border-bottom: 1px solid var(--line);
}}
.album-banner-title{{font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;color:var(--text)}}
.album-banner-badge{{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--purple);color:#fff;font-weight:600}}
.album-scroll-strip{{
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  overflow-x: auto;
  background: var(--alt);
  scrollbar-width: thin;
}}
.album-scroll-strip::-webkit-scrollbar{{height: 6px;}}
.album-scroll-strip::-webkit-scrollbar-thumb{{background: var(--border); border-radius: 4px;}}
.album-item-wrap{{
  position: relative;
  flex: 0 0 145px;
  aspect-ratio: 3/4;
  border-radius: 9px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  border: 1px solid var(--border);
  background: var(--surface);
  transition: transform .2s ease;
}}
.album-item-wrap:hover{{transform: translateY(-3px); border-color: var(--acc);}}
.album-item-wrap img{{width:100%;height:100%;object-fit:cover;display:block;cursor:pointer}}
.album-item-tag{{
  position: absolute;
  top: 6px;
  left: 6px;
  background: rgba(0,0,0,0.65);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  backdrop-filter: blur(4px);
}}
.album-footer-bar{{
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}}

/* 模态抽屉详情 */
#detailModal{{position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:999;display:flex;justify-content:center;align-items:center;padding:20px}}
.modal-box{{background:var(--surface);width:min(920px,100%);max-height:90vh;border-radius:16px;box-shadow:var(--shadow-lg);border:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}}
.modal-header{{padding:16px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}}
.modal-title{{font-size:16px;font-weight:700;display:flex;align-items:center;gap:10px}}
.modal-body{{padding:20px;overflow-y:auto;display:flex;flex-direction:column;gap:16px}}
.modal-gallery{{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}}
.modal-img-wrap{{position:relative;width:150px;aspect-ratio:3/4;border-radius:10px;overflow:hidden;border:1px solid var(--border);background:var(--alt)}}
.modal-img-wrap img{{width:100%;height:100%;object-fit:cover;display:block;cursor:pointer}}
.modal-footer{{padding:14px 20px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:10px;background:var(--alt)}}

/* Toast */
#toast{{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f8fafc;padding:10px 18px;border-radius:999px;font-size:12.5px;font-weight:500;box-shadow:0 10px 25px rgba(0,0,0,0.25);z-index:10000;display:flex;align-items:center;gap:8px;transition:all .3s ease;opacity:0;pointer-events:none}}
#toast.show{{opacity:1;transform:translateX(-50%) translateY(-5px)}}

.empty{{padding:48px 20px;text-align:center;color:var(--muted);font-size:14px}}
.hint{{font-size:11.5px;color:var(--muted);margin:14px 2px 0;line-height:1.6}}
.hide{{display:none!important}}
</style></head><body>
<header>
  <div>
    <h1>母版仓库 · 全品类模板中枢 <span class="badge" id="totalBadge">{len(formal_list)} 套图源</span></h1>
    <p class="sub">包含【精准流量团建】双图母版与【泛流量个人攻略 / 小游戏】多图异构全套画册</p>
  </div>
  <div class="hr">
    <button id="toggle" title="切换深色模式">☾</button>
  </div>
</header>

<div class="metrics">
  <div class="m ok"><b>{len([t for t in formal_list if t['cat'] == '精准流量团建'])}</b> 套 精准流量团建</div>
  <div class="m purple"><b>{len([t for t in formal_list if t['cat'] == '泛流量个人攻略'])}</b> 套 泛流量个人攻略 (异构全套)</div>
  <div class="m star"><b>{len([t for t in formal_list if t['cat'] == '泛流量团建小游戏'])}</b> 套 泛流量小游戏</div>
  <div class="m"><b>{sum(t['nimg'] for t in formal_list)}</b> 张 原模板参考图</div>
  <div class="m">同步于 {datetime.now().strftime('%Y-%m-%d %H:%M')}</div>
</div>

<div class="toolbar">
  <!-- 视图切换 -->
  <div class="grp">
    <button class="view-btn active" id="btnViewGrid" title="画廊网格视图">🖼️ 画廊</button>
    <button class="view-btn" id="btnViewTable" title="列表清单视图">📋 列表</button>
  </div>
  
  <!-- 搜索框 -->
  <input id="search" type="search" placeholder="搜索编号 (T01/G01) / 标题 / 目的地 / 标签…">

  <!-- ⭐ 最右上角：大类筛选胶囊 -->
  <div class="cat-pill-group" id="catPills">
    <button class="cat-pill active" data-cat="all">🌟 全部 ({len(formal_list)})</button>
    <button class="cat-pill" data-cat="精准流量团建">🎯 精准流量团建 ({len([t for t in formal_list if t['cat'] == '精准流量团建'])})</button>
    <button class="cat-pill" data-cat="泛流量个人攻略">🗺️ 泛流量个人攻略 ({len([t for t in formal_list if t['cat'] == '泛流量个人攻略'])})</button>
    <button class="cat-pill" data-cat="泛流量团建小游戏">🎮 泛流量团建小游戏 ({len([t for t in formal_list if t['cat'] == '泛流量团建小游戏'])})</button>
  </div>

  <!-- ⭐ 最右上角：排序下拉菜单 -->
  <div class="sort-select-wrap">
    <span class="lab">排序:</span>
    <select id="sortSel" aria-label="模板排序">
      <option value="time-desc">🕒 按时间排序 (最新在前)</option>
      <option value="time-asc">🕒 按时间排序 (最早在前)</option>
      <option value="name-asc">🔤 按名称排序 (A - Z)</option>
      <option value="id-asc">🏷️ 按编号排序 (T01~G02)</option>
    </select>
  </div>

  <button id="reset">重置</button>
  <span id="count" style="color:var(--muted);font-size:12px;margin-left:8px"></span>
</div>

<!-- 画廊卡片视图 -->
<div id="gridWrap"><div class="grid" id="grid"></div><div id="emptyG" class="empty hide">没有匹配的母版</div></div>

<!-- 表格列表视图 -->
<div class="card hide" id="tableWrap">
  <table><thead><tr>
    <th>编号</th><th>母版名称</th><th>大类分类</th><th>版式与类型</th>
    <th>封面 (P1)</th><th>内页预览</th><th>总参考图</th><th>最后更新</th><th>快捷动作</th>
  </tr></thead><tbody id="rows"></tbody></table>
  <div id="emptyT" class="empty hide">没有匹配的母版</div>
</div>

<!-- 模态详情抽屉 -->
<div id="detailModal" class="hide">
  <div class="modal-box">
    <div class="modal-header">
      <div class="modal-title" id="mTitle">母版详情</div>
      <button id="mClose" style="border:none;background:none;font-size:20px;cursor:pointer">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-gallery" id="mImages"></div>
      <div id="mMetaGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px"></div>
    </div>
    <div class="modal-footer">
      <button class="action-btn primary" id="mOpenFolder">📂 打开本套原图文件夹</button>
    </div>
  </div>
</div>

<div id="toast"></div>

<p class="hint">使用提示：精准流量团建模板展示双图（P1+P2）；泛流量个人攻略与小游戏以整套异构画册（4~9张原图）全宽整行呈现。<br>
点击任一图片可在详情弹窗中逐页查看原图。</p>

<script>
const DATA = {json.dumps({"formal": formal_list}, ensure_ascii=False)};

const S = {{
  view: "grid",
  q: "",
  cat: "all",
  sort: "time-desc"
}};

const $ = sel => document.querySelector(sel);
const esc = s => (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toast(msg) {{
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}}

function openDetail(item) {{
  $("#mTitle").textContent = `[${{item.id}}] ${{item.name}} (${{item.nimg}}张图)`;
  const gal = $("#mImages");
  gal.replaceChildren();
  (item.images || []).forEach(img => {{
    const wrap = document.createElement("div");
    wrap.className = "modal-img-wrap";
    const el = document.createElement("img");
    el.src = img.url;
    el.alt = img.name;
    el.title = img.label || img.name;
    const tag = document.createElement("span");
    tag.className = "album-item-tag";
    tag.textContent = img.label || img.name;
    wrap.append(el, tag);
    gal.appendChild(wrap);
  }});
  
  const mg = $("#mMetaGrid");
  mg.innerHTML = `
    <div><strong>模板分类：</strong> ${{esc(item.cat)}}</div>
    <div><strong>版式风格：</strong> ${{esc(item.layout)}}</div>
    <div><strong>原图张数：</strong> ${{item.nimg}} 张</div>
    <div><strong>物理路径：</strong> <code style="word-break:break-all">${{esc(item.path)}}</code></div>
  `;
  
  $("#mOpenFolder").onclick = () => openFolder(item);
  $("#detailModal").classList.remove("hide");
}}

function openFolder(item) {{
  if (window.containerBridge && typeof window.containerBridge.openInExplorer === "function") {{
    window.containerBridge.openInExplorer(item.path);
    toast("已在资源管理器中打开文件夹");
  }} else {{
    // 降级复制路径
    navigator.clipboard?.writeText(item.path);
    toast("路径已复制: " + item.path);
  }}
}}

$("#mClose").onclick = () => $("#detailModal").classList.add("hide");
$("#detailModal").onclick = e => {{ if (e.target === $("#detailModal")) $("#detailModal").classList.add("hide"); }};

function filterAndSortTemplates() {{
  let list = DATA.formal.filter(item => {{
    if (S.cat !== "all" && item.cat !== S.cat) return false;
    if (S.q) {{
      const hay = [item.id, item.name, item.cat, item.layout, (item.tags || []).join(" ")].join(" ").toLowerCase();
      if (!hay.includes(S.q)) return false;
    }}
    return true;
  }});

  // 排序
  list.sort((a, b) => {{
    if (S.sort === "time-desc") return (b.mtime || "").localeCompare(a.mtime || "");
    if (S.sort === "time-asc") return (a.mtime || "").localeCompare(b.mtime || "");
    if (S.sort === "name-asc") return (a.name || "").localeCompare(b.name || "", "zh-CN");
    if (S.sort === "id-asc") return (a.id || "").localeCompare(b.id || "");
    return 0;
  }});

  return list;
}}

function renderGrid() {{
  const grid = $("#grid");
  grid.replaceChildren();
  const list = filterAndSortTemplates();

  list.forEach(item => {{
    const isMultiAlbum = (item.nimg > 2 || item.cat === "泛流量个人攻略" || item.cat === "泛流量团建小游戏");

    if (isMultiAlbum) {{
      // ⭐ 泛流量个人攻略 / 小游戏：全宽整行卡片，横向展开整套原图
      const card = document.createElement("article");
      card.className = "tpl-card album-fullwidth";
      
      const banner = document.createElement("div");
      banner.className = "album-banner";
      banner.innerHTML = `
        <div class="album-banner-title">
          <span class="id-badge ${{item.cat.includes('攻略') ? 'guide' : 'game'}}">${{esc(item.id)}}</span>
          <strong>${{esc(item.name)}}</strong>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="album-banner-badge">${{esc(item.cat)}} · ${{item.nimg}}张异构原图</span>
        </div>
      `;

      // 横向滚动图片流
      const strip = document.createElement("div");
      strip.className = "album-scroll-strip";
      (item.images || []).forEach(img => {{
        const wrap = document.createElement("div");
        wrap.className = "album-item-wrap";
        const imgEl = document.createElement("img");
        imgEl.loading = "lazy";
        imgEl.src = img.url;
        imgEl.alt = img.name;
        imgEl.title = "点击查看原图";
        imgEl.onclick = () => openDetail(item);
        
        const tag = document.createElement("span");
        tag.className = "album-item-tag";
        tag.textContent = img.label || img.name;
        
        wrap.append(imgEl, tag);
        strip.appendChild(wrap);
      }});

      const footer = document.createElement("div");
      footer.className = "album-footer-bar";
      footer.innerHTML = `
        <div class="tpl-card-meta">
          <span class="chip ${{item.cat.includes('攻略') ? 'c-guide' : 'c-game'}}">${{esc(item.cat)}}</span>
          <span class="chip">${{esc(item.layout)}}</span>
          <span class="chip c-color">全套${{item.nimg}}页异构画册</span>
          <span style="font-size:11.5px;color:var(--muted)">${{esc(item.desc || '')}}</span>
        </div>
        <div class="tpl-card-actions" style="margin:0;padding:0;border:none">
          <button class="action-btn" type="button">🖼️ 整套大图预览</button>
          <button class="action-btn primary" type="button">📂 原图文件夹</button>
        </div>
      `;
      footer.querySelectorAll("button")[0].onclick = () => openDetail(item);
      footer.querySelectorAll("button")[1].onclick = () => openFolder(item);

      card.append(banner, strip, footer);
      grid.appendChild(card);
    }} else {{
      // ⭐ 精准流量团建：经典双图卡片（紧凑网格）
      const card = document.createElement("article");
      card.className = "tpl-card";

      const imgs = document.createElement("div");
      imgs.className = "tpl-card-imgs";
      const p1 = item.images[0];
      const p2 = item.images[1];

      imgs.innerHTML = `
        <div class="tpl-card-img-wrap">
          ${{p1 ? `<img loading="lazy" src="${{esc(p1.url)}}" alt="P1">` : '<div class="empty">无封面</div>'}}
          <span class="tpl-card-img-tag">P1 封面</span>
        </div>
        <div class="tpl-card-img-wrap">
          ${{p2 ? `<img loading="lazy" src="${{esc(p2.url)}}" alt="P2">` : '<div class="empty">无内页</div>'}}
          <span class="tpl-card-img-tag">P2 内页</span>
        </div>
      `;
      imgs.querySelectorAll("img").forEach(im => im.onclick = () => openDetail(item));

      const body = document.createElement("div");
      body.className = "tpl-card-body";
      body.innerHTML = `
        <div class="tpl-card-header">
          <span class="id-badge">${{esc(item.id)}}</span>
          <span class="chip">${{item.nimg}} 张原图</span>
        </div>
        <div class="tpl-card-title">${{esc(item.name)}}</div>
        <div class="tpl-card-feat" ${{!item.feat ? 'hidden' : ''}}>${{esc(item.feat || '')}}</div>
        <div class="tpl-card-meta">
          <span class="chip">${{esc(item.cat)}}</span>
          <span class="chip c-color">${{esc(item.layout)}}</span>
        </div>
        <div class="tpl-card-actions">
          <button class="action-btn" type="button">🖼️ 整套预览</button>
          <button class="action-btn primary" type="button">📂 原图目录</button>
        </div>
      `;
      body.querySelectorAll(".action-btn")[0].onclick = () => openDetail(item);
      body.querySelectorAll(".action-btn")[1].onclick = () => openFolder(item);

      card.append(imgs, body);
      grid.appendChild(card);
    }}
  }});

  $("#emptyG").classList.toggle("hide", list.length > 0);
  $("#count").textContent = `${{list.length}} / ${{DATA.formal.length}} 套模板`;
}}

function renderTable() {{
  const rows = $("#rows");
  rows.replaceChildren();
  const list = filterAndSortTemplates();

  list.forEach(item => {{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="id-badge ${{item.cat.includes('攻略') ? 'guide' : (item.cat.includes('游戏') ? 'game' : '')}}">${{esc(item.id)}}</span></td>
      <td><strong style="cursor:pointer">${{esc(item.name)}}</strong></td>
      <td><span class="chip ${{item.cat.includes('攻略') ? 'c-guide' : (item.cat.includes('游戏') ? 'c-game' : '')}}">${{esc(item.cat)}}</span></td>
      <td>${{esc(item.layout)}} (${{item.nimg > 2 ? '多页画册' : '双图标版'}})</td>
      <td><img class="pv-thumb" src="${{esc(item.cover)}}" alt="P1"></td>
      <td><img class="pv-thumb" src="${{esc(item.inner || item.cover)}}" alt="P2"></td>
      <td>${{item.nimg}} 张</td>
      <td style="color:var(--muted);font-size:11.5px">${{esc(item.mtime.split(' ')[0])}}</td>
      <td>
        <button class="action-btn" type="button">🖼️ 预览</button>
        <button class="action-btn primary" type="button">📂 目录</button>
      </td>
    `;
    tr.querySelector("strong").onclick = () => openDetail(item);
    tr.querySelectorAll(".pv-thumb").forEach(im => im.onclick = () => openDetail(item));
    tr.querySelectorAll(".action-btn")[0].onclick = () => openDetail(item);
    tr.querySelectorAll(".action-btn")[1].onclick = () => openFolder(item);
    rows.appendChild(tr);
  }});

  $("#emptyT").classList.toggle("hide", list.length > 0);
  $("#count").textContent = `${{list.length}} / ${{DATA.formal.length}} 套模板`;
}}

function render() {{
  if (S.view === "grid") {{
    $("#gridWrap").classList.remove("hide");
    $("#tableWrap").classList.add("hide");
    renderGrid();
  }} else {{
    $("#gridWrap").classList.add("hide");
    $("#tableWrap").classList.remove("hide");
    renderTable();
  }}
}}

// 视图切换
$("#btnViewGrid").onclick = () => {{
  S.view = "grid";
  $("#btnViewGrid").classList.add("active");
  $("#btnViewTable").classList.remove("active");
  render();
}};
$("#btnViewTable").onclick = () => {{
  S.view = "table";
  $("#btnViewTable").classList.add("active");
  $("#btnViewGrid").classList.remove("active");
  render();
}};

// 搜索
$("#search").oninput = e => {{
  S.q = e.target.value.trim().toLowerCase();
  render();
}};

// 分类胶囊切换
document.querySelectorAll(".cat-pill").forEach(btn => {{
  btn.onclick = () => {{
    document.querySelectorAll(".cat-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    S.cat = btn.dataset.cat;
    render();
  }};
}});

// 排序切换
$("#sortSel").onchange = e => {{
  S.sort = e.target.value;
  render();
}};

// 重置
$("#reset").onclick = () => {{
  S.q = "";
  S.cat = "all";
  S.sort = "time-desc";
  $("#search").value = "";
  $("#sortSel").value = "time-desc";
  document.querySelectorAll(".cat-pill").forEach(b => b.classList.toggle("active", b.dataset.cat === "all"));
  render();
}};

// 主题同步
const root = document.documentElement;
const tt = $("#toggle");
function setTheme(t) {{
  const isDark = (t === "dark" || t === "midnight" || t === "midnight-glass");
  const norm = isDark ? "midnight" : (t === "glass" ? "glass" : "neo");
  root.dataset.theme = isDark ? "dark" : norm;
  root.setAttribute("data-app-theme", norm);
  document.body.className = "theme-" + norm;
  if (tt) tt.textContent = isDark ? "☀" : "☾";
}}

if (tt) {{
  tt.onclick = () => {{
    const isDark = root.dataset.theme === "dark" || root.getAttribute("data-app-theme") === "midnight";
    setTheme(isDark ? "neo" : "midnight");
  }};
}}

window.addEventListener("message", e => {{
  if (e.data && e.data.type === "THEME_CHANGE") setTheme(e.data.theme);
}});

setTheme("neo");
render();
</script></body></html>
"""

with open(HTML_FILE, "w", encoding="utf-8") as f:
    f.write(html_content)

print(f"模板仓库.html 升级完毕！已写入 {len(formal_list)} 套模板，支持右上角三大类筛选、四重排序与异构画册全宽排布！")
