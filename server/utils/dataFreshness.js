function normalizeDateOnly(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function addUtcDays(date, days) {
  const nextDate = new Date(date.getTime());
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function getLatestTradingDay(referenceDate = new Date()) {
  let cursor = normalizeDateOnly(referenceDate) || normalizeDateOnly(new Date());

  while (cursor && isWeekend(cursor)) {
    cursor = addUtcDays(cursor, -1);
  }

  return cursor;
}

function getPreviousTradingDay(referenceDate = new Date()) {
  let cursor = addUtcDays(getLatestTradingDay(referenceDate), -1);

  while (isWeekend(cursor)) {
    cursor = addUtcDays(cursor, -1);
  }

  return cursor;
}

function getAgeMinutes(timestamp, referenceTime = new Date()) {
  const parsed = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.round((referenceTime.getTime() - parsed) / 60000));
}

function getRelativeTimeLabel(timestamp, referenceTime = new Date()) {
  const ageMinutes = getAgeMinutes(timestamp, referenceTime);
  if (ageMinutes === null) {
    return 'unknown';
  }

  if (ageMinutes < 1) {
    return 'just now';
  }

  if (ageMinutes < 60) {
    return `${ageMinutes} mins ago`;
  }

  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) {
    return `${ageHours} hours ago`;
  }

  const ageDays = Math.floor(ageHours / 24);
  return `${ageDays} days ago`;
}

function classifyIntradayFreshness(timestamp, referenceTime = new Date()) {
  const ageMinutes = getAgeMinutes(timestamp, referenceTime);
  return {
    age_minutes: ageMinutes,
    label: ageMinutes !== null && ageMinutes < 15 ? 'LIVE' : 'STALE',
    is_live: ageMinutes !== null && ageMinutes < 15,
  };
}

function classifyDailyFreshness(dateValue, referenceTime = new Date()) {
  const normalizedDate = normalizeDateOnly(dateValue);
  const latestTradingDay = getLatestTradingDay(referenceTime);
  const previousTradingDay = getPreviousTradingDay(referenceTime);
  const isValid = Boolean(
    normalizedDate
    && latestTradingDay
    && previousTradingDay
    && normalizedDate.getTime() >= previousTradingDay.getTime()
    && normalizedDate.getTime() <= latestTradingDay.getTime()
  );

  return {
    latest_trading_day: latestTradingDay ? latestTradingDay.toISOString() : null,
    previous_trading_day: previousTradingDay ? previousTradingDay.toISOString() : null,
    label: isValid ? 'VALID' : 'STALE',
    is_valid: isValid,
  };
}

function classifyNewsFreshness(timestamp, referenceTime = new Date()) {
  const ageMinutes = getAgeMinutes(timestamp, referenceTime);
  return {
    age_minutes: ageMinutes,
    label: ageMinutes !== null && ageMinutes < (24 * 60) ? 'FRESH' : 'STALE',
    is_fresh: ageMinutes !== null && ageMinutes < (24 * 60),
  };
}

module.exports = {
  getAgeMinutes,
  getRelativeTimeLabel,
  getLatestTradingDay,
  getPreviousTradingDay,
  classifyIntradayFreshness,
  classifyDailyFreshness,
  classifyNewsFreshness,
};