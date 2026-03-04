const { fmpFetch } = require('../services/fmpClient');
const { supabaseAdmin } = require('../services/supabaseClient');
const { batchInsert } = require('../utils/batchInsert');
const logger = require('../utils/logger');

function symbolsFromEnv() {
  return String(process.env.INGEST_SYMBOLS || 'AAPL,MSFT,NVDA,SPY,QQQ')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

async function runIngestionJob({
  jobName,
  endpointBuilder,
  normalize,
  table,
  conflictTarget,
  symbols,
}) {
  const startedAt = Date.now();
  logger.info('ingestion start', { jobName, table, symbols: symbols.length });

  const allRows = [];
  let failures = 0;

  for (const symbol of symbols) {
    try {
      const endpoint = endpointBuilder(symbol);
      const payload = await fmpFetch(endpoint);
      const normalized = normalize(payload, symbol);
      if (Array.isArray(normalized) && normalized.length) {
        allRows.push(...normalized);
      }
    } catch (err) {
      failures += 1;
      logger.error('ingestion symbol failed', {
        jobName,
        symbol,
        error: err.message,
      });
    }
  }

  const dedupeKey = (row) => JSON.stringify(conflictTarget.split(',').map((field) => row[field]));
  const deduped = Array.from(new Map(allRows.map((row) => [dedupeKey(row), row])).values());

  let inserted = 0;
  if (deduped.length > 0) {
    const result = await batchInsert({
      supabase: supabaseAdmin,
      table,
      rows: deduped,
      conflictTarget,
      batchSize: 500,
    });
    inserted = result.inserted;
  }

  const durationMs = Date.now() - startedAt;
  logger.info('ingestion done', {
    jobName,
    table,
    fetched: allRows.length,
    deduped: deduped.length,
    inserted,
    failures,
    durationMs,
  });

  return {
    jobName,
    table,
    fetched: allRows.length,
    deduped: deduped.length,
    inserted,
    failures,
    durationMs,
  };
}

module.exports = {
  symbolsFromEnv,
  runIngestionJob,
};
