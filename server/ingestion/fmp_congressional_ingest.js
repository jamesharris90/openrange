/**
 * Phase C1: Congressional trades ingestion from FMP.
 *
 * Endpoints:
 *   /stable/senate-latest?page=0&limit=100
 *   /stable/house-latest?page=0&limit=100
 *
 * Pulls 100 most recent filings per chamber, upserts to congressional_trades.
 * Idempotent via natural key UNIQUE constraint.
 */

const { queryWithTimeout } = require('../db/pg');
const { fmpFetch } = require('../services/fmpClient');

function normalizeDateOnly(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function cleanText(value) {
  if (value == null) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function parseAmountRange(range) {
  if (!range || typeof range !== 'string') return { min: null, max: null };

  const standard = range.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
  if (standard) {
    return {
      min: parseInt(standard[1].replace(/,/g, ''), 10),
      max: parseInt(standard[2].replace(/,/g, ''), 10),
    };
  }

  const over = range.match(/Over\s*\$([\d,]+)/i);
  if (over) {
    return {
      min: parseInt(over[1].replace(/,/g, ''), 10),
      max: null,
    };
  }

  return { min: null, max: null };
}

function parseCapitalGainsFlag(value) {
  if (value === true || value === 'True' || value === 'true') return true;
  if (value === false || value === 'False' || value === 'false') return false;
  return null;
}

function normalizeSymbol(value) {
  const symbol = cleanText(value);
  if (!symbol) return '';
  return symbol.toUpperCase();
}

function normalizeRow(row, chamber) {
  const amountRange = cleanText(row.amount ?? row.amountRange ?? row.amount_range);
  const { min, max } = parseAmountRange(amountRange);

  return {
    chamber,
    symbol: normalizeSymbol(row.symbol ?? row.ticker),
    disclosure_date: normalizeDateOnly(row.disclosureDate ?? row.disclosure_date ?? row.disclosureDateString),
    transaction_date: normalizeDateOnly(row.transactionDate ?? row.transaction_date ?? row.transactionDateString),
    first_name: cleanText(row.firstName ?? row.first_name),
    last_name: cleanText(row.lastName ?? row.last_name ?? row.representative),
    office: cleanText(row.office),
    district: cleanText(row.district),
    owner: cleanText(row.owner),
    asset_description: cleanText(row.assetDescription ?? row.asset_description ?? row.asset),
    asset_type: cleanText(row.assetType ?? row.asset_type),
    transaction_type: cleanText(row.type ?? row.transactionType ?? row.transaction_type),
    amount_range: amountRange,
    amount_min: min,
    amount_max: max,
    capital_gains_over_200: parseCapitalGainsFlag(row.capitalGainsOver200USD ?? row.capital_gains_over_200),
    comment: cleanText(row.comment),
    source_link: cleanText(row.link ?? row.sourceLink ?? row.source_link),
  };
}

async function fetchLatestSenate() {
  return fmpFetch('/senate-latest', { page: 0, limit: 100 });
}

async function fetchLatestHouse() {
  return fmpFetch('/house-latest', { page: 0, limit: 100 });
}

async function upsertRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0, skipped: 0 };

  let inserted = 0;
  let skipped = 0;

  const insertSQL = `
    INSERT INTO congressional_trades (
      chamber, symbol, disclosure_date, transaction_date,
      first_name, last_name, office, district, owner,
      asset_description, asset_type, transaction_type,
      amount_range, amount_min, amount_max,
      capital_gains_over_200, comment, source_link
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14, $15, $16, $17, $18
    )
    ON CONFLICT ON CONSTRAINT congressional_trades_natural_key DO NOTHING
    RETURNING id
  `;

  for (const row of rows) {
    if (!row.symbol || !row.disclosure_date || !row.transaction_date || !row.last_name) {
      skipped += 1;
      continue;
    }

    try {
      const result = await queryWithTimeout(
        insertSQL,
        [
          row.chamber,
          row.symbol,
          row.disclosure_date,
          row.transaction_date,
          row.first_name,
          row.last_name,
          row.office,
          row.district,
          row.owner,
          row.asset_description,
          row.asset_type,
          row.transaction_type,
          row.amount_range,
          row.amount_min,
          row.amount_max,
          row.capital_gains_over_200,
          row.comment,
          row.source_link,
        ],
        {
          label: 'congressional_trades.insert',
          timeoutMs: 8000,
          slowQueryMs: 1000,
          poolType: 'write',
          maxRetries: 1,
        },
      );

      if (result.rowCount > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      console.error(`[congressional] Insert failed for ${row.chamber} ${row.last_name}/${row.symbol}: ${error.message}`);
      skipped += 1;
    }
  }

  return { inserted, skipped };
}

async function runCongressionalIngestion() {
  const startTime = Date.now();
  console.log('[congressional] Starting ingestion at', new Date().toISOString());

  let senateRows = [];
  let houseRows = [];

  try {
    const senateData = await fetchLatestSenate();
    senateRows = (Array.isArray(senateData) ? senateData : []).map((row) => normalizeRow(row, 'senate'));
    console.log(`[congressional] Fetched ${senateRows.length} senate rows`);
  } catch (error) {
    console.error('[congressional] Senate fetch error:', error.message);
  }

  try {
    const houseData = await fetchLatestHouse();
    houseRows = (Array.isArray(houseData) ? houseData : []).map((row) => normalizeRow(row, 'house'));
    console.log(`[congressional] Fetched ${houseRows.length} house rows`);
  } catch (error) {
    console.error('[congressional] House fetch error:', error.message);
  }

  const senateResult = await upsertRows(senateRows);
  const houseResult = await upsertRows(houseRows);

  const totalInserted = senateResult.inserted + houseResult.inserted;
  const totalSkipped = senateResult.skipped + houseResult.skipped;
  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log(`[congressional] Senate: ${senateResult.inserted} new, ${senateResult.skipped} dupe/skip`);
  console.log(`[congressional] House:  ${houseResult.inserted} new, ${houseResult.skipped} dupe/skip`);
  console.log(`[congressional] Total: ${totalInserted} inserted, ${totalSkipped} skipped, ${duration}s`);

  return {
    inserted: totalInserted,
    skipped: totalSkipped,
    duration,
    senate: senateResult,
    house: houseResult,
  };
}

module.exports = {
  fetchLatestHouse,
  fetchLatestSenate,
  normalizeRow,
  parseAmountRange,
  runCongressionalIngestion,
  upsertRows,
};