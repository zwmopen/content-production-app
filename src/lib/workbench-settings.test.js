const test = require("node:test");
const assert = require("node:assert/strict");
const {
  automaticDistributionAdmission,
  automaticDistributionCandidateEligible,
  automaticDistributionDecisionFingerprint,
  automaticDistributionSendCount,
  automaticDistributionSkipMessage,
  automaticDistributionBlockedMessage,
  classifyAutomaticDistributionError,
  selectDeviceInventory,
  countReserve,
  decorateTrustedDevices,
  deviceApprovalKey,
  deviceTransportTarget,
  findRegisteredDevice,
  findTrustedDevice,
  normalizePageSettings
} = require("./workbench-settings");

test("automatic replenishment sends one standard collection when inventory is below the reserve", () => {
  assert.equal(automaticDistributionSendCount({ inventory: 0, threshold: 5, configuredCount: 2, candidateCount: 6 }), 1);
  assert.equal(automaticDistributionSendCount({ inventory: 4, threshold: 5, configuredCount: 2, candidateCount: 6 }), 1);
  assert.equal(automaticDistributionSendCount({ inventory: 5, threshold: 5, configuredCount: 2, candidateCount: 6 }), 0);
  assert.equal(automaticDistributionSendCount({ inventory: 4, threshold: 5, configuredCount: 2, candidateCount: 0 }), 0);
});

test("automatic distribution explains that category inventory needs a phone upgrade", () => {
  assert.equal(
    automaticDistributionSkipMessage("inventory_unknown", { category: "conversion" }),
    "手机在线，但未上报精准流量类库存；请升级手机接收端后重新连接"
  );
  assert.equal(
    automaticDistributionSkipMessage("inventory_unknown", {
      category: "conversion",
      deviceLabel: "VIVO·公司",
      deviceModel: "V2327A"
    }),
    "VIVO·公司（V2327A）：手机在线，但未上报精准流量类库存；请升级手机接收端后重新连接"
  );
  assert.equal(
    automaticDistributionSkipMessage("inventory_unknown", { category: "all" }),
    "手机在线，但未上报手机总作品数；请升级手机接收端后重新连接"
  );
  assert.equal(
    automaticDistributionSkipMessage("inventory_sufficient", { inventory: 8, threshold: 7, category: "conversion" }),
    "精准流量类库存 8 已达到阈值 7，本轮无需补充"
  );
  assert.equal(
    automaticDistributionSkipMessage("inventory_sufficient", { inventory: 8, threshold: 7, category: "all" }),
    "手机总作品数 8 已达到阈值 7，本轮无需补充"
  );
  assert.equal(
    automaticDistributionSkipMessage("candidate_in_flight", { category: "conversion" }),
    "精准流量类作品集正在另一条发送链路中；本轮为避免重复发送暂不执行"
  );
  assert.equal(
    automaticDistributionSkipMessage("receiver_update_required", {
      deviceLabel: "红米13（微信） 1号",
      reason: "旧版接收端提交失败"
    }),
    "红米13（微信） 1号：手机接收端需要更新，已暂停自动重试：旧版接收端提交失败"
  );
});

test("automatic distribution pauses deterministic receiver-format failures", () => {
  assert.deepEqual(classifyAutomaticDistributionError(new Error(
    "设备返回错误 500：/work-library/trash/lark/meta.properties: open failed: ENOENT"
  )), {
    retryable: false,
    code: "RECEIVER_UPDATE_REQUIRED",
    message: "设备返回错误 500：/work-library/trash/lark/meta.properties: open failed: ENOENT"
  });
  assert.equal(classifyAutomaticDistributionError(new Error(
    "设备返回错误 409：正在接收另一批素材，请稍后重试"
  )).code, "RECEIVER_BUSY");
  assert.equal(classifyAutomaticDistributionError(new Error(
    "RuntimeError: 设备匹配数量为 0；当前可用设备：无"
  )).code, "RECEIVER_UNAVAILABLE");
  assert.equal(classifyAutomaticDistributionError(new Error("设备当前忙，请稍后再试")).retryable, true);
  assert.equal(
    automaticDistributionBlockedMessage("RECEIVER_BUSY", "设备返回错误 409"),
    "检测到手机接收端仍在处理上一批传输，已暂停自动重试；重新连接后再继续：设备返回错误 409"
  );
});

test("inventory selection can read total or an explicitly requested category", () => {
  const live = {
    workCount: 15,
    workCounts: { total: 15, conversion: 8, traffic: 7, uncategorized: 0 }
  };

  assert.deepEqual(selectDeviceInventory(live, "conversion"), {
    value: 8,
    category: "conversion",
    source: "live_device_category"
  });
  assert.deepEqual(selectDeviceInventory(live, "all"), {
    value: 15,
    category: "all",
    source: "live_device_total"
  });
  assert.equal(selectDeviceInventory({ workCount: 15 }, "conversion").value, null);
  assert.equal(selectDeviceInventory({ workCount: null, workCounts: { total: null } }, "all").value, null);
  assert.equal(selectDeviceInventory({ workCount: null, workCounts: { conversion: null } }, "conversion").value, null);
});

test("automatic distribution keeps precise replenishment candidates precise", () => {
  const precise = {
    name: "作品集_070[转]",
    type: "conversion",
    workflowStage: "mobile",
    sourceValid: true,
    dualPlatformEligible: true
  };
  const broad = { ...precise, name: "作品集_015[泛]", type: "traffic" };

  assert.equal(automaticDistributionCandidateEligible(precise, "conversion"), true);
  assert.equal(automaticDistributionCandidateEligible(broad, "conversion"), false);
  assert.equal(automaticDistributionCandidateEligible(precise, "traffic"), false);
  assert.equal(automaticDistributionCandidateEligible(broad, "traffic"), true);
  assert.equal(automaticDistributionCandidateEligible(precise, "all"), true);
  assert.equal(
    automaticDistributionCandidateEligible({ ...precise, type: "unclassified" }, "all"),
    false
  );
});

test("automatic distribution re-evaluates the selected phone inventory category or threshold", () => {
  const candidates = [{ name: "作品集_060[转]", type: "conversion" }];
  const full = automaticDistributionDecisionFingerprint(
    { workCount: 15, workCounts: { total: 15, conversion: 15, traffic: 0, uncategorized: 0 } },
    { phoneReserveThreshold: 10, autoCategory: "conversion", autoSendCount: 1 },
    candidates
  );
  const depleted = automaticDistributionDecisionFingerprint(
    { workCount: 15, workCounts: { total: 15, conversion: 8, traffic: 7, uncategorized: 0 } },
    { phoneReserveThreshold: 10, autoCategory: "conversion", autoSendCount: 1 },
    candidates
  );
  const loweredThreshold = automaticDistributionDecisionFingerprint(
    { workCount: 15, workCounts: { total: 15, conversion: 8, traffic: 7, uncategorized: 0 } },
    { phoneReserveThreshold: 7, autoCategory: "conversion", autoSendCount: 1 },
    candidates
  );

  assert.notEqual(full, depleted);
  assert.notEqual(depleted, loweredThreshold);
  assert.notEqual(
    depleted,
    automaticDistributionDecisionFingerprint(
      { state: "receiving", workCount: 15, workCounts: { total: 15, conversion: 8, traffic: 7, uncategorized: 0 } },
      { phoneReserveThreshold: 10, autoCategory: "conversion", autoSendCount: 1 },
      candidates
    )
  );
  assert.notEqual(
    automaticDistributionDecisionFingerprint(
      { state: "receiving", taskId: "task-old", workCounts: { conversion: 0 } },
      { phoneReserveThreshold: 5, autoCategory: "conversion", autoSendCount: 1 },
      candidates
    ),
    automaticDistributionDecisionFingerprint(
      { state: "online", taskId: "", workCounts: { conversion: 0 } },
      { phoneReserveThreshold: 5, autoCategory: "conversion", autoSendCount: 1 },
      candidates
    )
  );
  assert.equal(
    depleted,
    automaticDistributionDecisionFingerprint(
      { workCount: 15, workCounts: { total: 15, conversion: 8, traffic: 7, uncategorized: 0 } },
      { phoneReserveThreshold: 10, autoCategory: "conversion", autoSendCount: 1 },
      candidates
    )
  );
  const preciseTwoOfSeven = automaticDistributionDecisionFingerprint(
    { workCount: 16, workCounts: { total: 16, conversion: 2, traffic: 14, uncategorized: 0 } },
    { phoneReserveThreshold: 7, autoCategory: "conversion", autoSendCount: 1 },
    candidates
  );
  const preciseEightOfSeven = automaticDistributionDecisionFingerprint(
    { workCount: 16, workCounts: { total: 16, conversion: 8, traffic: 8, uncategorized: 0 } },
    { phoneReserveThreshold: 7, autoCategory: "conversion", autoSendCount: 1 },
    candidates
  );
  assert.notEqual(preciseTwoOfSeven, preciseEightOfSeven);
  assert.match(preciseTwoOfSeven, /"inventory":2/);
  assert.match(preciseTwoOfSeven, /"category":"conversion"/);
});

test("automatic distribution sends the live transport name instead of the registry number", () => {
  assert.equal(deviceTransportTarget({ name: "vivo（作品数 2）", model: "vivo V2327A" }, "4号"), "vivo");
  assert.equal(deviceTransportTarget({ name: "Xiaomi K60（作品数 8）" }, "7号"), "Xiaomi K60");
  assert.equal(deviceTransportTarget({ name: "红米13（微信） 1号（作品数 15）" }), "红米13（微信） 1号");
});

test("GPT production settings preserve random no-prompt mode", () => {
  const settings = normalizePageSettings({ gptAuto: { mode: "random" } });
  assert.equal(settings.gptAuto.mode, "random");
});

test("GPT all-day settings preserve automatic restart and cross-midnight work hours", () => {
  const settings = normalizePageSettings({
    gptAuto: {
      mode: "all-day",
      launchAtLogin: true,
      continuousAutoStart: true,
      continuousWorkHoursEnabled: true,
      continuousWorkStart: "07:00",
      continuousWorkEnd: "02:00"
    }
  });
  assert.equal(settings.gptAuto.mode, "all-day");
  assert.equal(settings.gptAuto.launchAtLogin, true);
  assert.equal(settings.gptAuto.continuousAutoStart, true);
  assert.equal(settings.gptAuto.continuousWorkHoursEnabled, true);
  assert.equal(settings.gptAuto.continuousWorkStart, "07:00");
  assert.equal(settings.gptAuto.continuousWorkEnd, "02:00");
});

test("page settings keep safe defaults and clamp DIY values", () => {
  const settings = normalizePageSettings({
    production: { reserveThreshold: 0, itemsPerCollection: 200, compressCollections: true },
    distribution: {
      desktopReserveThreshold: 12,
      autoCategory: "conversion",
      autoSendCount: 50,
      autoRetryLimit: 99,
      autoDistributionEnabled: true
    }
  });
  assert.equal(settings.production.reserveThreshold, 1);
  assert.equal(settings.production.itemsPerCollection, 30);
  assert.equal(settings.production.compressCollections, true);
  assert.equal(settings.distribution.desktopReserveThreshold, 12);
  assert.equal(settings.distribution.autoSendCount, 1);
  assert.equal(settings.distribution.autoRetryLimit, 5);
  assert.equal(settings.distribution.autoDistributionEnabled, true);
  assert.equal(settings.distribution.requireSendConfirmation, false);
  assert.equal(settings.backup.scheduleEnabled, true);
  assert.equal(settings.backup.frequency, "daily");
  assert.equal(settings.backup.intervalHours, 24);
  assert.equal(settings.backup.monthlyLargeFileLimitMb, 2560);
  assert.equal(settings.gptAuto.mode, "all-day");
  assert.equal(settings.gptAuto.accounts[0].uploadLimit, 80);
});

test("技能个性化设置默认启用素材处理且可明确关闭", () => {
  assert.equal(normalizePageSettings().skills.materialIngestionEnabled, true);
  assert.equal(normalizePageSettings({ skills: { materialIngestionEnabled: false } }).skills.materialIngestionEnabled, false);
  assert.equal(normalizePageSettings({ skills: { materialIngestionEnabled: "false" } }).skills.materialIngestionEnabled, true);
});

test("朋友圈发布器开关默认开启且可被明确关闭", () => {
  assert.equal(normalizePageSettings().moments.enabled, true);
  assert.equal(normalizePageSettings({ moments: { enabled: false } }).moments.enabled, false);
  assert.equal(normalizePageSettings({ moments: { enabled: "false" } }).moments.enabled, true);
});

test("朋友圈触发设置默认手动，定时和选材规则会被持久化并规范化", () => {
  const defaults = normalizePageSettings().moments;
  assert.equal(defaults.triggerMode, "manual");
  assert.equal(defaults.scheduleWindowStart, "10:00");
  assert.equal(defaults.scheduleWindowEnd, "12:00");
  assert.deepEqual(defaults.scheduleTimes, ["10:20"]);
  assert.equal(defaults.dailyAutoLimit, 1);
  assert.equal(defaults.selectionRule, "anniversary");

  const settings = normalizePageSettings({
    moments: {
      triggerMode: "scheduled",
      scheduleTimes: ["18:30", "09:00", "18:30", "25:00", "9:00", "00:05"],
      dailyAutoLimit: 2,
      selectionRule: "random"
    }
  });
  assert.equal(settings.moments.triggerMode, "scheduled");
  assert.equal(settings.moments.scheduleWindowStart, "10:00");
  assert.equal(settings.moments.scheduleWindowEnd, "12:00");
  assert.deepEqual(settings.moments.scheduleTimes, ["00:05", "09:00", "18:30"]);
  assert.equal(settings.moments.dailyAutoLimit, 2);
  assert.equal(settings.moments.selectionRule, "random");
});

test("朋友圈无效触发设置回到安全默认，不会产生空定时队列", () => {
  const settings = normalizePageSettings({
    moments: { triggerMode: "always", scheduleTimes: ["", "99:99"], selectionRule: "anything" }
  });
  assert.equal(settings.moments.triggerMode, "manual");
  assert.equal(settings.moments.scheduleWindowStart, "10:00");
  assert.equal(settings.moments.scheduleWindowEnd, "12:00");
  assert.deepEqual(settings.moments.scheduleTimes, ["10:20"]);
  assert.equal(settings.moments.selectionRule, "anniversary");
  assert.equal(settings.moments.dailyAutoLimit, 1);
});

test("技能专属下载和朋友圈采集设置使用安全默认并保留用户选择", () => {
  const defaults = normalizePageSettings();
  assert.equal(defaults.skills.materialDownloadOutputDir, "");
  assert.equal(defaults.moments.collectionAccount, "");
  assert.equal(defaults.moments.collectionLimit, "10");
  assert.equal(defaults.moments.requireWechatReady, true);
  assert.equal(defaults.moments.collectionScheduleEnabled, false);
  assert.equal(defaults.moments.collectionScheduleDay, 1);
  assert.equal(defaults.moments.collectionScheduleTime, "10:20");
  assert.equal(defaults.moments.collectionScheduleCatchUpDays, 7);

  const settings = normalizePageSettings({
    skills: { materialDownloadOutputDir: "D:\\Download\\素材下载" },
    moments: {
      collectionAccount: "小明",
      collectionWxid: "wxid_xiaoming",
      collectionLimit: "all",
      requireWechatReady: false,
      collectionScheduleEnabled: true,
      collectionScheduleDay: 31,
      collectionScheduleTime: "18:30",
      collectionScheduleCatchUpDays: 20
    }
  });
  assert.equal(settings.skills.materialDownloadOutputDir, "D:\\Download\\素材下载");
  assert.equal(settings.moments.collectionAccount, "小明");
  assert.equal(settings.moments.collectionWxid, "wxid_xiaoming");
  assert.equal(settings.moments.collectionLimit, "all");
  assert.equal(settings.moments.requireWechatReady, false);
  assert.equal(settings.moments.collectionScheduleEnabled, true);
  assert.equal(settings.moments.collectionScheduleDay, 28);
  assert.equal(settings.moments.collectionScheduleTime, "18:30");
  assert.equal(settings.moments.collectionScheduleCatchUpDays, 7);
});

test("GPT automatic production settings keep per-account quotas", () => {
  const settings = normalizePageSettings({
    gptAuto: {
      mode: "manual",
      minDelaySeconds: 1,
      accounts: [{ id: "account-2", name: "运营号", uploadLimit: 90, generationLimit: 60, windowHours: 4 }]
    }
  });
  assert.equal(settings.gptAuto.mode, "manual");
  assert.equal(settings.gptAuto.minDelaySeconds, 5);
  assert.deepEqual(settings.gptAuto.accounts[0], {
    id: "account-2",
    name: "运营号",
    uploadLimit: 90,
    generationLimit: 60,
    windowHours: 4
  });
});

test("GPT settings preserve the multi-account all-day production mode", () => {
  const settings = normalizePageSettings({ gptAuto: { mode: "all-day-multi" } });
  assert.equal(settings.gptAuto.mode, "all-day-multi");
});

test("backup settings keep a practical schedule and clamp the monthly upload budget", () => {
  const settings = normalizePageSettings({
    backup: {
      scheduleEnabled: false,
      frequency: "weekly",
      intervalHours: 999,
      monthlyLargeFileLimitMb: 999999,
      sourceRoot: "D:\\团建方案库"
    }
  });
  assert.equal(settings.backup.scheduleEnabled, false);
  assert.equal(settings.backup.frequency, "weekly");
  assert.equal(settings.backup.intervalHours, 168);
  assert.equal(settings.backup.monthlyLargeFileLimitMb, 10240);
  assert.equal(settings.backup.sourceRoot, "D:\\团建方案库");
});

test("production page settings preserve the optional packed-library path", () => {
  const settings = normalizePageSettings({
    production: {
      packedRoot: "D:\\作品库\\抖音小红书",
      folderBindings: { "material-traffic": "D:\\素材库\\泛流量贴" }
    }
  });
  assert.equal(settings.production.packedRoot, "D:\\作品库\\抖音小红书");
  assert.equal(settings.production.folderBindings["material-traffic"], "D:\\素材库\\泛流量贴");
});

test("reserve count uses real mobile-stage sendable folders and category", () => {
  const collections = [
    { workflowStage: "mobile", type: "conversion", sourceValid: true, dualPlatformEligible: true },
    { workflowStage: "mobile", type: "traffic", sourceValid: true, dualPlatformEligible: true },
    { workflowStage: "official", type: "conversion", sourceValid: true, dualPlatformEligible: true },
    { workflowStage: "mobile", type: "conversion", sourceValid: false, dualPlatformEligible: true }
  ];
  assert.equal(countReserve(collections, "conversion"), 1);
  assert.equal(countReserve(collections, "all"), 2);
});

test("all registered devices are sendable while only first-time devices need automatic approval", () => {
  const devices = decorateTrustedDevices([
    { id: "iphone-12", displayName: "2号 苹果12", aliases: ["2号"], platformStatus: "confirmed" },
    { id: "guest", displayName: "临时手机", aliases: ["临时手机"], models: ["Model X"] }
  ]);
  assert.equal(devices[0].trusted, true);
  assert.equal(devices[0].firstConfirmationRequired, false);
  assert.equal(devices[1].trusted, true);
  assert.equal(devices[1].firstConfirmationRequired, true);
  assert.equal(devices[1].trustLabel, "首次自动分发需确认");
  assert.equal(findTrustedDevice(devices, "2号").id, "iphone-12");
  assert.equal(findRegisteredDevice(devices, "临时手机").id, "guest");
  assert.equal(findTrustedDevice(devices, "临时手机"), null);

  const approvalKey = deviceApprovalKey(devices[1]);
  const approved = decorateTrustedDevices([devices[1]], [approvalKey])[0];
  assert.equal(approved.firstConfirmationRequired, false);
  assert.equal(findTrustedDevice([approved], "临时手机").id, "guest");
});

test("automatic distribution defaults to precise traffic with a five-work reserve", () => {
  const settings = normalizePageSettings();
  assert.equal(settings.distribution.phoneReserveThreshold, 5);
  assert.equal(settings.distribution.autoCategory, "conversion");
  assert.equal(settings.distribution.legacyAdditionalRootsEnabled, false);
  assert.deepEqual(settings.distribution.defaultSendRoots, { traffic: "", conversion: "" });
  assert.equal(settings.distribution.defaultSendRoot, "");
  assert.equal(settings.distribution.autoDistributionEnabled, true);
  assert.equal(settings.distribution.detectOnConnection, true);
});

test("explicit automatic distribution categories remain backward compatible", () => {
  assert.equal(normalizePageSettings({ distribution: { autoCategory: "conversion" } }).distribution.autoCategory, "conversion");
  assert.equal(normalizePageSettings({ distribution: { autoCategory: "traffic" } }).distribution.autoCategory, "traffic");
});

test("explicit all-category selection remains available for mixed-content installations", () => {
  const settings = normalizePageSettings({ distribution: { autoCategory: "all" } });
  assert.equal(settings.distribution.autoCategory, "all");
});

test("per-category send roots are independent and legacy shared roots migrate safely", () => {
  const settings = normalizePageSettings({
    distribution: {
      defaultSendRoots: { traffic: " D:\\泛 ", conversion: " D:\\精准 " }
    }
  });
  assert.deepEqual(settings.distribution.defaultSendRoots, {
    traffic: "D:\\泛",
    conversion: "D:\\精准"
  });

  const legacy = normalizePageSettings({ distribution: { defaultSendRoot: "D:\\旧发送目录" } });
  assert.deepEqual(legacy.distribution.defaultSendRoots, {
    traffic: "D:\\旧发送目录",
    conversion: "D:\\旧发送目录"
  });
  assert.equal(legacy.distribution.legacyAdditionalRootsEnabled, true);
});

test("automatic distribution pauses a new device only until its first approval", () => {
  const device = { name: "小米主机", model: "Xiaomi 24129PN74C" };
  const key = deviceApprovalKey(device);
  assert.deepEqual(automaticDistributionAdmission(device, []), {
    approved: false,
    approvalKey: key,
    skipReason: "first_confirmation_required"
  });
  assert.deepEqual(automaticDistributionAdmission(device, [key]), {
    approved: true,
    approvalKey: key,
    skipReason: null
  });
  assert.equal(
    automaticDistributionSkipMessage("first_confirmation_required"),
    "新设备首次自动分发需要确认一次；确认后以后连接会自动检测并补货"
  );
});

test("skill-center lead settings preserve a Feishu target and auto-start preference", () => {
  const settings = normalizePageSettings({
    skills: {
      leadTargetUrl: " https://my.feishu.cn/wiki/target?sheet=customSheet ",
      leadTargetLabel: " 客资统计表（自定义） ",
      leadAutoStartDependencies: false
    }
  });
  assert.equal(settings.skills.leadTargetUrl, "https://my.feishu.cn/wiki/target?sheet=customSheet");
  assert.equal(settings.skills.leadTargetLabel, "客资统计表（自定义）");
  assert.equal(settings.skills.leadAutoStartDependencies, false);
});
