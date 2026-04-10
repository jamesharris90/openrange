#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') });

const { queryWithTimeout, pool } = require('../server/db/pg');

const FMP_BASE = 'https://financialmodelingprep.com/stable/profile';
const FMP_API_KEY = process.env.FMP_API_KEY;
const MISSING_SYMBOLS_PATH = path.join(__dirname, '..', 'missing_symbols.json');

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/\./g, '-');
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScalar(sql, params = [], label = 'scalar') {
  const result = await queryWithTimeout(sql, params, { timeoutMs: 12000, label });
  if (!result.rows.length) return null;
  const row = result.rows[0];
  return row[Object.keys(row)[0]];
}

async function runPhase1Diagnostic() {
  const totalMetrics = Number(
    await runScalar(
      `SELECT COUNT(*) AS total_metrics
       FROM market_metrics
       WHERE source = 'real'`,
      [],
      'phase1.total_metrics'
    )
  );

  const matchedProfiles = Number(
    await runScalar(
      `SELECT COUNT(DISTINCT mm.symbol) AS matched_profiles
       FROM market_metrics mm
       LEFT JOIN company_profiles cp
         ON mm.symbol = cp.symbol
       WHERE mm.source = 'real'
         AND cp.symbol IS NOT NULL`,
      [],
      'phase1.matched_profiles'
    )
  );

  const missingProfiles = Number(
    await runScalar(
      `SELECT COUNT(*) AS missing_profiles
       FROM market_metrics mm
       LEFT JOIN company_profiles cp
         ON mm.symbol = cp.symbol
       WHERE mm.source = 'real'
         AND cp.symbol IS NULL`,
      [],
      'phase1.missing_profiles'
    )
  );

  console.log('PHASE 1 - DIAGNOSTIC REPORT');
  console.log(JSON.stringify({ total_metrics: totalMetrics, matched_profiles: matchedProfiles, missing_profiles: missingProfiles }, null, 2));

  return { totalMetrics, matchedProfiles, missingProfiles };
}

async function getMissingSymbols(limitClause = '') {
  const sql = `
    SELECT mm.symbol
    FROM market_metrics mm
    LEFT JOIN company_profiles cp
      ON mm.symbol = cp.symbol
    WHERE mm.source = 'real'
      AND cp.symbol IS NULL
    ${limitClause}
  `;
  const result = await queryWithTimeout(sql, [], { timeoutMs: 15000, label: 'phase2.missing_symbols' });
  return result.rows.map((row) => normalizeSymbol(row.symbol)).filter(Boolean);
}

async function runPhase2IdentifyBadSymbols() {
  const missing200 = await getMissingSymbols('LIMIT 200');
  fs.writeFileSync(MISSING_SYMBOLS_PATH, JSON.stringify(missing200, null, 2));
  console.log(`PHASE 2 - Saved ${missing200.length} symbols to ${MISSING_SYMBOLS_PATH}`);
}

async function fetchFmpProfiles(symbolBatch) {
  if (!FMP_API_KEY) {
    throw new Error('Missing FMP_API_KEY in environment');
  }
  const profiles = [];
  let fetchErrors = 0;
  const symbols = symbolBatch.map((s) => normalizeSymbol(s)).filter(Boolean);

  const concurrency = 4;

  async function fetchProfileWithRetry(symbol) {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const url = `${FMP_BASE}?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(FMP_API_KEY)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.status === 429 || response.status >= 500) {
        if (attempt === maxAttempts) {
          throw new Error(`FMP transient error (${response.status}) for ${symbol}`);
        }
        await sleep(300 * attempt);
        continue;
      }

      if (!response.ok) {
        throw new Error(`FMP profile fetch failed (${response.status}) for ${symbol}`);
      }

      const payload = await response.json();
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

      if (!rows.length) return null;
      const row = rows[0] || {};
      const normalized = normalizeSymbol(row.symbol || row.ticker || symbol);
      const marketCapRaw = Number(row.marketCap ?? row.mktCap ?? null);
      return {
        symbol: normalized,
        company_name: row.companyName || row.name || null,
        sector: row.sector || null,
        industry: row.industry || null,
        market_cap: Number.isFinite(marketCapRaw) && marketCapRaw > 0 ? Math.trunc(marketCapRaw) : null,
      };
    }

    return null;
  }

  for (let i = 0; i < symbols.length; i += concurrency) {
    const slice = symbols.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      slice.map((symbol) => fetchProfileWithRetry(symbol))
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        if (result.value && result.value.symbol) {
          profiles.push(result.value);
        }
      } else {
        fetchErrors += 1;
      }
    }
  }

  return { profiles, fetchErrors };
}

async function upsertProfiles(rows) {
  if (!rows.length) return;

  const symbols = [];
  const companyNames = [];
  const sectors = [];
  const industries = [];
  const marketCaps = [];

  for (const row of rows) {
    symbols.push(row.symbol);
    companyNames.push(row.company_name);
    sectors.push(row.sector);
    industries.push(row.industry);
    marketCaps.push(row.market_cap);
  }

  await queryWithTimeout(
    `INSERT INTO company_profiles (symbol, company_name, sector, industry, market_cap)
     SELECT *
     FROM unnest(
       $1::text[],
       $2::text[],
       $3::text[],
       $4::text[],
       $5::numeric[]
     )
     ON CONFLICT (symbol)
     DO UPDATE SET
       company_name = EXCLUDED.company_name,
       sector = EXCLUDED.sector,
       industry = EXCLUDED.industry,
       market_cap = EXCLUDED.market_cap`,
    [symbols, companyNames, sectors, industries, marketCaps],
    { timeoutMs: 20000, label: 'phase3.upsert_profiles', poolType: 'write' }
  );
}

async function runPhase3Backfill() {
  const missingAll = await getMissingSymbols('');
  const chunks = chunkArray(missingAll, 100);
  let batchErrors = 0;
  let insertedOrUpdated = 0;

  for (const [index, batch] of chunks.entries()) {
    try {
      const { profiles, fetchErrors } = await fetchFmpProfiles(batch);
      batchErrors += fetchErrors;
      await upsertProfiles(profiles);
      insertedOrUpdated += profiles.length;
      console.log(`PHASE 3 - Batch ${index + 1}/${chunks.length}: fetched=${profiles.length}, errors=${fetchErrors}`);
    } catch (error) {
      batchErrors += 1;
      console.error(`PHASE 3 - Batch ${index + 1}/${chunks.length} failed:`, error.message);
    }
  }

  return { batchErrors, insertedOrUpdated };
}

async function runPhase4NormalizeSymbols() {
  await queryWithTimeout(
    `UPDATE market_metrics mm
     SET symbol = src.new_symbol
     FROM (
       SELECT symbol AS old_symbol, UPPER(REPLACE(symbol, '.', '-')) AS new_symbol
       FROM market_metrics
     ) src
     WHERE mm.symbol = src.old_symbol
       AND src.old_symbol <> src.new_symbol
       AND NOT EXISTS (
         SELECT 1
         FROM market_metrics m2
         WHERE m2.symbol = src.new_symbol
       )`,
    [],
    { timeoutMs: 20000, label: 'phase4.normalize_market_metrics', poolType: 'write' }
  );

  await queryWithTimeout(
    `UPDATE company_profiles cp
     SET symbol = src.new_symbol
     FROM (
       SELECT symbol AS old_symbol, UPPER(REPLACE(symbol, '.', '-')) AS new_symbol
       FROM company_profiles
     ) src
     WHERE cp.symbol = src.old_symbol
       AND src.old_symbol <> src.new_symbol
       AND NOT EXISTS (
         SELECT 1
         FROM company_profiles c2
         WHERE c2.symbol = src.new_symbol
       )`,
    [],
    { timeoutMs: 20000, label: 'phase4.normalize_company_profiles', poolType: 'write' }
  );

  console.log('PHASE 4 - Symbol normalization applied');
}

async function runPhase5Validation() {
  const coverage = Number(
    await runScalar(
      `SELECT
         COUNT(*) FILTER (WHERE cp.symbol IS NOT NULL) * 100.0 / COUNT(*) AS coverage_percent
       FROM market_metrics mm
       LEFT JOIN company_profiles cp
         ON mm.symbol = cp.symbol
       WHERE mm.source = 'real'`,
      [],
      'phase5.coverage'
    )
  );

  const fullFieldCoverage = Number(
    await runScalar(
      `SELECT
         COUNT(*) FILTER (
           WHERE cp.symbol IS NOT NULL
             AND cp.sector IS NOT NULL
             AND NULLIF(TRIM(cp.sector), '') IS NOT NULL
             AND cp.market_cap IS NOT NULL
             AND cp.market_cap > 0
         ) * 100.0 / COUNT(*) AS coverage_percent
       FROM market_metrics mm
       LEFT JOIN company_profiles cp
         ON mm.symbol = cp.symbol
       WHERE mm.source = 'real'`,
      [],
      'phase5.full_field_coverage'
    )
  );

  return { coverage, fullFieldCoverage };
}

async function main() {
  try {
    await runPhase1Diagnostic();
    await runPhase2IdentifyBadSymbols();
    const phase3 = await runPhase3Backfill();
    await runPhase4NormalizeSymbols();
    const phase5 = await runPhase5Validation();

    if (phase3.batchErrors > 0) {
      console.error('BUILD FAILED - FIX REQUIRED');
      console.error(`Batch fetch errors: ${phase3.batchErrors}`);
      process.exitCode = 1;
      return;
    }

    if (phase5.coverage < 80) {
      console.error('BUILD FAILED - FIX REQUIRED');
      console.error(`coverage_percent below fail threshold: ${phase5.coverage.toFixed(2)}%`);
      process.exitCode = 1;
      return;
    }

    console.log('DATA ENRICHMENT COMPLETE');
    console.log(`coverage_percent: ${phase5.coverage.toFixed(2)}%`);
    console.log(`coverage_with_sector_and_market_cap: ${phase5.fullFieldCoverage.toFixed(2)}%`);

    if (phase5.coverage > 90) {
      console.log('BUILD VALIDATED - SAFE TO DEPLOY');
    } else {
      console.log('Coverage is between 80% and 90%; pass threshold (>90%) not yet met.');
    }
  } catch (error) {
    console.error('BUILD FAILED - FIX REQUIRED');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
