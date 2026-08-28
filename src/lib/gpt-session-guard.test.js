const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isChatGptConversationUrl,
  normalizeChatConversationUrl,
  resolveLastConversationUrl,
  resolveGptStartupUrl,
  isGptPageProductionReady
} = require("./gpt-session-guard");

test("conversation URLs are distinguished from the ChatGPT home page", () => {
  assert.equal(isChatGptConversationUrl("https://chatgpt.com/"), false);
  assert.equal(isChatGptConversationUrl("https://chatgpt.com/c/abc-123"), true);
  assert.equal(isChatGptConversationUrl("https://chatgpt.com/g/gpt/c/abc-123"), true);
  assert.equal(isChatGptConversationUrl("https://example.com/c/abc-123"), false);
});

test("a stale home-page URL does not erase the last conversation checkpoint", () => {
  const profile = {
    lastBrowserUrl: "https://chatgpt.com/",
    lastUrl: "https://chatgpt.com/c/abc-123?oai-dm=1"
  };

  assert.equal(resolveLastConversationUrl(profile), "https://chatgpt.com/c/abc-123");
  assert.equal(resolveGptStartupUrl(profile), "https://chatgpt.com/c/abc-123");
  assert.equal(normalizeChatConversationUrl("https://chatgpt.com/c/abc-123/#reply"), "https://chatgpt.com/c/abc-123");
});

test("a deliberate external browser page remains the startup location", () => {
  const profile = {
    lastBrowserUrl: "https://example.com/",
    lastConversationUrl: "https://chatgpt.com/c/abc-123"
  };

  assert.equal(resolveGptStartupUrl(profile), "https://example.com/");
});

test("production readiness requires the actual composer and extension", () => {
  const base = {
    readyState: "complete",
    extensionReady: true,
    composerReady: true,
    chatConversation: true,
    authenticationRequired: false
  };
  assert.equal(isGptPageProductionReady(base), true);
  assert.equal(isGptPageProductionReady({ ...base, composerReady: false }), false);
  assert.equal(isGptPageProductionReady({ ...base, extensionReady: false }), false);
  assert.equal(isGptPageProductionReady({ ...base, authenticationRequired: true }), false);
});
