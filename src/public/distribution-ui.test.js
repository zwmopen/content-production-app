const assert = require("node:assert/strict");
const test = require("node:test");

const {
  countCollectionFacets,
  countDistributablePackages,
  filterCollections,
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
} = require("./distribution-ui");

test("normalizeDistributionEvents unifies manual and automatic records with truthful sources", () => {
  const rows = normalizeDistributionEvents({
    deviceHistory: [{ "源作品集": "作品集_008[转]", "设备名": "1号手机", "时间": "2026-08-10 10:00", "接收确认": "已完成" }],
    operationHistory: [{ action: "移动阶段", collection: "作品集_009[泛]", targetCollection: "公众号", time: "2026-08-10 10:01", status: "completed" }],
    automationHistory: [{ event: "failed", message: "自动补货失败", device: "2号手机", collection: "作品集_010[转]", time: "2026-08-10 10:02" }]
  });
  assert.deepEqual(rows.map((row) => [row.channel, row.source, row.target, row.status]), [
    ["auto", "自动库存检查（后台轮询）", "2号手机", "failed"],
    ["manual", "作品集_009[泛]", "公众号", "completed"],
    ["manual", "作品集_008[转]", "1号手机", "completed"]
  ]);
});

test("normalizeDistributionEvents humanizes legacy category inventory skips", () => {
  const [row] = normalizeDistributionEvents({
    automationHistory: [{
      event: "evaluated",
      skipReason: "inventory_unknown",
      inventoryCategory: "conversion",
      device: "VIVO",
      deviceModel: "V2327A",
      message: "自动分发未触发：inventory_unknown",
      time: "2026-08-11 13:00"
    }]
  });
  assert.equal(row.title, "VIVO（V2327A） 在线，但未上报精准流量类库存；自动分发未执行");
  assert.equal(row.source, "自动库存检查（后台轮询）");
  assert.equal(row.target, "VIVO（V2327A）");
  assert.ok(row.details.some((item) => item.includes("自动分发：未执行：手机接收端未上报精准流量类库存")));
  assert.ok(row.details.some((item) => item.includes("处理建议：升级手机接收端后重新连接")));
});

test("automatic distribution details expose the candidate category and selected collection type", () => {
  const [row] = normalizeDistributionEvents({
    automationHistory: [{
      event: "item-completed",
      device: "苹果12",
      collection: "作品集_070[转]",
      candidateCategory: "conversion",
      collectionType: "conversion",
      time: "2026-08-17T07:00:00.000Z"
    }]
  });
  assert.ok(row.details.some((item) => item.includes("候选类别：精准流量类")));
  assert.ok(row.details.some((item) => item.includes("作品集分类：精准流量类")));
});

test("normalizeDistributionEvents explains duplicate-protected candidate skips", () => {
  const [row] = normalizeDistributionEvents({
    automationHistory: [{
      event: "evaluated",
      skipReason: "candidate_in_flight",
      inventoryCategory: "conversion",
      candidateCategory: "conversion",
      candidatePackageCount: 7,
      candidateBlockedPackageCount: 1,
      device: "红米13（微信） 1号",
      time: "2026-08-18T02:56:15.000Z"
    }]
  });
  assert.equal(row.title, "红米13（微信） 1号 的精准流量类作品集正在另一条发送链路中，本轮为避免重复发送暂不执行");
  assert.ok(row.details.some((item) => item.includes("占用作品集：1 个（重复保护）")));
});

test("normalizeDistributionEvents does not substitute total inventory for a missing category", () => {
  const [row] = normalizeDistributionEvents({
    automationHistory: [{
      event: "evaluated",
      skipReason: "inventory_unknown",
      inventoryCategory: "conversion",
      device: "苹果12",
      deviceModel: "iPhone13,2",
      totalCount: 18,
      configuredThreshold: 7,
      message: "苹果12：手机在线，但未上报精准流量类库存",
      time: "2026-08-17T03:16:27.522Z"
    }]
  });
  assert.equal(row.title, "苹果12（iPhone13,2） 在线，但未上报精准流量类库存；自动分发未执行");
  assert.ok(row.details.some((item) => item.includes("自动分发：未执行：手机接收端未上报精准流量类库存")));
  assert.ok(row.details.some((item) => item.includes("处理建议：升级手机接收端后重新连接")));
});

test("normalizeDistributionEvents resolves an automation log to the registered device identity", () => {
  const [row] = normalizeDistributionEvents({
    devices: [{
      id: "phone-redmi-8",
      note: "红米8·公司",
      displayName: "Redmi Note 8",
      syncedName: "Redmi Note 8",
      syncedModel: "M1908C3JGG"
    }],
    automationHistory: [{
      event: "evaluated",
      skipReason: "inventory_unknown",
      inventoryCategory: "conversion",
      deviceId: "phone-redmi-8",
      time: "2026-08-14T01:00:00.000Z"
    }]
  });
  assert.match(row.title, /红米8·公司/);
  assert.match(row.title, /M1908C3JGG/);
  assert.equal(row.target, "红米8·公司（M1908C3JGG）");
  assert.ok(row.details.some((item) => item.includes("设备标识：phone-redmi-8")));
});

test("normalizeDistributionEvents gives people a clear result before technical details", () => {
  const rows = normalizeDistributionEvents({
    deviceHistory: [{
      "源作品集": "作品集_067[转]",
      "设备名": "VIVO",
      "设备型号": "V2327A",
      "文件数": "74",
      "字节数": "177413511",
      "传输协议": "LAN",
      "接收确认": "接收端已提交确认",
      "源路径": "D:\\成品库\\抖音小红书\\作品集_067[转]",
      "操作": "工作台接收确认 distribution-1786666665746-lo91gd",
      "时间": "2026-08-14T00:20:31.777Z"
    }],
    operationHistory: [{
      action: "移动到微信公众号",
      collection: "作品集_067[转]",
      from: "D:\\成品库\\抖音小红书\\作品集_067[转]",
      to: "D:\\成品库\\微信公众号\\作品集_067[转]",
      time: "2026-08-14T00:20:32.843Z",
      status: "completed"
    }],
    automationHistory: [{
      event: "completed",
      device: "VIVO",
      completed: 1,
      message: "自动分发完成，共发送 1 个作品集",
      time: "2026-08-14T00:20:42.000Z"
    }]
  });
  const device = rows.find((row) => row.kind === "设备发送");
  const move = rows.find((row) => row.kind === "文件夹操作");
  const automatic = rows.find((row) => row.kind === "自动检测与分发");
  assert.equal(device.title, "已发送“作品集_067[转]”到 VIVO");
  assert.equal(device.message, "接收端已确认");
  assert.equal(device.timeLabel, "2026-08-14 08:20:31");
  assert.ok(device.details.some((item) => item.includes("文件：74 个")));
  assert.ok(device.details.some((item) => item.includes("大小：169.2 MB")));
  assert.ok(device.details.some((item) => item.includes("技术") || item.includes("distribution-1786666665746-lo91gd")));
  assert.equal(move.title, "已移动到微信公众号");
  assert.ok(move.details.some((item) => item.includes("原位置")));
  assert.equal(automatic.title, "VIVO 自动发送完成，共收到 1 个作品集");
  assert.equal(automatic.message, "已完成");
  assert.equal(distributionBytesLabel(177413511), "169.2 MB");
  assert.equal(distributionTimeLabel("2026-08-14 08:20:31"), "2026-08-14 08:20:31");
});

test("filterDistributionEvents supports all, manual and auto tabs", () => {
  const rows = [{ channel: "manual" }, { channel: "auto" }, { channel: "manual" }];
  assert.equal(filterDistributionEvents(rows, "all").length, 3);
  assert.equal(filterDistributionEvents(rows, "manual").length, 2);
  assert.equal(filterDistributionEvents(rows, "auto").length, 1);
});

test("distribution notification policy keeps lifecycle events and suppresses scan noise", () => {
  assert.equal(shouldNotifyDistributionEvent({ event: "started" }), true);
  assert.equal(shouldNotifyDistributionEvent({ event: "completed" }), true);
  assert.equal(shouldNotifyDistributionEvent({ event: "failed" }), true);
  assert.equal(shouldNotifyDistributionEvent({ event: "scan" }), false);
  assert.equal(shouldNotifyDistributionEvent({ event: "no-op" }), false);
});

const collections = [
  {
    name: "作品集_015[泛]",
    type: "traffic",
    xhs: "available",
    douyin: "available",
    officialAccount: "available",
    dualPlatformEligible: true
  },
  {
    name: "作品集_027[泛]",
    type: "traffic",
    xhs: "used",
    douyin: "archived",
    officialAccount: "available",
    dualPlatformEligible: false
  },
  {
    name: "作品集_045[转]",
    type: "conversion",
    xhs: "used",
    douyin: "used",
    officialAccount: "reserved_pending_upload",
    dualPlatformEligible: false
  }
];

test("filterCollections combines type, platform and text filters", () => {
  assert.deepEqual(
    filterCollections(collections, {
      type: "traffic",
      platform: "dual",
      query: "015"
    }).map((item) => item.name),
    ["作品集_015[泛]"]
  );
  assert.deepEqual(
    filterCollections(collections, {
      type: "all",
      platform: "official_pending",
      query: ""
    }).map((item) => item.name),
    ["作品集_045[转]"]
  );
});

test("countCollectionFacets returns live cross-filter counts for filter chips", () => {
  assert.deepEqual(
    countCollectionFacets(collections, {
      type: "traffic",
      platform: "all",
      query: ""
    }),
    {
      types: {
        all: 3,
        traffic: 2,
        conversion: 1,
        unclassified: 0
      },
      platforms: {
        all: 2,
        dual: 1,
        xhs: 1,
        official: 2,
        official_pending: 0,
        all_used: 0
      }
    }
  );
});

test("phoneDistributionStats uses the agreed user-facing labels and category counts", () => {
  assert.deepEqual(
    phoneDistributionStats(
      { traffic: 10, conversion: 2 },
      { registered: 8, online: 0 },
      6
    ),
    [
      { id: "devices", label: "当前设备在线", value: "0/8", unit: "台" },
      { id: "traffic", label: "泛流量作品集", value: 10, unit: "个" },
      { id: "conversion", label: "精准流量（业务类）", value: 2, unit: "个" }
    ]
  );
});

test("countDistributablePackages uses the same eligibility as the visible package list", () => {
  assert.deepEqual(
    countDistributablePackages([
      { name: ".作品集_041[转]", type: "conversion", xhs: "available", dualPlatformEligible: false },
      { name: "作品集_008[转]", type: "conversion", xhs: "available", dualPlatformEligible: true },
      { name: "作品集_010[转]", type: "conversion", xhs: "used", dualPlatformEligible: false },
      { name: "作品集_015[泛]", type: "traffic", xhs: "used", dualPlatformEligible: true }
    ]),
    { traffic: 1, conversion: 1 }
  );
});

test("platformStateLabel uses user-facing labels without overstating publication", () => {
  assert.equal(platformStateLabel("available"), "可用");
  assert.equal(platformStateLabel("reserved_pending_upload"), "已打开，待确认上传");
  assert.equal(platformStateLabel("confirmed_published"), "上传已完成");
  assert.equal(platformStateLabel("invalid"), "未登记");
});

test("parseDeviceCheckOutput reads registered and online counts from the skill output", () => {
  assert.deepEqual(
    parseDeviceCheckOutput("团建项目已登记手机 8 台；当前在线 1 台。\n提醒：5号需要补货"),
    { registered: 8, online: 1 }
  );
  assert.deepEqual(parseDeviceCheckOutput("设备发现失败"), { registered: null, online: null });
});

test("parseDeviceStatusOutput identifies concrete online devices and work counts", () => {
  assert.deepEqual(
    parseDeviceStatusOutput([
      "Rmi 9A（A10）（作品数 22）\tXiaomi M2006C3LC\tonline",
      "红米13（微信） 1号（作品数 20）\tXiaomi 23124RN87C\tonline"
    ].join("\n")),
    [
      { name: "Rmi 9A（A10）（作品数 22）", model: "Xiaomi M2006C3LC", online: true, state: "online", transferState: "idle", deviceBusy: false, transport: "wifi", workCount: 22 },
      { name: "红米13（微信） 1号（作品数 20）", model: "Xiaomi 23124RN87C", online: true, state: "online", transferState: "idle", deviceBusy: false, transport: "wifi", workCount: 20 }
    ]
  );
});

test("parseDeviceStatusOutput preserves category inventory from machine JSON", () => {
  assert.deepEqual(
    parseDeviceStatusOutput(JSON.stringify({
      state: "online",
      name: "苹果12",
      model: "iPhone13,2",
      workCount: 16,
      workCounts: { total: 16, conversion: 0, traffic: 16, uncategorized: 0 }
    })),
    [{
      name: "苹果12",
      model: "iPhone13,2",
      online: true,
      state: "online",
      transferState: "idle",
      deviceBusy: false,
      transport: "wifi",
      workCount: 16,
      workCounts: { total: 16, conversion: 0, traffic: 16, uncategorized: 0 }
    }]
  );
});

test("decorateDevices puts online devices first and disables offline actions", () => {
  const devices = [
    { id: "iphone-12", number: 2, displayName: "2号 苹果12", models: ["iPhone13,2"], aliases: ["苹果12"] },
    { id: "redmi-13", number: 1, displayName: "1号 红米13", models: ["Xiaomi 23124RN87C"], aliases: ["红米13"] },
    { id: "redmi-9a-a10", number: 8, displayName: "8号 红米9A", models: ["Xiaomi M2006C3LC"], aliases: ["Rmi 9A"] }
  ];
  const online = parseDeviceStatusOutput([
    "Rmi 9A（A10）（作品数 22）\tXiaomi M2006C3LC\tonline",
    "红米13（微信） 1号（作品数 20）\tXiaomi 23124RN87C\tonline"
  ].join("\n"));
  const result = decorateDevices(devices, online);
  assert.deepEqual(result.map((item) => item.number), [1, 8, 2]);
  assert.equal(result[0].online, true);
  assert.deepEqual(result[0].transports, { wifi: true, usb: false, remote: false });
  assert.equal(result[0].workCount, 20);
  assert.equal(result[2].online, false);
});

test("decorateDevices keeps the computer remark ahead of the live phone name", () => {
  const [device] = decorateDevices([{
    id: "redmi-13",
    displayName: "1号 红米13",
    note: "好吧",
    noteIsCustom: true,
    models: ["Xiaomi 23124RN87C"],
    aliases: ["红米13"]
  }], [{
    name: "红米13（微信） 1号",
    model: "Xiaomi 23124RN87C",
    online: true,
    current: true,
    workCount: 7
  }]);
  assert.equal(device.note, "好吧");
  assert.equal(device.noteIsCustom, true);
  assert.equal(device.liveName, "红米13（微信） 1号");
  assert.equal(device.syncedName, "红米13（微信） 1号");
  assert.equal(device.syncedModel, "Xiaomi 23124RN87C");
  assert.equal(device.workCount, 7);
});

test("discovered phones carry a saved computer remark for the next refresh", () => {
  const [device] = decorateDevices([], [{
    id: "discovered-modelx",
    name: "临时手机",
    model: "Model X",
    note: "测试机",
    noteIsCustom: true,
    online: true,
    current: true
  }]);
  assert.equal(device.id, "discovered-modelx");
  assert.equal(device.note, "测试机");
  assert.equal(device.noteIsCustom, true);
  assert.equal(device.syncedName, "临时手机");
});

test("decorateDevices exposes unmatched online phones as sendable first-confirmation devices", () => {
  const result = decorateDevices([
    { id: "known", displayName: "1号手机", aliases: ["1号"], models: ["Model A"], trusted: true }
  ], [
    { name: "临时手机（作品数 2）", model: "Model X", online: true, workCount: 2, current: true }
  ]);
  const discovered = result.find((item) => item.models?.includes("Model X"));
  assert.equal(result.length, 2);
  assert.equal(discovered.trusted, true);
  assert.equal(discovered.firstConfirmationRequired, true);
  assert.equal(discovered.trustLabel, "首次自动分发需确认");
  assert.equal(discovered.workCount, 2);
});

test("decorateDevices never presents a recently-seen cache record as currently online", () => {
  const [device] = decorateDevices([
    { id: "vivo", displayName: "VIVO", aliases: ["vivo"], models: ["vivo V2327A"] }
  ], [
    { name: "vivo", model: "vivo V2327A", online: true, current: false, recentlySeen: true, workCount: 5 }
  ]);
  assert.equal(device.online, false);
  assert.equal(device.recentlySeen, true);
});

test("decorateDevices only marks USB and remote active from truthful capability fields", () => {
  const [device] = decorateDevices([{
    id: "iphone-6",
    displayName: "苹果6",
    models: ["iPhone8,1"],
    usbOnline: true,
    remoteOnline: false
  }], []);
  assert.equal(device.usbCapable, true);
  assert.deepEqual(device.transports, { wifi: false, usb: true, remote: false });
});
