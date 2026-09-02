"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_NATIVE_UPLOAD_BATCH_SIZE,
  matchNativeUploadNames,
  selectMissingNativeUploadFiles,
  splitNativeUploadBatches,
  summarizeNativeUploadBoundary
} = require("./gpt-native-upload");

test("native GPT uploads use the known-safe ten-file batch boundary", () => {
  const files = Array.from({ length: 20 }, (_, index) => `file-${index + 1}`);
  assert.deepEqual(splitNativeUploadBatches(files), [
    Array.from({ length: 10 }, (_, index) => `file-${index + 1}`),
    Array.from({ length: 10 }, (_, index) => `file-${index + 11}`)
  ]);
  assert.equal(DEFAULT_NATIVE_UPLOAD_BATCH_SIZE, 10);
});

test("native upload batching preserves order and never exceeds ten files", () => {
  const files = Array.from({ length: 23 }, (_, index) => `file-${index + 1}`);
  const batches = splitNativeUploadBatches(files, 99);
  assert.deepEqual(batches.flat(), files);
  assert.ok(batches.every((batch) => batch.length <= 10));
});

test("ten-file and twenty-file upload boundaries confirm at their batch targets", () => {
  const expected = Array.from({ length: 20 }, (_, index) => `${index + 1}.jpg`);
  const firstBatch = summarizeNativeUploadBoundary(
    expected,
    { observedNames: expected.slice(0, 10), visibleCount: 10 },
    { targetCount: 10, allowAnonymous: true }
  );
  const secondBatch = summarizeNativeUploadBoundary(
    expected,
    { observedNames: expected, visibleCount: 20 },
    { targetCount: 20 }
  );
  assert.equal(firstBatch.uploadConfirmed, true);
  assert.equal(secondBatch.uploadConfirmed, true);
  assert.equal(secondBatch.matchedNames.length, 20);
});

test("native upload recovery only selects files missing from the current composer", () => {
  const files = ["D:\\素材\\1.jpg", "D:\\素材\\2.jpg", "D:\\素材\\文案.txt"];
  assert.deepEqual(selectMissingNativeUploadFiles(files, ["1.jpg", "2.jpg"]), ["D:\\素材\\文案.txt"]);
});

test("native upload boundary matches ChatGPT attachment tile aria labels exactly", () => {
  assert.deepEqual(
    matchNativeUploadNames(
      ["D:\\素材\\1.jpg", "D:\\素材\\10.jpg", "D:\\素材\\文案.txt"],
      ["1.jpg", "10.jpg", "移除文件3：文案.txt", "11.jpg"]
    ),
    ["D:\\素材\\1.jpg", "D:\\素材\\10.jpg", "D:\\素材\\文案.txt"]
  );
});

test("anonymous attachment cards are accepted only when the count reaches the batch target", () => {
  const boundary = summarizeNativeUploadBoundary(
    ["1.jpg", "2.jpg", "3.jpg"],
    { observedNames: ["attachment", "attachment", "attachment"], visibleCount: 3 },
    { targetCount: 3, allowAnonymous: true }
  );
  assert.equal(boundary.anonymousCount, 3);
  assert.equal(boundary.ownershipConfirmed, false);
  assert.equal(boundary.uploadConfirmed, true);
});

test("an anonymous pre-existing composer boundary blocks a fresh upload", () => {
  const boundary = summarizeNativeUploadBoundary(
    ["1.jpg", "2.jpg"],
    { observedNames: ["attachment"], visibleCount: 1 }
  );
  assert.equal(boundary.anonymousCount, 1);
  assert.equal(boundary.ownershipConfirmed, false);
  assert.equal(boundary.uploadConfirmed, false);
});

test("a named attachment outside the task is never treated as anonymous", () => {
  const boundary = summarizeNativeUploadBoundary(
    ["1.jpg", "2.jpg"],
    { observedNames: ["old.jpg"], visibleCount: 1 },
    { targetCount: 2, allowAnonymous: true }
  );
  assert.deepEqual(boundary.unknownNames, ["old.jpg"]);
  assert.equal(boundary.uploadConfirmed, false);
});
