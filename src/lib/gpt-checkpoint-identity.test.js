const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalConversationUrl,
  findCheckpointByIdentity
} = require("./gpt-checkpoint-identity");

test("canonicalConversationUrl keeps only the durable ChatGPT conversation identity", () => {
  assert.equal(
    canonicalConversationUrl("https://chatgpt.com/c/abc-123?model=gpt-5::material:x"),
    "https://chatgpt.com/c/abc-123"
  );
  assert.equal(canonicalConversationUrl("https://chatgpt.com/"), "");
});

test("findCheckpointByIdentity requires exact conversation material and account", () => {
  const wanted = {
    requestId: "old-request",
    accountId: "account-3",
    conversationUrl: "https://chatgpt.com/c/abc-123",
    sourceMaterialPath: "D:\\素材库\\作品甲",
    updatedAt: "2026-08-24T06:00:00.000Z"
  };
  const items = {
    wrongMaterial: { ...wanted, requestId: "wrong-material", sourceMaterialPath: "D:\\素材库\\作品乙" },
    wrongAccount: { ...wanted, requestId: "wrong-account", accountId: "account-2" },
    wanted
  };
  assert.equal(findCheckpointByIdentity(items, {
    accountId: "account-3",
    conversationUrl: "https://chatgpt.com/c/abc-123?model=gpt-5",
    sourceMaterialPath: "d:/素材库/作品甲/"
  })?.requestId, "old-request");
  assert.equal(findCheckpointByIdentity(items, {
    accountId: "account-3",
    conversationUrl: "https://chatgpt.com/c/abc-123",
    sourceMaterialPath: "D:\\素材库\\作品乙"
  })?.requestId, "wrong-material");
  assert.equal(findCheckpointByIdentity(items, {
    accountId: "account-4",
    conversationUrl: "https://chatgpt.com/c/abc-123",
    sourceMaterialPath: "D:\\素材库\\作品甲"
  }), null);
});

test("findCheckpointByIdentity refuses partial identity matches", () => {
  const items = { one: { conversationUrl: "https://chatgpt.com/c/abc", sourceMaterialPath: "D:\\素材库\\作品甲" } };
  assert.equal(findCheckpointByIdentity(items, { conversationUrl: "https://chatgpt.com/c/abc" }), null);
  assert.equal(findCheckpointByIdentity(items, { sourceMaterialPath: "D:\\素材库\\作品甲" }), null);
});
