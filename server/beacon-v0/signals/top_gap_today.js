const {
  buildUniverseClause,
  createResultMap,
  formatNumber,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');

const SIGNAL_NAME = 'top_gap_today';
const CATEGORY = 'price';
const RUN_MODE = 'leaderboard';
const TOP_N = 100;
const MIN_GAP_ABS_PCT = 1.0;
const MIN_PRICE = 1.0;
const MIN_TODAY_VOLUME = 100000;

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const minGapAbsPct = Number(options.minGapAbsPct || MIN_GAP_ABS_PCT);
  const minPrice = Number(options.minPrice || MIN_PRICE);
  const minTodayVolume = Number(options.minTodayVolume || MIN_TODAY_VOLUME);
  const universeFilter = buildUniverseClause(universe, 5);

  const result = await queryWithTimeout(
    `
      WITH latest_session AS (
        SELECT MAX(date) AS d FROM daily_ohlc
      ),
      prior_date AS (
        SELECT MAX(date) AS d
        FROM daily_ohlc
        WHERE date < (SELECT d FROM latest_session)
      ),
      prior_session AS (
        SELECT UPPER(symbol) AS symbol, close AS prior_close, date AS prior_date
        FROM daily_ohlc
        WHERE date = (SELECT d FROM prior_date)
          ${universeFilter.clause}
      ),
      today AS (
        SELECT UPPER(symbol) AS symbol, open, close, volume, date
        FROM daily_ohlc
        WHERE date = (SELECT d FROM latest_session)
          ${universeFilter.clause}
      )
      SELECT
        t.symbol,
        t.open,
        t.close,
        t.volume,
        p.prior_close,
        (((t.open - p.prior_close) / NULLIF(p.prior_close, 0)) * 100)::numeric(10,2) AS gap_pct
      FROM today t
      JOIN prior_session p ON p.symbol = t.symbol
      WHERE p.prior_close > 0
        AND t.open >= $1
        AND t.volume >= $2
        AND ABS(((t.open - p.prior_close) / NULLIF(p.prior_close, 0)) * 100) >= $3
      ORDER BY ABS(((t.open - p.prior_close) / NULLIF(p.prior_close, 0)) * 100) DESC
      LIMIT $4
    `,
    [minPrice, minTodayVolume, minGapAbsPct, topN, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.top_gap_today',
      timeoutMs: 15000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return createResultMap(result.rows, (row, index) => {
    const gapPct = toNumber(row.gap_pct) || 0;
    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score: Math.abs(gapPct),
      metadata: {
        open: toNumber(row.open),
        close: toNumber(row.close),
        prior_close: toNumber(row.prior_close),
        today_volume: toNumber(row.volume),
        gap_pct: gapPct,
      },
      reasoning: `Opened ${gapPct.toFixed(2)}% from prior close on ${formatNumber(row.volume)} shares`,
    };
  });
}

module.exports = { CATEGORY, MIN_GAP_ABS_PCT, MIN_PRICE, MIN_TODAY_VOLUME, RUN_MODE, SIGNAL_NAME, TOP_N, detect };