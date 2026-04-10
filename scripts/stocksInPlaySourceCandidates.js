const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../server/.env'), override: true });
const pool = require('../server/db/pool');

function normalizeSampleRows(rows) {
  return (rows || []).map((row) => ({
    symbol: row.symbol,
    why: row.why,
    how: row.how,
    confidence: row.confidence,
    score: row.score,
    source: row.source,
    updated_at: row.updated_at,
  }));
}

async function inspectTable(tableName) {
  const freshnessExpr = tableName === 'opportunity_stream'
    ? 'COALESCE(updated_at, created_at)'
    : tableName === 'trade_setups'
      ? 'COALESCE(updated_at, created_at)'
      : 'COALESCE(updated_at, last_updated)';

  const countResult = await pool.query(
    `SELECT
       COUNT(*)::int AS row_count,
       COUNT(*) FILTER (
         WHERE ${freshnessExpr} >= NOW() - INTERVAL '15 minutes'
       )::int AS fresh_15m_count,
       MAX(${freshnessExpr}) AS latest_ts
     FROM ${tableName}`
  );

  let sampleQuery;
  if (tableName === 'opportunity_stream') {
    sampleQuery = `SELECT
      symbol,
      COALESCE(why, headline, event_type, '') AS why,
      COALESCE(how, '') AS how,
      COALESCE(confidence, score * 100, 0) AS confidence,
      score,
      COALESCE(source, '') AS source,
      COALESCE(updated_at, created_at) AS updated_at
    FROM opportunity_stream
    ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
    LIMIT 5`;
  } else if (tableName === 'trade_setups') {
    sampleQuery = `SELECT
      symbol,
      COALESCE(setup, setup_type, '') AS why,
      COALESCE(setup_type, setup, '') AS how,
      COALESCE(score, 0) AS confidence,
      score,
      'legacy' AS source,
      COALESCE(updated_at, detected_at, created_at) AS updated_at
    FROM trade_setups
    ORDER BY COALESCE(updated_at, detected_at, created_at) DESC NULLS LAST
    LIMIT 5`;
  } else {
    sampleQuery = `SELECT
      symbol,
      '' AS why,
      '' AS how,
      COALESCE(relative_volume, 0) AS confidence,
      COALESCE(relative_volume, 0) AS score,
      COALESCE(source, '') AS source,
      COALESCE(updated_at, last_updated) AS updated_at
    FROM market_metrics
    ORDER BY COALESCE(updated_at, last_updated) DESC NULLS LAST
    LIMIT 5`;
  }

  const sampleResult = await pool.query(sampleQuery);
  const sourceQuery = tableName === 'trade_setups'
    ? `SELECT 'legacy'::text AS source, COUNT(*)::int AS count FROM trade_setups`
    : `SELECT
         COALESCE(source, '<null>') AS source,
         COUNT(*)::int AS count
       FROM ${tableName}
       GROUP BY COALESCE(source, '<null>')
       ORDER BY count DESC
       LIMIT 10`;

  const sourceResult = await pool.query(sourceQuery);

  const countRow = countResult.rows[0] || {};
  return {
    table: tableName,
    row_count: Number(countRow.row_count || 0),
    fresh_15m_count: Number(countRow.fresh_15m_count || 0),
    latest_ts: countRow.latest_ts || null,
    sources: sourceResult.rows || [],
    sample_5: normalizeSampleRows(sampleResult.rows),
  };
}

function qualityScore(candidate) {
  const sample = candidate.sample_5 || [];
  const completeRealRows = sample.filter((row) => (
    Boolean(row.symbol)
    && Boolean(row.why)
    && Boolean(row.how)
    && Number(row.confidence) > 0
    && String(row.source || '').toLowerCase() === 'real'
  )).length;
  const freshWeight = Math.min(Number(candidate.fresh_15m_count || 0), 500);
  return (completeRealRows * 100000) + freshWeight;
}

async function run() {
  const tableNames = ['opportunity_stream', 'trade_setups', 'market_metrics'];
  const candidates = [];
  for (const tableName of tableNames) {
    candidates.push(await inspectTable(tableName));
  }
  await pool.end();

  const preferred = candidates.slice().sort((a, b) => qualityScore(b) - qualityScore(a))[0] || null;
  const payload = {
    generated_at: new Date().toISOString(),
    selection_rule: 'Prefer symbol+why+how+confidence+source=real+fresh updated_at',
    candidates,
    preferred_table: preferred ? preferred.table : null,
  };

  const outPath = path.resolve(__dirname, '../logs/stocks_in_play_source_candidates.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`ok ${outPath}`);
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
