const { queryWithTimeout } = require('../db/pg');
const { DATA_CONTRACT } = require('../config/dataContract');

function hasSupabaseClient(client) {
  return Boolean(client && typeof client.from === 'function');
}

async function getLatestSignalAlerts(client, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
  const table = DATA_CONTRACT.alerts.table;
  const selectColumns = DATA_CONTRACT.alerts.columns.join(',');

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
     ORDER BY created_at DESC NULLS LAST
     LIMIT $1`,
    [limit],
    { timeoutMs: 3000, label: 'repository.alerts.latest', maxRetries: 0 }
  );

  return result.rows || [];
}

module.exports = {
  getLatestSignalAlerts,
};
