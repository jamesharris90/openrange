'use strict';

/**
 * Verified NYSE early-close days from the official NYSE hours calendar.
 *
 * Source used for verification:
 * https://www.nyse.com/markets/hours-calendars
 *
 * Verified directly from NYSE page content:
 * - 2026-11-27 (Black Friday)
 * - 2026-12-24 (Christmas Eve)
 * - 2027-11-26 (Black Friday)
 * - 2028-07-03 (pre-Independence Day)
 * - 2028-11-24 (Black Friday)
 *
 * Intentionally excluded until officially verified by NYSE:
 * - any 2027 Christmas-adjacent early close
 * - any 2028 Christmas-adjacent early close
 * - all 2029 dates
 * - all 2030 dates
 *
 * Rule of thumb for this table: omit uncertain dates rather than guess.
 * A missed early close is less harmful than a falsely included one.
 */

const EARLY_CLOSE_DATES = [
  '2026-11-27',
  '2026-12-24',
  '2027-11-26',
  '2028-07-03',
  '2028-11-24',
];

const EARLY_CLOSE_SET = new Set(EARLY_CLOSE_DATES);

function isEarlyCloseDate(dateStrET) {
  return EARLY_CLOSE_SET.has(String(dateStrET || ''));
}

module.exports = {
  EARLY_CLOSE_DATES,
  isEarlyCloseDate,
};