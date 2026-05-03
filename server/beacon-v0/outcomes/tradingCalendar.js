'use strict';

const { isHoliday } = require('nyse-holidays');
const { isEarlyCloseDate } = require('./earlyCloseTable');

const NEW_YORK_TZ = 'America/New_York';
const STANDARD_SESSION_MINUTES = 390;
const EARLY_SESSION_MINUTES = 210;

function assertDate(value, label) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid Date`);
  }
}

function getEtParts(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function toETDateString(date) {
  assertDate(date, 'timestamp');
  const parts = getEtParts(date);
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftETDateString(dateStrET, days) {
  const [year, month, day] = String(dateStrET).split('-').map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  const outYear = String(anchor.getUTCFullYear()).padStart(4, '0');
  const outMonth = String(anchor.getUTCMonth() + 1).padStart(2, '0');
  const outDay = String(anchor.getUTCDate()).padStart(2, '0');
  return `${outYear}-${outMonth}-${outDay}`;
}

function isWeekend(dateStrET) {
  const [year, month, day] = String(dateStrET).split('-').map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = anchor.getUTCDay();
  return weekday === 0 || weekday === 6;
}

function findUtcForETWallTime(dateStrET, hour, minute) {
  const [year, month, day] = String(dateStrET).split('-').map(Number);
  const start = Date.UTC(year, month - 1, day, 12, 0, 0);
  const end = Date.UTC(year, month - 1, day, 23, 0, 0);

  for (let timestamp = start; timestamp <= end; timestamp += 60 * 1000) {
    const candidate = new Date(timestamp);
    const parts = getEtParts(candidate);
    if (
      parts.year === year
      && parts.month === month
      && parts.day === day
      && parts.hour === hour
      && parts.minute === minute
    ) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve ET wall time ${dateStrET} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} to UTC`);
}

function getSessionForETDate(dateStrET) {
  if (isWeekend(dateStrET)) {
    return null;
  }

  if (isHoliday(new Date(`${dateStrET}T12:00:00Z`))) {
    return null;
  }

  const earlyClose = isEarlyCloseDate(dateStrET);
  const open = findUtcForETWallTime(dateStrET, 9, 30);
  const close = findUtcForETWallTime(dateStrET, earlyClose ? 13 : 16, 0);

  return {
    open,
    close,
    isEarlyClose: earlyClose,
    sessionMinutes: earlyClose ? EARLY_SESSION_MINUTES : STANDARD_SESSION_MINUTES,
  };
}

function isInSession(timestamp) {
  assertDate(timestamp, 'timestamp');
  const session = getSessionForETDate(toETDateString(timestamp));
  return Boolean(session && timestamp >= session.open && timestamp < session.close);
}

function currentSession(timestamp) {
  assertDate(timestamp, 'timestamp');
  const session = getSessionForETDate(toETDateString(timestamp));
  if (!session) {
    return null;
  }

  if (timestamp >= session.open && timestamp < session.close) {
    return session;
  }

  return null;
}

function nextSession(timestamp) {
  assertDate(timestamp, 'timestamp');
  let dateStrET = toETDateString(timestamp);

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const candidateDate = dayOffset === 0 ? dateStrET : shiftETDateString(dateStrET, dayOffset);
    const session = getSessionForETDate(candidateDate);
    if (session && session.open >= timestamp) {
      return session;
    }
  }

  throw new Error(`No trading session found within 14 days of ${timestamp.toISOString()}`);
}

function sessionAfter(session) {
  if (!session || !(session.open instanceof Date) || !(session.close instanceof Date)) {
    throw new Error('sessionAfter requires a valid session object');
  }

  return nextSession(new Date(session.close.getTime() + 1000));
}

module.exports = {
  isInSession,
  nextSession,
  currentSession,
  sessionAfter,
};