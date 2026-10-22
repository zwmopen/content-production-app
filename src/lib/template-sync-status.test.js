"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { projectTemplateSyncStatus } = require("./template-sync-status");

const nowMs = Date.parse("2026-10-23T00:00:00.000Z");
const targetUrl = "https://chatgpt.com/c/template-session-79";

function validInput(overrides = {}) {
  return {
    accountId: "account-6",
    profile: {
      id: "account-6",
      selectedTemplateId: "T79",
      templateConversationUrl: targetUrl,
      disabled: false
    },
    requestedTemplateId: "T79",
    requestedTargetUrl: targetUrl,
    currentUrl: targetUrl,
    accountAvailable: true,
    slotEnabled: true,
    writerIdle: true,
    identity: {
      accountId: "account-6", authChecked: true, authLoggedIn: true,
      authEmail: "private@example.com", authName: "Private Name", authPlan: "plus"
    },
    identityCheckedAt: new Date(nowMs - 10_000).toISOString(),
    checkedAt: new Date(nowMs).toISOString(),
    page: {
      url: targetUrl,
      readyState: "complete",
      extensionReady: true,
      authenticationRequired: false,
      chatConversation: true,
      composerReady: true,
      composerEmpty: true,
      attachmentsClear: true,
      generating: false
    },
    nowMs,
    ...overrides
  };
}

test("read-only template status verifies one account, target conversation, fresh identity and idle page", () => {
  const status = projectTemplateSyncStatus(validInput());
  assert.equal(status.status, "VERIFIED");
  assert.equal(status.ready, true);
  assert.equal(status.accountId, "account-6");
  assert.equal(status.templateId, "T79");
  assert.equal(status.targetMatches, true);
  assert.equal(status.identityVerified, true);
  assert.equal(status.accountIdle, true);
  assert.equal(status.pageIdle, true);
  for (const field of ["email", "authEmail", "name", "authName", "plan", "authPlan", "url", "currentUrl", "targetUrl"]) {
    assert.equal(Object.hasOwn(status, field), false, `${field} must not be exposed`);
  }
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /private@example\.com|Private Name|plus|template-session-79/);
});

test("status is pending on account, selection, identity, target, page or writer mismatch", () => {
  const cases = [
    [{ accountId: "account-5" }, "TEMPLATE_SYNC_TARGET_MISMATCH"],
    [{ profile: { ...validInput().profile, id: "account-5" } }, "TEMPLATE_SYNC_TARGET_MISMATCH"],
    [{ requestedTemplateId: "T80" }, "TEMPLATE_SYNC_TARGET_MISMATCH"],
    [{ requestedTargetUrl: "https://chatgpt.com/c/another-session" }, "TEMPLATE_SYNC_TARGET_MISMATCH"],
    [{ currentUrl: "https://chatgpt.com/c/another-session" }, "TEMPLATE_SYNC_TARGET_MISMATCH"],
    [{ identity: { ...validInput().identity, accountId: "account-5" } }, "TEMPLATE_SYNC_IDENTITY_UNVERIFIED"],
    [{ identity: { ...validInput().identity, authLoggedIn: false } }, "TEMPLATE_SYNC_IDENTITY_UNVERIFIED"],
    [{ identityCheckedAt: new Date(nowMs - 300_001).toISOString() }, "TEMPLATE_SYNC_IDENTITY_UNVERIFIED"],
    [{ slotEnabled: false }, "TEMPLATE_SYNC_SLOT_DISABLED"],
    [{ writerIdle: false }, "TEMPLATE_SYNC_ACCOUNT_BUSY"],
    [{ accountAvailable: false }, "TEMPLATE_SYNC_ACCOUNT_UNAVAILABLE"],
    [{ page: { ...validInput().page, chatConversation: false } }, "TEMPLATE_SYNC_TARGET_MISMATCH"],
    [{ page: { ...validInput().page, generating: true } }, "TEMPLATE_SYNC_PAGE_BUSY"],
    [{ page: { ...validInput().page, composerEmpty: false } }, "TEMPLATE_SYNC_PAGE_BUSY"],
    [{ page: { ...validInput().page, attachmentsClear: false } }, "TEMPLATE_SYNC_PAGE_BUSY"],
    [{ page: { ...validInput().page, composerReady: false } }, "TEMPLATE_SYNC_PAGE_NOT_READY"],
    [{ page: { ...validInput().page, extensionReady: false } }, "TEMPLATE_SYNC_PAGE_NOT_READY"]
  ];
  for (const [override, reasonCode] of cases) {
    const status = projectTemplateSyncStatus(validInput(override));
    assert.equal(status.status, "PENDING");
    assert.equal(status.ready, false);
    assert.equal(status.reasonCode, reasonCode);
  }
});

test("unknown account and non-conversation URLs never verify", () => {
  const missing = projectTemplateSyncStatus(validInput({ accountId: "" }));
  assert.equal(missing.reasonCode, "TEMPLATE_SYNC_ACCOUNT_REQUIRED");
  assert.equal(missing.ready, false);
  const share = projectTemplateSyncStatus(validInput({
    profile: { ...validInput().profile, templateConversationUrl: "https://chatgpt.com/share/abc" },
    requestedTargetUrl: "https://chatgpt.com/share/abc",
    currentUrl: "https://chatgpt.com/share/abc"
  }));
  assert.equal(share.targetMatches, false);
  assert.equal(share.ready, false);
});
