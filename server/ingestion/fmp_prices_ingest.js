const { queryWithTimeout } = require('../db/pg');
const { symbolsFromEnv, runIngestionJob } = require('./_helpers');

const DEFAULT_PRICE_LOOKBACK_DAYS = Math.max(1, Number(process.env.DAILY_PRICE_LOOKBACK_DAYS) || 7);

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
    `SELECT MAX(date) AS latest_date
     FROM daily_ohlc`,
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

async function runPricesIngestion(symbols) {
  const targetSymbols = Array.isArray(symbols) && symbols.length > 0
    ? symbols
    : await loadUniverseSymbols();
  const fromDate = await loadIncrementalStartDate();

  return runIngestionJob({
    jobName: 'fmp_prices_ingest',
    endpointBuilder: (symbol) => `/historical-chart/4hour?symbol=${encodeURIComponent(symbol)}&from=${fromDate}`,
    normalize: (payload, symbol) => normalizePricesFromFourHour(payload, symbol, fromDate),
    table: 'daily_ohlc',
    conflictTarget: 'symbol,date',
    symbols: targetSymbols,
  });
}

module.exports = {
  runPricesIngestion,
};
