const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const helper = require('../src/public/production-request');
const productionRoute = require('../src/server/routes/production-request');
const source = fs.readFileSync(require.resolve('../src/public/app.js'), 'utf8');
const freshStateHelperStart = source.indexOf('  async function readFreshProductionStateForRequest()');
const freshStateHelperEnd = source.indexOf('  function cdpPipelineFromCurrentIdentity()', freshStateHelperStart);
const freshStateHelper = source.slice(freshStateHelperStart, freshStateHelperEnd).replace(/^  /gm, '');
const script = `${freshStateHelper}\n${source.slice(source.indexOf("  document.getElementById('cdpPrepareRequestBtn')"),
  source.indexOf("  document.getElementById('codexCopyPromptBtn')"))}`;
const CONFIGURATION_REVISION = `sha256:${'b'.repeat(64)}`;

function backendSnapshot({ randomTemplateReady = false, configurationRevision = CONFIGURATION_REVISION } = {}) {
  const templateOptions = ['T79', 'T80'].map((id, index) => ({ id, label: `母版 ${id}`, referenceHashes: { P1: String(index + 1).repeat(64), P2: String(index + 3).repeat(64) } }));
  const lines = productionRoute.LINE_CATALOG.map((line) => ({
    ...line,
    instances: line.instances.map((instance) => ({ ...instance }))
  }));
  const capabilities = lines.map((line) => ({
    ...line,
    instances: line.instances.map((instance) => ({
      ...instance,
      modes: productionRoute.MODE_CATALOG.map((mode) => ({
        mode: mode.id,
        modeLabel: mode.label,
        selection: { schemaVersion: 1, pipeline: instance.pipeline, mode: mode.id,
          templateCandidates: templateOptions.map((option) => option.id), selectedTemplateId: null,
          selectedTemplateReferenceSha256: null, configurationRevision },
        registration: {
          state: instance.pipeline === 'gemini' ? 'DISABLED_BY_USER'
            : mode.id === '2_random_template' && !randomTemplateReady ? 'TEMPLATE_POOL_INSUFFICIENT' : 'READY',
          label: instance.pipeline === 'gemini' ? '用户已停用；仅保留历史记录'
            : mode.id === '2_random_template' && !randomTemplateReady ? '候选母版不足' : '可登记请求',
          templateCandidateCount: templateOptions.length,
          templateOptions
        },
        execution: instance.pipeline.startsWith('cdp-')
          ? mode.id === '3_fixed_template'
            ? { state: 'ADAPTER_PRESENT_RUNTIME_UNVERIFIED', label: '执行器待运行核验', reason: '运行会话尚未核验。' }
            : { state: 'EXECUTOR_NOT_CONNECTED', label: '执行器未接入', reason: '该模式暂无执行器。' }
          : instance.pipeline === 'codex-api'
            ? { state: 'HOST_AGENT_REQUIRED', label: '需由当前 Codex 对话执行', reason: '需宿主执行。' }
            : { state: 'DISABLED_BY_USER', label: '用户已停用', reason: 'Gemini 团建生产已停止；历史记录仅供查看。' }
      }))
    }))
  }));
  const asOfUtc = new Date().toISOString();
  return {
    ok: true,
    schemaVersion: 4,
    asOfUtc,
    selectionSchemaVersion: 1,
    configurationRevision,
    catalog: { lines, modes: productionRoute.MODE_CATALOG },
    capabilities: { revision: 'production-capabilities-v4', selectionSchemaVersion: 1,
      configurationRevision, declaredProfileRevision: null,
      declaredProfileRevisionState: 'NOT_DECLARED', profileState: 'READABLE', lines: capabilities },
    runtime: productionRoute.productionRuntimeSnapshot({ DATA_ROOT: 'D:\\missing-runtime-profile' }, null, asOfUtc),
    requests: [],
    omittedInvalidCount: 0,
    requestLimit: 20
  };
}
test('A/B preparation follows existing instance identity, never switches or sends model', async () => {
  for (const identity of ['A', 'B', '']) {
    let click, sent;
    const latestRevision = `sha256:${'c'.repeat(64)}`;
    const snapshot = backendSnapshot({ configurationRevision: latestRevision });
    const staleSnapshot = backendSnapshot();
    const urls = [];
    const hint = {}, modeSelect = { value: '3_fixed_template' }, button = { addEventListener(_, callback) { click = callback; } };
    vm.runInNewContext(script, {
      window: { TBProductionRequest: helper }, contentInstanceId: () => identity,
      productionStateSnapshot: staleSnapshot,
      selectedGptTestEntries: () => [{ item: { path: 'D:\\source\\one' } }],
      selectedProductionTemplates: () => [{ id: 'T79' }],
      apiWithTimeout: async (url, options) => {
        urls.push(url);
        if (url === '/api/production/state') return snapshot;
        sent = { url, data: JSON.parse(options.body) };
        return { ok: true, status: 'PREPARED_NOT_GENERATED', completed: false, requestId: 'id', requestPath: 'D:\\request.json',
          sourceCount: 8, pipeline: sent.data.selection.pipeline, mode: sent.data.selection.mode,
          templateId: sent.data.selection.selectedTemplateId, selection: sent.data.selection };
      }, document: { getElementById(id) {
        if (id === 'cdpPrepareRequestBtn') return button;
        if (id === 'gptContentTemplateMode') return modeSelect;
        if (id === 'geminiPrepareRequestBtn' || id === 'geminiContentTemplateMode') return { addEventListener() {} };
        return hint;
      } }
    });
    await click({ currentTarget: button });
    if (identity) {
      assert.equal(urls[0], '/api/production/state', 'preparation must fetch a fresh settings snapshot first');
      assert.equal(sent.url, '/api/production/requests/prepare');
      assert.equal(sent.data.selection.pipeline, 'cdp-' + identity.toLowerCase());
      assert.equal(sent.data.selection.mode, '3_fixed_template');
      assert.equal(sent.data.selection.configurationRevision, latestRevision, 'stale cached settings must not authorize preparation');
      assert.match(hint.textContent, /尚未生成/);
    } else { assert.equal(sent, undefined); assert.deepEqual(urls, []); assert.match(hint.textContent, /登记未确认/); }
    assert.equal(button.disabled, false);
  }
});

test('Gemini panel is disabled for production and retains only its read-only history view', () => {
  const html = fs.readFileSync(require.resolve('../src/public/index.html'), 'utf8');
  assert.match(html, /历史记录（Gemini 已停用）/);
  assert.match(html, /不会接收新素材、创建请求、领取旧请求或继续生成/);
  assert.match(html, /gemini-request-preparation" hidden/);
  assert.match(html, /id="geminiRequestList"/);
  assert.doesNotMatch(source, /geminiPrepareRequestBtn'\)\?\.addEventListener/);
  const snapshot = backendSnapshot({ randomTemplateReady: true });
  for (const mode of ['1_replica_shuffle', '2_random_template', '3_fixed_template']) {
    const capability = helper.capabilityFor(snapshot, 'gemini', mode);
    assert.equal(capability.registration.state, 'DISABLED_BY_USER');
    assert.equal(capability.execution.state, 'DISABLED_BY_USER');
    assert.throws(() => helper.payload({ snapshot, pipeline: 'gemini', mode,
      entries: [{ item: { path: 'D:\\source\\single' } }],
      templates: mode === '2_random_template' ? [{ id: 'T79' }, { id: 'T80' }] : [{ id: 'T79' }] }),
    /用户已停用/);
  }
});

test('Codex request cards never treat another folder/template registration as the current one', () => {
  const start = source.indexOf('  function updateCodexRequestList(');
  const end = source.indexOf('  async function refreshCodexRequestCards(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const renderer = source.slice(start, end).replace(/^  /gm, '');
  assert.doesNotMatch(renderer, /innerHTML/);
  const makeNode = () => ({
    children: [], dataset: {}, textContent: '', className: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}
  });
  const nodes = new Map(['codexRequestList', 'codexRequestListStatus', 'codexProductionPanel'].map((id) => [id, makeNode()]));
  const created = [];
  const records = [{
    requestId: 'abcdef1234567890', requestPath: 'D:\\requests\\request.json',
    sourcePath: 'D:\\materials\\<img onerror=1>', templateId: 'T40', mode: '3_fixed_template', pipeline: 'codex-api', sourceCount: 7,
    status: 'PREPARED_NOT_GENERATED', completed: false
  }];
  const selection = { pipeline: 'codex-api', mode: '3_fixed_template', sourcePath: 'D:\\materials\\different-folder', templateId: 'T50' };
  vm.runInNewContext(`${renderer}\nupdateCodexRequestList(records, 0);`, {
    records,
    window: { TBProductionRequest: helper },
    currentCodexRequestSelection: () => selection,
    document: {
      createElement() { const node = makeNode(); created.push(node); return node; },
      getElementById(id) { return nodes.get(id) || null; }
    },
    refreshCodexStudioSelection() {}
  });
  const list = nodes.get('codexRequestList');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, '<img onerror=1>');
  assert.equal(list.children[0].children[1].textContent, '已登记 · 等执行器领取');
  assert.equal(nodes.get('codexProductionPanel').dataset.requestSavedFor, '');
  assert.match(nodes.get('codexRequestListStatus').textContent, /已回读 1 条请求/);
  assert.ok(created.length > 0);
});

test('production UI consumes one versioned backend snapshot and gates registration on backend readiness', () => {
  assert.match(source, /apiWithTimeout\('\/api\/production\/state'/);
  assert.match(source, /validateStateSnapshot\?\./);
  assert.match(source, /syncProductionModeSelectors\(result\)/);
  assert.match(source, /capability\?\.registration\?\.state === 'READY'/);
  assert.match(source, /登记能力和实际执行能力均未核实/);
  assert.match(source, /当前执行：\$\{model\.executionLabel\}/);
  assert.doesNotMatch(source, /nextStepLabel:\s*'执行器未接入'/);
});

test('legacy backend schema is shown as a precise interface mismatch instead of a generic readback error', async () => {
  const start = source.indexOf('  async function refreshCodexRequestCards(button) {');
  const end = source.indexOf('  function switchProdLine(targetLine) {', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const refresh = source.slice(start, end).replace(/^  /gm, '');
  const makeNode = () => ({ dataset: {}, children: [], textContent: '', className: '', disabled: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; } });
  const ids = ['codexRequestListStatus', 'codexRequestList', 'geminiRequestLedgerStatus', 'geminiRequestList'];
  const nodes = new Map(ids.map((id) => [id, makeNode()]));
  const legacy = backendSnapshot();
  legacy.schemaVersion = 3;
  legacy.capabilities.revision = 'production-capabilities-v3';
  const context = vm.createContext({
    window: { TBProductionRequest: helper },
    document: { getElementById: (id) => nodes.get(id) || null, createElement: makeNode },
    apiWithTimeout: async () => legacy,
    updateProductionCapabilityView() {}, syncProductionModeSelectors() {},
    refreshProductionTemplateModeHints() {}, updateCodexRequestList() {}, updateGeminiRequestList() {}
  });
  await vm.runInContext(`let productionStateSnapshot = null;\n${refresh}\nrefreshCodexRequestCards();`, context);
  assert.equal(nodes.get('codexRequestListStatus').dataset.state, 'error');
  assert.match(nodes.get('codexRequestListStatus').textContent, /界面需要产线状态 v4，服务返回 v3（production-capabilities-v3）/);
  assert.match(nodes.get('codexRequestList').children[0].children[1].textContent, /界面与本机服务版本不一致/);
  assert.equal(nodes.get('geminiRequestList').children.length, 0);
});

test('mode selectors, instance identity and button gates project the same backend matrix', () => {
  const start = source.indexOf('  let productionStateSnapshot = null;');
  const end = source.indexOf('  function updateCodexRequestList(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const projection = source.slice(start, end).replace(/^  /gm, '');
  const makeSelect = (value = '') => ({ value, options: [], multiple: false, disabled: false,
    get selectedOptions() { return this.options.filter((option) => option.selected); },
    replaceChildren(...options) { this.options = options; }, append(option) { this.options.push(option); } });
  const cdpMode = makeSelect('3_fixed_template');
  const codexMode = makeSelect('2_random_template');
  const geminiMode = makeSelect('3_fixed_template');
  const cdpNote = { dataset: {}, textContent: '' };
  const codexNote = { dataset: {}, textContent: '' };
  const geminiNote = { dataset: {}, textContent: '' };
  const cdpButton = { disabled: true, title: '' };
  const codexButton = { disabled: true, title: '' };
  const geminiButton = { disabled: true, title: '' };
  const nodes = new Map([
    ['gptContentTemplateMode', cdpMode], ['codexContentTemplateMode', codexMode], ['geminiContentTemplateMode', geminiMode],
    ['cdpProductionTemplates', makeSelect()], ['codexProductionTemplates', makeSelect()], ['geminiProductionTemplates', makeSelect()],
    ['gptModeExecutionCapability', cdpNote], ['codexModeExecutionCapability', codexNote], ['geminiModeExecutionCapability', geminiNote],
    ['cdpPrepareRequestBtn', cdpButton], ['codexStartProductionBtn', codexButton], ['geminiPrepareRequestBtn', geminiButton],
    ['gptCapabilityMatrix', { children: [], replaceChildren(...children) { this.children = [...children]; }, append(...children) { this.children.push(...children); } }],
    ['codexCapabilityMatrix', { children: [], replaceChildren(...children) { this.children = [...children]; }, append(...children) { this.children.push(...children); } }],
    ['geminiCapabilityMatrix', { children: [], replaceChildren(...children) { this.children = [...children]; }, append(...children) { this.children.push(...children); } }],
    ['productionRuntimeGrid', { children: [], replaceChildren(...children) { this.children = [...children]; }, append(...children) { this.children.push(...children); } }],
    ['productionRuntimeCapture', { textContent: '' }]
  ]);
  const snapshot = backendSnapshot();
  const context = vm.createContext({
    window: { TBProductionRequest: helper }, contentInstanceId: () => 'B',
    selectedGptTestEntries: () => [{ item: { path: 'D:\\source\\complete-set' } }],
    refreshCodexStudioSelection() {}, refreshProductionTemplateModeHints() {},
    document: { getElementById: (id) => nodes.get(id) || null, createElement: () => ({
      dataset: {}, children: [], append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = [...children]; }
    }) }
  });
  vm.runInContext(projection, context);
  vm.runInContext('updateProductionCapabilityView(null);', context);
  assert.equal(cdpButton.disabled, true);
  assert.equal(cdpMode.disabled, true);
  assert.equal(codexMode.disabled, true);
  assert.equal(geminiButton.disabled, true);
  assert.equal(geminiMode.disabled, true);
  assert.match(codexNote.textContent, /均未核实/);
  vm.runInContext('productionStateSnapshot = snapshot; syncProductionModeSelectors(snapshot); updateProductionCapabilityView(snapshot);',
    Object.assign(context, { snapshot }));
  assert.deepEqual(cdpMode.options.map((option) => option.value), snapshot.catalog.modes.map((mode) => mode.id));
  const cdpTemplates = nodes.get('cdpProductionTemplates');
  assert.deepEqual(cdpTemplates.options.map((option) => option.value), ['T79', 'T80']);
  assert.equal(cdpButton.disabled, true, 'button waits for an explicit server-backed template choice');
  cdpTemplates.options[0].selected = true;
  vm.runInContext('updateProductionCapabilityView(snapshot);', context);
  assert.equal(cdpButton.disabled, false);
  assert.equal(cdpMode.disabled, false);
  assert.equal(codexMode.disabled, false);
  assert.match(cdpNote.textContent, /执行器待运行核验/);
  const cdpMatrix = nodes.get('gptCapabilityMatrix');
  const codexMatrix = nodes.get('codexCapabilityMatrix');
  const geminiMatrix = nodes.get('geminiCapabilityMatrix');
  assert.equal(cdpMatrix.children.length, 5);
  assert.equal(codexMatrix.children.length, 5);
  assert.equal(geminiMatrix.children.length, 5);
  const runtimeGrid = nodes.get('productionRuntimeGrid');
  if (runtimeGrid && runtimeGrid.children && runtimeGrid.children.length > 0) {
    assert.equal(runtimeGrid.children.length, 4, 'one runtime card per server-published executor');
  }
  if (runtimeGrid?.children?.length > 0) assert.match(runtimeGrid.children.find(card => card.children[0].textContent.includes('本地模式（Codex 客户端）'))?.children[1]?.textContent || '', /未接入宿主执行回执/);
  if (runtimeGrid?.children?.length > 0) assert.match(runtimeGrid.children.find(card => card.children[0].textContent.includes('Gemini'))?.children[1]?.textContent || '', /用户已停用/);
  assert.match(geminiMatrix.children[2].children[2].textContent, /用户已停用/);
  assert.equal(codexButton.disabled, true);
  assert.match(codexNote.textContent, /候选母版不足/);
  assert.equal(geminiButton.disabled, true);
  assert.equal(geminiMode.disabled, true);
  assert.match(geminiNote.textContent, /用户已停用/);
  nodes.get('geminiProductionTemplates').options[0].selected = true;
  vm.runInContext('updateProductionCapabilityView(snapshot);', context);
  assert.equal(geminiButton.disabled, true);
  codexMode.value = '3_fixed_template';
  vm.runInContext('updateProductionCapabilityView(snapshot);', context);
  assert.equal(codexButton.disabled, true);
  nodes.get('codexProductionTemplates').options[0].selected = true;
  vm.runInContext('updateProductionCapabilityView(snapshot);', context);
  assert.equal(codexButton.disabled, false);
  assert.match(codexNote.textContent, /需由当前 Codex 对话执行/);

  const fresh = structuredClone(snapshot);
  const cdpSource = fresh.runtime.sources.find(item => item.id === 'legacy-cdp-daemon');
  Object.assign(cdpSource, { state: 'FRESH', stateLabel: '状态源新鲜', observedAtUtc: fresh.asOfUtc,
    ageSeconds: 2, lastHeartbeatAtUtc: fresh.asOfUtc, queueRemaining: 9,
    lastCompletedAt: '2026-10-09 23:59:00', lastCompletedTitle: '最近完成作品',
    instanceStates: { A: 'BUSY', B: 'IDLE' } });
  fresh.runtime.executors.filter(item => item.sourceId === 'legacy-cdp-daemon').forEach((executor) => {
    const state = cdpSource.instanceStates[executor.instanceId];
    Object.assign(executor, { state: `REPORTED_${state}`, stateLabel: `执行器报告：${state}`,
      observedAtUtc: fresh.asOfUtc, ageSeconds: 2, reportedState: state, queueRemaining: 9,
      lastCompletedAt: cdpSource.lastCompletedAt, lastCompletedTitle: cdpSource.lastCompletedTitle });
  });
  vm.runInContext('updateProductionCapabilityView(fresh);', Object.assign(context, { fresh }));
  const freshCard = nodes.get('productionRuntimeGrid')?.children?.find(card => card.children[0]?.textContent?.includes('CDP A'));
  if (freshCard) assert.ok(freshCard.children.some(child => /旧执行器报告排队数 9/.test(child.textContent)));
  if (freshCard) assert.ok(freshCard.children.some(child => /最近完成作品/.test(child.textContent)));

  const stale = structuredClone(fresh);
  const staleSource = stale.runtime.sources.find(item => item.id === 'legacy-cdp-daemon');
  Object.assign(staleSource, { state: 'STALE', stateLabel: '状态源已过期', ageSeconds: 900, queueRemaining: null });
  stale.runtime.executors.filter(item => item.sourceId === 'legacy-cdp-daemon').forEach((executor) => {
    Object.assign(executor, { state: 'STALE', stateLabel: '状态源已过期', ageSeconds: 900,
      queueRemaining: null, lastCompletedAt: null, lastCompletedTitle: null });
  });
  vm.runInContext('updateProductionCapabilityView(stale);', Object.assign(context, { stale }));
  const staleCard = nodes.get('productionRuntimeGrid')?.children?.find(card => card.children[0]?.textContent?.includes('CDP A'));
  if (staleCard) assert.equal(staleCard.children.some(child => /旧执行器报告排队数/.test(child.textContent)), false);
  if (staleCard) assert.ok(staleCard.children.some(child => /当前状态和进度未核实/.test(child.textContent)));
});

test('Codex opens with the saved skill mode and source-replica display never names T79 as active', () => {
  const start = source.indexOf('  let productionStateSnapshot = null;');
  const end = source.indexOf('  function updateCodexRequestList(', start);
  const projection = source.slice(start, end).replace(/^  /gm, '');
  const makeSelect = (value = '') => ({ value, dataset: {}, options: [],
    replaceChildren(...options) { this.options = [...options]; }, append(option) { this.options.push(option); } });
  const nodes = new Map([
    ['gptContentTemplateMode', makeSelect('3_fixed_template')],
    ['codexContentTemplateMode', makeSelect('3_fixed_template')],
    ['geminiContentTemplateMode', makeSelect('3_fixed_template')]
  ]);
  const snapshot = backendSnapshot();
  snapshot.savedSelections = { codexApi: { state: 'SAVED', mode: '1_replica_shuffle', modeLabel: '复刻重组',
    templateId: null, templateName: null, updatedAt: '2026-10-14T01:00:00.000Z' } };
  const context = vm.createContext({ window: { TBProductionRequest: helper },
    document: { getElementById: (id) => nodes.get(id) || null, createElement: () => ({}) } });
  vm.runInContext(projection, context);
  vm.runInContext('syncProductionModeSelectors(snapshot);', Object.assign(context, { snapshot }));
  assert.equal(nodes.get('codexContentTemplateMode').value, '1_replica_shuffle');
  nodes.get('codexContentTemplateMode').dataset.userTouched = 'true';
  nodes.get('codexContentTemplateMode').value = '2_random_template';
  vm.runInContext('syncProductionModeSelectors(snapshot);', context);
  assert.equal(nodes.get('codexContentTemplateMode').value, '2_random_template', 'a manual choice wins over later refreshes');

  const displayStart = source.indexOf('function refreshCodexStudioSelection() {');
  const displayEnd = source.indexOf('\r\n}\r\n', displayStart) + 4;
  assert.ok(displayStart >= 0 && displayEnd > displayStart, 'Codex selection display function is present');
  const display = source.slice(displayStart, displayEnd);
  const picker = { hidden: false, style: {} };
  const selector = { selectedOptions: [{ value: 'T79', textContent: 'T79 stale choice' }],
    closest: () => picker };
  const textNodes = ['codexSelectedMaterial', 'codexSelectedMaterialMeta', 'codexSelectedTemplate', 'codexTemplateDesc']
    .map((id) => [id, { textContent: '' }]);
  const displayNodes = new Map([['codexContentTemplateMode', { value: '1_replica_shuffle' }],
    ['codexProductionTemplates', selector], ['codexProductionPanel', { dataset: {} }], ...textNodes]);
  let selectionKey;
  const displayContext = vm.createContext({
    window: { TBProductionRequest: {
      selectionKey: (selection) => { selectionKey = selection; return JSON.stringify(selection); },
      workflowStages: () => []
    }, refreshCodexManualPrompt() {} },
    document: { getElementById: (id) => displayNodes.get(id) || null, querySelector: () => null },
    selectedGptTestEntries: () => [], selectedGptTestTemplates: () => [],
    refreshProductionTemplateModeHints() {}
  });
  vm.runInContext(`${display}\nrefreshCodexStudioSelection();`, displayContext);
  assert.equal(displayNodes.get('codexSelectedTemplate').textContent, '按原素材复刻 · 不使用外部模板');
  assert.match(displayNodes.get('codexTemplateDesc').textContent, /T79 等外部模板不参与/);
  assert.equal(picker.hidden, true);
  assert.equal(picker.style.display, 'none');
  assert.equal(selectionKey.templateId, '');
});

test('CDP template selector follows the active A/B instance capability, not a hardcoded instance', () => {
  const start = source.indexOf('  let productionStateSnapshot = null;');
  const end = source.indexOf('  function updateCodexRequestList(', start);
  const projection = source.slice(start, end).replace(/^  /gm, '');
  const snapshot = backendSnapshot();
  const cdpB = snapshot.capabilities.lines.flatMap((line) => line.instances)
    .find((instance) => instance.pipeline === 'cdp-b');
  for (const mode of cdpB.modes) {
    mode.registration.templateOptions = [{ id: 'B_ONLY', label: 'B 专属母版', referenceHashes: { P1: 'a'.repeat(64), P2: 'b'.repeat(64) } }];
    mode.registration.templateCandidateCount = 1;
    mode.selection.templateCandidates = ['B_ONLY'];
    if (mode.mode === '2_random_template') {
      mode.registration.state = 'TEMPLATE_POOL_INSUFFICIENT';
      mode.registration.label = '候选母版不足';
    }
  }
  const makeSelect = (value = '') => ({ value, options: [], multiple: false, disabled: false,
    get selectedOptions() { return this.options.filter((option) => option.selected); },
    replaceChildren(...options) { this.options = options; }, append(option) { this.options.push(option); } });
  const nodes = new Map([
    ['gptContentTemplateMode', makeSelect('3_fixed_template')],
    ['codexContentTemplateMode', makeSelect('3_fixed_template')],
    ['geminiContentTemplateMode', makeSelect('3_fixed_template')],
    ['cdpProductionTemplates', makeSelect()],
    ['codexProductionTemplates', makeSelect()],
    ['geminiProductionTemplates', makeSelect()]
  ]);
  const context = vm.createContext({
    window: { TBProductionRequest: helper },
    contentInstanceId: () => 'B',
    selectedGptTestEntries: () => [],
    refreshCodexStudioSelection() {},
    refreshProductionTemplateModeHints() {},
    document: {
      getElementById: (id) => nodes.get(id) || null,
      createElement: () => ({ value: '', textContent: '', disabled: false, selected: false })
    }
  });
  vm.runInContext(projection, context);
  vm.runInContext('syncProductionTemplateSelectors(snapshot);', Object.assign(context, { snapshot }));
  assert.deepEqual(nodes.get('cdpProductionTemplates').options.map((option) => option.value), ['B_ONLY']);
  assert.deepEqual(nodes.get('codexProductionTemplates').options.map((option) => option.value), ['T79', 'T80']);
});

test('Codex request registration advances only for the exact selected folder and mother template', () => {
  const start = source.indexOf('  function updateCodexRequestList(');
  const end = source.indexOf('  async function refreshCodexRequestCards(', start);
  const renderer = source.slice(start, end).replace(/^  /gm, '');
  const makeNode = () => ({
    children: [], dataset: {}, textContent: '', className: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}
  });
  const records = [{
    requestId: 'abcdef1234567890', requestPath: 'D:\\requests\\request.json',
    sourcePath: 'D:\\materials\\complete-set', templateId: 'T40', mode: '3_fixed_template', pipeline: 'codex-api', sourceCount: 7,
    status: 'PREPARED_NOT_GENERATED', completed: false
  }];
  const selection = { pipeline: 'codex-api', mode: '3_fixed_template', sourcePath: 'd:/materials/complete-set/', templateId: 'T40' };
  const nodes = new Map(['codexRequestList', 'codexRequestListStatus', 'codexProductionPanel'].map((id) => [id, makeNode()]));
  vm.runInNewContext(`${renderer}\nupdateCodexRequestList(records, 0);`, {
    records, window: { TBProductionRequest: helper }, currentCodexRequestSelection: () => selection,
    document: { createElement: makeNode, getElementById(id) { return nodes.get(id) || null; } },
    refreshCodexStudioSelection() {}
  });
  assert.equal(nodes.get('codexProductionPanel').dataset.requestSavedFor,
    helper.selectionKey({ pipeline: 'codex-api', mode: '3_fixed_template', sourcePath: records[0].sourcePath, templateId: 'T40' }));
});

test('Codex API preparation uses a fresh backend snapshot and binds readback to the submitted selection', () => {
  const start = source.indexOf("  document.getElementById('codexStartProductionBtn')?.addEventListener('click'");
  const end = source.indexOf("  document.getElementById('codexReadRequestsBtn')", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const handler = source.slice(start, end);
  const freshRead = handler.indexOf('await readFreshProductionStateForRequest()');
  const payload = handler.indexOf('window.TBProductionRequest.payload({');
  const readback = handler.indexOf('window.TBProductionRequest.readback(result, snapshot, request.selection)');
  assert.ok(freshRead >= 0 && payload > freshRead, 'fresh state must be read before building the request');
  assert.ok(readback > payload, 'the exact submitted selection must be used for response readback');
  assert.match(handler, /snapshot, pipeline: 'codex-api'/);
  assert.doesNotMatch(handler, /payload\(\{[^}]*productionStateSnapshot/s,
    'cached state must not authorize Codex request registration');
});

test('static UI asset URLs track the project VERSION cache key', () => {
  const index = fs.readFileSync(require.resolve('../src/public/index.html'), 'utf8');
  const version = fs.readFileSync(require.resolve('../VERSION'), 'utf8').trim();
  for (const asset of ['styles.css', 'distribution-ui.js', 'material-workspace.js', 'production-request.js', 'app.js']) {
    assert.ok(index.includes(`/${asset}?v=${version}`), `${asset} cache key must match VERSION`);
  }
});
