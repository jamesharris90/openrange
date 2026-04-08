/**
 * trading-os/src/lib/marketMode.ts
 * Client-side time-aware market mode detection (mirrors server/utils/marketMode.js).
 *
 * MODES:
 *   LIVE   — US market open (Mon–Fri 09:30–16:00 ET)
 *   RECENT — Weekday non-market hours (pre-open or after-hours)
 *   PREP   — Weekend only
 */

export type MarketMode = 'LIVE' | 'RECENT' | 'PREP';

export interface MarketModeResult {
  mode: MarketMode;
  reason: string;
  windowHours: number;
  sessionWindow: string;
  lastDataTimestamp: string;
  label: string;       // short UI label
  labelColor: string;  // Tailwind colour class
}

/** ET offset in minutes from UTC (handles DST automatically) */
function getETOffsetMinutes(date: Date): number {
  const year = date.getUTCFullYear();
  // DST: second Sunday of March → first Sunday of November
  const marchFirst = new Date(Date.UTC(year, 2, 1));
  const marchSecondSun = new Date(marchFirst);
  marchSecondSun.setUTCDate(1 + ((7 - marchFirst.getUTCDay()) % 7) + 7);
  marchSecondSun.setUTCHours(7, 0, 0, 0);

  const novFirst = new Date(Date.UTC(year, 10, 1));
  const novFirstSun = new Date(novFirst);
  novFirstSun.setUTCDate(1 + ((7 - novFirst.getUTCDay()) % 7));
  novFirstSun.setUTCHours(6, 0, 0, 0);

  return date >= marchSecondSun && date < novFirstSun ? -240 : -300;
}

function toET(date: Date): Date {
  return new Date(date.getTime() + getETOffsetMinutes(date) * 60_000);
}

function lastMarketClose(now: Date): Date {
  const offset = getETOffsetMinutes(now);
  const et = toET(now);
  const d = new Date(et);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  const minutesSinceMidnight = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (minutesSinceMidnight < 9 * 60 + 30) {
    d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      d.setUTCDate(d.getUTCDate() - 1);
    }
  }
  const closeET = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16, 0, 0));
  return new Date(closeET.getTime() - offset * 60_000);
}

export function getMarketMode(now: Date = new Date()): MarketModeResult {
  const et = toET(now);
  const dayOfWeek = et.getUTCDay();
  const minutesSinceMidnight = et.getUTCHours() * 60 + et.getUTCMinutes();
  const marketOpen  = 9 * 60 + 30;
  const marketClose = 16 * 60;
  const isWeekend   = dayOfWeek === 0 || dayOfWeek === 6;
  const isMarketHours = !isWeekend && minutesSinceMidnight >= marketOpen && minutesSinceMidnight < marketClose;
  const lastClose = lastMarketClose(now);
  const minutesSinceClose = (now.getTime() - lastClose.getTime()) / 60_000;

  if (isMarketHours) {
    return {
      mode: 'LIVE',
      reason: 'US market open',
      windowHours: 0.5,
      sessionWindow: '30 minutes',
      lastDataTimestamp: now.toISOString(),
      label: 'LIVE',
      labelColor: 'text-emerald-400',
    };
  }

  if (!isWeekend) {
    const desc = minutesSinceMidnight < marketOpen
      ? 'Pre-market'
      : `${Math.round(minutesSinceClose)}m after close`;
    return {
      mode: 'RECENT',
      reason: desc,
      windowHours: 24,
      sessionWindow: '24 hours',
      lastDataTimestamp: lastClose.toISOString(),
      label: 'RECENT',
      labelColor: 'text-amber-400',
    };
  }

  return {
    mode: 'PREP',
    reason: `Weekend — ${Math.round(minutesSinceClose / 60)}h since last close`,
    windowHours: 72,
    sessionWindow: '72 hours',
    lastDataTimestamp: lastClose.toISOString(),
    label: 'PREP',
    labelColor: 'text-slate-400',
  };
}

/** Refreshes every 60 seconds on the client; returns memoised result */
let _cached: { result: MarketModeResult; ts: number } | null = null;
export function getCachedMarketMode(): MarketModeResult {
  const now = Date.now();
  if (!_cached || now - _cached.ts > 60_000) {
    _cached = { result: getMarketMode(new Date(now)), ts: now };
  }
  return _cached.result;
}
