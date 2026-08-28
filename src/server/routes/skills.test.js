const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { catalogSkillStatus, inspectSkill, nativeSkillStatus, knowledgeSourceStatus, CONVERSION_KNOWLEDGE_MODULES, CONVERSION_KNOWLEDGE_SOURCE, projectSkillStatus, publicTask, PROJECT_SKILLS, NATIVE_SKILLS, SKILL_ID, DEVICE_TRANSFER_SKILL_ID, deviceFolderTransferSkillStatus, runDeviceFolderTransferSkill, normalizeTemplateRepositoryInput, hasTemplateRepositoryInput, validateTemplateRepositoryPaths, TEMPLATE_REPOSITORY_SKILL_ID, templateRepositoryEntry, materialIngestionSkillSettings, validateMaterialIngestionRoots, leadOpenTargets, normalizeTemplateCollectorRequest, collectorStatusLabel } = require("./skills");
const { parseMomentsProcessOutput } = require("../../server");

test("朋友圈采集回执支持 WeFlow CLI 的多行 JSON", () => {
  const payload = {
    friend: "江湖有旅人团建",
    limit: 10,
    imported: 0,
    deduplicated_or_ignored: 10,
    error_log_written: false
  };
  const prettyOutput = JSON.stringify(payload, null, 2);
  assert.deepEqual(parseMomentsProcessOutput(prettyOutput), payload);
  assert.deepEqual(parseMomentsProcessOutput(`诊断信息\n${prettyOutput}`), payload);
  assert.equal(parseMomentsProcessOutput(""), null);
});

test("模板仓库输入会提取公开链接并过滤不受信任的图片载荷", () => {
  const input = normalizeTemplateRepositoryInput({
    text: "安吉团建 https://xhslink.cn/o/abc，https://chatgpt.com/share/demo。",
    paths: ["D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目", "C:\\Windows"],
    files: [
      { name: "cover.png", dataUrl: "data:image/png;base64,ZmFrZQ==" },
      { name: "script.txt", dataUrl: "data:text/plain;base64,ZmFrZQ==" }
    ]
  });
  assert.deepEqual(input.urls, ["https://xhslink.cn/o/abc", "https://chatgpt.com/share/demo"]);
  assert.equal(input.files.length, 1);
  assert.equal(input.files[0].name, "cover.png");
  assert.equal(input.paths.length, 2);
});

test("模板仓库允许只有文字的收录说明作为有效输入", () => {
  const input = normalizeTemplateRepositoryInput({ text: "模板名称：杭州团建四宫格；待补充来源链接" });
  assert.equal(input.urls.length, 0);
  assert.equal(hasTemplateRepositoryInput(input), true);
});

test("模板仓库路径校验拒绝工作区之外的路径", () => {
  const result = validateTemplateRepositoryPaths(["C:\\Windows", "D:\\AICode\\项目推进\\模板仓库"]);
  assert.ok(result.rejected.some((item) => item.path === "C:\\Windows"));
  assert.ok(result.accepted.includes("D:\\AICode\\项目推进\\模板仓库"));
  assert.equal(TEMPLATE_REPOSITORY_SKILL_ID, "template-repository-maintainer");
});

test("模板仓库提供可打开的全局/当前项目 HTML 入口", () => {
  const entry = templateRepositoryEntry();
  assert.ok(["global", "project"].includes(entry.scope));
  assert.match(entry.path, /模板(?:仓库|台账)\.html$/);
  assert.match(entry.globalPath, /模板仓库\.html$/);
  assert.match(entry.projectPath, /模板台账\.html$/);
});

test("聚光卡片采集请求按 noteId 生成可去重的 explore 地址", () => {
  const request = normalizeTemplateCollectorRequest({
    noteId: "6A0018530000000036032176",
    title: "杭州团建 | 西湖团建",
    imageCount: 9,
    likes: "3",
    collections: "1",
    comments: "0",
    sourcePageUrl: "https://ad.xiaohongshu.com/microapp/creativity/inspire"
  });
  assert.equal(request.noteId, "6a0018530000000036032176");
  assert.equal(request.sourceUrl, "https://www.xiaohongshu.com/explore/6a0018530000000036032176");
  assert.equal(request.sourceUrlProvided, false);
  assert.equal(request.dedupeKey, "xhs:6a0018530000000036032176");
  assert.equal(collectorStatusLabel("needs_source_link"), "待补真实小红书链接");
});

test("聚光卡片采集拒绝非小红书来源链接", () => {
  assert.throws(
    () => normalizeTemplateCollectorRequest({ noteId: "6a0018530000000036032176", sourceUrl: "https://example.com/work" }),
    /来源链接必须是小红书/
  );
});

test("模板收录结果保留待分析记录和仓库 HTML 的交付路径", () => {
  const source = fs.readFileSync(require.resolve("./skills"), "utf8");
  assert.match(source, /repositoryPath: templateRepositoryEntry\(\)\.path/);
  assert.match(source, /intakePath: intake\.manifestPath/);
});

test("设备发现与作品分发已接入可执行技能层，并保留真实门禁", () => {
  const skill = NATIVE_SKILLS[DEVICE_TRANSFER_SKILL_ID];
  assert.equal(skill.category, "文件传输");
  assert.equal(PROJECT_SKILLS[DEVICE_TRANSFER_SKILL_ID], undefined);
  assert.equal(skill.documentationOnly, undefined);
  const status = deviceFolderTransferSkillStatus(skill);
  assert.equal(status.documentationOnly, false);
  assert.equal(status.canRun, status.sourceAvailable && status.transferScriptAvailable && status.registryAvailable);
  assert.match(skill.operation, /库存\/能力\/审批/);
  assert.match(skill.safety, /不重复发送/);
  assert.equal(JSON.stringify(skill).includes("Cookie"), false);
});

test("设备分发技能支持只读检查，不会在 dry-run 中调用发送门禁", async (t) => {
  const status = deviceFolderTransferSkillStatus(NATIVE_SKILLS[DEVICE_TRANSFER_SKILL_ID]);
  if (!status.canRun) {
    t.skip("当前环境没有设备分发技能运行目录");
    return;
  }
  let distributionCalled = false;
  const result = await runDeviceFolderTransferSkill({ input: { dryRun: true } }, {
    getDeviceStatus: async () => ({ onlineDevices: [] }),
    getPageSettings: () => ({ distribution: { autoDistributionEnabled: true, detectOnConnection: true } }),
    registeredDevices: () => [],
    maybeStartAutomaticDistribution: () => {
      distributionCalled = true;
      return [{ device: "不应触发", count: 1 }];
    }
  });
  assert.equal(result.deviceTransferAction, "check_and_auto_dispatch");
  assert.equal(result.automation.checkOnly, true);
  assert.deepEqual(result.automation.triggered, []);
  assert.equal(distributionCalled, false);
});

test("模板仓库技能状态不会和通用技能状态互相递归", () => {
  const status = nativeSkillStatus({ id: "template-repository-maintainer", sourcePath: "C:\\missing\\SKILL.md" });
  assert.equal(status.overallStatus, "blocked");
  assert.equal(status.sourceAvailable, false);
  assert.equal(status.canRun, false);
  assert.equal(typeof status.rootsAvailable, "boolean");
});

test("技能目录状态不会阻塞在实时连接检查，也不会伪报可提交", () => {
  const status = catalogSkillStatus();
  assert.equal(status.skillId, SKILL_ID);
  assert.equal(status.livePrecheck, "click_to_check");
  assert.equal(status.canPreview, false);
  assert.equal(status.canCommit, false);
  assert.equal(status.issues[0].code, "LIVE_PRECHECK_ON_RUN");
  assert.equal(JSON.stringify(status).includes("access_token"), false);
});

test("流量转化维护技能登记全链路来源，并区分工作台、复盘与维护模块", () => {
  const source = knowledgeSourceStatus({
    path: "D:\\AICode\\AI\\repos\\江湖团建企业转化知识库\\05-分析与复盘\\团建项目全链路知识库.html",
    maintainerPath: "D:\\AICode\\AI\\skills\\技能包\\技能\\团建知识库维护\\SKILL.md",
    modules: CONVERSION_KNOWLEDGE_MODULES
  });
  assert.equal(source.available, true);
  assert.equal(source.maintainerAvailable, true);
  assert.equal(source.modules.filter((item) => item.state === "integrate").length, 7);
  assert.equal(source.modules.filter((item) => item.state === "reference").length, 3);
  assert.equal(source.modules.filter((item) => item.state === "maintainer").length, 1);
  const status = nativeSkillStatus({
    id: "jianghu-sop-maintainer",
    sourcePath: "D:\\AICode\\AI\\skills\\技能包\\技能\\jianghu-sop-maintainer\\SKILL.md",
    knowledgeSource: source
  });
  assert.equal(status.knowledgeSource.available, true);
  assert.equal(status.knowledgeSource.maintainerAvailable, true);
  assert.equal(CONVERSION_KNOWLEDGE_SOURCE.title, "团建项目全链路知识库（来源材料）");
  assert.match(CONVERSION_KNOWLEDGE_SOURCE.selectionNote, /不是新的聊天真源/);
  assert.equal(CONVERSION_KNOWLEDGE_MODULES.find((item) => item.id === "success").target, "流量转化模块");
  assert.equal(CONVERSION_KNOWLEDGE_MODULES.find((item) => item.id === "god").target, "全链路知识库");
});

test("素材处理技能提供独立设置元数据和当前路径，但不暴露秘密", () => {
  const settings = materialIngestionSkillSettings();
  assert.equal(settings.skillId, "jianghu-toolbox-material-ingestion");
  assert.equal(settings.editable, true);
  assert.ok(settings.sourceRoot);
  assert.ok(settings.materialRoot);
  assert.deepEqual(settings.pathFields, ["sourceRoot", "materialRoot"]);
  assert.equal(JSON.stringify(settings).includes("token"), false);
});

test("素材处理路径必须是互不嵌套的真实目录并包含关键词作品", () => {
  assert.throws(
    () => validateMaterialIngestionRoots("C:\\missing-source", "C:\\missing-target"),
    /下载区不存在|素材库不存在/
  );
});

test("customer lead Skill status never exposes secret values", async () => {
  const status = await inspectSkill({
    paths: {
      skillFile: "C:\\missing\\SKILL.md",
      profile: "C:\\missing\\profile.yaml",
      secretReferences: "C:\\missing\\secret-references.yaml",
      runtimeState: "C:\\missing\\state.json",
      handoffManifest: "C:\\missing\\handoff.json",
      runtimeValidator: "C:\\missing\\validate.py",
      runner: "",
      weflowHealthUrl: "http://127.0.0.1:9/health"
    },
    healthProbe: async () => ({ ok: false, code: "TEST_UNAVAILABLE" }),
    runtimeValidator: async () => ({ ok: false, code: "RUNTIME_STATE_UNAVAILABLE" })
  });
  assert.equal(status.skillId, SKILL_ID);
  assert.equal(status.overallStatus, "blocked");
  assert.equal(status.canCommit, false);
  assert.equal(status.connectors.weflow.status, "needs_user");
  assert.equal(status.connectors.feishu.authValuesHidden, true);
  assert.equal(JSON.stringify(status).includes("access_token"), false);
});

test("public task snapshot omits private execution paths", () => {
  const snapshot = publicTask({
    id: "lead-skill-test",
    skillId: SKILL_ID,
    mode: "preview",
    state: "preview_ready",
    progress: 72,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:01.000Z",
    steps: [],
    paths: { profile: "D:\\private\\profile.yaml" },
    result: { newLeads: 1 }
  });
  assert.equal(snapshot.id, "lead-skill-test");
  assert.equal(snapshot.result.newLeads, 1);
  assert.equal("paths" in snapshot, false);
  assert.equal(JSON.stringify(snapshot).includes("profile.yaml"), false);
});

test("customer lead status binds the real runner without exposing credentials", async () => {
  const status = await inspectSkill({
    paths: {
      skillFile: "D:\\AICode\\AI\\skills\\技能包\\技能\\wechat-teambuilding-conversion\\SKILL.md",
      profile: "D:\\AICode\\AI\\private-config\\agents\\jianghu-teambuilding-lead\\profile.yaml",
      secretReferences: "D:\\AICode\\AI\\private-config\\agents\\jianghu-teambuilding-lead\\secret-references.yaml",
      runtimeState: "D:\\AICode\\运行数据\\江湖有旅人\\微信团建客资月度统计\\state.json",
      handoffManifest: "D:\\AICode\\AI\\private-config\\agents\\jianghu-teambuilding-lead\\handoff-manifest.json",
      runtimeValidator: "D:\\AICode\\AI\\skills\\技能包\\技能\\wechat-teambuilding-conversion\\scripts\\validate_runtime_state.py",
      runner: "D:\\AICode\\AI\\skills\\技能包\\技能\\wechat-teambuilding-conversion\\scripts\\run_lead_sync.py",
      weflowHealthUrl: "http://127.0.0.1:9/health"
    },
    healthProbe: async () => ({ ok: false, code: "TEST_UNAVAILABLE" }),
    runtimeValidator: async () => ({ ok: false, code: "RUNTIME_STATE_UNAVAILABLE" })
  });
  assert.equal(status.runner.bound, true);
  assert.equal(status.canCommit, false);
  assert.equal(JSON.stringify(status).includes("WEFLOW_ACCESS_TOKEN"), false);
});

test("customer lead Skill publishes only safe result and configuration entry points", () => {
  const targets = leadOpenTargets();
  assert.match(targets.targetUrl, /^https:\/\/my\.feishu\.cn\//);
  assert.match(targets.reportPath, /微信团建客资月度统计[\\/]reports$/);
  assert.match(targets.profilePath, /jianghu-teambuilding-lead[\\/]profile\.yaml$/);
  assert.equal(JSON.stringify(targets).includes("access_token"), false);
});

test("customer lead Skill uses the skill-center Feishu target override and defaults to auto-start dependencies", () => {
  const targets = leadOpenTargets({
    pageSettings: {
      skills: {
        leadTargetUrl: "https://my.feishu.cn/wiki/target?sheet=customSheet",
        leadTargetLabel: "客资统计表（自定义）"
      }
    }
  });
  assert.equal(targets.targetUrl, "https://my.feishu.cn/wiki/target?sheet=customSheet");
  assert.equal(targets.targetLabel, "客资统计表（自定义）");
  assert.equal(targets.settings.autoStartDependencies, true);
  assert.equal(JSON.stringify(targets).includes("httpApiToken"), false);
});
