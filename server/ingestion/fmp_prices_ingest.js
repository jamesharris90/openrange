const { queryWithTimeout } = require('../db/pg');
const { symbolsFromEnv } = require('./_helpers');
const { fmpFetch } = require('../services/fmpClient');
const { supabaseAdmin } = require('../services/supabaseClient');
const { batchInsert } = require('../utils/batchInsert');
const logger = require('../utils/logger');
const { normalizeSymbol, mapToProviderSymbol } = require('../utils/symbolMap');

const DEFAULT_PRICE_LOOKBACK_DAYS = Math.max(1, Number(process.env.DAILY_PRICE_LOOKBACK_DAYS) || 7);
const DEFAULT_FULL_HISTORY_START = String(process.env.DAILY_PRICE_FULL_HISTORY_FROM || '2021-01-01');
const PRICE_INGEST_CONCURRENCY = Math.max(1, Number(process.env.DAILY_PRICE_INGEST_CONCURRENCY) || 2);
const TARGET_TABLES = ['daily_ohlc', 'daily_ohlcv'];

async function loadUniverseSymbols() {
  const result = await queryWithTimeout(
    `SELECT symbol
     FROM ticker_universe
     WHERE COALESCE(is_active, true) = true
       AND symbol IS NOT NULL
       AND symbol <> ''
     ORDER BY market_cap DESC NULLS LAST, symbol ASC`,
    [],
    { timeoutMs: 10000, label: 'fmp_prices_ingest.load_universe_symbols', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const symbols = (result.rows || [])
    .map((row) => String(row.symbol || '').trim().toUpperCase())
    .filter(Boolean);

  return symbols.length > 0 ? symbols : symbolsFromEnv();
}

async function loadIncrementalStartDate() {
  const result = await queryWithTimeout(
    `SELECT GREATEST(
        COALESCE((SELECT MAX(date) FROM daily_ohlc), DATE '1900-01-01'),
        COALESCE((SELECT MAX(date) FROM daily_ohlcv), DATE '1900-01-01')
      ) AS latest_date`,
    [],
    { timeoutMs: 5000, label: 'fmp_prices_ingest.load_latest_date', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const latestDate = result.rows?.[0]?.latest_date ? new Date(result.rows[0].latest_date) : null;
  if (latestDate && Number.isFinite(latestDate.getTime())) {
    latestDate.setUTCDate(latestDate.getUTCDate() - DEFAULT_PRICE_LOOKBACK_DAYS);
    return latestDate.toISOString().slice(0, 10);
  }

  const fallbackDate = new Date();
  fallbackDate.setUTCDate(fallbackDate.getUTCDate() - Math.max(DEFAULT_PRICE_LOOKBACK_DAYS, 30));
  return fallbackDate.toISOString().slice(0, 10);
}

async function loadFullHistoryStartDate() {
  const result = await queryWithTimeout(
    `SELECT LEAST(
        COALESCE((SELECT MIN(date) FROM daily_ohlc), DATE '9999-12-31'),
        COALESCE((SELECT MIN(date) FROM daily_ohlcv), DATE '9999-12-31')
      ) AS earliest_date`,
    [],
    { timeoutMs: 5000, label: 'fmp_prices_ingest.load_earliest_date', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const earliestDate = result.rows?.[0]?.earliest_date ? new Date(result.rows[0].earliest_date) : null;
  if (earliestDate && Number.isFinite(earliestDate.getTime())) {
    return earliestDate.toISOString().slice(0, 10);
  }

  return DEFAULT_FULL_HISTORY_START;
}

function normalizeDailyRows(payload, symbol, fromDate) {
  const rawRows = Array.isArray(payload) ? payload : [];

  return rawRows
    .map((row) => {
      const date = String(row.date || '').slice(0, 10);
      const open = Number(row.open);
      const high = Number(row.high);
      const low = Number(row.low);
      const close = Number(row.close);
      const volume = Math.max(0, Math.trunc(Number(row.volume) || 0));

      if (!date || (fromDate && date < fromDate)) {
        return null;
      }

      if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
        return null;
      }

      return {
        symbol,
        date,
        open,
        high,
        low,
        close,
        volume,
      };
    })
    .filter(Boolean);
}

function normalizePricesFromFourHour(payload, symbol, fromDate) {
  const rawRows = Array.isArray(payload) ? payload : [];
  const byDate = new Map();

  for (const row of rawRows) {
    const timestamp = String(row.date || row.datetime || '').trim();
    const date = timestamp.slice(0, 10);
    if (!date || (fromDate && date < fromDate)) {
      continue;
    }

    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = Math.max(0, Math.trunc(Number(row.volume) || 0));

    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      continue;
    }

    const existing = byDate.get(date);
    if (!existing) {
      byDate.set(date, {
        symbol,
        date,
        open,
        high,
        low,
        close,
        volume,
        firstTimestamp: timestamp,
        lastTimestamp: timestamp,
      });
      continue;
    }

    if (timestamp < existing.firstTimestamp) {
      existing.firstTimestamp = timestamp;
      existing.open = open;
    }

    if (timestamp >= existing.lastTimestamp) {
      existing.lastTimestamp = timestamp;
      existing.close = close;
    }

    existing.high = Math.max(existing.high, high);
    existing.low = Math.min(existing.low, low);
    existing.volume += volume;
  }

  return Array.from(byDate.values()).map(({ firstTimestamp, lastTimestamp, ...row }) => row);
}

async function fetchPriceRows(symbol, fromDate) {
  const providerSymbol = mapToProviderSymbol(normalizeSymbol(symbol));
  const toDate = new Date().toISOString().slice(0, 10);
  const endpoints = [
    {
      endpoint: `/historical-price-eod/full?symbol=${encodeURIComponent(providerSymbol)}&from=${fromDate}&to=${toDate}`,
      normalize: normalizeDailyRows,
    },
    {
      endpoint: `/historical-price-eod/light?symbol=${encodeURIComponent(providerSymbol)}&from=${fromDate}&to=${toDate}`,
      normalize: normalizeDailyRows,
    },
    {
      endpoint: `/historical-chart/4hour?symbol=${encodeURIComponent(providerSymbol)}&from=${fromDate}`,
      normalize: normalizePricesFromFourHour,
    },
  ];

  let lastError = null;
  for (const { endpoint, normalize } of endpoints) {
    try {
      const payload = await fmpFetch(endpoint);
      const rows = normalize(payload, symbol, fromDate);
      if (rows.length > 0) {
        return { rows, sourceEndpoint: endpoint };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return { rows: [], sourceEndpoint: null };
}

function dedupeRows(rows) {
  return Array.from(
    new Map(rows.map((row) => [`${row.symbol}::${row.date}`, row])).values()
  );
}

async function runWithConcurrency(items, worker, concurrency = PRICE_INGEST_CONCURRENCY) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      output[index] = await worker(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return output;
}

async function runPricesIngestion(symbols, options = {}) {
  const targetSymbols = Array.isArray(symbols) && symbols.length > 0
    ? symbols
    : await loadUniverseSymbols();
  const fullHistory = Boolean(options.fullHistory);
  const fromDate = options.fromDate || (fullHistory
    ? await loadFullHistoryStartDate()
    : await loadIncrementalStartDate());
  const startedAt = Date.now();

  logger.info('ingestion start', {
    jobName: 'fmp_prices_ingest',
    tables: TARGET_TABLES,
    symbols: targetSymbols.length,
    fromDate,
    fullHistory,
  });

  const results = await runWithConcurrency(targetSymbols, async (symbol) => {
    const canonicalSymbol = normalizeSymbol(symbol);
    try {
      const { rows, sourceEndpoint } = await fetchPriceRows(canonicalSymbol, fromDate);
      return { symbol: canonicalSymbol, rows, sourceEndpoint, error: null };
    } catch (error) {
      logger.error('ingestion symbol failed', {
        jobName: 'fmp_prices_ingest',
        symbol: canonicalSymbol,
        error: error.message,
      });
      return { symbol: canonicalSymbol, rows: [], sourceEndpoint: null, error: error.message };
    }
  });

  const allRows = [];
  const failures = [];
  const noDataSymbols = [];
  const endpointUsage = {};

  for (const result of results) {
    if (result.error) {
      failures.push({ symbol: result.symbol, error: result.error });
      continue;
    }

    if (!Array.isArray(result.rows) || result.rows.length === 0) {
      noDataSymbols.push(result.symbol);
      continue;
    }

    endpointUsage[result.sourceEndpoint] = (endpointUsage[result.sourceEndpoint] || 0) + 1;
    allRows.push(...result.rows);
  }

  const deduped = dedupeRows(allRows);
  const insertedByTable = {};

  if (deduped.length > 0) {
    for (const table of TARGET_TABLES) {
      const result = await batchInsert({
        supabase: supabaseAdmin,
        table,
        rows: deduped,
        conflictTarget: 'symbol,date',
        batchSize: 500,
      });
      insertedByTable[table] = result.inserted;
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info('ingestion done', {
    jobName: 'fmp_prices_ingest',
    tables: TARGET_TABLES,
    fetched: allRows.length,
    deduped: deduped.length,
    insertedByTable,
    failures: failures.length,
    noDataSymbols: noDataSymbols.length,
    endpointUsage,
    durationMs,
  });

  return {
    jobName: 'fmp_prices_ingest',
    tables: TARGET_TABLES,
    fetched: allRows.length,
    deduped: deduped.length,
    inserted: insertedByTable.daily_ohlcv || 0,
    insertedByTable,
    failures,
    noDataSymbols,
    endpointUsage,
    fromDate,
    durationMs,
  };
}

module.exports = {
  runPricesIngestion,
};
