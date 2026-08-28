const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  largeUploadErrorMessage,
  readSecureConfig,
  saveSecureConfig
} = require("./webdav-backup");

test("DPAPI secure config round-trips Chinese paths without console encoding damage", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-webdav-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, "webdav.dpapi.json");
  const expected = {
    url: "https://dav.jianguoyun.com/dav/",
    username: "example@example.com",
    password: "app-password",
    basePath: "/团建工作台备份",
    importedFrom: "团建工作台本机安全设置"
  };
  saveSecureConfig(configFile, expected);
  assert.deepEqual(readSecureConfig(configFile), expected);
  const stored = fs.readFileSync(configFile, "utf8");
  assert.ok(!stored.includes(expected.password));
  assert.ok(!stored.includes(expected.username));
});

test("large WebDAV upload errors explain provider quota and keep retry context", () => {
  assert.match(largeUploadErrorMessage(403), /流量\/空间额度/);
  assert.match(largeUploadErrorMessage(403), /继续/);
  assert.match(largeUploadErrorMessage(507), /空间不足/);
  assert.equal(largeUploadErrorMessage(500), "坚果云大文件上传失败（500）");
});
