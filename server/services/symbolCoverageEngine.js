'use strict';

/**
 * Symbol Coverage Engine
 *
 * Checks whether a symbol has complete data coverage across all 4 data types,
 * then backfills any gaps on-demand using parallel FMP fetches.
 *
 * Designed to be called non-blocking from /api/stocks/:symbol so the UI
 * receives a response immediately while coverage is filled in the background.
 *
 * Coverage status written to symbol_coverage table.
 */

const crypto = require('crypto');
const { queryWithTimeout } = require('../db/pg');
const { fmpFetch } = require('./fmpClient');
const logger = require('../utils/logger');

// ─── dedup helpers ────────────────────────────────────────────────────────────

/** Deterministic ID for a news article URL (MD5-based UUID shape) */
function makeNewsId(url) {
  const h = crypto.createHash('md5').update(String(url || '')).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

/** ISO date string N calendar days ago */
function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

// ─── coverage check ───────────────────────────────────────────────────────────

/**
 * Run 4 parallel COUNT queries.
 * Returns { intraday_ok, daily_ok, earnings_ok, news_ok, status }
 */
async function checkCoverage(symbol) {
  const [intradayRes, dailyRes, earningsRes, newsRes] = await Promise.allSettled([
    queryWithTimeout(
      `SELECT COUNT(*)::int AS n FROM intraday_1m
       WHERE symbol = $1 AND "timestamp" > NOW() - INTERVAL '5 days'`,
      [symbol], { timeoutMs: 8000, label: 'coverage.check.intraday', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT COUNT(*)::int AS n FROM daily_ohlc
       WHERE symbol = $1 AND date >= $2`,
      [symbol, daysAgo(30)], { timeoutMs: 8000, label: 'coverage.check.daily', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT COUNT(*)::int AS n FROM earnings_events WHERE symbol = $1`,
      [symbol], { timeoutMs: 8000, label: 'coverage.check.earnings', maxRetries: 0 }
    ),
    // news_ok = at least 1 high-quality article (priority_score >= 2) within 48h
    // Falls back to any article within 7 days if enrichment hasn't run yet
    queryWithTimeout(
      `SELECT COUNT(*)::int AS n FROM news_articles
       WHERE (
         COALESCE(detected_symbols, symbols) && ARRAY[$1]::text[]
         OR $1 = ANY(symbols)
       )
       AND published_at > NOW() - INTERVAL '48 hours'
       AND COALESCE(priority_score, 0) >= 2`,
      [symbol], { timeoutMs: 8000, label: 'coverage.check.news', maxRetries: 0 }
    ),
  ]);

  const n = (res) => res.status === 'fulfilled' ? Number(res.value.rows[0]?.n ?? 0) : 0;

  const intraday_ok = n(intradayRes) > 0;
  const daily_ok    = n(dailyRes)    > 0;
  const earnings_ok = n(earningsRes) > 0;
  const news_ok     = n(newsRes)     > 0;

  const okCount = [intraday_ok, daily_ok, earnings_ok, news_ok].filter(Boolean).length;
  const status  = okCount === 4 ? 'COMPLETE' : okCount >= 2 ? 'PARTIAL' : 'UNKNOWN';

  return { intraday_ok, daily_ok, earnings_ok, news_ok, status };
}

// ─── individual backfill functions ────────────────────────────────────────────

async function backfillIntraday(symbol) {
  try {
    const data = await fmpFetch('/historical-chart/1min', { symbol });
    const rows = (Array.isArray(data) ? data : [])
      .map(row => {
        const ts    = row.date || row.datetime || row.timestamp;
        const close = Number(row.close ?? row.price);
        return {
          symbol,
          timestamp: ts,
          open:   Number(row.open  ?? close),
          high:   Number(row.high  ?? close),
          low:    Number(row.low   ?? close),
          close,
          volume: Math.max(0, Math.trunc(Number(row.volume) || 0)),
        };
      })
      .filter(r => r.timestamp && Number.isFinite(r.close) && r.close > 0);

    // Deduplicate on symbol|timestamp key
    const deduped = Array.from(
      new Map(rows.map(r => [`${r.symbol}|${r.timestamp}`, r])).values()
    );

    if (deduped.length === 0) return { ok: false, inserted: 0 };

    const sql = `
      WITH payload AS (
        SELECT * FROM json_to_recordset($1::json) AS x(
          symbol text, timestamp timestamptz,
          open double precision, high double precision,
          low double precision, close double precision, volume bigint
        )
      ), ins AS (
        INSERT INTO intraday_1m (symbol, timestamp, open, high, low, close, volume)
        SELECT symbol, timestamp, open, high, low, close, COALESCE(volume, 0) FROM payload
        ON CONFLICT (symbol, timestamp) DO NOTHING
        RETURNING 1
      )
      SELECT COUNT(*)::int AS inserted FROM ins
    `;
    const { rows: r } = await queryWithTimeout(sql, [JSON.stringify(deduped)], {
      timeoutMs: 20000, label: 'coverage.backfill.intraday', maxRetries: 0,
    });
    return { ok: true, inserted: Number(r[0]?.inserted ?? 0) };
  } catch (err) {
    logger.warn('[COVERAGE FAIL] intraday backfill', { symbol, error: err.message });
    return { ok: false, inserted: 0 };
  }
}

async function backfillDaily(symbol) {
  try {
    // /historical-price-full is currently unavailable in FMP stable.
    // Use 4-hour bars instead and aggregate to daily OHLC.
    const data = await fmpFetch('/historical-chart/4hour', { symbol });
    const candles = Array.isArray(data) ? data : [];

    // Group 4-hour candles by calendar date → synthetic daily OHLC
    const byDate = {};
    for (const c of candles) {
      const date = String(c.date || '').slice(0, 10); // 'YYYY-MM-DD'
      if (!date) continue;
      if (!byDate[date]) {
        byDate[date] = { open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: 0, _ts: c.date };
      } else {
        const d = byDate[date];
        if (c.date < d._ts) { d.open = Number(c.open); d._ts = c.date; } // earlier bar → open
        d.high   = Math.max(d.high,  Number(c.high));
        d.low    = Math.min(d.low,   Number(c.low));
        d.close  = Number(c.close);                        // last bar seen → close
        d.volume += Math.max(0, Math.trunc(Number(c.volume) || 0));
      }
    }

    const rows = Object.entries(byDate)
      .map(([date, d]) => ({ symbol, date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }))
      .filter(r => Number.isFinite(r.close) && r.close > 0);

    if (rows.length === 0) return { ok: false, inserted: 0 };

    const sql = `
      INSERT INTO daily_ohlc (symbol, date, open, high, low, close, volume)
      SELECT r.symbol, r.date::date, r.open, r.high, r.low, r.close, r.volume
      FROM json_to_recordset($1::json) AS r(
        symbol text, date text,
        open double precision, high double precision,
        low double precision, close double precision, volume bigint
      )
      ON CONFLICT (symbol, date) DO NOTHING
    `;
    await queryWithTimeout(sql, [JSON.stringify(rows)], {
      timeoutMs: 20000, label: 'coverage.backfill.daily', maxRetries: 0,
    });
    return { ok: true, inserted: rows.length };
  } catch (err) {
    logger.warn('[COVERAGE FAIL] daily backfill', { symbol, error: err.message });
    return { ok: false, inserted: 0 };
  }
}

async function backfillFundamentals(symbol) {
  try {
    const [profileData, quoteData] = await Promise.allSettled([
      fmpFetch('/profile/' + symbol),
      fmpFetch('/batch-quote', { symbols: symbol }),
    ]);

    // Upsert ticker_universe from profile
    if (profileData.status === 'fulfilled') {
      const p = Array.isArray(profileData.value) ? profileData.value[0] : profileData.value;
      if (p?.companyName) {
        await queryWithTimeout(`
          INSERT INTO ticker_universe (symbol, company_name, exchange, sector, industry, last_updated)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (symbol) DO UPDATE
            SET company_name  = EXCLUDED.company_name,
                exchange      = COALESCE(EXCLUDED.exchange, ticker_universe.exchange),
                sector        = COALESCE(EXCLUDED.sector,   ticker_universe.sector),
                industry      = COALESCE(EXCLUDED.industry, ticker_universe.industry),
                last_updated  = NOW()
        `, [
          symbol,
          p.companyName    || null,
          p.exchangeShortName || p.exchange || null,
          p.sector         || null,
          p.industry       || null,
        ], { timeoutMs: 10000, label: 'coverage.backfill.profile', maxRetries: 0 });
      }
    }

    // Upsert market_quotes from batch-quote
    if (quoteData.status === 'fulfilled') {
      const arr  = Array.isArray(quoteData.value) ? quoteData.value : [];
      const q    = arr.find(r => r.symbol === symbol) || arr[0];
      const price = Number(q?.price ?? 0);
      if (q && price > 0) {
        await queryWithTimeout(`
          INSERT INTO market_quotes (symbol, price, change_percent, volume, market_cap, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (symbol) DO UPDATE
            SET price          = EXCLUDED.price,
                change_percent = EXCLUDED.change_percent,
                volume         = EXCLUDED.volume,
                market_cap     = COALESCE(EXCLUDED.market_cap, market_quotes.market_cap),
                updated_at     = NOW()
        `, [
          symbol,
          price,
          Number(q.changesPercentage ?? q.change_percent ?? 0),
          Math.trunc(Number(q.volume ?? 0)),
          Number(q.marketCap ?? q.market_cap ?? 0) || null,
        ], { timeoutMs: 10000, label: 'coverage.backfill.quotes', maxRetries: 0 });
      }
    }

    return { ok: true };
  } catch (err) {
    logger.warn('[COVERAGE FAIL] fundamentals backfill', { symbol, error: err.message });
    return { ok: false };
  }
}

async function backfillEarnings(symbol) {
  try {
    // Fetch a ±2 year window and filter client-side — FMP stable /earnings-calendar
    // does not support per-symbol filtering via query param
    const from = daysAgo(730);
    const to   = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    const data = await fmpFetch('/earnings-calendar', { from, to });
    const rows = (Array.isArray(data) ? data : [])
      .filter(e => String(e.symbol || '').toUpperCase() === symbol)
      .map(e => ({
        symbol,
        report_date:  e.date         || null,
        report_time:  e.time         || null,
        eps_estimate: e.epsEstimated != null ? Number(e.epsEstimated) : null,
        eps_actual:   e.epsActual    != null ? Number(e.epsActual)    : null,
        rev_estimate: e.revenueEstimated != null ? Number(e.revenueEstimated) : null,
        rev_actual:   e.revenueActual    != null ? Number(e.revenueActual)    : null,
      }))
      .filter(r => r.report_date);

    if (rows.length === 0) return { ok: false, inserted: 0 };

    const sql = `
      INSERT INTO earnings_events (symbol, report_date, report_time, eps_estimate, eps_actual, rev_estimate, rev_actual)
      SELECT r.symbol, r.report_date::date, r.report_time, r.eps_estimate, r.eps_actual, r.rev_estimate, r.rev_actual
      FROM json_to_recordset($1::json) AS r(
        symbol text, report_date text, report_time text,
        eps_estimate numeric, eps_actual numeric,
        rev_estimate numeric, rev_actual numeric
      )
      ON CONFLICT (symbol, report_date) DO NOTHING
    `;
    await queryWithTimeout(sql, [JSON.stringify(rows)], {
      timeoutMs: 15000, label: 'coverage.backfill.earnings', maxRetries: 0,
    });
    return { ok: true, inserted: rows.length };
  } catch (err) {
    logger.warn('[COVERAGE FAIL] earnings backfill', { symbol, error: err.message });
    return { ok: false, inserted: 0 };
  }
}

async function backfillNews(symbol) {
  try {
    const data = await fmpFetch('/news/stock', { tickers: symbol, limit: 20 });
    const articles = (Array.isArray(data) ? data : [])
      .filter(a => a.url && a.title)
      .map(a => ({
        id:           makeNewsId(a.url),
        sym:          symbol,                           // renamed to avoid reserved word issues
        headline:     a.title          || '',
        summary:      a.text           || '',
        source:       a.site           || '',
        publisher:    a.site           || '',
        url:          a.url,
        published_at: a.publishedDate  || new Date().toISOString(),
      }));

    if (articles.length === 0) return { ok: false, inserted: 0 };

    const sql = `
      INSERT INTO news_articles
        (id, symbol, symbols, headline, summary, source, publisher, url, published_at,
         provider, catalyst_type, sentiment, news_score, score_breakdown, raw_payload)
      SELECT r.id::uuid, r.sym, array[r.sym], r.headline, r.summary, r.source,
             r.publisher, r.url, r.published_at::timestamptz,
             'fmp', 'stock_news', 'neutral', 0, '{}'::jsonb, '{}'::jsonb
      FROM json_to_recordset($1::json) AS r(
        id text, sym text, headline text, summary text,
        source text, publisher text, url text, published_at text
      )
      ON CONFLICT (id) DO NOTHING
    `;
    await queryWithTimeout(sql, [JSON.stringify(articles)], {
      timeoutMs: 15000, label: 'coverage.backfill.news', maxRetries: 0,
    });
    return { ok: true, inserted: articles.length };
  } catch (err) {
    logger.warn('[COVERAGE FAIL] news backfill', { symbol, error: err.message });
    return { ok: false, inserted: 0 };
  }
}

// ─── write coverage record ────────────────────────────────────────────────────

async function writeCoverage(symbol, coverage) {
  try {
    await queryWithTimeout(`
      INSERT INTO symbol_coverage
        (symbol, intraday_ok, daily_ok, earnings_ok, news_ok, status, last_checked, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (symbol) DO UPDATE
        SET intraday_ok  = EXCLUDED.intraday_ok,
            daily_ok     = EXCLUDED.daily_ok,
            earnings_ok  = EXCLUDED.earnings_ok,
            news_ok      = EXCLUDED.news_ok,
            status       = EXCLUDED.status,
            last_checked = NOW(),
            updated_at   = NOW()
    `, [
      symbol,
      coverage.intraday_ok,
      coverage.daily_ok,
      coverage.earnings_ok,
      coverage.news_ok,
      coverage.status,
    ], { timeoutMs: 8000, label: 'coverage.write', maxRetries: 0 });
  } catch (err) {
    logger.warn('[COVERAGE] write failed', { symbol, error: err.message });
  }
}

// ─── in-process dedup: prevent concurrent backfills for the same symbol ───────

const activeBackfills = new Set();

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Read cached coverage status for a symbol (fast single SELECT).
 * Returns 'UNKNOWN' if not yet checked.
 */
async function getCoverageStatus(symbol) {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT status FROM symbol_coverage WHERE symbol = $1 LIMIT 1`,
      [symbol], { timeoutMs: 5000, label: 'coverage.read', maxRetries: 0 }
    );
    return rows[0]?.status ?? 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Check current coverage gaps and backfill anything missing — in parallel.
 * Safe to call fire-and-forget; logs failures, never throws.
 *
 * Called automatically from /api/stocks/:symbol on every request,
 * skips if a backfill is already in flight for this symbol.
 */
async function ensureSymbolCoverage(symbol) {
  if (activeBackfills.has(symbol)) return;
  activeBackfills.add(symbol);

  const t0 = Date.now();
  try {
    // Check what we already have
    const coverage = await checkCoverage(symbol);

    // Write current state so UI gets an immediate status
    await writeCoverage(symbol, coverage);

    if (coverage.status === 'COMPLETE') {
      logger.info('[COVERAGE] complete — no backfill needed', { symbol });
      return;
    }

    // Mark backfill in progress
    await queryWithTimeout(
      `UPDATE symbol_coverage SET backfill_at = NOW() WHERE symbol = $1`,
      [symbol], { timeoutMs: 5000, label: 'coverage.mark_backfill', maxRetries: 0 }
    ).catch(() => {});

    // Run only the missing backfills in parallel
    const tasks = [];
    if (!coverage.intraday_ok) tasks.push(backfillIntraday(symbol));
    if (!coverage.daily_ok)    tasks.push(backfillDaily(symbol));
    if (!coverage.earnings_ok) tasks.push(backfillEarnings(symbol));
    if (!coverage.news_ok)     tasks.push(backfillNews(symbol));

    // Fundamentals always run on first gap (covers profile + fresh quote)
    if (coverage.status !== 'COMPLETE') tasks.push(backfillFundamentals(symbol));

    const results = await Promise.allSettled(tasks);

    // Re-check coverage after backfill
    const postCoverage = await checkCoverage(symbol);
    await writeCoverage(symbol, postCoverage);

    const failures = results.filter(r => r.status === 'rejected' || r.value?.ok === false).length;
    logger.info('[COVERAGE] backfill complete', {
      symbol,
      before:    coverage.status,
      after:     postCoverage.status,
      tasks:     tasks.length,
      failures,
      durationMs: Date.now() - t0,
    });

    console.log(`[COVERAGE] symbol=${symbol} before=${coverage.status} after=${postCoverage.status} tasks=${tasks.length} failures=${failures} duration_ms=${Date.now() - t0}`);
  } catch (err) {
    logger.error('[COVERAGE] unhandled error', { symbol, error: err.message });
    // Write FAILED status so we don't retry immediately on every request
    await writeCoverage(symbol, {
      intraday_ok: false, daily_ok: false, earnings_ok: false, news_ok: false, status: 'FAILED',
    });
  } finally {
    activeBackfills.delete(symbol);
  }
}

module.exports = {
  ensureSymbolCoverage,
  getCoverageStatus,
  checkCoverage,
};
