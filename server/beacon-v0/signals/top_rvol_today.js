const {
  buildUniverseClause,
  createResultMap,
  formatNumber,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');

const SIGNAL_NAME = 'top_rvol_today';
const CATEGORY = 'volume';
const RUN_MODE = 'leaderboard';
const TOP_N = 100;
const MIN_RVOL = 1.5;
const MIN_AVG_VOLUME = 100000;

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const minRvol = Number(options.minRvol || MIN_RVOL);
  const minAvgVolume = Number(options.minAvgVolume || MIN_AVG_VOLUME);
  const universeFilter = buildUniverseClause(universe, 4);

  const result = await queryWithTimeout(
    `
      WITH latest_session AS (
        SELECT MAX(date) AS d FROM daily_ohlc
      ),
      avg_vol AS (
        SELECT
          UPPER(symbol) AS symbol,
          AVG(volume)::bigint AS avg_volume_20d
        FROM daily_ohlc
        WHERE date >= (SELECT d FROM latest_session) - INTERVAL '30 days'
          AND date < (SELECT d FROM latest_session)
          ${universeFilter.clause}
        GROUP BY UPPER(symbol)
        HAVING AVG(volume) >= $1
      ),
      today_vol AS (
        SELECT UPPER(symbol) AS symbol, volume AS today_volume
        FROM daily_ohlc
        WHERE date = (SELECT d FROM latest_session)
          ${universeFilter.clause}
      )
      SELECT
        t.symbol,
        t.today_volume,
        a.avg_volume_20d,
        (t.today_volume::numeric / NULLIF(a.avg_volume_20d::numeric, 0))::numeric(10,2) AS rvol
      FROM today_vol t
      JOIN avg_vol a ON a.symbol = t.symbol
      WHERE (t.today_volume::numeric / NULLIF(a.avg_volume_20d::numeric, 0)) >= $2
      ORDER BY rvol DESC NULLS LAST
      LIMIT $3
    `,
    [minAvgVolume, minRvol, topN, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.top_rvol_today',
      timeoutMs: 15000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return createResultMap(result.rows, (row, index) => {
    const rvol = toNumber(row.rvol) || 0;
    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score: rvol,
      metadata: {
        today_volume: toNumber(row.today_volume),
        avg_volume_20d: toNumber(row.avg_volume_20d),
        rvol,
      },
      reasoning: `Trading at ${rvol.toFixed(2)}x average volume (${formatNumber(row.today_volume)} vs ${formatNumber(row.avg_volume_20d)} avg)`,
    };
  });
}

module.exports = { CATEGORY, MIN_AVG_VOLUME, MIN_RVOL, RUN_MODE, SIGNAL_NAME, TOP_N, detect };