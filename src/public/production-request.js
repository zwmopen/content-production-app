(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TBProductionRequest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function uniqueNonEmpty(items, getId) {
    if (!Array.isArray(items) || !items.length) return false;
    const ids = items.map(getId);
    return ids.every((id) => typeof id === 'string' && id.trim()) && new Set(ids).size === ids.length;
  }
  function catalogLine(snapshot, lineId) {
    return snapshot?.catalog?.lines?.find((line) => line?.id === lineId) || null;
  }
  function catalogMode(snapshot, modeId) {
    return snapshot?.catalog?.modes?.find((mode) => mode?.id === modeId) || null;
  }
  function catalogPipeline(snapshot, pipelineId) {
    return snapshot?.catalog?.lines?.flatMap((line) => line?.instances || [])
      .find((instance) => instance?.pipeline === pipelineId) || null;
  }
  const REPORTED_EXECUTOR_STATES = new Set(['ONLINE', 'IDLE', 'BUSY', 'PRODUCING', 'ERROR', 'OFFLINE', 'COOLDOWN', 'UNKNOWN']);
  const RUNTIME_SOURCE_STATES = new Set(['FRESH', 'STALE', 'UNAVAILABLE', 'UNCONFIGURED', 'UNOBSERVED', 'UNCONNECTED']);
  const DISABLED_PIPELINES = new Set(['gemini']);
  const SELECTION_SCHEMA_VERSION = 1;
  const MAX_SELECTION_SNAPSHOT_AGE_MS = 60_000;
  const REQUEST_STATUS_LABELS = Object.freeze({
    PREPARED_NOT_GENERATED: '已登记 · 等执行器领取',
    CLAIMED_NOT_STARTED: '执行器已领取 · 尚无生图回执',
    GENERATED_PENDING_QA: '已生成 · 待质检',
    PACKAGE_VERIFIED_PENDING_DELIVERY: '整套已核验 · 待交付',
    PACKAGE_CHANGED_AFTER_VERIFICATION: '验收后文件有变 · 待复核',
    OUTPUT_CHANGED_AFTER_RECEIPT: '回执后文件有变化 · 需复核',
    OUTPUT_MISSING_AFTER_RECEIPT: '回执文件缺失 · 需处理',
    GENERATION_EVIDENCE_INVALID: '生成回执异常 · 需复核'
  });
  function validConfigurationRevision(value) {
    return value === null || (typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value));
  }
  function savedModeFor(snapshot, pipeline) {
    const selection = pipeline === 'codex-api' ? snapshot?.savedSelections?.codexApi : null;
    return selection?.state === 'SAVED' && catalogMode(snapshot, selection.mode) ? selection : null;
  }
  function validSavedSelections(snapshot) {
    if (snapshot.savedSelections === undefined) return true;
    const value = snapshot.savedSelections?.codexApi;
    if (!value || !['SAVED', 'UNVERIFIED'].includes(value.state)) return false;
    if (value.state === 'UNVERIFIED') return value.mode === null && value.templateId === null && value.templateName === null;
    if (!catalogMode(snapshot, value.mode)
      || typeof value.modeLabel !== 'string' || !value.modeLabel.trim()
      || (value.updatedAt !== null && (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))))) return false;
    if (value.mode === '3_fixed_template') return value.templateId === null || typeof value.templateId === 'string';
    return value.templateId === null && value.templateName === null;
  }
  function selectionSnapshotFresh(snapshot, now = Date.now()) {
    const observed = Date.parse(snapshot?.asOfUtc || '');
    const age = now - observed;
    return Number.isFinite(observed) && age >= -30_000 && age <= MAX_SELECTION_SNAPSHOT_AGE_MS;
  }
  function validNullableDate(value) {
    return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
  }
  function runtimeFor(snapshot, pipeline) {
    return snapshot?.runtime?.executors?.find((executor) => executor?.pipeline === pipeline) || null;
  }
  function validRuntimeSnapshot(snapshot) {
    const runtime = snapshot.runtime;
    if (!runtime || runtime.revision !== 'production-runtime-v1'
      || typeof runtime.capturedAtUtc !== 'string' || !Number.isFinite(Date.parse(runtime.capturedAtUtc))
      || !uniqueNonEmpty(runtime.sources, (source) => source?.id)
      || !uniqueNonEmpty(runtime.executors, (executor) => executor?.pipeline)) return false;
    const validSource = runtime.sources.every((source) => typeof source.label === 'string' && source.label.trim()
      && RUNTIME_SOURCE_STATES.has(source.state) && typeof source.stateLabel === 'string'
      && typeof source.detail === 'string' && source.detail.trim()
      && (source.staleAfterSeconds === null || (Number.isInteger(source.staleAfterSeconds) && source.staleAfterSeconds > 0))
      && validNullableDate(source.observedAtUtc)
      && (source.ageSeconds === null || (Number.isInteger(source.ageSeconds) && source.ageSeconds >= 0))
      && (source.lastHeartbeatAtUtc === undefined || validNullableDate(source.lastHeartbeatAtUtc))
      && (source.queueRemaining === undefined || source.queueRemaining === null
        || (Number.isInteger(source.queueRemaining) && source.queueRemaining >= 0))
      && (source.lastCompletedAt === undefined || source.lastCompletedAt === null || typeof source.lastCompletedAt === 'string')
      && (source.lastCompletedTitle === undefined || source.lastCompletedTitle === null || typeof source.lastCompletedTitle === 'string')
      && (source.instanceStates === undefined || (source.instanceStates && ['A', 'B'].every((id) =>
        REPORTED_EXECUTOR_STATES.has(source.instanceStates[id])))));
    const expectedPipelines = snapshot.catalog.lines.flatMap((line) => line.instances.map((instance) => instance.pipeline)).sort();
    const actualPipelines = runtime.executors.map((executor) => executor?.pipeline).sort();
    const sourceIds = new Set(runtime.sources.map((source) => source.id));
    const validExecutors = runtime.executors.every((executor) => typeof executor.instanceId === 'string' && executor.instanceId.trim()
      && typeof executor.state === 'string' && executor.state.trim()
      && typeof executor.stateLabel === 'string' && executor.stateLabel.trim()
      && typeof executor.detail === 'string' && executor.detail.trim()
      && typeof executor.sourceId === 'string' && sourceIds.has(executor.sourceId)
      && validNullableDate(executor.observedAtUtc)
      && (executor.ageSeconds === null || (Number.isInteger(executor.ageSeconds) && executor.ageSeconds >= 0))
      && (executor.reportedState === null || REPORTED_EXECUTOR_STATES.has(executor.reportedState))
      && (executor.queueRemaining === null || (Number.isInteger(executor.queueRemaining) && executor.queueRemaining >= 0))
      && (executor.lastCompletedAt === null || typeof executor.lastCompletedAt === 'string')
      && (executor.lastCompletedTitle === null || typeof executor.lastCompletedTitle === 'string'));
    return validSource && validExecutors && JSON.stringify(actualPipelines) === JSON.stringify(expectedPipelines)
      && runtime.executors.every((executor) => {
        const catalogInstance = catalogPipeline(snapshot, executor.pipeline);
        return catalogInstance?.id === executor.instanceId;
      });
  }
  function validateStateSnapshot(snapshot) {
    if (!snapshot || snapshot.ok !== true || snapshot.schemaVersion !== 4
      || typeof snapshot.asOfUtc !== 'string' || !Number.isFinite(Date.parse(snapshot.asOfUtc))
      || snapshot.selectionSchemaVersion !== SELECTION_SCHEMA_VERSION
      || !validConfigurationRevision(snapshot.configurationRevision)
      || !Array.isArray(snapshot.catalog?.lines) || !Array.isArray(snapshot.catalog?.modes)
      || !Array.isArray(snapshot.capabilities?.lines) || !Array.isArray(snapshot.requests)
      || snapshot.capabilities.revision !== 'production-capabilities-v4'
      || snapshot.capabilities.selectionSchemaVersion !== SELECTION_SCHEMA_VERSION
      || snapshot.capabilities.configurationRevision !== snapshot.configurationRevision
      || !validConfigurationRevision(snapshot.capabilities.configurationRevision)
      || !['NOT_DECLARED', 'UNVERIFIED'].includes(snapshot.capabilities.declaredProfileRevisionState)
      || !['READABLE', 'UNVERIFIED'].includes(snapshot.capabilities.profileState)
      || !validSavedSelections(snapshot)
      || !Number.isInteger(snapshot.omittedInvalidCount) || snapshot.omittedInvalidCount < 0
      || !Number.isInteger(snapshot.requestLimit) || snapshot.requestLimit < 1
      || !validRuntimeSnapshot(snapshot)) return false;
    if (!uniqueNonEmpty(snapshot.catalog.lines, (line) => line?.id)
      || !uniqueNonEmpty(snapshot.catalog.modes, (mode) => mode?.id)
      || !snapshot.catalog.lines.every((line) => typeof line?.label === 'string' && line.label.trim()
        && uniqueNonEmpty(line.instances, (instance) => instance?.id)
        && uniqueNonEmpty(line.instances, (instance) => instance?.pipeline))
      || !snapshot.catalog.modes.every((mode) => typeof mode?.label === 'string' && mode.label.trim())) return false;
    const lineIds = snapshot.catalog.lines.map((line) => line?.id);
    const modeIds = snapshot.catalog.modes.map((mode) => mode?.id);
    const validModes = (modes, pipeline) => Array.isArray(modes) && modes.length === modeIds.length
      && new Set(modes.map((item) => item?.mode)).size === modes.length
      && modeIds.every((mode) => modes.some((item) => item?.mode === mode
        && item.selection?.schemaVersion === SELECTION_SCHEMA_VERSION
        && item.selection.pipeline === pipeline && item.selection.mode === mode
        && Array.isArray(item.selection.templateCandidates)
        && item.selection.selectedTemplateId === null && item.selection.selectedTemplateReferenceSha256 === null
        && item.selection.configurationRevision === snapshot.configurationRevision
        && JSON.stringify([...item.selection.templateCandidates].sort()) === JSON.stringify(
          item.registration?.templateOptions?.map((option) => option?.id).sort())
        && typeof item.registration?.state === 'string' && typeof item.registration?.label === 'string'
        && Array.isArray(item.registration?.templateOptions)
        && Number.isInteger(item.registration?.templateCandidateCount)
        && item.registration.templateCandidateCount === item.registration.templateOptions.length
        && new Set(item.registration.templateOptions.map((option) => option?.id)).size === item.registration.templateOptions.length
        && item.registration.templateOptions.every((option) => typeof option?.id === 'string' && option.id.trim()
          && typeof option?.label === 'string' && option.label.trim()
          && ['P1', 'P2'].every((page) => /^[a-f0-9]{64}$/.test(option.referenceHashes?.[page] || '')))
        && typeof item.execution?.state === 'string' && typeof item.execution?.label === 'string'));
    if (!uniqueNonEmpty(snapshot.capabilities.lines, (line) => line?.id)
      || !snapshot.capabilities.lines.every((line) => typeof line?.label === 'string' && line.label.trim()
      && uniqueNonEmpty(line.instances, (instance) => instance?.id)
      && uniqueNonEmpty(line.instances, (instance) => instance?.pipeline)
      && line.instances.every((instance) => typeof instance.label === 'string' && instance.label.trim()
        && validModes(instance.modes, instance.pipeline)))) return false;
    if (snapshot.capabilities.lines.length !== lineIds.length) return false;
    return lineIds.every((lineId) => {
      const sourceLine = catalogLine(snapshot, lineId);
      const capabilityLine = snapshot.capabilities.lines.find((item) => item.id === lineId);
      if (!sourceLine || !capabilityLine) return false;
      const expected = sourceLine.instances.map((item) => [item.id, item.pipeline, item.label]).sort();
      const actual = capabilityLine.instances.map((item) => [item.id, item.pipeline, item.label]).sort();
      return JSON.stringify(actual) === JSON.stringify(expected);
    });
  }
  function stateSnapshotMismatch(snapshot) {
    if (!snapshot || snapshot.ok !== true) return '';
    if (snapshot.schemaVersion !== 4) {
      const actualSchema = Number.isInteger(snapshot.schemaVersion) ? `v${snapshot.schemaVersion}` : '未知版本';
      const actualRevision = typeof snapshot.capabilities?.revision === 'string' && snapshot.capabilities.revision.trim()
        ? `（${snapshot.capabilities.revision}）` : '';
      return `界面与本机服务版本不一致：界面需要产线状态 v4，服务返回 ${actualSchema}${actualRevision}。产线状态和请求登记暂不可用；需更新工作台服务后再试。`;
    }
    if (snapshot.capabilities?.revision !== 'production-capabilities-v4') {
      const actualRevision = typeof snapshot.capabilities?.revision === 'string' && snapshot.capabilities.revision.trim()
        ? snapshot.capabilities.revision : '未知版本';
      return `界面与本机服务版本不一致：界面需要 production-capabilities-v4，服务返回 ${actualRevision}。产线状态和请求登记暂不可用；需更新工作台服务后再试。`;
    }
    if (!['NOT_DECLARED', 'UNVERIFIED'].includes(snapshot.capabilities?.declaredProfileRevisionState)) {
      return '界面与本机服务版本不一致：服务声明 production-capabilities-v4，但缺少 capabilities.declaredProfileRevisionState。请在安全空闲后更新或重载工作台服务，再刷新产线状态。';
    }
    return '';
  }
  function capabilityFor(snapshot, pipeline, mode) {
    if (!validateStateSnapshot(snapshot) || !pipeline || !catalogMode(snapshot, mode)) return null;
    const line = snapshot.capabilities.lines.find((item) => item?.instances?.some((instance) => instance.pipeline === pipeline));
    const instance = line?.instances?.find((item) => item.pipeline === pipeline);
    return instance?.modes?.find((item) => item?.mode === mode) || null;
  }
  function payload({ snapshot, pipeline, mode, entries, templates, prompt = '' }) {
    if (!validateStateSnapshot(snapshot)) throw new Error('统一后端能力状态尚未读取，请刷新后再登记');
    if (!selectionSnapshotFresh(snapshot)) throw new Error('产线设置快照已过期，请重新读取状态后再登记');
    if (!catalogPipeline(snapshot, pipeline)) throw new Error('所选产线不在统一后端目录中');
    const capability = capabilityFor(snapshot, pipeline, mode);
    if (!capability) throw new Error('所选模式不在统一后端目录中');
    if (capability.registration?.state !== 'READY') throw new Error(capability.registration?.label || '当前设置尚不可登记');
    const selectionCapability = capability.selection;
    if (!selectionCapability || selectionCapability.schemaVersion !== SELECTION_SCHEMA_VERSION
      || selectionCapability.pipeline !== pipeline || selectionCapability.mode !== mode
      || selectionCapability.configurationRevision !== snapshot.configurationRevision
      || selectionCapability.selectedTemplateId !== null) {
      throw new Error('所选产线、模式或配置版本与后端当前状态不一致，请刷新后重试');
    }
    if (!Array.isArray(entries) || entries.length !== 1 || !entries[0]?.item?.path) {
      throw new Error('请只选择一个完整素材文件夹，再登记本套制作请求');
    }
    const templateIds = Array.isArray(templates)
      ? [...new Set(templates.map((template) => String(template?.id || '').trim()).filter(Boolean))]
      : [];
    const allowedTemplateIds = new Set(capability.registration.templateOptions.map((template) => template.id));
    if (templateIds.some((id) => !allowedTemplateIds.has(id))) {
      throw new Error('所选母版不在后端当前核验的模板列表中；请刷新状态并重新选择');
    }
    const availableTemplateIds = [...selectionCapability.templateCandidates].sort();
    if (JSON.stringify([...allowedTemplateIds].sort()) !== JSON.stringify(availableTemplateIds)) {
      throw new Error('当前模板候选列表与后端配置revision不一致，请刷新状态并重新选择');
    }
    if (mode === '2_random_template') {
      if (templateIds.length < 2) throw new Error('随机模板模式至少勾选两套不同的真实母版');
      return { sourcePath: entries[0].item.path, prompt: String(prompt), selection: {
        schemaVersion: SELECTION_SCHEMA_VERSION, pipeline, mode,
        templateCandidates: [...templateIds].sort(), selectedTemplateId: null,
        selectedTemplateReferenceSha256: null, configurationRevision: snapshot.configurationRevision
      } };
    }
    if (templateIds.length !== 1) throw new Error('复刻打乱/固定模板模式请只选择一个真实母版编号');
    const selectedOption = capability.registration.templateOptions.find((template) => template.id === templateIds[0]);
    if (!selectedOption || !['P1', 'P2'].every((page) => /^[a-f0-9]{64}$/.test(selectedOption.referenceHashes?.[page] || '')))
      throw new Error('已选母版缺少有效 P1/P2 哈希；未登记，请刷新状态后重选');
    return { sourcePath: entries[0].item.path, prompt: String(prompt), selection: {
      schemaVersion: SELECTION_SCHEMA_VERSION, pipeline, mode,
      templateCandidates: [templateIds[0]], selectedTemplateId: templateIds[0],
      selectedTemplateReferenceSha256: selectedOption.referenceHashes,
      configurationRevision: snapshot.configurationRevision
    } };
  }
  function readback(result, snapshot, expectedSelection = null) {
    if (result?.ok !== true || result.status !== 'PREPARED_NOT_GENERATED'
      || result.completed !== false || !result.requestId || !result.requestPath
      || !Number.isInteger(result.sourceCount) || result.sourceCount < 1 || !catalogMode(snapshot, result.mode)
      || !result.selection || result.selection.schemaVersion !== SELECTION_SCHEMA_VERSION) {
      throw new Error('未获得有效制作请求回执，不能认定登记成功');
    }
    const actual = result.selection;
    const expected = expectedSelection;
    const actualCandidates = Array.isArray(actual.templateCandidates) ? [...actual.templateCandidates].sort() : [];
    const expectedCandidates = Array.isArray(expected?.templateCandidates) ? [...expected.templateCandidates].sort() : [];
    if (!expected || actual.pipeline !== expected.pipeline || actual.mode !== expected.mode
      || result.pipeline !== expected.pipeline || result.mode !== expected.mode
      || actual.configurationRevision !== expected.configurationRevision
      || JSON.stringify(actualCandidates) !== JSON.stringify(expectedCandidates)
      || (expected.selectedTemplateId && actual.selectedTemplateId !== expected.selectedTemplateId)) {
      throw new Error('服务端回执与本次产线选择或配置revision不一致，登记未确认');
    }
    const capability = capabilityFor(snapshot, expected.pipeline, expected.mode);
    const selectedOption = capability?.registration?.templateOptions?.find((item) => item.id === actual.selectedTemplateId);
    if (!actual.selectedTemplateId || !selectedOption
      || !actualCandidates.includes(actual.selectedTemplateId)
      || JSON.stringify(actual.selectedTemplateReferenceSha256) !== JSON.stringify(selectedOption.referenceHashes)) {
      throw new Error('服务端回执中的已选母版/P1/P2哈希与当前快照不一致，登记未确认');
    }
    const selected = result.templateId ? `母版 ${result.templateId}` : '母版待核实';
    const pool = result.mode === '2_random_template' && Number.isInteger(result.candidateCount)
      ? `｜候选 ${result.candidateCount} 套` : '';
    return `已保存请求 ${result.requestId}｜${result.sourceCount} 张源图｜${catalogMode(snapshot, result.mode).label}｜${selected}${pool}｜尚未生成。${result.message || ''}\n请求文件：${result.requestPath}`;
  }
  function workflowStages({ folderCount = 0, templateCount = 0, requestSaved = false, mode = '3_fixed_template' } = {}) {
    const oneFolder = folderCount === 1;
    const oneTemplate = templateCount === 1;
    const templateReady = mode === '2_random_template' ? templateCount >= 2 : oneTemplate;
    const readyToRegister = oneFolder && templateReady;
    return [
      { id: 'material', state: oneFolder ? 'done' : folderCount > 1 ? 'attention' : 'pending' },
      { id: 'template', state: templateReady ? 'done' : templateCount > 1 ? 'attention' : oneFolder ? 'current' : 'pending' },
      { id: 'request', state: requestSaved ? 'done' : readyToRegister ? 'current' : 'pending' },
      { id: 'production', state: 'blocked' },
      { id: 'delivery', state: 'pending' }
    ];
  }
  function requestViewModel(record, snapshot = null) {
    if (!record || typeof record.status !== 'string' || !record.status.trim() || typeof record.completed !== 'boolean'
      || !record.requestId || !record.requestPath || !Number.isInteger(record.sourceCount) || record.sourceCount < 1
      || typeof record.sourcePath !== 'string' || !record.sourcePath.trim()
      || typeof record.mode !== 'string' || !record.mode.trim()) return null;
    const segments = record.sourcePath.split(/[\\/]/).filter(Boolean);
    const capability = capabilityFor(snapshot, record.pipeline, record.mode);
    const execution = capability?.execution;
    const disabled = DISABLED_PIPELINES.has(record.pipeline);
    return {
      id: record.requestId,
      shortId: record.requestId.slice(0, 12),
      sourceName: segments.at(-1) || '完整素材文件夹',
      sourcePath: record.sourcePath,
      requestPath: record.requestPath,
      templateId: String(record.templateId || '已登记母版'),
      templateCandidates: Array.isArray(record.templateCandidates) ? [...record.templateCandidates] : [],
      mode: record.mode,
      modeLabel: catalogMode(snapshot, record.mode)?.label || record.mode,
      candidateCount: Number.isInteger(record.candidateCount) ? record.candidateCount : 0,
      sourceCount: record.sourceCount,
      modifiedAt: String(record.modifiedAt || ''),
      statusLabel: disabled ? '已停用 · 历史只读' : REQUEST_STATUS_LABELS[record.status] || record.status,
      lifecycleSummary: disabled ? '产线已停用；此条仅供历史核对，不会继续执行。' : record.status === 'GENERATED_PENDING_QA'
        ? `${Number.isInteger(record.lifecycle?.generatedPages) ? record.lifecycle.generatedPages : 0} 页生成回执已登记；质检尚未回报。`
        : record.status === 'PACKAGE_VERIFIED_PENDING_DELIVERY' ? '整套图片与 11 版文案已核验；正式归档和云端交付尚未确认。'
          : record.status === 'PACKAGE_CHANGED_AFTER_VERIFICATION' ? '验收后文件发生变化，原合格记录已失效，需要重新核实。'
        : record.status === 'CLAIMED_NOT_STARTED' ? '执行器已领取；没有生图实物回执，不显示生图中。'
          : record.status === 'OUTPUT_CHANGED_AFTER_RECEIPT' || record.status === 'OUTPUT_MISSING_AFTER_RECEIPT'
            ? '生成回执与当前实物不一致，须复核后继续。'
            : record.status === 'GENERATION_EVIDENCE_INVALID' ? '生成回执不完整或不匹配，须复核。'
              : '请求已保存；尚未收到执行器领取或生图回执。',
      generatedPages: Number.isInteger(record.lifecycle?.generatedPages) ? record.lifecycle.generatedPages : 0,
      qaState: String(record.lifecycle?.qaState || 'NOT_REPORTED'),
      deliveryState: String(record.lifecycle?.deliveryState || 'NOT_REPORTED'),
      registrationLabel: disabled ? '用户已停用；仅保留历史记录' : capability?.registration?.label || '当前登记能力未核实',
      executionState: execution?.state || 'UNVERIFIED',
      executionLabel: execution?.label || '执行能力未核实',
      executionReason: execution?.reason || '请刷新统一产线状态；不能根据登记记录推断执行状态。',
      nextStepLabel: disabled ? '只读历史' : execution?.label || '执行能力未核实',
      completed: record.completed
    };
  }
  function operatorPrompt(requestId, origin) {
    const url = new URL(origin);
    if (!/^[a-f0-9]{64}$/.test(requestId || '') || url.protocol !== 'http:'
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('请使用本机工作台和完整任务编号');
    }
    return `使用 teambuilding-production-3modes 技能执行工作台已登记的本地模式任务。\n工作台：${url.origin}\n任务编号：${requestId}\n先用技能 scripts/workbench_operator.py read --url ${url.origin} --request-id ${requestId} 读取并核实任务；素材、模板、制作方式和补充要求以该任务为准，不重新随机选择，不转到旧队列。\n使用固定 worker UUID 领取任务；若已被其他执行者领取，先核对归属，不抢写。保留已有生成页，逐页调用原生生图并保存到本任务 outputs 目录。整套生成后提交 receipt 并回读；质检、11 版本文案、正式入库和飞书交付另行完成，不能把生成回执当成作品完成。\n若本机工作台无法读取或任务证据不一致，说明具体问题，不静默换任务。`;
  }
  function normalizeSourcePath(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    return value.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLocaleLowerCase('en-US');
  }
  function selectionKey(selection) {
    if (!selection) return '';
    const pipeline = String(selection.pipeline || '').trim().toLowerCase();
    const sourcePath = normalizeSourcePath(selection.sourcePath);
    const mode = String(selection.mode || '').trim();
    const templateId = String(selection.templateId || '').trim();
    const candidates = Array.isArray(selection.templateCandidates)
      ? [...new Set(selection.templateCandidates.map(value => String(value || '').trim()).filter(Boolean))].sort()
      : [];
    if (!pipeline || !sourcePath || !mode || (mode === '2_random_template' ? candidates.length < 2 : !templateId)) return '';
    return JSON.stringify([pipeline, sourcePath, mode,
      mode === '2_random_template' ? candidates : templateId]);
  }
  function findMatchingRequest(records, selection) {
    const targetKey = selectionKey(selection);
    if (!targetKey || !Array.isArray(records)) return null;
    return records.find((record) => record?.completed !== true
      && requestViewModel(record) && selectionKey(record) === targetKey) || null;
  }
  function resolveTemplateSelection(templateId, templates) {
    const id = String(templateId || '').trim();
    if (!id || !Array.isArray(templates)) return null;
    return templates.find((template) => template && template.id === id) || null;
  }
  return { validateStateSnapshot, stateSnapshotMismatch, selectionSnapshotFresh, capabilityFor, runtimeFor, savedModeFor, payload, readback, workflowStages, requestViewModel, operatorPrompt, selectionKey, findMatchingRequest, resolveTemplateSelection };
});
