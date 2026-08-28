const test = require("node:test");
const assert = require("node:assert/strict");
const { createWorkbenchCommandBus } = require("./workbench-command-bus");

test("command bus dispatches registered actions with source metadata", async () => {
  const bus = createWorkbenchCommandBus();
  bus.register({ id: "gpt.diagnostic", label: "读取 GPT 诊断", readOnly: true }, async (args, context) => ({
    accountId: args.accountId,
    source: context.source
  }));
  const result = await bus.dispatch({ actionId: "gpt.diagnostic", source: "voice", args: { accountId: "account-2" } });
  assert.equal(result.ok, true);
  assert.equal(result.actionId, "gpt.diagnostic");
  assert.deepEqual(result.result, { accountId: "account-2", source: "voice" });
});

test("command bus refuses unregistered and disallowed actions", async () => {
  const bus = createWorkbenchCommandBus();
  bus.register({ id: "workspace.refresh", sources: ["ui", "assistant"] }, () => ({ refreshed: true }));
  assert.equal((await bus.dispatch({ actionId: "missing.action", source: "ui" })).ok, false);
  const denied = await bus.dispatch({ actionId: "workspace.refresh", source: "voice" });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /不允许/);
});

test("command bus converts handler failures into structured results", async () => {
  const bus = createWorkbenchCommandBus();
  bus.register({ id: "workspace.fail" }, () => { throw new Error("测试失败"); });
  const result = await bus.dispatch({ actionId: "workspace.fail", source: "assistant" });
  assert.deepEqual({ ok: result.ok, error: result.error }, { ok: false, error: "测试失败" });
});

test("command bus propagates a handler's explicit refused action", async () => {
  const bus = createWorkbenchCommandBus();
  bus.register({ id: "gpt.reset-current" }, () => ({ ok: false, reason: "confirmation-required" }));
  const result = await bus.dispatch({ actionId: "gpt.reset-current", source: "ui" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "confirmation-required");
  assert.equal(result.result.reason, "confirmation-required");
});
