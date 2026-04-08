/**
 * server/utils/marketMode.js
 * Time-aware market mode detection.
 *
 * MODES:
 *   LIVE   — US market open (Mon–Fri 09:30–16:00 ET)
 *   RECENT — After-hours same weekday OR within 24h of last session close
 *   PREP   — Weekend OR >24h since last close
 *
 * Returns: { mode, reason, windowHours, lastDataTimestamp }
 */

'use strict';

// US Eastern offset from UTC in minutes (EST=-300, EDT=-240).
// We use a deterministic calculation rather than a full TZ library.
function getETOffsetMinutes(date) {
  // DST in the US: second Sunday of March → first Sunday of November
  const year = date.getUTCFullYear();

  // Second Sunday of March at 02:00 ET = 07:00 UTC
  const marchSecondSun = new Date(Date.UTC(year, 2, 1));
  marchSecondSun.setUTCDate(1 + ((7 - marchSecondSun.getUTCDay()) % 7) + 7);
  const dstStart = new Date(marchSecondSun);
  dstStart.setUTCHours(7, 0, 0, 0);

  // First Sunday of November at 02:00 EDT = 06:00 UTC
  const novFirstSun = new Date(Date.UTC(year, 10, 1));
  novFirstSun.setUTCDate(1 + ((7 - novFirstSun.getUTCDay()) % 7));
  const dstEnd = new Date(novFirstSun);
  dstEnd.setUTCHours(6, 0, 0, 0);

  return date >= dstStart && date < dstEnd ? -240 : -300; // EDT or EST
}

function toET(date) {
  const offsetMs = getETOffsetMinutes(date) * 60 * 1000;
  return new Date(date.getTime() + offsetMs);
}

// Returns the most recent market close (16:00 ET on last trading weekday)
function lastMarketClose(now) {
  const et = toET(now);
  let d = new Date(et);
  // Walk back to a weekday
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  // If it's a weekday but before 09:30, go back to previous trading day
  const etHour = d.getUTCHours();
  const etMin  = d.getUTCMinutes();
  const minutesSinceMidnight = etHour * 60 + etMin;
  if (minutesSinceMidnight < 9 * 60 + 30) {
    d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      d.setUTCDate(d.getUTCDate() - 1);
    }
  }
  // Set to 16:00 ET = add abs(offset) back to get UTC
  const closeET = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16, 0, 0));
  // Convert 16:00 ET → UTC: subtract ET offset (ET offset is negative, so subtract makes it larger)
  const offset = getETOffsetMinutes(now); // e.g. -300
  return new Date(closeET.getTime() - offset * 60 * 1000);
}

function getMarketMode(now = new Date()) {
  const et            = toET(now);
  const dayOfWeek     = et.getUTCDay(); // 0=Sun, 6=Sat
  const minutesSinceMidnight = et.getUTCHours() * 60 + et.getUTCMinutes();
  const marketOpen    = 9 * 60 + 30;  // 09:30
  const marketClose   = 16 * 60;       // 16:00
  const isWeekend     = dayOfWeek === 0 || dayOfWeek === 6;
  const isMarketHours = !isWeekend && minutesSinceMidnight >= marketOpen && minutesSinceMidnight < marketClose;

  const lastClose     = lastMarketClose(now);
  const minutesSinceClose = (now.getTime() - lastClose.getTime()) / 60000;

  if (isMarketHours) {
    return {
      mode: 'LIVE',
      reason: 'US market open',
      windowHours: 0.5,    // 30-minute signal window
      sessionWindow: '30 minutes',
      lastDataTimestamp: now.toISOString(),
    };
  }

  // Any weekday (pre-open or after-hours) → RECENT
  // This ensures Monday pre-market traders see useful signals, not empty prep state
  if (!isWeekend) {
    const desc = minutesSinceMidnight < marketOpen
      ? `pre-open (${9 + Math.floor((marketOpen - minutesSinceMidnight) / 60)}h to open)`
      : `${Math.round(minutesSinceClose)} min since market close`;
    return {
      mode: 'RECENT',
      reason: desc,
      windowHours: 24,
      sessionWindow: '24 hours',
      lastDataTimestamp: lastClose.toISOString(),
    };
  }

  return {
    mode: 'PREP',
    reason: `weekend — market closed, ${Math.round(minutesSinceClose / 60)}h since last session`,
    windowHours: 72,
    sessionWindow: '72 hours',
    lastDataTimestamp: lastClose.toISOString(),
  };
}

/**
 * Returns the SQL interval string for querying opportunity_stream
 * based on current market mode.
 */
function getModeWindow(mode) {
  if (mode === 'LIVE')   return '30 minutes';
  if (mode === 'RECENT') return '24 hours';
  return '72 hours'; // PREP
}

/**
 * Minimum confidence threshold per mode.
 */
function getModeMinConfidence(mode) {
  if (mode === 'LIVE')   return 60;
  if (mode === 'RECENT') return 55;
  return 50; // PREP — broader net
}

module.exports = { getMarketMode, getModeWindow, getModeMinConfidence, lastMarketClose };
