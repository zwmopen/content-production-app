const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");

test("embedded GPT dark palette covers ChatGPT text and icon tokens", () => {
  for (const token of [
    "textPrimary",
    "textSecondary",
    "textTertiary",
    "iconPrimary",
    "iconSecondary",
    "--text-primary",
    "--text-secondary",
    "--text-tertiary",
    "--icon-primary",
    "--icon-secondary",
    "--theme-user-msg-text",
    "--blue-theme-user-msg-text"
  ]) {
    assert.match(mainSource, new RegExp(token.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")));
  }
  assert.match(mainSource, /setProperty\(name, value, "important"\)/);
  assert.match(mainSource, /const configuredColorScheme =/);
  assert.match(mainSource, /const dark = configuredColorScheme === "dark"/);
  assert.match(mainSource, /root\.style\.setProperty\("color-scheme", dark \? "dark" : "light", "important"\)/);
  assert.match(mainSource, /document\.body\?\.style\.setProperty\("color-scheme", dark \? "dark" : "light", "important"\)/);
});

test("embedded GPT theme is replayed after full and in-page navigation", () => {
  assert.match(mainSource, /function scheduleEmbeddedGptThemeReplay\(account/);
  assert.match(mainSource, /account\.view\.webContents\.on\("did-navigate",[\s\S]*?scheduleEmbeddedGptThemeReplay\(account\)/);
  assert.match(mainSource, /account\.view\.webContents\.on\("did-navigate-in-page",[\s\S]*?scheduleEmbeddedGptThemeReplay\(account/);
  assert.match(mainSource, /await initializeEmbeddedGptPage\(account\);[\s\S]*?scheduleEmbeddedGptThemeReplay\(account, \[180, 700\]\)/);
});
