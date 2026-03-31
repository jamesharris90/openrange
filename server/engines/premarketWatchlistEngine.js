'use strict';

/**
 * Premarket Watchlist Engine — V2
 *
 * Score formula (capped inputs + time decay):
 *   raw = (gap_abs*2) + (rvol*3) + (vol_ratio*2) + (news_count*2) + (earnings_flag*2)
 *   score = raw * decay_factor * (0.5 if EXHAUSTED else 1.0)
 *
 * Input caps:
 *   gap_abs   = MIN(ABS(gap_percent), 20)
 *   rvol      = MIN(relative_volume, 10)
 *   vol_ratio = MIN(volume / avg_volume_30d, 10)
 *   news_count = MIN(news_count_72h, 5)
 *
 * Time decay (based on latest news age):
 *   < 720 min  → 1.0
 *   < 1440 min → 0.7
 *   < 2880 min → 0.4
 *   else       → 0.2
 *
 * Stage classification:
 *   EARLY:    ABS(gap) > 5 AND rvol < 2
 *   ACTIVE:   rvol >= 2 AND ABS(change_percent) < 50
 *   EXHAUSTED: ABS(change_percent) > 80  (with 0.5 score penalty)
 *   NEUTRAL:  everything else
 *
 * Signal logging:
 *   EARLY / ACTIVE rows are written to signal_log (deduped per 30 min per symbol)
 */

const { queryWithTimeout } = require('../db/pg');

const ENGINE_LABEL = '[PREMARKET_V2]';
const LIMIT        = 50;
const TIMEOUT_MS   = 30_000;

/* ── Scoring query ────────────────────────────────────────────────────────── */

const SCORE_SQL = `
WITH
  -- news count + latest timestamp per symbol (last 72h)
  news_data AS (
    SELECT
      sym                  AS symbol,
      COUNT(*)             AS news_count,
      MAX(t.published_at)  AS latest_news_ts
    FROM (
      SELECT unnest(symbols) AS sym, published_at
      FROM   news_articles
      WHERE  published_at >= NOW() - INTERVAL '72 hours'
        AND  array_length(symbols, 1) > 0
    ) t
    GROUP BY sym
  ),

  -- earnings flag: any report in next 4 calendar days
  earnings_flags AS (
    SELECT DISTINCT symbol
    FROM   earnings_events
    WHERE  report_date >= CURRENT_DATE
      AND  report_date <  CURRENT_DATE + INTERVAL '4 days'
  ),

  -- base with capped inputs
  base AS (
    SELECT
      mm.symbol,
      COALESCE(mq.price, mm.price)                                 AS price,
      mm.change_percent,
      COALESCE(mm.gap_percent, 0)                                  AS gap_percent,

      -- scoring caps
      LEAST(ABS(COALESCE(mm.gap_percent, 0)), 20)                  AS gap_abs,
      LEAST(COALESCE(mm.relative_volume, 0), 10)                   AS rvol,
      LEAST(
        CASE WHEN mm.avg_volume_30d > 0
             THEN mm.volume::numeric / mm.avg_volume_30d
             ELSE 0
        END, 10
      )                                                            AS vol_ratio,
      LEAST(COALESCE(nd.news_count, 0)::int, 5)                    AS news_cnt,
      CASE WHEN ef.symbol IS NOT NULL THEN 1 ELSE 0 END            AS earnings_flag,

      -- news age in minutes (default 99999 = no recent news)
      COALESCE(
        EXTRACT(EPOCH FROM (NOW() - nd.latest_news_ts)) / 60.0,
        99999
      )                                                            AS news_age_minutes

    FROM       market_metrics mm
    LEFT JOIN  market_quotes  mq ON mm.symbol = mq.symbol
    LEFT JOIN  news_data      nd ON mm.symbol = nd.symbol
    LEFT JOIN  earnings_flags ef ON mm.symbol = ef.symbol
    WHERE  COALESCE(mq.price, mm.price) > 0
      AND  mm.change_percent  IS NOT NULL
      AND  mm.relative_volume IS NOT NULL
  ),

  -- decay + stage
  staged AS (
    SELECT
      b.*,

      CASE
        WHEN b.news_age_minutes < 720   THEN 1.0
        WHEN b.news_age_minutes < 1440  THEN 0.7
        WHEN b.news_age_minutes < 2880  THEN 0.4
        ELSE                                 0.2
      END                                                          AS decay_factor,

      CASE
        WHEN ABS(COALESCE(b.gap_percent, 0)) > 5
             AND b.rvol < 2
          THEN 'EARLY'
        WHEN b.rvol >= 2
             AND ABS(COALESCE(b.change_percent, 0)) < 50
          THEN 'ACTIVE'
        WHEN ABS(COALESCE(b.change_percent, 0)) > 80
          THEN 'EXHAUSTED'
        ELSE 'NEUTRAL'
      END                                                          AS stage

    FROM base b
  ),

  -- premarket intelligence adjustments from prior engine run
  intelligence AS (
    SELECT
      symbol,
      premarket_valid,
      premarket_gap_confidence,
      premarket_signal_type
    FROM premarket_watchlist
    WHERE premarket_trend IS NOT NULL
  ),

  -- final score with exhaustion penalty + intelligence adjustments
  final AS (
    SELECT
      s.*,
      i.premarket_valid,
      i.premarket_gap_confidence,
      i.premarket_signal_type,
      (
          s.gap_abs         * 2
        + s.rvol            * 3
        + s.vol_ratio       * 2
        + s.news_cnt        * 2
        + s.earnings_flag   * 2
      ) * s.decay_factor
        * CASE WHEN s.stage = 'EXHAUSTED' THEN 0.5 ELSE 1.0 END
        -- Phase 9: premarket intelligence score adjustments
        + CASE WHEN i.premarket_valid = TRUE  THEN 10
               WHEN i.premarket_valid = FALSE THEN -10
               ELSE 0 END
        + CASE WHEN i.premarket_gap_confidence = 'HIGH' THEN 10 ELSE 0 END
        + CASE WHEN i.premarket_signal_type = 'GAP_AND_GO' THEN 10 ELSE 0 END
        - CASE WHEN i.premarket_signal_type = 'UNDEFINED'  THEN 5  ELSE 0 END
                                                                           AS raw_score
    FROM staged s
    LEFT JOIN intelligence i ON i.symbol = s.symbol
  )

SELECT
  f.symbol,
  f.price,
  f.change_percent,
  f.gap_percent,
  f.rvol                   AS relative_volume,
  f.vol_ratio              AS volume_ratio,
  f.news_cnt               AS news_count,
  f.earnings_flag,
  f.stage,
  ROUND(f.news_age_minutes::numeric, 0)  AS news_age_minutes,
  f.decay_factor,
  -- Phase 2 + Phase 9: integer score with trust caps
  -- Allow 100 only if: gap>10, rvol>5, news>=2, stage=ACTIVE, move<60
  -- Otherwise cap at 90
  ROUND(
    LEAST(
      GREATEST(f.raw_score::numeric, 0),
      CASE
        WHEN f.gap_abs > 10
             AND f.rvol  > 5
             AND f.news_cnt >= 2
             AND f.stage = 'ACTIVE'
             AND ABS(COALESCE(f.change_percent, 0)) < 60
        THEN 100.0
        ELSE 90.0
      END
    )
  )::int                                 AS score,
  ROUND(
    RANK() OVER (ORDER BY f.raw_score DESC)::numeric
    / NULLIF(COUNT(*) OVER (), 0),
    4
  )                                      AS rank_percentile
FROM final f
ORDER BY f.raw_score DESC
LIMIT $1
`;

/* ── UPSERT into premarket_watchlist ─────────────────────────────────────── */

const UPSERT_SQL = `
INSERT INTO premarket_watchlist
  (symbol, price, change_percent, gap_percent, relative_volume, volume_ratio,
   news_count, earnings_flag, stage, news_age_minutes, decay_factor,
   score, rank_percentile, last_calculated_at, updated_at)
VALUES
  ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW(), NOW())
ON CONFLICT (symbol) DO UPDATE SET
  price               = EXCLUDED.price,
  change_percent      = EXCLUDED.change_percent,
  gap_percent         = EXCLUDED.gap_percent,
  relative_volume     = EXCLUDED.relative_volume,
  volume_ratio        = EXCLUDED.volume_ratio,
  news_count          = EXCLUDED.news_count,
  earnings_flag       = EXCLUDED.earnings_flag,
  stage               = EXCLUDED.stage,
  news_age_minutes    = EXCLUDED.news_age_minutes,
  decay_factor        = EXCLUDED.decay_factor,
  score               = EXCLUDED.score,
  rank_percentile     = EXCLUDED.rank_percentile,
  last_calculated_at  = EXCLUDED.last_calculated_at,
  updated_at          = NOW()
`;

/* ── Signal log insertion (deduped per 30 min per symbol) ─────────────────── */

const SIGNAL_LOG_SQL = `
INSERT INTO signal_log (symbol, score, stage, entry_price, expected_move, setup_type)
SELECT $1, $2, $3, $4, $5, $6
WHERE NOT EXISTS (
  SELECT 1 FROM signal_log
  WHERE symbol = $1
    AND timestamp > NOW() - INTERVAL '2 hours'
)
`;

/* ── Engine run ──────────────────────────────────────────────────────────── */

async function runPremarketWatchlistEngine() {
  const t0 = Date.now();
  console.log(`${ENGINE_LABEL} starting`);

  let rows;
  try {
    const result = await queryWithTimeout(SCORE_SQL, [LIMIT], {
      timeoutMs:  TIMEOUT_MS,
      label:      'premarket_v2.score',
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

  // Upsert each row
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
          row.stage,
          row.news_age_minutes,
          row.decay_factor,
          row.score,
          row.rank_percentile,
        ],
        { timeoutMs: 5000, label: `premarket_v2.upsert.${row.symbol}`, maxRetries: 0, poolType: 'write' }
      );
      upserted++;
    } catch (err) {
      console.warn(`${ENGINE_LABEL} upsert failed for ${row.symbol}:`, err.message);
    }
  }

  // Purge stale rows not updated in this run (cleans up V1 / old rows)
  try {
    const deleted = await queryWithTimeout(
      `DELETE FROM premarket_watchlist WHERE updated_at < NOW() - INTERVAL '2 minutes'`,
      [],
      { timeoutMs: 5000, label: 'premarket_v2.purge', maxRetries: 0, poolType: 'write' }
    );
    if (deleted.rowCount > 0) {
      console.log(`${ENGINE_LABEL} purged ${deleted.rowCount} stale rows`);
    }
  } catch (err) {
    console.warn(`${ENGINE_LABEL} purge failed:`, err.message);
  }

  // Log signals for EARLY / ACTIVE rows (learning loop feed)
  let signalsLogged = 0;
  const loggableRows = rows.filter(r => r.stage === 'EARLY' || r.stage === 'ACTIVE');
  for (const row of loggableRows) {
    const entryPrice  = Number(row.price);
    const expectedMove = Math.abs(Number(row.change_percent) || 0);
    if (!entryPrice || entryPrice <= 0) continue;

    try {
      const result = await queryWithTimeout(
        SIGNAL_LOG_SQL,
        [row.symbol, row.score, row.stage, entryPrice, expectedMove,
         row.premarket_signal_type || row.stage],
        { timeoutMs: 5000, label: `premarket_v2.signal_log.${row.symbol}`, maxRetries: 0, poolType: 'write' }
      );
      if (result.rowCount > 0) signalsLogged++;
    } catch (err) {
      console.warn(`${ENGINE_LABEL} signal_log insert failed for ${row.symbol}:`, err.message);
    }
  }

  const ms = Date.now() - t0;
  const top = rows[0];

  // Stage distribution
  const stageDist = rows.reduce((acc, r) => {
    acc[r.stage] = (acc[r.stage] || 0) + 1;
    return acc;
  }, {});

  const avgScore = rows.reduce((s, r) => s + Number(r.score), 0) / rows.length;

  console.log(
    `${ENGINE_LABEL} done — upserted=${upserted} signals_logged=${signalsLogged}` +
    ` top=${top?.symbol}(${top?.score}) stage=${top?.stage}` +
    ` avg=${avgScore.toFixed(2)} dist=${JSON.stringify(stageDist)} ${ms}ms`
  );

  return {
    ok:              true,
    rows_generated:  upserted,
    signals_logged:  signalsLogged,
    top_symbol:      top?.symbol ?? null,
    top_score:       Number(top?.score ?? 0),
    top_stage:       top?.stage ?? null,
    avg_score:       Math.round(avgScore * 100) / 100,
    stage_distribution: stageDist,
    duration_ms:     ms,
  };
}

/* ── Scheduler ───────────────────────────────────────────────────────────── */

let _timer = null;

function startPremarketWatchlistScheduler(intervalMs = 10 * 60 * 1000) {
  if (_timer) return;

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
