'use strict';

/**
 * Fallback Data Engine (Phase 8)
 *
 * If a symbol has NO premarket candles in intraday_1m, attempt to fill the
 * gap using Finnhub intraday data.
 *
 * Rules:
 *   - ONLY insert for missing time windows — NEVER overwrite existing FMP data
 *   - data_quality_score = 80 (vs FMP = 100)
 *   - Session classification reuses the same ET-based logic
 *   - Gracefully skips if Finnhub returns no data or rate-limits
 *   - Only runs for symbols in premarket_watchlist with no PM candles today
 */

const path   = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../.env') });

const { queryWithTimeout } = require('../db/pg');

const ENGINE_LABEL          = '[FALLBACK_DATA]';
const FINNHUB_API_KEY       = process.env.FINNHUB_API_KEY;
const FINNHUB_BASE          = 'https://finnhub.io/api/v1';
const DATA_QUALITY_FALLBACK = 80;
const INTER_SYMBOL_DELAY_MS = 500;   // Finnhub is more rate-sensitive

// ── Session classification (mirrors sessionAggregationEngine) ────────────────

function classifySession(dateStr) {
  if (!dateStr) return 'REGULAR';
  const timePart = typeof dateStr === 'number'
    ? new Date(dateStr * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false }).split(', ')[1]
    : (String(dateStr).split(' ')[1] || String(dateStr).split('T')[1] || '');

  const [hStr = '12', mStr = '0'] = timePart.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h)) return 'REGULAR';
  if (h < 9 || (h === 9 && m < 30)) return 'PREMARKET';
  if (h < 16) return 'REGULAR';
  return 'AFTERHOURS';
}

// ── Find symbols that need fallback ─────────────────────────────────────────

async function getSymbolsNeedingFallback() {
  // Symbols in premarket_watchlist with no PREMARKET candles in intraday_1m today
  const { rows } = await queryWithTimeout(
    `SELECT pw.symbol
     FROM premarket_watchlist pw
     WHERE NOT EXISTS (
       SELECT 1 FROM intraday_1m im
       WHERE im.symbol = pw.symbol
         AND im.session = 'PREMARKET'
         AND im."timestamp" >= NOW() - INTERVAL '1 day'
     )
     ORDER BY pw.score DESC
     LIMIT 20`,
    [],
    { timeoutMs: 10_000, label: 'fallback.symbols_needing' }
  );
  return rows.map(r => r.symbol);
}

// ── Fetch Finnhub 1-minute candles ────────────────────────────────────────────

async function fetchFinnhubCandles(symbol) {
  if (!FINNHUB_API_KEY) {
    console.warn(`${ENGINE_LABEL} FINNHUB_API_KEY not set — skipping ${symbol}`);
    return null;
  }

  // Today from midnight ET to now (use Unix timestamps)
  const now   = Math.floor(Date.now() / 1000);
  const from  = now - 86400; // 24h back

  const url = `${FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=1&from=${from}&to=${now}&token=${FINNHUB_API_KEY}`;

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    console.warn(`${ENGINE_LABEL} Finnhub fetch error for ${symbol}: ${err.message}`);
    return null;
  }

  if (response.status === 429) {
    console.warn(`${ENGINE_LABEL} Finnhub rate-limited for ${symbol} — skipping`);
    return null;
  }

  if (!response.ok) {
    console.warn(`${ENGINE_LABEL} Finnhub HTTP ${response.status} for ${symbol}`);
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    return null;
  }

  if (!data || data.s === 'no_data' || !Array.isArray(data.t) || data.t.length === 0) {
    return null;
  }

  return data;
}

// ── Normalise Finnhub bars ───────────────────────────────────────────────────

function normaliseFinnhubBars(data, symbol) {
  const bars = [];
  for (let i = 0; i < data.t.length; i++) {
    const tsUnix = data.t[i];
    const close  = Number(data.c?.[i]);
    if (!Number.isFinite(close) || close <= 0) continue;

    const open   = Number.isFinite(Number(data.o?.[i])) ? Number(data.o[i])   : close;
    const high   = Number.isFinite(Number(data.h?.[i])) ? Number(data.h[i])   : close;
    const low    = Number.isFinite(Number(data.l?.[i])) ? Number(data.l[i])   : close;
    const volume = Number.isFinite(Number(data.v?.[i])) ? Math.trunc(Number(data.v[i])) : 0;

    // Convert Unix timestamp to ISO string with ET offset
    const dt      = new Date(tsUnix * 1000);
    const session = classifySession(tsUnix);
    const iso     = dt.toISOString();   // Store as UTC — the session tag carries the context

    bars.push({ symbol, timestamp: iso, open, high, low, close, volume, session, data_quality_score: DATA_QUALITY_FALLBACK });
  }
  return bars;
}

// ── Find timestamps already present in DB ────────────────────────────────────

async function getExistingTimestamps(symbol, from) {
  const { rows } = await queryWithTimeout(
    `SELECT "timestamp"::text AS ts
     FROM intraday_1m
     WHERE symbol = $1 AND "timestamp" >= $2`,
    [symbol, from],
    { timeoutMs: 10_000, label: `fallback.existing_ts.${symbol}`, maxRetries: 0 }
  );
  return new Set(rows.map(r => r.ts.replace(/\.\d+/, ''))); // strip microseconds
}

// ── Upsert only missing bars ─────────────────────────────────────────────────

async function insertMissingBars(bars) {
  if (!bars || bars.length === 0) return 0;

  // Get existing timestamps for this symbol
  const symbol   = bars[0].symbol;
  const fromDate = bars.reduce((min, b) => b.timestamp < min ? b.timestamp : min, bars[0].timestamp);
  const existing = await getExistingTimestamps(symbol, fromDate);

  // Filter to bars with no existing entry
  const newBars = bars.filter(b => {
    const keyTs = b.timestamp.replace(/\.\d+/, '').replace('Z', '+00:00');
    return !existing.has(b.timestamp.replace(/\.\d+/, '')) &&
           !existing.has(keyTs);
  });

  if (newBars.length === 0) {
    console.log(`${ENGINE_LABEL} ${symbol} — all ${bars.length} bars already present`);
    return 0;
  }

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
    ON CONFLICT (symbol, "timestamp") DO NOTHING
    RETURNING 1
  `;

  const { rows: result } = await queryWithTimeout(
    sql,
    [JSON.stringify(newBars)],
    { timeoutMs: 20_000, label: `fallback.insert.${symbol}`, maxRetries: 0, poolType: 'write' }
  );

  return result.length;
}

// ── Process one symbol ───────────────────────────────────────────────────────

async function processSymbol(symbol) {
  const data = await fetchFinnhubCandles(symbol);
  if (!data) return { symbol, skipped: true, reason: 'finnhub_no_data' };

  const bars    = normaliseFinnhubBars(data, symbol);
  const pmBars  = bars.filter(b => b.session === 'PREMARKET');

  if (pmBars.length === 0) {
    return { symbol, skipped: true, reason: 'no_premarket_bars_in_response' };
  }

  const inserted = await insertMissingBars(pmBars);

  console.log(`${ENGINE_LABEL} ${symbol} — finnhub bars=${bars.length} pm=${pmBars.length} inserted=${inserted}`);
  return { symbol, skipped: false, bars_total: bars.length, pm_bars: pmBars.length, inserted };
}

// ── Main run ─────────────────────────────────────────────────────────────────

async function runFallbackDataEngine() {
  const t0 = Date.now();
  console.log(`${ENGINE_LABEL} starting`);

  let symbols;
  try {
    symbols = await getSymbolsNeedingFallback();
  } catch (err) {
    console.error(`${ENGINE_LABEL} failed to get symbols:`, err.message);
    return { ok: false, error: err.message };
  }

  if (!symbols || symbols.length === 0) {
    console.log(`${ENGINE_LABEL} no symbols need fallback data`);
    return { ok: true, processed: 0 };
  }

  console.log(`${ENGINE_LABEL} ${symbols.length} symbols need fallback`);

  let filled  = 0;
  let skipped = 0;

  for (const symbol of symbols) {
    try {
      const result = await processSymbol(symbol);
      if (result.skipped) {
        skipped++;
      } else {
        if (result.inserted > 0) filled++;
      }
    } catch (err) {
      console.warn(`${ENGINE_LABEL} ${symbol} error: ${err.message}`);
      skipped++;
    }

    if (INTER_SYMBOL_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, INTER_SYMBOL_DELAY_MS));
    }
  }

  const ms = Date.now() - t0;
  console.log(`${ENGINE_LABEL} done — filled=${filled} skipped=${skipped} ${ms}ms`);

  return { ok: true, processed: symbols.length, filled, skipped, duration_ms: ms };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startFallbackDataScheduler(intervalMs = 15 * 60 * 1000) {
  if (_timer) return;

  runFallbackDataEngine().catch(err =>
    console.error(`${ENGINE_LABEL} startup run failed:`, err.message)
  );

  _timer = setInterval(() => {
    runFallbackDataEngine().catch(err =>
      console.error(`${ENGINE_LABEL} scheduled run failed:`, err.message)
    );
  }, intervalMs);

  console.log(`${ENGINE_LABEL} scheduler started (interval=${intervalMs / 60000}min)`);
}

function stopFallbackDataScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log(`${ENGINE_LABEL} scheduler stopped`);
  }
}

module.exports = {
  runFallbackDataEngine,
  startFallbackDataScheduler,
  stopFallbackDataScheduler,
};
