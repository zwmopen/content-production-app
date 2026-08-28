const DISTRIBUTION_CATEGORIES = new Set(["all", "traffic", "conversion", "unclassified"]);
const MOMENTS_TRIGGER_MODES = new Set(["manual", "scheduled"]);
const MOMENTS_SELECTION_RULES = new Set(["anniversary", "historical-day", "current-year", "last-year-day", "last-year-month", "random"]);

const DEFAULT_PAGE_SETTINGS = Object.freeze({
  skills: {
    skillCenterEnabled: true,
    // Local skills are opt-in at the action boundary. The material organizer
    // still requires an explicit preview before it can move or remove files.
    materialIngestionEnabled: true,
    materialDownloadOutputDir: "",
    leadTargetUrl: "",
    leadTargetLabel: "客资统计表（当前月度 Sheet）",
    leadAutoStartDependencies: true
  },
  moments: {
    // 朋友圈发布器默认可用；关闭时只停用工作台入口和对应 API，不触碰作品库原文件。
    enabled: true,
    libraryRoot: "D:\\朋友圈weflow",
    autoOpenWeChat: true,
    collectionAccount: "",
    collectionWxid: "",
    collectionLimit: "10",
    requireWechatReady: true,
    collectionScheduleEnabled: false,
    collectionScheduleDay: 1,
    collectionScheduleTime: "10:20",
    collectionScheduleCatchUpDays: 7,
    // Safe by default: scheduling is opt-in and never clicks the final
    // WeChat publish button.  The default selection is the user's requested
    // The default is the explicit previous-year date; broader historical rules
    // must be chosen deliberately in the skill center.
    triggerMode: "manual",
    // A window is more reliable than one exact minute when the workbench is
    // opened shortly after the user's normal start time.  The scheduler runs
    // at the first available poll inside this window.
    scheduleWindowStart: "10:00",
    scheduleWindowEnd: "12:00",
    scheduleTimes: ["10:20"],
    dailyAutoLimit: 1,
    // Prefer the exact anniversary, then fall back within last year's month
    // so a missing historical day does not make the automatic slot empty.
    selectionRule: "anniversary"
  },
  production: {
    templateRoot: "",
    packedRoot: "",
    folderBindings: {},
    promptRules: "",
    scheduleEnabled: false,
    scheduleTime: "09:00",
    autoProduceEnabled: false,
    reserveThreshold: 10,
    reserveCategory: "conversion",
    itemsPerCollection: 9,
    compressCollections: false
  },
  distribution: {
    desktopReserveAlertEnabled: true,
    desktopReserveThreshold: 10,
    desktopReserveCategory: "conversion",
    requireSendConfirmation: false,
    completionNotificationEnabled: true,
    autoDistributionEnabled: true,
    detectOnConnection: true,
    phoneReserveThreshold: 5,
    // The selected automatic category is used for both sides of the reserve
    // decision: the phone inventory count and the computer-side candidates.
    // `all` is the explicit opt-in for total inventory (including broad/game
    // content); existing explicit settings remain preserved by normalization.
    autoCategory: "conversion",
     // The work-package library is the single normal source of truth. Legacy
     // extra roots remain readable, but require an explicit opt-in to avoid
     // silently mixing unrelated folders into automatic distribution.
     legacyAdditionalRootsEnabled: false,
    // Each content class can point at its own send directory. A blank value
    // falls back to the normal tagged work library.
    defaultSendRoots: {
      traffic: "",
      conversion: ""
    },
    // Kept for backward compatibility with the 0.18.28 shared-directory key.
    defaultSendRoot: "",
    autoSendCount: 1,
    autoRetryLimit: 3
  },
  backup: {
    scheduleEnabled: true,
    frequency: "daily",
    intervalHours: 24,
    monthlyLargeFileLimitMb: 2560,
    sourceRoot: ""
  },
  gptAuto: {
    mode: "all-day",
    autoConfirm: true,
    autoCopy: true,
    autoPackage: true,
    pauseOnFailure: true,
    autoArchive: true,
    quotaReminderEnabled: true,
    minDelaySeconds: 25,
    maxDelaySeconds: 55,
    taskTimeoutMinutes: 30,
    accountTaskLimit: 8,
    launchAtLogin: true,
    continuousAutoStart: true,
    continuousWorkHoursEnabled: true,
    continuousWorkStart: "07:00",
    continuousWorkEnd: "02:00",
    accounts: [{ id: "account-1", name: "账号 1", uploadLimit: 80, generationLimit: 45, windowHours: 3 }]
  }
});

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function normalizeCategory(value, fallback = "conversion") {
  const category = String(value || "").trim();
  return DISTRIBUTION_CATEGORIES.has(category) ? category : fallback;
}

function normalizePath(value) {
  return String(value || "").trim().slice(0, 1000);
}

function normalizeMomentsScheduleTimes(value) {
  const raw = Array.isArray(value) ? value : [];
  const times = Array.from(new Set(raw
    .map((item) => String(item || "").trim())
    .filter((item) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item))))
    .sort();
  return (times.length ? times : DEFAULT_PAGE_SETTINGS.moments.scheduleTimes).slice(0, 8);
}

function normalizeMomentsScheduleTime(value, fallback) {
  const time = String(value || "").trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : fallback;
}

function normalizePageSettings(value = {}) {
  const skills = value.skills || {};
  const moments = value.moments || {};
  const production = value.production || {};
  const distribution = value.distribution || {};
  const legacyRootsPresent = Boolean(
    distribution.defaultSendRoot
      || distribution.trafficSendRoot
      || distribution.conversionSendRoot
      || distribution.defaultSendRoots?.traffic
      || distribution.defaultSendRoots?.conversion
  );
  const backup = value.backup || {};
  const gptAuto = value.gptAuto || {};
  const backupFrequency = ["daily", "weekly", "interval"].includes(backup.frequency)
    ? backup.frequency : DEFAULT_PAGE_SETTINGS.backup.frequency;
  const defaultInterval = backupFrequency === "weekly" ? 168 : 24;
  let scheduleWindowStart = normalizeMomentsScheduleTime(
    moments.scheduleWindowStart,
    DEFAULT_PAGE_SETTINGS.moments.scheduleWindowStart
  );
  let scheduleWindowEnd = normalizeMomentsScheduleTime(
    moments.scheduleWindowEnd,
    DEFAULT_PAGE_SETTINGS.moments.scheduleWindowEnd
  );
  if (scheduleWindowStart > scheduleWindowEnd) {
    scheduleWindowStart = DEFAULT_PAGE_SETTINGS.moments.scheduleWindowStart;
    scheduleWindowEnd = DEFAULT_PAGE_SETTINGS.moments.scheduleWindowEnd;
  }
  return {
    skills: {
      skillCenterEnabled: skills.skillCenterEnabled !== false,
      materialIngestionEnabled: skills.materialIngestionEnabled !== false,
      materialDownloadOutputDir: normalizePath(skills.materialDownloadOutputDir),
      leadTargetUrl: normalizePath(skills.leadTargetUrl),
      leadTargetLabel: String(skills.leadTargetLabel || DEFAULT_PAGE_SETTINGS.skills.leadTargetLabel).trim().slice(0, 120),
      leadAutoStartDependencies: skills.leadAutoStartDependencies !== false
    },
    moments: {
      enabled: moments.enabled !== false,
      libraryRoot: String(moments.libraryRoot || DEFAULT_PAGE_SETTINGS.moments.libraryRoot).trim().slice(0, 1000),
      autoOpenWeChat: moments.autoOpenWeChat !== false,
      collectionAccount: String(moments.collectionAccount || "").trim().slice(0, 160),
      collectionWxid: String(moments.collectionWxid || "").trim().slice(0, 160),
      collectionLimit: String(moments.collectionLimit || "10") === "all" ? "all" : "10",
      requireWechatReady: moments.requireWechatReady !== false,
      collectionScheduleEnabled: moments.collectionScheduleEnabled === true,
      collectionScheduleDay: clampInteger(moments.collectionScheduleDay, DEFAULT_PAGE_SETTINGS.moments.collectionScheduleDay, 1, 28),
      collectionScheduleTime: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(moments.collectionScheduleTime || ""))
        ? String(moments.collectionScheduleTime)
        : DEFAULT_PAGE_SETTINGS.moments.collectionScheduleTime,
      collectionScheduleCatchUpDays: clampInteger(moments.collectionScheduleCatchUpDays, DEFAULT_PAGE_SETTINGS.moments.collectionScheduleCatchUpDays, 1, 7),
      triggerMode: MOMENTS_TRIGGER_MODES.has(String(moments.triggerMode || ""))
        ? String(moments.triggerMode)
        : DEFAULT_PAGE_SETTINGS.moments.triggerMode,
      scheduleWindowStart,
      scheduleWindowEnd,
      scheduleTimes: normalizeMomentsScheduleTimes(moments.scheduleTimes),
      dailyAutoLimit: clampInteger(moments.dailyAutoLimit, DEFAULT_PAGE_SETTINGS.moments.dailyAutoLimit, 1, 20),
      selectionRule: MOMENTS_SELECTION_RULES.has(String(moments.selectionRule || ""))
        ? String(moments.selectionRule)
        : DEFAULT_PAGE_SETTINGS.moments.selectionRule
    },
    production: {
      templateRoot: String(production.templateRoot || "").trim().slice(0, 1000),
      packedRoot: String(production.packedRoot || "").trim().slice(0, 1000),
      folderBindings: Object.fromEntries(Object.entries(production.folderBindings || {})
        .filter(([key, value]) => /^[a-z-]{3,40}$/.test(key) && typeof value === "string")
        .slice(0, 20)
        .map(([key, value]) => [key, value.trim().slice(0, 1000)])),
      promptRules: String(production.promptRules || "").trim().slice(0, 24000),
      scheduleEnabled: production.scheduleEnabled === true,
      scheduleTime: /^\d{2}:\d{2}$/.test(String(production.scheduleTime || ""))
        ? String(production.scheduleTime) : DEFAULT_PAGE_SETTINGS.production.scheduleTime,
      autoProduceEnabled: production.autoProduceEnabled === true,
      reserveThreshold: clampInteger(production.reserveThreshold, 10, 1, 500),
      reserveCategory: normalizeCategory(production.reserveCategory),
      itemsPerCollection: clampInteger(production.itemsPerCollection, 9, 1, 30),
      compressCollections: production.compressCollections === true
    },
    distribution: {
      desktopReserveAlertEnabled: distribution.desktopReserveAlertEnabled !== false,
      desktopReserveThreshold: clampInteger(distribution.desktopReserveThreshold, 10, 1, 500),
      desktopReserveCategory: normalizeCategory(distribution.desktopReserveCategory),
      requireSendConfirmation: distribution.requireSendConfirmation === true,
      completionNotificationEnabled: distribution.completionNotificationEnabled !== false,
      autoDistributionEnabled: distribution.autoDistributionEnabled !== false,
      detectOnConnection: distribution.detectOnConnection !== false,
      phoneReserveThreshold: clampInteger(
        distribution.phoneReserveThreshold,
        DEFAULT_PAGE_SETTINGS.distribution.phoneReserveThreshold,
        1,
        500
      ),
       autoCategory: normalizeCategory(
         distribution.autoCategory,
         DEFAULT_PAGE_SETTINGS.distribution.autoCategory
       ),
       // Keep an existing installation's saved extra roots readable, while
       // keeping the new UI on the single work-package library by default.
       legacyAdditionalRootsEnabled:
         distribution.legacyAdditionalRootsEnabled === true || legacyRootsPresent,
      defaultSendRoots: {
        traffic: normalizePath(
          distribution.defaultSendRoots?.traffic
            || distribution.trafficSendRoot
            || distribution.defaultSendRoot
        ),
        conversion: normalizePath(
          distribution.defaultSendRoots?.conversion
            || distribution.conversionSendRoot
            || distribution.defaultSendRoot
        )
      },
      // Keep the old shared setting readable by older clients. New clients
      // use defaultSendRoots to avoid cross-category mixing.
      defaultSendRoot: normalizePath(distribution.defaultSendRoot),
      // A standard collection already clears the current phone threshold.
      // Keep the legacy field readable, but never allow automatic replenishment
      // to over-send multiple collections for one below-threshold evaluation.
      autoSendCount: 1,
      autoRetryLimit: clampInteger(distribution.autoRetryLimit, 3, 1, 5)
    },
    backup: {
      scheduleEnabled: backup.scheduleEnabled !== false,
      frequency: backupFrequency,
      intervalHours: backupFrequency === "interval"
        ? clampInteger(backup.intervalHours, defaultInterval, 1, 24 * 31)
        : defaultInterval,
      monthlyLargeFileLimitMb: clampInteger(backup.monthlyLargeFileLimitMb, 2560, 0, 10240),
      sourceRoot: String(backup.sourceRoot || "").trim().slice(0, 1000)
    },
    gptAuto: {
      mode: ["manual", "multi", "random", "all-day", "all-day-multi", "scheduled"].includes(gptAuto.mode)
        ? gptAuto.mode : DEFAULT_PAGE_SETTINGS.gptAuto.mode,
      autoConfirm: gptAuto.autoConfirm !== false,
      autoCopy: gptAuto.autoCopy !== false,
      autoPackage: gptAuto.autoPackage !== false,
      pauseOnFailure: gptAuto.pauseOnFailure !== false,
      autoArchive: gptAuto.autoArchive !== false,
      quotaReminderEnabled: gptAuto.quotaReminderEnabled !== false,
      minDelaySeconds: clampInteger(gptAuto.minDelaySeconds, 25, 5, 600),
      maxDelaySeconds: clampInteger(gptAuto.maxDelaySeconds, 55, 5, 900),
      taskTimeoutMinutes: clampInteger(gptAuto.taskTimeoutMinutes, 30, 5, 90),
      accountTaskLimit: clampInteger(gptAuto.accountTaskLimit, 8, 1, 50),
      launchAtLogin: gptAuto.launchAtLogin !== false,
      continuousAutoStart: gptAuto.continuousAutoStart !== false,
      continuousWorkHoursEnabled: gptAuto.continuousWorkHoursEnabled !== false,
      continuousWorkStart: /^\d{2}:\d{2}$/.test(String(gptAuto.continuousWorkStart || ""))
        ? String(gptAuto.continuousWorkStart) : DEFAULT_PAGE_SETTINGS.gptAuto.continuousWorkStart,
      continuousWorkEnd: /^\d{2}:\d{2}$/.test(String(gptAuto.continuousWorkEnd || ""))
        ? String(gptAuto.continuousWorkEnd) : DEFAULT_PAGE_SETTINGS.gptAuto.continuousWorkEnd,
      accounts: (Array.isArray(gptAuto.accounts) ? gptAuto.accounts : DEFAULT_PAGE_SETTINGS.gptAuto.accounts)
        .filter((account) => account && /^[a-z0-9_-]+$/i.test(String(account.id || "")))
        .slice(0, 8)
        .map((account, index) => ({
          id: String(account.id),
          name: String(account.name || `账号 ${index + 1}`).trim().slice(0, 24),
          uploadLimit: clampInteger(account.uploadLimit, 80, 1, 1000),
          generationLimit: clampInteger(account.generationLimit, 45, 1, 1000),
          windowHours: clampInteger(account.windowHours, 3, 1, 24)
        }))
    }
  };
}

function countReserve(collections = [], category = "conversion") {
  const normalized = normalizeCategory(category);
  return (Array.isArray(collections) ? collections : []).filter((collection) => {
    if (collection.workflowStage && collection.workflowStage !== "mobile") return false;
    if (collection.sourceValid === false || collection.dualPlatformEligible === false) return false;
    return normalized === "all" || collection.type === normalized;
  }).length;
}

// Automatic phone replenishment uses one selected category on both sides:
// the phone reserve threshold reads that category and the computer-side
// candidate pool is filtered by the same category. `all` is the explicit
// total-inventory mode. Keep this predicate shared with the sender so a
// stale/parallel caller can never turn a precise-only replenishment into a
// broad-traffic send.
function automaticDistributionCandidateEligible(collection = {}, category = "conversion") {
  const normalized = normalizeCategory(category);
  const type = String(collection.type || "").trim();
  if (collection.workflowStage !== "mobile") return false;
  if (collection.sourceValid === false || collection.dualPlatformEligible === false) return false;
  if (!new Set(["traffic", "conversion"]).has(type)) return false;
  return normalized === "all" || type === normalized;
}

function isTrustedRegistryDevice(device = {}) {
  return device.autoDistributionApproved === true
    || device.platformStatus === "confirmed"
    || device.connectionStatus === "confirmed";
}

function normalizeDeviceIdentityToken(value) {
  return String(value || "").toLowerCase().replace(/[\s（）()·_\-/\\]+/g, "");
}

function deviceApprovalKey(device = {}) {
  const model = [
    ...(Array.isArray(device.models) ? device.models : []),
    device.model
  ].map(normalizeDeviceIdentityToken).find(Boolean);
  if (model) return `model:${model}`;
  const name = [device.displayName, device.name, device.id]
    .map(normalizeDeviceIdentityToken).find(Boolean);
  return name ? `name:${name}` : "";
}

function automaticDistributionAdmission(device = {}, approvedKeys = []) {
  const approvalKey = deviceApprovalKey(device);
  const approved = isTrustedRegistryDevice(device)
    || (approvalKey && new Set(Array.isArray(approvedKeys) ? approvedKeys : []).has(approvalKey));
  return {
    approved: Boolean(approved),
    approvalKey,
    skipReason: approved ? null : "first_confirmation_required"
  };
}

function decorateTrustedDevices(devices = [], approvedKeys = []) {
  return (Array.isArray(devices) ? devices : []).map((device) => {
    const admission = automaticDistributionAdmission(device, approvedKeys);
    return {
      ...device,
      trusted: true,
      autoDistributionApproved: admission.approved,
      firstConfirmationRequired: !admission.approved,
      approvalKey: admission.approvalKey,
      trustLabel: admission.approved ? "可自动分发" : "首次自动分发需确认"
    };
  });
}

function deviceIdentityTokens(device = {}) {
  return [
    device.id,
    device.displayName,
    device.localRemark,
    device.note,
    ...(Array.isArray(device.aliases) ? device.aliases : []),
    ...(Array.isArray(device.models) ? device.models : []),
    device.model
  ]
    .map(normalizeDeviceIdentityToken)
    .filter(Boolean);
}

function findRegisteredDevice(devices = [], target = "", approvedKeys = []) {
  const normalizedTarget = normalizeDeviceIdentityToken(target);
  if (!normalizedTarget) return null;
  return decorateTrustedDevices(devices, approvedKeys).find((device) =>
    deviceIdentityTokens(device).some((token) =>
      token === normalizedTarget || token.includes(normalizedTarget) || normalizedTarget.includes(token)
    )) || null;
}

function findTrustedDevice(devices = [], target = "", approvedKeys = []) {
  const device = findRegisteredDevice(devices, target, approvedKeys);
  return device?.autoDistributionApproved ? device : null;
}

function deviceTransportTarget(liveRecord = {}, fallback = "") {
  const liveName = String(liveRecord.name || "")
    .replace(/[（(]\s*作品数\s*\d+\s*[）)]\s*$/u, "")
    .trim();
  return liveName || String(liveRecord.model || fallback || "").trim();
}

function nonNegativeInventoryCount(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function selectDeviceInventory(liveRecord = {}, category = "conversion") {
  const normalizedCategory = normalizeCategory(category);
  if (normalizedCategory === "all") {
    const categoryTotal = nonNegativeInventoryCount(liveRecord.workCounts?.total);
    const legacyTotal = nonNegativeInventoryCount(liveRecord.workCount);
    const value = categoryTotal ?? legacyTotal;
    return { value, category: "all", source: "live_device_total" };
  }
  const categoryValue = nonNegativeInventoryCount(liveRecord.workCounts?.[normalizedCategory]);
  return {
    value: categoryValue,
    category: normalizedCategory,
    source: "live_device_category"
  };
}

function automaticDistributionDecisionFingerprint(liveRecord = {}, settings = {}, eligible = [], admission = {}) {
  const category = normalizeCategory(settings.autoCategory || "conversion");
  const inventory = selectDeviceInventory(liveRecord, category).value;
  // The receiver state is part of the decision.  Without it, a device that
  // was observed while receiving kept the same fingerprint after returning to
  // idle, so the monitor treated the failed/busy evaluation as already done
  // and never started the next replenishment attempt.
  const deviceState = String(liveRecord.transferState || liveRecord.state || "")
    .trim().toLowerCase();
  const taskId = String(liveRecord.taskId || "").trim();
  const threshold = Number.isFinite(Number(settings.phoneReserveThreshold))
    ? Number(settings.phoneReserveThreshold) : null;
  const candidateAvailable = (Array.isArray(eligible) ? eligible : []).length > 0;
  const candidateSignature = (Array.isArray(eligible) ? eligible : [])
    .map((collection) => String(collection?.name || "").trim())
    .filter(Boolean)
    .join("|");
  return JSON.stringify({
    inventory,
    deviceState,
    taskId,
    appVersion: String(liveRecord.appVersion || "").trim(),
    versionCode: Number.isSafeInteger(Number(liveRecord.versionCode)) ? Number(liveRecord.versionCode) : null,
    updateCapability: String(liveRecord.updateCapability || "").trim(),
    threshold,
    category,
    sendCount: 1,
    candidateAvailable,
    candidateSignature,
    approved: admission.approved === true
  });
}

function automaticDistributionSendCount({ inventory, threshold, configuredCount, candidateCount } = {}) {
  const current = Number(inventory);
  const reserve = Number(threshold);
  const candidates = Math.max(0, Number(candidateCount) || 0);
  // `configuredCount` remains accepted for old settings and callers, but the
  // automatic rule is intentionally one standard collection per evaluation.
  // This prevents a phone at 0 from receiving two collections when one already
  // raises it above the reserve threshold.
  const configured = Math.max(1, Math.min(1, Number(configuredCount) || 1));
  if (!Number.isFinite(current) || !Number.isFinite(reserve) || current >= reserve) return 0;
  return Math.min(configured, candidates);
}

function automaticDistributionSkipMessage(skipReason, context = {}) {
  const categoryLabels = {
    conversion: "精准流量类",
    traffic: "泛流量类",
    all: "总作品数"
  };
  const deviceName = String(
    context.deviceLabel
      || context.deviceNote
      || context.deviceName
      || context.deviceDisplayName
      || ""
  ).trim();
  const deviceModel = String(context.deviceModel || "").trim();
  const deviceIdentity = deviceName && deviceModel && !deviceName.includes(deviceModel)
    ? `${deviceName}（${deviceModel}）`
    : (deviceName || deviceModel);
  const devicePrefix = deviceIdentity ? `${deviceIdentity}：` : "";
  const compactReason = (value, max = 240) => {
    const text = String(value || "").trim();
    return text.length > max ? `…${text.slice(-(max - 1))}` : text;
  };
  if (skipReason === "inventory_unknown") {
    const category = categoryLabels[normalizeCategory(context.category)] || "所选分类";
    const missingLabel = category === "总作品数" ? "手机总作品数" : `${category}库存`;
    return `${devicePrefix}手机在线，但未上报${missingLabel}；请升级手机接收端后重新连接`;
  }
  if (skipReason === "inventory_sufficient") {
    const category = categoryLabels[normalizeCategory(context.category)] || "所选分类";
    const inventoryLabel = category === "总作品数" ? "手机总作品数" : `${category}库存`;
    return `${devicePrefix}${inventoryLabel} ${Number(context.inventory)} 已达到阈值 ${Number(context.threshold)}，本轮无需补充`;
  }
  if (skipReason === "first_confirmation_required") return `${devicePrefix}新设备首次自动分发需要确认一次；确认后以后连接会自动检测并补货`;
  if (skipReason === "device_busy") return `${devicePrefix}手机正在接收传送，本轮只记录传输状态，不启动新的自动补发`;
  if (skipReason === "receiver_update_required") {
    const reason = compactReason(context.reason);
    return `${devicePrefix}手机接收端需要更新，已暂停自动重试${reason ? `：${reason}` : ""}`;
  }
  if (skipReason === "receiver_busy") {
    const reason = compactReason(context.reason || "上一批传输仍在接收");
    return `${devicePrefix}手机接收端仍在处理上一批传输，已暂停自动重试；重新连接后再继续${reason ? `：${reason}` : ""}`;
  }
  if (skipReason === "receiver_unavailable") {
    const reason = compactReason(context.reason || "电脑端未能匹配到手机在线接收端");
    return `${devicePrefix}手机在线状态与接收端不一致，已暂停自动重试；重新连接后再继续${reason ? `：${reason}` : ""}`;
  }
  if (skipReason === "candidate_in_flight") {
    const category = categoryLabels[normalizeCategory(context.category)] || "当前分类";
    return `${devicePrefix}${category}作品集正在另一条发送链路中；本轮为避免重复发送暂不执行`;
  }
  if (skipReason === "no_candidate_package") return `${devicePrefix}电脑端没有符合当前分类的可发送作品集`;
  if (skipReason === "send_count_zero") return `${devicePrefix}本轮计算出的自动发送数量为 0`;
  return skipReason ? `${devicePrefix}自动分发未触发：${skipReason}` : "";
}

function classifyAutomaticDistributionError(error = {}) {
  const message = String(error?.message || error || "").trim();
  // These failures are deterministic for the installed receiver/task format.
  // Retrying immediately only creates another partial task and can duplicate
  // the same work; wait for the receiver to be upgraded/reconnected instead.
  if (/meta\.properties.*(?:ENOENT|No such file)/i.test(message)
      || /断点任务的文件名不匹配/.test(message)) {
    return {
      retryable: false,
      code: "RECEIVER_UPDATE_REQUIRED",
      message
    };
  }
  if (/设备返回错误\s*409.*(?:正在接收|另一批素材|不在空闲)/.test(message)
      || /目标设备当前不在空闲接收状态/.test(message)) {
    return {
      retryable: false,
      code: "RECEIVER_BUSY",
      message
    };
  }
  if (/设备匹配数量为\s*0/.test(message)
      || /设备当前未连接/.test(message)
      || /请先在手机上打开接收端/.test(message)) {
    return {
      retryable: false,
      code: "RECEIVER_UNAVAILABLE",
      message
    };
  }
  return {
    retryable: true,
    code: "AUTOMATIC_TRANSFER_RETRYABLE",
    message
  };
}

function automaticDistributionBlockedMessage(code, detail = "") {
  const rawDetail = String(detail || "").trim();
  const suffix = rawDetail.length > 240 ? `…${rawDetail.slice(-239)}` : rawDetail;
  const tail = suffix ? `：${suffix}` : "";
  if (code === "RECEIVER_UPDATE_REQUIRED") {
    return `检测到接收端格式不兼容，已暂停自动重试；请升级手机接收端后重新连接${tail}`;
  }
  if (code === "RECEIVER_BUSY") {
    return `检测到手机接收端仍在处理上一批传输，已暂停自动重试；重新连接后再继续${tail}`;
  }
  if (code === "RECEIVER_UNAVAILABLE") {
    return `检测到电脑端未能匹配到手机在线接收端，已暂停自动重试；请重新连接设备后再继续${tail}`;
  }
  return `自动分发已暂停；设备重新连接后可再次尝试${tail}`;
}

module.exports = {
  DEFAULT_PAGE_SETTINGS,
  automaticDistributionAdmission,
  automaticDistributionCandidateEligible,
  automaticDistributionDecisionFingerprint,
  automaticDistributionSendCount,
  automaticDistributionSkipMessage,
  automaticDistributionBlockedMessage,
  classifyAutomaticDistributionError,
  countReserve,
  decorateTrustedDevices,
  deviceApprovalKey,
  deviceTransportTarget,
  findRegisteredDevice,
  findTrustedDevice,
  isTrustedRegistryDevice,
  selectDeviceInventory,
  normalizePageSettings
};
