const TEMPORARY_WEB_CACHE_INTERVAL_MS = 3 * 60 * 60 * 1000;
const TEMPORARY_WEB_CACHE_ACTIVE_RETRY_MS = 15 * 60 * 1000;
const TEMPORARY_WEB_CACHE_STARTUP_GRACE_MS = 60 * 1000;

function parseClockMinutes(value, fallback) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isWithinWorkHours(date, start = "07:00", end = "02:00") {
  const startMinutes = parseClockMinutes(start, 7 * 60);
  const endMinutes = parseClockMinutes(end, 2 * 60);
  const current = minutesSinceMidnight(date);
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) return current >= startMinutes && current < endMinutes;
  return current >= startMinutes || current < endMinutes;
}

function nextWorkWindowStart(date, start = "07:00", end = "02:00") {
  if (isWithinWorkHours(date, start, end)) return new Date(date.getTime());
  const startMinutes = parseClockMinutes(start, 7 * 60);
  const next = new Date(date.getTime());
  next.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  if (next.getTime() <= date.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

function planTemporaryWebCacheCleanup({
  now = new Date(),
  lastRunAt = 0,
  activeTaskCount = 0,
  startupGraceUntil = 0,
  workStart = "07:00",
  workEnd = "02:00",
  intervalMs = TEMPORARY_WEB_CACHE_INTERVAL_MS
} = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const graceUntil = Number(startupGraceUntil || 0);
  if (graceUntil > current.getTime()) {
    return { action: "wait", reason: "startup-grace", nextAt: graceUntil, delayMs: Math.max(1000, graceUntil - current.getTime()) };
  }
  if (!isWithinWorkHours(current, workStart, workEnd)) {
    const nextAt = nextWorkWindowStart(current, workStart, workEnd);
    return { action: "wait", reason: "outside-work-hours", nextAt: nextAt.getTime(), delayMs: Math.max(1000, nextAt.getTime() - current.getTime()) };
  }
  if (Number(activeTaskCount || 0) > 0) {
    return { action: "wait", reason: "production-active", nextAt: current.getTime() + TEMPORARY_WEB_CACHE_ACTIVE_RETRY_MS, delayMs: TEMPORARY_WEB_CACHE_ACTIVE_RETRY_MS };
  }
  const last = Number(lastRunAt || 0);
  if (last > 0 && current.getTime() - last < intervalMs) {
    const nextAt = last + intervalMs;
    return { action: "wait", reason: "interval", nextAt, delayMs: Math.max(1000, nextAt - current.getTime()) };
  }
  return { action: "run", reason: "due", nextAt: current.getTime(), delayMs: 0 };
}

module.exports = {
  TEMPORARY_WEB_CACHE_INTERVAL_MS,
  TEMPORARY_WEB_CACHE_ACTIVE_RETRY_MS,
  TEMPORARY_WEB_CACHE_STARTUP_GRACE_MS,
  isWithinWorkHours,
  nextWorkWindowStart,
  planTemporaryWebCacheCleanup
};
