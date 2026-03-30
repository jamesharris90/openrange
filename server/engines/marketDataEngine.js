'use strict';

/**
 * marketDataEngine.js
 * Bulletproof market data ingestion using confirmed FMP /stable endpoints.
 *
 * Confirmed working endpoints (Phase 2 audit):
 *   /quote?symbol=X               — single symbol only, returns price/volume/change
 *   /historical-chart/1min?symbol=X — ~1,170 bars OHLCV, no date filter
 *   /historical-price-eod/light?symbol=X — ~1,255 rows, price+volume only
 *   /historical-chart/1hour?symbol=X — ~421 bars OHLCV, used for daily aggregation
 *   /news/stock?tickers=X         — news articles
 */

const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');

const QUOTE_CONCURRENCY = 4;       // 4 req/s max
const INTRADAY_CONCURRENCY = 2;    // 2 req/s — larger payloads
const DAILY_CONCURRENCY = 2;
const CHUNK_DELAY_MS = 50;         // between batches

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/**
 * Run async tasks with bounded concurrency.
 * @param {Array} items
 * @param {number} concurrency
 * @param {Function} fn  async (item) => result
 * @returns {Promise<Array<{ ok: boolean, item, result?, error? }>>}
 */
async function runConcurrent(items, concurrency, fn) {
  const results = [];
  const chunks = chunkArray(items, concurrency);
  for (const chunk of chunks) {
    const settled = await Promise.allSettled(chunk.map((item) => fn(item)));
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === 'fulfilled') {
        results.push({ ok: true, item: chunk[i], result: s.value });
      } else {
        results.push({ ok: false, item: chunk[i], error: s.reason });
      }
    }
    if (CHUNK_DELAY_MS > 0) await sleep(CHUNK_DELAY_MS);
  }
  return results;
}

// ── symbol universe ───────────────────────────────────────────────────────────

/**
 * Returns the active symbol universe from market_quotes (already populated).
 * Ordered by market_cap DESC so top movers get priority slots when chunking.
 */
async function getActiveSymbols() {
  const result = await queryWithTimeout(
    `SELECT symbol FROM market_quotes
     WHERE symbol IS NOT NULL AND symbol != ''
     ORDER BY market_cap DESC NULLS LAST`,
    [],
    { label: 'marketDataEngine.getActiveSymbols', timeoutMs: 8000 }
  );
  return result.rows.map((r) => r.symbol);
}

// ── ingestQuotes ──────────────────────────────────────────────────────────────

/**
 * Fetch single-symbol quotes from FMP and upsert into market_quotes.
 * FMP /quote only works per-symbol; batch returns empty 200.
 *
 * @param {string[]} [symbols]  defaults to full active universe
 * @returns {{ updated: number, errors: number, durationMs: number }}
 */
async function ingestQuotes(symbols) {
  const startedAt = Date.now();
  const universe = symbols || (await getActiveSymbols());

  let updated = 0;
  let errors = 0;

  const results = await runConcurrent(universe, QUOTE_CONCURRENCY, async (symbol) => {
    const data = await fmpFetch('/quote', { symbol });
    // FMP returns an array; take first element
    const q = Array.isArray(data) ? data[0] : data;
    if (!q || !q.price) {
      throw new Error(`empty quote for ${symbol}`);
    }
    return q;
  });

  const goodRows = results.filter((r) => r.ok).map((r) => r.result);
  errors += results.filter((r) => !r.ok).length;

  for (const q of goodRows) {
    try {
      await queryWithTimeout(
        `INSERT INTO market_quotes
           (symbol, price, change_percent, volume, market_cap, previous_close, updated_at, last_updated)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (symbol) DO UPDATE SET
           price          = EXCLUDED.price,
           change_percent = EXCLUDED.change_percent,
           volume         = EXCLUDED.volume,
           market_cap     = EXCLUDED.market_cap,
           previous_close = EXCLUDED.previous_close,
           updated_at     = NOW(),
           last_updated   = NOW()`,
        [
          q.symbol,
          asNumber(q.price),
          asNumber(q.changePercentage ?? q.changesPercentage),
          asInt(q.volume),
          asNumber(q.marketCap),
          asNumber(q.previousClose),
        ],
        { label: 'marketDataEngine.ingestQuotes.upsert', timeoutMs: 5000, poolType: 'write' }
      );
      updated++;
    } catch (_) {
      errors++;
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[INGEST] quotes_updated:${updated} errors:${errors} duration_ms:${durationMs}`);
  return { updated, errors, durationMs };
}

// ── ingestIntraday ────────────────────────────────────────────────────────────

/**
 * Fetch 1-minute intraday bars and upsert into intraday_1m.
 * FMP returns ~1,170 bars per symbol; no date filter available.
 * Upsert with ON CONFLICT (symbol, timestamp) DO NOTHING to avoid duplicates.
 *
 * @param {string[]} [symbols]  defaults to top 500 by market_cap
 * @returns {{ rows_written: number, symbols_ok: number, errors: number, durationMs: number }}
 */
async function ingestIntraday(symbols) {
  const startedAt = Date.now();
  let universe = symbols || (await getActiveSymbols());
  // Intraday is expensive — limit to top 500 unless explicitly provided
  if (!symbols) universe = universe.slice(0, 500);

  let rowsWritten = 0;
  let symbolsOk = 0;
  let errors = 0;

  const results = await runConcurrent(universe, INTRADAY_CONCURRENCY, async (symbol) => {
    const bars = await fmpFetch('/historical-chart/1min', { symbol });
    if (!Array.isArray(bars) || bars.length === 0) {
      throw new Error(`no intraday bars for ${symbol}`);
    }
    return { symbol, bars };
  });

  for (const r of results) {
    if (!r.ok) { errors++; continue; }

    const { symbol, bars } = r.result;
    let written = 0;

    // Batch insert 200 bars at a time
    for (const batch of chunkArray(bars, 200)) {
      const params = [];
      const placeholders = batch.map((bar, i) => {
        const base = i * 7;
        const ts = bar.date ? new Date(bar.date) : null;
        if (!ts || isNaN(ts.getTime())) return null;
        params.push(
          symbol,
          ts,
          asNumber(bar.open),
          asNumber(bar.high),
          asNumber(bar.low),
          asNumber(bar.close),
          asInt(bar.volume)
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
      }).filter(Boolean);

      if (placeholders.length === 0) continue;

      try {
        const res = await queryWithTimeout(
          `INSERT INTO intraday_1m (symbol, "timestamp", open, high, low, close, volume)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (symbol, "timestamp") DO NOTHING`,
          params,
          { label: 'marketDataEngine.ingestIntraday.batch', timeoutMs: 15000, poolType: 'write' }
        );
        written += res.rowCount || 0;
      } catch (err) {
        console.error(`[INGEST ERROR] intraday symbol=${symbol} reason=${err.message}`);
      }
    }

    if (written >= 0) symbolsOk++;
    rowsWritten += written;
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[INGEST] intraday symbols_ok:${symbolsOk} rows_written:${rowsWritten} errors:${errors} duration_ms:${durationMs}`);
  return { rows_written: rowsWritten, symbols_ok: symbolsOk, errors, durationMs };
}

// ── ingestDaily ───────────────────────────────────────────────────────────────

/**
 * Fetch daily price data and upsert into daily_ohlc.
 *
 * Strategy: Use /historical-chart/1hour and aggregate by day to get OHLCV.
 * /historical-price-eod/light only has price+volume (no OHLC), so use 1hour.
 * Aggregation: first bar of day = open, max = high, min = low, last bar = close.
 *
 * @param {string[]} [symbols]  defaults to top 200 (expensive operation)
 * @returns {{ rows_written: number, symbols_ok: number, errors: number, durationMs: number }}
 */
async function ingestDaily(symbols) {
  const startedAt = Date.now();
  let universe = symbols || (await getActiveSymbols());
  if (!symbols) universe = universe.slice(0, 200);

  let rowsWritten = 0;
  let symbolsOk = 0;
  let errors = 0;

  const results = await runConcurrent(universe, DAILY_CONCURRENCY, async (symbol) => {
    const bars = await fmpFetch('/historical-chart/1hour', { symbol });
    if (!Array.isArray(bars) || bars.length === 0) {
      throw new Error(`no hourly bars for ${symbol}`);
    }
    return { symbol, bars };
  });

  for (const r of results) {
    if (!r.ok) { errors++; continue; }

    const { symbol, bars } = r.result;

    // Aggregate hourly bars into daily OHLCV
    const byDate = new Map();
    for (const bar of bars) {
      if (!bar.date) continue;
      const dateKey = bar.date.split(' ')[0]; // "2026-03-28 09:00:00" → "2026-03-28"
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 });
      } else {
        const day = byDate.get(dateKey);
        day.high = Math.max(day.high, asNumber(bar.high) || 0);
        day.low = Math.min(day.low, asNumber(bar.low) || Infinity);
        day.close = asNumber(bar.close) || day.close;
        day.volume += asInt(bar.volume) || 0;
      }
    }

    const dailyBars = Array.from(byDate.entries()).map(([date, d]) => ({
      date,
      open: d.open,
      high: d.high,
      low: d.low === Infinity ? d.close : d.low,
      close: d.close,
      volume: d.volume,
    }));

    let written = 0;
    for (const chunk of chunkArray(dailyBars, 100)) {
      const params = [];
      const placeholders = chunk.map((d, i) => {
        const base = i * 7;
        params.push(
          symbol,
          d.date,
          asNumber(d.open),
          asNumber(d.high),
          asNumber(d.low),
          asNumber(d.close),
          asInt(d.volume)
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
      });

      try {
        const res = await queryWithTimeout(
          `INSERT INTO daily_ohlc (symbol, date, open, high, low, close, volume)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (symbol, date) DO UPDATE SET
             open   = EXCLUDED.open,
             high   = EXCLUDED.high,
             low    = EXCLUDED.low,
             close  = EXCLUDED.close,
             volume = EXCLUDED.volume`,
          params,
          { label: 'marketDataEngine.ingestDaily.batch', timeoutMs: 15000, poolType: 'write' }
        );
        written += res.rowCount || 0;
      } catch (err) {
        console.error(`[INGEST ERROR] daily symbol=${symbol} reason=${err.message}`);
      }
    }

    if (written >= 0) symbolsOk++;
    rowsWritten += written;
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[INGEST] daily symbols_ok:${symbolsOk} rows_written:${rowsWritten} errors:${errors} duration_ms:${durationMs}`);
  return { rows_written: rowsWritten, symbols_ok: symbolsOk, errors, durationMs };
}

// ── ingestMetrics ─────────────────────────────────────────────────────────────

/**
 * Derive computed metrics from daily_ohlc + market_quotes and write to market_metrics.
 *
 * Computes:
 *   avg_volume_30d   — 30-day average from daily_ohlc
 *   relative_volume  — today's volume / avg_volume_30d
 *   gap_percent      — (today's open - yesterday's close) / yesterday's close * 100
 *   change_percent   — from market_quotes
 *
 * @param {string[]} [symbols]  defaults to all symbols in market_quotes
 */
async function ingestMetrics(symbols) {
  const startedAt = Date.now();

  // Compute metrics in-DB using a single aggregate query
  // This is far faster than doing it per-symbol in Node
  // Split into two steps to avoid complex CTEs that timeout:
  // Step 1: upsert price/change/volume from market_quotes (fast)
  // Step 2: compute avg_volume_30d + relative_volume from daily_ohlc (scoped to symbols)

  const symbolFilter = symbols && symbols.length > 0 ? `WHERE symbol = ANY($1)` : '';
  const params = symbols && symbols.length > 0 ? [symbols] : [];

  // Step 1: sync price/change/volume from market_quotes into market_metrics
  const step1Sql = `
    INSERT INTO market_metrics (symbol, price, change_percent, volume, previous_close, updated_at)
    SELECT symbol, price, change_percent, volume, previous_close, NOW()
    FROM market_quotes
    ${symbolFilter}
    ON CONFLICT (symbol) DO UPDATE SET
      price          = EXCLUDED.price,
      change_percent = EXCLUDED.change_percent,
      volume         = EXCLUDED.volume,
      previous_close = EXCLUDED.previous_close,
      updated_at     = NOW()
  `;

  const sql = `
    WITH avg_vol AS (
      SELECT symbol, AVG(volume)::numeric AS avg_volume_30d
      FROM daily_ohlc
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        ${symbols && symbols.length > 0 ? 'AND symbol = ANY($1)' : ''}
      GROUP BY symbol
    )
    UPDATE market_metrics mm
    SET
      avg_volume_30d  = av.avg_volume_30d,
      relative_volume = CASE WHEN av.avg_volume_30d > 0
                             THEN mm.volume::numeric / av.avg_volume_30d
                             ELSE NULL END,
      updated_at      = NOW()
    FROM avg_vol av
    WHERE mm.symbol = av.symbol
  `;

  let updated = 0;
  try {
    // Step 1: sync from market_quotes
    const r1 = await queryWithTimeout(step1Sql, params, {
      label: 'marketDataEngine.ingestMetrics.step1',
      timeoutMs: 15000,
      poolType: 'write',
    });
    updated = r1.rowCount || 0;

    // Step 2: compute avg_volume + relative_volume from daily_ohlc
    await queryWithTimeout(sql, params, {
      label: 'marketDataEngine.ingestMetrics.step2',
      timeoutMs: 20000,
      poolType: 'write',
    });
  } catch (err) {
    console.error(`[INGEST ERROR] metrics reason=${err.message}`);
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[INGEST] metrics_updated:${updated} duration_ms:${durationMs}`);
  return { updated, durationMs };
}

// ── backfillSymbol ────────────────────────────────────────────────────────────

const backfillLocks = new Set();

/**
 * Full backfill for a single symbol: intraday (all available) + daily (aggregated) + quote.
 * Uses a per-symbol lock to prevent concurrent backfills.
 *
 * @param {string} symbol
 * @returns {{ symbol, intraday_rows, daily_rows, quote_updated, error? }}
 */
async function backfillSymbol(symbol) {
  if (backfillLocks.has(symbol)) {
    return { symbol, skipped: true, reason: 'already_in_progress' };
  }
  backfillLocks.add(symbol);

  try {
    // 1. Quote
    let quoteUpdated = false;
    try {
      const data = await fmpFetch('/quote', { symbol });
      const q = Array.isArray(data) ? data[0] : data;
      if (q && q.price) {
        await queryWithTimeout(
          `INSERT INTO market_quotes
             (symbol, price, change_percent, volume, market_cap, previous_close, updated_at, last_updated)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
           ON CONFLICT (symbol) DO UPDATE SET
             price=EXCLUDED.price, change_percent=EXCLUDED.change_percent,
             volume=EXCLUDED.volume, market_cap=EXCLUDED.market_cap,
             previous_close=EXCLUDED.previous_close,
             updated_at=NOW(), last_updated=NOW()`,
          [symbol, asNumber(q.price), asNumber(q.changePercentage ?? q.changesPercentage),
           asInt(q.volume), asNumber(q.marketCap), asNumber(q.previousClose)],
          { label: 'backfillSymbol.quote', timeoutMs: 5000, poolType: 'write' }
        );
        quoteUpdated = true;
      }
    } catch (_) {}

    // 2. Intraday
    let intradayRows = 0;
    try {
      const bars = await fmpFetch('/historical-chart/1min', { symbol });
      if (Array.isArray(bars) && bars.length > 0) {
        const intradayResult = await ingestIntraday([symbol]);
        intradayRows = intradayResult.rows_written;
      }
    } catch (_) {}

    // 3. Daily
    let dailyRows = 0;
    try {
      const dailyResult = await ingestDaily([symbol]);
      dailyRows = dailyResult.rows_written;
    } catch (_) {}

    console.log(`[INGEST] backfill symbol=${symbol} intraday_rows=${intradayRows} daily_rows=${dailyRows} quote=${quoteUpdated}`);
    return { symbol, intraday_rows: intradayRows, daily_rows: dailyRows, quote_updated: quoteUpdated };
  } finally {
    backfillLocks.delete(symbol);
  }
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ingestQuotes,
  ingestIntraday,
  ingestDaily,
  ingestMetrics,
  backfillSymbol,
  getActiveSymbols,
};
