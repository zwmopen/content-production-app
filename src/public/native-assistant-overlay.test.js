const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

test("native assistant marker does not hide the whole workbench body", () => {
  const marker = "/* 彻底清除违和小猫与悬浮挂件 */";
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, "assistant decoration rule should remain identifiable");
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1, "assistant decoration rule should be closed");
  const rule = css.slice(start, end + 1);

  assert.match(app, /document\.body\.classList\.add\("native-assistant-overlay"\)/);
  assert.match(rule, /\.workbench-assistant-launcher/);
  assert.match(rule, /#workbenchAssistantLauncher/);
  assert.doesNotMatch(rule, /\.native-assistant-overlay/);
});
