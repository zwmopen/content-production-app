const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dueMomentsSchedule,
  dueMomentsCollectionSchedule,
  nextMomentsSchedule,
  nextMomentsCollectionSchedule,
  normalizeCollectionScheduleDay,
  normalizeCollectionScheduleTime,
  normalizeCollectionScheduleCatchUpDays,
  previousMonthWindow,
  isMomentsSelectionOnlyFailure,
  momentsScheduleRetryDecision,
  MOMENTS_SCHEDULE_MAX_RETRY_ATTEMPTS,
  selectionPolicyForRule,
  shanghaiClock
} = require("./moments-scheduler");

test("朋友圈定时器按上海时区匹配配置时间并生成唯一运行键", () => {
  const now = new Date("2026-08-15T01:00:00.000Z"); // 09:00 Asia/Shanghai
  assert.deepEqual(shanghaiClock(now), { date: "2026-08-15", time: "09:00" });
  assert.deepEqual(
    dueMomentsSchedule({ enabled: true, triggerMode: "scheduled", scheduleTimes: ["09:00"] }, now),
    { date: "2026-08-15", time: "09:00", key: "2026-08-15@09:00" }
  );
  assert.equal(
    dueMomentsSchedule({ enabled: true, triggerMode: "scheduled", scheduleTimes: ["18:00"] }, now),
    null
  );
});

test("朋友圈定时窗口在窗口内尽早命中，窗口外不触发", () => {
  const settings = {
    enabled: true,
    triggerMode: "scheduled",
    scheduleWindowStart: "10:00",
    scheduleWindowEnd: "12:00",
    scheduleTimes: ["10:20"]
  };
  const inWindow = dueMomentsSchedule(settings, new Date("2026-08-15T02:01:00.000Z")); // 10:01
  assert.deepEqual(inWindow, {
    date: "2026-08-15",
    time: "10:01",
    scheduleWindowStart: "10:00",
    scheduleWindowEnd: "12:00",
    windowActive: true,
    key: "2026-08-15@10:00-12:00"
  });
  assert.equal(dueMomentsSchedule(settings, new Date("2026-08-15T04:01:00.000Z")), null); // 12:01
});

test("朋友圈手动模式或关闭开关不会被后台定时任务触发", () => {
  const now = new Date("2026-08-15T01:00:00.000Z");
  assert.equal(dueMomentsSchedule({ enabled: false, triggerMode: "scheduled", scheduleTimes: ["09:00"] }, now), null);
  assert.equal(dueMomentsSchedule({ enabled: true, triggerMode: "manual", scheduleTimes: ["09:00"] }, now), null);
});

test("朋友圈定时状态能给出本次和下一次上海时间", () => {
  const now = new Date("2026-08-15T01:10:00.000Z"); // 09:10 Asia/Shanghai
  assert.deepEqual(
    nextMomentsSchedule({ enabled: true, triggerMode: "scheduled", scheduleTimes: ["18:30", "09:00"] }, now),
    { date: "2026-08-15", time: "18:30", key: "2026-08-15@18:30", at: "2026-08-15T18:30:00+08:00" }
  );
  assert.deepEqual(
    nextMomentsSchedule({ enabled: true, triggerMode: "scheduled", scheduleTimes: ["09:00"] }, new Date("2026-08-15T02:00:00.000Z")),
    { date: "2026-08-16", time: "09:00", key: "2026-08-16@09:00", at: "2026-08-16T09:00:00+08:00" }
  );
  assert.equal(nextMomentsSchedule({ enabled: true, triggerMode: "manual", scheduleTimes: ["09:00"] }, now), null);
});

test("朋友圈定时窗口在尚未开始时给出开始时间，窗口内提示立即执行", () => {
  const settings = {
    enabled: true,
    triggerMode: "scheduled",
    scheduleWindowStart: "10:00",
    scheduleWindowEnd: "12:00"
  };
  assert.deepEqual(
    nextMomentsSchedule(settings, new Date("2026-08-15T01:10:00.000Z")),
    {
      date: "2026-08-15",
      time: "10:00",
      scheduleWindowStart: "10:00",
      scheduleWindowEnd: "12:00",
      windowActive: false,
      key: "2026-08-15@10:00-12:00",
      at: "2026-08-15T10:00:00+08:00"
    }
  );
  assert.deepEqual(
    nextMomentsSchedule(settings, new Date("2026-08-15T02:10:00.000Z")),
    {
      date: "2026-08-15",
      time: "10:10",
      scheduleWindowStart: "10:00",
      scheduleWindowEnd: "12:00",
      windowActive: true,
      key: "2026-08-15@10:00-12:00",
      at: "2026-08-15T10:10:00+08:00"
    }
  );
});

test("朋友圈月度采集在首选日命中，并用月份作为幂等运行键", () => {
  const settings = {
    enabled: true,
    collectionScheduleEnabled: true,
    collectionScheduleDay: 15,
    collectionScheduleTime: "03:30"
  };
  const due = dueMomentsCollectionSchedule(settings, new Date("2026-08-14T19:30:00.000Z"));
  assert.deepEqual(due, {
    date: "2026-08-15",
    time: "03:30",
    day: 15,
    catchUpDays: 7,
    preferredDate: "2026-08-15",
    catchUpDate: "2026-08-15",
    isCatchUp: false,
    key: "2026-08@03:30"
  });
  assert.equal(dueMomentsCollectionSchedule(settings, new Date("2026-08-15T19:31:00.000Z")).isCatchUp, true);
  assert.equal(dueMomentsCollectionSchedule({ ...settings, collectionScheduleEnabled: false }, new Date("2026-08-14T19:30:00.000Z")), null);
});

test("朋友圈月度采集首选日错过后可在补采窗口命中，且窗口不会跨月", () => {
  const settings = {
    enabled: true,
    collectionScheduleEnabled: true,
    collectionScheduleDay: 1,
    collectionScheduleTime: "10:20"
  };
  const catchUp = dueMomentsCollectionSchedule(settings, new Date("2026-08-03T08:00:00.000Z"));
  assert.equal(catchUp.isCatchUp, true);
  assert.equal(catchUp.catchUpDate, "2026-08-03");
  assert.equal(catchUp.key, "2026-08@10:20");
  assert.equal(dueMomentsCollectionSchedule(settings, new Date("2026-08-08T08:00:00.000Z")), null);
  assert.equal(dueMomentsCollectionSchedule({ ...settings, collectionScheduleDay: 28 }, new Date("2026-08-31T08:00:00.000Z")).isCatchUp, true);
  assert.equal(dueMomentsCollectionSchedule({ ...settings, collectionScheduleDay: 28 }, new Date("2026-09-01T08:00:00.000Z")), null);
  assert.equal(normalizeCollectionScheduleCatchUpDays(20), 7);
  assert.equal(normalizeCollectionScheduleCatchUpDays(0), 1);
});

test("朋友圈月度采集状态能给出本月或下月时间，并把日期限制在 1 到 28 日", () => {
  assert.equal(normalizeCollectionScheduleDay(31), 28);
  assert.equal(normalizeCollectionScheduleDay(0), 1);
  assert.equal(normalizeCollectionScheduleTime("25:00"), "10:20");
  assert.equal(normalizeCollectionScheduleTime(""), "10:20");
  assert.equal(normalizeCollectionScheduleCatchUpDays(undefined), 7);
  const next = nextMomentsCollectionSchedule({
    enabled: true,
    collectionScheduleEnabled: true,
    collectionScheduleDay: 1,
    collectionScheduleTime: "10:20"
  }, new Date("2026-08-17T10:20:00.000Z"));
  assert.equal(next.at, "2026-09-01T10:20:00+08:00");
  assert.equal(next.key, "2026-09@10:20");
  const catchUp = nextMomentsCollectionSchedule({
    enabled: true,
    collectionScheduleEnabled: true,
    collectionScheduleDay: 1,
    collectionScheduleTime: "10:20"
  }, new Date("2026-08-03T10:20:00.000Z"));
  assert.equal(catchUp.isCatchUp, true);
  assert.equal(catchUp.date, "2026-08-03");
  assert.equal(nextMomentsCollectionSchedule({ enabled: true }, new Date("2026-08-17T10:20:00.000Z")), null);
});

test("朋友圈月度采集窗口固定指向触发日所在月的上一个完整月份", () => {
  assert.deepEqual(
    previousMonthWindow(new Date("2026-09-01T02:20:00.000Z")),
    {
      month: "2026-08",
      startDate: "2026-08-01",
      endDate: "2026-09-01",
      startAt: "2026-08-01T00:00:00+08:00",
      endAt: "2026-09-01T00:00:00+08:00"
    }
  );
  assert.deepEqual(
    previousMonthWindow(new Date("2026-01-01T02:20:00.000Z")),
    {
      month: "2025-12",
      startDate: "2025-12-01",
      endDate: "2026-01-01",
      startAt: "2025-12-01T00:00:00+08:00",
      endAt: "2026-01-01T00:00:00+08:00"
    }
  );
});

test("朋友圈筛选规则映射去年今天、往年今天、智能回退和随机策略", () => {
  assert.equal(selectionPolicyForRule("anniversary"), "anniversary");
  assert.equal(selectionPolicyForRule("current-year"), "current-year");
  assert.equal(selectionPolicyForRule("last-year-day"), "last-year-day");
  assert.equal(selectionPolicyForRule("historical-day"), "historical-day");
  assert.equal(selectionPolicyForRule("last-year-month"), "last-year-month");
  assert.equal(selectionPolicyForRule("random"), "random");
  assert.equal(selectionPolicyForRule("unknown"), "anniversary");
});

test("朋友圈窗口内只对选材失败做退避重试，并在额度用完后停止", () => {
  const failedAt = "2026-08-15T02:01:00.000Z";
  const selectionFailure = {
    status: "FAILED",
    stage: "selection",
    failed_at: failedAt,
    error: "选材策略 anniversary 没有找到可用作品"
  };
  assert.equal(isMomentsSelectionOnlyFailure(selectionFailure), true);
  assert.deepEqual(
    momentsScheduleRetryDecision({
      attempt: selectionFailure,
      attempts: 1,
      now: new Date("2026-08-15T02:10:00.000Z")
    }),
    {
      retryable: true,
      allowed: false,
      attempts: 1,
      nextAt: "2026-08-15T02:16:00.000Z",
      reason: "retry-backoff"
    }
  );
  assert.equal(
    momentsScheduleRetryDecision({
      attempt: selectionFailure,
      attempts: 1,
      now: new Date("2026-08-15T02:16:00.000Z")
    }).allowed,
    true
  );
  assert.equal(isMomentsSelectionOnlyFailure({ ...selectionFailure, stage: "upload" }), false);
  assert.equal(
    momentsScheduleRetryDecision({
      attempt: selectionFailure,
      attempts: MOMENTS_SCHEDULE_MAX_RETRY_ATTEMPTS,
      now: new Date("2026-08-15T04:00:00.000Z")
    }).reason,
    "retry-budget-exhausted"
  );
});
