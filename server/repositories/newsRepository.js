const { queryWithTimeout } = require('../db/pg');
const { DATA_CONTRACT } = require('../config/dataContract');

function hasSupabaseClient(client) {
  return Boolean(client && typeof client.from === 'function');
}

async function getLatestNews(client, options = {}) {
  const symbols = Array.isArray(options.symbols) ? options.symbols.filter(Boolean) : [];
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
  const cutoffIso = options.cutoffIso || new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const table = DATA_CONTRACT.news.table;
  const selectColumns = DATA_CONTRACT.news.columns.join(',');

  if (hasSupabaseClient(client)) {
    let query = client
      .from(table)
      .select(selectColumns)
      .gte('published_at', cutoffIso)
      .order('published_at', { ascending: false })
      .limit(limit);

    if (symbols.length > 0) {
      query = query.in('symbol', symbols);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  if (symbols.length > 0) {
    const result = await queryWithTimeout(
      `SELECT ${selectColumns}
       FROM ${table}
       WHERE symbol = ANY($1::text[]) AND published_at >= $2
       ORDER BY published_at DESC
       LIMIT $3`,
      [symbols, cutoffIso, limit],
      { timeoutMs: 3000, label: 'repository.news.latest.filtered', maxRetries: 0 }
    );
    return result.rows || [];
  }

  const result = await queryWithTimeout(
    `SELECT ${selectColumns}
     FROM ${table}
     WHERE published_at >= $1
     ORDER BY published_at DESC
     LIMIT $2`,
    [cutoffIso, limit],
    { timeoutMs: 3000, label: 'repository.news.latest', maxRetries: 0 }
  );

  return result.rows || [];
}

module.exports = {
  getLatestNews,
};
