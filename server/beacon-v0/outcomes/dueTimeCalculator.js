'use strict';

const calendar = require('./tradingCalendar');

const ALLOWED_WINDOWS = new Set(['nightly', 'premarket', 'open', 'power_hour', 'post_market']);

function assertDate(value, label) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid Date`);
  }
}

function computeDueTimes(createdAt, window) {
  assertDate(createdAt, 'createdAt');

  if (!ALLOWED_WINDOWS.has(window)) {
    throw new Error(`Unsupported Beacon window: ${window}`);
  }

  const current = calendar.currentSession(createdAt);

  let session0;
  let t1DueAt;

  if (current) {
    session0 = current;
    t1DueAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
    if (t1DueAt > session0.close) {
      t1DueAt = session0.close;
    }
  } else {
    session0 = calendar.nextSession(createdAt);
    t1DueAt = new Date(session0.open.getTime() + 60 * 60 * 1000);
  }

  const t2DueAt = session0.close;
  const session1 = calendar.sessionAfter(session0);
  const t3DueAt = session1.open;
  const t4DueAt = session1.close;

  return {
    t1_due_at: t1DueAt,
    t2_due_at: t2DueAt,
    t3_due_at: t3DueAt,
    t4_due_at: t4DueAt,
    t1_session_minutes: session0.sessionMinutes,
    t2_session_minutes: session0.sessionMinutes,
    t3_session_minutes: session1.sessionMinutes,
    t4_session_minutes: session1.sessionMinutes,
  };
}

module.exports = {
  computeDueTimes,
};