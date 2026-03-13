const { queryWithTimeout } = require('../db/pg');
const { DATA_CONTRACT } = require('../config/dataContract');

function hasSupabaseClient(client) {
  return Boolean(client && typeof client.from === 'function');
}

async function getLatestStrategySignals(client, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
  const table = DATA_CONTRACT.signals.table;
  const selectColumns = DATA_CONTRACT.signals.columns.join(',');

  if (hasSupabaseClient(client)) {
    const { data, error } = await client
      .from(table)
      .select(selectColumns)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  const result = await queryWithTimeout(
    `SELECT ${selectColumns}
     FROM ${table}
     ORDER BY updated_at DESC NULLS LAST
     LIMIT $1`,
    [limit],
    { timeoutMs: 3000, label: 'repository.signals.latest', maxRetries: 0 }
  );

  return result.rows || [];
}

module.exports = {
  getLatestStrategySignals,
};
