const INSTANCE_CONFIG = Object.freeze({
  A: Object.freeze({ id: "A", accountId: "account-1", port: 4331, remoteDebuggingPort: 9431 }),
  B: Object.freeze({ id: "B", accountId: "account-2", port: 4332, remoteDebuggingPort: 9432 }),
  C: Object.freeze({ id: "C", accountId: "account-3", port: 4333, remoteDebuggingPort: 9433 }),
  D: Object.freeze({ id: "D", accountId: "account-4", port: 4334, remoteDebuggingPort: 9434 })
});

const DEFAULT_ACCOUNT_BY_INSTANCE = Object.freeze(Object.fromEntries(
  Object.entries(INSTANCE_CONFIG).map(([id, config]) => [id, config.accountId])
));

function normalizeInstanceId(value) {
  const normalized = String(value || "A").trim().toUpperCase();
  return INSTANCE_CONFIG[normalized] ? normalized : "A";
}

function instanceIdForPort(port) {
  const numericPort = Number(port);
  const entry = Object.values(INSTANCE_CONFIG).find((config) => config.port === numericPort);
  return entry?.id || "";
}

function normalizeAccountId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function getInstanceConfig(instanceId) {
  return INSTANCE_CONFIG[normalizeInstanceId(instanceId)];
}

function resolveAssignedAccountIds(instanceId, configuredValue, options = {}) {
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  const configuredIds = String(configuredValue || "")
    .split(",")
    .map(normalizeAccountId)
    .filter(Boolean);
  if (configuredIds.length > 0) return [...new Set(configuredIds)];
  if (options.contentOnlyMode === true) return [DEFAULT_ACCOUNT_BY_INSTANCE[normalizedInstanceId]];
  return [...new Set(configuredIds)];
}

function defaultAccountId(instanceId) {
  return DEFAULT_ACCOUNT_BY_INSTANCE[normalizeInstanceId(instanceId)];
}

module.exports = {
  INSTANCE_CONFIG,
  defaultAccountId,
  getInstanceConfig,
  instanceIdForPort,
  normalizeInstanceId,
  normalizeAccountId,
  resolveAssignedAccountIds
};
