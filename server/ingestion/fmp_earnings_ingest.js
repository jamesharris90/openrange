const { symbolsFromEnv, runIngestionJob } = require('./_helpers');

function normalizeEarnings(payload, symbol) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      symbol,
      report_date: row.date || row.reportDate || null,
      report_time: row.time || row.hour || null,
      eps_estimate: row.epsEstimated ?? row.epsEstimate ?? null,
    }))
    .filter((row) => row.report_date);
}

async function runEarningsIngestion(symbols = symbolsFromEnv()) {
  return runIngestionJob({
    jobName: 'fmp_earnings_ingest',
    endpointBuilder: (symbol) => `/earning_calendar?symbol=${encodeURIComponent(symbol)}&limit=200`,
    normalize: normalizeEarnings,
    table: 'earnings_events',
    conflictTarget: 'symbol,report_date,report_time',
    symbols,
  });
}

module.exports = {
  runEarningsIngestion,
};
