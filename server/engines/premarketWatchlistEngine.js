'use strict';

/**
 * Premarket Watchlist Engine — deterministic, data-only scoring
 *
 * Score formula (no AI, no guessing, only real DB data):
 *   raw = abs(gap_percent)*3 + relative_volume*5 + volume_ratio*2 + news_count*2 + earnings_flag*3
 *   score = round(raw / max_raw * 100, 1)   — normalised 0-100
 *
 * Sources:
 *   market_metrics  — price, change_percent, gap_percent, relative_volume, volume, avg_volume_30d
 *   market_quotes   — price fallback
 *   news_articles   — news_count (symbols ARRAY, last 72h)
 *   earnings_events — earnings_flag (next 3 days)
 */

const { queryWithTimeout } = require('../db/pg');

const ENGINE_LABEL = '[PREMARKET_WATCHLIST]';
const LIMIT        = 50;
const TIMEOUT_MS   = 30000;

/* ── Scoring query ────────────────────────────────────────────────────────── */

const SCORE_SQL = `
WITH
  -- news count per symbol from the symbols ARRAY column (last 72 hours)
  news_counts AS (
    SELECT
      sym       AS symbol,
      COUNT(*)  AS news_count
    FROM (
      SELECT unnest(symbols) AS sym
      FROM   news_articles
      WHERE  published_at >= NOW() - INTERVAL '72 hours'
        AND  array_length(symbols, 1) > 0
    ) t
    GROUP BY sym
  ),

  -- earnings flag: any earnings in next 3 calendar days
  earnings_flags AS (
    SELECT DISTINCT symbol
    FROM   earnings_events
    WHERE  report_date >= CURRENT_DATE
      AND  report_date <  CURRENT_DATE + INTERVAL '4 days'
  ),

  -- base: market_metrics with valid required fields
  base AS (
    SELECT
      mm.symbol,
      COALESCE(mq.price, mm.price)                          AS price,
      mm.change_percent,
      COALESCE(mm.gap_percent, 0)                           AS gap_percent,
      COALESCE(mm.relative_volume, 0)                       AS relative_volume,
      CASE
        WHEN mm.avg_volume_30d > 0
        THEN mm.volume::numeric / mm.avg_volume_30d
        ELSE 0
      END                                                    AS volume_ratio,
      COALESCE(nc.news_count, 0)::int                       AS news_count,
      CASE WHEN ef.symbol IS NOT NULL THEN 1 ELSE 0 END     AS earnings_flag,
      -- raw composite score
      ABS(COALESCE(mm.gap_percent, 0))         * 3
      + COALESCE(mm.relative_volume, 0)        * 5
      + CASE
          WHEN mm.avg_volume_30d > 0
          THEN (mm.volume::numeric / mm.avg_volume_30d) * 2
          ELSE 0
        END
      + COALESCE(nc.news_count, 0)             * 2
      + CASE WHEN ef.symbol IS NOT NULL THEN 3 ELSE 0 END   AS raw_score
    FROM       market_metrics mm
    LEFT JOIN  market_quotes  mq ON mm.symbol = mq.symbol
    LEFT JOIN  news_counts    nc ON mm.symbol = nc.symbol
    LEFT JOIN  earnings_flags ef ON mm.symbol = ef.symbol
    WHERE  COALESCE(mq.price, mm.price) > 0
      AND  mm.change_percent  IS NOT NULL
      AND  mm.relative_volume IS NOT NULL
  ),

  -- max raw for normalisation
  max_raw AS (
    SELECT COALESCE(MAX(raw_score), 1) AS mx FROM base
  )

SELECT
  b.symbol,
  b.price,
  b.change_percent,
  b.gap_percent,
  b.relative_volume,
  b.volume_ratio,
  b.news_count,
  b.earnings_flag,
  ROUND((b.raw_score / mr.mx * 100)::numeric, 1) AS score
FROM base b, max_raw mr
ORDER BY b.raw_score DESC
LIMIT $1
`;

/* ── UPSERT into premarket_watchlist ─────────────────────────────────────── */

const UPSERT_SQL = `
INSERT INTO premarket_watchlist
  (symbol, price, change_percent, gap_percent, relative_volume, volume_ratio,
   news_count, earnings_flag, score, updated_at)
VALUES
  ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
ON CONFLICT (symbol) DO UPDATE SET
  price           = EXCLUDED.price,
  change_percent  = EXCLUDED.change_percent,
  gap_percent     = EXCLUDED.gap_percent,
  relative_volume = EXCLUDED.relative_volume,
  volume_ratio    = EXCLUDED.volume_ratio,
  news_count      = EXCLUDED.news_count,
  earnings_flag   = EXCLUDED.earnings_flag,
  score           = EXCLUDED.score,
  updated_at      = NOW()
`;

/* ── Engine run ──────────────────────────────────────────────────────────── */

async function runPremarketWatchlistEngine() {
  const t0 = Date.now();
  console.log(`${ENGINE_LABEL} starting`);

  let rows;
  try {
    const result = await queryWithTimeout(SCORE_SQL, [LIMIT], {
      timeoutMs: TIMEOUT_MS,
      label:     'premarket_watchlist.score',
      maxRetries: 0,
    });
    rows = result.rows;
  } catch (err) {
    console.error(`${ENGINE_LABEL} score query failed:`, err.message);
    return { ok: false, error: err.message, rows_generated: 0 };
  }

  if (!rows || rows.length === 0) {
    console.warn(`${ENGINE_LABEL} no rows returned from scoring query`);
    return { ok: true, rows_generated: 0 };
  }

  // Upsert each row individually (safe, idempotent)
  let upserted = 0;
  for (const row of rows) {
    try {
      await queryWithTimeout(
        UPSERT_SQL,
        [
          row.symbol,
          row.price,
          row.change_percent,
          row.gap_percent,
          row.relative_volume,
          row.volume_ratio,
          row.news_count,
          row.earnings_flag,
          row.score,
        ],
        { timeoutMs: 5000, label: `premarket_watchlist.upsert.${row.symbol}`, maxRetries: 0 }
      );
      upserted++;
    } catch (err) {
      console.warn(`${ENGINE_LABEL} upsert failed for ${row.symbol}:`, err.message);
    }
  }

  const ms = Date.now() - t0;
  const top = rows[0];
  const avgScore = rows.reduce((s, r) => s + Number(r.score), 0) / rows.length;

  console.log(
    `${ENGINE_LABEL} done — ${upserted} rows upserted, top=${top?.symbol}(${top?.score}), avg_score=${avgScore.toFixed(1)}, ${ms}ms`
  );

  return {
    ok: true,
    rows_generated: upserted,
    top_symbol:     top?.symbol ?? null,
    top_score:      Number(top?.score ?? 0),
    avg_score:      Math.round(avgScore * 10) / 10,
    duration_ms:    ms,
  };
}

/* ── Scheduler bootstrap ─────────────────────────────────────────────────── */

let _timer = null;

function startPremarketWatchlistScheduler(intervalMs = 10 * 60 * 1000) {
  if (_timer) return; // already running

  // Run immediately on startup
  runPremarketWatchlistEngine().catch((err) =>
    console.error(`${ENGINE_LABEL} startup run failed:`, err.message)
  );

  _timer = setInterval(() => {
    runPremarketWatchlistEngine().catch((err) =>
      console.error(`${ENGINE_LABEL} scheduled run failed:`, err.message)
    );
  }, intervalMs);

  console.log(`${ENGINE_LABEL} scheduler started (interval=${intervalMs / 60000}min)`);
}

function stopPremarketWatchlistScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log(`${ENGINE_LABEL} scheduler stopped`);
  }
}

module.exports = {
  runPremarketWatchlistEngine,
  startPremarketWatchlistScheduler,
  stopPremarketWatchlistScheduler,
};
