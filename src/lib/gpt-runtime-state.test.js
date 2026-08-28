const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  newerRuntimeState,
  normalizeRuntimeState,
  readRuntimeState,
  writeRuntimeState,
  writeRuntimeStateAsync
} = require("./gpt-runtime-state");

test("运行状态只保留有任务的队列并限制索引", () => {
  const state = normalizeRuntimeState({
    savedAt: "2026-08-09T12:00:00.000Z",
    queue: { index: 99, paused: true, running: true, mode: "rotate", tasks: [{ requestId: "a" }] }
  });
  assert.equal(state.queue.index, 1);
  assert.equal(state.queue.paused, true);
  assert.equal(state.queue.running, true);
  assert.equal(state.queue.tasks[0].requestId, "a");
  assert.equal(normalizeRuntimeState({ queue: { tasks: [] } }).queue, null);
});

test("服务端写入使用单调版本并可从磁盘恢复", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-gpt-runtime-"));
  const file = path.join(root, "runtime.json");
  const first = writeRuntimeState(file, { queue: { tasks: [{ requestId: "a" }] } }, "2026-08-09T12:00:00.000Z");
  const second = writeRuntimeState(file, { revision: 1, queue: null }, "2026-08-09T12:01:00.000Z");
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(readRuntimeState(file).queue, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("运行真源遇到 Windows 瞬时文件占用时有限退避后重试改名", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-gpt-runtime-retry-"));
  const file = path.join(root, "runtime.json");
  const originalRenameSync = fs.renameSync;
  let attempts = 0;
  fs.renameSync = (...args) => {
    attempts += 1;
    if (attempts <= 2) {
      const error = new Error("temporary sharing violation");
      error.code = "EPERM";
      throw error;
    }
    return originalRenameSync(...args);
  };
  try {
    const state = writeRuntimeState(file, { queue: { tasks: [{ requestId: "retry" }] } }, "2026-08-09T12:02:00.000Z");
    assert.equal(state.queue.tasks[0].requestId, "retry");
    assert.equal(readRuntimeState(file).queue.tasks[0].requestId, "retry");
    assert.equal(attempts, 3);
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("运行真源串行写入并按窗口更新时间合并，避免旧快照覆盖其他账号", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-gpt-runtime-merge-"));
  const file = path.join(root, "runtime.json");
  try {
    await writeRuntimeStateAsync(file, {
      control: { windowRuntime: { "account-a": { status: "running", updatedAt: 200 } } }
    }, "2026-08-09T12:00:00.000Z");
    await Promise.all([
      writeRuntimeStateAsync(file, {
        control: {
          windowRuntime: {
            "account-a": { status: "old", updatedAt: 100 },
            "account-b": { status: "paused", updatedAt: 150 }
          }
        }
      }, "2026-08-09T12:01:00.000Z"),
      writeRuntimeStateAsync(file, {
        control: {
          windowRuntime: {
            "account-a": { status: "latest", updatedAt: 300 },
            "account-c": { status: "running", updatedAt: 250 }
          }
        }
      }, "2026-08-09T12:02:00.000Z")
    ]);
    const state = readRuntimeState(file);
    assert.equal(state.revision, 3);
    assert.equal(state.control.windowRuntime["account-a"].status, "latest");
    assert.equal(state.control.windowRuntime["account-b"].status, "paused");
    assert.equal(state.control.windowRuntime["account-c"].status, "running");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("已完成窗口不会被旧 renderer 的同一任务降级回恢复态", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-gpt-runtime-completed-"));
  const file = path.join(root, "runtime.json");
  try {
    await writeRuntimeStateAsync(file, {
      control: {
        windowRuntime: {
          "account-a": {
            status: "completed",
            currentTaskId: "",
            completedSets: 1,
            currentPercent: 100,
            updatedAt: 300
          }
        }
      }
    }, "2026-08-09T12:00:00.000Z");
    await writeRuntimeStateAsync(file, {
      control: {
        windowRuntime: {
          "account-a": {
            status: "retry-wait",
            currentTaskId: "old-task",
            currentStage: "归档边界等待释放",
            currentSetStartedAt: 200,
            updatedAt: 400
          }
        }
      }
    }, "2026-08-09T12:01:00.000Z");
    assert.equal(readRuntimeState(file).control.windowRuntime["account-a"].status, "completed");

    await writeRuntimeStateAsync(file, {
      control: {
        windowRuntime: {
          "account-a": {
            status: "running",
            currentTaskId: "new-task",
            currentSetStartedAt: 500,
            updatedAt: 500
          }
        }
      }
    }, "2026-08-09T12:02:00.000Z");
    assert.equal(readRuntimeState(file).control.windowRuntime["account-a"].status, "running");
    assert.equal(readRuntimeState(file).control.windowRuntime["account-a"].currentTaskId, "new-task");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("已完成窗口允许有新阶段证据但复用旧开始时间的恢复任务接管", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-gpt-runtime-stage-evidence-"));
  const file = path.join(root, "runtime.json");
  try {
    await writeRuntimeStateAsync(file, {
      control: {
        windowRuntime: {
          "account-a": {
            status: "completed",
            currentTaskId: "",
            currentPercent: 100,
            updatedAt: 1_000
          }
        }
      }
    }, "2026-08-09T12:00:00.000Z");
    await writeRuntimeStateAsync(file, {
      control: {
        windowRuntime: {
          "account-a": {
            status: "waiting-schedule",
            currentTaskId: "recovered-task",
            // A resumed task can retain an old set-start timestamp. Its new
            // stage timestamp is the reliable evidence that it owns the
            // post-completion runtime slot.
            currentSetStartedAt: 500,
            stageStartedAt: "2026-08-09T12:02:00.000Z",
            lastProgressAt: "2026-08-09T12:02:00.000Z",
            updatedAt: 2_000
          }
        }
      }
    }, "2026-08-09T12:02:00.000Z");
    const state = readRuntimeState(file);
    assert.equal(state.control.windowRuntime["account-a"].status, "waiting-schedule");
    assert.equal(state.control.windowRuntime["account-a"].currentTaskId, "recovered-task");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("不存在的运行状态文件使用纪元时间，不能覆盖浏览器里的现有队列", () => {
  const missing = readRuntimeState(path.join(os.tmpdir(), `missing-${Date.now()}.json`));
  assert.equal(missing.revision, 0);
  assert.equal(missing.updatedAt, "1970-01-01T00:00:00.000Z");
});

test("协调时选择更新时间更晚的状态并用版本号打破平局", () => {
  const older = { updatedAt: "2026-08-09T12:00:00.000Z", revision: 8, queue: null };
  const newer = { updatedAt: "2026-08-09T12:01:00.000Z", revision: 1, queue: { tasks: [{ requestId: "b" }] } };
  assert.equal(newerRuntimeState(older, newer).queue.tasks[0].requestId, "b");
  assert.equal(newerRuntimeState({ ...older, revision: 9 }, older).revision, 9);
});

test("运行真源同时保存生产控制面且过滤无关字段", () => {
  const state = normalizeRuntimeState({
    updatedAt: "2026-08-10T00:00:00.000Z",
    queue: { tasks: [{ requestId: "a" }] },
    control: {
      armed: true,
      settings: { mode: "rotate", generationLimit: 45, secret: "drop-me" },
      modeProfiles: { rotate: { name: "多账号全自动", confirmText: "1", steps: [] } },
      multiRun: { status: "waiting-quota", activeAccountId: "account-2" },
      windowRuntime: { "account-2": { status: "quota-wait", generatedImages: 45 } },
      injected: "drop-me"
    }
  });

  assert.equal(state.version, 3);
  assert.equal(state.control.armed, true);
  assert.equal(state.control.settings.mode, "rotate");
  assert.equal(state.control.settings.generationLimit, 45);
  assert.equal(state.control.settings.secret, undefined);
  assert.equal(state.control.multiRun.status, "waiting-quota");
  assert.equal(state.control.windowRuntime["account-2"].generatedImages, 45);
  assert.equal(state.control.injected, undefined);
});

test("空控制面保持为空且旧版队列仍可读取", () => {
  const state = normalizeRuntimeState({
    version: 2,
    savedAt: "2026-08-09T12:00:00.000Z",
    queue: { mode: "single", tasks: [{ requestId: "legacy" }] }
  });

  assert.equal(state.queue.tasks[0].requestId, "legacy");
  assert.equal(state.control, null);
});
