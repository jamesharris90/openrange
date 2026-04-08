const { fmpFetch } = require('../services/fmpClient');

const ET_TIME_ZONE = 'America/New_York';
const SESSION_LABELS = new Set(['LIVE', 'PREMARKET', 'AFTERHOURS', 'CLOSED']);
const STATIC_HOLIDAY_CACHE = new Map();
const REMOTE_HOLIDAY_CACHE = new Map();
const REMOTE_HOLIDAY_TTL_MS = 12 * 60 * 60 * 1000;

function getEtParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';

  return {
    weekday: get('weekday'),
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function toDateKey(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  return { year, month, day };
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function compareEtCandidate(candidate, target) {
  const parts = getEtParts(candidate);
  return parts.year === target.year
    && parts.month === target.month
    && parts.day === target.day
    && parts.hour === target.hour
    && parts.minute === target.minute;
}

function etDateTimeToUtc(year, month, day, hour, minute) {
  for (const utcOffsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hour + utcOffsetHours, minute, 0));
    if (compareEtCandidate(candidate, { year, month, day, hour, minute })) {
      return candidate;
    }
  }

  return new Date(Date.UTC(year, month - 1, day, hour + 5, minute, 0));
}

function formatUtc(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function formatEt(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
}

function normalizeOverrideSession(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return SESSION_LABELS.has(normalized) ? normalized : null;
}

function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay();
  const day = 1 + ((7 + weekday - firstWeekday) % 7) + ((nth - 1) * 7);
  return toDateKey(year, month, day);
}

function lastWeekdayOfMonth(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0));
  const lastWeekday = last.getUTCDay();
  const day = last.getUTCDate() - ((7 + lastWeekday - weekday) % 7);
  return toDateKey(year, month, day);
}

function observedFixedHoliday(year, month, day) {
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = utc.getUTCDay();

  if (weekday === 6) {
    return toDateKey(year, month, day - 1);
  }

  if (weekday === 0) {
    return toDateKey(year, month, day + 1);
  }

  return toDateKey(year, month, day);
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function getStaticHolidaySet(year) {
  if (STATIC_HOLIDAY_CACHE.has(year)) {
    return STATIC_HOLIDAY_CACHE.get(year);
  }

  const easter = easterSunday(year);
  const goodFriday = addUtcDays(easter, -2);
  const holidays = new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    toDateKey(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ]);

  STATIC_HOLIDAY_CACHE.set(year, holidays);
  return holidays;
}

async function getRemoteHolidaySet(year) {
  const cached = REMOTE_HOLIDAY_CACHE.get(year);
  if (cached && (Date.now() - cached.timestamp) < REMOTE_HOLIDAY_TTL_MS) {
    return cached.data;
  }

  try {
    const payload = await fmpFetch('/is-the-market-open');
    const list = Array.isArray(payload?.stockExchangeHolidays)
      ? payload.stockExchangeHolidays
      : Array.isArray(payload?.holidays)
        ? payload.holidays
        : [];
    const holidays = new Set(
      list
        .map((row) => String(row?.date || row?.holiday || '').slice(0, 10))
        .filter((dateKey) => dateKey.startsWith(`${year}-`))
    );

    REMOTE_HOLIDAY_CACHE.set(year, {
      data: holidays,
      timestamp: Date.now(),
    });

    return holidays;
  } catch (_error) {
    return null;
  }
}

async function getHolidaySet(year) {
  if (String(process.env.MARKET_HOLIDAY_SOURCE || '').trim().toLowerCase() !== 'fmp') {
    return getStaticHolidaySet(year);
  }

  const remote = await getRemoteHolidaySet(year);
  if (remote && remote.size > 0) {
    return remote;
  }

  return getStaticHolidaySet(year);
}

function isWeekendByParts(parts) {
  return parts.weekday === 'Sat' || parts.weekday === 'Sun';
}

async function isHolidayDate(dateKey) {
  const { year } = parseDateKey(dateKey);
  const holidays = await getHolidaySet(year);
  return holidays.has(dateKey);
}

async function nextBusinessDate(dateKey) {
  let cursor = new Date(Date.UTC(...Object.values(parseDateKey(dateKey)).map((value, index) => index === 1 ? value - 1 : value)));

  while (true) {
    cursor = addUtcDays(cursor, 1);
    const candidate = getEtParts(cursor);
    const candidateKey = toDateKey(candidate.year, candidate.month, candidate.day);
    if (isWeekendByParts(candidate)) {
      continue;
    }
    if (await isHolidayDate(candidateKey)) {
      continue;
    }
    return candidateKey;
  }
}

async function resolveNextOpen(parts, session) {
  const todayKey = toDateKey(parts.year, parts.month, parts.day);

  if (session === 'PREMARKET') {
    return etDateTimeToUtc(parts.year, parts.month, parts.day, 9, 30);
  }

  const nextKey = session === 'LIVE'
    ? await nextBusinessDate(todayKey)
    : session === 'AFTERHOURS' || session === 'CLOSED'
      ? await nextBusinessDate(todayKey)
      : todayKey;

  const { year, month, day } = parseDateKey(nextKey);
  return etDateTimeToUtc(year, month, day, 9, 30);
}

function buildOverrideState(parts, overrideSession) {
  const isWeekend = isWeekendByParts(parts);
  return {
    session: overrideSession,
    is_market_open: overrideSession === 'LIVE',
    is_premarket: overrideSession === 'PREMARKET',
    is_afterhours: overrideSession === 'AFTERHOURS',
    is_weekend: isWeekend,
  };
}

async function classifySession(parts, options = {}) {
  const overrideSession = normalizeOverrideSession(options.sessionOverride);
  if (overrideSession) {
    return buildOverrideState(parts, overrideSession);
  }

  const dateKey = toDateKey(parts.year, parts.month, parts.day);
  const isWeekend = isWeekendByParts(parts);
  const isHoliday = !isWeekend && await isHolidayDate(dateKey);

  if (isWeekend || isHoliday) {
    return {
      session: 'CLOSED',
      is_market_open: false,
      is_premarket: false,
      is_afterhours: false,
      is_weekend: isWeekend,
    };
  }

  const minutes = (parts.hour * 60) + parts.minute;
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
    return {
      session: 'PREMARKET',
      is_market_open: false,
      is_premarket: true,
      is_afterhours: false,
      is_weekend: false,
    };
  }

  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
    return {
      session: 'LIVE',
      is_market_open: true,
      is_premarket: false,
      is_afterhours: false,
      is_weekend: false,
    };
  }

  if (minutes >= 16 * 60 && minutes < 20 * 60) {
    return {
      session: 'AFTERHOURS',
      is_market_open: false,
      is_premarket: false,
      is_afterhours: true,
      is_weekend: false,
    };
  }

  return {
    session: 'CLOSED',
    is_market_open: false,
    is_premarket: false,
    is_afterhours: false,
    is_weekend: false,
  };
}

async function getMarketState(options = {}) {
  const now = options.asOf ? new Date(options.asOf) : new Date();
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;
  const parts = getEtParts(safeNow);
  const sessionState = await classifySession(parts, options);
  const nextOpenDate = await resolveNextOpen(parts, sessionState.session);

  return {
    is_market_open: sessionState.is_market_open,
    is_premarket: sessionState.is_premarket,
    is_afterhours: sessionState.is_afterhours,
    is_weekend: sessionState.is_weekend,
    session: sessionState.session,
    next_open: formatUtc(nextOpenDate),
    next_open_formatted: {
      utc: formatUtc(nextOpenDate),
      et: formatEt(nextOpenDate),
    },
    label: sessionState.session,
    as_of: safeNow.toISOString(),
    exchange: 'NASDAQ/NYSE',
    timezone: ET_TIME_ZONE,
  };
}

module.exports = {
  getMarketState,
  ET_TIME_ZONE,
};