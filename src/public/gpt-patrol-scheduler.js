(function initGptPatrolScheduler(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TBGptPatrolScheduler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function eligibleConversations(conversations = []) {
    return (Array.isArray(conversations) ? conversations : []).filter((item) => (
      Boolean(item?.titleMatched) && Boolean(item?.eligible) && !item?.excluded && Boolean(String(item?.url || "").trim())
    ));
  }

  function orderedEligibleConversations(conversations = [], cursor = 0) {
    const eligible = eligibleConversations(conversations);
    if (!eligible.length) return [];
    const start = ((Math.trunc(Number(cursor) || 0) % eligible.length) + eligible.length) % eligible.length;
    return eligible.slice(start).concat(eligible.slice(0, start));
  }

  function patrolProbeAvailability(result = {}) {
    const snapshot = result?.snapshot || {};
    const stage = String(snapshot.stage || "");
    const available = !result?.acted
      && Boolean(snapshot.canInjectNext)
      && (stage === "archived" || stage === "unknown");
    return {
      available,
      stage,
      reason: available ? "ready-for-material" : String(result?.reason || snapshot?.patrolState?.key || "conversation-busy")
    };
  }

  function nextPatrolCursor(cursor = 0, count = 0) {
    const total = Math.max(0, Math.trunc(Number(count) || 0));
    if (!total) return 0;
    return (((Math.trunc(Number(cursor) || 0) + 1) % total) + total) % total;
  }

  return {
    eligibleConversations,
    orderedEligibleConversations,
    patrolProbeAvailability,
    nextPatrolCursor
  };
});
