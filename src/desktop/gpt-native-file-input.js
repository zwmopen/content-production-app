"use strict";

function normalizeNames(value) {
  if (Array.isArray(value)) return value.map((name) => String(name || ""));
  if (value && Array.isArray(value.names)) return value.names.map((name) => String(name || ""));
  return [];
}

function sameNames(left, right) {
  const actual = [...normalizeNames(left)].sort();
  const expected = [...normalizeNames(right)].sort();
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

async function waitForExpectedFileInputNames(readFileNames, expectedNames, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 1_500));
  const intervalMs = Math.max(1, Number(options.intervalMs ?? 100));
  const startedAt = Date.now();
  let names = [];
  let lastError = "";
  while (true) {
    try {
      const readback = await readFileNames();
      if (readback && typeof readback === "object" && readback.ok === false) {
        return {
          ok: false,
          count: normalizeNames(readback).length,
          names: normalizeNames(readback),
          phase: "before-dispatch",
          error: String(readback.error || "原生附件入口节点已失效")
        };
      }
      names = normalizeNames(readback);
      if (sameNames(names, expectedNames)) {
        return { ok: true, count: names.length, names, phase: "before-dispatch" };
      }
    } catch (error) {
      lastError = String(error?.message || error || "原生附件 FileList 回读失败");
    }
    if (Date.now() - startedAt >= timeoutMs) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return {
    ok: false,
    count: names.length,
    names,
    phase: "before-dispatch",
    error: lastError || "原生附件 FileList 在有限等待内未达到预期数量或文件名"
  };
}

async function setAndDispatchGptFileInputBatch({
  resolveNode,
  setFiles,
  readFileNames,
  dispatch,
  expectedNames,
  timeoutMs = 1_500,
  intervalMs = 100
} = {}) {
  const names = normalizeNames(expectedNames);
  if (!names.length) return { ok: true, count: 0, names: [] };
  if (typeof resolveNode !== "function"
    || typeof setFiles !== "function"
    || typeof readFileNames !== "function"
    || typeof dispatch !== "function") {
    return { ok: false, count: 0, names: [], error: "原生附件回读适配器不完整" };
  }
  let objectId = "";
  try {
    objectId = String(await resolveNode() || "").trim();
    if (!objectId) return { ok: false, count: 0, names: [], error: "GPT 原生附件入口节点无法回读" };
    // Set exactly once. A readback mismatch is a checkpoint boundary, not a
    // reason to upload the same batch again.
    await setFiles(objectId);
    // Confirm the exact FileList before dispatching React's input/change
    // handlers. Those handlers may replace the old DOM node synchronously.
    const readback = await waitForExpectedFileInputNames(
      () => readFileNames(objectId),
      names,
      { timeoutMs, intervalMs }
    );
    if (!readback.ok) {
      return {
        ok: false,
        count: readback.count,
        names: readback.names,
        error: readback.error || "GPT 原生附件回读不匹配"
      };
    }
    const dispatched = await dispatch(objectId);
    if (dispatched && typeof dispatched === "object" && dispatched.ok === false) {
      return {
        ok: false,
        count: readback.count,
        names: readback.names,
        error: String(dispatched.error || "GPT 原生附件事件派发失败")
      };
    }
    // Do not inspect objectId again here. React is allowed to replace the old
    // input after dispatch; the pre-dispatch FileList is the acceptance proof.
    return { ok: true, count: readback.count, names: readback.names };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      names: [],
      error: String(error?.message || error || "GPT 原生附件注入失败")
    };
  }
}

module.exports = {
  normalizeNames,
  sameNames,
  waitForExpectedFileInputNames,
  setAndDispatchGptFileInputBatch
};
