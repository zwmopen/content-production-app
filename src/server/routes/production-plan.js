/** Persistent user intent; child execution stays in production-request. No model calls. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const requests = require('./production-request');
const hash = text => createHash('sha256').update(text).digest('hex');
const fail = message => { throw new Error(message); };
const root = ctx => path.join(ctx.PRODUCTION_JOB_ROOT || path.join(ctx.DATA_ROOT, 'production-jobs'), 'plans');
function normalize(body) {
  if (!body || !['cdp-a', 'cdp-b', 'codex-api'].includes(body.pipeline)) fail('请选择在线或本地产线');
  if (!['1_replica_shuffle', '2_random_template', '3_fixed_template'].includes(body.mode)) fail('请选择制作方式');
  if (typeof body.query !== 'string' || body.query.length > 8000) fail('素材要求最多 8000 字');
  const strings = (value, max) => {
    if (!Array.isArray(value) || value.length > max || value.some(x => typeof x !== 'string' || !x.trim() || x.length > 2000)) fail('选择列表无效');
    return [...new Set(value.map(x => x.trim()))].sort();
  };
  const sourcePaths = strings(body.sourcePaths || [], 1000);
  const templateIds = strings(body.templateIds || [], 100);
  if (!body.query.trim() && !sourcePaths.length) fail('请输入素材要求或选择素材');
  if (body.mode === '3_fixed_template' && !templateIds.length) fail('固定模板模式请至少选一个模板');
  return { schemaVersion: 1, pipeline: body.pipeline, mode: body.mode, query: body.query.trim(), sourcePaths, templateIds,
    sourcePolicy: 'original-local-path', executionPolicy: 'one-complete-source-folder-per-request',
    titlePolicy: 'preserve-original-title-in-metadata', cloudState: 'NOT_CONNECTED' };
}
function directory(ctx, id) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) fail('计划编号无效');
  const dir = path.join(root(ctx), id);
  if (fs.existsSync(dir) && (fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync(dir) !== path.resolve(dir))) fail('计划目录不能是链接');
  return dir;
}
function create(body, ctx) {
  const intent = normalize(body), id = hash(JSON.stringify(intent)), dir = directory(ctx, id);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const createdAt = new Date().toISOString();
    const lineName = intent.pipeline === 'codex-api' ? '本地Codex' : '在线GPT';
    const displayName = `${createdAt.slice(0, 16).replace('T', ' ')} ${lineName} ${intent.sourcePaths.length ? `${intent.sourcePaths.length}套作品` : '待找素材'}`;
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ planId: id, intent, displayName, createdAt }, null, 2), { flag: 'wx' });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return read(id, ctx);
}
function read(id, ctx) {
  const dir = directory(ctx, id);
  const file = path.join(dir, 'plan.json');
  if (fs.lstatSync(file).isSymbolicLink()) fail('计划文件不能是链接');
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (plan.planId !== id || hash(JSON.stringify(normalize(plan.intent))) !== id) fail('计划内容与编号不一致');
  const items = fs.readdirSync(dir).filter(name => /^item-[a-f0-9]{64}\.json$/.test(name)).map(name => {
    const itemPath = path.join(dir, name);
    if (fs.lstatSync(itemPath).isSymbolicLink()) fail('计划子项不能是链接');
    const binding = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
    if (binding.planId !== id || name !== `item-${hash(binding.sourcePath)}.json`) fail('计划子项不一致');
    try {
      const record = requests.readRequest(binding.requestId, ctx);
      if (record.sourcePath !== binding.sourcePath) fail('来源路径已改变');
      return { ...binding, status: record.status, completed: false, generatedPages: record.lifecycle?.generatedPages || 0 };
    } catch (_) { return { ...binding, status: 'NEEDS_REVIEW', completed: false, generatedPages: 0 }; }
  });
  const generated = items.filter(item => item.status === 'GENERATED_PENDING_QA').length;
  return { ok: true, ...plan, items, completed: false,
    status: !plan.intent.sourcePaths.length && !items.length ? 'AWAITING_MATERIALS' : items.length ? 'EXECUTION_LINKED' : 'AWAITING_EXECUTOR',
    progress: { selectedSources: plan.intent.sourcePaths.length, linkedRequests: items.length, generatedPendingQa: generated,
      packagedPendingDelivery: items.filter(item => item.status === 'PACKAGE_VERIFIED_PENDING_DELIVERY').length, completedWorks: null },
    message: '计划已保存；只有实际子任务证据才能推进状态，生成不等于交付完成。' };
}
function bind(id, requestId, ctx) {
  const plan = read(id, ctx), request = requests.readRequest(requestId, ctx);
  const sameLine = request.pipeline === plan.intent.pipeline ||
    (['cdp-a', 'cdp-b'].includes(request.pipeline) && ['cdp-a', 'cdp-b'].includes(plan.intent.pipeline));
  if (!sameLine || request.mode !== plan.intent.mode) fail('子任务的产线或制作方式与计划不同');
  if (plan.intent.sourcePaths.length && !plan.intent.sourcePaths.includes(request.sourcePath)) fail('子任务不在所选素材范围内');
  if (plan.intent.templateIds.length && !plan.intent.templateIds.includes(request.templateId)) fail('子任务模板不在计划候选中');
  const dir = directory(ctx, id), target = path.join(dir, `item-${hash(request.sourcePath)}.json`);
  const item = { planId: id, requestId, sourcePath: request.sourcePath, originalLocalSourcePath: request.sourcePath,
    sourceFolderName: path.basename(request.sourcePath), originalTitle: null, templateId: request.templateId };
  try { fs.writeFileSync(target, JSON.stringify(item, null, 2), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (JSON.parse(fs.readFileSync(target, 'utf8')).requestId !== requestId) fail('此素材已关联另一子任务，不覆盖');
  }
  return read(id, ctx);
}
async function handle(req, res, pathname, parsed, ctx) {
  if (!pathname.startsWith('/api/production/plans')) return false;
  try {
    if (pathname === '/api/production/plans' && req.method === 'POST') {
      ctx.sendJson(res, create(JSON.parse(await ctx.getBody(req, 250000) || '{}'), ctx));
    } else if (pathname === '/api/production/plans' && req.method === 'GET') {
      const ids = fs.existsSync(root(ctx)) ? fs.readdirSync(root(ctx)).filter(x => /^[a-f0-9]{64}$/.test(x)) : [];
      const plans = [], invalid = [];
      for (const id of ids) { try { plans.push(read(id, ctx)); } catch (_) { invalid.push(id); } }
      ctx.sendJson(res, { ok: true, plans: plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), invalidCount: invalid.length });
    } else {
      const match = pathname.match(/^\/api\/production\/plans\/([a-f0-9]{64})(?:\/(bind))?$/);
      if (!match) throw new Error('计划地址无效');
      if (!match[2] && req.method === 'GET') ctx.sendJson(res, read(match[1], ctx));
      else if (match[2] && req.method === 'POST') {
        const body = JSON.parse(await ctx.getBody(req, 1000) || '{}');
        ctx.sendJson(res, bind(match[1], body.requestId, ctx));
      } else throw new Error('计划操作方法不匹配');
    }
  } catch (error) { ctx.send(res, 400, JSON.stringify({ ok: false, error: error.message }), 'application/json; charset=utf-8'); }
  return true;
}
module.exports = { normalize, create, read, bind, handle };
