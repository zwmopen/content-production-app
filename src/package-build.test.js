const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const packageFile = path.join(__dirname, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));

test("便携版打包清单包含服务端路由并与当前版本目录一致", () => {
  assert.ok(packageJson.build.files.includes("server/**/*"));
  assert.equal(packageJson.build.directories.output, `../releases/${packageJson.version}`);
  assert.ok(fs.existsSync(path.join(__dirname, "server", "routes", "juguang.js")));
});

test("源码包提供配套软件的可重建入口和依赖清单", () => {
  const projectRoot = path.join(__dirname, "..");
  const rebuildDoc = fs.readFileSync(path.join(projectRoot, "docs", "REBUILD.md"), "utf8");

  assert.ok(fs.existsSync(path.join(projectRoot, "scripts", "setup-rebuild.ps1")));
  assert.ok(fs.existsSync(path.join(__dirname, "package-lock.json")));
  assert.ok(fs.existsSync(path.join(__dirname, "requirements-moments.txt")));
  assert.match(rebuildDoc, /npm ci/);
  assert.match(rebuildDoc, /npm run dist:portable/);
  assert.match(rebuildDoc, /WeFlow/);
});
