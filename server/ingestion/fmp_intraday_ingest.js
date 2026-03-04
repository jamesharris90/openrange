const { symbolsFromEnv, runIngestionJob } = require('./_helpers');

function normalizeIntraday(payload, symbol) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => {
      const timestamp = row.date || row.datetime || row.timestamp;
      const price = Number(row.close ?? row.price);
      const volume = Number(row.volume) || 0;
      return {
        symbol,
        timestamp,
        price,
        volume,
      };
    })
    .filter((row) => row.timestamp && Number.isFinite(row.price));
}

async function runIntradayIngestion(symbols = symbolsFromEnv()) {
  return runIngestionJob({
    jobName: 'fmp_intraday_ingest',
    endpointBuilder: (symbol) => `/historical-chart/1min/${symbol}`,
    normalize: normalizeIntraday,
    table: 'intraday_1m',
    conflictTarget: 'symbol,timestamp',
    symbols,
  });
}

module.exports = {
  runIntradayIngestion,
};
