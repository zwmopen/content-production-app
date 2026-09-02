(function distributionUiFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DistributionUI = api;
}(typeof window !== "undefined" ? window : globalThis, () => {
  function platformStateLabel(state) {
    return ({
      available: "可用",
      used: "已使用",
      archived: "已使用",
      reserved_pending_upload: "已打开，待确认上传",
      confirmed_published: "上传已完成",
      unknown: "状态待确认",
      invalid: "未登记"
    })[state] || "未知";
  }

  function matchesPlatform(collection, platform) {
    if (!platform || platform === "all") return true;
    if (platform === "dual") return Boolean(collection.dualPlatformEligible);
    if (platform === "xhs") return collection.xhs === "available";
    if (platform === "official") return collection.officialAccount === "available";
    if (platform === "official_pending") return collection.officialAccount === "reserved_pending_upload";
    if (platform === "all_used") {
      return collection.xhs !== "available"
        && collection.douyin !== "available"
        && collection.officialAccount !== "available";
    }
    return true;
  }

  function filterCollections(collections, filters = {}) {
    const query = String(filters.query || "").trim().toLowerCase();
    return (collections || []).filter((collection) => {
      const typeMatch = !filters.type || filters.type === "all" || collection.type === filters.type;
      const platformMatch = matchesPlatform(collection, filters.platform);
      const haystack = [
        collection.name,
        collection.typeLabel,
        platformStateLabel(collection.xhs),
        platformStateLabel(collection.douyin),
        platformStateLabel(collection.officialAccount),
        ...(collection.exclusionReasons || [])
      ].join(" ").toLowerCase();
      return typeMatch && platformMatch && (!query || haystack.includes(query));
    });
  }

  function countCollectionFacets(collections, filters = {}) {
    const typeValues = ["all", "traffic", "conversion", "unclassified"];
    const platformValues = ["all", "dual", "xhs", "official", "official_pending", "all_used"];
    const count = (nextFilters) => filterCollections(collections, nextFilters).length;

    return {
      types: Object.fromEntries(typeValues.map((type) => [
        type,
        count({ ...filters, type, platform: filters.platform || "all" })
      ])),
      platforms: Object.fromEntries(platformValues.map((platform) => [
        platform,
        count({ ...filters, type: filters.type || "all", platform })
      ]))
    };
  }

  function parseDeviceCheckOutput(output) {
    const match = String(output || "").match(/已登记手机\s*(\d+)\s*台；当前在线\s*(\d+)\s*台/);
    return match
      ? { registered: Number(match[1]), online: Number(match[2]) }
      : { registered: null, online: null };
  }

  function phoneDistributionStats(summary = {}, deviceCheck = {}, registeredFallback = 0) {
    return [
      {
        id: "devices",
        label: "当前设备在线",
        value: `${deviceCheck.online ?? 0}/${deviceCheck.registered ?? registeredFallback}`,
        unit: "台"
      },
      { id: "traffic", label: "泛流量作品集", value: summary.traffic || 0, unit: "个" },
      { id: "conversion", label: "精准流量（业务类）", value: summary.conversion || 0, unit: "个" }
    ];
  }

  function countDistributablePackages(collections = []) {
    return (Array.isArray(collections) ? collections : [])
      .filter((collection) => collection.dualPlatformEligible)
      .reduce((counts, collection) => {
        if (collection.type === "traffic" || collection.type === "conversion") {
          counts[collection.type] += 1;
        }
        return counts;
      }, { traffic: 0, conversion: 0 });
  }

  function normalizeDeviceIdentity(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/（[^）]*作品数[^）]*）/g, "")
      .replace(/\([^)]*作品数[^)]*\)/g, "")
      .replace(/[\s（）()·_\-/\\]+/g, "");
  }

  function deviceApprovalKey(device = {}) {
    const model = [
      ...(Array.isArray(device.models) ? device.models : []),
      device.model
    ].map(normalizeDeviceIdentity).find(Boolean);
    if (model) return `model:${model}`;
    const name = [device.displayName, device.name, device.id]
      .map(normalizeDeviceIdentity).find(Boolean);
    return name ? `name:${name}` : "";
  }

  function normalizeWorkCounts(value) {
    if (!value || typeof value !== "object") return null;
    const counts = {};
    ["total", "conversion", "traffic", "uncategorized"].forEach((key) => {
      const number = Number(value[key]);
      if (Number.isFinite(number) && number >= 0) counts[key] = number;
    });
    return Object.keys(counts).length ? counts : null;
  }

  function parseDeviceStatusOutput(output) {
    return String(output || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        if (line.startsWith("{")) {
          try {
            const payload = JSON.parse(line);
            const state = String(payload.state || "").trim().toLowerCase();
            if (!["online", "receiving", "transferring", "transmitting", "busy"].includes(state)) return null;
            const workCount = Number(payload.workCount);
            const details = {};
            ["deviceId", "taskId", "androidVersion", "appVersion", "packageName", "updateCapability"]
              .forEach((key) => {
                const value = String(payload[key] || "").trim();
                if (value) details[key] = value;
              });
            ["protocol", "port", "versionCode"].forEach((key) => {
              const value = Number(payload[key]);
              if (Number.isSafeInteger(value) && value >= 0) details[key] = value;
            });
            if (typeof payload.relayEnabled === "boolean") details.relayEnabled = payload.relayEnabled;
            return {
              ...details,
              name: String(payload.name || "").trim(),
              model: String(payload.model || "").trim(),
              online: true,
              state,
              transferState: state === "online" ? "idle" : state,
              deviceBusy: state !== "online",
              transport: "wifi",
              workCount: Number.isFinite(workCount) && workCount >= 0 ? workCount : null,
              workCounts: normalizeWorkCounts(payload.workCounts)
            };
          } catch {
            return null;
          }
        }
        const parts = line.split("\t").map((part) => part.trim());
        const state = String(parts[parts.length - 1] || "").toLowerCase();
        if (parts.length < 3 || !["online", "receiving", "transferring", "transmitting", "busy"].includes(state)) return null;
        const name = parts[0];
        const workMatch = name.match(/作品数\s*(\d+)/);
        return {
          name,
          model: parts[1],
          online: true,
          state,
          transferState: state === "online" ? "idle" : state,
          deviceBusy: state !== "online",
          transport: "wifi",
          workCount: workMatch ? Number(workMatch[1]) : null
        };
      })
      .filter(Boolean);
  }

  function decorateDevices(devices, onlineRecords, approvedDeviceKeys = []) {
    const records = Array.isArray(onlineRecords) ? onlineRecords : [];
    const approvedKeys = new Set(Array.isArray(approvedDeviceKeys) ? approvedDeviceKeys : []);
    const matchedRecords = new Set();
    const knownDevices = (Array.isArray(devices) ? devices : [])
      .map((device, sourceIndex) => {
        const models = Array.isArray(device.models)
          ? device.models
          : [device.model].filter(Boolean);
        const aliases = [
          device.displayName,
          device.name,
          device.label,
          ...(Array.isArray(device.aliases) ? device.aliases : [])
        ].map(normalizeDeviceIdentity).filter(Boolean);
        const liveIndex = records.findIndex((record) => {
          const liveModel = normalizeDeviceIdentity(record.model);
          if (models.some((model) => normalizeDeviceIdentity(model) === liveModel)) return true;
          const liveName = normalizeDeviceIdentity(record.name);
          return aliases.some((alias) =>
            alias.length >= 2 && (liveName.includes(alias) || alias.includes(liveName))
          );
        });
        const live = liveIndex >= 0 ? records[liveIndex] : null;
        const currentLive = live?.current === false ? null : live;
        const approvalKey = device.approvalKey || deviceApprovalKey(device);
        const autoDistributionApproved = device.autoDistributionApproved === true
          || device.firstConfirmationRequired === false
          || device.platformStatus === "confirmed"
          || device.connectionStatus === "confirmed"
          || (approvalKey && approvedKeys.has(approvalKey));
        if (liveIndex >= 0) matchedRecords.add(liveIndex);
        return {
          ...device,
          trusted: true,
          autoDistributionApproved,
          firstConfirmationRequired: !autoDistributionApproved,
          approvalKey,
          trustLabel: autoDistributionApproved ? "可自动分发" : "首次自动分发需确认",
          online: Boolean(currentLive),
          recentlySeen: Boolean(live?.recentlySeen || live?.current === false),
           transport: currentLive?.transport || "",
           state: currentLive?.state || "online",
           transferState: currentLive?.transferState || (currentLive?.state === "online" ? "idle" : currentLive?.state || "idle"),
           deviceBusy: Boolean(currentLive?.deviceBusy || ["receiving", "transferring", "transmitting", "busy"].includes(currentLive?.transferState || currentLive?.state)),
           transports: {
            wifi: Boolean(currentLive),
            usb: device.usbOnline === true,
            remote: device.remoteOnline === true
          },
          usbCapable: /iphone\s*6|苹果\s*6|iphone8,[12]/i.test([
            device.id,
            device.displayName,
            ...models
          ].join(" ")),
          // Keep the live phone identity separate from the computer-side
          // remark.  The renderer can therefore show a renamed handset while
          // preserving the user's local label.
          liveName: currentLive ? currentLive.name : "",
           syncedName: currentLive?.name || device.syncedName || device.displayName || device.name || "",
           syncedModel: currentLive?.model || device.syncedModel || models[0] || "",
           workCount: currentLive ? currentLive.workCount : null,
           workCounts: currentLive ? normalizeWorkCounts(currentLive.workCounts) : null,
           deviceId: currentLive?.deviceId || device.deviceId || "",
           protocol: currentLive?.protocol ?? device.protocol ?? null,
           port: currentLive?.port ?? device.port ?? null,
           taskId: currentLive?.taskId || "",
           androidVersion: currentLive?.androidVersion || "",
           appVersion: currentLive?.appVersion || "",
           versionCode: currentLive?.versionCode ?? null,
           packageName: currentLive?.packageName || "",
           updateCapability: currentLive?.updateCapability || "",
           relayEnabled: currentLive?.relayEnabled ?? null,
           _sourceIndex: sourceIndex
        };
      });
    const unknownDevices = records
      .map((record, index) => ({ record, index }))
      .filter(({ record, index }) => !matchedRecords.has(index) && record.current !== false)
      .map(({ record }, index) => {
        const approvalKey = deviceApprovalKey(record);
        const autoDistributionApproved = Boolean(approvalKey && approvedKeys.has(approvalKey));
        return ({
        id: `discovered-${normalizeDeviceIdentity(record.model || record.name) || index}`,
        displayName: String(record.name || record.model || "未登记设备").replace(/[（(][^）)]*作品数[^）)]*[）)]/g, "").trim(),
        note: String(record.note || "").trim(),
        noteIsCustom: record.noteIsCustom === true,
        ownerGroup: "自动发现",
        platforms: [],
        models: [record.model].filter(Boolean),
        aliases: [record.name].filter(Boolean),
        online: true,
        recentlySeen: false,
         transport: record.transport || "wifi",
         state: record.state || "online",
         transferState: record.transferState || (record.state === "online" ? "idle" : record.state || "idle"),
         deviceBusy: Boolean(record.deviceBusy || ["receiving", "transferring", "transmitting", "busy"].includes(record.transferState || record.state)),
         transports: { wifi: true, usb: false, remote: false },
        usbCapable: false,
        liveName: record.name || "",
         syncedName: record.name || record.model || "",
         syncedModel: record.model || "",
         workCount: Number.isFinite(Number(record.workCount)) ? Number(record.workCount) : null,
         workCounts: normalizeWorkCounts(record.workCounts),
         deviceId: record.deviceId || "",
         protocol: record.protocol ?? null,
         port: record.port ?? null,
         taskId: record.taskId || "",
         androidVersion: record.androidVersion || "",
         appVersion: record.appVersion || "",
         versionCode: record.versionCode ?? null,
         packageName: record.packageName || "",
         updateCapability: record.updateCapability || "",
         relayEnabled: record.relayEnabled ?? null,
         trusted: true,
        autoDistributionApproved,
        firstConfirmationRequired: !autoDistributionApproved,
        approvalKey,
        trustLabel: autoDistributionApproved ? "可自动分发" : "首次自动分发需确认",
        _sourceIndex: knownDevices.length + index
      });
      });
    return [...knownDevices, ...unknownDevices]
      .sort((left, right) => {
        if (left.online !== right.online) return left.online ? -1 : 1;
        const leftNumber = Number(left.number);
        const rightNumber = Number(right.number);
        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
          return leftNumber - rightNumber;
        }
        return left._sourceIndex - right._sourceIndex;
      });
  }

  function normalizeDistributionStatus(value) {
    const raw = String(value || "recorded").trim().toLowerCase();
    if (/fail|error|失败|未完成/.test(raw)) return "failed";
    if (/cancel|停止|取消/.test(raw)) return "cancelled";
    if (/running|start|进行|开始/.test(raw)) return "running";
    if (/complete|success|完成|已接收|已记录/.test(raw)) return "completed";
    return raw || "recorded";
  }

  function distributionCategoryLabel(value) {
    return value === "traffic" ? "泛流量类"
      : value === "conversion" ? "精准流量类"
        : value === "all" ? "总作品数"
        : "所选分类";
  }

  function cleanDistributionDeviceIdentity(value) {
    return String(value || "")
      .replace(/[（(][^）)]*作品数[^）)]*[）)]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function distributionDeviceMetadata(row = {}) {
    const record = row.deviceRecord || row.deviceInfo || {};
    const note = cleanDistributionDeviceIdentity(
      row.deviceNote ?? row.note ?? row.businessAlias ?? record.note ?? record.localRemark
    );
    const name = cleanDistributionDeviceIdentity(
      row.deviceName
      ?? row["设备名"]
      ?? row.rawDeviceName
      ?? record.liveName
      ?? record.syncedName
      ?? record.name
      ?? row.device
      ?? row.resolvedDeviceName
    );
    const model = cleanDistributionDeviceIdentity(
      row.deviceModel
      ?? row["设备型号"]
      ?? row.model
      ?? row.phoneModel
      ?? record.syncedModel
      ?? record.model
      ?? (Array.isArray(record.models) ? record.models[0] : "")
    );
    const id = cleanDistributionDeviceIdentity(
      row.deviceId
      ?? row.targetDeviceId
      ?? record.id
      ?? row.id
    );
    return { note, name, model, id };
  }

  function distributionDeviceLabel(row = {}) {
    const metadata = distributionDeviceMetadata(row);
    const primary = metadata.note || metadata.name || metadata.model || metadata.id || "未记录设备（旧日志缺少设备标识）";
    const normalizedPrimary = normalizeDeviceIdentity(primary);
    const normalizedModel = normalizeDeviceIdentity(metadata.model);
    const modelSuffix = metadata.model
      && normalizedModel
      && normalizedPrimary !== normalizedModel
      && !normalizedPrimary.includes(normalizedModel)
      ? `（${metadata.model}）`
      : "";
    return `${primary}${modelSuffix}`;
  }

  function findDistributionDeviceRecord(row = {}, devices = []) {
    const candidates = [
      row.deviceId,
      row.targetDeviceId,
      row.device,
      row.businessAlias,
      row.resolvedDeviceName,
      row.rawDeviceName,
      row.deviceModel,
      row.model
    ].map(normalizeDeviceIdentity).filter((value) => value && value !== "全局设备");
    if (!candidates.length) return null;
    return (Array.isArray(devices) ? devices : []).find((device) => {
      const values = [
        device.id,
        device.displayName,
        device.note,
        device.name,
        device.liveName,
        device.syncedName,
        device.model,
        device.syncedModel,
        ...(Array.isArray(device.models) ? device.models : []),
        ...(Array.isArray(device.aliases) ? device.aliases : [])
      ].map(normalizeDeviceIdentity).filter(Boolean);
      return candidates.some((candidate) => values.some((value) => value === candidate || value.includes(candidate) || candidate.includes(value)));
    }) || null;
  }

  function distributionEventSourceLabel(row = {}) {
    if (row.sourceLabel) return String(row.sourceLabel).trim();
    if (row.event || row.skipReason || row.inventorySource) return "自动库存检查（后台轮询）";
    return String(row.collection || "自动分发").trim();
  }

  function distributionTimeLabel(value) {
    const text = String(value || "").trim();
    if (!text) return "时间未记录";
    // CSV history sometimes stores a local-looking timestamp without a zone.
    // Keep it as written; only convert an explicitly absolute ISO timestamp.
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
      return text.replace("T", " ").slice(0, 19);
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  }

  function distributionBytesLabel(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const amount = bytes / (1024 ** index);
    return `${index === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[index]}`;
  }

  function addDistributionDetail(details, label, value) {
    const text = String(value ?? "").trim();
    if (text) details.push(`${label}：${text}`);
  }

  function humanizeDistributionConfirmation(value) {
    const text = String(value || "").trim();
    if (!text) return "结果未记录";
    if (/接收|完成|成功|提交确认|已记录/.test(text)) return "接收端已确认";
    if (/失败|错误|未完成/.test(text)) return "未完成";
    return text;
  }

  function humanizeDistributionOperation(row = {}) {
    const action = String(row.action || "").trim();
    if (/移动到(?:已发送1次|微信公众号)/.test(action)) return "已移动到已发送1次（微信公众号可发）";
    if (/压缩归档并删除源文件夹/.test(action)) return "已压缩归档并清理源文件夹";
    if (/修改作品集分类/.test(action)) return "已修改作品集分类";
    if (/重命名/.test(action)) return "已重命名作品集";
    if (!action) return "已记录文件夹操作";
    return /^已/.test(action) ? action : `已${action}`;
  }

  function humanizeAutomaticDistributionTitle(row = {}) {
    const device = distributionDeviceLabel(row);
    const category = distributionCategoryLabel(row.inventoryCategory || row.category);
    const inventory = Number(row.inventoryCount ?? row.phoneReserve);
    const totalInventory = row.totalCount === null || row.totalCount === undefined || row.totalCount === ""
      ? NaN : Number(row.totalCount);
    const threshold = row.configuredThreshold === null || row.configuredThreshold === undefined || row.configuredThreshold === ""
      ? NaN : Number(row.configuredThreshold);
    const count = Number(row.requested ?? row.count ?? row.completed);
    const countLabel = Number.isFinite(count) && count > 0 ? `${count} 个作品集` : "作品集";
    const skipReason = String(row.skipReason || "");
    const event = String(row.event || "").toLowerCase();

    if (row.skipReason === "inventory_unknown") {
      // Total inventory is a valid fallback only in the explicit `all` mode.
      // A missing precise/broad category must not be replaced by total count,
      // otherwise a phone with 2/7 precise works can be misread as 16/7.
      if (category === "总作品数" && Number.isFinite(totalInventory) && Number.isFinite(threshold)) {
        return totalInventory < threshold
          ? `${device} 分类库存字段未上报；总库存 ${totalInventory} 个低于阈值 ${threshold} 个，按总数规则需要补发`
          : `${device} 分类库存字段未上报；总库存 ${totalInventory} 个已达到阈值 ${threshold} 个，按总数规则本轮无需补发`;
      }
      return `${device} 在线，但未上报${category}库存；自动分发未执行`;
    }
    if (skipReason === "first_confirmation_required") return `${device} 尚未完成首次授权，暂不自动发送`;
    if (skipReason === "inventory_sufficient") return `${device} 的${category}库存充足，不需要补发`;
    if (skipReason === "candidate_in_flight") return `${device} 的${category}作品集正在另一条发送链路中，本轮为避免重复发送暂不执行`;
    if (skipReason === "no_candidate_package") return `${device} 库存不足，但没有找到可发送的${category}作品集`;
    if (skipReason === "send_count_zero") return `${device} 库存不足，但本轮没有可发送数量`;
    if (event === "evaluated" && row.needRefill && Number.isFinite(inventory) && Number.isFinite(threshold)) {
      return `${device} 的${category}库存为 ${inventory} 个，低于阈值 ${threshold} 个，准备补发 ${countLabel}`;
    }
    if (event === "started") return `已开始向 ${device} 自动发送 ${countLabel}`;
    if (event === "item-completed") {
      return row.collection
        ? `已向 ${device} 发送“${row.collection}”`
        : `已向 ${device} 完成一项自动发送`;
    }
    if (event === "completed") return `${device} 自动发送完成，共收到 ${countLabel}`;
    if (event === "retrying") return `${device} 的${row.collection ? `“${row.collection}”` : "这项发送"}失败，正在重试`;
    if (event === "failed") return `${device} 自动发送失败，本轮已暂停`;
    if (event === "scan-failed") return "后台检查设备失败，自动分发暂未执行";
    return String(row.message || "自动分发已记录");
  }

  function automaticDistributionDetails(row = {}) {
    const details = [];
    const metadata = distributionDeviceMetadata(row);
    const device = distributionDeviceLabel(row);
    addDistributionDetail(details, "来源", distributionEventSourceLabel(row));
    addDistributionDetail(details, "设备", device);
    addDistributionDetail(details, "设备备注", metadata.note && metadata.note !== device ? metadata.note : "");
    addDistributionDetail(details, "手机名称", metadata.name && metadata.name !== metadata.note ? metadata.name : "");
    addDistributionDetail(details, "手机型号", metadata.model && !device.includes(metadata.model) ? metadata.model : "");
    addDistributionDetail(details, "设备标识", metadata.id);
    addDistributionDetail(details, "作品集", row.collection);
    if (row.candidateCategory) {
      addDistributionDetail(details, "候选类别", distributionCategoryLabel(row.candidateCategory));
    }
    if (row.collectionType) {
      addDistributionDetail(details, "作品集分类", distributionCategoryLabel(row.collectionType));
    }
    if (row.inventoryCount != null || row.phoneReserve != null) {
      const inventory = row.inventoryCount ?? row.phoneReserve;
      addDistributionDetail(details, distributionCategoryLabel(row.inventoryCategory || row.category) + "库存", `${inventory} 个`);
    }
    if (row.configuredThreshold != null) addDistributionDetail(details, "补发阈值", `${row.configuredThreshold} 个`);
    if (Number(row.candidateBlockedPackageCount) > 0) {
      addDistributionDetail(details, "占用作品集", `${row.candidateBlockedPackageCount} 个（重复保护）`);
    }
    if (row.requested != null || row.count != null) addDistributionDetail(details, "本轮计划", `${row.requested ?? row.count} 个作品集`);
    if (row.completed != null) addDistributionDetail(details, "本轮完成", `${row.completed} 个作品集`);
    if (row.progress != null) addDistributionDetail(details, "本轮进度", `${row.progress}%`);
    if (row.attempt != null) addDistributionDetail(details, "尝试次数", row.maxAttempts ? `${row.attempt}/${row.maxAttempts}` : row.attempt);
    addDistributionDetail(details, "判断结果", row.skipReason ? humanizeAutomaticDistributionTitle(row) : "已进入自动发送流程");
    if (row.skipReason === "inventory_unknown") {
      const totalInventory = row.totalCount === null || row.totalCount === undefined || row.totalCount === ""
        ? NaN : Number(row.totalCount);
      const threshold = row.configuredThreshold === null || row.configuredThreshold === undefined || row.configuredThreshold === ""
        ? NaN : Number(row.configuredThreshold);
      const category = distributionCategoryLabel(row.inventoryCategory || row.category);
      if (category === "总作品数" && Number.isFinite(totalInventory) && Number.isFinite(threshold)) {
        const totalDecision = totalInventory < threshold
          ? `分类库存字段未上报；总库存 ${totalInventory} 个低于阈值 ${threshold} 个，当前规则按总数补发`
          : `分类库存字段未上报；总库存 ${totalInventory} 个已达到阈值 ${threshold} 个，本轮无需补发`;
        addDistributionDetail(details, "自动分发", totalDecision);
        addDistributionDetail(details, "处理建议", "无需因分类字段缺失重装手机端；刷新设备状态即可按总数规则继续判断");
      } else {
        addDistributionDetail(details, "自动分发", `未执行：手机接收端未上报${category}库存`);
        addDistributionDetail(details, "处理建议", "升级手机接收端后重新连接，再刷新设备状态");
      }
      addDistributionDetail(details, "来源说明", "电脑后台定时检查在线设备库存，不是手机主动发起发送");
    }
    if (row.batchId) addDistributionDetail(details, "批次编号", row.batchId);
    if (row.taskId || row.taskId === "") addDistributionDetail(details, "技术追踪号", row.taskId);
    if (row.message && row.message !== humanizeAutomaticDistributionTitle(row)) addDistributionDetail(details, "系统原话", row.message);
    return details;
  }

  function normalizeDistributionEvents(data = {}) {
    const rows = [];
    (data.deviceHistory || []).forEach((row, index) => {
      const source = row["源作品集"] || row["作品集"] || "未记录";
      const target = row["设备名"] || "未记录设备";
      const confirmation = humanizeDistributionConfirmation(row["接收确认"] || row["状态"]);
      const details = [];
      addDistributionDetail(details, "设备", target);
      addDistributionDetail(details, "设备型号", row["设备型号"]);
      addDistributionDetail(details, "文件", row["文件数"] != null ? `${row["文件数"]} 个` : "");
      addDistributionDetail(details, "大小", row["字节数"] != null ? distributionBytesLabel(row["字节数"]) : "");
      addDistributionDetail(details, "传输方式", row["传输协议"]);
      addDistributionDetail(details, "结果", confirmation);
      addDistributionDetail(details, "发送前路径", row["源路径"]);
      addDistributionDetail(details, "记录备注", row["操作"]);
      rows.push({
        id: `device-${row["时间"] || index}`,
        channel: "manual",
        kind: "设备发送",
        title: `已发送“${source}”到 ${target}`,
        source,
        target,
        time: row["时间"] || "",
        timeLabel: distributionTimeLabel(row["时间"]),
        status: normalizeDistributionStatus(row["接收确认"] || row["状态"]),
        message: confirmation,
        details
      });
    });
    (data.officialAccountHistory || []).forEach((row, index) => {
      const source = row["源作品集"] || row["作品集"] || "未记录";
      const target = row["公众号账号"] || "微信公众号";
      const details = [];
      addDistributionDetail(details, "公众号账号", target);
      addDistributionDetail(details, "文件", row["文件数"] != null ? `${row["文件数"]} 个` : "");
      addDistributionDetail(details, "大小", row["字节数"] != null ? distributionBytesLabel(row["字节数"]) : "");
      addDistributionDetail(details, "状态", row["状态"] || "已记录");
      addDistributionDetail(details, "原始路径", row["源路径"]);
      addDistributionDetail(details, "记录备注", row["操作"]);
      rows.push({
        id: `official-${row["时间"] || index}`,
        channel: "manual",
        kind: "公众号与归档",
        title: `已记录公众号操作：“${source}”`,
        source,
        target,
        time: row["时间"] || "",
        timeLabel: distributionTimeLabel(row["时间"]),
        status: normalizeDistributionStatus(row["状态"]),
        message: row["状态"] || "已记录",
        details
      });
    });
    (data.operationHistory || []).forEach((row, index) => {
      const source = row.collection || "未记录";
      const target = row.targetCollection || (/微信公众号/.test(String(row.action || "")) ? "微信公众号" : "本地成品库");
      const details = [];
      addDistributionDetail(details, "原位置", row.from);
      addDistributionDetail(details, "新位置", row.to);
      addDistributionDetail(details, "阶段", row.stage === "official" ? "已发送1次（微信公众号可发）" : (row.stage === "mobile" ? "已发送0次（抖音小红书可发）" : row.stage));
      addDistributionDetail(details, "结果", row.status === "completed" ? "已完成" : row.status || "已记录");
      rows.push({
        id: `operation-${row.time || index}`,
        channel: "manual",
        kind: "文件夹操作",
        title: humanizeDistributionOperation(row),
        source,
        target,
        time: row.time || "",
        timeLabel: distributionTimeLabel(row.time),
        status: normalizeDistributionStatus(row.status),
        message: row.status === "completed" ? "已完成" : row.status || "已记录",
        details
      });
    });
    const knownDevices = [
      ...(Array.isArray(data.devices) ? data.devices : []),
      ...(Array.isArray(data.registeredDevices) ? data.registeredDevices : []),
      ...(Array.isArray(data.onlineDevices) ? data.onlineDevices : [])
    ];
    (data.automationHistory || []).forEach((row, index) => {
      const enrichedRow = { ...row, deviceRecord: findDistributionDeviceRecord(row, knownDevices) };
      const title = automaticDistributionHistoryTitle(enrichedRow);
      rows.push({
        id: `automation-${row.time || index}`,
        channel: "auto",
        kind: "自动检测与分发",
        title,
        source: distributionEventSourceLabel(enrichedRow),
        target: distributionDeviceLabel(enrichedRow),
        time: row.time || "",
        timeLabel: distributionTimeLabel(row.time),
        status: normalizeDistributionStatus(row.event),
        message: row.event === "failed" || row.event === "scan-failed" ? "需要处理" : row.event === "evaluated" ? "已完成检查" : row.event === "retrying" ? "重试中" : row.event === "started" ? "进行中" : row.event === "completed" || row.event === "item-completed" ? "已完成" : (row.progress == null ? "已记录" : `${row.progress}%`),
        details: automaticDistributionDetails(enrichedRow)
      });
    });
    return rows.sort((left, right) => String(right.time || "").localeCompare(String(left.time || "")));
  }

  function filterDistributionEvents(rows, filter = "all") {
    if (!filter || filter === "all") return Array.isArray(rows) ? rows : [];
    return (Array.isArray(rows) ? rows : []).filter((row) => row.channel === filter);
  }

  function automaticDistributionHistoryTitle(row = {}) {
    if (row.skipReason === "inventory_unknown"
      && (!row.message || row.message === "自动分发未触发：inventory_unknown")) {
      return humanizeAutomaticDistributionTitle(row);
    }
    return humanizeAutomaticDistributionTitle(row);
  }

  function shouldNotifyDistributionEvent(row = {}) {
    return ["started", "running", "completed", "failed", "cancelled"]
      .includes(String(row.event || row.status || "").toLowerCase());
  }

  return {
    countCollectionFacets,
    countDistributablePackages,
    filterCollections,
    matchesPlatform,
    parseDeviceCheckOutput,
    parseDeviceStatusOutput,
    decorateDevices,
    filterDistributionEvents,
    normalizeDistributionEvents,
    distributionBytesLabel,
    distributionTimeLabel,
    shouldNotifyDistributionEvent,
    phoneDistributionStats,
    platformStateLabel
  };
}));
