const { queryWithTimeout } = require('../db/pg');
const { MARKET_QUOTES_TABLE, SIGNALS_TABLE } = require('../../lib/data/authority');

function normalizeLimit(limit, fallback = 50, max = 200) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(1, Math.trunc(parsed)), max);
}

async function fetchUnifiedSignals({ limit = 50, recentHours = null } = {}) {
  const safeLimit = normalizeLimit(limit);
  const safeRecentHours = Number.isFinite(Number(recentHours)) && Number(recentHours) > 0
    ? Math.trunc(Number(recentHours))
    : null;

  const params = [safeLimit];
  let whereSql = '';

  if (safeRecentHours) {
    params.push(safeRecentHours);
    whereSql = `WHERE COALESCE(s.updated_at, s.created_at, now()) > NOW() - make_interval(hours => $${params.length}::int)`;
  }

  const { rows } = await queryWithTimeout(
    `SELECT
      s.symbol,
      COALESCE(NULLIF(s.strategy, ''), 'Momentum Continuation') AS strategy,
      COALESCE(s.class, CASE WHEN COALESCE(s.score, 0) >= 90 THEN 'A' WHEN COALESCE(s.score, 0) >= 75 THEN 'B' ELSE 'C' END) AS class,
      COALESCE(s.score, 0) AS score,
      COALESCE(s.probability, s.confidence, 0) AS probability,
      COALESCE(s.change_percent, m.change_percent, q.change_percent, 0) AS change_percent,
      COALESCE(s.gap_percent, m.gap_percent, 0) AS gap_percent,
      COALESCE(s.relative_volume, m.relative_volume, 0) AS relative_volume,
      COALESCE(s.volume, m.volume, q.volume, 0) AS volume,
      COALESCE(s.rvol, s.relative_volume, m.relative_volume, 0) AS rvol,
      q.sector,
      COALESCE(tc.headline, inews.headline, 'No catalyst') AS catalyst,
      COALESCE(tc.catalyst_type, 'news') AS catalyst_type,
      COALESCE(s.updated_at, s.created_at, now()) AS updated_at,
      COALESCE(s.updated_at, s.created_at, now()) AS timestamp
    FROM ${SIGNALS_TABLE} s
    LEFT JOIN market_metrics m ON m.symbol = s.symbol
    LEFT JOIN ${MARKET_QUOTES_TABLE} q ON q.symbol = s.symbol
    LEFT JOIN LATERAL (
      SELECT headline, catalyst_type
      FROM trade_catalysts c
      WHERE c.symbol = s.symbol
      ORDER BY c.published_at DESC NULLS LAST
      LIMIT 1
    ) tc ON TRUE
    LEFT JOIN LATERAL (
      SELECT headline
      FROM intel_news i
      WHERE i.symbol = s.symbol
      ORDER BY i.published_at DESC NULLS LAST
      LIMIT 1
    ) inews ON TRUE
    ${whereSql}
    ORDER BY COALESCE(s.score, 0) DESC NULLS LAST
    LIMIT $1`,
    params,
    { label: 'services.signal_service.unified', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 120 }
  );

  return rows;
}

module.exports = {
  fetchUnifiedSignals,
};
