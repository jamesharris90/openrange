/**
 * Signal: top_coiled_spring
 *
 * Forward-looking compression detector.
 *
 * Identifies stocks where:
 * - Price range over last 5 days is unusually tight vs 20-day baseline (compression)
 * - Volume over last 5 days has declined vs 20-day baseline (volume drying up)
 *
 * Combined score = compression_score + volume_drying_score.
 * Top 100 ranked by combined score, descending.
 *
 * Status: scaffolded but NOT wired into orchestrator (Phase 48).
 * Will be wired in Phase 49.
 */

const {
  buildUniverseClause,
  createResultMap,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');

const SIGNAL_NAME = 'top_coiled_spring';
const CATEGORY = 'compression';
const RUN_MODE = 'leaderboard';
const FORWARD_LOOKING = true;
const TOP_N = 100;
const MIN_20D_AVG_VOLUME = 250000;
const MIN_5D_AVG_VOLUME = 100000;
const MIN_PRICE = 5.0;
const MIN_ATR_20D = 0.10;

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const min20dAvgVolume = Number(options.min20dAvgVolume || MIN_20D_AVG_VOLUME);
  const min5dAvgVolume = Number(options.min5dAvgVolume || MIN_5D_AVG_VOLUME);
  const minPrice = Number(options.minPrice || MIN_PRICE);
  const minAtr20d = Number(options.minAtr20d || MIN_ATR_20D);
  const universeFilter = buildUniverseClause(universe, 6);

  const result = await queryWithTimeout(
    `
      WITH latest_session AS (
        SELECT MAX(date) AS d FROM daily_ohlc
      ),
      daily_ranges AS (
        SELECT
          UPPER(symbol) AS symbol,
          date,
          (high - low) AS daily_range,
          volume,
          close,
          ROW_NUMBER() OVER (PARTITION BY UPPER(symbol) ORDER BY date DESC) AS days_back
        FROM daily_ohlc
        WHERE date <= (SELECT d FROM latest_session)
          AND date > (SELECT d FROM latest_session) - INTERVAL '40 days'
          ${universeFilter.clause}
      ),
      symbol_stats AS (
        SELECT
          symbol,
          AVG(daily_range) FILTER (WHERE days_back <= 5) AS atr_5d,
          AVG(daily_range) FILTER (WHERE days_back <= 20) AS atr_20d,
          AVG(volume) FILTER (WHERE days_back <= 5) AS vol_5d,
          AVG(volume) FILTER (WHERE days_back <= 20) AS vol_20d,
          MAX(close) FILTER (WHERE days_back = 1) AS latest_close,
          COUNT(*) FILTER (WHERE days_back <= 20) AS data_points
        FROM daily_ranges
        GROUP BY symbol
      )
      SELECT
        symbol,
        latest_close,
        atr_5d,
        atr_20d,
        vol_5d,
        vol_20d,
        (atr_5d / NULLIF(atr_20d, 0))::numeric(10, 4) AS atr_ratio,
        (vol_5d / NULLIF(vol_20d, 0))::numeric(10, 4) AS vol_ratio,
        ((1.0 - LEAST(atr_5d / NULLIF(atr_20d, 0), 1.5)) +
         (1.0 - LEAST(vol_5d / NULLIF(vol_20d, 0), 1.5)))::numeric(10, 4) AS compression_score
      FROM symbol_stats
      WHERE data_points >= 18
        AND atr_20d > $4
        AND vol_20d >= $1
        AND vol_5d >= $5
        AND latest_close >= $2
        AND atr_5d / NULLIF(atr_20d, 0) < 1.0
        AND vol_5d / NULLIF(vol_20d, 0) < 1.0
      ORDER BY compression_score DESC
      LIMIT $3
    `,
    [min20dAvgVolume, minPrice, topN, minAtr20d, min5dAvgVolume, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.top_coiled_spring',
      timeoutMs: 20000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return createResultMap(result.rows, (row, index) => {
    const atrRatio = toNumber(row.atr_ratio) || 0;
    const volRatio = toNumber(row.vol_ratio) || 0;
    const compressionPct = Math.round((1 - atrRatio) * 100);
    const volDryPct = Math.round((1 - volRatio) * 100);

    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score: toNumber(row.compression_score) || 0,
      metadata: {
        atr_5d: toNumber(row.atr_5d),
        atr_20d: toNumber(row.atr_20d),
        atr_ratio: atrRatio,
        vol_5d: toNumber(row.vol_5d),
        vol_20d: toNumber(row.vol_20d),
        vol_ratio: volRatio,
        compression_pct: compressionPct,
        vol_dry_pct: volDryPct,
        latest_close: toNumber(row.latest_close),
      },
      reasoning: `Daily range ${compressionPct}% below 20d avg, volume ${volDryPct}% below 20d avg`,
    };
  });
}

function summarize(metadata = {}) {
  const compressionPct = toNumber(metadata.compression_pct);
  const volDryPct = toNumber(metadata.vol_dry_pct);
  if (compressionPct == null || volDryPct == null) return null;
  return `range compressed ${compressionPct}% vs 20d, volume ${volDryPct}% below avg`;
}

module.exports = {
  CATEGORY,
  FORWARD_LOOKING,
  MIN_20D_AVG_VOLUME,
  MIN_5D_AVG_VOLUME,
  MIN_ATR_20D,
  MIN_PRICE,
  RUN_MODE,
  SIGNAL_NAME,
  TOP_N,
  detect,
  summarize,
};
