function canonicalConversationUrl(value = "") {
  const raw = String(value || "").trim().split("::material:")[0];
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const match = parsed.pathname.match(/^\/c\/([^/?#]+)/i);
    return match ? `${parsed.origin.toLowerCase()}/c/${match[1]}` : "";
  } catch {
    return "";
  }
}

function canonicalMaterialPath(value = "") {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/g, "")
    .toLowerCase();
}

function findCheckpointByIdentity(items = {}, identity = {}) {
  const conversationUrl = canonicalConversationUrl(identity.conversationUrl);
  const sourceMaterialPath = canonicalMaterialPath(identity.sourceMaterialPath || identity.materialPath);
  const accountId = String(identity.accountId || "").trim();
  // A conversation alone is reused by many works and a material alone can be
  // retried by another account. Both durable identities are mandatory.
  if (!conversationUrl || !sourceMaterialPath) return null;
  return Object.values(items || {})
    .filter((checkpoint) => {
      const checkpointAccount = String(checkpoint?.accountId || checkpoint?.accountWindowId || "").trim();
      return canonicalConversationUrl(checkpoint?.conversationUrl) === conversationUrl
        && canonicalMaterialPath(checkpoint?.sourceMaterialPath) === sourceMaterialPath
        && (!accountId || checkpointAccount === accountId);
    })
    .sort((left, right) => (Date.parse(String(right?.updatedAt || "")) || 0)
      - (Date.parse(String(left?.updatedAt || "")) || 0))[0] || null;
}

module.exports = {
  canonicalConversationUrl,
  canonicalMaterialPath,
  findCheckpointByIdentity
};
