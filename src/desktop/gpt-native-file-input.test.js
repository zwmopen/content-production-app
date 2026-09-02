const assert = require("node:assert/strict");
const test = require("node:test");
const { setAndDispatchGptFileInputBatch } = require("./gpt-native-file-input");

test("原生附件等待延迟 FileList 后只派发一次", async () => {
  const calls = { resolve: 0, set: 0, read: 0, dispatch: 0 };
  let names = [];
  const result = await setAndDispatchGptFileInputBatch({
    expectedNames: ["cover.png", "body.png"],
    timeoutMs: 100,
    intervalMs: 1,
    resolveNode: async () => {
      calls.resolve += 1;
      return "input-1";
    },
    setFiles: async () => {
      calls.set += 1;
      names = [];
    },
    readFileNames: async () => {
      calls.read += 1;
      if (calls.read >= 3) names = ["cover.png", "body.png"];
      return { ok: true, count: names.length, names };
    },
    dispatch: async () => {
      calls.dispatch += 1;
      // React may replace the old input immediately after dispatch.
      names = [];
      return { ok: true };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.names, ["cover.png", "body.png"]);
  assert.equal(calls.resolve, 1);
  assert.equal(calls.set, 1);
  assert.ok(calls.read >= 3);
  assert.equal(calls.dispatch, 1);
});

test("派发后旧 input 被替换不被误判为附件回读失败", async () => {
  const calls = { set: 0, read: 0, dispatch: 0, oldInputReadAfterDispatch: 0 };
  let replaced = false;
  const result = await setAndDispatchGptFileInputBatch({
    expectedNames: ["one.png", "two.png"],
    resolveNode: async () => "input-2",
    setFiles: async () => {
      calls.set += 1;
    },
    readFileNames: async () => {
      if (replaced) calls.oldInputReadAfterDispatch += 1;
      calls.read += 1;
      return { ok: true, count: 2, names: ["one.png", "two.png"] };
    },
    dispatch: async () => {
      calls.dispatch += 1;
      replaced = true;
      return { ok: true };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.set, 1);
  assert.equal(calls.dispatch, 1);
  assert.equal(calls.oldInputReadAfterDispatch, 0);
});

test("附件设置失败只保留当前批次检查点，不会二次上传", async () => {
  const calls = { set: 0, read: 0, dispatch: 0 };
  const result = await setAndDispatchGptFileInputBatch({
    expectedNames: ["missing-a.png", "missing-b.png"],
    timeoutMs: 5,
    intervalMs: 1,
    resolveNode: async () => "input-3",
    setFiles: async () => {
      calls.set += 1;
    },
    readFileNames: async () => {
      calls.read += 1;
      return { ok: true, count: 0, names: [] };
    },
    dispatch: async () => {
      calls.dispatch += 1;
      return { ok: true };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(calls.set, 1);
  assert.equal(calls.dispatch, 0);
  assert.ok(calls.read >= 1);
});
