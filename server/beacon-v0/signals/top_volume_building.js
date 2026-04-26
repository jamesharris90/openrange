/**
 * Signal: top_volume_building
 *
 * Forward-looking accumulation detector.
 *
 * Identifies stocks where:
 * - 5-day average volume is meaningfully higher than 20-day baseline
 *   (volume rising = interest building)
 * - 5-day price change is small (price still quiet)
 *
 * The combination "volume rising while price quiet" is classic accumulation —
 * buyers absorbing shares without driving the price up. Often precedes breakout
 * when accumulation completes.
 *
 * Differs from top_rvol_today (single-day relative volume — already moved) and
 * top_coiled_spring (volatility compression — quiet not necessarily rising) by
 * specifically requiring rising volume + quiet price.
 *
 * Top 100 ranked by combined accumulation score.
 */

const {
  buildUniverseClause,
  createResultMap,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');

const SIGNAL_NAME = 'top_volume_building';
const CATEGORY = 'accumulation';
const RUN_MODE = 'leaderboard';
const FORWARD_LOOKING = true;
const TOP_N = 100;
const MIN_20D_AVG_VOLUME = 250000;
const MIN_PRICE = 5.0;
const MIN_VOL_RATIO = 1.4;
const MAX_PRICE_CHANGE_5D = 0.05;

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const min20dAvgVolume = Number(options.min20dAvgVolume || MIN_20D_AVG_VOLUME);
  const minPrice = Number(options.minPrice || MIN_PRICE);
  const minVolRatio = Number(options.minVolRatio || MIN_VOL_RATIO);
  const maxPriceChange5d = Number(options.maxPriceChange5d || MAX_PRICE_CHANGE_5D);
  const universeFilter = buildUniverseClause(universe, 6);

  const result = await queryWithTimeout(
    `
      WITH latest_session AS (
        SELECT MAX(date) AS d FROM daily_ohlc
      ),
      daily_data AS (
        SELECT
          UPPER(symbol) AS symbol,
          date,
          close,
          volume,
          ROW_NUMBER() OVER (PARTITION BY UPPER(symbol) ORDER BY date DESC) AS days_back
        FROM daily_ohlc
        WHERE date <= (SELECT d FROM latest_session)
          AND date > (SELECT d FROM latest_session) - INTERVAL '40 days'
          ${universeFilter.clause}
      ),
      symbol_stats AS (
        SELECT
          symbol,
          AVG(volume) FILTER (WHERE days_back <= 5) AS vol_5d,
          AVG(volume) FILTER (WHERE days_back <= 20) AS vol_20d,
          MAX(close) FILTER (WHERE days_back = 1) AS latest_close,
          MAX(close) FILTER (WHERE days_back = 5) AS close_5d_ago,
          COUNT(*) FILTER (WHERE days_back <= 20) AS data_points
        FROM daily_data
        GROUP BY symbol
      )
      SELECT
        symbol,
        latest_close,
        vol_5d,
        vol_20d,
        close_5d_ago,
        (vol_5d / NULLIF(vol_20d, 0))::numeric(10, 4) AS vol_ratio,
        ABS((latest_close - close_5d_ago) / NULLIF(close_5d_ago, 0))::numeric(10, 4) AS price_change_5d,
        ((vol_5d / NULLIF(vol_20d, 0)) - 1.0)::numeric(10, 4) AS accumulation_score
      FROM symbol_stats
      WHERE data_points >= 18
        AND vol_20d >= $1
        AND latest_close >= $2
        AND close_5d_ago > 0
        AND vol_5d / NULLIF(vol_20d, 0) >= $3
        AND ABS((latest_close - close_5d_ago) / NULLIF(close_5d_ago, 0)) <= $4
      ORDER BY accumulation_score DESC
      LIMIT $5
    `,
    [min20dAvgVolume, minPrice, minVolRatio, maxPriceChange5d, topN, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.top_volume_building',
      timeoutMs: 20000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return createResultMap(result.rows, (row, index) => {
    const volRatio = toNumber(row.vol_ratio) || 0;
    const volIncreasePct = Math.round((volRatio - 1) * 100);
    const priceChange = toNumber(row.price_change_5d) || 0;
    const priceChangePct = Number((priceChange * 100).toFixed(1));

    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score: toNumber(row.accumulation_score) || 0,
      metadata: {
        vol_5d: toNumber(row.vol_5d),
        vol_20d: toNumber(row.vol_20d),
        vol_ratio: volRatio,
        vol_increase_pct: volIncreasePct,
        latest_close: toNumber(row.latest_close),
        close_5d_ago: toNumber(row.close_5d_ago),
        price_change_5d_pct: priceChangePct,
      },
      reasoning: `Volume ${volIncreasePct}% above 20d avg, price move only ${priceChangePct.toFixed(1)}% over 5d (accumulation pattern)`,
    };
  });
}

function summarize(metadata = {}) {
  const volIncrease = toNumber(metadata.vol_increase_pct);
  const priceChange = toNumber(metadata.price_change_5d_pct);
  if (volIncrease == null || priceChange == null) return null;
  return `volume building ${volIncrease}% above 20d while price quiet (${priceChange.toFixed(1)}% over 5d)`;
}

module.exports = {
  CATEGORY,
  FORWARD_LOOKING,
  MAX_PRICE_CHANGE_5D,
  MIN_20D_AVG_VOLUME,
  MIN_PRICE,
  MIN_VOL_RATIO,
  RUN_MODE,
  SIGNAL_NAME,
  TOP_N,
  detect,
  summarize,
};
