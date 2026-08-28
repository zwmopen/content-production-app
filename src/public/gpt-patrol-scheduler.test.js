"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const schedulerPath = path.join(__dirname, "gpt-patrol-scheduler.js");
const scheduler = fs.existsSync(schedulerPath) ? require(schedulerPath) : {};

test("patrol scheduler rotates only automatically eligible template or master conversations", () => {
  assert.equal(typeof scheduler.orderedEligibleConversations, "function");
  const conversations = [
    { url: "https://chatgpt.com/c/daily", titleMatched: false, eligible: false },
    { url: "https://chatgpt.com/c/template-a", titleMatched: true, eligible: true, excluded: false },
    { url: "https://chatgpt.com/c/game", titleMatched: true, eligible: false, excluded: true },
    { url: "https://chatgpt.com/c/master-b", titleMatched: true, eligible: true, excluded: false }
  ];
  assert.deepEqual(
    scheduler.orderedEligibleConversations(conversations, 1).map((item) => item.url),
    ["https://chatgpt.com/c/master-b", "https://chatgpt.com/c/template-a"]
  );
});

test("patrol scheduler releases only archived or genuinely empty conversations for a new material", () => {
  assert.equal(typeof scheduler.patrolProbeAvailability, "function");
  assert.equal(scheduler.patrolProbeAvailability({ snapshot: { stage: "archived", canInjectNext: true } }).available, true);
  assert.equal(scheduler.patrolProbeAvailability({ snapshot: { stage: "unknown", canInjectNext: true } }).available, true);
  assert.equal(scheduler.patrolProbeAvailability({ acted: true, action: "send-confirm", snapshot: { stage: "plan-ready" } }).available, false);
  assert.equal(scheduler.patrolProbeAvailability({ snapshot: { stage: "waiting-images", canInjectNext: false } }).available, false);
  assert.equal(scheduler.patrolProbeAvailability({ snapshot: { stage: "completed-copy-pending-package", canInjectNext: false } }).available, false);
});

test("patrol scheduler advances its cursor after assigning a conversation", () => {
  assert.equal(typeof scheduler.nextPatrolCursor, "function");
  assert.equal(scheduler.nextPatrolCursor(0, 3), 1);
  assert.equal(scheduler.nextPatrolCursor(2, 3), 0);
  assert.equal(scheduler.nextPatrolCursor(9, 0), 0);
});
