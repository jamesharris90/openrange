const { fmpFetch } = require('../services/fmpClient');
const { supabaseAdmin } = require('../services/supabaseClient');
const { batchInsert } = require('../utils/batchInsert');
const logger = require('../utils/logger');
const { normalizeSymbol, mapFromProviderSymbol, mapToProviderSymbol } = require('../utils/symbolMap');

const MAX_SYMBOLS_PER_BATCH = 10;
const BATCH_DELAY_MS = 500;

function symbolsFromEnv() {
  return String(process.env.INGEST_SYMBOLS || 'AAPL,MSFT,NVDA,SPY,QQQ')
    .split(',')
    .map((value) => mapFromProviderSymbol(normalizeSymbol(value)))
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

  const safeSymbols = Array.isArray(symbols) ? symbols : [];

  for (let i = 0; i < safeSymbols.length; i += MAX_SYMBOLS_PER_BATCH) {
    const batch = safeSymbols.slice(i, i + MAX_SYMBOLS_PER_BATCH);

    for (const symbol of batch) {
      try {
        const canonicalSymbol = mapFromProviderSymbol(normalizeSymbol(symbol));
        const providerSymbol = mapToProviderSymbol(canonicalSymbol);
        const endpoint = endpointBuilder(providerSymbol, canonicalSymbol);
        if (table === 'intraday_1m') {
          console.log('[INGESTION] Starting intraday fetch from FMP');
        }
        const payload = await fmpFetch(endpoint);
        const normalized = normalize(payload, canonicalSymbol, providerSymbol);
        if (Array.isArray(normalized) && normalized.length) {
          allRows.push(...normalized);
        }
      } catch (err) {
        failures += 1;
        logger.error('ingestion symbol failed', {
          jobName,
          symbol: mapFromProviderSymbol(normalizeSymbol(symbol)),
          error: err.message,
        });
      }
    }

    if (i + MAX_SYMBOLS_PER_BATCH < safeSymbols.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
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

  if (table === 'intraday_1m') {
    console.log('[INGESTION] Inserted intraday bars:', inserted);
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
