const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/public/app.js"), "utf8");
const receiverSource = source.slice(source.indexOf("function selectedGptTestEntries()"),
  source.indexOf("// Keep queue construction on the same category-aware catalog"));
const normalizeSource = source.slice(source.indexOf("function normalizeGptAttachmentPath("),
  source.indexOf("function attachmentsForSingleMaterial("));
const category = { path: "D:\\materials\\Trips", name: "Trips", loaded: true, items: [
  { id: "one", path: "D:\\materials\\Trips\\One", name: "One", images: [{ path: "original.jpg" }] },
  { id: "two", path: "D:\\materials\\Trips\\Two", name: "Two" }
] };
const clone = (value) => JSON.parse(JSON.stringify(value));
const request = (folderPath = category.items[0].path) => ({
  type: "LOAD_MATERIAL_FOLDER", requestId: "request-42", folderPath,
  folderName: "untrusted display label", images: [{ path: "not-in-the-catalog.jpg" }]
});

function harness(categories = [clone(category)]) {
  const nodes = {
    "#gptTestMaterialFolders": { checked: [] },
    "#gptTestMaterialCount": { textContent: "1 个已选" },
    "#codexSelectedMaterial": { textContent: "previous label" }
  };
  const context = vm.createContext({
    window: {}, dashboard: { materials: { categories } }, nodes,
    worker: { autoRunning: false }, renderCount: 0, persistCount: 0,
    // Any accidental execution fails the test without contacting a service.
    api() { throw new Error("Network forbidden"); },
    fetch() { throw new Error("Network forbidden"); },
    startGptProduction() { throw new Error("Production forbidden"); },
    $(selector) { return nodes[selector]; }
  });
  vm.runInContext(`
    const gptTestSelectedMaterials = new Set(["D:\\\\previous"]);
    const gptTestMaterialEntries = new Map([["D:\\\\previous", { item: { path: "D:\\\\previous" } }]]);
    const gptTestExpandedCategories = new Set();
    const gptTestExpandedMaterials = new Set();
    const gptWindowWorkerPromises = new Map();
    let activeGptAccountId = "account-1";
    let gptAutoRunning = false;
    let gptCurrentManualTask = null;
    let gptSemiAutoPendingTask = null;
    let gptTestQueue = [{ id: "saved-queue" }];
    let gptTestQueueIndex = 1;
    function activeGptWindowWorkerState() { return worker; }
    function renderGptTestMaterials() {
      renderCount++;
      if (failRender) throw new Error("UI failed");
      if (corruptSelection) { corruptSelection = false; gptTestSelectedMaterials.clear(); }
      nodes["#gptTestMaterialFolders"].checked = [...gptTestSelectedMaterials];
      nodes["#gptTestMaterialCount"].textContent = gptTestSelectedMaterials.size + " 个已选";
    }
    function persistActiveGptWindowSelections() {
      worker.selectedMaterials = [...gptTestSelectedMaterials];
      worker.queue = gptTestQueue;
      if (failPersist) throw new Error("Persistence failed");
      persistCount++;
    }
    let failRender = false, failPersist = false, corruptSelection = false;
    ${normalizeSource}
    ${receiverSource}
    function snapshot() {
      return { selected: [...gptTestSelectedMaterials],
        entries: [...gptTestMaterialEntries.keys()], queue: gptTestQueue,
        queueIndex: gptTestQueueIndex, expanded: [...gptTestExpandedCategories],
        expandedMaterials: [...gptTestExpandedMaterials] };
    }
  `, context);
  return {
    context, nodes,
    run: (code) => vm.runInContext(code, context),
    receive: (message) => clone(context.window.receiveContainerHandoff(message)),
    snapshot: () => clone(context.snapshot())
  };
}

function expectRefused(h, message, error) {
  const before = h.snapshot();
  const label = h.nodes["#codexSelectedMaterial"].textContent;
  assert.deepEqual(h.receive(message), {
    ok: false, requestId: typeof message?.requestId === "string" ? message.requestId : "", error
  });
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.nodes["#codexSelectedMaterial"].textContent, label);
  assert.equal(h.context.persistCount, 0);
}

test("executeJavaScript bridge returns success only after exact indexed item selection and UI readback", () => {
  const h = harness();
  const payload = request("d:/MATERIALS/Trips/One/");
  const script = `window.receiveContainerHandoff(${JSON.stringify(payload)})`;
  assert.deepEqual(clone(h.run(script)), { ok: true, requestId: "request-42", stage: "SELECTED_NOT_STARTED" });
  assert.deepEqual(h.snapshot().selected, [category.items[0].path]);
  assert.deepEqual(h.snapshot().entries, [category.items[0].path]);
  assert.deepEqual(h.nodes["#gptTestMaterialFolders"].checked, h.context.worker.selectedMaterials);
  assert.equal(h.nodes["#gptTestMaterialCount"].textContent, "1 个已选");
  assert.equal(h.nodes["#codexSelectedMaterial"].textContent, "One");
  assert.equal(h.context.persistCount, 1);
  assert.equal(h.run("gptTestMaterialEntries.get([...gptTestSelectedMaterials][0]).item === dashboard.materials.categories[0].items[0]"), true);
  assert.equal(h.run("gptAutoRunning"), false);
  assert.deepEqual(h.snapshot().queue, []);
  assert.deepEqual(h.snapshot().expanded, [category.path]);
});

test("exact loaded category selects all existing items without fabricating items from images", () => {
  const h = harness();
  assert.equal(h.receive(request(category.path)).ok, true);
  assert.deepEqual(h.snapshot().selected, category.items.map((item) => item.path));
  assert.equal(h.context.dashboard.materials.categories[0].items.length, 2);
  assert.equal(h.nodes["#gptTestMaterialCount"].textContent, "2 个已选");
});

test("existing renderer emits checked controls for the actual handoff selection", () => {
  const h = harness();
  h.nodes["#gptTestMaterialFolders"].querySelectorAll = () => [];
  const renderer = source.slice(source.indexOf("function renderGptTestMaterials()"),
    source.indexOf(" function renderGptTestTemplates()"));
  h.run(`
    const groupedTagSelections = { material: {} };
    function gptManualUploadLockState() { return { locked: false }; }
    function renderTagFilterBar() {}
    function matchesGroupedTagSelection() { return true; }
    function materialTagGroups(item) { return item.tagGroups || {}; }
    function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
    function shortText(value) { return value; }
    function updateGptTestQueueStatus() {}
    function applyReadOnlyGptPreviewControls() {}
    ${renderer}
  `);
  assert.equal(h.receive(request()).stage, "SELECTED_NOT_STARTED");
  const html = h.nodes["#gptTestMaterialFolders"].innerHTML;
  assert.match(html, /data-gpt-test-material-check="one"[^>]* checked/);
  assert.doesNotMatch(html, /data-gpt-test-material-check="two"[^>]* checked/);
  assert.match(html, /data-indeterminate="true"/);
  assert.equal(h.nodes["#gptTestMaterialCount"].textContent, "1 个已选");
});

test("normalized UNC paths select existing indexed material", () => {
  const unc = clone(category);
  unc.path = "\\\\server\\share\\materials";
  unc.items[0].path = "\\\\server\\share\\materials\\One";
  const h = harness([unc]);
  assert.equal(h.receive(request("//SERVER/share/materials/One/")).ok, true);
  assert.deepEqual(h.snapshot().selected, [unc.items[0].path]);
});

test("unknown paths, same labels and prefix paths cannot fabricate successful selection", () => {
  for (const value of ["D:\\unknown\\One", "D:\\materials\\Trips\\On", "D:\\materials"]) {
    expectRefused(harness(), request(value), "UNKNOWN_MATERIAL_FOLDER");
  }
});

test("unsupported messages and invalid request IDs are refused without mutations", () => {
  for (const message of [null, {}, { ...request(), type: "SELECT_MATERIAL" }, { ...request(), type: "START_PRODUCTION" }]) {
    expectRefused(harness(), message, "UNSUPPORTED_HANDOFF");
  }
  for (const requestId of [undefined, 42, "", " "]) {
    expectRefused(harness(), { ...request(), requestId }, "INVALID_REQUEST_ID");
  }
});

test("non-path payloads, relative paths, traversal, URLs and control characters are refused", () => {
  for (const folderPath of [undefined, {}, "", "One", "D:One", "D:\\materials\\..\\Trips", "file:///D:/materials/Trips", "D:\\materials\u0000\\Trips"]) {
    expectRefused(harness(), { ...request(), folderPath }, "INVALID_FOLDER_PATH");
  }
});

test("duplicate normalized item paths, category paths and category/item collisions are ambiguous", () => {
  const duplicate = clone(category);
  duplicate.items[0].path = "d:/materials/trips/one/";
  for (const [categories, folderPath] of [
    [[clone(category), duplicate], category.items[0].path],
    [[clone(category), duplicate], category.path],
    [[{ ...clone(category), path: category.items[0].path }], category.items[0].path]
  ]) expectRefused(harness(categories), request(folderPath), "AMBIGUOUS_MATERIAL_FOLDER");
  const within = clone(category);
  within.items.push({ ...within.items[0] });
  expectRefused(harness([within]), request(category.path), "AMBIGUOUS_MATERIAL_FOLDER");
});

test("running legacy, paused running, independent worker and pending manual tasks reject selection", () => {
  for (const code of ["gptAutoRunning = true", "worker.autoRunning = true; worker.autoPaused = true",
    "gptWindowWorkerPromises.set(activeGptAccountId, {})", "gptCurrentManualTask = {}", "gptSemiAutoPendingTask = {}"]) {
    const h = harness();
    h.run(code);
    expectRefused(h, request(), "PRODUCTION_RUNNING");
  }
});

test("unloaded, empty and malformed catalog or missing UI refuse selection", () => {
  for (const categories of [null, [null], [{ ...clone(category), items: {} }],
    [{ ...clone(category), loaded: false }], [{ ...clone(category), items: [] }]]) {
    expectRefused(harness(categories), request(category.path), "MATERIALS_NOT_READY");
  }
  const h = harness();
  delete h.nodes["#gptTestMaterialFolders"];
  expectRefused(h, request(), "MATERIAL_UI_NOT_READY");
});

test("category with invalid item paths is refused without changing queue or selection", () => {
  const invalid = clone(category);
  invalid.items[0].path = "";
  expectRefused(harness([invalid]), request(category.path), "INVALID_MATERIAL_ENTRY");
});

test("render, persistence and selection readback failures roll back selection, entries and saved queue", () => {
  for (const code of ["failRender = true", "failPersist = true", "corruptSelection = true"]) {
    const h = harness();
    h.context.worker.selectedMaterials = ["D:\\previous"];
    h.context.worker.queue = [{ id: "saved-worker-queue" }];
    const workerBefore = clone(h.context.worker);
    h.run(code);
    expectRefused(h, request(), "MATERIAL_SELECTION_FAILED");
    assert.deepEqual(clone(h.context.worker), workerBefore);
  }
});

test("repeated handoff stays a selection and never accumulates work or reports dispatched", () => {
  const h = harness();
  const first = h.receive(request());
  const state = h.snapshot();
  assert.deepEqual(h.receive(request()), first);
  assert.deepEqual(h.snapshot(), state);
  assert.equal(h.run("gptAutoRunning"), false);
});

test("Codex start button records honest unstarted instruction with no executor", () => {
  const log = { textContent: "existing log", scrollHeight: 40 };
  let click;
  const button = { addEventListener(type, callback) { assert.equal(type, "click"); click = callback; } };
  const script = source.slice(source.indexOf("  document.getElementById('codexStartProductionBtn')"),
    source.indexOf("  // Cross-App PostMessage receiver"));
  vm.runInNewContext(script, { document: { getElementById(id) {
    return id === "codexStartProductionBtn" ? button : log;
  } } });
  click();
  assert.match(log.textContent, /制作指令已登记，尚未开始生产/);
  assert.match(log.textContent, /未接入执行器/);
  assert.doesNotMatch(log.textContent, /正在调用|任务已分发|成品将自动/);
  assert.equal(log.scrollTop, 40);
});

test("legacy name-only material messages no longer alter labels or claim selection", () => {
  const legacy = source.slice(source.indexOf("    // Legacy name-only SELECT_MATERIAL"),
    source.indexOf("    // Command from master container topbar"));
  let calls = 0;
  const context = vm.createContext({ msg: { type: "SELECT_MATERIAL", folderName: "fake" },
    receiveContainerHandoff() { calls++; } });
  vm.runInContext(legacy, context);
  assert.equal(calls, 0);
  context.msg = request();
  vm.runInContext(legacy, context);
  assert.equal(calls, 1);
});
