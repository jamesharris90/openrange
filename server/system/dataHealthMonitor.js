/**
 * Data Health Monitor
 * Runs every 5 minutes. For each critical ingestion table:
 *   - Checks last updated timestamp via fast index scan
 *   - Counts rows inserted in the relevant recent window
 *   - Logs: TABLE | ROWS_RECENT | LAST_UPDATED | STATUS
 *   - Fires logger.error if any table exceeds its staleness threshold
 */

'use strict';

const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

const MONITOR_INTERVAL_MS = 5 * 60 * 1000;

// Table configs — tsCol must be indexed for fast ORDER BY DESC LIMIT 1 scans
const TABLE_CONFIGS = [
  {
    name:            'intraday_1m',
    tsCol:           '"timestamp"',
    recentWindow:    '5 minutes',
    errorThresholdH: 0.42,   // 25 minutes — intraday runs every 1 min, allow buffer
    marketHoursOnly: true,   // only alarm during US market hours
  },
  {
    name:            'news_articles',
    tsCol:           'published_at',
    recentWindow:    '1 hour',
    errorThresholdH: 1,
  },
  {
    name:            'earnings_events',
    tsCol:           'created_at',
    recentWindow:    '6 hours',
    errorThresholdH: 24,
  },
  {
    name:            'analyst_enrichment',
    tsCol:           'last_updated',
    recentWindow:    '24 hours',
    errorThresholdH: 24,
  },
  {
    name:            'earnings_transcripts',
    tsCol:           'created_at',
    recentWindow:    '48 hours',
    errorThresholdH: 48,
  },
  {
    name:            'daily_ohlc',
    tsCol:           'date',
    recentWindow:    '2 days',
    errorThresholdH: 48,
    weekdaysOnly:    true,   // daily job runs at midnight — skip weekend alarms
  },
  {
    name:            'ticker_universe',
    tsCol:           'last_updated',
    recentWindow:    '7 days',
    errorThresholdH: 168,    // 7 days
  },
  {
    name:            'intelligence_emails',
    tsCol:           'created_at',
    recentWindow:    '6 hours',
    errorThresholdH: 24,
  },
  {
    name:            'options_cache',
    tsCol:           'fetched_at',
    recentWindow:    '24 hours',
    errorThresholdH: 24,
  },
];

// Returns true during US regular market hours (Mon-Fri 14:30-21:00 UTC)
function isMarketHours() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const hhmm = now.getUTCHours() * 100 + now.getUTCMinutes();
  return hhmm >= 1430 && hhmm < 2100;
}

// Returns true on a weekday
function isWeekday() {
  const day = new Date().getUTCDay();
  return day !== 0 && day !== 6;
}

async function checkTable(config) {
  // Fast last-timestamp check — uses the (symbol, timestamp DESC) index
  let last = null;
  try {
    const r = await queryWithTimeout(
      `SELECT ${config.tsCol} AS ts FROM ${config.name} ORDER BY ${config.tsCol} DESC LIMIT 1`,
      [],
      { timeoutMs: 5000, label: `health.${config.name}.last`, maxRetries: 0 }
    );
    last = r.rows[0]?.ts ? new Date(r.rows[0].ts) : null;
  } catch {
    last = null;
  }

  // Recent-row count using WHERE on indexed timestamp col
  let rowsRecent = 0;
  try {
    const r = await queryWithTimeout(
      `SELECT COUNT(*)::int AS cnt FROM ${config.name} WHERE ${config.tsCol} > NOW() - INTERVAL '${config.recentWindow}'`,
      [],
      { timeoutMs: 8000, label: `health.${config.name}.recent`, maxRetries: 0 }
    );
    rowsRecent = Number(r.rows[0]?.cnt || 0);
  } catch {
    rowsRecent = -1; // -1 = query failed / timed out
  }

  const now = Date.now();
  const ageH = last ? (now - last.getTime()) / 3600000 : null;
  const ageDisplay = ageH !== null ? ageH.toFixed(1) + 'h' : 'never';

  let status = 'HEALTHY';
  if (!last) {
    status = 'EMPTY';
  } else if (ageH !== null && ageH > config.errorThresholdH) {
    status = 'STALE';
  }

  return { last, ageH, ageDisplay, rowsRecent, status };
}

async function runHealthCheck() {
  const results = [];

  for (const config of TABLE_CONFIGS) {
    // Skip market-hours-only tables when market is closed
    if (config.marketHoursOnly && !isMarketHours()) continue;
    // Skip weekday-only tables on weekends
    if (config.weekdaysOnly && !isWeekday()) continue;

    const { last, ageH, ageDisplay, rowsRecent, status } = await checkTable(config);

    const rowsDisplay = rowsRecent === -1 ? 'timeout' : String(rowsRecent);
    const lastDisplay = last ? last.toISOString().slice(0, 16) + 'Z' : 'none';

    const logLine = `${config.name.padEnd(24)} | rows_recent=${rowsDisplay.padStart(6)} | last=${lastDisplay} | ${status}`;

    if (status === 'STALE' || status === 'EMPTY') {
      logger.error('[DATA HEALTH] table not updating — ingestion may be down', {
        table:         config.name,
        last_updated:  lastDisplay,
        age_hours:     ageH !== null ? Number(ageH.toFixed(1)) : null,
        rows_recent:   rowsRecent,
        threshold_h:   config.errorThresholdH,
        status,
      });
      console.error('[DATA HEALTH ERROR]', logLine);
    } else {
      logger.info('[DATA HEALTH]', {
        table:        config.name,
        last_updated: lastDisplay,
        age_hours:    ageH !== null ? Number(ageH.toFixed(1)) : null,
        rows_recent:  rowsRecent,
        status,
      });
      console.log('[DATA HEALTH]', logLine);
    }

    results.push({ table: config.name, status, ageH, rowsRecent });
  }

  return results;
}

let _timer = null;

function startDataHealthMonitor() {
  if (_timer) return;
  // Run once at startup after a short delay (let ingestion jobs fire first)
  setTimeout(() => runHealthCheck().catch(() => {}), 30 * 1000);
  // Then every 5 minutes
  _timer = setInterval(() => runHealthCheck().catch(() => {}), MONITOR_INTERVAL_MS);
  logger.info('[DATA HEALTH MONITOR] started — checking every 5 minutes');
}

function stopDataHealthMonitor() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startDataHealthMonitor, stopDataHealthMonitor, runHealthCheck };
