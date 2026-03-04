const { symbolsFromEnv, runIngestionJob } = require('./_helpers');

function normalizePrices(payload, symbol) {
  const rawRows = Array.isArray(payload?.historical) ? payload.historical : [];
  return rawRows
    .map((row) => ({
      symbol,
      date: row.date,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume) || 0,
    }))
    .filter((row) => row.date && Number.isFinite(row.open) && Number.isFinite(row.close));
}

async function runPricesIngestion(symbols = symbolsFromEnv()) {
  return runIngestionJob({
    jobName: 'fmp_prices_ingest',
    endpointBuilder: (symbol) => `/historical-price-full/${symbol}`,
    normalize: normalizePrices,
    table: 'daily_ohlc',
    conflictTarget: 'symbol,date',
    symbols,
  });
}

module.exports = {
  runPricesIngestion,
};
