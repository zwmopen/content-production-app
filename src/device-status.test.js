const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseOnlineDeviceStatus,
  parseDevicePresenceBeacon,
  resolveDeviceTransportTarget,
  deviceStatusScanArgs,
  readDevicePresenceSnapshot,
  writeDevicePresenceSnapshot
} = require("./server");

test("automatic monitor uses the bounded bidirectional background scan", () => {
  assert.deepEqual(deviceStatusScanArgs(), ["--status-json", "--status-background"]);
  assert.deepEqual(deviceStatusScanArgs("fast"), ["--status-json", "--status-fast"]);
  assert.deepEqual(deviceStatusScanArgs("udp-only"), ["--status-json", "--status-udp-only"]);
});

test("device status parser preserves category inventory from machine JSON", () => {
  const output = JSON.stringify({
    deviceId: "android-k60",
    name: "Xiaomi K60",
    model: "Xiaomi 23013RK75C",
    protocol: 2,
    port: 45833,
    state: "online",
    androidVersion: "14",
    appVersion: "0.6.55",
    versionCode: 93,
    packageName: "com.zwm.gallery",
    updateCapability: "apk-push-v1",
    relayEnabled: true,
    workCount: 15,
    workCounts: { total: 15, conversion: 8, traffic: 7, uncategorized: 0 }
  });

  assert.deepEqual(parseOnlineDeviceStatus(output), [{
    deviceId: "android-k60",
    name: "Xiaomi K60",
    model: "Xiaomi 23013RK75C",
    protocol: 2,
    port: 45833,
    online: true,
    state: "online",
    transferState: "idle",
    transport: "wifi",
    androidVersion: "14",
    appVersion: "0.6.55",
    versionCode: 93,
    packageName: "com.zwm.gallery",
    updateCapability: "apk-push-v1",
    relayEnabled: true,
    workCount: 15,
    workCounts: { total: 15, conversion: 8, traffic: 7, uncategorized: 0 }
  }]);
});

test("device status parser keeps mobile version details for automatic repair", () => {
  const [device] = parseOnlineDeviceStatus(JSON.stringify({
    deviceId: "android-redmi13",
    name: "红米13（微信） 1号",
    model: "Xiaomi 23124RN87C",
    protocol: 2,
    state: "online",
    appVersion: "0.6.54",
    versionCode: 92,
    androidVersion: "15",
    packageName: "com.zwm.gallery",
    updateCapability: "apk-push-v1",
    workCounts: { total: 14, conversion: 0, traffic: 14, uncategorized: 0 }
  }));
  assert.equal(device.appVersion, "0.6.54");
  assert.equal(device.versionCode, 92);
  assert.equal(device.androidVersion, "15");
  assert.equal(device.packageName, "com.zwm.gallery");
  assert.equal(device.updateCapability, "apk-push-v1");
  assert.equal(device.deviceId, "android-redmi13");
});

test("legacy device status keeps category inventory unknown", () => {
  const [device] = parseOnlineDeviceStatus("旧手机（作品数 15）\tAndroid\tonline");
  assert.equal(device.workCount, 15);
  assert.equal(device.workCounts, null);
});

test("partial category inventory remains usable without inventing missing categories", () => {
  const [device] = parseOnlineDeviceStatus(JSON.stringify({
    name: "Redmi Note 8",
    model: "Xiaomi Redmi Note 8",
    state: "online",
    workCount: 12,
    workCounts: { total: 12, conversion: 5 }
  }));
  assert.deepEqual(device.workCounts, { total: 12, conversion: 5 });
  assert.equal(device.workCounts.traffic, undefined);
});

test("device aliases resolve to the live receiver name before transport", () => {
  const liveName = resolveDeviceTransportTarget(
    "6",
    "Xiaomi Redmi Note 8",
    { aliases: ["6"], models: ["Xiaomi Redmi Note 8"] },
    [{ name: "WRedmi Note 8（A2）", model: "Xiaomi Redmi Note 8", current: true }]
  );
  assert.equal(liveName, "WRedmi Note 8（A2）");
});

test("device presence snapshot round-trips fallback metadata", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tb-device-presence-"));
  const snapshotFile = path.join(tempRoot, "device-presence.json");
  const snapshot = {
    checkedAt: 1787191747926,
    onlineDevices: [{ name: "Redmi 13", model: "Xiaomi 23124RN87C", current: true }],
    stale: true,
    scanError: "设备在线状态扫描超时",
    scanErrorAt: "2026-08-19T17:54:52.029Z"
  };
  try {
    const saved = writeDevicePresenceSnapshot(snapshot, snapshotFile);
    assert.equal(saved.stale, true);
    const restored = readDevicePresenceSnapshot(snapshotFile);
    assert.equal(restored.checkedAt, snapshot.checkedAt);
    assert.deepEqual(restored.onlineDevices, snapshot.onlineDevices);
    assert.equal(restored.stale, true);
    assert.equal(restored.scanError, snapshot.scanError);
    assert.equal(restored.scanErrorAt, snapshot.scanErrorAt);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("手机主动在线信标可解析分类库存并保留版本信息", () => {
  const encode = (value) => Buffer.from(value, "utf8").toString("base64url");
  const packet = [
    "ZWMDS2_HERE", "2", "android-redmi13", "45833", encode("红米13（微信） 1号"),
    encode("Xiaomi 23124RN87C"), encode("online"), "", "11", encode("0.6.55"),
    "93", encode("apk-push-v1"), "0", "11", "0"
  ].join("|");
  assert.deepEqual(parseDevicePresenceBeacon(packet), {
    deviceId: "android-redmi13",
    name: "红米13（微信） 1号",
    model: "Xiaomi 23124RN87C",
    protocol: 2,
    port: 45833,
    taskId: "",
    online: true,
    state: "online",
    transferState: "idle",
    transport: "wifi",
    workCount: 11,
    workCounts: { conversion: 0, traffic: 11, uncategorized: 0, total: 11 },
    appVersion: "0.6.55",
    versionCode: 93,
    updateCapability: "apk-push-v1"
  });
});
