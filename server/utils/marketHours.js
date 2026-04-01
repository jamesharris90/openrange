'use strict';

/**
 * Market Hours Utility
 *
 * Single source of truth for market-open detection across all engines.
 * Uses ET (America/New_York) to handle EST/EDT automatically.
 *
 * US market hours: Mon–Fri 09:30–16:00 ET (excluding holidays not tracked here).
 */

/**
 * Returns true if the US market is currently open.
 * Optionally pass a Date for testing.
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
function isMarketOpen(now = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour:    '2-digit',
      minute:  '2-digit',
      hour12:  false,
    });
    const parts   = fmt.formatToParts(now);
    const weekday = parts.find(p => p.type === 'weekday').value; // Mon Tue Wed Thu Fri Sat Sun
    const hours   = parseInt(parts.find(p => p.type === 'hour').value,   10);
    const minutes = parseInt(parts.find(p => p.type === 'minute').value, 10);

    if (weekday === 'Sat' || weekday === 'Sun') return false;

    const totalMin = hours * 60 + minutes;
    return totalMin >= 9 * 60 + 30 && totalMin < 16 * 60;
  } catch {
    return false; // safe default — treat as closed on error
  }
}

/**
 * Returns the current trading session label.
 * PREMARKET | OPEN | MIDDAY | POWER_HOUR | AFTER_HOURS | CLOSED
 *
 * @param {Date} [now]
 * @returns {string}
 */
function getSessionLabel(now = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour:    '2-digit',
      minute:  '2-digit',
      hour12:  false,
    });
    const parts   = fmt.formatToParts(now);
    const weekday = parts.find(p => p.type === 'weekday').value;
    const hours   = parseInt(parts.find(p => p.type === 'hour').value,   10);
    const minutes = parseInt(parts.find(p => p.type === 'minute').value, 10);
    const total   = hours * 60 + minutes;

    if (weekday === 'Sat' || weekday === 'Sun') return 'CLOSED';
    if (total < 4 * 60)              return 'CLOSED';
    if (total < 9 * 60 + 30)         return 'PREMARKET';
    if (total < 10 * 60)             return 'OPEN';        // first 30 min
    if (total < 15 * 60)             return 'MIDDAY';
    if (total < 16 * 60)             return 'POWER_HOUR';
    if (total < 20 * 60)             return 'AFTER_HOURS';
    return 'CLOSED';
  } catch {
    return 'CLOSED';
  }
}

module.exports = { isMarketOpen, getSessionLabel };
