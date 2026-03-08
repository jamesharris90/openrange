const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function classifyStrategy(row) {
  const gapPercent = toNumber(row.gap_percent);
  const rvol = toNumber(row.relative_volume);
  const rsi = toNumber(row.rsi);

  if (gapPercent > 6) return 'Gap and Go';
  if (rvol > 4) return 'Momentum Continuation';
  if (gapPercent > 3 && rsi < 70) return 'VWAP Reclaim candidate';
  return 'Breakout Watch';
}

function calculateScore(row) {
  const rvol = toNumber(row.relative_volume);
  const gapPercent = toNumber(row.gap_percent);
  const atrPercent = toNumber(row.atr_percent);
  const floatShares = toNumber(row.float_shares);

  return (rvol * 100) + (gapPercent * 50) + (atrPercent * 25) - (floatShares / 10000000);
}

async function ensureTradeSignalsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS trade_signals (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL UNIQUE,
      strategy TEXT NOT NULL,
      score NUMERIC NOT NULL,
      gap_percent NUMERIC,
      rvol NUMERIC,
      atr_percent NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_table', maxRetries: 0 }
  );
}

async function runStocksInPlayEngine() {
  await ensureTradeSignalsTable();

  let { rows } = await queryWithTimeout(
    `SELECT
      symbol,
      COALESCE(relative_volume, 0) AS relative_volume,
      COALESCE(gap_percent, 0) AS gap_percent,
      COALESCE(atr_percent, 0) AS atr_percent,
      COALESCE(float_shares, 0) AS float_shares,
      COALESCE(rsi, 0) AS rsi
     FROM market_metrics
     WHERE COALESCE(relative_volume, 0) > 2
       AND COALESCE(gap_percent, 0) > 3
       AND COALESCE(atr_percent, 0) > 1
     ORDER BY
       ((COALESCE(relative_volume, 0) * 100)
       + (COALESCE(gap_percent, 0) * 50)
       + (COALESCE(atr_percent, 0) * 25)
       - (COALESCE(float_shares, 0) / 10000000.0)) DESC
     LIMIT 20`,
    [],
    { timeoutMs: 10000, label: 'engines.stocks_in_play.select_market_metrics', maxRetries: 0 }
  );

  if (!rows.length) {
    logger.warn('[STOCKS_IN_PLAY] strict filter returned no rows; using fallback thresholds');
    const fallbackResult = await queryWithTimeout(
      `SELECT
        symbol,
        COALESCE(relative_volume, 0) AS relative_volume,
        COALESCE(gap_percent, 0) AS gap_percent,
        COALESCE(atr_percent, 0) AS atr_percent,
        COALESCE(float_shares, 0) AS float_shares,
        COALESCE(rsi, 0) AS rsi
       FROM market_metrics
       WHERE COALESCE(relative_volume, 0) > 1
         AND COALESCE(gap_percent, 0) > 1
         AND COALESCE(atr_percent, 0) > 0.5
       ORDER BY
         ((COALESCE(relative_volume, 0) * 100)
         + (COALESCE(gap_percent, 0) * 50)
         + (COALESCE(atr_percent, 0) * 25)
         - (COALESCE(float_shares, 0) / 10000000.0)) DESC
       LIMIT 20`,
      [],
      { timeoutMs: 10000, label: 'engines.stocks_in_play.select_market_metrics_fallback', maxRetries: 0 }
    );
    rows = fallbackResult.rows;
  }

  if (!rows.length) {
    logger.warn('[STOCKS_IN_PLAY] fallback thresholds returned no rows; using broad ranking set');
    const broadResult = await queryWithTimeout(
      `SELECT
        symbol,
        COALESCE(relative_volume, 0) AS relative_volume,
        COALESCE(gap_percent, 0) AS gap_percent,
        COALESCE(atr_percent, 0) AS atr_percent,
        COALESCE(float_shares, 0) AS float_shares,
        COALESCE(rsi, 0) AS rsi
       FROM market_metrics
       WHERE symbol IS NOT NULL
       ORDER BY
         ((COALESCE(relative_volume, 0) * 100)
         + (COALESCE(gap_percent, 0) * 50)
         + (COALESCE(atr_percent, 0) * 25)
         - (COALESCE(float_shares, 0) / 10000000.0)) DESC
       LIMIT 20`,
      [],
      { timeoutMs: 10000, label: 'engines.stocks_in_play.select_market_metrics_broad', maxRetries: 0 }
    );
    rows = broadResult.rows;
  }

  let inserted = 0;
  for (const row of rows) {
    const strategy = classifyStrategy(row);
    const score = calculateScore(row);

    await queryWithTimeout(
      `INSERT INTO trade_signals (
        symbol,
        strategy,
        score,
        gap_percent,
        rvol,
        atr_percent,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (symbol)
      DO UPDATE SET
        strategy = EXCLUDED.strategy,
        score = EXCLUDED.score,
        gap_percent = EXCLUDED.gap_percent,
        rvol = EXCLUDED.rvol,
        atr_percent = EXCLUDED.atr_percent,
        updated_at = NOW()`,
      [
        row.symbol,
        strategy,
        score,
        toNumber(row.gap_percent),
        toNumber(row.relative_volume),
        toNumber(row.atr_percent),
      ],
      { timeoutMs: 7000, label: 'engines.stocks_in_play.upsert_trade_signal', maxRetries: 0 }
    );
    inserted += 1;
  }

  logger.info('[STOCKS_IN_PLAY] run complete', { selected: rows.length, upserted: inserted });
  return { selected: rows.length, upserted: inserted };
}

module.exports = {
  runStocksInPlayEngine,
};
