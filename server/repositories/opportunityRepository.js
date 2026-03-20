const { queryWithTimeout } = require('../db/pg');
const { OPPORTUNITIES_TABLE } = require('../lib/data/authority');

function hasSupabaseClient(client) {
  return Boolean(client && typeof client.from === 'function');
}

async function getRecentOpportunityStream(client, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
  const table = OPPORTUNITIES_TABLE;

  if (hasSupabaseClient(client)) {
    const { data, error } = await client
      .from(table)
      .select('symbol,setup_type,score,detected_at,updated_at')
      .order('detected_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  const result = await queryWithTimeout(
    `SELECT symbol,
            setup_type,
            score,
            detected_at,
            updated_at
     FROM ${table}
     ORDER BY COALESCE(detected_at, updated_at) DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 3000, label: 'repository.opportunities.stream', maxRetries: 0 }
  );

  return result.rows || [];
}

async function getTopOpportunities(client, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 100));

  if (hasSupabaseClient(client)) {
    const { data, error } = await client
      .from(OPPORTUNITIES_TABLE)
      .select('symbol,setup_type,score,detected_at,updated_at')
      .order('detected_at', { ascending: false })
      .limit(Math.max(limit * 20, 100));

    if (error) throw error;

    const dedupedBySymbol = new Map();
    for (const row of (data || [])) {
      if (!row?.symbol || dedupedBySymbol.has(row.symbol)) continue;
      dedupedBySymbol.set(row.symbol, row);
    }

    return [...dedupedBySymbol.values()]
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, limit);
  }

  const result = await queryWithTimeout(
    `WITH ranked AS (
       SELECT
         ts.symbol,
         ts.setup_type,
         ts.score,
         COALESCE(ts.detected_at, ts.updated_at) AS updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY ts.symbol
           ORDER BY COALESCE(ts.detected_at, ts.updated_at) DESC
         ) AS rank_per_symbol
       FROM ${OPPORTUNITIES_TABLE} ts
     )
     SELECT symbol, setup_type, score, updated_at
     FROM ranked
     WHERE rank_per_symbol = 1
     ORDER BY score DESC NULLS LAST, updated_at DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 3000, label: 'repository.opportunities.top', maxRetries: 0 }
  );

  return result.rows || [];
}

async function getOpportunityCountLast24h(client) {
  const table = OPPORTUNITIES_TABLE;

  if (hasSupabaseClient(client)) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await client
      .from(table)
      .select('symbol', { count: 'exact', head: true })
      .gte('detected_at', since);

    if (error) throw error;

    return Number(count || 0);
  }

  const result = await queryWithTimeout(
    `SELECT COUNT(*)::int AS count
     FROM ${table}
     WHERE COALESCE(detected_at, updated_at) > NOW() - INTERVAL '24 hours'`,
    [],
    { timeoutMs: 3000, label: 'repository.opportunities.count_24h', maxRetries: 0 }
  );

  return Number(result.rows?.[0]?.count || 0);
}

async function getOpportunityFreshnessSeconds(client) {
  const table = OPPORTUNITIES_TABLE;

  if (hasSupabaseClient(client)) {
    const { data, error } = await client
      .from(table)
      .select('detected_at,updated_at')
      .order('detected_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    const lastCreatedAt = data?.[0]?.detected_at || data?.[0]?.updated_at;
    if (!lastCreatedAt) return null;

    const ageMs = Date.now() - new Date(lastCreatedAt).getTime();
    return Math.max(0, Math.floor(ageMs / 1000));
  }

  const result = await queryWithTimeout(
    `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(COALESCE(detected_at, updated_at))))::bigint AS data_freshness_seconds
     FROM ${table}`,
    [],
    { timeoutMs: 3000, label: 'repository.opportunities.freshness_seconds', maxRetries: 0 }
  );

  const seconds = Number(result.rows?.[0]?.data_freshness_seconds);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
}

module.exports = {
  getRecentOpportunityStream,
  getTopOpportunities,
  getOpportunityCountLast24h,
  getOpportunityFreshnessSeconds,
};
