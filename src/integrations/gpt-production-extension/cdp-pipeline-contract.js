(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TBCDPPipelineContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createContractApi() {
  "use strict";

  const MODES = new Set(["1_replica_shuffle", "2_random_template", "3_fixed_template"]);
  const SUPPORTED_MODE = "3_fixed_template";
  const WORKER_VARIANT = "fresh-session-fixed-template";
  const REQUIRED_ROLES = Object.freeze(["P1", "P2"]);

  function contractError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function hasCanonicalPipelineFields(input = {}) {
    return [
      "templateSelectionMode",
      "pipelineConfigRevision",
      "pipelineConfigMode",
      "pipelineConfigTemplateId",
      "pipelineTemplateReferences"
    ].some((key) => Object.prototype.hasOwnProperty.call(input || {}, key));
  }

  function absolutePath(value) {
    const text = String(value || "").trim();
    return /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/]|\/)/i.test(text);
  }

  function basename(value) {
    return String(value || "").replace(/\\/g, "/").split("/").pop() || "";
  }

  function validatePipelineDispatch(input = {}) {
    if (!hasCanonicalPipelineFields(input)) return { enabled: false };

    const selectionMode = String(input.templateSelectionMode || "").trim();
    const configMode = String(input.pipelineConfigMode || "").trim();
    if (!selectionMode || !configMode) {
      throw contractError("PIPELINE_MODE_MISSING", "产线派单缺少模板选择模式或配置模式；已拒绝旧模式回退");
    }
    if (!MODES.has(selectionMode) || !MODES.has(configMode)) {
      throw contractError("PIPELINE_MODE_UNKNOWN", "产线派单包含未知模式；已拒绝执行");
    }
    if (selectionMode !== configMode) {
      throw contractError("PIPELINE_MODE_MISMATCH", "模板选择模式与产线配置模式不一致；已拒绝执行");
    }
    if (configMode !== SUPPORTED_MODE) {
      throw contractError("PIPELINE_MODE_UNSUPPORTED", `当前 CDP 消费端未接入 ${configMode}，已拒绝执行，未回退到账号默认模式`);
    }

    const requestId = String(input.requestId || input.externalRequestId || "").trim();
    const configRevision = String(input.pipelineConfigRevision || "").trim();
    const templateId = String(input.pipelineConfigTemplateId || "").trim();
    const legacyTemplateId = String(input.templateId || input.selectedTemplateId || "").trim();
    if (!requestId || !/^sha256:[a-f0-9]{64}$/.test(configRevision) || !templateId) {
      throw contractError("PIPELINE_CONFIG_INCOMPLETE", "固定模板派单缺少请求 ID、配置版本或模板 ID");
    }
    if (legacyTemplateId && legacyTemplateId !== templateId) {
      throw contractError("PIPELINE_TEMPLATE_ID_MISMATCH", "派单模板 ID 与配置选中模板不一致");
    }

    const rawReferences = input.pipelineTemplateReferences;
    if (!Array.isArray(rawReferences) || rawReferences.length !== REQUIRED_ROLES.length) {
      throw contractError("PIPELINE_TEMPLATE_REFERENCES_MISSING", "固定模板派单必须带 P1、P2 两个已核验附件引用");
    }
    const references = rawReferences.map((item) => ({
      role: String(item?.role || "").trim(),
      path: String(item?.path || "").trim(),
      sha256: String(item?.sha256 || "").trim().toLowerCase(),
      bytes: Number(item?.bytes)
    }));
    const roles = references.map((item) => item.role);
    const paths = references.map((item) => item.path.toLowerCase());
    const names = references.map((item) => basename(item.path).toLowerCase());
    if (REQUIRED_ROLES.some((role) => roles.filter((value) => value === role).length !== 1)
      || new Set(roles).size !== REQUIRED_ROLES.length) {
      throw contractError("PIPELINE_TEMPLATE_ROLES_INVALID", "固定模板附件必须各有且仅有一个 P1 和 P2");
    }
    if (references.some((item) => !absolutePath(item.path)
      || !/^[a-f0-9]{64}$/.test(item.sha256)
      || !Number.isSafeInteger(item.bytes)
      || item.bytes <= 0)) {
      throw contractError("PIPELINE_TEMPLATE_REFERENCE_INVALID", "P1/P2 路径、SHA-256 或字节数无效");
    }
    if (new Set(paths).size !== paths.length || new Set(names).size !== names.length) {
      throw contractError("PIPELINE_TEMPLATE_REFERENCE_AMBIGUOUS", "P1/P2 路径或文件名重复，无法核对浏览器实际附件");
    }

    return {
      enabled: true,
      requestId,
      templateSelectionMode: selectionMode,
      pipelineConfigMode: configMode,
      pipelineConfigRevision: configRevision,
      pipelineConfigTemplateId: templateId,
      workerWorkflowVariant: WORKER_VARIANT,
      references: references.sort((left, right) => REQUIRED_ROLES.indexOf(left.role) - REQUIRED_ROLES.indexOf(right.role))
    };
  }

  function validateWorkerConsumptionProof(contract, proof = {}) {
    if (!contract?.enabled) throw contractError("PIPELINE_CONTRACT_REQUIRED", "缺少已校验的固定模板派单合同");
    if (proof.source !== "tb-gpt-production-extension"
      || proof.type !== "tb-workbench-pipeline-receipt-ready"
      || proof.status !== "REFERENCES_CONSUMED"
      || String(proof.requestId || "") !== contract.requestId
      || String(proof.templateSelectionMode || "") !== contract.templateSelectionMode
      || String(proof.pipelineConfigMode || "") !== contract.pipelineConfigMode
      || String(proof.pipelineConfigRevision || "") !== contract.pipelineConfigRevision
      || String(proof.pipelineConfigTemplateId || "") !== contract.pipelineConfigTemplateId
      || proof.nativeFileBytesVerified !== true
      || proof.composerPreviewVerified !== true) {
      throw contractError("PIPELINE_REFERENCE_RECEIPT_MISMATCH", "浏览器附件确认回执与当前请求/配置版本不匹配");
    }
    const actual = Array.isArray(proof.references) ? proof.references : [];
    if (actual.length !== contract.references.length) {
      throw contractError("PIPELINE_REFERENCE_RECEIPT_INCOMPLETE", "浏览器附件回执没有完整覆盖 P1/P2");
    }
    for (const expected of contract.references) {
      const observed = actual.find((item) => String(item?.role || "") === expected.role);
      if (!observed
        || String(observed.sha256 || "").toLowerCase() !== expected.sha256
        || Number(observed.bytes) !== expected.bytes
        || String(observed.fileName || "") !== basename(expected.path)) {
        throw contractError("PIPELINE_REFERENCE_RECEIPT_MISMATCH", `${expected.role} 浏览器实际附件与配置哈希不一致`);
      }
    }
    const visibleNames = new Set((Array.isArray(proof.composerAttachmentNames) ? proof.composerAttachmentNames : [])
      .map((value) => String(value || "")));
    if (contract.references.some((item) => !visibleNames.has(basename(item.path)))) {
      throw contractError("PIPELINE_REFERENCE_PREVIEW_MISSING", "GPT 输入框未显示完整 P1/P2 附件，未确认接收");
    }
    return true;
  }

  function createMatchedExecutionReceipt(contract, proof, recordedAt = new Date().toISOString()) {
    validateWorkerConsumptionProof(contract, proof);
    return {
      schemaVersion: 1,
      source: "content-production-app-desktop-bridge",
      requestId: contract.requestId,
      status: "MATCH",
      phase: "TEMPLATE_REFERENCES_ATTACHED_BEFORE_MODEL_START",
      templateSelectionMode: contract.templateSelectionMode,
      pipelineConfigMode: contract.pipelineConfigMode,
      pipelineConfigRevision: contract.pipelineConfigRevision,
      pipelineConfigTemplateId: contract.pipelineConfigTemplateId,
      workerWorkflowVariant: contract.workerWorkflowVariant,
      references: contract.references.map(({ role, sha256, bytes, path: filePath }) => ({
        role,
        fileName: basename(filePath),
        sha256,
        bytes
      })),
      evidence: {
        workerReportedConsumed: true,
        browserFileBytesVerified: true,
        composerPreviewsVerified: true
      },
      recordedAt: new Date(recordedAt).toISOString()
    };
  }

  function attachReceiptToRuntimeState(state = {}, requestId = "", receipt = {}) {
    const queue = state?.queue;
    const tasks = Array.isArray(queue?.tasks) ? queue.tasks : [];
    const id = String(requestId || "").trim();
    const matchingIndexes = tasks.map((task, index) =>
      String(task?.requestId || task?.externalRequestId || "") === id ? index : -1).filter((index) => index >= 0);
    if (matchingIndexes.length !== 1) {
      throw contractError(matchingIndexes.length ? "PIPELINE_RUNTIME_TASK_AMBIGUOUS" : "PIPELINE_RUNTIME_TASK_NOT_FOUND",
        matchingIndexes.length ? "运行队列中存在多个相同请求 ID，未写 MATCH 回执" : "运行队列中找不到相同请求 ID，未写 MATCH 回执");
    }
    const index = matchingIndexes[0];
    const task = tasks[index];
    if (String(task?.pipelineConfigRevision || "") !== receipt.pipelineConfigRevision
      || String(task?.pipelineConfigMode || "") !== receipt.pipelineConfigMode
      || String(task?.templateSelectionMode || "") !== receipt.templateSelectionMode
      || String(task?.pipelineConfigTemplateId || "") !== receipt.pipelineConfigTemplateId) {
      throw contractError("PIPELINE_RUNTIME_REVISION_MISMATCH", "运行队列里的模式/模板/版本与浏览器回执不一致，未写 MATCH 回执");
    }
    const nextTasks = tasks.slice();
    nextTasks[index] = {
      ...task,
      workflowVariant: receipt.workerWorkflowVariant,
      pipelineDispatchState: "MATCH",
      pipelineExecutionReceipt: receipt
    };
    return { ...state, queue: { ...queue, tasks: nextTasks } };
  }

  return Object.freeze({
    MODES: Object.freeze([...MODES]),
    SUPPORTED_MODE,
    WORKER_VARIANT,
    hasCanonicalPipelineFields,
    validatePipelineDispatch,
    validateWorkerConsumptionProof,
    createMatchedExecutionReceipt,
    attachReceiptToRuntimeState,
    basename
  });
});
