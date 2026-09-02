"use strict";

// ChatGPT has historically accepted more than four files in one composer.
// Four was an accidental local guard, not an account quota. Keep the native
// selection below the known-safe ten-file boundary and let the boundary check
// decide whether the page actually appended the selection.
const DEFAULT_NATIVE_UPLOAD_BATCH_SIZE = 10;

const NATIVE_UPLOAD_FILENAME_RE = /^[^\\/:*?"<>|]+\.[a-z0-9]{1,12}$/i;

function stripNativeUploadLabel(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .split(/[:：]/)
    .at(-1)
    .replace(/^(?:(?:remove|delete)\s+(?:attachment|file)|attachment|file)\s*/i, "")
    .replace(/^(?:移除(?:附件|文件)|删除(?:附件|文件))\s*(?:#?\d+\s*)?/i, "")
    .trim();
}

function normalizeNativeUploadName(value) {
  const source = stripNativeUploadLabel(value);
  return source.slice(source.lastIndexOf("\\") + 1).toLowerCase();
}

function isNativeUploadFilename(value) {
  return NATIVE_UPLOAD_FILENAME_RE.test(normalizeNativeUploadName(value));
}

function splitNativeUploadBatches(files, batchSize = DEFAULT_NATIVE_UPLOAD_BATCH_SIZE) {
  const source = Array.isArray(files) ? files : [];
  const size = Math.max(
    1,
    Math.min(DEFAULT_NATIVE_UPLOAD_BATCH_SIZE, Number(batchSize) || DEFAULT_NATIVE_UPLOAD_BATCH_SIZE)
  );
  const batches = [];
  for (let offset = 0; offset < source.length; offset += size) {
    batches.push(source.slice(offset, offset + size));
  }
  return batches;
}

function selectMissingNativeUploadFiles(files, presentNames = []) {
  const present = new Set(
    (Array.isArray(presentNames) ? presentNames : [])
      .map(normalizeNativeUploadName)
      .filter(Boolean)
  );
  return (Array.isArray(files) ? files : [])
    .filter((file) => !present.has(normalizeNativeUploadName(file)));
}

function summarizeNativeUploadBoundary(expectedNames = [], snapshot = {}, options = {}) {
  const expected = [...new Set((Array.isArray(expectedNames) ? expectedNames : [])
    .map(normalizeNativeUploadName)
    .filter(Boolean))];
  const observedNames = [...new Set((Array.isArray(snapshot.observedNames) ? snapshot.observedNames : [])
    .filter(isNativeUploadFilename)
    .map(normalizeNativeUploadName)
    .filter(Boolean))];
  const expectedSet = new Set(expected);
  const matchedNames = expected
    .filter((name) => observedNames.includes(name));
  const unknownNames = observedNames.filter((name) => !expectedSet.has(name));
  const visibleCount = Math.max(
    0,
    Number(snapshot.visibleCount || 0),
    observedNames.length
  );
  const anonymousCount = Math.max(
    0,
    visibleCount - matchedNames.length - unknownNames.length
  );
  const namesConfirmed = expected.length === 0
    || expected.every((name) => matchedNames.includes(name));
  const ownershipConfirmed = visibleCount === 0
    || (unknownNames.length === 0 && anonymousCount === 0);
  const targetCount = Math.max(0, Number(options.targetCount || 0));
  const countConfirmed = targetCount > 0 && visibleCount >= targetCount;
  const uploadConfirmed = countConfirmed
    && unknownNames.length === 0
    && (namesConfirmed || options.allowAnonymous === true);
  return {
    observedNames,
    matchedNames,
    unknownNames,
    unknownNamedCount: unknownNames.length,
    visibleCount,
    anonymousCount,
    hasNamedEvidence: observedNames.length > 0,
    namesConfirmed,
    ownershipConfirmed,
    countConfirmed,
    uploadConfirmed
  };
}

function matchNativeUploadNames(expectedNames = [], observedNames = []) {
  const observed = new Set(
    (Array.isArray(observedNames) ? observedNames : [])
      .map(normalizeNativeUploadName)
      .filter(Boolean)
  );
  return [...new Set(Array.isArray(expectedNames) ? expectedNames : [])]
    .filter((name) => observed.has(normalizeNativeUploadName(name)));
}

module.exports = {
  DEFAULT_NATIVE_UPLOAD_BATCH_SIZE,
  isNativeUploadFilename,
  matchNativeUploadNames,
  normalizeNativeUploadName,
  selectMissingNativeUploadFiles,
  splitNativeUploadBatches,
  summarizeNativeUploadBoundary
};
