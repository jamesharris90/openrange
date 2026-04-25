const {
  buildUniverseClause,
  createResultMap,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');

const SIGNAL_NAME = 'earnings_reaction_last_3d';
const CATEGORY = 'earnings';
const RUN_MODE = 'leaderboard';
const TOP_N = 100;
const LOOKBACK_TRADING_DAYS = 3;
const MIN_ABS_EPS_SURPRISE_PCT = 1.0;

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const lookbackTradingDays = Number(options.lookbackTradingDays || LOOKBACK_TRADING_DAYS);
  const minAbsSurprise = Number(options.minAbsSurprisePct || MIN_ABS_EPS_SURPRISE_PCT);
  const universeFilter = buildUniverseClause(universe, 4);

  const result = await queryWithTimeout(
    `
      WITH recent_report_dates AS (
        SELECT DISTINCT report_date
        FROM earnings_history
        WHERE report_date <= CURRENT_DATE
        ORDER BY report_date DESC
        LIMIT $1
      )
      SELECT
        UPPER(symbol) AS symbol,
        report_date,
        report_time,
        eps_actual,
        eps_estimate,
        eps_surprise_pct,
        revenue_actual,
        revenue_estimate,
        revenue_surprise_pct,
        expected_move_percent,
        actual_move_percent,
        source,
        updated_at
      FROM earnings_history
      WHERE report_date IN (SELECT report_date FROM recent_report_dates)
        AND eps_surprise_pct IS NOT NULL
        AND ABS(eps_surprise_pct) >= $2
        ${universeFilter.clause}
      ORDER BY ABS(eps_surprise_pct) DESC, report_date DESC
      LIMIT $3
    `,
    [lookbackTradingDays, minAbsSurprise, topN, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.earnings_reaction_last_3d',
      timeoutMs: 10000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return createResultMap(result.rows, (row, index) => {
    const epsSurprisePct = toNumber(row.eps_surprise_pct) || 0;
    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score: Math.abs(epsSurprisePct),
      metadata: {
        report_date: row.report_date,
        eps_actual: toNumber(row.eps_actual),
        eps_estimate: toNumber(row.eps_estimate),
        eps_surprise_pct: epsSurprisePct,
        revenue_surprise_pct: toNumber(row.revenue_surprise_pct),
        expected_move_percent: toNumber(row.expected_move_percent),
        actual_move_percent: toNumber(row.actual_move_percent),
        source: row.source,
        updated_at: row.updated_at,
        lookback_trading_days: lookbackTradingDays,
      },
      reasoning: `Reported EPS surprise of ${epsSurprisePct.toFixed(2)}% within the last ${lookbackTradingDays} trading days`,
    };
  });
}

function summarize(metadata = {}) {
  const surprise = toNumber(metadata.eps_surprise_pct ?? metadata.surprise_pct);
  const actual = toNumber(metadata.eps_actual);
  const estimate = toNumber(metadata.eps_estimate);
  const context = actual != null && estimate != null
    ? ` ($${actual.toFixed(2)} vs $${estimate.toFixed(2)} estimate)`
    : '';

  if (surprise == null) return `reported earnings recently${context}`;
  const sign = surprise >= 0 ? '+' : '';
  return `reported ${sign}${surprise.toFixed(1)}% earnings surprise${context}`;
}

module.exports = { CATEGORY, LOOKBACK_TRADING_DAYS, MIN_ABS_EPS_SURPRISE_PCT, RUN_MODE, SIGNAL_NAME, TOP_N, detect, summarize };