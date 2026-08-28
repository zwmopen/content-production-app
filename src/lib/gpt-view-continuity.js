const TERMINAL_QUEUE_STATUSES = new Set(["completed", "skipped"]);
const RECOVERABLE_RUNTIME_STATUSES = new Set([
  "running",
  "probing",
  "retry-wait",
  "waiting-quota",
  "waiting-schedule",
  "waiting-prerequisite",
  "restarting",
  "recovering"
]);

function hasPendingQueue(queue = []) {
  return Array.isArray(queue)
    && queue.some((task) => task && !TERMINAL_QUEUE_STATUSES.has(String(task._status || "")));
}

function shouldKeepGptAccountView({
  accountId = "",
  activeAccountId = "",
  profile = {},
  settings = {},
  runtime = {},
  queue = [],
  accountBusy = false
} = {}) {
  const id = String(accountId || "");
  if (!id || id === String(activeAccountId || "") || accountBusy) return true;
  if (runtime.pausedByUser === true || runtime.stoppedByUser === true) return false;
  if (RECOVERABLE_RUNTIME_STATUSES.has(String(runtime.status || ""))) return true;
  if (String(runtime.currentTaskId || "").trim()) return true;

  const mode = String(profile.mode || settings.mode || "").trim().toLowerCase();
  const automatic = profile.disabled !== true
    && mode === "single"
    && settings.continuousAutoStart !== false;
  return automatic && hasPendingQueue(queue);
}

module.exports = {
  RECOVERABLE_RUNTIME_STATUSES,
  hasPendingQueue,
  shouldKeepGptAccountView
};
