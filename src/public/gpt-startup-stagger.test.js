"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const stagger = require("./gpt-startup-stagger.js");

test("startup stagger opens the first lane immediately and delays each next launch", () => {
  const state = stagger.create(["account-1", "account-2", "account-3"], {
    bootAt: 1000,
    minDelayMs: 300_000,
    maxDelayMs: 600_000,
    maxWaitMs: 630_000,
    random: () => 0
  });
  assert.equal(stagger.gate(state, "account-1", { now: 1000 }).allowed, true);
  assert.equal(stagger.gate(state, "account-2", { now: 1000 }).reason, "waiting-previous-window-launch");
  stagger.markLaunched(state, "account-1", 1000);
  assert.equal(stagger.gate(state, "account-2", { now: 300_999 }).allowed, false);
  assert.equal(stagger.gate(state, "account-2", { now: 301_000 }).reason, "startup-stagger-delay-elapsed");
  stagger.markLaunched(state, "account-2", 301_000);
  assert.equal(stagger.gate(state, "account-3", { now: 1000 }).allowed, false);
});

test("manual hold of one startup lane does not block the following lane", () => {
  const state = stagger.create(["account-1", "account-2"], { bootAt: 1000, maxWaitMs: 90_000 });
  const result = stagger.gate(state, "account-2", { now: 2000, heldIds: ["account-1"] });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "previous-window-user-held");
});

test("startup stagger has a bounded fallback and never blocks forever", () => {
  const state = stagger.create(["account-1", "account-2"], { bootAt: 1000, maxWaitMs: 630_000 });
  const result = stagger.gate(state, "account-2", { now: 631_000 });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "startup-stagger-timeout");
  assert.equal(stagger.gate(state, "account-2", { now: 631_001 }).allowed, true);
});

test("startup stagger picks a stable per-link delay inside the five-to-ten minute range", () => {
  const state = stagger.create(["account-1", "account-2"], {
    bootAt: 1000,
    minDelayMs: 300_000,
    maxDelayMs: 600_000,
    random: () => 0.5
  });
  stagger.markLaunched(state, "account-1", 1000);
  assert.equal(stagger.diagnostics(state).delayMs["account-1"], 450_000);
  assert.equal(stagger.gate(state, "account-2", { now: 451_000 }).allowed, true);
});

test("a pre-work-window timeout is reset before the next window if no lane launched", () => {
  const state = stagger.create(["account-1", "account-2"], {
    bootAt: 1000,
    maxWaitMs: 630_000
  });
  assert.equal(stagger.gate(state, "account-2", { now: 631_000 }).reason, "startup-stagger-timeout");
  assert.deepEqual(stagger.diagnostics(state).released, ["account-1"]);
  assert.equal(stagger.resetForWorkWindow(state, "2026-08-23:07:00-02:00", { bootAt: 2_000_000 }), true);
  assert.deepEqual(stagger.diagnostics(state).released, []);
  assert.equal(stagger.gate(state, "account-1", { now: 2_000_000 }).allowed, true);
  assert.equal(stagger.gate(state, "account-2", { now: 2_000_000 }).reason, "waiting-previous-window-launch");
});

test("a real launch keeps the current stagger rhythm across a work-window boundary", () => {
  const state = stagger.create(["account-1", "account-2"], {
    bootAt: 1000,
    random: () => 0
  });
  stagger.markLaunched(state, "account-1", 1000);
  assert.equal(stagger.resetForWorkWindow(state, "2026-08-23:07:00-02:00", { bootAt: 2_000_000 }), false);
  assert.equal(stagger.diagnostics(state).launchAt["account-1"], 1000);
});

test("startup order follows the current tab order and appends late accounts", () => {
  const state = stagger.create(["account-1", "account-2", "account-3"], { bootAt: 1000 });
  stagger.syncOrder(state, ["account-3", "account-1", "account-4"]);
  assert.deepEqual(state.order, ["account-3", "account-1", "account-4"]);
});
