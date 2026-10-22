"use strict";

const { normalizeChatConversationUrl } = require("./gpt-session-guard");

const IDENTITY_MAX_AGE_MS = 5 * 60 * 1000;

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function projectTemplateSyncStatus(input = {}) {
  const accountId = String(input.accountId || "").trim();
  const profile = input.profile && typeof input.profile === "object" ? input.profile : {};
  const requestedTemplateId = String(input.requestedTemplateId || "").trim();
  const selectedTemplateId = String(profile.selectedTemplateId || "").trim();
  const profileTarget = normalizeChatConversationUrl(profile.templateConversationUrl);
  const requestedTarget = normalizeChatConversationUrl(input.requestedTargetUrl);
  const currentTarget = normalizeChatConversationUrl(input.currentUrl);
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const identityCheckedAt = String(input.identityCheckedAt || "");
  const identityCheckedMs = timestamp(identityCheckedAt);
  const identityFresh = identityCheckedMs > 0
    && identityCheckedMs <= nowMs + 60_000
    && nowMs - identityCheckedMs <= IDENTITY_MAX_AGE_MS;
  const identity = input.identity && typeof input.identity === "object" ? input.identity : {};
  const page = input.page && typeof input.page === "object" ? input.page : {};
  const accountAvailable = input.accountAvailable === true;
  const slotEnabled = input.slotEnabled === true;
  const writerIdle = input.writerIdle === true;
  const identityVerified = identity.accountId === accountId
    && identity.authChecked === true
    && identity.authLoggedIn === true
    && identityFresh;
  const targetMatches = Boolean(accountId
    && String(profile.id || "").trim() === accountId
    && requestedTemplateId
    && requestedTemplateId === selectedTemplateId
    && profileTarget
    && requestedTarget === profileTarget
    && currentTarget === profileTarget
    && page.chatConversation === true);
  const pageReady = ["interactive", "complete"].includes(String(page.readyState || ""))
    && page.extensionReady === true
    && page.authenticationRequired !== true;
  const chatConversation = page.chatConversation === true;
  const composerReady = page.composerReady === true;
  const composerEmpty = page.composerEmpty === true;
  const attachmentsClear = page.attachmentsClear === true;
  const generationIdle = page.generating === false;
  const pageIdle = chatConversation && composerReady && composerEmpty && attachmentsClear && generationIdle;
  const accountIdle = accountAvailable && slotEnabled && writerIdle && pageIdle;
  const ready = Boolean(accountId && accountAvailable && slotEnabled && writerIdle
    && identityVerified && targetMatches && pageReady && pageIdle && accountIdle);
  let reasonCode = "";
  if (!accountId) reasonCode = "TEMPLATE_SYNC_ACCOUNT_REQUIRED";
  else if (!String(profile.id || "").trim()) reasonCode = "TEMPLATE_SYNC_PROFILE_MISSING";
  else if (!accountAvailable) reasonCode = "TEMPLATE_SYNC_ACCOUNT_UNAVAILABLE";
  else if (!slotEnabled) reasonCode = "TEMPLATE_SYNC_SLOT_DISABLED";
  else if (!writerIdle) reasonCode = "TEMPLATE_SYNC_ACCOUNT_BUSY";
  else if (!targetMatches) reasonCode = "TEMPLATE_SYNC_TARGET_MISMATCH";
  else if (!identityVerified) reasonCode = "TEMPLATE_SYNC_IDENTITY_UNVERIFIED";
  else if (!pageReady || !chatConversation || !composerReady) reasonCode = "TEMPLATE_SYNC_PAGE_NOT_READY";
  else if (!pageIdle) reasonCode = "TEMPLATE_SYNC_PAGE_BUSY";

  return {
    status: ready ? "VERIFIED" : "PENDING",
    reasonCode,
    accountId,
    templateId: selectedTemplateId,
    checkedAt: String(input.checkedAt || new Date(nowMs).toISOString()),
    identityCheckedAt: identityFresh ? identityCheckedAt : "",
    accountAvailable,
    slotEnabled,
    writerIdle,
    identityVerified: Boolean(identityVerified),
    targetMatches,
    conversationMatches: targetMatches,
    pageReady,
    chatConversation,
    composerReady,
    composerEmpty,
    attachmentsClear,
    generationIdle,
    pageIdle,
    accountIdle,
    ready
  };
}

module.exports = { IDENTITY_MAX_AGE_MS, projectTemplateSyncStatus };
