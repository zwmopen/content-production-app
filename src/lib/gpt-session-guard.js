const CHATGPT_HOSTS = new Set(["chatgpt.com", "www.chatgpt.com", "chat.openai.com"]);

function parseChatUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || !CHATGPT_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isChatGptConversationUrl(value) {
  const parsed = parseChatUrl(value);
  if (!parsed) return false;
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return /^\/c\/[a-z0-9_-]+(?:\/[^/]*)?$/i.test(pathname)
    || /^\/g\/[a-z0-9_-]+\/c\/[a-z0-9_-]+(?:\/[^/]*)?$/i.test(pathname)
    || pathname === "/"
    || pathname === "";
}

function normalizeChatConversationUrl(value) {
  if (!isChatGptConversationUrl(value)) return "";
  const parsed = parseChatUrl(value);
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  parsed.pathname = pathname;
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

function resolveLastConversationUrl(profile = {}) {
  return normalizeChatConversationUrl(profile.lastConversationUrl)
    || normalizeChatConversationUrl(profile.lastUrl);
}

function resolveGptStartupUrl(profile = {}, fallback = "https://chatgpt.com/") {
  const liveUrl = String(profile.lastBrowserUrl || "").trim();
  const savedConversation = resolveLastConversationUrl(profile);
  const parsedLive = parseChatUrl(liveUrl);
  const liveIsChatHome = Boolean(parsedLive
    && ((parsedLive.pathname || "/").replace(/\/+$/, "") || "/") === "/");
  // A stalled/reloaded ChatGPT home page is not a useful recovery location
  // when the account already has a known conversation checkpoint.
  if (savedConversation && (!liveUrl || liveIsChatHome)) return savedConversation;
  return liveUrl || savedConversation || fallback;
}

function isGptPageProductionReady(state = {}) {
  return ["interactive", "complete"].includes(String(state.readyState || ""))
    && state.extensionReady === true
    && state.composerReady === true
    && state.chatConversation === true
    && state.authenticationRequired !== true;
}

module.exports = {
  isChatGptConversationUrl,
  normalizeChatConversationUrl,
  resolveLastConversationUrl,
  resolveGptStartupUrl,
  isGptPageProductionReady
};
