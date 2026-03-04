const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../db/pg');
const logger = require('../logger');

const BATCH_SIZE = 500;

async function ensureDiscoveryTable() {
  const sqlPath = path.join(__dirname, '..', 'migrations', 'create_discovered_symbols.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function collectDiscoveryCandidates() {
  const { rows } = await pool.query(
    `WITH setup_candidates AS (
       SELECT UPPER(symbol) AS symbol,
              'setup'::text AS source,
              COALESCE(score, 0)::numeric AS score
       FROM trade_setups
       WHERE symbol IS NOT NULL
         AND detected_at >= NOW() - INTERVAL '24 hours'
     ),
     catalyst_candidates AS (
       SELECT UPPER(symbol) AS symbol,
              'catalyst'::text AS source,
              COALESCE(score, 0)::numeric AS score
       FROM trade_catalysts
       WHERE symbol IS NOT NULL
         AND published_at >= NOW() - INTERVAL '48 hours'
     ),
     earnings_candidates AS (
       SELECT UPPER(symbol) AS symbol,
              'earnings'::text AS source,
              3::numeric AS score
       FROM earnings_events
       WHERE symbol IS NOT NULL
         AND report_date >= CURRENT_DATE - INTERVAL '1 day'
         AND report_date <= CURRENT_DATE + INTERVAL '7 days'
     ),
     all_candidates AS (
       SELECT * FROM setup_candidates
       UNION ALL
       SELECT * FROM catalyst_candidates
       UNION ALL
       SELECT * FROM earnings_candidates
     )
     SELECT symbol,
            STRING_AGG(DISTINCT source, '+' ORDER BY source) AS source,
            MAX(score)::numeric AS score
     FROM all_candidates
     GROUP BY symbol
     ORDER BY MAX(score) DESC, symbol ASC`
  );

  return rows.map((row) => ({
    symbol: String(row.symbol || '').toUpperCase(),
    source: String(row.source || 'unknown'),
    score: toNumber(row.score, 0),
  })).filter((row) => row.symbol);
}

async function upsertDiscoveredSymbols(rows) {
  if (!rows.length) return 0;

  const payload = JSON.stringify(rows);

  await pool.query(
    `INSERT INTO discovered_symbols (
       symbol,
       source,
       score,
       detected_at
     )
     SELECT symbol,
            source,
            score,
            NOW()
     FROM jsonb_to_recordset($1::jsonb) AS x(
       symbol text,
       source text,
       score numeric
     )
     ON CONFLICT (symbol) DO UPDATE
     SET source = EXCLUDED.source,
         score = EXCLUDED.score,
         detected_at = NOW()`,
    [payload]
  );

  return rows.length;
}

async function runDiscoveryEngine() {
  const startedAt = Date.now();

  try {
    await ensureDiscoveryTable();

    const candidates = await collectDiscoveryCandidates();

    let upserted = 0;
    for (let index = 0; index < candidates.length; index += BATCH_SIZE) {
      const batch = candidates.slice(index, index + BATCH_SIZE);
      upserted += await upsertDiscoveredSymbols(batch);
    }

    const result = {
      symbols_detected: candidates.length,
      symbols_upserted: upserted,
      runtimeMs: Date.now() - startedAt,
    };

    logger.info('discovery engine complete', {
      scope: 'discovery',
      ...result,
    });

    return result;
  } catch (err) {
    logger.error('discovery engine failed', {
      scope: 'discovery',
      error: err.message,
    });

    return {
      symbols_detected: 0,
      symbols_upserted: 0,
      runtimeMs: Date.now() - startedAt,
      error: err.message,
    };
  }
}

module.exports = {
  ensureDiscoveryTable,
  runDiscoveryEngine,
};
