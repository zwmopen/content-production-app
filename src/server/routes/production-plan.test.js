const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const plans = require('./production-plan');
const requests = require('./production-request');
function fixture(t) {
  const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'production-plans-'));
  t.after(() => fs.rmSync(DATA_ROOT, { recursive: true, force: true }));
  return { DATA_ROOT };
}
const body = { pipeline: 'cdp-b', mode: '3_fixed_template', query: '找秋季苏州适合老板的团建', templateIds: ['T1', 'T2'], sourcePaths: [] };
test('zero-match natural language intent persists and repeat clicks are idempotent', t => {
  const ctx = fixture(t), first = plans.create(body, ctx), second = plans.create(body, ctx);
  assert.equal(first.status, 'AWAITING_MATERIALS');
  assert.equal(first.planId, second.planId);
  assert.equal(plans.read(first.planId, ctx).intent.query, body.query);
  assert.equal(first.completed, false);
  assert.equal(first.progress.completedWorks, null);
});
test('selected material folders and multiple template choices survive restart read', t => {
  const ctx = fixture(t);
  const result = plans.create({ ...body, sourcePaths: ['D:\\素材\\原帖'], templateIds: ['T2', 'T1', 'T2'] }, ctx);
  const readback = plans.read(result.planId, { DATA_ROOT: ctx.DATA_ROOT });
  assert.deepEqual(readback.intent.templateIds, ['T1', 'T2']);
  assert.deepEqual(readback.intent.sourcePaths, ['D:\\素材\\原帖']);
  assert.equal(readback.status, 'AWAITING_EXECUTOR');
});
test('child links preserve local source mapping and derive progress without claiming delivery', t => {
  const ctx = fixture(t), original = requests.readRequest;
  t.after(() => { requests.readRequest = original; });
  const sourcePath = 'D:\\素材\\原标题🍂';
  const record = { sourcePath, pipeline: 'cdp-b', mode: body.mode, templateId: 'T1', status: 'PREPARED_NOT_GENERATED' };
  requests.readRequest = () => record;
  const plan = plans.create({ ...body, sourcePaths: [sourcePath] }, ctx);
  const linked = plans.bind(plan.planId, 'a'.repeat(64), ctx);
  assert.equal(linked.items[0].originalLocalSourcePath, sourcePath);
  assert.equal(linked.items[0].originalTitle, null);
  assert.equal(linked.progress.generatedPendingQa, 0);
  record.status = 'GENERATED_PENDING_QA'; record.lifecycle = { generatedPages: 6 };
  const refreshed = plans.read(plan.planId, ctx);
  assert.equal(refreshed.progress.generatedPendingQa, 1);
  assert.equal(refreshed.items[0].generatedPages, 6);
  assert.equal(refreshed.completed, false);
  assert.throws(() => plans.bind(plan.planId, 'b'.repeat(64), ctx), /另一子任务/);
});
test('child cannot escape source, line or template selection', t => {
  const ctx = fixture(t), original = requests.readRequest;
  t.after(() => { requests.readRequest = original; });
  const plan = plans.create({ ...body, sourcePaths: ['D:\\one'] }, ctx);
  const valid = { sourcePath: 'D:\\one', pipeline: 'cdp-b', mode: body.mode, templateId: 'T1' };
  for (const changed of [{ sourcePath: 'D:\\other' }, { pipeline: 'codex-api' }, { templateId: 'T3' }]) {
    requests.readRequest = () => ({ ...valid, ...changed });
    assert.throws(() => plans.bind(plan.planId, 'a'.repeat(64), ctx));
  }
  assert.equal(plans.read(plan.planId, ctx).items.length, 0);
});
test('edited intent and disabled production line cannot masquerade as a plan', t => {
  const ctx = fixture(t), plan = plans.create(body, ctx);
  assert.throws(() => plans.create({ ...body, pipeline: 'gemini' }, ctx));
  assert.throws(() => plans.create({ ...body, query: '', templateIds: [], sourcePaths: [] }, ctx));
  const file = path.join(ctx.DATA_ROOT, 'production-jobs', 'plans', plan.planId, 'plan.json');
  const changed = JSON.parse(fs.readFileSync(file)); changed.intent.query = 'changed';
  fs.writeFileSync(file, JSON.stringify(changed));
  assert.throws(() => plans.read(plan.planId, ctx), /编号不一致/);
});
test('existing production route saves and reads a plan without invoking old API generation', async t => {
  const ctx = fixture(t), { handle } = require('./production');
  let saved;
  ctx.getBody = async () => JSON.stringify(body);
  ctx.sendJson = (_, data) => { saved = data; };
  ctx.send = (_, code, data) => { throw new Error(`${code}: ${data}`); };
  assert.equal(await handle({ method: 'POST' }, {}, '/api/production/plans', {}, ctx), true);
  const id = saved.planId;
  assert.equal(await handle({ method: 'GET' }, {}, `/api/production/plans/${id}`, {}, ctx), true);
  assert.equal(saved.planId, id);
  assert.equal(saved.status, 'AWAITING_MATERIALS');
});
