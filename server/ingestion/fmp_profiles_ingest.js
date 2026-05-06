const { symbolsFromEnv, runIngestionJob } = require('./_helpers');

function normalizeProfiles(payload, symbol) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      symbol,
      company_name: row.companyName || row.name || null,
      sector: row.sector || null,
      industry: row.industry || null,
      exchange: row.exchangeShortName || row.exchange || null,
      country: row.country || null,
      website: row.website || null,
      description: row.description || null,
      market_cap: Number(row.mktCap ?? row.marketCap) || null,
      float: Number(row.float) || null,
      updated_at: new Date().toISOString(),
    }))
    .filter((row) => row.symbol);
}

async function runProfilesIngestion(symbols = symbolsFromEnv()) {
  return runIngestionJob({
    jobName: 'fmp_profiles_ingest',
    endpointBuilder: (symbol) => `/profile?symbol=${encodeURIComponent(symbol)}`,
    normalize: normalizeProfiles,
    table: 'company_profiles',
    conflictTarget: 'symbol',
    symbols,
  });
}

module.exports = {
  runProfilesIngestion,
};
