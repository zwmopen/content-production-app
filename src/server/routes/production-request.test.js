"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const http = require("node:http");
const { createHash, randomUUID } = require("node:crypto");
const { prepare, validate, handle, listRequests, requestIdentity, claimRequest, submitGenerationReceipt, submitPackageReceipt,
  capabilitySnapshot, productionStateSnapshot, readLegacyCdpRuntime, LINE_CATALOG, MODE_CATALOG } = require("./production-request");
const { validateStateSnapshot } = require("../../public/production-request");
const { handle: existingRoute } = require("./production");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "real-production-request-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const material = path.join(root, "materials", "whole-set");
  const template = path.join(root, "templates", "T1");
  const template2 = path.join(root, "templates", "T2");
  const runtime = path.join(root, "runtime");
  [material, template, template2, runtime].forEach(p => fs.mkdirSync(p, { recursive: true }));
  execFileSync("python", ["-c", "from PIL import Image;import sys;from pathlib import Path; m,t,u=map(Path,sys.argv[1:]);Image.new('RGB',(12,16),'red').save(m/'1.png');Image.new('RGB',(12,16),'blue').save(m/'2.png');Image.new('RGB',(12,16),'green').save(t/'P1.png');Image.new('RGB',(12,16),'yellow').save(t/'P2.png');Image.new('RGB',(12,16),'purple').save(u/'P1.png');Image.new('RGB',(12,16),'orange').save(u/'P2.png')", material, template, template2]);
  const profile = { materialRoots: [path.join(root, "materials")], templates: { T1: { directory: template }, T2: { directory: template2 } } };
  fs.writeFileSync(path.join(runtime, "production-request-profile.json"), JSON.stringify(profile));
  const response = {};
  const ctx = { DATA_ROOT: runtime, pythonExe: () => "python", getBody: async () => "{}",
    sendJson: (_, data) => { response.data = data; }, send: (_, status, body) => { response.status = status; response.data = JSON.parse(body); } };
  return { root, material, template, runtime, profile, response, ctx,
    body: { pipeline: "codex-api", mode: "3_fixed_template", sourcePath: material, templateId: "T1", prompt: "保留原素材标题" } };
}

test('package endpoint verifies real local files and eleven copies but never claims delivery', async t => {
  const f = fixture(t), prepared = await prepare(f.body, f.ctx);
  const claim = claimRequest(prepared.requestId, { executorId: 'codex-host-agent', workerId: randomUUID() }, f.ctx).claim;
  const directory = path.dirname(prepared.requestPath);
  const request = JSON.parse(fs.readFileSync(prepared.requestPath));
  fs.mkdirSync(path.join(directory, 'outputs'));
  const outputPaths = request.sourceImages.map((_, i) => path.join(directory, 'outputs', `P${i + 1}.png`));
  execFileSync('python', ['-c', "from PIL import Image;import sys;[Image.new('RGB',(24,32),(1,2,i+3)).save(p) for i,p in enumerate(sys.argv[1:])]", ...outputPaths]);
  submitGenerationReceipt(prepared.requestId, { schemaVersion: 1, requestId: prepared.requestId,
    pipeline: 'codex-api', engine: 'native-imagegen', ...Object.fromEntries(['claimId', 'executorId', 'workerId'].map(k => [k, claim[k]])),
    outputs: outputPaths.map((nativePath, i) => ({ page: i + 1, sourceSha256: request.sourceImages[i].sha256,
      nativePath, nativeSha256: createHash('sha256').update(fs.readFileSync(nativePath)).digest('hex'), generationCallId: randomUUID() })) }, f.ctx);
  const scripts = path.resolve(__dirname, '../../../../../..', '.agents/skills/teambuilding-production-3modes/scripts');
  execFileSync('python', ['-c', `
import sys,json,hashlib
from pathlib import Path
from PIL import Image
sys.path.insert(0,sys.argv[2])
from test_verify_work_package import valid_copy
root=Path(sys.argv[1]); package=root/'package';package.mkdir()
request=json.loads((root/'request.json').read_text(encoding='utf8'));receipt=json.loads((root/'generation-receipt.json').read_text(encoding='utf8'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
write=lambda p,v:p.write_text(json.dumps(v),encoding='utf8')
pages=[];qa_pages=[]
for item in receipt['outputs']:
 p=package/('P%d.png'%item['page']);Image.new('RGB',(1086,1448),(item['page'],2,3)).save(p)
 source=request['sourceImages'][item['page']-1]
 review=dict(status='PASS',sourceSha256=source['sha256'],approvedOutputTitle='Synthetic source-faithful title',approvedNames=[],visibleSourceElements=['synthetic verified visual element'])
 pages.append(dict(item,sourcePath=source['path'],path=str(p),sha256=sha(p),sourceFactReview=review))
 qa_pages.append(dict(page=item['page'],nativeSha256=item['nativeSha256'],sha256=sha(p),sourceFactReviewSha256=hashlib.sha256(json.dumps(review,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf8')).hexdigest(),detectedTitle=review['approvedOutputTitle'],visibleNames=[],crossPageContamination=False,unsupportedSpecificDetails=[],visualDisclosure='NOT_APPLICABLE',checks=dict.fromkeys(['facts','watermark','layout','sourceMapping','compositionDuplicateReview'],'PASS')))
copy=package/'copy.txt';copy.write_text(valid_copy(),encoding='utf8')
qa=package/'qa.json';write(qa,dict(requestId=request['requestId'],copySha256=sha(copy),copyCheck='PASS',reviewer='synthetic test',pages=qa_pages))
write(package/'manifest.json',dict(schemaVersion=1,requestId=request['requestId'],originalSourcePath=request['sourcePath'],pages=pages,copyFile=dict(path=str(copy),sha256=sha(copy)),qaReport=dict(path=str(qa),sha256=sha(qa))))
`, directory, scripts]);
  const manifestPath = path.join(directory, 'package', 'manifest.json');
  const body = { ...Object.fromEntries(['claimId', 'executorId', 'workerId'].map(k => [k, claim[k]])),
    manifestPath, manifestSha256: createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex') };
  const state = await submitPackageReceipt(prepared.requestId, body, f.ctx);
  assert.equal(state.status, 'PACKAGE_VERIFIED_PENDING_DELIVERY'); assert.equal(state.completed, false);
  assert.equal((await submitPackageReceipt(prepared.requestId, body, f.ctx)).idempotent, true);
  await assert.rejects(submitPackageReceipt(prepared.requestId, { ...body, workerId: randomUUID() }, f.ctx), /领取凭证/);
  fs.writeFileSync(path.join(directory, 'package', 'copy.txt'), 'changed');
  assert.equal(listRequests(f.ctx).requests[0].status, 'PACKAGE_CHANGED_AFTER_VERIFICATION');
});

test("active CDP and Codex lines prepare requests across three modes without model execution", async t => {
  const f = fixture(t);
  for (const [line, expectedLine] of [["CDP_A", "cdp-a"], ["CDP_B", "cdp-b"], ["Codex API", "codex-api"]]) {
    for (const mode of ["1_replica_shuffle", "2_random_template", "3_fixed_template"]) {
    const panelMappings = { "1.png": [2, 1], "2.png": [2, 1] };
    const result = await prepare({ ...f.body, pipeline: line, mode,
      ...(mode === "1_replica_shuffle" ? { templateId: undefined, panelMappings } : {}),
      ...(mode === "2_random_template" ? { templateId: undefined, templateCandidates: ["T1", "T2"] } : {}) }, f.ctx);
    assert.equal(result.status, "PREPARED_NOT_GENERATED"); assert.equal(result.completed, false);
    assert.equal(result.pipeline, expectedLine); assert.equal(result.mode, mode);
    assert.equal(result.sourceCount, 2); assert.match(result.requestId, /^[a-f0-9]{64}$/);
    const request = JSON.parse(fs.readFileSync(result.requestPath));
    assert.equal(request.userInstruction, f.body.prompt); assert.equal(request.expectedPages, 2);
    assert.equal(request.modeEvidence.strategy, mode);
    assert.equal(request.template.id, result.templateId);
    if (mode !== "1_replica_shuffle") assert.equal(request.modeEvidence.selectedTemplateId, result.templateId);
    assert.deepEqual(request.selection, {
      schemaVersion: 1, pipeline: expectedLine, mode,
      templateCandidates: request.modeEvidence.candidateTemplateIds || [],
      selectedTemplateId: result.templateId,
      selectedTemplateReferenceSha256: mode === "1_replica_shuffle" ? null : request.modeEvidence.candidateReferenceSha256[result.templateId],
      ...(mode === "1_replica_shuffle" ? { panelMappings } : {}),
      configurationRevision: capabilitySnapshot(f.ctx).configurationRevision
    });
    assert.deepEqual(result.selection, request.selection);
    if (mode === "2_random_template") assert.deepEqual(request.modeEvidence.candidateTemplateIds, ["T1", "T2"]);
    assert.equal(request.requirements.automaticAccountSwitchAllowed, false);
    assert.equal(request.requirements.localCollageAllowed, false);
    assert.ok(!fs.existsSync(path.join(path.dirname(result.requestPath), "generation-receipt.json")));
    }
  }
});
test("random template pool excludes metadata-ineligible candidates and binds eligibility evidence", async t => {
  const f = fixture(t);
  const template3 = path.join(f.root, "templates", "T3");
  fs.mkdirSync(template3, { recursive: true });
  execFileSync("python", ["-c", "from PIL import Image;import sys;from pathlib import Path;d=Path(sys.argv[1]);Image.new('RGB',(12,16),'black').save(d/'P1.png');Image.new('RGB',(12,16),'white').save(d/'P2.png')", template3]);
  fs.writeFileSync(path.join(f.template, "template.json"), JSON.stringify({ templateQuality: { eligibility: "pending_review" } }));
  f.profile.templates.T3 = { directory: template3 };
  fs.writeFileSync(path.join(f.runtime, "production-request-profile.json"), JSON.stringify(f.profile));
  const prepared = await prepare({ pipeline: "codex-api", mode: "2_random_template", sourcePath: f.material,
    templateCandidates: ["T1", "T2", "T3"], prompt: "保留原素材标题" }, f.ctx);
  const request = JSON.parse(fs.readFileSync(prepared.requestPath, "utf8"));
  assert.deepEqual(request.modeEvidence.candidatePoolInputIds, ["T1", "T2", "T3"]);
  assert.deepEqual(request.modeEvidence.candidateTemplateIds, ["T2", "T3"]);
  assert.deepEqual(request.modeEvidence.excludedTemplateIds, ["T1"]);
  assert.equal(request.modeEvidence.candidateEligibilityRecords.T1.decision, "EXCLUDE");
  assert.equal(request.modeEvidence.selectionAlgorithm, "sha256-source-affinity-v3");
  assert.deepEqual(request.selection.templateCandidates, ["T2", "T3"]);
  assert.ok(request.modeEvidence.candidateEligibilityRecords.T1.metadataRecord.sha256);
  assert.equal(request.template.id, request.modeEvidence.selectedTemplateId);
});
test("capability readback distinguishes request registration from each real executor", async t => {
  const f = fixture(t); const snapshot = capabilitySnapshot(f.ctx);
  assert.equal(snapshot.ok, true); assert.equal(snapshot.profileState, "READABLE");
  assert.equal(snapshot.selectionSchemaVersion, 1);
  assert.match(snapshot.configurationRevision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(snapshot.declaredProfileRevision, null);
  assert.equal(snapshot.lines.length, 3);
  assert.deepEqual(snapshot.lines.map(line => line.id), ["cdp", "codex-api", "gemini"]);
  assert.deepEqual(snapshot.lines.map(line => line.label), [
    "在线模式（GPT 网页/CDP）", "本地模式（Codex 客户端）", "历史记录（Gemini 已停用）"
  ]);
  assert.deepEqual(snapshot.lines[0].instances.map(instance => instance.label), ["CDP A", "CDP B"]);
  for (const line of snapshot.lines) {
    assert.equal(line.instances.length, line.id === "cdp" ? 2 : 1);
    for (const instance of line.instances) {
      assert.equal(instance.modes.length, 3);
      if (line.id === "gemini") {
        assert.ok(instance.modes.every(mode => mode.registration.state === "DISABLED_BY_USER"));
        assert.ok(instance.modes.every(mode => mode.execution.state === "DISABLED_BY_USER"));
        continue;
      }
      assert.ok(instance.modes.every(mode => mode.registration.state === "READY"));
      const fixedMode = instance.modes.find(mode => mode.mode === "3_fixed_template");
      assert.deepEqual(fixedMode.registration.templateOptions.map(option => option.id), ["T1", "T2"]);
      assert.equal(fixedMode.registration.templateCandidateCount, 2);
      assert.match(fixedMode.registration.templateOptions[0].referenceHashes.P1, /^[a-f0-9]{64}$/);
      assert.deepEqual(fixedMode.selection, { schemaVersion: 1, pipeline: instance.pipeline,
        mode: "3_fixed_template", templateCandidates: ["T1", "T2"], selectedTemplateId: null,
        selectedTemplateReferenceSha256: null, configurationRevision: snapshot.configurationRevision });
    }
  }
  for (const pipeline of ["cdp-a", "cdp-b"]) {
    const instance = snapshot.lines.find(item => item.id === "cdp").instances.find(item => item.pipeline === pipeline);
    assert.equal(instance.modes.find(item => item.mode === "1_replica_shuffle").execution.state, "EXECUTOR_NOT_CONNECTED");
    assert.equal(instance.modes.find(item => item.mode === "2_random_template").execution.state, "EXECUTOR_NOT_CONNECTED");
    assert.equal(instance.modes.find(item => item.mode === "3_fixed_template").execution.state, "ADAPTER_PRESENT_RUNTIME_UNVERIFIED");
  }
  const codex = snapshot.lines.find(item => item.id === "codex-api").instances[0];
  assert.ok(codex.modes.every(item => item.execution.state === "HOST_AGENT_REQUIRED"));
  const gemini = snapshot.lines.find(item => item.id === "gemini").instances[0];
  assert.ok(gemini.modes.every(item => item.registration.state === "DISABLED_BY_USER"));
  assert.ok(gemini.modes.every(item => item.execution.state === "DISABLED_BY_USER"));
  assert.ok(!JSON.stringify(snapshot).includes(f.root));
  f.response.data = null;
  assert.equal(await handle({ method: "GET" }, {}, "/api/production/capabilities", {}, f.ctx), true);
  assert.equal(f.response.data.capabilityRevision, snapshot.capabilityRevision);
  assert.equal(f.response.data.lines.length, 3);
});
test("capabilities never claim preparation readiness when private server profile is absent", async t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.runtime, "production-request-profile.json"));
  const snapshot = capabilitySnapshot(f.ctx);
  assert.equal(snapshot.profileState, "UNVERIFIED");
  assert.equal(snapshot.configurationRevision, null);
  const capabilities = snapshot.lines.flatMap(line => line.instances.flatMap(instance => instance.modes
    .map(mode => ({ pipeline: instance.pipeline, registration: mode.registration }))));
  assert.ok(capabilities.filter(item => item.pipeline !== "gemini")
    .every(item => item.registration.state === "CONFIGURATION_UNVERIFIED"));
  assert.ok(capabilities.filter(item => item.pipeline === "gemini")
    .every(item => item.registration.state === "DISABLED_BY_USER"));
});
test("unified state snapshot preserves the unverified profile revision state", t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.runtime, "production-request-profile.json"));
  const snapshot = productionStateSnapshot(f.ctx);
  assert.equal(snapshot.capabilities.declaredProfileRevisionState, "UNVERIFIED");
  assert.equal(validateStateSnapshot(snapshot), true);
});
test("unified selection DTO is accepted, persisted and returned; stale configuration revision is rejected", async t => {
  const f = fixture(t); const capabilities = capabilitySnapshot(f.ctx);
  const selection = { schemaVersion: 1, pipeline: "codex-api", mode: "3_fixed_template",
    templateCandidates: ["T1"], selectedTemplateId: "T1",
    selectedTemplateReferenceSha256: capabilities.lines.find(line => line.id === "codex-api").instances[0].modes
      .find(mode => mode.mode === "3_fixed_template").registration.templateOptions.find(template => template.id === "T1").referenceHashes,
    configurationRevision: capabilities.configurationRevision };
  const result = await prepare({ sourcePath: f.material, prompt: "保持原素材信息", selection }, f.ctx);
  const request = JSON.parse(fs.readFileSync(result.requestPath, "utf8"));
  assert.deepEqual(request.selection, selection);
  assert.deepEqual(result.selection, selection);
  assert.equal(result.status, "PREPARED_NOT_GENERATED");
  const stale = { ...selection, configurationRevision: `sha256:${"0".repeat(64)}` };
  await assert.rejects(prepare({ sourcePath: f.material, selection: stale }, f.ctx), /设置已变化/);
  const state = productionStateSnapshot(f.ctx);
  assert.equal(state.configurationRevision, capabilities.configurationRevision);
  assert.deepEqual(state.requests[0].selection, selection);
});
test("unified state endpoint returns the mode catalog, executor state and request ledger together", async t => {
  const f = fixture(t);
  const prepared = await prepare(f.body, f.ctx);
  const snapshot = productionStateSnapshot(f.ctx);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.schemaVersion, 4);
  assert.equal(snapshot.catalog.lines.length, 3);
  assert.deepEqual(snapshot.catalog.lines.map(item => item.id), LINE_CATALOG.map(item => item.id));
  assert.deepEqual(snapshot.catalog.modes.map(item => item.id), MODE_CATALOG.map(item => item.id));
  assert.equal(snapshot.capabilities.lines.length, 3);
  assert.equal(snapshot.capabilities.declaredProfileRevisionState, "NOT_DECLARED");
  assert.equal(validateStateSnapshot(snapshot), true, "server state DTO must satisfy the browser contract");
  assert.equal(snapshot.selectionSchemaVersion, 1);
  assert.equal(snapshot.configurationRevision, snapshot.capabilities.configurationRevision);
  assert.equal(snapshot.runtime.revision, "production-runtime-v1");
  assert.equal(snapshot.runtime.executors.length, LINE_CATALOG.flatMap(line => line.instances).length);
  assert.equal(snapshot.runtime.executors.find(item => item.pipeline === "cdp-a").state, "UNCONFIGURED");
  assert.equal(snapshot.runtime.executors.find(item => item.pipeline === "codex-api").state, "UNOBSERVED");
  assert.equal(snapshot.runtime.executors.find(item => item.pipeline === "gemini").state, "DISABLED_BY_USER");
  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.requests[0].requestId, prepared.requestId);
  assert.equal(snapshot.requests[0].status, "PREPARED_NOT_GENERATED");
  assert.equal(snapshot.requests[0].selection.configurationRevision, snapshot.configurationRevision);
  assert.equal(snapshot.requests[0].selection.pipeline, "codex-api");
  assert.ok(!JSON.stringify(snapshot).includes(f.template));
  f.response.data = null;
  assert.equal(await handle({ method: "GET" }, {}, "/api/production/state", {}, f.ctx), true);
  assert.equal(f.response.data.schemaVersion, 4);
  assert.equal(f.response.data.requests[0].requestId, prepared.requestId);
});
test("unified state reads the Codex mode from the skill config and ignores its stale template in replica mode", t => {
  const f = fixture(t);
  const modeConfigPath = path.join(f.runtime, "pipeline-mode-template-config.json");
  const skillProfilePath = path.join(f.runtime, "codex-skill-profile.json");
  fs.writeFileSync(modeConfigPath, JSON.stringify({ pipelines: { "codex-api": {
    mode: "1_replica_shuffle", fixedTemplateId: "T79", fixedTemplateName: "stale template must not appear",
    updatedAt: "2026-10-14T01:00:00.000Z"
  } } }));
  fs.writeFileSync(skillProfilePath, JSON.stringify({ paths: { pipelineModeTemplateConfig: modeConfigPath } }));
  f.profile.codexSkillProfilePath = skillProfilePath;
  fs.writeFileSync(path.join(f.runtime, "production-request-profile.json"), JSON.stringify(f.profile));

  const snapshot = productionStateSnapshot(f.ctx);
  assert.equal(snapshot.savedSelections.codexApi.state, "SAVED");
  assert.equal(snapshot.savedSelections.codexApi.mode, "1_replica_shuffle");
  assert.equal(snapshot.savedSelections.codexApi.templateId, null);
  assert.equal(snapshot.savedSelections.codexApi.templateName, null);
  assert.equal(validateStateSnapshot(snapshot), true);

  fs.writeFileSync(modeConfigPath, JSON.stringify({ pipelines: { "codex-api": {
    mode: "3_fixed_template", fixedTemplateId: "T1", fixedTemplateName: "T1"
  } } }));
  const fixed = productionStateSnapshot(f.ctx).savedSelections.codexApi;
  assert.equal(fixed.mode, "3_fixed_template");
  assert.equal(fixed.templateId, "T1");
});
test("legacy CDP runtime evidence is fresh only within its heartbeat window and never leaks the source path", t => {
  const f = fixture(t);
  const now = new Date("2026-10-10T12:00:00.000Z");
  const statusFile = path.join(f.runtime, "legacy-cdp-status.json");
  const payload = { last_heartbeat: "2026-10-10T11:59:30.000Z", queue_remaining: 12,
    instances: { A: { state: "BUSY" }, B: { state: "IDLE" } },
    last_completed: { time: "2026-10-10T11:58:00.000Z", instance: "B", product_path: "D:\\private\\finished\\作品名" } };
  fs.writeFileSync(statusFile, JSON.stringify(payload));
  fs.utimesSync(statusFile, new Date(now.getTime() - 30000), new Date(now.getTime() - 30000));
  const profile = { runtimeEvidenceSources: { cdpDaemon: { statusFile, staleAfterSeconds: 180 } } };
  const fresh = readLegacyCdpRuntime(profile, now);
  assert.equal(fresh.state, "FRESH");
  assert.equal(fresh.queueRemaining, 12);
  assert.equal(fresh.instanceStates.A, "BUSY");
  assert.equal(fresh.lastCompletedTitle, "作品名");
  assert.ok(!JSON.stringify(fresh).includes(statusFile));

  payload.last_heartbeat = "2026-10-10T11:50:00.000Z";
  fs.writeFileSync(statusFile, JSON.stringify(payload));
  fs.utimesSync(statusFile, new Date(now.getTime() - 600000), new Date(now.getTime() - 600000));
  const stale = readLegacyCdpRuntime(profile, now);
  assert.equal(stale.state, "STALE");
  assert.equal(stale.queueRemaining, null, "stale queue counts must not appear current");
  assert.match(stale.detail, /不能当作当前/);
});
test("same input returns same physical request, changed prompt returns another request", async t => {
  const f = fixture(t); const first = await prepare(f.body, f.ctx); const second = await prepare(f.body, f.ctx);
  assert.equal(first.requestId, second.requestId); assert.equal(first.requestPath, second.requestPath);
  const changed = await prepare({ ...f.body, prompt: "换一种标题" }, f.ctx);
  assert.notEqual(changed.requestId, first.requestId);
});
test("client cannot select command, output, private profile or execute", t => {
  const f = fixture(t);
  for (const key of ["command", "profile", "config", "output", "execute", "materialPaths"]) {
    assert.throws(() => validate({ ...f.body, [key]: "anything" }, f.profile), /不允许/);
  }
});
test("source must be one physical folder within private material roots", t => {
  const f = fixture(t); assert.throws(() => validate({ ...f.body, sourcePath: f.template }, f.profile), /素材库/);
  assert.throws(() => validate({ ...f.body, sourcePath: "relative" }, f.profile), /完整素材/);
  assert.throws(() => validate({ ...f.body, sourcePath: path.join(f.material, "1.png") }, f.profile), /文件夹/);
});
test("disabled Gemini and unknown route/template and arbitrary prompt types are rejected", t => {
  const f = fixture(t);
  for (const mode of ["1_replica_shuffle", "2_random_template", "3_fixed_template"]) {
    assert.throws(() => validate({ ...f.body, pipeline: "gemini", mode }, f.profile), error => error.status === 410);
  }
  assert.throws(() => validate({ ...f.body, pipeline: "unregistered-line" }, f.profile), /请选择在线模式（GPT 网页\/CDP）或本地模式（Codex 客户端）/);
  assert.throws(() => validate({ ...f.body, templateId: "TUNKNOWN" }, f.profile));
  assert.throws(() => validate({ ...f.body, prompt: [] }, f.profile));
  assert.throws(() => validate({ ...f.body, prompt: "x".repeat(8001) }, f.profile));
  const { mode: _missingMode, ...missingMode } = f.body;
  assert.throws(() => validate(missingMode, f.profile), /明确选择/);
  assert.throws(() => validate({ ...f.body, mode: "2_random_template", templateCandidates: ["T1", "T404"], templateId: undefined }, f.profile), /尚未配置/);
});
test("legacy Gemini request stays readable but cannot be claimed or receive a receipt", async t => {
  const f = fixture(t);
  const prepared = await prepare(f.body, f.ctx);
  const legacy = JSON.parse(fs.readFileSync(prepared.requestPath, "utf8"));
  legacy.pipeline = "gemini";
  legacy.selection.pipeline = "gemini";
  legacy.requestId = requestIdentity(legacy);
  const base = path.join(f.runtime, "production-jobs", "isolated-requests");
  const directory = path.join(base, legacy.requestId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "request.json"), `${JSON.stringify(legacy)}\n`);

  const historical = listRequests(f.ctx).requests.find(record => record.requestId === legacy.requestId);
  assert.equal(historical.pipeline, "gemini");
  assert.equal(historical.status, "PREPARED_NOT_GENERATED");
  assert.throws(() => claimRequest(legacy.requestId,
    { executorId: "gemini-worker", workerId: randomUUID() }, f.ctx), error => error.status === 410);
  assert.throws(() => submitGenerationReceipt(legacy.requestId, {}, f.ctx), error => error.status === 410);
  assert.deepEqual(fs.readdirSync(directory), ["request.json"]);
});
test("subprocess uses fixed canonical argv with no shell or execute/config flag", async t => {
  const f = fixture(t); let captured;
  await assert.rejects(prepare(f.body, f.ctx, async (exe, args, options) => { captured = { exe, args, options }; throw new Error("private secret"); }));
  assert.equal(captured.options.shell, false); assert.ok(captured.args[0].endsWith("real_dispatch.py"));
  assert.ok(!captured.args.includes("--execute")); assert.ok(!captured.args.includes("--config"));
  assert.deepEqual(fs.readdirSync(path.join(f.runtime, "production-jobs", "isolated-requests")), []);
});
test("missing server profile yields honest unprepared state, without exposing paths", async t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.runtime, "production-request-profile.json"));
  f.ctx.getBody = async () => JSON.stringify(f.body);
  assert.equal(await handle({ method: "POST" }, {}, "/api/production/requests/prepare", {}, f.ctx), true);
  assert.equal(f.response.status, 503); assert.equal(f.response.data.completed, false);
  assert.equal(f.response.data.status, "NOT_PREPARED"); assert.ok(!JSON.stringify(f.response.data).includes(f.root));
});
test("existing production route handles prepare endpoint; malformed JSON never prepares", async t => {
  const f = fixture(t); f.ctx.getBody = async () => "{";
  assert.equal(await existingRoute({ method: "POST" }, {}, "/api/production/requests/prepare", {}, f.ctx), true);
  assert.equal(f.response.status, 400); assert.equal(f.response.data.status, "NOT_PREPARED");
  assert.equal(await handle({ method: "GET" }, {}, "/api/production/requests/prepare", {}, f.ctx), false);
});
test("readback lists only isolated valid preparations, never ordinary jobs or staging", async t => {
  const f = fixture(t); assert.deepEqual(listRequests(f.ctx).requests, []);
  const result = await prepare(f.body, f.ctx);
  fs.writeFileSync(path.join(f.runtime, "production-jobs", "ordinary-job.json"), '{"status":"COMPLETED"}');
  const invalid = path.join(f.runtime, "production-jobs", "isolated-requests", "a".repeat(64));
  fs.mkdirSync(invalid); fs.writeFileSync(path.join(invalid, "request.json"), '{}');
  const readback = listRequests(f.ctx); assert.equal(readback.requests.length, 1);
  assert.equal(readback.omittedInvalidCount, 1); assert.equal(readback.requests[0].completed, false);
  assert.equal(readback.requests[0].requestId, result.requestId);
  assert.equal(readback.requests[0].requestSha256, createHash("sha256").update(fs.readFileSync(result.requestPath)).digest("hex"));
});
test("request claim is exclusive and idempotent for the same worker; generation receipt updates the shared DTO", async t => {
  const f = fixture(t); const prepared = await prepare(f.body, f.ctx);
  const workerId = randomUUID();
  const claim = claimRequest(prepared.requestId, { executorId: "codex-host-agent", workerId }, f.ctx);
  assert.equal(claim.status, "CLAIMED_NOT_STARTED");
  assert.equal(claim.completed, false);
  assert.equal(claim.claim.executorId, "codex-host-agent");
  assert.equal(claim.idempotent, false);
  assert.equal(claimRequest(prepared.requestId, { executorId: "codex-host-agent", workerId }, f.ctx).idempotent, true);
  assert.throws(() => claimRequest(prepared.requestId, { executorId: "codex-host-agent", workerId: randomUUID() }, f.ctx),
    error => error.status === 409);
  assert.throws(() => claimRequest(prepared.requestId, { executorId: "gemini-worker", workerId: randomUUID() }, f.ctx),
    error => error.status === 409);

  const request = JSON.parse(fs.readFileSync(prepared.requestPath, "utf8"));
  const outputRoot = path.join(path.dirname(prepared.requestPath), "outputs");
  fs.mkdirSync(outputRoot, { recursive: true });
  const outputPaths = request.sourceImages.map((_, index) => path.join(outputRoot, `P${index + 1}.png`));
  execFileSync("python", ["-c", "from PIL import Image;import sys;[(Image.new('RGB',(24,32),(255,0,i*70+1)).save(p)) for i,p in enumerate(sys.argv[1:])]", ...outputPaths]);
  const receiptBody = {
    schemaVersion: 1, requestId: prepared.requestId, pipeline: "codex-api", engine: "native-imagegen",
    claimId: claim.claim.claimId, executorId: claim.claim.executorId, workerId: claim.claim.workerId,
    outputs: outputPaths.map((nativePath, index) => {
      const bytes = fs.readFileSync(nativePath);
      return { page: index + 1, sourceSha256: request.sourceImages[index].sha256, nativePath,
        nativeSha256: createHash("sha256").update(bytes).digest("hex"), generationCallId: randomUUID() };
    })
  };
  const generated = submitGenerationReceipt(prepared.requestId, receiptBody, f.ctx);
  assert.equal(generated.status, "GENERATED_PENDING_QA");
  assert.equal(generated.completed, false);
  assert.equal(generated.lifecycle.generatedPages, 2);
  assert.equal(generated.lifecycle.qaState, "NOT_REPORTED");
  assert.equal(submitGenerationReceipt(prepared.requestId, receiptBody, f.ctx).idempotent, true);
  const listed = listRequests(f.ctx).requests.find(item => item.requestId === prepared.requestId);
  assert.equal(listed.status, "GENERATED_PENDING_QA");
  assert.equal(productionStateSnapshot(f.ctx).requests[0].lifecycle.generatedPages, 2);

  fs.writeFileSync(outputPaths[0], Buffer.concat([fs.readFileSync(outputPaths[0]), Buffer.from("tamper")]));
  assert.equal(listRequests(f.ctx).requests.find(item => item.requestId === prepared.requestId).status,
    "OUTPUT_CHANGED_AFTER_RECEIPT");
});
test("offline claim-to-receipt contract covers active executors and each production mode", async t => {
  const f = fixture(t);
  const cases = ["cdp-a", "cdp-b", "codex-api"].flatMap(pipeline =>
    ["1_replica_shuffle", "2_random_template", "3_fixed_template"].map(mode => ({ pipeline, mode })));
  const executorFor = { "cdp-a": "cdp-a-worker", "cdp-b": "cdp-b-worker",
    "codex-api": "codex-host-agent" };
  const engineFor = { "cdp-a": "chatgpt-web", "cdp-b": "chatgpt-web",
    "codex-api": "native-imagegen" };

  for (const [caseIndex, { pipeline, mode }] of cases.entries()) {
    const body = { ...f.body, pipeline, mode,
      ...(mode === "1_replica_shuffle" ? { templateId: undefined, panelMappings: { "1.png": [2, 1], "2.png": [2, 1] } } : {}),
      ...(mode === "2_random_template" ? { templateId: undefined, templateCandidates: ["T1", "T2"] } : {}) };
    const prepared = await prepare(body, f.ctx);
    const workerId = randomUUID();
    const claim = claimRequest(prepared.requestId,
      { executorId: executorFor[pipeline], workerId }, f.ctx);
    const request = JSON.parse(fs.readFileSync(prepared.requestPath, "utf8"));
    const outputRoot = path.join(path.dirname(prepared.requestPath), "outputs");
    fs.mkdirSync(outputRoot, { recursive: true });
    const outputPaths = request.sourceImages.map((_, index) =>
      path.join(outputRoot, `P${index + 1}.png`));
    execFileSync("python", ["-c",
      "from PIL import Image;import sys; seed=int(sys.argv[1]); paths=sys.argv[2:]; [(Image.new('RGB',(24,32),((seed*17+i+1)%255,(seed*31+i*53+3)%255,(seed*47+i*71+5)%255)).save(p)) for i,p in enumerate(paths)]",
      String(caseIndex), ...outputPaths]);
    const outputs = outputPaths.map((nativePath, index) => ({
      page: index + 1,
      sourceSha256: request.sourceImages[index].sha256,
      nativePath,
      nativeSha256: createHash("sha256").update(fs.readFileSync(nativePath)).digest("hex"),
      generationCallId: randomUUID()
    }));
    const receipt = submitGenerationReceipt(prepared.requestId, {
      schemaVersion: 1, requestId: prepared.requestId, pipeline, engine: engineFor[pipeline],
      claimId: claim.claim.claimId, executorId: claim.claim.executorId, workerId, outputs
    }, f.ctx);

    assert.equal(prepared.mode, mode);
    assert.equal(claim.status, "CLAIMED_NOT_STARTED");
    assert.equal(receipt.status, "GENERATED_PENDING_QA");
    assert.equal(receipt.completed, false);
    const readback = listRequests(f.ctx).requests.find(item => item.requestId === prepared.requestId);
    assert.equal(readback.pipeline, pipeline);
    assert.equal(readback.mode, mode);
    assert.equal(readback.status, "GENERATED_PENDING_QA");
    assert.equal(readback.lifecycle.generatedPages, request.sourceImages.length);
    assert.equal(readback.lifecycle.qaState, "NOT_REPORTED");
  }
  assert.equal(cases.length, 9);
});
test("generation receipt rejects wrong page mapping, out-of-request output and changed source", async t => {
  const f = fixture(t); const prepared = await prepare(f.body, f.ctx); const workerId = randomUUID();
  const claim = claimRequest(prepared.requestId, { executorId: "codex-host-agent", workerId }, f.ctx);
  const request = JSON.parse(fs.readFileSync(prepared.requestPath, "utf8"));
  const outputRoot = path.join(path.dirname(prepared.requestPath), "outputs"); fs.mkdirSync(outputRoot, { recursive: true });
  const outputPaths = request.sourceImages.map((_, index) => path.join(outputRoot, `P${index + 1}.png`));
  execFileSync("python", ["-c", "from PIL import Image;import sys;[(Image.new('RGB',(24,32),(100,i*70+1,220)).save(p)) for i,p in enumerate(sys.argv[1:])]", ...outputPaths]);
  const outputs = outputPaths.map((nativePath, index) => ({ page: index + 1,
    sourceSha256: request.sourceImages[index].sha256, nativePath,
    nativeSha256: createHash("sha256").update(fs.readFileSync(nativePath)).digest("hex"), generationCallId: randomUUID() }));
  const base = { schemaVersion: 1, requestId: prepared.requestId, pipeline: "codex-api", engine: "native-imagegen",
    claimId: claim.claim.claimId, executorId: claim.claim.executorId, workerId: claim.claim.workerId, outputs };
  assert.throws(() => submitGenerationReceipt(prepared.requestId, { ...base, outputs: outputs.map((item, index) =>
    index === 0 ? { ...item, sourceSha256: "0".repeat(64) } : item) }, f.ctx), error => error.status === 409);
  assert.throws(() => submitGenerationReceipt(prepared.requestId, { ...base, outputs: outputs.map((item, index) =>
    index === 0 ? { ...item, nativePath: path.join(f.root, "outside.png") } : item) }, f.ctx), error => error.status === 409);
  assert.throws(() => submitGenerationReceipt(prepared.requestId, { ...base, outputs: outputs.map((item, index) =>
    index === 0 ? { ...item, generationCallId: "not-a-uuid-but-36-characters-long" } : item) }, f.ctx), /生成调用 UUID/);
  fs.writeFileSync(request.sourceImages[0].path, Buffer.from("changed source"));
  assert.throws(() => submitGenerationReceipt(prepared.requestId, base, f.ctx), error => error.status === 409);
});
test("loopback HTTP POST -> actual Python -> physical SHA -> GET readback works", async t => {
  const f = fixture(t);
  const ctx = { ...f.ctx,
    getBody: async req => { let body = ''; for await (const chunk of req) body += chunk; return body; },
    sendJson: (res, value) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); },
    send: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body); } };
  const server = http.createServer(async (req, res) => {
    if (!await existingRoute(req, res, new URL(req.url, 'http://localhost').pathname, {}, ctx)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + '/api/production/requests/prepare', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.body) });
  assert.equal(response.status, 200); const receipt = await response.json();
  assert.equal(receipt.status, 'PREPARED_NOT_GENERATED'); assert.equal(receipt.completed, false);
  const sha = createHash('sha256').update(fs.readFileSync(receipt.requestPath)).digest('hex');
  assert.equal(receipt.requestSha256, sha);
  const list = await (await fetch(origin + '/api/production/requests')).json();
  assert.equal(list.requests.length, 1); assert.equal(list.requests[0].requestSha256, sha);
  const state = await (await fetch(origin + '/api/production/state')).json();
  assert.equal(state.schemaVersion, 4); assert.equal(state.requests[0].requestSha256, sha);
  assert.equal(state.capabilities.lines.length, 3); assert.equal(state.catalog.modes.length, 3);
  assert.ok(!fs.existsSync(path.join(f.runtime, 'manifest.json')));
  assert.ok(!fs.existsSync(path.join(path.dirname(receipt.requestPath), 'generation-receipt.json')));
  const detail = await fetch(origin + `/api/production/requests/${receipt.requestId}`);
  assert.equal(detail.status, 200); assert.equal((await detail.json()).status, 'PREPARED_NOT_GENERATED');
  const invalidClaim = await fetch(origin + `/api/production/requests/${receipt.requestId}/claim`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ executorId: 'gemini-worker', workerId: randomUUID() }) });
  assert.equal(invalidClaim.status, 409);
});
test("list readback excludes shape-valid request whose immutable content was edited", async t => {
  const f = fixture(t); const receipt = await prepare(f.body, f.ctx);
  const request = JSON.parse(fs.readFileSync(receipt.requestPath));
  request.userInstruction = "被修改";
  fs.writeFileSync(receipt.requestPath, JSON.stringify(request));
  const list = listRequests(f.ctx); assert.equal(list.requests.length, 0); assert.equal(list.omittedInvalidCount, 1);
});
test("list never follows a request file symlink outside its isolated workspace", async t => {
  const f = fixture(t); const receipt = await prepare(f.body, f.ctx);
  const outside = path.join(f.root, "outside-request.json");
  fs.renameSync(receipt.requestPath, outside);
  try { fs.symlinkSync(outside, receipt.requestPath, "file"); }
  catch (error) { if (error.code === "EPERM") { t.skip("OS disallows file symlinks"); return; } throw error; }
  assert.equal(listRequests(f.ctx).requests.length, 0);
});
test("list never follows directory junction to outside isolated request root", async t => {
  const f = fixture(t); const receipt = await prepare(f.body, f.ctx);
  const directory = path.dirname(receipt.requestPath), outside = path.join(f.root, "outside-workspace");
  fs.renameSync(directory, outside); fs.symlinkSync(outside, directory, "junction");
  assert.equal(listRequests(f.ctx).requests.length, 0);
});
test("POST rejects another source/template/prompt or external request path even with a consistent hash", async t => {
  const f = fixture(t); const seed = await prepare(f.body, f.ctx);
  const original = JSON.parse(fs.readFileSync(seed.requestPath));
  const changes = [r => { r.sourcePath = f.template; }, r => { r.template.id = "T2"; },
    r => { r.userInstruction = "不一致"; }, null];
  for (const change of changes) {
    await assert.rejects(prepare(f.body, f.ctx, async (_, args) => {
      const staging = args[args.indexOf("--output") + 1], request = structuredClone(original);
      if (change) change(request); request.requestId = requestIdentity(request);
      const target = path.join(staging, "request.json"); fs.writeFileSync(target, JSON.stringify(request));
      return { stdout: JSON.stringify({ status: "PREPARED_NOT_GENERATED", completed: false,
        requestId: request.requestId, requestPath: change === null ? seed.requestPath : target }) };
    }), /回读未通过/);
  }
});
