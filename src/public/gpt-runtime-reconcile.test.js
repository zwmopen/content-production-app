const assert = require("node:assert/strict");
const test = require("node:test");
const {
  protectLocalExplicitHold,
  allAssignedAccountsHeld,
  pageEvidenceFingerprint,
  shouldBlockStagnantRecovery,
  normalizeUnsubmittedFreshTask
} = require("./gpt-runtime-reconcile");

test("未提交任务切到 fresh-session 时保留请求、素材锁和检查点并清空旧会话", () => {
  const result = normalizeUnsubmittedFreshTask({
    requestId: "request-keep",
    taskType: "material",
    materialPath: "D:/materials/current",
    conversationUrl: "https://chatgpt.com/c/old",
    navigation: "",
    _status: "paused",
    _stage: "上传附件",
    _percent: 5,
    _submittedToGpt: false,
    _materialLifecycleClaim: { lock: { owner: "account-4", requestId: "request-keep" } },
    workflow: { planSubmitted: false }
  }, {
    requestId: "request-rebuilt",
    templateId: "T01",
    selectedTemplateId: "T01",
    attachments: ["template.png", "material.jpg"],
    templateAttachments: ["template.png"],
    prompt: "fresh prompt"
  }, {
    accountId: "account-4",
    templateId: "T01"
  });

  assert.equal(result.changed, true);
  assert.equal(result.task.requestId, "request-keep");
  assert.equal(result.task.materialPath, "D:/materials/current");
  assert.equal(result.task._status, "paused");
  assert.equal(result.task._stage, "上传附件");
  assert.equal(result.task._percent, 5);
  assert.deepEqual(result.task._materialLifecycleClaim, {
    lock: { owner: "account-4", requestId: "request-keep" }
  });
  assert.deepEqual(result.task.workflow, { planSubmitted: false });
  assert.equal(result.task.workflowVariant, "fresh-session-fixed-template");
  assert.equal(result.task.sessionPolicy, "fresh-session");
  assert.equal(result.task.selectedTemplateId, "T01");
  assert.equal(result.task.navigation, "new-chat");
  assert.equal(result.task.conversationUrl, "");
  assert.equal(result.task.browserConversationUrl, "");
  assert.equal(result.task._freshConversationBootstrap, true);
  assert.equal(result.task._submittedToGpt, false);
});

test("已提交任务不被 fresh-session 启动归一化改写", () => {
  const task = {
    requestId: "submitted",
    taskType: "material",
    _submittedToGpt: true,
    conversationUrl: "https://chatgpt.com/c/submitted"
  };
  const result = normalizeUnsubmittedFreshTask(task, {
    workflowVariant: "fresh-session-fixed-template"
  }, { accountId: "account-4", templateId: "T01" });
  assert.equal(result.changed, false);
  assert.equal(result.task, task);
  assert.equal(result.task.conversationUrl, "https://chatgpt.com/c/submitted");
});

test("本地停止态优先于旧服务端 armed 和旧队列游标", () => {
  const local = {
    updatedAt: "2026-08-29T02:20:00.000Z",
    queue: { index: 1, activeAccountId: "account-4", tasks: [{ requestId: "current" }] },
    control: {
      armed: false,
      windowRuntime: {
        "account-4": { status: "idle", stoppedByUser: true }
      }
    }
  };
  const remote = {
    revision: 99,
    updatedAt: "2026-08-29T02:21:00.000Z",
    queue: { index: 0, activeAccountId: "account-4", tasks: [{ requestId: "old" }] },
    control: {
      armed: true,
      windowRuntime: {
        "account-4": { status: "running", stoppedByUser: false }
      }
    }
  };

  const result = protectLocalExplicitHold(local, remote, ["account-4"]);
  assert.equal(result.preserve, true);
  assert.deepEqual(result.heldAccountIds, ["account-4"]);
  assert.equal(result.state.queue.index, 1);
  assert.equal(result.state.queue.tasks[0].requestId, "current");
  assert.equal(result.state.control.armed, false);
  assert.equal(result.state.control.windowRuntime["account-4"].stoppedByUser, true);
});

test("远端其他账号的队列不会覆盖本地停止窗口", () => {
  const local = {
    queue: { index: 2, activeAccountId: "account-4", tasks: [{ requestId: "current" }] },
    control: { windowRuntime: { "account-4": { stoppedByUser: true } } }
  };
  const remote = {
    queue: { index: 0, activeAccountId: "account-3", tasks: [{ requestId: "other" }] },
    control: { armed: false }
  };
  const result = protectLocalExplicitHold(local, remote, ["account-4"]);
  assert.equal(result.preserve, false);
  assert.equal(result.state, local);
});

test("没有本地用户保持时仍允许新鲜服务端状态正常接管", () => {
  const local = { queue: { index: 0 }, control: { windowRuntime: { "account-4": { stoppedByUser: false } } } };
  const remote = { queue: { index: 1, activeAccountId: "account-4" }, control: { armed: true } };
  const result = protectLocalExplicitHold(local, remote, ["account-4"]);
  assert.equal(result.preserve, false);
});

test("隔离实例的所有窗口都被保持时不生成顶层 armed 镜像", () => {
  assert.equal(allAssignedAccountsHeld({ windowRuntime: { "account-4": { stoppedByUser: true } } }, ["account-4"]), true);
  assert.equal(allAssignedAccountsHeld({ windowRuntime: { "account-4": { pausedByUser: true } } }, ["account-4"]), true);
  assert.equal(allAssignedAccountsHeld({ windowRuntime: { "account-4": { stoppedByUser: false } } }, ["account-4"]), false);
});

test("同一 requestId 和同一页面指纹阻止恢复刷新", () => {
  const evidence = {
    requestId: "request-1",
    stage: "waiting-images",
    uploadedAttachments: 2,
    generatedImages: 1
  };
  const result = shouldBlockStagnantRecovery({
    requestId: "request-1",
    previousRequestId: "request-1",
    previousEvidence: evidence,
    currentEvidence: evidence,
    previousFingerprint: pageEvidenceFingerprint(evidence),
    currentFingerprint: pageEvidenceFingerprint(evidence)
  });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "same-request-page-fingerprint");
});

test("同一 requestId 只有易变状态标签变化仍阻止恢复", () => {
  const previousEvidence = {
    requestId: "request-2",
    stage: "waiting-images",
    uploadedAttachments: 2,
    generatedImages: 2
  };
  const currentEvidence = {
    ...previousEvidence,
    status: { label: "网页仍在加载", updatedAt: Date.now() },
    runtime: { currentStage: "第 2 次自动恢复探测" }
  };
  const result = shouldBlockStagnantRecovery({
    requestId: "request-2",
    previousRequestId: "request-2",
    previousEvidence,
    currentEvidence,
    previousFingerprint: pageEvidenceFingerprint(previousEvidence),
    currentFingerprint: pageEvidenceFingerprint(currentEvidence)
  });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "same-request-page-fingerprint");
});

test("阶段或图片证据前进时允许恢复继续", () => {
  const previousEvidence = {
    requestId: "request-3",
    stage: "waiting-images",
    uploadedAttachments: 2,
    generatedImages: 1
  };
  const currentEvidence = {
    requestId: "request-3",
    stage: "images-ready",
    uploadedAttachments: 2,
    generatedImages: 2
  };
  const result = shouldBlockStagnantRecovery({
    requestId: "request-3",
    previousRequestId: "request-3",
    previousEvidence,
    currentEvidence,
    previousFingerprint: pageEvidenceFingerprint(previousEvidence),
    currentFingerprint: pageEvidenceFingerprint(currentEvidence)
  });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "new-page-evidence");
  assert.equal(result.progressed, true);
});

test("requestId 变化时开启新的恢复边界", () => {
  const result = shouldBlockStagnantRecovery({
    requestId: "request-new",
    previousRequestId: "request-old",
    previousEvidence: { requestId: "request-old", stage: "waiting-images" },
    currentEvidence: { requestId: "request-new", stage: "waiting-images" }
  });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "new-request-boundary");
});
