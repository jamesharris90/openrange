const fs = require('fs');
const path = require('path');
const { queryWithTimeout } = require('../../db/pg');

const newsSql = fs.readFileSync(path.join(__dirname, '..', 'queries', 'news.sql'), 'utf8');

async function getNewsRows() {
  const result = await queryWithTimeout(newsSql, [], {
    timeoutMs: 4000,
    label: 'v2.news',
    maxRetries: 0,
  });

  return (result.rows || []).map((row) => ({
    symbol: row.symbol || null,
    headline: row.headline || null,
    source: row.source || null,
    published_at: row.published_at || null,
  }));
}

module.exports = {
  getNewsRows,
};