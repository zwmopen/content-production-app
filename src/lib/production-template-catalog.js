'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PROJECT_ROOT = process.env.TEAMBUILDING_ROOT || 'D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目';
const TEMPLATE_POOL_ROOT = path.join(PROJECT_ROOT, '02-模板库');
const MATERIAL_ROOT = path.join(PROJECT_ROOT, '01-素材库');
const RUNTIME_ROOT = 'D:\\AICode\\运行数据\\江湖有旅人\\内容生产App';
const PIPELINE_CONFIG_FILE = path.join(RUNTIME_ROOT, 'pipeline_mode_template_config.json');
const HALT_FLAG_FILE = 'D:\\AICode\\运行数据\\production_halt.flag';
const PID_LOCK_FILE = 'D:\\AICode\\运行数据\\producer.pid';
const PRODUCER_SCRIPT = 'D:\\AICode\\工具开发\\projects\\content-production-app\\scripts\\dual_browser_autonomous_producer.py';

let templateCache = null;
let templateCacheTime = 0;
const CACHE_TTL_MS = 20000;

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function listProductionTemplates(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && templateCache && (now - templateCacheTime < CACHE_TTL_MS)) {
    return templateCache;
  }

  if (!fs.existsSync(TEMPLATE_POOL_ROOT)) return [];
  const regFile = path.join(TEMPLATE_POOL_ROOT, 'templates-registry.json');
  const pathToReg = new Map();
  const nameToReg = new Map();
  const byId = new Map();

  if (fs.existsSync(regFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(regFile, 'utf8'));
      for (const t of (data.templates || [])) {
        if (t.localPath) {
          pathToReg.set(path.basename(t.localPath).toLowerCase(), t);
          pathToReg.set(path.resolve(t.localPath).toLowerCase(), t);
        }
        if (t.name) nameToReg.set(t.name.toLowerCase(), t);
        if (t.id && t.localPath && t.p1 && t.p2) {
          const folder = path.resolve(t.localPath);
          const p1Full = path.resolve(folder, t.p1);
          const p2Full = path.resolve(folder, t.p2);
          if (fs.existsSync(p1Full) && fs.existsSync(p2Full)) {
            const id = String(t.id).trim().toUpperCase();
            let cat = t.category || (t.flowType ? `${t.flowType}·团建方案` : '精准流量·团建方案');
            byId.set(id, {
              id,
              name: t.name,
              category: cat,
              folder,
              p1Path: p1Full,
              p2Path: p2Full,
              p1Url: `/file?path=${encodeURIComponent(p1Full)}`,
              p2Url: `/file?path=${encodeURIComponent(p2Full)}`
            });
          }
        }
      }
    } catch (_) {}
  }

  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (['scripts', '_回收站', '_待整理', '.git', '__pycache__', '_规则与台账', '_模板可视化面板', '_模板硬链接预览'].includes(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      let files = [];
      try {
        files = fs.readdirSync(full, { withFileTypes: true })
          .filter(f => f.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(f.name))
          .map(f => f.name);
      } catch (_) {}

      const p1 = files.find(f => /p1|封面/i.test(path.parse(f).name));
      const p2 = files.find(f => /p2|内页/i.test(path.parse(f).name));
      if (p1 && p2) {
        const reg = pathToReg.get(entry.name.toLowerCase()) || pathToReg.get(full.toLowerCase()) || nameToReg.get(entry.name.toLowerCase()) || {};
        let tid = reg.templateId || reg.id || '';
        if (!tid) {
          const m = entry.name.match(/^(T\d+)/i) || entry.name.match(/[\(（](T\d+)[\)）]/i);
          tid = m ? m[1].toUpperCase() : entry.name.slice(0, 8);
        }
        const id = String(tid).trim().toUpperCase();
        if (!byId.has(id)) {
          const name = reg.name || entry.name;
          let category = reg.category;
          if (!category) {
            if (name.includes('游戏') || path.basename(dir).includes('游戏') || id === 'T69') {
              category = '互动破冰·小游戏';
            } else if (name.includes('泛流') || path.basename(dir).includes('攻略')) {
              category = '泛流量·个人攻略';
            } else {
              category = '精准流量·团建方案';
            }
          }
          const p1Full = path.join(full, p1);
          const p2Full = path.join(full, p2);
          byId.set(id, {
            id,
            name,
            category,
            folder: full,
            p1Path: p1Full,
            p2Path: p2Full,
            p1Url: `/file?path=${encodeURIComponent(p1Full)}`,
            p2Url: `/file?path=${encodeURIComponent(p2Full)}`
          });
        }
      } else if (!entry.name.startsWith('_')) {
        walk(full);
      }
    }
  }
  walk(TEMPLATE_POOL_ROOT);

  const list = Array.from(byId.values());
  list.sort((a, b) => {
    const na = parseInt((a.id.match(/\d+/) || ['9999'])[0], 10);
    const nb = parseInt((b.id.match(/\d+/) || ['9999'])[0], 10);
    if (na !== nb) return na - nb;
    return a.id.localeCompare(b.id, 'zh-CN');
  });

  templateCache = list;
  templateCacheTime = now;
  return list;
}

function resolveLineIdFromPort(port) {
  const p = Number(port);
  if (p === 4331 || p === 9431) return 'cdp-a';
  if (p === 4332 || p === 9432) return 'cdp-b';
  if (p === 4333 || p === 9433) return 'cdp-c';
  if (p === 4334 || p === 9434) return 'cdp-d';
  return 'cdp-a';
}

function getPipelineModeConfig(targetLineId = '') {
  let saved = {};
  if (fs.existsSync(PIPELINE_CONFIG_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(PIPELINE_CONFIG_FILE, 'utf8'));
    } catch (_) {}
  }
  const pipelines = saved.pipelines || {};
  const lineId = targetLineId || 'cdp-a';
  const current = pipelines[lineId] || {
    lineId,
    label: lineId === 'cdp-a' ? 'GPT CDP 产线 A' : (lineId === 'cdp-b' ? 'GPT CDP 产线 B' : `产线 ${lineId}`),
    mode: '2_random_template',
    fixedTemplateId: 'T51',
    fixedTemplateName: '「精准母版·团建方案」云雾山水大字营销封面'
  };

  const templates = listProductionTemplates();
  let tpl = null;
  if (current.fixedTemplateId) {
    tpl = templates.find(t => t.id === current.fixedTemplateId);
  }
  if (!tpl && templates.length > 0) {
    tpl = templates[0];
  }

  const p1Path = current.p1Path || tpl?.p1Path || '';
  const p2Path = current.p2Path || tpl?.p2Path || '';

  return {
    ok: true,
    lineId,
    mode: current.mode || '2_random_template',
    fixedTemplateId: current.fixedTemplateId || tpl?.id || '',
    fixedTemplateName: current.fixedTemplateName || tpl?.name || '',
    p1Path,
    p2Path,
    p1Url: p1Path ? `/file?path=${encodeURIComponent(p1Path)}` : (tpl?.p1Url || ''),
    p2Url: p2Path ? `/file?path=${encodeURIComponent(p2Path)}` : (tpl?.p2Url || ''),
    pipelines,
    updatedAt: saved.updatedAt || new Date().toISOString()
  };
}

function savePipelineModeConfig(lineId, mode, fixedTemplateId) {
  if (!lineId) throw new Error('缺少产线标识 lineId');
  if (!['1_replica_shuffle', '2_random_template', '3_fixed_template'].includes(mode)) {
    throw new Error(`未知生产模式：${mode}`);
  }

  let saved = { updatedAt: new Date().toISOString(), pipelines: {} };
  if (fs.existsSync(PIPELINE_CONFIG_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(PIPELINE_CONFIG_FILE, 'utf8'));
    } catch (_) {}
  }
  if (!saved.pipelines) saved.pipelines = {};

  const templates = listProductionTemplates();
  let tpl = null;
  if (fixedTemplateId) {
    tpl = templates.find(t => t.id === String(fixedTemplateId).trim().toUpperCase());
  }

  const current = saved.pipelines[lineId] || { lineId, label: `GPT CDP 产线 ${lineId.toUpperCase()}` };
  current.mode = mode;
  if (tpl) {
    current.fixedTemplateId = tpl.id;
    current.fixedTemplateName = tpl.name;
    current.p1Path = tpl.p1Path;
    current.p2Path = tpl.p2Path;
  } else if (fixedTemplateId) {
    current.fixedTemplateId = fixedTemplateId;
  }
  current.updatedAt = new Date().toISOString();

  saved.pipelines[lineId] = current;
  saved.updatedAt = new Date().toISOString();

  writeJsonAtomic(PIPELINE_CONFIG_FILE, saved);
  return getPipelineModeConfig(lineId);
}

let activeMaterialPath = '';

function findValidMaterialFolders(maxFolders = 50) {
  const candidateRoots = [
    path.join(MATERIAL_ROOT, '秋季（9—11月·智能分类）', '精准流量'),
    path.join(MATERIAL_ROOT, '精准流量'),
    path.join(MATERIAL_ROOT, '四季通用（全年·无季节限制）', '精准流量'),
    path.join(MATERIAL_ROOT, '泛流量')
  ];

  const found = [];
  function search(dir, depth = 0) {
    if (depth > 4 || found.length >= maxFolders) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) { return; }

    const imageEntries = entries.filter(e => e.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(e.name));
    if (imageEntries.length >= 3) {
      found.push(dir);
      return;
    }

    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.')) {
        search(path.join(dir, e.name), depth + 1);
      }
    }
  }

  for (const cr of candidateRoots) {
    if (fs.existsSync(cr)) {
      search(cr, 0);
      if (found.length >= maxFolders) break;
    }
  }
  return found;
}

function getCurrentMaterialDetail(specificPath = '') {
  let targetDir = specificPath || activeMaterialPath;
  if (!targetDir || !fs.existsSync(targetDir)) {
    const valid = findValidMaterialFolders(5);
    if (valid.length > 0) {
      targetDir = valid[0];
    }
  }

  if (!targetDir || !fs.existsSync(targetDir)) {
    return {
      ok: true,
      name: '暂无选定素材',
      path: '',
      count: 0,
      images: []
    };
  }

  activeMaterialPath = targetDir;
  let imgFiles = [];
  try {
    imgFiles = fs.readdirSync(targetDir, { withFileTypes: true })
      .filter(f => f.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(f.name))
      .map(f => f.name);
  } catch (_) {}

  // 自然数排序
  imgFiles.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));

  const images = imgFiles.map(name => {
    const full = path.join(targetDir, name);
    return {
      name,
      path: full,
      url: `/file?path=${encodeURIComponent(full)}`
    };
  });

  return {
    ok: true,
    name: path.basename(targetDir),
    path: targetDir,
    count: images.length,
    images
  };
}

function pickRandomMaterial() {
  const pool = findValidMaterialFolders(80);
  if (pool.length === 0) {
    return getCurrentMaterialDetail();
  }

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  activeMaterialPath = chosen;
  return getCurrentMaterialDetail(chosen);
}

function getProducerStatus() {
  let isPaused = false;
  let isRunning = false;
  let pid = null;

  if (fs.existsSync(HALT_FLAG_FILE)) {
    try {
      const content = fs.readFileSync(HALT_FLAG_FILE, 'utf8');
      if (content.includes('HALT=1')) isPaused = true;
    } catch (_) {}
  }

  if (fs.existsSync(PID_LOCK_FILE)) {
    try {
      const p = parseInt(fs.readFileSync(PID_LOCK_FILE, 'utf8').trim(), 10);
      if (p) {
        pid = p;
        try {
          process.kill(p, 0);
          isRunning = true;
        } catch (e) {
          isRunning = e.code === 'EPERM';
        }
      }
    } catch (_) {}
  }

  return {
    ok: true,
    isRunning,
    isPaused,
    pid,
    checkedAt: new Date().toISOString()
  };
}

function controlProducer(action) {
  const current = getProducerStatus();
  if (action === 'pause') {
    const payload = `HALT=1\nREASON=Manual Pause via Content Production UI\nEXPIRES=2099-01-01 00:00:00\nUPDATED_AT=${new Date().toISOString()}\n`;
    fs.writeFileSync(HALT_FLAG_FILE, payload, 'utf8');
    return { ok: true, isRunning: current.isRunning, isPaused: true, message: '已切换为手动暂停模式' };
  } else if (action === 'resume' || action === 'start') {
    if (fs.existsSync(HALT_FLAG_FILE)) {
      try { fs.unlinkSync(HALT_FLAG_FILE); } catch (_) {}
    }
    if (!current.isRunning && fs.existsSync(PRODUCER_SCRIPT)) {
      try {
        const child = spawn('python', ['-u', PRODUCER_SCRIPT], {
          cwd: path.dirname(PRODUCER_SCRIPT),
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
        return { ok: true, isRunning: true, isPaused: false, pid: child.pid, message: `已启动自动持续生产 (PID ${child.pid})` };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    return { ok: true, isRunning: current.isRunning, isPaused: false, message: '已恢复自动生产' };
  } else if (action === 'retry') {
    return { ok: true, message: '已下发重试当前步指令' };
  } else if (action === 'skip') {
    return { ok: true, message: '已下发跳过此作品指令' };
  }
  return { ok: false, error: `未知控制指令: ${action}` };
}

module.exports = {
  listProductionTemplates,
  resolveLineIdFromPort,
  getPipelineModeConfig,
  savePipelineModeConfig,
  getCurrentMaterialDetail,
  pickRandomMaterial,
  getProducerStatus,
  controlProducer
};
