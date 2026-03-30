'use strict';

/**
 * Session Aggregation Engine
 *
 * Fetches extended-hours intraday data from FMP and classifies each candle
 * into PREMARKET / REGULAR / AFTERHOURS based on US Eastern Time.
 *
 * Session boundaries (ET):
 *   PREMARKET  : 00:00 – 09:29
 *   REGULAR    : 09:30 – 15:59
 *   AFTERHOURS : 16:00 – 23:59
 *
 * Data quality scoring (per candle, 0–100):
 *   Base: 100
 *   -20  volume = 0
 *   -20  open/high/low not finite
 *   -50  high < low (price anomaly)
 *   Row rejected if close <= 0
 *
 * FMP endpoint:
 *   GET /stable/historical-chart/1min?symbol=XXX&extended=true
 */

const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');

const ENGINE_LABEL = '[SESSION_AGG]';
const PINNED_SYMBOLS = ['AAPL', 'TSLA', 'NVDA', 'SPY', 'QQQ', 'MSFT'];
const MAX_SYMBOLS_PER_RUN = 20;
const INTER_SYMBOL_DELAY_MS = 300;

// ── Session classification ────────────────────────────────────────────────────

/**
 * FMP returns timestamps as "YYYY-MM-DD HH:MM:SS" in US Eastern Time.
 * Extract hour and minute directly from the string for fast classification.
 */
function classifySession(fmpTimestamp) {
  if (!fmpTimestamp || typeof fmpTimestamp !== 'string') return 'REGULAR';
  const timePart = fmpTimestamp.split(' ')[1] || fmpTimestamp.split('T')[1] || '';
  const [hStr = '12', mStr = '0'] = timePart.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);

  if (isNaN(h)) return 'REGULAR';

  if (h < 9 || (h === 9 && m < 30)) return 'PREMARKET';
  if (h < 16) return 'REGULAR';
  return 'AFTERHOURS';
}

// ── Data quality scoring ──────────────────────────────────────────────────────

function computeQuality(row) {
  let score = 100;
  if (!Number.isFinite(row.open) || !Number.isFinite(row.high) || !Number.isFinite(row.low)) score -= 20;
  if (Number.isFinite(row.high) && Number.isFinite(row.low) && row.high < row.low) score -= 50;
  if (!row.volume || row.volume === 0) score -= 20;
  return Math.max(0, score);
}

// ── FMP timestamp → DB-safe ISO string (treat as ET, append ET offset) ───────

/**
 * Convert FMP's "YYYY-MM-DD HH:MM:SS" (Eastern Time) to an ISO-8601 string
 * that PostgreSQL will store correctly as TIMESTAMPTZ.
 *
 * Approximate ET offset: UTC-5 (standard) / UTC-4 (daylight).
 * We use the JS Intl API to determine the actual offset for the given date.
 */
function fmpTsToIso(tsStr) {
  if (!tsStr) return null;
  // Normalise separators
  const normalized = tsStr.replace(' ', 'T');

  // Parse as if UTC first to get a Date, then figure out the real ET offset
  const tentativeUtc = new Date(normalized + 'Z');
  if (isNaN(tentativeUtc.getTime())) return null;

  // Get the ET offset for this specific date/time (handles DST automatically)
  // Intl.DateTimeFormat gives us the hour in ET; diff with UTC hour = offset
  try {
    const etParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(tentativeUtc);

    const etHour   = parseInt(etParts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const utcHour  = tentativeUtc.getUTCHours();
    // Offset = hours that UTC is ahead of ET
    const rawOffset = (utcHour - etHour + 24) % 24;
    // ET is always UTC-4 or UTC-5
    const etOffsetHours = rawOffset <= 12 ? rawOffset : rawOffset - 24;
    const sign = etOffsetHours >= 0 ? '-' : '+';
    const absOffset = Math.abs(etOffsetHours);
    return normalized + `${sign}${String(absOffset).padStart(2, '0')}:00`;
  } catch (_) {
    // Fallback: assume UTC-5 (ET standard time)
    return normalized + '-05:00';
  }
}

// ── Normalise FMP bar ─────────────────────────────────────────────────────────

function normaliseBar(raw, symbol) {
  const tsStr = raw.date || raw.datetime || raw.timestamp || null;
  if (!tsStr) return null;

  const close = Number(raw.close ?? raw.price);
  if (!Number.isFinite(close) || close <= 0) return null;

  const open   = Number.isFinite(Number(raw.open))   ? Number(raw.open)   : close;
  const high   = Number.isFinite(Number(raw.high))   ? Number(raw.high)   : close;
  const low    = Number.isFinite(Number(raw.low))    ? Number(raw.low)    : close;
  const volume = Number.isFinite(Number(raw.volume)) ? Math.max(0, Math.trunc(Number(raw.volume))) : 0;

  const session          = classifySession(tsStr);
  const data_quality_score = computeQuality({ open, high, low, close, volume });
  const timestamp        = fmpTsToIso(tsStr);
  if (!timestamp) return null;

  return { symbol, timestamp, open, high, low, close, volume, session, data_quality_score };
}

// ── UPSERT with session + quality ─────────────────────────────────────────────

async function upsertSessionRows(rows) {
  if (!rows || rows.length === 0) return 0;

  const sql = `
    WITH payload AS (
      SELECT *
      FROM json_to_recordset($1::json) AS x(
        symbol             text,
        timestamp          timestamptz,
        open               double precision,
        high               double precision,
        low                double precision,
        close              double precision,
        volume             bigint,
        session            text,
        data_quality_score int
      )
    )
    INSERT INTO intraday_1m
      (symbol, "timestamp", open, high, low, close, volume, session, data_quality_score)
    SELECT symbol, timestamp, open, high, low, close, COALESCE(volume, 0), session, data_quality_score
    FROM payload
    ON CONFLICT (symbol, "timestamp") DO UPDATE SET
      session            = EXCLUDED.session,
      data_quality_score = EXCLUDED.data_quality_score
    RETURNING 1
  `;

  const { rows: result } = await queryWithTimeout(sql, [JSON.stringify(rows)], {
    timeoutMs:  20_000,
    label:      'session_agg.upsert',
    maxRetries: 0,
    poolType:   'write',
  });

  return result.length;
}

// ── Process one symbol ────────────────────────────────────────────────────────

async function processSymbol(symbol) {
  const t0 = Date.now();
  let raw;

  try {
    raw = await fmpFetch('/historical-chart/1min', { symbol, extended: 'true' });
  } catch (err) {
    console.warn(`${ENGINE_LABEL} fetch failed for ${symbol}: ${err.message}`);
    return { symbol, fetched: 0, upserted: 0, error: err.message };
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    console.log(`${ENGINE_LABEL} no bars for ${symbol}`);
    return { symbol, fetched: 0, upserted: 0 };
  }

  const bars = raw.map(r => normaliseBar(r, symbol)).filter(Boolean);

  // Dedup on (symbol, timestamp) before inserting
  const seen = new Set();
  const deduped = bars.filter(b => {
    const k = b.timestamp;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const sessionCounts = deduped.reduce((acc, b) => {
    acc[b.session] = (acc[b.session] || 0) + 1;
    return acc;
  }, {});

  const upserted = deduped.length > 0 ? await upsertSessionRows(deduped) : 0;
  const ms = Date.now() - t0;

  console.log(
    `${ENGINE_LABEL} ${symbol} bars=${raw.length} valid=${deduped.length}` +
    ` upserted=${upserted} sessions=${JSON.stringify(sessionCounts)} ${ms}ms`
  );

  return { symbol, fetched: raw.length, valid: deduped.length, upserted, sessions: sessionCounts };
}

// ── Symbol list ───────────────────────────────────────────────────────────────

async function getTargetSymbols() {
  let watchlistSymbols = [];
  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol FROM premarket_watchlist ORDER BY score DESC LIMIT 30`,
      [],
      { timeoutMs: 5000, label: 'session_agg.watchlist_symbols' }
    );
    watchlistSymbols = rows.map(r => r.symbol);
  } catch (_) {
    // table may not exist in all environments
  }

  const all = [...PINNED_SYMBOLS, ...watchlistSymbols];
  const seen = new Set();
  return all.filter(s => s && !seen.has(s) && seen.add(s)).slice(0, MAX_SYMBOLS_PER_RUN);
}

// ── Main run ──────────────────────────────────────────────────────────────────

async function runSessionAggregationEngine() {
  const t0 = Date.now();
  console.log(`${ENGINE_LABEL} starting`);

  const symbols = await getTargetSymbols();
  console.log(`${ENGINE_LABEL} processing ${symbols.length} symbols`);

  const results = [];
  for (const symbol of symbols) {
    const result = await processSymbol(symbol);
    results.push(result);
    if (INTER_SYMBOL_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, INTER_SYMBOL_DELAY_MS));
    }
  }

  const totalFetched  = results.reduce((s, r) => s + (r.fetched  || 0), 0);
  const totalUpserted = results.reduce((s, r) => s + (r.upserted || 0), 0);
  const errors        = results.filter(r => r.error).length;

  const sessionTotals = results.reduce((acc, r) => {
    if (r.sessions) {
      for (const [k, v] of Object.entries(r.sessions)) {
        acc[k] = (acc[k] || 0) + v;
      }
    }
    return acc;
  }, {});

  const ms = Date.now() - t0;
  console.log(
    `${ENGINE_LABEL} done — symbols=${symbols.length} fetched=${totalFetched}` +
    ` upserted=${totalUpserted} errors=${errors}` +
    ` sessions=${JSON.stringify(sessionTotals)} ${ms}ms`
  );

  return {
    ok:             true,
    symbols_processed: symbols.length,
    total_fetched:  totalFetched,
    total_upserted: totalUpserted,
    errors,
    session_totals: sessionTotals,
    duration_ms:    ms,
    results,
  };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startSessionAggregationScheduler(intervalMs = 10 * 60 * 1000) {
  if (_timer) return;

  runSessionAggregationEngine().catch(err =>
    console.error(`${ENGINE_LABEL} startup run failed:`, err.message)
  );

  _timer = setInterval(() => {
    runSessionAggregationEngine().catch(err =>
      console.error(`${ENGINE_LABEL} scheduled run failed:`, err.message)
    );
  }, intervalMs);

  console.log(`${ENGINE_LABEL} scheduler started (interval=${intervalMs / 60000}min)`);
}

function stopSessionAggregationScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log(`${ENGINE_LABEL} scheduler stopped`);
  }
}

module.exports = {
  runSessionAggregationEngine,
  startSessionAggregationScheduler,
  stopSessionAggregationScheduler,
};
