const test = require("node:test");
const assert = require("node:assert/strict");
const {
  INSTANCE_CONFIG,
  defaultAccountId,
  getInstanceConfig,
  instanceIdForPort,
  normalizeInstanceId,
  resolveAssignedAccountIds
} = require("./instance-account-policy");

test("A-D each have one canonical account and isolated ports", () => {
  assert.deepEqual(Object.keys(INSTANCE_CONFIG), ["A", "B", "C", "D"]);
  assert.deepEqual(Object.values(INSTANCE_CONFIG).map((item) => item.accountId), [
    "account-1", "account-2", "account-3", "account-4"
  ]);
  assert.deepEqual(Object.values(INSTANCE_CONFIG).map((item) => item.port), [4331, 4332, 4333, 4334]);
  assert.deepEqual(Object.values(INSTANCE_CONFIG).map((item) => item.remoteDebuggingPort), [9431, 9432, 9433, 9434]);
});

test("content-only instances default to their one canonical account", () => {
  assert.deepEqual(resolveAssignedAccountIds("A", "", { contentOnlyMode: true }), ["account-1"]);
  assert.deepEqual(resolveAssignedAccountIds("B", "", { contentOnlyMode: true }), ["account-2"]);
  assert.deepEqual(resolveAssignedAccountIds("C", "", { contentOnlyMode: true }), ["account-3"]);
  assert.deepEqual(resolveAssignedAccountIds("D", "", { contentOnlyMode: true }), ["account-4"]);
  assert.equal(defaultAccountId("B"), "account-2");
});

test("an explicit assignment is normalized and deduplicated", () => {
  assert.deepEqual(resolveAssignedAccountIds("B", "account-4,account-3,account-4", { contentOnlyMode: true }), ["account-4", "account-3"]);
});

test("legacy non-content mode keeps its open account list behavior", () => {
  assert.deepEqual(resolveAssignedAccountIds("A", ""), []);
  assert.equal(defaultAccountId("A"), "account-1");
});

test("unknown instance ids fall back to A without silently inventing another account", () => {
  assert.equal(normalizeInstanceId("unknown"), "A");
  assert.equal(getInstanceConfig("unknown").accountId, "account-1");
});

test("instance ports resolve to the matching A-D identity", () => {
  assert.deepEqual([4331, 4332, 4333, 4334].map(instanceIdForPort), ["A", "B", "C", "D"]);
  assert.equal(instanceIdForPort(4327), "");
});
