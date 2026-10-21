"use strict";

// Only prepares immutable real_dispatch requests; never dispatches a model.
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createHash, randomUUID } = require("node:crypto");
const executeFile = promisify(execFile);
const PIPELINES = new Set(["cdp-a", "cdp-b", "codex-api", "gemini"]);
const LINES = PIPELINES;
const DISABLED_PIPELINES = new Set(["gemini"]);
const ACTIVE_PIPELINES = new Set([...PIPELINES].filter(pipeline => !DISABLED_PIPELINES.has(pipeline)));
const MODES = new Set(["1_replica_shuffle", "2_random_template", "3_fixed_template"]);
const SOURCE_REPLICA_TEMPLATE_ID = "__source_replica__";
const LINE_CATALOG = Object.freeze([
  Object.freeze({ id: "cdp", label: "在线模式（GPT 网页/CDP）", instances: Object.freeze([
    Object.freeze({ id: "A", pipeline: "cdp-a", label: "CDP A" }),
    Object.freeze({ id: "B", pipeline: "cdp-b", label: "CDP B" })
  ]) }),
  Object.freeze({ id: "codex-api", label: "本地模式（Codex 客户端）", instances: Object.freeze([
    Object.freeze({ id: "default", pipeline: "codex-api", label: "当前客户端" })
  ]) }),
  Object.freeze({ id: "gemini", label: "历史记录（Gemini 已停用）", instances: Object.freeze([
    Object.freeze({ id: "default", pipeline: "gemini", label: "Gemini（已停用）" })
  ]) })
]);
const LINE_LABELS = Object.freeze({
  "cdp-a": "在线模式（GPT 网页/CDP）",
  "cdp-b": "在线模式（GPT 网页/CDP）",
  "codex-api": "本地模式（Codex 客户端）",
  gemini: "历史记录（Gemini 已停用）"
});
const MODE_LABELS = Object.freeze({
  "1_replica_shuffle": "复刻重组", "2_random_template": "随机模板", "3_fixed_template": "固定模板"
});
const MODE_CATALOG = Object.freeze([...MODES].map(id => Object.freeze({ id, label: MODE_LABELS[id] })));
const CAPABILITY_REVISION = "production-capabilities-v4";
const RUNTIME_REVISION = "production-runtime-v1";
const STATE_SCHEMA_VERSION = 4;
const DEFAULT_RUNTIME_STALE_AFTER_SECONDS = 180;

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function normalizePipeline(value) {
  const normalized = String(value || "").trim().toLowerCase().replaceAll("_", "-").replace(/\s+/g, "-");
  return normalized === "gemini-1" ? "gemini" : normalized;
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function skillRoot() {
  if (process.env.TEAMBUILDING_3MODES_SKILL_ROOT) return path.resolve(process.env.TEAMBUILDING_3MODES_SKILL_ROOT);
  let parent = __dirname;
  while (true) {
    const candidate = path.join(parent, ".agents", "skills", "teambuilding-production-3modes");
    if (fs.existsSync(path.join(candidate, "scripts", "real_dispatch.py"))) return candidate;
    const next = path.dirname(parent); if (next === parent) break; parent = next;
  }
  fail("制作请求技能未安装", 503);
}
function serverProfile(ctx) {
  const filename = process.env.TEAMBUILDING_3MODES_PREPARE_PROFILE || path.join(ctx.DATA_ROOT, "production-request-profile.json");
  try { return JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, "")); }
  catch (_) { fail("制作请求的服务端素材与母版配置尚未接入", 503); }
}
function savedCodexSelection(profile) {
  const unverified = { state: "UNVERIFIED", mode: null, modeLabel: null, templateId: null,
    templateName: null, updatedAt: null };
  const skillProfilePath = profile?.codexSkillProfilePath;
  if (typeof skillProfilePath !== "string" || !path.isAbsolute(skillProfilePath)) return unverified;
  try {
    const skillProfile = JSON.parse(fs.readFileSync(skillProfilePath, "utf8").replace(/^\uFEFF/, ""));
    const configPath = skillProfile?.paths?.pipelineModeTemplateConfig;
    if (typeof configPath !== "string" || !path.isAbsolute(configPath)) return unverified;
    const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
    const saved = config?.pipelines?.["codex-api"];
    if (!MODES.has(saved?.mode)) return unverified;
    const templateApplies = saved.mode === "3_fixed_template";
    return { state: "SAVED", mode: saved.mode, modeLabel: MODE_LABELS[saved.mode],
      templateId: templateApplies && typeof saved.fixedTemplateId === "string" ? saved.fixedTemplateId : null,
      templateName: templateApplies && typeof saved.fixedTemplateName === "string" ? saved.fixedTemplateName : null,
      updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : null };
  } catch (_) { return unverified; }
}
function requestsRoot(ctx) {
  return path.join(ctx.PRODUCTION_JOB_ROOT || path.join(ctx.DATA_ROOT, "production-jobs"), "isolated-requests");
}
// Matches real_dispatch json.dumps(ensure_ascii=False, sort_keys=True) for its
// JSON contract (only integer numbers); do not hash the pretty-printed file.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(", ")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}: ${canonicalJson(value[key])}`).join(", ")}}`;
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Unsupported request number");
  return JSON.stringify(value);
}
function compactCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(compactCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${compactCanonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function requestIdentity(request) {
  const content = { ...request }; delete content.requestId;
  return createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}
function imageFiles(directory) {
  const suffixes = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && suffixes.has(path.extname(entry.name).toLowerCase()))
    .map(entry => ({ name: entry.name, stem: path.parse(entry.name).name }))
    .sort((a, b) => {
      const aNumeric = /^\d+$/.test(a.stem), bNumeric = /^\d+$/.test(b.stem);
      // Match Python int ordering in real_dispatch.py, including very large stems.
      const aNumber = aNumeric ? BigInt(a.stem) : 1_000_000_000n;
      const bNumber = bNumeric ? BigInt(b.stem) : 1_000_000_000n;
      return (aNumber < bNumber ? -1 : aNumber > bNumber ? 1 : 0)
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function sourceFingerprint(directory) {
  const files = imageFiles(directory).map(file => [file.name,
    sha256(fs.readFileSync(path.join(directory, file.name)))]);
  return sha256(JSON.stringify(files));
}
function templateReferenceHashes(directory) {
  const result = {};
  for (const page of ["P1", "P2"]) {
    const matches = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()
      && new RegExp(`${page}(?!\\d)`, "i").test(path.parse(entry.name).name)
      && [".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(entry.name).toLowerCase()));
    if (matches.length !== 1) fail(`母版目录必须恰好包含一个 ${page} 参照图`);
    result[page] = sha256(fs.readFileSync(path.join(directory, matches[0].name)));
  }
  return result;
}
function fileRecord(filename) {
  const real = fs.realpathSync(filename);
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size < 1) fail("模板资格或参照文件缺失/为空");
  return { path: real, sha256: sha256(fs.readFileSync(real)), bytes: stat.size };
}
function templateEligibilityRecord(templateId, templateDirectory) {
  const directory = fs.realpathSync(templateDirectory);
  if (!fs.statSync(directory).isDirectory()) fail(`母版 ${templateId} 不是有效文件夹`);
  const metadataPath = path.join(directory, "template.json");
  if (!fs.existsSync(metadataPath)) return { templateId, templatePath: directory,
    metadataRecord: null, eligibility: null, taskFit: null, eligibleForRandom: null,
    decision: "ALLOW_FROM_PREFILTERED_POOL", reason: "No template.json exclusion; candidate pool must be prefiltered" };
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8").replace(/^\uFEFF/, "")); }
  catch (_) { fail(`母版 ${templateId} 的 template.json 无法读取`); }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) fail(`母版 ${templateId} 的 template.json 必须是对象`);
  const quality = metadata.templateQuality && typeof metadata.templateQuality === "object" && !Array.isArray(metadata.templateQuality)
    ? metadata.templateQuality : {};
  const normalize = value => value === undefined || value === null ? null : String(value).trim().toLowerCase().replaceAll("-", "_");
  const eligibility = normalize(quality.eligibility ?? metadata.eligibility);
  const taskFit = normalize(quality.taskFit ?? metadata.taskFit);
  let randomFlag = quality.eligible_for_random ?? quality.eligibleForRandom
    ?? metadata.eligible_for_random ?? metadata.eligibleForRandom;
  let invalidRandomFlag = false;
  if (typeof randomFlag === "string" && randomFlag.trim()) {
    const normalized = randomFlag.trim().toLowerCase();
    if (["true", "yes", "1", "eligible", "allowed"].includes(normalized)) randomFlag = true;
    else if (["false", "no", "0", "rejected", "pending", "pending_review", "blocked", "ineligible"].includes(normalized)) randomFlag = false;
    else { randomFlag = false; invalidRandomFlag = true; }
  } else if (typeof randomFlag !== "boolean") randomFlag = null;
  const reasons = [];
  if (["rejected", "pending", "pending_review", "blocked", "ineligible", "not_eligible", "excluded"].includes(eligibility)) reasons.push(`eligibility=${eligibility}`);
  if (["low", "poor", "not_fit", "no_fit"].includes(taskFit)) reasons.push(`taskFit=${taskFit}`);
  if (randomFlag === false) reasons.push("eligible_for_random=false");
  if (invalidRandomFlag) reasons.push("eligible_for_random=unrecognized");
  return { templateId, templatePath: directory, metadataRecord: fileRecord(metadataPath), eligibility,
    taskFit, eligibleForRandom: randomFlag, decision: reasons.length ? "EXCLUDE" : "ALLOW_FROM_PREFILTERED_POOL",
    reason: reasons.length ? reasons.join("; ") : "No template.json exclusion; candidate pool must be prefiltered" };
}
function templateReferenceRecords(directory) {
  const realDirectory = fs.realpathSync(directory);
  const result = {};
  for (const page of ["P1", "P2"]) {
    const matcher = new RegExp(`${page}(?!\\d)`, "i");
    const matches = fs.readdirSync(realDirectory, { withFileTypes: true }).filter(entry => entry.isFile()
      && matcher.test(path.parse(entry.name).name)
      && [".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(entry.name).toLowerCase()));
    if (matches.length !== 1) fail(`母版目录必须恰好包含一个 ${page} 参照图`);
    result[page] = fileRecord(path.join(realDirectory, matches[0].name));
  }
  return result;
}
function templatePoolSnapshot(profile) {
  const roots = Array.isArray(profile?.materialRoots) ? profile.materialRoots : [];
  const materialRoots = roots.flatMap(root => {
    try {
      const realRoot = fs.realpathSync(root);
      return fs.statSync(realRoot).isDirectory() ? [realRoot] : [];
    } catch (_) { return []; }
  }).sort();
  const materialRootCount = materialRoots.length;
  const templates = profile?.templates && typeof profile.templates === "object" ? profile.templates : {};
  const templateOptions = Object.entries(templates).flatMap(([id, template]) => {
    try {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id)) return [];
      if (typeof template?.directory !== "string" || !path.isAbsolute(template.directory) ||
          !fs.statSync(template.directory).isDirectory()) return [];
      const referenceHashes = templateReferenceHashes(template.directory);
      const rawLabel = String(template.displayName || template.name || template.label || id);
      const label = (/[/\\:]/.test(rawLabel) ? id : rawLabel)
        .replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120) || id;
      return [{ id, label, referenceHashes }];
    } catch (_) { return []; }
  }).sort((a, b) => a.id.localeCompare(b.id));
  // This is a digest of the effective selector configuration, not a declared
  // profile version. Paths remain private; only the digest is returned.
  const effectiveConfig = {
    materialRoots,
    templates: templateOptions.map(({ id, referenceHashes }) => ({ id, referenceHashes }))
  };
  return { materialRootCount, templateOptions, validTemplateCount: templateOptions.length,
    configurationRevision: materialRootCount ? `sha256:${sha256(JSON.stringify(effectiveConfig))}` : null };
}
function selectionRecord(pipeline, mode, templateCandidates, selectedTemplateId, configurationRevision,
  selectedTemplateReferenceSha256 = null, panelMappings = null) {
  return {
    schemaVersion: 1,
    pipeline,
    mode,
    templateCandidates: [...templateCandidates],
    selectedTemplateId: selectedTemplateId || null,
    selectedTemplateReferenceSha256: selectedTemplateId ? selectedTemplateReferenceSha256 : null,
    ...(panelMappings ? { panelMappings } : {}),
    configurationRevision: configurationRevision || null
  };
}
function executionCapability(line, mode, adapterPresent) {
  if (DISABLED_PIPELINES.has(line)) return {
    state: "DISABLED_BY_USER",
    label: "用户已停用",
    reason: "Gemini 团建生产已停止；不再接受新请求或执行历史待办，历史记录仅供查看。"
  };
  if (line === "codex-api") return {
    state: "HOST_AGENT_REQUIRED",
    label: "需由当前 Codex 对话执行",
    reason: "工作台没有调用宿主原生生图的接口；面板只登记请求。"
  };
  if (line === "gemini") return {
    state: "EXECUTOR_NOT_CONNECTED",
    label: "Gemini 执行器未接入统一请求链",
    reason: "Gemini 网关属于独立执行入口；当前统一请求 API 不会调用它。"
  };
  if (mode !== "3_fixed_template") return {
    state: "EXECUTOR_NOT_CONNECTED",
    label: "执行器未接入",
    reason: "当前 CDP 隔离执行器仅实现固定模板模式。"
  };
  return adapterPresent ? {
    state: "ADAPTER_PRESENT_RUNTIME_UNVERIFIED",
    label: "有隔离执行器；运行会话未核验，面板未接通执行",
    reason: "脚本存在不等于账号、会话、母版学习或运行进程已就绪。"
  } : {
    state: "EXECUTOR_NOT_CONNECTED",
    label: "执行器未安装",
    reason: "未找到固定模板 CDP 隔离执行器。"
  };
}
function capabilitySnapshot(ctx) {
  let pool = { materialRootCount: 0, templateOptions: [], validTemplateCount: 0, configurationRevision: null };
  let profileAvailable = false;
  let profile = null;
  try {
    profile = serverProfile(ctx);
    pool = templatePoolSnapshot(profile);
    profileAvailable = true;
  } catch (_) { /* Report an unverified configuration instead of inferring availability. */ }
  const savedSelections = { codexApi: savedCodexSelection(profile) };
  let adapterPresent = false;
  try {
    adapterPresent = fs.existsSync(path.join(skillRoot(), "scripts", "isolated_fixed_cdp_adapter.py"));
  } catch (_) { /* The adapter remains unavailable until its installed path is verified. */ }
  const capabilityForPipeline = pipeline => ({
    pipeline,
    label: LINE_LABELS[pipeline],
    modes: [...MODES].map(mode => {
      const minimumTemplates = mode === "1_replica_shuffle" ? 0 : mode === "2_random_template" ? 2 : 1;
      const registrationState = DISABLED_PIPELINES.has(pipeline) ? "DISABLED_BY_USER"
        : !profileAvailable || pool.materialRootCount < 1
        ? "CONFIGURATION_UNVERIFIED"
        : pool.validTemplateCount < minimumTemplates ? "TEMPLATE_POOL_INSUFFICIENT" : "READY";
      return {
        mode,
        modeLabel: MODE_LABELS[mode],
        selection: selectionRecord(pipeline, mode, pool.templateOptions.map(option => option.id), null,
          pool.configurationRevision),
        registration: {
          state: registrationState,
          label: registrationState === "READY" ? "可登记请求" : registrationState === "DISABLED_BY_USER"
            ? "用户已停用；仅保留历史记录" : registrationState === "TEMPLATE_POOL_INSUFFICIENT"
              ? `模板池不足（至少 ${minimumTemplates} 套有效 P1/P2）` : "服务端素材/模板配置未核实",
          templateCandidateCount: pool.validTemplateCount,
          templateOptions: pool.templateOptions
        },
        execution: executionCapability(pipeline, mode, adapterPresent)
      };
    })
  });
  const lines = LINE_CATALOG.map(line => ({
    id: line.id,
    label: line.label,
    instances: line.instances.map(instance => ({
      ...instance,
      modes: capabilityForPipeline(instance.pipeline).modes
    }))
  }));
  return {
    ok: true,
    capabilityRevision: CAPABILITY_REVISION,
    selectionSchemaVersion: 1,
    configurationRevision: pool.configurationRevision,
    declaredProfileRevision: null,
    declaredProfileRevisionState: profileAvailable ? "NOT_DECLARED" : "UNVERIFIED",
    savedSelections,
    asOfUtc: new Date().toISOString(),
    source: "server request handler, installed adapter files, and server-side material/template profile",
    profileState: profileAvailable ? "READABLE" : "UNVERIFIED",
    lines
  };
}
function makeModeEvidence(line, mode, source, templateIds, templateMap, selectedTemplateId, panelMappings = null) {
  if (mode === "1_replica_shuffle") {
    const files = imageFiles(source).map(file => ({
      name: file.name,
      sha256: sha256(fs.readFileSync(path.join(source, file.name)))
    }));
    const names = files.map(file => file.name);
    if (!panelMappings || typeof panelMappings !== "object" || Array.isArray(panelMappings) ||
        names.length < 1 || new Set(names).size !== names.length ||
        names.some(name => !Object.prototype.hasOwnProperty.call(panelMappings, name)) ||
        Object.keys(panelMappings).some(name => !names.includes(name)))
      fail("复刻重组必须为每张源图提供完整的面板换序表；当前没有可用映射，不能准备请求");
    const mappings = {};
    for (const file of files) {
      const raw = panelMappings[file.name];
      const order = Array.isArray(raw) ? raw : raw?.outputToSource;
      const count = Array.isArray(raw) ? raw.length : raw?.panelCount;
      if (!Number.isInteger(count) || count < 2 || !Array.isArray(order) || order.length !== count ||
          order.some(value => !Number.isInteger(value)) ||
          canonicalJson([...order].sort((a, b) => a - b)) !== canonicalJson(Array.from({ length: count }, (_, index) => index + 1)))
        fail(`源图 ${file.name} 的换序表不是完整的 1..N 排列`);
      mappings[file.sha256] = { panelCount: count, outputToSource: order };
    }
    const sourceSha256 = sourceFingerprint(source);
    const canonicalMappings = compactCanonicalJson(mappings);
    return {
      strategy: mode,
      sourceFingerprintSha256: sourceSha256,
      selectionAlgorithm: "explicit-panel-permutation-v1",
      panelMappings: mappings,
      selectionDigest: sha256(`${line}\n${sourceSha256}\n${canonicalMappings}`)
    };
  }
  if (mode === "2_random_template") {
    const inputIds = [...templateIds].sort();
    const eligibilityRecords = Object.fromEntries(inputIds.map(id => [id,
      templateEligibilityRecord(id, templateMap[id].directory)]));
    const candidateTemplateIds = inputIds.filter(id => eligibilityRecords[id].decision !== "EXCLUDE");
    if (candidateTemplateIds.length < 2) fail("随机模板池经过资格筛选后少于两套有效模板");
    const candidateReferenceRecords = Object.fromEntries(candidateTemplateIds.map(id => [id,
      templateReferenceRecords(templateMap[id].directory)]));
    const candidateReferenceSha256 = Object.fromEntries(candidateTemplateIds.map(id => [id,
      Object.fromEntries(Object.entries(candidateReferenceRecords[id]).map(([page, record]) => [page, record.sha256]))]));
    const poolSha256 = sha256(compactCanonicalJson({ references: candidateReferenceSha256, eligibilityRecords }));
    const sourceSha256 = sourceFingerprint(source);
    const selectionDigest = sha256(`${line}\n${sourceSha256}\n${poolSha256}`);
    const selected = candidateTemplateIds[Number.parseInt(selectionDigest.slice(0, 12), 16) % candidateTemplateIds.length];
    return { strategy: mode, candidateTemplateIds, candidatePoolInputIds: inputIds,
      excludedTemplateIds: inputIds.filter(id => !candidateTemplateIds.includes(id)), candidateEligibilityRecords: eligibilityRecords,
      candidatePoolSha256: poolSha256, sourceFingerprintSha256: sourceSha256,
      selectionAlgorithm: "sha256-source-affinity-v3", selectionDigest, selectedTemplateId: selected,
      candidateReferenceSha256, candidateReferenceRecords };
  }
  const candidateTemplateIds = [...templateIds].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const poolSha256 = sha256(JSON.stringify(candidateTemplateIds));
  const sourceSha256 = sourceFingerprint(source);
  const selectionDigest = sha256(`${line}\n${sourceSha256}\n${poolSha256}`);
  const selectedIndex = mode === "2_random_template"
    ? Number.parseInt(selectionDigest.slice(0, 12), 16) % candidateTemplateIds.length : 0;
  const selected = mode === "2_random_template" ? candidateTemplateIds[selectedIndex] : selectedTemplateId;
  return {
    strategy: mode,
    candidateTemplateIds,
    candidatePoolSha256: poolSha256,
    sourceFingerprintSha256: sourceSha256,
    selectionAlgorithm: mode === "2_random_template" ? "sha256-source-affinity-v1" : "explicit-template-v1",
    selectionDigest,
    selectedTemplateId: selected,
    candidateReferenceSha256: Object.fromEntries(candidateTemplateIds.map(id => [id, templateReferenceHashes(templateMap[id].directory)]))
  };
}
const EXECUTOR_FOR_PIPELINE = Object.freeze({
  "cdp-a": "cdp-a-worker", "cdp-b": "cdp-b-worker",
  "codex-api": "codex-host-agent", gemini: "gemini-worker"
});
const ENGINE_FOR_PIPELINE = Object.freeze({
  "cdp-a": "chatgpt-web", "cdp-b": "chatgpt-web",
  "codex-api": "native-imagegen", gemini: "gemini-imagegen"
});
function sidecarPath(directory, name) {
  if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new Error("Invalid evidence name");
  const root = fs.realpathSync(directory);
  const filename = path.join(directory, name);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Evidence is not a regular file");
  const real = fs.realpathSync(filename);
  if (!inside(root, real) || real !== path.resolve(filename)) throw new Error("Evidence escaped request directory");
  const raw = fs.readFileSync(real);
  return { filename: real, raw, value: JSON.parse(raw.toString("utf8")), stat };
}
function readOptionalSidecar(directory, name) {
  try { return sidecarPath(directory, name); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function safeRequestDirectory(ctx, requestId) {
  if (typeof requestId !== "string" || !/^[a-f0-9]{64}$/.test(requestId)) fail("请求编号无效");
  const root = requestsRoot(ctx);
  const directory = path.join(root, requestId);
  let stat;
  try { stat = fs.lstatSync(directory); } catch (error) { if (error.code === "ENOENT") fail("找不到该制作请求", 404); throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("请求目录无效", 404);
  const record = readRecord(directory, requestId, root);
  return { directory, record };
}
function lifecycleSnapshot(directory, request) {
  const claimFile = readOptionalSidecar(directory, "execution-claim.json");
  const receiptFile = readOptionalSidecar(directory, "generation-receipt.json");
  const claim = claimFile?.value || null;
  let status = claim ? "CLAIMED_NOT_STARTED" : "PREPARED_NOT_GENERATED";
  let receipt = null;
  if (receiptFile) {
    receipt = receiptFile.value;
    status = receipt?.requestId === request.requestId && receipt?.pipeline === request.pipeline
      && Array.isArray(receipt?.outputs) && receipt.outputs.length === request.sourceCount
      ? "GENERATED_PENDING_QA" : "GENERATION_EVIDENCE_INVALID";
    if (status === "GENERATED_PENDING_QA") {
      for (const item of receipt.outputs) {
        try {
          const current = fs.statSync(item.nativePath);
          if (!current.isFile() || current.size !== item.nativeBytes || current.mtimeMs !== item.nativeMtimeMs
              || fs.realpathSync(item.nativePath) !== item.nativePath
              || sha256(fs.readFileSync(item.nativePath)) !== item.nativeSha256) {
            status = "OUTPUT_CHANGED_AFTER_RECEIPT";
            break;
          }
        } catch (_) { status = "OUTPUT_MISSING_AFTER_RECEIPT"; break; }
      }
    }
  }
  const generationValid = status === "GENERATED_PENDING_QA";
  let qaState = "NOT_REPORTED";
  const packageFile = readOptionalSidecar(directory, "package-receipt.json");
  if (packageFile && generationValid) {
    const evidence = packageFile.value;
    let inputsValid = true;
    try { verifyRequestInputHashes(JSON.parse(fs.readFileSync(path.join(directory, 'request.json'), 'utf8'))); }
    catch (_) { inputsValid = false; }
    const roots = [path.join(directory, 'package'), path.join(directory, 'outputs')];
    const valid = inputsValid && evidence.requestId === request.requestId && evidence.status === 'PACKAGE_VERIFIED_PENDING_DELIVERY'
      && Array.isArray(evidence.artifacts) && evidence.artifacts.length >= 5
      && evidence.artifacts.every(item => {
        try {
          const allowed = [path.join(directory, 'request.json'), path.join(directory, 'generation-receipt.json')].includes(item.path)
            || roots.some(root => inside(root, item.path));
          return allowed && fs.realpathSync(item.path) === item.path
            && sha256(fs.readFileSync(item.path)) === item.sha256;
        } catch (_) { return false; }
      });
    status = valid ? 'PACKAGE_VERIFIED_PENDING_DELIVERY' : 'PACKAGE_CHANGED_AFTER_VERIFICATION';
    qaState = valid ? 'PASS_REPORTED' : 'EVIDENCE_INVALID';
  }
  return {
    status, completed: false,
    lifecycle: {
      schemaVersion: 1,
      claimState: claim ? "CLAIMED" : "UNCLAIMED",
      executorId: claim?.executorId || null,
      claimedAtUtc: claim?.claimedAtUtc || null,
      generationState: generationValid ? "GENERATED_PENDING_QA" : receipt ? status : "NOT_REPORTED",
      generatedPages: generationValid ? receipt.outputs.length : 0,
      generationReceiptSha256: receiptFile ? sha256(receiptFile.raw) : null,
      generationRecordedAtUtc: receipt?.recordedAtUtc || null,
      qaState,
      deliveryState: "NOT_REPORTED"
    }
  };
}
function atomicCreateJson(directory, name, value) {
  const target = path.join(directory, name);
  const temporary = path.join(directory, `.${name.slice(0, -5)}-${randomUUID()}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  try {
    fs.writeFileSync(temporary, bytes, { flag: "wx" });
    fs.linkSync(temporary, target);
    return { created: true, bytes };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { created: false, existing: sidecarPath(directory, name) };
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) { /* no staged file */ }
  }
}
function claimRequest(requestId, body, ctx, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["executorId", "workerId"].includes(key))) fail("领取请求字段无效");
  const { directory, record } = safeRequestDirectory(ctx, requestId);
  if (DISABLED_PIPELINES.has(record.pipeline)) fail("Gemini 团建产线已按用户要求停用；历史请求不再领取", 410);
  const expectedExecutor = EXECUTOR_FOR_PIPELINE[record.pipeline];
  if (body.executorId !== expectedExecutor) fail("领取执行器与请求产线不匹配", 409);
  if (!isUuid(body.workerId)) fail("缺少本次执行器实例 ID");
  const existing = readOptionalSidecar(directory, "execution-claim.json");
  if (existing) {
    const claim = existing.value;
    if (claim.requestId === requestId && claim.executorId === expectedExecutor && claim.workerId === body.workerId) {
      return { ok: true, ...record, ...lifecycleSnapshot(directory, record), claim, idempotent: true };
    }
    fail("该请求已被其他执行器领取；须先核对原执行器是否仍在运行，不能重复派发", 409);
  }
  const claim = {
    schemaVersion: 1, requestId, pipeline: record.pipeline, mode: record.mode,
    executorId: expectedExecutor, workerId: body.workerId.toLowerCase(),
    claimId: randomUUID(), claimedAtUtc: now.toISOString(), state: "CLAIMED",
    completed: false
  };
  const created = atomicCreateJson(directory, "execution-claim.json", claim);
  if (!created.created) fail("请求领取发生并发冲突；请回读该请求状态后再决定下一步", 409);
  return { ok: true, ...record, ...lifecycleSnapshot(directory, record), claim, idempotent: false };
}
function verifyRequestInputHashes(request) {
  const inputs = [...(request.sourceImages || []), ...(request.sourceText || []),
    ...Object.values(request.template?.references || {})];
  for (const item of inputs) {
    if (!item || typeof item.path !== "string" || !path.isAbsolute(item.path)
      || !/^[a-f0-9]{64}$/.test(item.sha256 || "")) fail("制作请求输入记录无效", 409);
    let stat, real, bytes;
    try { stat = fs.lstatSync(item.path); real = fs.realpathSync(item.path); bytes = fs.readFileSync(real); }
    catch (_) { fail("原素材或母版文件已不可读，拒绝回写生成回执", 409); }
    if (!stat.isFile() || stat.isSymbolicLink() || real !== item.path
      || sha256(bytes) !== item.sha256 || bytes.length !== item.bytes) fail("原素材或母版文件哈希已变化，拒绝回写生成回执", 409);
  }
}
function imageSignature(filename) {
  const ext = path.extname(filename).toLowerCase();
  const data = fs.readFileSync(filename);
  if (ext === ".png" && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return true;
  if ((ext === ".jpg" || ext === ".jpeg") && data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return true;
  if (ext === ".webp" && data.length > 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return true;
  return false;
}
function validateGenerationReceipt(requestId, body, directory, record) {
  if (DISABLED_PIPELINES.has(record.pipeline)) fail("Gemini 团建产线已按用户要求停用；不再接收生成回执", 410);
  if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["schemaVersion", "requestId", "pipeline", "engine", "claimId", "executorId", "workerId", "outputs"].includes(key))) fail("生成回执字段无效");
  if (body.schemaVersion !== 1 || body.requestId !== requestId || body.pipeline !== record.pipeline
      || body.engine !== ENGINE_FOR_PIPELINE[record.pipeline] || !Array.isArray(body.outputs)
      || body.outputs.length !== record.sourceCount) fail("生成回执与请求产线/页数/引擎不一致", 409);
  verifyRequestInputHashes(JSON.parse(fs.readFileSync(path.join(directory, "request.json"), "utf8")));
  const claim = readOptionalSidecar(directory, "execution-claim.json")?.value;
  if (!claim || claim.state !== "CLAIMED" || claim.claimId !== body.claimId
      || claim.executorId !== body.executorId || claim.workerId !== body.workerId) fail("生成回执没有匹配的执行器领取凭证", 409);
  const request = JSON.parse(fs.readFileSync(path.join(directory, "request.json"), "utf8"));
  const outputRoot = path.join(directory, "outputs");
  fs.mkdirSync(outputRoot, { recursive: true });
  if (fs.lstatSync(outputRoot).isSymbolicLink() || fs.realpathSync(outputRoot) !== path.resolve(outputRoot)) fail("请求输出目录不能是链接", 409);
  const sourceByPage = request.sourceImages;
  const forbidden = new Set([...sourceByPage.map(item => item.sha256), ...Object.values(request.template.references || {}).map(item => item.sha256)]);
  const pages = new Set(), calls = new Set(), paths = new Set(), hashes = new Set();
  const outputs = body.outputs.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)
        || Object.keys(item).some(key => !["page", "sourceSha256", "nativePath", "nativeSha256", "generationCallId"].includes(key))) fail("生成页回执字段无效");
    const page = item.page;
    if (!Number.isInteger(page) || page < 1 || page > record.sourceCount || pages.has(page)
      || item.sourceSha256 !== sourceByPage[page - 1].sha256) fail("输出页与原素材页映射不一致", 409);
    if (!isUuid(item.generationCallId)
      || calls.has(item.generationCallId.toLowerCase())) fail("缺少唯一的本地生成调用 UUID", 409);
    if (typeof item.nativePath !== "string" || !path.isAbsolute(item.nativePath)
      || !/^[a-f0-9]{64}$/.test(item.nativeSha256 || "")) fail("原生输出路径或哈希格式无效");
    let stat, real, bytes;
    try { stat = fs.lstatSync(item.nativePath); real = fs.realpathSync(item.nativePath); bytes = fs.readFileSync(real); }
    catch (_) { fail(`第 ${page} 页原生输出实物不存在`, 409); }
    if (!stat.isFile() || stat.isSymbolicLink() || real !== item.nativePath || !inside(outputRoot, real)
      || sha256(bytes) !== item.nativeSha256 || forbidden.has(item.nativeSha256) || !imageSignature(real))
      fail(`第 ${page} 页原生输出未通过路径、哈希或图片格式回读`, 409);
    const callId = item.generationCallId.toLowerCase();
    pages.add(page); calls.add(callId); paths.add(real); hashes.add(item.nativeSha256);
    return { page, sourceSha256: item.sourceSha256, nativePath: real, nativeSha256: item.nativeSha256,
      nativeBytes: stat.size, nativeMtimeMs: stat.mtimeMs, generationCallId: callId,
      callIdentityScope: "host-local-uuid-not-provider-issued" };
  }).sort((a, b) => a.page - b.page);
  if (pages.size !== record.sourceCount || paths.size !== record.sourceCount || hashes.size !== record.sourceCount)
    fail("输出页重复或套图不完整", 409);
  const normalized = {
    schemaVersion: 1, requestId, pipeline: record.pipeline, engine: body.engine,
    claimId: claim.claimId, executorId: claim.executorId, workerId: claim.workerId,
    outputs, recordedAtUtc: new Date().toISOString(), status: "GENERATED_PENDING_QA", completed: false,
    evidenceScope: "host-reported-native-call-and-page-hash-binding-only"
  };
  return { normalized, submissionSha256: sha256(Buffer.from(canonicalJson(body), "utf8")) };
}
function submitGenerationReceipt(requestId, body, ctx) {
  const { directory, record } = safeRequestDirectory(ctx, requestId);
  const validated = validateGenerationReceipt(requestId, body, directory, record);
  const existing = readOptionalSidecar(directory, "generation-receipt.json");
  if (existing) {
    if (existing.value.requestId === requestId && existing.value.submissionSha256 === validated.submissionSha256) {
      return { ok: true, ...record, ...lifecycleSnapshot(directory, record), idempotent: true };
    }
    fail("已有生成回执内容不同；保留原证据并停止覆盖", 409);
  }
  validated.normalized.submissionSha256 = validated.submissionSha256;
  const created = atomicCreateJson(directory, "generation-receipt.json", validated.normalized);
  if (!created.created) fail("生成回执发生并发冲突；先回读现有证据", 409);
  return { ok: true, ...record, ...lifecycleSnapshot(directory, record), idempotent: false };
}
async function submitPackageReceipt(requestId, body, ctx, execute = executeFile) {
  const { directory, record } = safeRequestDirectory(ctx, requestId);
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['claimId', 'executorId', 'workerId', 'manifestPath', 'manifestSha256'].includes(key)))
    fail('整套验收字段无效');
  const claim = readOptionalSidecar(directory, 'execution-claim.json')?.value;
  if (!claim || claim.claimId !== body.claimId || claim.executorId !== body.executorId || claim.workerId !== body.workerId)
    fail('整套验收没有匹配的任务领取凭证', 409);
  if (record.status !== 'GENERATED_PENDING_QA' && record.status !== 'PACKAGE_VERIFIED_PENDING_DELIVERY')
    fail('请先补齐本请求的所有生成图片', 409);
  if (typeof body.manifestPath !== 'string' || !path.isAbsolute(body.manifestPath)
      || !inside(path.join(directory, 'package'), body.manifestPath)
      || !/^[a-f0-9]{64}$/.test(body.manifestSha256 || '')) fail('成品清单路径或哈希无效');
  const output = await execute(typeof ctx.pythonExe === 'function' ? ctx.pythonExe() : 'python',
    [path.join(skillRoot(), 'scripts', 'verify_work_package.py'), '--request', path.join(directory, 'request.json'),
      '--manifest', body.manifestPath],
    { shell: false, windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
  const evidence = JSON.parse(output.stdout);
  if (evidence.requestId !== requestId || evidence.manifestSha256 !== body.manifestSha256
      || evidence.status !== 'PACKAGE_VERIFIED_PENDING_DELIVERY' || evidence.completed !== false
      || evidence.imageCount !== record.sourceCount || evidence.copyVersions !== 11) fail('整套实物验证不匹配', 409);
  const existing = readOptionalSidecar(directory, 'package-receipt.json');
  if (existing && existing.value.manifestSha256 !== evidence.manifestSha256) fail('已有不同整套验收记录，保留原证据', 409);
  if (!existing) {
    const created = atomicCreateJson(directory, 'package-receipt.json', { ...evidence, recordedAtUtc: new Date().toISOString() });
    if (!created.created) fail('整套验收记录发生并发冲突，请先回读', 409);
  }
  const current = lifecycleSnapshot(directory, record);
  if (current.status !== 'PACKAGE_VERIFIED_PENDING_DELIVERY') fail('验收后文件发生变化，请检查', 409);
  return { ok: true, ...record, ...current, idempotent: !!existing };
}
function readRecord(directory, expectedId, trustedRoot) {
  const requestPath = path.join(directory, "request.json");
  const realDirectory = fs.realpathSync(directory), realFile = fs.realpathSync(requestPath);
  const realRoot = fs.realpathSync(trustedRoot || directory);
  if (!inside(realRoot, realDirectory) || !inside(realDirectory, realFile) ||
      fs.lstatSync(directory).isSymbolicLink() || fs.lstatSync(requestPath).isSymbolicLink()) throw new Error("Request escaped isolated root");
  const raw = fs.readFileSync(requestPath);
  const request = JSON.parse(raw.toString("utf8"));
  if (request.requestId !== expectedId || !/^[a-f0-9]{64}$/.test(expectedId) || !LINES.has(request.pipeline) || !MODES.has(request.mode) ||
      request.status !== "PREPARED_NOT_GENERATED" || !Array.isArray(request.sourceImages) ||
      !request.sourceImages.length || request.expectedPages !== request.sourceImages.length ||
      requestIdentity(request) !== expectedId) throw new Error("Invalid request evidence");
  const templateCandidates = request.modeEvidence?.candidateTemplateIds || [];
  const selectedTemplateId = request.modeEvidence?.selectedTemplateId || request.template?.id || "";
  const configurationRevision = request.selection?.configurationRevision || null;
  const selection = request.selection || selectionRecord(request.pipeline, request.mode, templateCandidates,
    selectedTemplateId, null, request.modeEvidence?.candidateReferenceSha256?.[selectedTemplateId] || null);
  if (selection.schemaVersion !== 1 || selection.pipeline !== request.pipeline || selection.mode !== request.mode ||
      !Array.isArray(selection.templateCandidates) ||
      canonicalJson(selection.templateCandidates) !== canonicalJson(templateCandidates) ||
      selection.selectedTemplateId !== selectedTemplateId ||
      canonicalJson(selection.selectedTemplateReferenceSha256) !== canonicalJson(request.modeEvidence?.candidateReferenceSha256?.[selectedTemplateId] || null) ||
      !(selection.configurationRevision === null || /^sha256:[a-f0-9]{64}$/.test(selection.configurationRevision)) ||
      (request.selection && request.selection.selectedTemplateId !== selectedTemplateId)) throw new Error("Invalid request selection evidence");
  const lifecycle = lifecycleSnapshot(directory, {
    requestId: request.requestId, pipeline: request.pipeline, sourceCount: request.expectedPages
  });
  return { requestId: request.requestId, requestPath, requestSha256: createHash("sha256").update(raw).digest("hex"),
    ...lifecycle, pipeline: request.pipeline,
    sourcePath: request.sourcePath, sourceCount: request.expectedPages, mode: request.mode,
    templateId: request.template?.id || "", templateCandidates: request.modeEvidence?.candidateTemplateIds || [],
    candidateCount: request.modeEvidence?.candidateTemplateIds?.length || 0,
    modeEvidence: request.modeEvidence || null, selection };
}
function listRequests(ctx) {
  const root = requestsRoot(ctx);
  if (!fs.existsSync(root)) return { ok: true, requests: [], omittedInvalidCount: 0, limit: 20 };
  const records = [], entries = fs.readdirSync(root, { withFileTypes: true }); let omitted = 0;
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const directory = path.join(root, entry.name);
      const record = readRecord(directory, entry.name, root);
      records.push({ ...record, modifiedAt: fs.statSync(record.requestPath).mtime.toISOString() });
    } catch (_) { omitted++; }
  }
  records.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return { ok: true, requests: records.slice(0, 20), omittedInvalidCount: omitted, limit: 20 };
}
function safeReportedState(value) {
  const state = String(value || "").trim().toUpperCase();
  return ["ONLINE", "IDLE", "BUSY", "PRODUCING", "ERROR", "OFFLINE", "COOLDOWN", "UNKNOWN"].includes(state)
    ? state : "UNKNOWN";
}
function reportedStateLabel(state) {
  return ({ ONLINE: "在线", IDLE: "空闲", BUSY: "忙碌", PRODUCING: "生产中", ERROR: "异常", OFFLINE: "离线", COOLDOWN: "冷却中", UNKNOWN: "状态未知" })[state] || "状态未知";
}
function readLegacyCdpRuntime(profile, now = new Date()) {
  const configured = profile?.runtimeEvidenceSources?.cdpDaemon;
  const statusFile = configured?.statusFile;
  const staleAfterSeconds = Number.isInteger(configured?.staleAfterSeconds)
    ? Math.max(30, Math.min(configured.staleAfterSeconds, 1800)) : DEFAULT_RUNTIME_STALE_AFTER_SECONDS;
  const base = { id: "legacy-cdp-daemon", label: "CDP 旧执行器状态", staleAfterSeconds,
    state: "UNCONFIGURED", stateLabel: "运行状态源未配置", observedAtUtc: null, ageSeconds: null,
    lastHeartbeatAtUtc: null, queueRemaining: null, lastCompletedAt: null, lastCompletedInstance: null,
    instanceStates: { A: "UNKNOWN", B: "UNKNOWN" }, detail: "没有配置可回读的 CDP 执行器状态文件。" };
  if (typeof statusFile !== "string" || !path.isAbsolute(statusFile)) return base;
  try {
    const resolved = path.resolve(statusFile);
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("configured status source is not a regular file");
    const data = JSON.parse(fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, ""));
    if (!data || typeof data.last_heartbeat !== "string" || !data.instances ||
        !data.instances.A || !data.instances.B) throw new Error("invalid legacy status shape");
    const observedAtUtc = stat.mtime.toISOString();
    const heartbeatMs = Date.parse(data.last_heartbeat.replace(" ", "T"));
    if (!Number.isFinite(heartbeatMs)) throw new Error("invalid heartbeat time");
    const observedMs = stat.mtimeMs;
    const heartbeatAge = Math.floor((now.getTime() - heartbeatMs) / 1000);
    const fileAge = Math.floor((now.getTime() - observedMs) / 1000);
    if (heartbeatAge < -60 || fileAge < -60) throw new Error("runtime evidence time is in the future");
    const ageSeconds = Math.max(0, heartbeatAge, fileAge);
    const lastCompleted = data.last_completed && typeof data.last_completed === "object" ? data.last_completed : {};
    const completedPath = typeof lastCompleted.product_path === "string" ? lastCompleted.product_path : "";
    const state = ageSeconds <= staleAfterSeconds ? "FRESH" : "STALE";
    const stateLabel = state === "FRESH" ? "状态源新鲜" : "状态源已过期";
    return {
      ...base,
      state,
      stateLabel,
      observedAtUtc,
      ageSeconds,
      lastHeartbeatAtUtc: new Date(heartbeatMs).toISOString(),
      queueRemaining: state === "FRESH" && Number.isInteger(data.queue_remaining) && data.queue_remaining >= 0 ? data.queue_remaining : null,
      lastCompletedAt: typeof lastCompleted.time === "string" ? lastCompleted.time : null,
      lastCompletedInstance: ["A", "B", "C"].includes(lastCompleted.instance) ? lastCompleted.instance : null,
      lastCompletedTitle: completedPath ? path.win32.basename(completedPath) : null,
      instanceStates: { A: safeReportedState(data.instances.A.state), B: safeReportedState(data.instances.B.state) },
      detail: state === "FRESH"
        ? "这是旧 CDP 执行器的状态回读；它只说明执行器报告，不代表图片质检或整套交付完成。"
        : "只保留最后一次观测供排查；过期状态不能当作当前在线、离线或生产进度。"
    };
  } catch (_) {
    return { ...base, state: "UNAVAILABLE", stateLabel: "状态源不可读", detail: "配置的 CDP 运行状态文件缺失或格式无效。" };
  }
}
function runtimeExecutor(pipeline, cdpSource) {
  if (pipeline === "cdp-a" || pipeline === "cdp-b") {
    const instanceId = pipeline === "cdp-a" ? "A" : "B";
    const reportedState = cdpSource.instanceStates[instanceId];
    if (cdpSource.state !== "FRESH") return {
      pipeline, instanceId, state: cdpSource.state, stateLabel: cdpSource.stateLabel,
      observedAtUtc: cdpSource.observedAtUtc, ageSeconds: cdpSource.ageSeconds, reportedState,
      queueRemaining: null, lastCompletedAt: null, lastCompletedTitle: null,
      detail: cdpSource.detail, sourceId: cdpSource.id
    };
    const label = reportedStateLabel(reportedState);
    return {
      pipeline, instanceId, state: `REPORTED_${reportedState}`, stateLabel: `执行器报告：${label}`,
      observedAtUtc: cdpSource.observedAtUtc, ageSeconds: cdpSource.ageSeconds, reportedState,
      queueRemaining: cdpSource.queueRemaining,
      lastCompletedAt: cdpSource.lastCompletedAt,
      lastCompletedTitle: cdpSource.lastCompletedTitle,
      detail: "执行器状态不等同于作品生成、质检或入库回执。", sourceId: cdpSource.id
    };
  }
  if (pipeline === "codex-api") return {
    pipeline, instanceId: "default", state: "UNOBSERVED", stateLabel: "工作台未接入宿主执行回执",
    observedAtUtc: null, ageSeconds: null, reportedState: null,
    queueRemaining: null, lastCompletedAt: null, lastCompletedTitle: null,
    detail: "Codex 原生生图由当前对话宿主提供；工作台尚无与作品请求对应的宿主回执，因此不能显示实时任务状态。", sourceId: "codex-host"
  };
  if (DISABLED_PIPELINES.has(pipeline)) return {
    pipeline, instanceId: "default", state: "DISABLED_BY_USER", stateLabel: "用户已停用",
    observedAtUtc: null, ageSeconds: null, reportedState: null,
    queueRemaining: null, lastCompletedAt: null, lastCompletedTitle: null,
    detail: "Gemini 团建生产已停止；历史记录仅供查看。", sourceId: "gemini-runtime"
  };
  return {
    pipeline, instanceId: "default", state: "UNCONNECTED", stateLabel: "Gemini 执行器未接入",
    observedAtUtc: null, ageSeconds: null, reportedState: null,
    queueRemaining: null, lastCompletedAt: null, lastCompletedTitle: null,
    detail: "当前统一请求链没有已验证的 Gemini 执行器。", sourceId: "gemini-runtime"
  };
}
function productionRuntimeSnapshot(ctx, capabilities, capturedAt) {
  let profile;
  try { profile = serverProfile(ctx); } catch (_) { profile = null; }
  const cdpSource = readLegacyCdpRuntime(profile, new Date(capturedAt));
  const codexSource = { id: "codex-host", label: "Codex 宿主回执", state: "UNOBSERVED",
    stateLabel: "未接入工作台", staleAfterSeconds: null, observedAtUtc: null, ageSeconds: null,
    detail: "工作台当前没有 Codex 宿主生图的状态回执。" };
  const geminiSource = { id: "gemini-runtime", label: "Gemini 团建产线", state: "UNCONNECTED",
    stateLabel: "用户已停用", staleAfterSeconds: null, observedAtUtc: null, ageSeconds: null,
    detail: "Gemini 团建生产已停止；历史记录仅供查看。" };
  const sources = [cdpSource, codexSource, geminiSource];
  const sourceByPipeline = { "cdp-a": cdpSource, "cdp-b": cdpSource, "codex-api": codexSource, gemini: geminiSource };
  const executors = LINE_CATALOG.flatMap(line => line.instances.map(instance => runtimeExecutor(instance.pipeline, sourceByPipeline[instance.pipeline])));
  return { revision: RUNTIME_REVISION, capturedAtUtc: capturedAt, sources, executors };
}
function productionStateSnapshot(ctx) {
  const capturedAt = new Date().toISOString();
  const capabilities = capabilitySnapshot(ctx);
  const requestState = listRequests(ctx);
  return {
    ok: true,
    schemaVersion: STATE_SCHEMA_VERSION,
    asOfUtc: capturedAt,
    catalog: { lines: LINE_CATALOG, modes: MODE_CATALOG },
    selectionSchemaVersion: 1,
    configurationRevision: capabilities.configurationRevision,
    capabilities: {
      revision: capabilities.capabilityRevision,
      selectionSchemaVersion: capabilities.selectionSchemaVersion,
      configurationRevision: capabilities.configurationRevision,
      declaredProfileRevision: capabilities.declaredProfileRevision,
      declaredProfileRevisionState: capabilities.declaredProfileRevisionState,
      profileState: capabilities.profileState,
      savedSelections: capabilities.savedSelections,
      lines: capabilities.lines
    },
    savedSelections: capabilities.savedSelections,
    runtime: productionRuntimeSnapshot(ctx, capabilities, capturedAt),
    requests: requestState.requests,
    omittedInvalidCount: requestState.omittedInvalidCount,
    requestLimit: requestState.limit
  };
}
function validate(body, profile) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("请求须为 JSON 对象");
  if (Object.keys(body).some(key => !["pipeline", "mode", "sourcePath", "templateId", "templateCandidates", "panelMappings", "prompt", "selection"].includes(key))) fail("请求包含不允许的字段");
  const input = body.selection === undefined ? body : body.selection;
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("产线选择必须是 JSON 对象");
  if (body.selection !== undefined && (body.pipeline !== undefined || body.mode !== undefined ||
      body.templateId !== undefined || body.templateCandidates !== undefined || body.panelMappings !== undefined)) fail("请使用统一 selection 字段，不要混合旧式选择字段");
  if (body.selection !== undefined) {
    if (Object.keys(input).some(key => !["schemaVersion", "pipeline", "mode", "templateId", "templateCandidates",
      "selectedTemplateId", "selectedTemplateReferenceSha256", "panelMappings", "configurationRevision"].includes(key))) fail("产线选择包含不允许的字段");
    if (input.schemaVersion !== 1) fail("不支持的产线选择 schema");
    if (!Object.prototype.hasOwnProperty.call(input, "configurationRevision")) fail("产线选择缺少配置版本，请刷新后重试");
  }
  const line = normalizePipeline(input.pipeline);
  if (!LINES.has(line)) fail("请选择在线模式（GPT 网页/CDP）或本地模式（Codex 客户端）");
  if (DISABLED_PIPELINES.has(line)) fail("Gemini 团建产线已按用户要求停用；不会创建新请求", 410);
  if (!ACTIVE_PIPELINES.has(line)) fail("请选择在线模式（GPT 网页/CDP）或本地模式（Codex 客户端）");
  const mode = String(input.mode || "").trim();
  if (!MODES.has(mode)) fail("必须明确选择复刻重组、随机模板或固定模板模式");
  if (typeof body.sourcePath !== "string" || !path.isAbsolute(body.sourcePath) || /[\x00-\x1f]/.test(body.sourcePath)) fail("请选择单个完整素材文件夹");
  if (body.prompt !== undefined && (typeof body.prompt !== "string" || body.prompt.length > 8000)) fail("补充要求最多 8000 字符");
  const selectionInput = body.selection !== undefined;
  const explicitTemplateId = input.selectedTemplateId ?? input.templateId;
  const sourceReplicaMode = mode === "1_replica_shuffle";
  if (sourceReplicaMode && (explicitTemplateId !== undefined || input.templateCandidates !== undefined))
    fail("原作复刻模式使用素材自身作参照，不能选择或继承模板");
  if (sourceReplicaMode && body.selection === undefined && input.panelMappings === undefined)
    fail("复刻重组缺少逐图面板换序表，不能准备请求");
  const candidateIds = sourceReplicaMode ? [] : mode === "2_random_template"
    ? (Array.isArray(input.templateCandidates) ? [...new Set(input.templateCandidates.map(value => String(value || "").trim()).filter(Boolean))].sort() : [])
    : selectionInput && Array.isArray(input.templateCandidates)
      ? [...new Set(input.templateCandidates.map(value => String(value || "").trim()).filter(Boolean))].sort()
      : [String(explicitTemplateId || "").trim()];
  if (!sourceReplicaMode && (!candidateIds.length || candidateIds.some(id => !id))) fail(mode === "2_random_template" ? "请先选择至少两套不同的真实随机候选母版" : "请选择一个真实母版");
  if (mode === "2_random_template" && candidateIds.length < 2) fail("随机模板模式至少需要两套不同的候选母版");
  if (!sourceReplicaMode && mode !== "2_random_template" && (typeof explicitTemplateId !== "string" || !explicitTemplateId.trim())) fail("此模式须明确选择一个已配置母版");
  if (mode === "2_random_template" && input.templateId !== undefined) fail("随机模板由服务端按候选池选择，不得指定固定母版");
  if (!sourceReplicaMode && mode !== "2_random_template" && input.templateCandidates !== undefined && !selectionInput) fail("只有随机模板模式可以提交候选母版池");
  if (!sourceReplicaMode && mode !== "2_random_template" && selectionInput &&
      (candidateIds.length !== 1 || candidateIds[0] !== String(explicitTemplateId || "")))
    fail("固定模式的候选母版必须与已选母版一致");
  const templateMap = {};
  for (const id of candidateIds) {
    const template = profile.templates?.[id];
    if (!template || typeof template.directory !== "string" || !path.isAbsolute(template.directory)) fail(`母版 ${id} 尚未配置真实参照目录`, 503);
    templateMap[id] = template;
  }
  let source, directory;
  try {
    source = fs.realpathSync(body.sourcePath);
    for (const template of Object.values(templateMap)) template.directory = fs.realpathSync(template.directory);
  } catch (_) { fail("素材或母版实物目录不存在"); }
  if (!fs.statSync(source).isDirectory()) fail("素材必须是完整素材文件夹");
  if (Object.values(templateMap).some(template => !fs.statSync(template.directory).isDirectory())) fail("母版参照必须是文件夹");
  const selectedTemplateId = sourceReplicaMode ? SOURCE_REPLICA_TEMPLATE_ID : mode === "2_random_template" ? "" : candidateIds[0];
  const panelMappings = input.panelMappings ?? null;
  const modeEvidence = makeModeEvidence(line, mode, source, candidateIds, templateMap, selectedTemplateId, panelMappings);
  const effectiveCandidateIds = sourceReplicaMode ? [] : (modeEvidence.candidateTemplateIds || candidateIds);
  const effectiveTemplateId = sourceReplicaMode ? SOURCE_REPLICA_TEMPLATE_ID : modeEvidence.selectedTemplateId;
  if (input.selectedTemplateId && input.selectedTemplateId !== effectiveTemplateId)
    fail("所选母版与当前产线/素材/候选池不一致，请刷新后重新选择", 409);
  directory = sourceReplicaMode ? null : templateMap[effectiveTemplateId].directory;
  const configuration = templatePoolSnapshot(profile);
  const configurationRevision = configuration.configurationRevision;
  if (input.configurationRevision !== undefined && input.configurationRevision !== configurationRevision)
    fail("产线或模板设置已变化，请刷新后重新选择", 409);
  const roots = Array.isArray(profile.materialRoots) ? profile.materialRoots : [];
  const allowed = roots.some(root => { try { return inside(fs.realpathSync(root), source); } catch (_) { return false; } });
  if (!allowed) fail("素材不在服务端配置的素材库内");
  const selectedTemplateReferenceSha256 = modeEvidence.candidateReferenceSha256?.[effectiveTemplateId] ?? null;
  if (input.selectedTemplateReferenceSha256 !== undefined &&
      canonicalJson(input.selectedTemplateReferenceSha256) !== canonicalJson(selectedTemplateReferenceSha256))
    fail("模板 P1/P2 已变化，请刷新后重新选择", 409);
  return { line, source, directory, mode, templateId: effectiveTemplateId,
    templateCandidates: effectiveCandidateIds, modeEvidence,
    selection: selectionRecord(line, mode, effectiveCandidateIds, effectiveTemplateId, configurationRevision,
      selectedTemplateReferenceSha256, panelMappings),
    instruction: body.prompt || "" };
}

async function prepare(body, ctx, execute = executeFile) {
  const selected = validate(body, serverProfile(ctx));
  const script = path.join(skillRoot(), "scripts", "real_dispatch.py");
  const base = requestsRoot(ctx);
  fs.mkdirSync(base, { recursive: true });
  const staging = fs.mkdtempSync(path.join(base, ".prepare-"));
  const args = [script, "--line", selected.line, "--mode", selected.mode, "--material", selected.source];
  if (selected.mode !== "1_replica_shuffle") args.push("--template", selected.templateId, "--template-dir", selected.directory);
  args.push("--output", staging);
  args.push(`--mode-evidence=${JSON.stringify(selected.modeEvidence)}`);
  if (selected.instruction) args.push(`--instruction=${selected.instruction}`);
  let result;
  try {
    const output = await execute(typeof ctx.pythonExe === "function" ? ctx.pythonExe() : "python", args,
      { shell: false, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024, encoding: "utf8" });
    result = JSON.parse(output.stdout);
    const request = JSON.parse(fs.readFileSync(path.join(staging, "request.json"), "utf8"));
    if (result.status !== "PREPARED_NOT_GENERATED" || result.completed !== false ||
        typeof result.requestPath !== "string" || path.resolve(result.requestPath) !== path.join(staging, "request.json") ||
        fs.realpathSync(result.requestPath) !== fs.realpathSync(path.join(staging, "request.json")) ||
        !/^[a-f0-9]{64}$/.test(result.requestId || "") || request.requestId !== result.requestId ||
        request.pipeline !== selected.line || request.mode !== selected.mode || request.status !== "PREPARED_NOT_GENERATED" ||
        request.sourcePath !== selected.source || request.template?.id !== selected.templateId || request.mode !== selected.mode ||
        canonicalJson(request.modeEvidence) !== canonicalJson(selected.modeEvidence) ||
        (request.userInstruction || "") !== selected.instruction || requestIdentity(request) !== result.requestId ||
        !Array.isArray(request.sourceImages) || !request.sourceImages.length || request.expectedPages !== request.sourceImages.length)
      fail("制作请求回读未通过，尚未开始生产", 502);
    // Bind the UI selection and effective configuration revision into the
    // immutable identity after verifying the skill CLI's prepared request.
    request.selection = selected.selection;
    request.requestId = requestIdentity(request);
    fs.writeFileSync(path.join(staging, "request.json"), `${JSON.stringify(request)}\n`, { flag: "w" });
    result.requestId = request.requestId;
    readRecord(staging, result.requestId, base);
    const destination = path.join(base, result.requestId);
    if (fs.existsSync(destination)) {
      readRecord(destination, result.requestId, base);
      const existing = fs.readFileSync(path.join(destination, "request.json"), "utf8");
      if (existing !== fs.readFileSync(path.join(staging, "request.json"), "utf8")) fail("既有请求实物冲突", 409);
    } else {
      try { fs.renameSync(staging, destination); }
      catch (error) {
        if (!fs.existsSync(destination) || fs.readFileSync(path.join(destination, "request.json"), "utf8") !==
            fs.readFileSync(path.join(staging, "request.json"), "utf8")) throw error;
      }
    }
    return { ok: true, ...readRecord(destination, result.requestId, base),
      message: "制作请求已保存并回读；尚未生成图片，尚未计入完成。" };
  } finally {
    // Remove only this handler's empty/preparation staging directory, never user artifacts.
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
  }
}

async function handle(req, res, pathname, parsed, ctx) {
  if (pathname === "/api/production/state" && req.method === "GET") {
    try { ctx.sendJson(res, productionStateSnapshot(ctx)); }
    catch (_) { ctx.send(res, 503, JSON.stringify({ ok: false, error: "产线状态暂不可核实" }), "application/json; charset=utf-8"); }
    return true;
  }
  if (pathname === "/api/production/capabilities" && req.method === "GET") {
    try { ctx.sendJson(res, capabilitySnapshot(ctx)); }
    catch (_) { ctx.send(res, 503, JSON.stringify({ ok: false, error: "产线能力状态暂不可核实" }), "application/json; charset=utf-8"); }
    return true;
  }
  if (pathname === "/api/production/requests" && req.method === "GET") {
    try { ctx.sendJson(res, listRequests(ctx)); }
    catch (_) { ctx.send(res, 503, JSON.stringify({ ok: false, error: "制作请求回读失败" }), "application/json; charset=utf-8"); }
    return true;
  }
  const requestLifecycleRoute = pathname.match(/^\/api\/production\/requests\/([a-f0-9]{64})(?:\/(claim|receipt|package))?$/);
  if (requestLifecycleRoute) {
    const requestId = requestLifecycleRoute[1], action = requestLifecycleRoute[2] || "read";
    if (req.method === "GET" && action === "read") {
      try {
        const { directory, record } = safeRequestDirectory(ctx, requestId);
        const request = JSON.parse(fs.readFileSync(path.join(directory, "request.json"), "utf8"));
        const claim = readOptionalSidecar(directory, "execution-claim.json")?.value || null;
        const generationReceipt = readOptionalSidecar(directory, "generation-receipt.json")?.value || null;
        ctx.sendJson(res, { ok: true, ...record, claim, generationReceipt,
          message: "只回读执行声明与文件证据；不证明主观质检、正式归档或飞书交付。" });
      } catch (error) {
        ctx.send(res, error.status || 503, JSON.stringify({ ok: false, error: error.status ? error.message : "制作请求回读失败" }), "application/json; charset=utf-8");
      }
      return true;
    }
    if (req.method === "POST" && action === "claim") {
      try {
        const body = JSON.parse(await ctx.getBody(req, 16000) || "{}");
        ctx.sendJson(res, claimRequest(requestId, body, ctx));
      } catch (error) {
        ctx.send(res, error.status || 503, JSON.stringify({ ok: false, error: error.status ? error.message : "请求领取失败；未开始生成" }), "application/json; charset=utf-8");
      }
      return true;
    }
    if (req.method === "POST" && action === "package") {
      try {
        const body = JSON.parse(await ctx.getBody(req, 16000) || '{}');
        ctx.sendJson(res, await submitPackageReceipt(requestId, body, ctx));
      } catch (error) {
        ctx.send(res, error.status || 503, JSON.stringify({ ok: false, error: error.status ? error.message : '整套实物验证失败；未记为交付完成' }), 'application/json; charset=utf-8');
      }
      return true;
    }
    if (req.method === "POST" && action === "receipt") {
      try {
        let body; try { body = JSON.parse(await ctx.getBody(req, 2_000_000) || "{}"); } catch (_) { fail("生成回执 JSON 无效"); }
        ctx.sendJson(res, submitGenerationReceipt(requestId, body, ctx));
      } catch (error) {
        ctx.send(res, error.status || 503, JSON.stringify({ ok: false, error: error.status ? error.message : "生成回执校验失败；未记为质检或完成" }), "application/json; charset=utf-8");
      }
      return true;
    }
    if ((req.method === "POST" && action === "read") || (req.method === "GET" && action !== "read")) {
      ctx.send(res, 405, JSON.stringify({ ok: false, error: "请求生命周期方法不匹配" }), "application/json; charset=utf-8");
      return true;
    }
  }
  if (pathname !== "/api/production/requests/prepare" || req.method !== "POST") return false;
  try {
    let body; try { body = JSON.parse(await ctx.getBody(req, 40000) || "{}"); } catch (_) { fail("请求 JSON 无效"); }
    ctx.sendJson(res, await prepare(body, ctx));
  } catch (error) {
    // Do not expose private profile, command arguments or stderr containing local data.
    ctx.send(res, error.status || 503, JSON.stringify({ ok: false, status: "NOT_PREPARED", completed: false,
      error: error.status ? error.message : "制作请求准备失败，尚未生成；请检查服务端配置与实物" }), "application/json; charset=utf-8");
  }
  return true;
}

function readRequest(requestId, ctx) { return safeRequestDirectory(ctx, requestId).record; }
module.exports = { handle, prepare, validate, listRequests, requestIdentity, makeModeEvidence, capabilitySnapshot, savedCodexSelection, readRequest,
  claimRequest, submitGenerationReceipt, submitPackageReceipt, lifecycleSnapshot, validateGenerationReceipt,
  productionStateSnapshot, productionRuntimeSnapshot, readLegacyCdpRuntime, executionCapability, templatePoolSnapshot, LINE_CATALOG, MODE_CATALOG };
