const { symbolsFromEnv, runIngestionJob } = require('./_helpers');
const { queryWithTimeout } = require('../db/pg');

const PROFILE_REFRESH_SYMBOL_LIMIT = Math.max(100, Number(process.env.PROFILE_REFRESH_SYMBOL_LIMIT || 1500));

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
  let selectedSymbols = Array.isArray(symbols)
    ? symbols.map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean)
    : [];

  if (selectedSymbols.length === 0) {
    try {
      const { rows } = await queryWithTimeout(
        `SELECT tu.symbol
         FROM ticker_universe tu
         LEFT JOIN company_profiles cp ON cp.symbol = tu.symbol
         WHERE tu.is_active = true
           AND tu.symbol IS NOT NULL
         ORDER BY cp.last_updated ASC NULLS FIRST, tu.market_cap DESC NULLS LAST, tu.symbol ASC
         LIMIT $1`,
        [PROFILE_REFRESH_SYMBOL_LIMIT],
        { timeoutMs: 12000, label: 'profiles_ingest.resolve_symbols', maxRetries: 0 }
      );
      selectedSymbols = rows.map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean);
    } catch (_error) {
      selectedSymbols = [];
    }
  }

  if (selectedSymbols.length === 0) {
    selectedSymbols = symbolsFromEnv();
  }

  return runIngestionJob({
    jobName: 'fmp_profiles_ingest',
    endpointBuilder: (symbol) => `/profile?symbol=${encodeURIComponent(symbol)}`,
    normalize: normalizeProfiles,
    table: 'company_profiles',
    conflictTarget: 'symbol',
    symbols: selectedSymbols,
  });
}

module.exports = {
  runProfilesIngestion,
};
