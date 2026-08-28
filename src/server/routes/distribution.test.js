const assert = require("node:assert/strict");
const test = require("node:test");

const { handle } = require("./distribution");

test("device refresh does not invoke the retired junction inventory scanner", async () => {
  let legacyInventoryCalls = 0;
  let response = null;
  const matched = await handle(
    { method: "POST" },
    {},
    "/api/distribution/check",
    {},
    {
      getBody: async () => JSON.stringify({ force: true, inventory: true }),
      sendJson: (_res, value) => { response = value; },
      runDistributionAction: async () => {
        legacyInventoryCalls += 1;
        throw new Error("legacy publish-space scanner must not run");
      },
      getDeviceStatus: async () => ({ output: "", onlineDevices: [] }),
      parseOnlineDeviceStatus: () => [],
      registeredDevices: () => [],
      maybeStartAutomaticDistribution: () => [],
      recentAutomationLogs: () => []
    }
  );

  assert.equal(matched, true);
  assert.equal(legacyInventoryCalls, 0);
  assert.equal(response.ok, true);
  assert.equal(response.inventoryScanned, true);
  assert.deepEqual(response.onlineDevices, []);
});

test("legacy device action without an explicit collection is blocked from bypassing the work ledger", async () => {
  let legacyRunnerCalls = 0;
  let response = null;
  let statusCode = null;
  const matched = await handle(
    { method: "POST" },
    {},
    "/api/distribution/action",
    {},
    {
      getBody: async () => JSON.stringify({
        action: "device-restock",
        device: "6号",
        deviceModel: "Xiaomi Redmi Note 8",
        type: "conversion",
        confirmed: true
      }),
      sendJson: (_res, value) => { response = value; },
      send: (_res, code) => { statusCode = code; },
      startDistributionTask: () => { throw new Error("must not start without an explicit collection"); }
    }
  );
  assert.equal(matched, true);
  assert.equal(statusCode, 409);
  assert.equal(response, null);
  assert.equal(legacyRunnerCalls, 0);
});
