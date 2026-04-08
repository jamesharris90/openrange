/**
 * fmp_earnings_actuals_ingest.js
 *
 * Refreshes eps_actual, rev_actual, eps_surprise_pct on earnings_events
 * from FMP /stable/earnings-calendar for a rolling window.
 *
 * Also backfills company name and sector from ticker_universe where missing.
 *
 * Run daily after market close.
 */

const axios   = require('axios');
const { queryWithTimeout } = require('../db/pg');

const FMP_BASE = 'https://financialmodelingprep.com';

function addDays(d, n) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}
function isoDate(d) { return d.toISOString().slice(0, 10); }

/**
 * Fetch FMP earnings calendar for a date window and update DB with actuals.
 */
async function refreshEarningsActuals(daysBack = 14, daysForward = 7) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn('[earningsActuals] FMP_API_KEY not set — skipping');
    return { updated: 0, errors: 0 };
  }

  const today = new Date();
  const from  = isoDate(addDays(today, -daysBack));
  const to    = isoDate(addDays(today, daysForward));

  console.log(`[earningsActuals] fetching FMP earnings-calendar ${from} → ${to}`);

  let fmpRows = [];
  try {
    const resp = await axios.get(`${FMP_BASE}/stable/earnings-calendar`, {
      params: { from, to, apikey: apiKey },
      timeout: 20_000,
      validateStatus: () => true,
    });
    if (resp.status === 200 && Array.isArray(resp.data)) {
      fmpRows = resp.data;
    } else {
      console.warn('[earningsActuals] bad response:', resp.status);
      return { updated: 0, errors: 0 };
    }
  } catch (err) {
    console.error('[earningsActuals] fetch error:', err.message);
    return { updated: 0, errors: 1 };
  }

  // Build map: symbol+date -> FMP row
  const fmpMap = new Map();
  for (const row of fmpRows) {
    if (!row.symbol || !row.date) continue;
    const key = `${row.symbol.toUpperCase()}|${String(row.date).slice(0, 10)}`;
    fmpMap.set(key, row);
  }

  console.log(`[earningsActuals] FMP returned ${fmpRows.length} rows, ${fmpMap.size} unique symbol+date`);

  // Fetch our earnings_events in that window
  let dbRows = [];
  try {
    const result = await queryWithTimeout(
      `SELECT id, symbol, report_date::text AS report_date, eps_estimate, eps_actual, rev_estimate, rev_actual, eps_surprise_pct, company
       FROM earnings_events
       WHERE report_date::date BETWEEN $1::date AND $2::date`,
      [from, to],
      { label: 'earningsActuals.fetch', timeoutMs: 10000, maxRetries: 0 }
    );
    dbRows = result.rows;
  } catch (err) {
    console.error('[earningsActuals] DB fetch error:', err.message);
    return { updated: 0, errors: 1 };
  }

  console.log(`[earningsActuals] updating ${dbRows.length} earnings_events rows`);

  let updated = 0, errors = 0;

  for (const row of dbRows) {
    const sym  = String(row.symbol || '').toUpperCase();
    const date = String(row.report_date || '').slice(0, 10);
    const key  = `${sym}|${date}`;
    const fmp  = fmpMap.get(key);
    if (!fmp) continue;

    // Only update if FMP has new actual data we don't already have
    const newEpsActual = fmp.epsActual != null ? Number(fmp.epsActual) : null;
    const newRevActual = fmp.revenueActual != null ? Number(fmp.revenueActual) : null;
    const newEpsEst    = fmp.epsEstimated != null ? Number(fmp.epsEstimated) : null;
    const newRevEst    = fmp.revenueEstimated != null ? Number(fmp.revenueEstimated) : null;

    // Skip if nothing to update
    if (newEpsActual == null && newRevActual == null) continue;
    if (
      Number(row.eps_actual) === newEpsActual &&
      Number(row.rev_actual) === newRevActual &&
      row.eps_surprise_pct != null
    ) continue;

    // Compute surprise pct if we have both actual and estimate
    const epsEst = newEpsEst ?? (row.eps_estimate != null ? Number(row.eps_estimate) : null);
    let surprisePct = row.eps_surprise_pct != null ? Number(row.eps_surprise_pct) : null;
    if (newEpsActual != null && epsEst != null && epsEst !== 0) {
      surprisePct = ((newEpsActual - epsEst) / Math.abs(epsEst)) * 100;
    }

    try {
      await queryWithTimeout(
        `UPDATE earnings_events SET
           eps_actual       = COALESCE($1, eps_actual),
           rev_actual       = COALESCE($2, rev_actual),
           eps_estimate     = COALESCE($3, eps_estimate),
           rev_estimate     = COALESCE($4, rev_estimate),
           revenue_estimate = COALESCE($4, revenue_estimate),
           eps_surprise_pct = COALESCE($5, eps_surprise_pct),
           updated_at       = NOW()
         WHERE id = $6`,
        [newEpsActual, newRevActual, newEpsEst, newRevEst, surprisePct, row.id],
        { label: 'earningsActuals.update', timeoutMs: 3000, maxRetries: 0 }
      );
      updated++;
    } catch (err) {
      errors++;
    }
  }

  console.log(`[earningsActuals] updated ${updated} rows (${errors} errors)`);
  return { updated, errors };
}

/**
 * Backfill company name and sector from ticker_universe for earnings_events
 * where those fields are null.
 */
async function backfillCompanyAndSector() {
  console.log('[earningsActuals] backfilling company/sector from ticker_universe...');
  try {
    const result = await queryWithTimeout(
      `UPDATE earnings_events e
       SET
         company = COALESCE(e.company, tu.company_name),
         sector  = COALESCE(e.sector,  tu.sector)
       FROM ticker_universe tu
       WHERE UPPER(e.symbol) = UPPER(tu.symbol)
         AND (e.company IS NULL OR e.sector IS NULL)
       RETURNING e.symbol`,
      [],
      { label: 'earningsActuals.backfill', timeoutMs: 30000, maxRetries: 0 }
    );
    console.log(`[earningsActuals] backfilled ${result.rowCount} rows with company/sector`);
    return result.rowCount || 0;
  } catch (err) {
    console.error('[earningsActuals] backfill error:', err.message);
    return 0;
  }
}

/**
 * Backfill IPO sector from SPAC/company name pattern matching and FMP batch-quote.
 */
async function backfillIpoSector() {
  console.log('[earningsActuals] backfilling IPO sector from name patterns...');
  try {
    // Pattern-match known types from company name
    const result = await queryWithTimeout(
      `UPDATE ipo_calendar SET sector =
         CASE
           WHEN LOWER(company) LIKE '%acquisition corp%' OR LOWER(company) LIKE '%acquisition co%'
             OR LOWER(company) LIKE '%blank check%' OR LOWER(company) LIKE '%spac%' THEN 'Financial Services'
           WHEN LOWER(company) LIKE '%etf%' OR LOWER(company) LIKE '% fund%'
             OR LOWER(company) LIKE '%trust%' AND (LOWER(exchange) = 'nyse arca' OR LOWER(company) LIKE '%shares%') THEN 'Financial Services'
           WHEN LOWER(company) LIKE '%biotech%' OR LOWER(company) LIKE '%therapeutics%'
             OR LOWER(company) LIKE '%pharma%' OR LOWER(company) LIKE '%biopharma%' THEN 'Healthcare'
           WHEN LOWER(company) LIKE '%technology%' OR LOWER(company) LIKE '%tech%'
             OR LOWER(company) LIKE '%software%' THEN 'Technology'
           WHEN LOWER(company) LIKE '%energy%' OR LOWER(company) LIKE '%oil%'
             OR LOWER(company) LIKE '%gas%' THEN 'Energy'
           WHEN LOWER(company) LIKE '%bank%' OR LOWER(company) LIKE '%financial%'
             OR LOWER(company) LIKE '%capital%' OR LOWER(company) LIKE '%bancorp%' THEN 'Financial Services'
           WHEN LOWER(company) LIKE '%real estate%' OR LOWER(company) LIKE '% reit%' THEN 'Real Estate'
           ELSE NULL
         END
       WHERE sector IS NULL AND company IS NOT NULL
       RETURNING symbol`,
      [],
      { label: 'earningsActuals.ipoSector', timeoutMs: 10000, maxRetries: 0 }
    );
    console.log(`[earningsActuals] backfilled sector for ${result.rowCount} IPOs via name pattern`);
    return result.rowCount || 0;
  } catch (err) {
    console.error('[earningsActuals] IPO sector backfill error:', err.message);
    return 0;
  }
}

/**
 * Compute eps_surprise_pct for any row that has both eps_actual and eps_estimate
 * but is missing the surprise field (handles edge cases from prior runs).
 */
async function computeMissingSurprises() {
  try {
    const result = await queryWithTimeout(
      `UPDATE earnings_events
       SET eps_surprise_pct = ((eps_actual - eps_estimate) / NULLIF(ABS(eps_estimate), 0)) * 100,
           updated_at = NOW()
       WHERE eps_actual IS NOT NULL
         AND eps_estimate IS NOT NULL
         AND eps_estimate != 0
         AND eps_surprise_pct IS NULL
       RETURNING symbol`,
      [],
      { label: 'earningsActuals.surpriseFix', timeoutMs: 15000, maxRetries: 0 }
    );
    console.log(`[earningsActuals] computed surprise for ${result.rowCount} additional rows`);
    return result.rowCount || 0;
  } catch (err) {
    console.error('[earningsActuals] surprise compute error:', err.message);
    return 0;
  }
}

async function runAll() {
  const [actualsResult, backfilled, ipoSectors] = await Promise.all([
    refreshEarningsActuals(14, 7),
    backfillCompanyAndSector(),
    backfillIpoSector(),
  ]);
  const surprisesFixed = await computeMissingSurprises();
  return { ...actualsResult, backfilled, ipoSectors, surprisesFixed };
}

module.exports = { runAll, refreshEarningsActuals, backfillCompanyAndSector, backfillIpoSector, computeMissingSurprises };
