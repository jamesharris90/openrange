'use strict';

/**
 * marketIntegrityEngine.js
 * Checks market data for:
 *   1. Stale quotes (not updated within mode-appropriate window)
 *   2. Missing intraday data for active symbols
 *   3. Zero-volume anomalies
 *   4. Daily OHLC gaps
 * Auto-triggers backfillSymbol() for any symbol failing checks.
 */

const { queryWithTimeout } = require('../db/pg');
const { getMarketMode } = require('../utils/marketMode');
const { backfillSymbol } = require('./marketDataEngine');

// Only backfill during non-PREP mode (market hours or recent)
const BACKFILL_CONCURRENCY = 2;
const MAX_BACKFILL_PER_RUN = 20; // cap to avoid flooding FMP

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── check: stale quotes ───────────────────────────────────────────────────────

/**
 * Returns symbols in market_quotes not updated within the mode freshness window.
 * LIVE=5min, RECENT=2h, PREP=24h
 */
async function findStaleQuotes() {
  const { mode } = getMarketMode();
  const windowMap = { LIVE: '5 minutes', RECENT: '2 hours', PREP: '24 hours' };
  const window = windowMap[mode] || '2 hours';

  const res = await queryWithTimeout(
    `SELECT symbol
     FROM market_quotes
     WHERE updated_at < NOW() - INTERVAL '${window}'
        OR updated_at IS NULL
     ORDER BY updated_at ASC NULLS FIRST
     LIMIT 50`,
    [],
    { label: 'marketIntegrity.staleQuotes', timeoutMs: 8000 }
  );
  return res.rows.map((r) => r.symbol);
}

// ── check: missing intraday ───────────────────────────────────────────────────

/**
 * Returns symbols in market_quotes that have no intraday_1m rows in the past 24h.
 * Only meaningful during LIVE/RECENT mode.
 */
async function findMissingIntraday() {
  const { mode } = getMarketMode();
  if (mode === 'PREP') return []; // intraday doesn't update on weekends

  const res = await queryWithTimeout(
    `SELECT q.symbol
     FROM market_quotes q
     WHERE NOT EXISTS (
       SELECT 1 FROM intraday_1m i
       WHERE i.symbol = q.symbol
         AND i."timestamp" > NOW() - INTERVAL '24 hours'
     )
     AND q.market_cap > 500000000  -- focus on symbols with >$500M market cap
     ORDER BY q.market_cap DESC NULLS LAST
     LIMIT 30`,
    [],
    { label: 'marketIntegrity.missingIntraday', timeoutMs: 10000 }
  );
  return res.rows.map((r) => r.symbol);
}

// ── check: zero-volume anomalies ──────────────────────────────────────────────

/**
 * Returns symbols where the most recent daily_ohlc row has volume = 0.
 * Indicates an ingestion failure.
 */
async function findZeroVolumeSymbols() {
  const res = await queryWithTimeout(
    `SELECT DISTINCT ON (symbol) symbol
     FROM daily_ohlc
     WHERE volume = 0 OR volume IS NULL
     ORDER BY symbol, date DESC
     LIMIT 20`,
    [],
    { label: 'marketIntegrity.zeroVolume', timeoutMs: 8000 }
  );
  return res.rows.map((r) => r.symbol);
}

// ── check: daily OHLC gaps ────────────────────────────────────────────────────

/**
 * Returns symbols in market_quotes that have no daily_ohlc row in the past 7 days.
 */
async function findDailyGaps() {
  const res = await queryWithTimeout(
    `SELECT q.symbol
     FROM market_quotes q
     WHERE NOT EXISTS (
       SELECT 1 FROM daily_ohlc d
       WHERE d.symbol = q.symbol
         AND d.date >= CURRENT_DATE - INTERVAL '7 days'
     )
     AND q.market_cap > 1000000000  -- focus on >$1B market cap
     ORDER BY q.market_cap DESC NULLS LAST
     LIMIT 20`,
    [],
    { label: 'marketIntegrity.dailyGaps', timeoutMs: 10000 }
  );
  return res.rows.map((r) => r.symbol);
}

// ── auto-backfill ─────────────────────────────────────────────────────────────

async function runBackfills(symbols) {
  const targets = [...new Set(symbols)].slice(0, MAX_BACKFILL_PER_RUN);
  if (targets.length === 0) return { count: 0 };

  console.log(`[INGEST] integrity auto-backfill symbols=${targets.join(',')}`);

  let completed = 0;
  for (let i = 0; i < targets.length; i += BACKFILL_CONCURRENCY) {
    const chunk = targets.slice(i, i + BACKFILL_CONCURRENCY);
    await Promise.allSettled(chunk.map((s) => backfillSymbol(s)));
    completed += chunk.length;
    await sleep(500);
  }

  return { count: completed };
}

// ── main integrity run ────────────────────────────────────────────────────────

let lastRun = null;
let runningIntegrity = false;

async function runMarketIntegrityEngine() {
  if (runningIntegrity) {
    console.log('[INGEST] marketIntegrityEngine already running — skipping');
    return lastRun;
  }
  runningIntegrity = true;
  const startedAt = Date.now();

  const report = {
    ran_at: new Date().toISOString(),
    mode: getMarketMode().mode,
    stale_quotes: [],
    missing_intraday: [],
    zero_volume: [],
    daily_gaps: [],
    backfilled: 0,
    duration_ms: 0,
  };

  try {
    const [stale, missingIntraday, zeroVol, dailyGaps] = await Promise.all([
      findStaleQuotes().catch(() => []),
      findMissingIntraday().catch(() => []),
      findZeroVolumeSymbols().catch(() => []),
      findDailyGaps().catch(() => []),
    ]);

    report.stale_quotes    = stale;
    report.missing_intraday = missingIntraday;
    report.zero_volume     = zeroVol;
    report.daily_gaps      = dailyGaps;

    const needsBackfill = [...new Set([...stale, ...missingIntraday, ...zeroVol, ...dailyGaps])];

    if (needsBackfill.length > 0) {
      const { count } = await runBackfills(needsBackfill);
      report.backfilled = count;
    }

    report.duration_ms = Date.now() - startedAt;
    console.log(
      `[INGEST] integrity stale=${stale.length} missing_intraday=${missingIntraday.length} ` +
      `zero_vol=${zeroVol.length} daily_gaps=${dailyGaps.length} ` +
      `backfilled=${report.backfilled} duration_ms=${report.duration_ms}`
    );
  } catch (err) {
    console.error(`[INGEST ERROR] marketIntegrityEngine reason=${err.message}`);
    report.error = err.message;
    report.duration_ms = Date.now() - startedAt;
  } finally {
    runningIntegrity = false;
    lastRun = report;
  }

  return report;
}

function getLastIntegrityReport() {
  return lastRun;
}

module.exports = {
  runMarketIntegrityEngine,
  getLastIntegrityReport,
  findStaleQuotes,
  findMissingIntraday,
  findZeroVolumeSymbols,
  findDailyGaps,
};
