const { queryWithTimeout } = require('../db/pg');
const { DATA_CONTRACT } = require('../config/dataContract');

function hasSupabaseClient(client) {
  return Boolean(client && typeof client.from === 'function');
}

async function getRecentOpportunityStream(client, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
  const table = DATA_CONTRACT.opportunities.table;
  const selectColumns = DATA_CONTRACT.opportunities.columns.join(',');

  if (hasSupabaseClient(client)) {
    const { data, error } = await client
      .from(table)
      .select(selectColumns)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  const result = await queryWithTimeout(
    `SELECT ${selectColumns}
     FROM ${table}
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 3000, label: 'repository.opportunities.stream', maxRetries: 0 }
  );

  return result.rows || [];
}

async function getTopOpportunities(client, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 100));
  const source = String(options.source || 'opportunity_ranker');

  if (hasSupabaseClient(client)) {
    const { data, error } = await client
      .from(DATA_CONTRACT.opportunities.table)
      .select(DATA_CONTRACT.opportunities.columns.join(','))
      .eq('source', source)
      .order('created_at', { ascending: false })
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
         os.symbol,
         os.score,
         os.headline,
         os.created_at,
         os.event_type,
         os.source,
         ROW_NUMBER() OVER (
           PARTITION BY os.symbol
           ORDER BY os.created_at DESC
         ) AS rank_per_symbol
       FROM ${DATA_CONTRACT.opportunities.table} os
       WHERE os.source = $1
     )
     SELECT symbol, score, headline, created_at, event_type, source
     FROM ranked
     WHERE rank_per_symbol = 1
     ORDER BY score DESC NULLS LAST, created_at DESC
     LIMIT $2`,
    [source, limit],
    { timeoutMs: 3000, label: 'repository.opportunities.top', maxRetries: 0 }
  );

  return result.rows || [];
}

async function getOpportunityCountLast24h(client) {
  const table = DATA_CONTRACT.opportunities.table;
  const fallbackTable = 'trade_opportunities';

  if (hasSupabaseClient(client)) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await client
      .from(table)
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since);

    if (error) throw error;

    const primaryCount = Number(count || 0);
    if (primaryCount > 0) return primaryCount;

    const fallback = await client
      .from(fallbackTable)
      .select('symbol', { count: 'exact', head: true })
      .gte('created_at', since);

    if (fallback.error) throw fallback.error;
    return Number(fallback.count || 0);
  }

  const result = await queryWithTimeout(
    `SELECT COUNT(*)::int AS count
     FROM ${table}
     WHERE created_at > NOW() - INTERVAL '24 hours'`,
    [],
    { timeoutMs: 3000, label: 'repository.opportunities.count_24h', maxRetries: 0 }
  );

  const primaryCount = Number(result.rows?.[0]?.count || 0);
  if (primaryCount > 0) return primaryCount;

  const fallback = await queryWithTimeout(
    `SELECT COUNT(*)::int AS count
     FROM ${fallbackTable}
     WHERE created_at > NOW() - INTERVAL '24 hours'`,
    [],
    { timeoutMs: 3000, label: 'repository.opportunities.count_24h_fallback', maxRetries: 0 }
  );

  return Number(fallback.rows?.[0]?.count || 0);
}

async function getOpportunityFreshnessSeconds(client) {
  const table = DATA_CONTRACT.opportunities.table;

  if (hasSupabaseClient(client)) {
    const { data, error } = await client
      .from(table)
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    const lastCreatedAt = data?.[0]?.created_at;
    if (!lastCreatedAt) return null;

    const ageMs = Date.now() - new Date(lastCreatedAt).getTime();
    return Math.max(0, Math.floor(ageMs / 1000));
  }

  const result = await queryWithTimeout(
    `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::bigint AS data_freshness_seconds
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
