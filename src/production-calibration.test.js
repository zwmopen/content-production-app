const test = require("node:test");
const assert = require("node:assert/strict");
const { productionPageAllowed, productionResumeScope } = require("./server");

test("calibration mode only permits the first page of the first selected work", () => {
  assert.equal(productionPageAllowed("calibration", 0, "P1", "P1"), true);
  assert.equal(productionPageAllowed("calibration", 0, "P2", "P1"), false);
  assert.equal(productionPageAllowed("calibration", 1, "P1", "P1"), false);
  assert.equal(productionPageAllowed("full", 3, "P8", "P1"), true);
});

test("only a confirmed calibration advances to the full remaining batch", () => {
  assert.equal(productionResumeScope({
    status: "calibration-ready",
    options: { runScope: "calibration" }
  }), "full");
  assert.equal(productionResumeScope({
    status: "failed",
    options: { runScope: "calibration" }
  }), "calibration");
  assert.equal(productionResumeScope({
    status: "interrupted",
    options: { runScope: "full" }
  }), "full");
});
