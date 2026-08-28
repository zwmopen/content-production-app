(function exposeGptProgressDisplay(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GptProgressDisplay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGptProgressDisplay() {
  const DEFAULT_RETENTION_MS = 15_000;

  function clampPercent(value, fallback = 0) {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(0, Math.min(100, Math.round(safe)));
  }

  function firstText(...values) {
    return values
      .map((value) => String(value || "").trim())
      .find(Boolean) || "";
  }

  function resolveProgressIdentity(input = {}) {
    return firstText(
      input.requestId,
      input.taskId,
      input.materialPath,
      input.material,
      input.name,
      "gpt-progress:unknown"
    );
  }

  function resolveTaskIdentity(task = {}) {
    return firstText(
      task?.requestId,
      task?.id,
      task?.entry?.externalRequestId,
      task?.materialPath,
      task?.entry?.materialPath,
      task?.name,
      task?.entry?.name
    );
  }

  // A persisted worker can expose the same task twice as two object
  // instances: once in queue.tasks and once as lastFailedTask. Progress
  // counts must use the durable task identity, not object identity.
  function appendDistinctTask(tasks = [], task = null) {
    const result = Array.isArray(tasks) ? [...tasks] : [];
    if (!task) return result;
    const identity = resolveTaskIdentity(task);
    const duplicate = identity
      ? result.some((candidate) => resolveTaskIdentity(candidate) === identity)
      : result.includes(task);
    if (!duplicate) result.push(task);
    return result;
  }

  function isBatchMaterialTask(task = {}) {
    const taskType = firstText(task?.taskType, task?.type, task?.entry?.taskType).toLowerCase();
    if (["template", "template-init", "initialization", "init"].includes(taskType)) return false;
    return !/^gpt-template-/i.test(firstText(task?.requestId, task?.id, task?.entry?.externalRequestId));
  }

  function filterBatchMaterialTasks(tasks = []) {
    return (Array.isArray(tasks) ? tasks : []).filter(isBatchMaterialTask);
  }

  function resolveMonotonicPercent({ identity = "", previousIdentity = "", percent = 0, previousPercent = 0 } = {}) {
    const next = clampPercent(percent);
    if (String(identity || "") && String(identity) === String(previousIdentity || "")) {
      return Math.max(clampPercent(previousPercent), next);
    }
    return next;
  }

  function shouldRetainProgress(now = Date.now(), retentionUntil = 0) {
    return Number.isFinite(Number(retentionUntil)) && Number(retentionUntil) > Number(now);
  }

  return {
    DEFAULT_RETENTION_MS,
    clampPercent,
    resolveProgressIdentity,
    resolveTaskIdentity,
    appendDistinctTask,
    isBatchMaterialTask,
    filterBatchMaterialTasks,
    resolveMonotonicPercent,
    shouldRetainProgress
  };
});
