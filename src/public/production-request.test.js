const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { payload, readback, workflowStages, requestViewModel, findMatchingRequest, resolveTemplateSelection, validateStateSnapshot, runtimeFor, stateSnapshotMismatch } = require('./production-request');
const productionRoute = require('../server/routes/production-request');
const input = { pipeline: 'codex-api', mode: '3_fixed_template', entries: [{ item: { path: 'D:\\source\\one' } }], templates: [{ id: 'T79' }] };
const SERVER_MODES = [
  { id: '1_replica_shuffle', label: '复刻重组' },
  { id: '2_random_template', label: '随机模板' },
  { id: '3_fixed_template', label: '固定模板' }
];
const CONFIGURATION_REVISION = `sha256:${'a'.repeat(64)}`;
const workbenchHtml = fs.readFileSync(require.resolve('./index.html'), 'utf8');

test('workbench presents two named production routes and keeps Gemini as historical read-only', () => {
  assert.match(workbenchHtml, /aria-label="选择产线"/);
  const onlineTab = workbenchHtml.match(/<button class="prod-line-tab[^>]*data-prod-line="cdp"[\s\S]*?<\/button>/)?.[0] || '';
  const localTab = workbenchHtml.match(/<button class="prod-line-tab[^>]*data-prod-line="codex"[\s\S]*?<\/button>/)?.[0] || '';
  const historyTab = workbenchHtml.match(/<button class="prod-line-tab[^>]*data-prod-line="gemini"[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(onlineTab, /在线模式（GPT 网页\/CDP）/);
  assert.match(onlineTab, /实例 A \/ B/);
  assert.match(localTab, /本地模式（Codex 客户端）/);
  assert.match(historyTab, /历史记录（Gemini 已停用）/);
  assert.doesNotMatch(onlineTab + localTab, /GPT CDP 产线|Codex API 产线/);
});

function stateSnapshot() {
  const modes = SERVER_MODES.map((mode) => ({ ...mode }));
  const templateOptions = ['T79', 'T80'].map((id, index) => ({
    id, label: `服务端母版 ${id}`,
    referenceHashes: { P1: String(index + 1).repeat(64), P2: String(index + 3).repeat(64) }
  }));
  const catalog = [
    { id: 'cdp', label: '在线模式（GPT 网页/CDP）', instances: [{ id: 'A', pipeline: 'cdp-a', label: 'CDP A' }, { id: 'B', pipeline: 'cdp-b', label: 'CDP B' }] },
    { id: 'codex-api', label: '本地模式（Codex 客户端）', instances: [{ id: 'default', pipeline: 'codex-api', label: '当前客户端' }] },
    { id: 'gemini', label: '历史记录（Gemini 已停用）', instances: [{ id: 'default', pipeline: 'gemini', label: 'Gemini（已停用）' }] }
  ];
  const execution = (pipeline, mode) => pipeline === 'codex-api'
    ? { state: 'HOST_AGENT_REQUIRED', label: '需由当前 Codex 对话执行', reason: '工作台没有原生生图接口。' }
    : pipeline === 'gemini'
      ? { state: 'DISABLED_BY_USER', label: '用户已停用', reason: 'Gemini 团建生产已停止；历史记录仅供查看。' }
      : mode === '3_fixed_template'
        ? { state: 'ADAPTER_PRESENT_RUNTIME_UNVERIFIED', label: '执行器待运行核验', reason: '运行会话尚未核验。' }
        : { state: 'EXECUTOR_NOT_CONNECTED', label: '执行器未接入', reason: '此模式尚无执行器。' };
  const asOfUtc = new Date().toISOString();
  return {
    ok: true, schemaVersion: 4, asOfUtc,
    selectionSchemaVersion: 1, configurationRevision: CONFIGURATION_REVISION,
    catalog: { lines: catalog, modes },
    capabilities: { revision: 'production-capabilities-v4', selectionSchemaVersion: 1,
      configurationRevision: CONFIGURATION_REVISION, declaredProfileRevision: null,
      declaredProfileRevisionState: 'NOT_DECLARED', profileState: 'READABLE', lines: catalog.map((line) => ({
      ...line, instances: line.instances.map((instance) => ({ ...instance, modes: modes.map((mode) => ({
        mode: mode.id,
        selection: { schemaVersion: 1, pipeline: instance.pipeline, mode: mode.id,
          templateCandidates: templateOptions.map((option) => option.id), selectedTemplateId: null,
          selectedTemplateReferenceSha256: null, configurationRevision: CONFIGURATION_REVISION },
        registration: { state: instance.pipeline === 'gemini' ? 'DISABLED_BY_USER' : 'READY',
          label: instance.pipeline === 'gemini' ? '用户已停用；仅保留历史记录' : '可登记请求',
          templateCandidateCount: templateOptions.length, templateOptions },
        execution: execution(instance.pipeline, mode.id)
      })) }))
    })) },
    runtime: productionRoute.productionRuntimeSnapshot({ DATA_ROOT: path.join(__dirname, 'missing-production-profile') }, null, asOfUtc),
    requests: [], omittedInvalidCount: 0, requestLimit: 20
  };
}
test('version mismatch is reported explicitly while a compatible state has no mismatch', () => {
  assert.equal(stateSnapshotMismatch(stateSnapshot()), '');
  assert.match(stateSnapshotMismatch({ ...stateSnapshot(), schemaVersion: 3,
    capabilities: { ...stateSnapshot().capabilities, revision: 'production-capabilities-v3' } }),
  /界面需要产线状态 v4，服务返回 v3（production-capabilities-v3）/);
  assert.match(stateSnapshotMismatch({ ...stateSnapshot(), capabilities: { ...stateSnapshot().capabilities, revision: 'production-capabilities-v3' } }),
    /界面需要 production-capabilities-v4，服务返回 production-capabilities-v3/);
  const missingRevisionState = { ...stateSnapshot(), capabilities: { ...stateSnapshot().capabilities } };
  delete missingRevisionState.capabilities.declaredProfileRevisionState;
  assert.match(stateSnapshotMismatch(missingRevisionState),
    /服务声明 production-capabilities-v4，但缺少 capabilities\.declaredProfileRevisionState/);
  assert.equal(stateSnapshotMismatch({ ok: false, error: 'unavailable' }), '');
});
test('active CDP/Codex modes remain selectable while Gemini is disabled in every mode', () => {
  for (const pipeline of ['codex-api', 'cdp-a', 'cdp-b']) {
    for (const mode of ['1_replica_shuffle', '2_random_template', '3_fixed_template']) {
      const templates = mode === '2_random_template' ? [{ id: 'T79' }, { id: 'T80' }] : [{ id: 'T79' }];
      const request = payload({ ...input, snapshot: stateSnapshot(), pipeline, mode, templates });
      assert.equal(request.sourcePath, input.entries[0].item.path);
      assert.deepEqual(request.selection, {
        schemaVersion: 1, pipeline, mode,
        templateCandidates: mode === '2_random_template' ? ['T79', 'T80'] : ['T79'],
        selectedTemplateId: mode === '2_random_template' ? null : 'T79',
        selectedTemplateReferenceSha256: mode === '2_random_template' ? null
          : { P1: '1'.repeat(64), P2: '3'.repeat(64) },
        configurationRevision: CONFIGURATION_REVISION
      });
    }
  }
  const snapshot = stateSnapshot();
  for (const mode of ['1_replica_shuffle', '2_random_template', '3_fixed_template']) {
    const capability = snapshot.capabilities.lines.find((line) => line.id === 'gemini').instances[0].modes
      .find((item) => item.mode === mode);
    assert.equal(capability.registration.state, 'DISABLED_BY_USER');
    assert.equal(capability.execution.state, 'DISABLED_BY_USER');
    assert.throws(() => payload({ ...input, snapshot, pipeline: 'gemini', mode,
      templates: mode === '2_random_template' ? [{ id: 'T79' }, { id: 'T80' }] : [{ id: 'T79' }] }),
    /用户已停用/);
  }
});
test('no selection, multiple folders or name-only template cannot register', () => {
  for (const change of [{ mode: '' }, { entries: [] }, { entries: [...input.entries, ...input.entries] }, { templates: [{ name: 'T79' }] }, { templates: [] }]) {
    assert.throws(() => payload({ ...input, snapshot: stateSnapshot(), ...change }));
  }
  assert.throws(() => payload({ ...input, snapshot: stateSnapshot(), mode: '2_random_template', templates: [] }));
  assert.throws(() => payload({ ...input, snapshot: stateSnapshot(), mode: '2_random_template', templates: [{ id: 'T79' }] }));
  assert.throws(() => payload({ ...input, snapshot: stateSnapshot(), templates: [{ id: 'NOT-IN-SERVER' }] }), /后端当前核验/);
});
test('server receipt must include immutable file identity and source count', () => {
  const snapshot = stateSnapshot();
  const expected = payload({ ...input, snapshot });
  const selection = { ...expected.selection };
  const valid = { ok: true, status: 'PREPARED_NOT_GENERATED', completed: false, requestId: 'r1', requestPath: 'D:\\requests\\r1.json', sourceCount: 8,
    pipeline: 'codex-api', mode: '3_fixed_template', templateId: 'T79', selection };
  assert.match(readback(valid, snapshot, expected.selection), /尚未生成/);
  assert.match(readback(valid, snapshot, expected.selection), /固定模板/);
  for (const change of [{ ok: false }, { status: 'COMPLETE' }, { completed: true }, { requestPath: '' }, { sourceCount: 0 }, { requestId: '' }]) {
    assert.throws(() => readback({ ...valid, ...change }, snapshot, expected.selection));
  }
  assert.throws(() => readback({ ...valid, selection: { ...selection, configurationRevision: `sha256:${'0'.repeat(64)}` } }, snapshot, expected.selection), /配置revision不一致/);
  const randomPayload = payload({ ...input, snapshot, mode: '2_random_template', templates: [{ id: 'T79' }, { id: 'T80' }] });
  const randomSelection = { ...randomPayload.selection, selectedTemplateId: 'T79', selectedTemplateReferenceSha256: { P1: '1'.repeat(64), P2: '3'.repeat(64) } };
  const randomReceipt = { ...valid, mode: '2_random_template', selection: randomSelection, templateId: 'T79' };
  assert.match(readback(randomReceipt, snapshot, randomPayload.selection), /尚未生成/);
});

test('workflow projection never advances generation or delivery without evidence', () => {
  const empty = workflowStages({});
  assert.equal(empty.find((stage) => stage.id === 'production').state, 'blocked');
  assert.equal(empty.find((stage) => stage.id === 'delivery').state, 'pending');
  const ready = workflowStages({ folderCount: 1, templateCount: 1 });
  assert.equal(ready.find((stage) => stage.id === 'material').state, 'done');
  assert.equal(ready.find((stage) => stage.id === 'template').state, 'done');
  assert.equal(ready.find((stage) => stage.id === 'request').state, 'current');
  assert.equal(ready.find((stage) => stage.id === 'production').state, 'blocked');
  const registered = workflowStages({ folderCount: 1, templateCount: 1, requestSaved: true });
  assert.equal(registered.find((stage) => stage.id === 'request').state, 'done');
  assert.equal(registered.find((stage) => stage.id === 'production').state, 'blocked');
  assert.equal(workflowStages({ folderCount: 2 }).find((stage) => stage.id === 'material').state, 'attention');
  const randomReady = workflowStages({ folderCount: 1, templateCount: 2, mode: '2_random_template' });
  assert.equal(randomReady.find((stage) => stage.id === 'template').state, 'done');
  assert.equal(randomReady.find((stage) => stage.id === 'request').state, 'current');
  assert.equal(workflowStages({ folderCount: 1, templateCount: 1, mode: '2_random_template' }).find((stage) => stage.id === 'template').state, 'current');
});

test('request view model labels a saved request as not generated and preserves its evidence paths', () => {
  const model = requestViewModel({
    requestId: 'abcdef1234567890', requestPath: 'D:\\requests\\request.json',
    sourcePath: 'D:\\materials\\complete-set', templateId: 'T40', mode: '3_fixed_template', sourceCount: 7,
    status: 'PREPARED_NOT_GENERATED', completed: false, modifiedAt: '2026-10-09T07:00:00Z'
  });
  assert.equal(model.sourceName, 'complete-set');
  assert.equal(model.shortId, 'abcdef123456');
  assert.equal(model.statusLabel, '已登记 · 等执行器领取');
  assert.equal(model.lifecycleSummary, '请求已保存；尚未收到执行器领取或生图回执。');
  assert.equal(model.nextStepLabel, '执行能力未核实');
  assert.equal(model.executionState, 'UNVERIFIED');
  assert.equal(model.completed, false);
  for (const change of [{ status: '' }, { sourceCount: 0 }, { requestPath: '' }]) {
    assert.equal(requestViewModel({
      requestId: 'abcdef1234567890', requestPath: 'D:\\requests\\request.json',
      sourcePath: 'D:\\materials\\complete-set', templateId: 'T40', mode: '3_fixed_template', sourceCount: 7,
      status: 'PREPARED_NOT_GENERATED', completed: false, ...change
    }), null);
  }
  const completed = requestViewModel({
    requestId: 'finished-request', requestPath: 'D:\\requests\\finished.json',
    sourcePath: 'D:\\materials\\complete-set', mode: '3_fixed_template', sourceCount: 7,
    status: 'COMPLETE', completed: true
  });
  assert.equal(completed.statusLabel, 'COMPLETE');
  assert.equal(completed.completed, true);
});

test('request card maps host claim and generated receipt without claiming QA or delivery', () => {
  const base = { requestId: 'abcdef1234567890', requestPath: 'D:\\requests\\request.json',
    sourcePath: 'D:\\materials\\complete-set', pipeline: 'codex-api', templateId: 'T40',
    mode: '3_fixed_template', sourceCount: 7, completed: false };
  const claimed = requestViewModel({ ...base, status: 'CLAIMED_NOT_STARTED', lifecycle: {
    claimState: 'CLAIMED', generationState: 'NOT_REPORTED', generatedPages: 0,
    qaState: 'NOT_REPORTED', deliveryState: 'NOT_REPORTED'
  } }, stateSnapshot());
  assert.equal(claimed.statusLabel, '执行器已领取 · 尚无生图回执');
  assert.match(claimed.lifecycleSummary, /没有生图实物回执/);
  const generated = requestViewModel({ ...base, status: 'GENERATED_PENDING_QA', lifecycle: {
    claimState: 'CLAIMED', generationState: 'GENERATED_PENDING_QA', generatedPages: 6,
    qaState: 'NOT_REPORTED', deliveryState: 'NOT_REPORTED'
  } }, stateSnapshot());
  assert.equal(generated.statusLabel, '已生成 · 待质检');
  assert.equal(generated.generatedPages, 6);
  assert.match(generated.lifecycleSummary, /6 页生成回执已登记/);
  assert.equal(generated.qaState, 'NOT_REPORTED');
  assert.equal(generated.deliveryState, 'NOT_REPORTED');
  assert.equal(generated.completed, false);
});

test('request card projects execution state from the same backend snapshot, never from fixed client text', () => {
  const snapshot = stateSnapshot();
  assert.equal(validateStateSnapshot(snapshot), true);
  const record = {
    requestId: 'abcdef1234567890', requestPath: 'D:\\requests\\request.json',
    sourcePath: 'D:\\materials\\complete-set', pipeline: 'codex-api', templateId: 'T40',
    mode: '3_fixed_template', sourceCount: 7, status: 'PREPARED_NOT_GENERATED', completed: false
  };
  const model = requestViewModel(record, snapshot);
  assert.equal(model.registrationLabel, '可登记请求');
  assert.equal(model.executionState, 'HOST_AGENT_REQUIRED');
  assert.equal(model.executionLabel, '需由当前 Codex 对话执行');
  assert.equal(model.executionReason, '工作台没有原生生图接口。');
  assert.equal(runtimeFor(snapshot, 'cdp-a').state, 'UNCONFIGURED');
  assert.equal(runtimeFor(snapshot, 'codex-api').state, 'UNOBSERVED');
  assert.equal(runtimeFor(snapshot, 'gemini').state, 'DISABLED_BY_USER');
  assert.equal(validateStateSnapshot({ ...snapshot, schemaVersion: 2 }), false);
  assert.equal(validateStateSnapshot({ ...snapshot, capabilities: { ...snapshot.capabilities, revision: 'production-capabilities-v2' } }), false);
  assert.equal(validateStateSnapshot({ ...snapshot, catalog: { ...snapshot.catalog, modes: [] } }), false);
  assert.equal(validateStateSnapshot({ ...snapshot, capabilities: { ...snapshot.capabilities, lines: snapshot.capabilities.lines.slice(0, 2) } }), false);
  assert.equal(validateStateSnapshot({ ...snapshot, catalog: { ...snapshot.catalog,
    lines: snapshot.catalog.lines.map((line) => line.id === 'gemini' ? { ...line, instances: [] } : line) } }), false);
  const gemini = requestViewModel({ ...record, pipeline: 'gemini' }, snapshot);
  assert.equal(gemini.statusLabel, '已停用 · 历史只读');
  assert.equal(gemini.executionState, 'DISABLED_BY_USER');
  assert.equal(gemini.executionLabel, '用户已停用');
  assert.equal(gemini.nextStepLabel, '只读历史');
  assert.equal(requestViewModel({ ...record, pipeline: 'cdp-a' }, snapshot).executionState, 'ADAPTER_PRESENT_RUNTIME_UNVERIFIED');
});

test('frontend accepts server-published catalog additions without a second hardcoded catalog', () => {
  const snapshot = stateSnapshot();
  const sourceModes = snapshot.capabilities.lines[0].instances[0].modes;
  const instance = { id: 'default', pipeline: 'experimental-line', label: '实验线', modes: structuredClone(sourceModes)
    .map((mode) => ({ ...mode, selection: { ...mode.selection, pipeline: 'experimental-line' } })) };
  snapshot.catalog.lines.push({ id: 'experimental', label: '实验产线', instances: [
    { id: instance.id, pipeline: instance.pipeline, label: instance.label }
  ] });
  snapshot.capabilities.lines.push({ id: 'experimental', label: '实验产线', instances: [instance] });
  const experimentalSource = { id: 'experimental-runtime', label: '实验执行器', state: 'UNCONNECTED',
    stateLabel: '执行器未接入', staleAfterSeconds: null, observedAtUtc: null, ageSeconds: null, detail: '执行器未接入。' };
  snapshot.runtime.sources.push(experimentalSource);
  snapshot.runtime.executors.push({ pipeline: 'experimental-line', instanceId: 'default', state: 'UNCONNECTED',
    stateLabel: '执行器未接入', observedAtUtc: null, ageSeconds: null, reportedState: null,
    queueRemaining: null, lastCompletedAt: null, lastCompletedTitle: null,
    detail: '执行器未接入。', sourceId: experimentalSource.id });
  assert.equal(validateStateSnapshot(snapshot), true);
  const request = payload({ ...input, snapshot, pipeline: 'experimental-line' });
  assert.equal(request.selection.pipeline, 'experimental-line');
});

test('prepare selection is rejected when capability candidates or revision disagree with the current snapshot', () => {
  const base = stateSnapshot();
  const staleRevision = structuredClone(base);
  staleRevision.capabilities.lines[0].instances[0].modes[0].selection.configurationRevision = `sha256:${'f'.repeat(64)}`;
  assert.equal(validateStateSnapshot(staleRevision), false);
  assert.throws(() => payload({ ...input, snapshot: staleRevision }), /统一后端能力状态/);

  const wrongCandidates = structuredClone(base);
  wrongCandidates.capabilities.lines[0].instances[0].modes[0].selection.templateCandidates = ['T79'];
  assert.equal(validateStateSnapshot(wrongCandidates), false);
  assert.throws(() => payload({ ...input, snapshot: wrongCandidates }), /统一后端能力状态/);
});

test('prepare selection fails closed for stale capability snapshots', () => {
  const stale = stateSnapshot();
  stale.asOfUtc = new Date(Date.now() - 60_001).toISOString();
  assert.equal(validateStateSnapshot(stale), true, 'shape is valid even though the observation is stale');
  assert.throws(() => payload({ ...input, snapshot: stale }), /快照已过期/);
});

test('unknown backend request states remain visible instead of being silently omitted', () => {
  const record = {
    requestId: 'abcdef1234567890', requestPath: 'D:\\requests\\request.json',
    sourcePath: 'D:\\materials\\complete-set', pipeline: 'codex-api', templateId: 'T40',
    mode: '3_fixed_template', sourceCount: 7, status: 'PROVIDER_STATE_NEW', completed: false
  };
  const model = requestViewModel(record, stateSnapshot());
  assert.ok(model);
  assert.equal(model.statusLabel, 'PROVIDER_STATE_NEW');
  assert.equal(model.modeLabel, '固定模板');
});

test('registration only matches the exact current pipeline, folder and template', () => {
  const record = {
    requestId: 'abcdef1234567890', requestPath: 'D:\\requests\\request.json',
    sourcePath: 'D:\\materials\\complete-set', templateId: 'T40', mode: '3_fixed_template', pipeline: 'codex-api', sourceCount: 7,
    status: 'PREPARED_NOT_GENERATED', completed: false
  };
  assert.ok(findMatchingRequest([record], {
    pipeline: 'codex-api', mode: '3_fixed_template', sourcePath: 'd:/materials/COMPLETE-set/', templateId: 'T40'
  }));
  assert.equal(findMatchingRequest([record], {
    pipeline: 'codex-api', mode: '3_fixed_template', sourcePath: 'D:\\materials\\another-set', templateId: 'T40'
  }), null);
  assert.equal(findMatchingRequest([record], {
    pipeline: 'codex-api', mode: '3_fixed_template', sourcePath: record.sourcePath, templateId: 'T41'
  }), null);
  assert.equal(findMatchingRequest([record], {
    pipeline: 'cdp-a', mode: '3_fixed_template', sourcePath: record.sourcePath, templateId: 'T40'
  }), null);
  assert.equal(findMatchingRequest([{ ...record, status: 'COMPLETE', completed: true }], {
    pipeline: 'codex-api', mode: '3_fixed_template', sourcePath: record.sourcePath, templateId: 'T40'
  }), null);
  assert.equal(findMatchingRequest([record], {
    pipeline: 'codex-api', mode: '1_replica_shuffle', sourcePath: record.sourcePath, templateId: 'T40'
  }), null);
  const random = { ...record, mode: '2_random_template', templateId: 'T40', templateCandidates: ['T40', 'T41'] };
  assert.ok(findMatchingRequest([random], {
    pipeline: 'codex-api', mode: '2_random_template', sourcePath: record.sourcePath, templateCandidates: ['T41', 'T40']
  }));
});

test('cross-panel template selection requires an exact real template ID', () => {
  const catalog = [{ id: 'T40', name: 'Saved template' }];
  assert.equal(resolveTemplateSelection('T40', catalog), catalog[0]);
  assert.equal(resolveTemplateSelection('Saved template', catalog), null);
  assert.equal(resolveTemplateSelection('T404', catalog), null);
  assert.equal(resolveTemplateSelection('', catalog), null);
});

test('Codex panel describes request registration without claiming automatic production', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const start = html.indexOf('id="codexProductionPanel"');
  const end = html.indexOf('<section class="view" id="templateMigrationView">', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const panel = html.slice(start, end);
  assert.match(panel, /一份完整素材，做成一套完整作品/);
  assert.match(panel, /一个素材文件夹和一个真实母版/);
  assert.match(panel, /登记这套制作请求/);
  assert.match(panel, /最近登记的作品/);
  assert.match(panel, /尚未开始生图/);
  assert.match(panel, /固定模板对话操作包/);
  assert.match(panel, /id="codexContentTemplateMode"/);
  assert.match(panel, /随机模板至少选两套候选母版/);
  assert.match(panel, /首次设置母版/);
  assert.match(panel, /制作本套素材/);
  assert.match(panel, /不.*新建对话、附文件或启动生图/);
  assert.match(panel, /换新对话要重新附母版/);
  assert.match(panel, /自动领取、真实生图、质检、成品入库和飞书登记仍未接通/);
  for (const stage of ['material', 'template', 'request', 'production', 'delivery']) {
    assert.match(panel, new RegExp(`data-codex-stage="${stage}"`));
  }
  assert.doesNotMatch(panel, /全自动 Codex API 交付流水线|自动化批跑|后台自动生成|无缝入库/);
});

test('fixed-template session kit follows real single-template and single-folder selections', () => {
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const start = app.indexOf('  let codexManualPromptMode = "setup";');
  const end = app.indexOf('  function currentCodexRequestSelection()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const preview = { value: '' };
  const copy = { disabled: true };
  const status = { dataset: {}, textContent: '' };
  const tabs = ['setup', 'material'].map((mode) => ({
    dataset: { codexManualPromptMode: mode },
    classList: { toggle() {} },
    setAttribute() {}
  }));
  const nodes = new Map([
    ['codexManualPromptPreview', preview], ['codexCopyManualPromptBtn', copy], ['codexManualPromptStatus', status]
  ]);
  const template = { id: 'T79', name: '四宫格母版', images: [
    { name: '模板-P1.jpg', path: 'D:\\templates\\P1.jpg' },
    { name: '模板-P2.jpg', path: 'D:\\templates\\P2.jpg' }
  ] };
  let entries = [{ item: { path: 'D:\\source\\one', images: [{ name: 'cover.jpg' }, { name: 'p1.jpg' }] } }];
  const context = vm.createContext({
    window: { TBFixedTemplateSession: require('./fixed-template-session') },
    document: { getElementById: (id) => nodes.get(id) || null, querySelectorAll: () => tabs },
    selectedGptTestTemplates: () => [template],
    selectedGptTestEntries: () => entries
  });
  vm.runInContext(`${app.slice(start, end)}\nrefreshCodexManualPrompt();`, context);
  assert.match(preview.value, /P1 是封面，P2 是内页/);
  assert.equal(copy.disabled, false);
  vm.runInContext('codexManualPromptMode = "material"; refreshCodexManualPrompt();', context);
  assert.ok(preview.value.includes('D:\\source\\one'));
  assert.match(preview.value, /cover\.jpg/);
  assert.equal(copy.disabled, false);
  entries = [];
  vm.runInContext('refreshCodexManualPrompt();', context);
  assert.equal(copy.disabled, true);
  assert.match(status.textContent, /完整素材文件夹/);
});
