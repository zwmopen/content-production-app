"use strict";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MOMENTS_SCHEDULE_RETRY_INTERVAL_MINUTES = 15;
const MOMENTS_SCHEDULE_MAX_RETRY_ATTEMPTS = 8;

function shanghaiClock(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  const hour = values.hour === "24" ? "00" : values.hour;
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${hour}:${values.minute}`
  };
}

function normalizeMomentsScheduleWindow(settings = {}) {
  const start = String(settings.scheduleWindowStart || "").trim();
  const end = String(settings.scheduleWindowEnd || "").trim();
  if (!CLOCK_TIME_PATTERN.test(start) || !CLOCK_TIME_PATTERN.test(end) || start > end) return null;
  return { start, end };
}

function isMomentsSelectionOnlyFailure(attempt = {}) {
  const stage = String(attempt.stage || "").toLowerCase();
  const error = String(attempt.error || "").trim();
  return String(attempt.status || "") === "FAILED"
    && !String(attempt.work_id || attempt.workId || "").trim()
    && (stage === "selection" || (!stage && error.startsWith("选材策略")));
}

function momentsScheduleRetryDecision({ attempt = null, attempts = 0, now = new Date() } = {}) {
  const count = Math.max(0, Number(attempts || 0));
  if (!isMomentsSelectionOnlyFailure(attempt || {})) {
    return {
      retryable: false,
      allowed: false,
      attempts: count,
      nextAt: "",
      reason: "non-retryable-failure"
    };
  }
  if (count >= MOMENTS_SCHEDULE_MAX_RETRY_ATTEMPTS) {
    return {
      retryable: true,
      allowed: false,
      attempts: count,
      nextAt: "",
      reason: "retry-budget-exhausted"
    };
  }
  const failedAt = Date.parse(String(attempt.failed_at || attempt.failedAt || attempt.finishedAt || ""));
  const nextAtMs = Number.isFinite(failedAt)
    ? failedAt + MOMENTS_SCHEDULE_RETRY_INTERVAL_MINUTES * 60 * 1000
    : new Date(now).getTime();
  return {
    retryable: true,
    allowed: new Date(now).getTime() >= nextAtMs,
    attempts: count,
    nextAt: new Date(nextAtMs).toISOString(),
    reason: new Date(now).getTime() >= nextAtMs ? "retry-window-open" : "retry-backoff"
  };
}

function dueMomentsSchedule(settings = {}, now = new Date()) {
  if (settings.enabled === false || settings.triggerMode !== "scheduled") return null;
  const clock = shanghaiClock(now);
  const window = normalizeMomentsScheduleWindow(settings);
  if (window) {
    if (clock.time < window.start || clock.time > window.end) return null;
    return {
      ...clock,
      time: clock.time,
      scheduleWindowStart: window.start,
      scheduleWindowEnd: window.end,
      windowActive: true,
      key: `${clock.date}@${window.start}-${window.end}`
    };
  }
  const times = Array.isArray(settings.scheduleTimes) ? settings.scheduleTimes : [];
  return times.includes(clock.time)
    ? { ...clock, time: clock.time, key: `${clock.date}@${clock.time}` }
    : null;
}

function nextMomentsSchedule(settings = {}, now = new Date()) {
  if (settings.enabled === false || settings.triggerMode !== "scheduled") return null;
  const clock = shanghaiClock(now);
  const window = normalizeMomentsScheduleWindow(settings);
  if (window) {
    const [year, month, day] = clock.date.split("-").map(Number);
    const today = new Date(Date.UTC(year, month - 1, day));
    for (let offset = 0; offset <= 8; offset += 1) {
      const candidateDate = new Date(today);
      candidateDate.setUTCDate(today.getUTCDate() + offset);
      const candidateDay = candidateDate.toISOString().slice(0, 10);
      if (offset === 0 && clock.time > window.end) continue;
      const active = offset === 0 && clock.time >= window.start && clock.time <= window.end;
      const time = active ? clock.time : window.start;
      return {
        date: candidateDay,
        time,
        scheduleWindowStart: window.start,
        scheduleWindowEnd: window.end,
        windowActive: active,
        key: `${candidateDay}@${window.start}-${window.end}`,
        at: `${candidateDay}T${time}:00+08:00`
      };
    }
    return null;
  }
  const times = Array.from(new Set((Array.isArray(settings.scheduleTimes) ? settings.scheduleTimes : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))))
    .sort();
  if (!times.length) return null;

  const [year, month, day] = clock.date.split("-").map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidateDate = new Date(today);
    candidateDate.setUTCDate(today.getUTCDate() + offset);
    const candidateDay = candidateDate.toISOString().slice(0, 10);
    for (const time of times) {
      if (offset === 0 && time < clock.time) continue;
      return {
        date: candidateDay,
        time,
        key: `${candidateDay}@${time}`,
        at: `${candidateDay}T${time}:00+08:00`
      };
    }
  }
  return null;
}

function normalizeCollectionScheduleDay(value) {
  const day = Number(value);
  if (!Number.isInteger(day)) return 1;
  return Math.max(1, Math.min(28, day));
}

function normalizeCollectionScheduleTime(value) {
  const time = String(value || "").trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "10:20";
}

function normalizeCollectionScheduleCatchUpDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days)) return 7;
  return Math.max(1, Math.min(7, days));
}

function previousMonthWindow(value = new Date()) {
  const clock = shanghaiClock(value);
  const [year, month] = clock.date.split("-").map(Number);
  const currentMonthStart = new Date(Date.UTC(year, month - 1, 1));
  const previousMonthStart = new Date(Date.UTC(year, month - 2, 1));
  const formatDate = (date) => date.toISOString().slice(0, 10);
  const targetStart = formatDate(previousMonthStart);
  const targetEnd = formatDate(currentMonthStart);
  return {
    month: targetStart.slice(0, 7),
    startDate: targetStart,
    endDate: targetEnd,
    startAt: `${targetStart}T00:00:00+08:00`,
    endAt: `${targetEnd}T00:00:00+08:00`
  };
}

function dueMomentsCollectionSchedule(settings = {}, now = new Date()) {
  if (settings.enabled === false || settings.collectionScheduleEnabled !== true) return null;
  const clock = shanghaiClock(now);
  const day = normalizeCollectionScheduleDay(settings.collectionScheduleDay);
  const time = normalizeCollectionScheduleTime(settings.collectionScheduleTime);
  const catchUpDays = normalizeCollectionScheduleCatchUpDays(settings.collectionScheduleCatchUpDays);
  const [year, month, currentDay] = clock.date.split("-").map(Number);
  const preferredDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const endDate = new Date(Date.UTC(year, month - 1, day + catchUpDays - 1));
  const endDay = endDate.getUTCMonth() === month - 1 ? endDate.getUTCDate() : new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (currentDay < day || currentDay > endDay) return null;
  // On the preferred day wait for the configured time. On later catch-up
  // days, run as soon as the workbench is available; the task was already
  // missed and should not be lost merely because the configured time passed.
  if (currentDay === day && clock.time < time) return null;
  return {
    ...clock,
    day,
    time,
    catchUpDays,
    preferredDate,
    catchUpDate: clock.date,
    isCatchUp: currentDay > day,
    key: `${clock.date.slice(0, 7)}@${time}`
  };
}

function nextMomentsCollectionSchedule(settings = {}, now = new Date()) {
  if (settings.enabled === false || settings.collectionScheduleEnabled !== true) return null;
  const clock = shanghaiClock(now);
  const day = normalizeCollectionScheduleDay(settings.collectionScheduleDay);
  const time = normalizeCollectionScheduleTime(settings.collectionScheduleTime);
  const catchUpDays = normalizeCollectionScheduleCatchUpDays(settings.collectionScheduleCatchUpDays);
  const [year, month, currentDay] = clock.date.split("-").map(Number);
  for (let offset = 0; offset <= 13; offset += 1) {
    const candidate = new Date(Date.UTC(year, month - 1 + offset, 1));
    const candidateDate = `${candidate.getUTCFullYear()}-${String(candidate.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (offset === 0 && day < currentDay) {
      const catchUpEnd = new Date(Date.UTC(year, month - 1, day + catchUpDays - 1));
      const catchUpEndDay = catchUpEnd.getUTCMonth() === month - 1
        ? catchUpEnd.getUTCDate()
        : new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (currentDay <= catchUpEndDay) {
        return {
          date: clock.date,
          day,
          time,
          catchUpDays,
          isCatchUp: true,
          key: `${clock.date.slice(0, 7)}@${time}`,
          at: `${clock.date}T${time}:00+08:00`
        };
      }
      continue;
    }
    if (offset === 0 && day === currentDay && time < clock.time) {
      const catchUpEnd = new Date(Date.UTC(year, month - 1, day + catchUpDays - 1));
      if (catchUpEnd.getUTCMonth() === month - 1 && currentDay < catchUpEnd.getUTCDate()) {
        const nextDate = new Date(Date.UTC(year, month - 1, currentDay + 1));
        const nextDateText = nextDate.toISOString().slice(0, 10);
        return {
          date: nextDateText,
          day,
          time,
          catchUpDays,
          isCatchUp: true,
          key: `${nextDateText.slice(0, 7)}@${time}`,
          at: `${nextDateText}T${time}:00+08:00`
        };
      }
      continue;
    }
    return {
      date: candidateDate,
      day,
      time,
      catchUpDays,
      isCatchUp: false,
      key: `${candidateDate.slice(0, 7)}@${time}`,
      at: `${candidateDate}T${time}:00+08:00`
    };
  }
  return null;
}

function selectionPolicyForRule(rule = "anniversary") {
  return {
    anniversary: "anniversary",
    "historical-day": "historical-day",
    "current-year": "current-year",
    "last-year-day": "last-year-day",
    "last-year-month": "last-year-month",
    random: "random"
  }[String(rule)] || "anniversary";
}

module.exports = {
  SHANGHAI_TIME_ZONE,
  MOMENTS_SCHEDULE_RETRY_INTERVAL_MINUTES,
  MOMENTS_SCHEDULE_MAX_RETRY_ATTEMPTS,
  dueMomentsSchedule,
  dueMomentsCollectionSchedule,
  isMomentsSelectionOnlyFailure,
  momentsScheduleRetryDecision,
  nextMomentsSchedule,
  nextMomentsCollectionSchedule,
  normalizeCollectionScheduleDay,
  normalizeCollectionScheduleTime,
  normalizeCollectionScheduleCatchUpDays,
  previousMonthWindow,
  normalizeMomentsScheduleWindow,
  selectionPolicyForRule,
  shanghaiClock
};
