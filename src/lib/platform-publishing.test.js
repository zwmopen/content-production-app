"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  aiToEarnTaskState,
  getPlatformCatalog,
  normalizePlatformId,
  publicPublishPackage,
  validatePublishPackage
} = require("./platform-publishing");

test("AiToEarn unknown task states stay pending without completion evidence", () => {
  assert.equal(aiToEarnTaskState({ status: 1 }), "running");
  assert.equal(aiToEarnTaskState({ status: 1, platformWorkId: "work-1" }), "succeeded");
  assert.equal(aiToEarnTaskState({ status: 8 }), "waiting-user-action");
  assert.equal(aiToEarnTaskState({ status: 5 }), "failed");
});

test("platform catalog covers the requested matrix without exposing adapter headers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-platform-publishing-"));
  const configPath = path.join(root, "platform-publishing.json");
  fs.writeFileSync(configPath, JSON.stringify({
    adapters: {
      xiaohongshu: {
        endpoint: "http://127.0.0.1:18901/publish",
        headers: { Authorization: "Bearer secret-value" }
      }
    }
  }), "utf8");
  const catalog = getPlatformCatalog({ configPath });
  assert.deepEqual(catalog.map((item) => item.id), ["wechat", "xiaohongshu", "douyin", "x", "ctrip"]);
  assert.equal(catalog.find((item) => item.id === "xiaohongshu").status, "configured");
  assert.equal(catalog.find((item) => item.id === "douyin").statusLabel, "可手动发布");
  assert.equal(catalog.find((item) => item.id === "douyin").manualHandoff, true);
  assert.equal(catalog.find((item) => item.id === "douyin").handoffUrl, "https://creator.douyin.com/");
  assert.equal(catalog.find((item) => item.id === "x").statusLabel, "可手动发布");
  assert.equal(catalog.find((item) => item.id === "x").manualHandoff, true);
  assert.equal(catalog.find((item) => item.id === "x").handoffUrl, "https://x.com/compose/post");
  assert.equal(catalog.find((item) => item.id === "ctrip").status, "assisted");
  assert.equal(catalog.find((item) => item.id === "ctrip").statusLabel, "可手动发布");
  assert.equal(catalog.find((item) => item.id === "ctrip").engine.id, "ctrip-content-center");
  assert.equal(catalog.find((item) => item.id === "ctrip").handoffUrl, "https://we.ctrip.com/publish/contentManagement");
  assert.doesNotMatch(JSON.stringify(catalog), /secret-value/);
});

test("platform aliases normalize to one adapter id", () => {
  assert.equal(normalizePlatformId("小红书"), "xiaohongshu");
  assert.equal(normalizePlatformId("Twitter"), "x");
  assert.equal(normalizePlatformId("携程旅行"), "ctrip");
});

test("publish package validates allowed assets and exposes only safe package metadata", () => {
  const allowed = new Set(["C:\\work\\one.png"]);
  const packageData = validatePublishPackage({
    platform: "xhs",
    title: "周末团建怎么选",
    body: "给你一份可直接执行的团建清单。",
    images: ["C:\\work\\one.png"],
    sourceCollection: "测试作品集"
  }, {
    isAllowedFile: (file) => allowed.has(file),
    exists: (file) => allowed.has(file)
  });
  assert.deepEqual(publicPublishPackage(packageData), {
    platform: "xiaohongshu",
    title: "周末团建怎么选",
    bodyLength: 15,
    imageCount: 1,
    hasVideo: false,
    sourceCollection: "测试作品集",
    workId: ""
  });
  assert.throws(() => validatePublishPackage({
    platform: "douyin",
    title: "缺少素材",
    body: "正文"
  }), /至少需要一张图片或一个视频/);
});
