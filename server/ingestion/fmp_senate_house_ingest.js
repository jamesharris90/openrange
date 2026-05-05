const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');
const { BATCH_DELAY_MS, MAX_SYMBOLS_PER_BATCH } = require('./_helpers');
const { resolveSmartMoneyWorkingSet } = require('../services/smartMoneyWorkingSet');

const LATEST_LIMIT = 100;
const MAX_LATEST_PAGES = 10;
const BACKFILL_LOOKBACK_DAYS = 30;

function parseDate(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 10) : null;
}

function parseBooleanLike(value) {
  if (value === true || value === false) return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['true', 'yes', '1'].includes(normalized)) return true;
  if (['false', 'no', '0'].includes(normalized)) return false;
  return null;
}

function parseMoneyValue(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[$,\s]/g, '').trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseAmountRange(rangeString) {
  const raw = String(rangeString || '').trim();
  if (!raw || raw.toLowerCase() === 'spouse/dc') {
    return { min: null, max: null };
  }

  const overMatch = raw.match(/^Over\s+\$?([\d,]+)$/i);
  if (overMatch) {
    return { min: parseMoneyValue(overMatch[1]), max: null };
  }

  const rangeMatch = raw.match(/^\$?([\d,]+)\s*-\s*\$?([\d,]+)$/);
  if (rangeMatch) {
    return {
      min: parseMoneyValue(rangeMatch[1]),
      max: parseMoneyValue(rangeMatch[2]),
    };
  }

  return { min: null, max: null };
}

function normalizeChamber(chamber) {
  return String(chamber || '').trim().toLowerCase() === 'house' ? 'House' : 'Senate';
}

function buildMemberName(firstName, lastName) {
  const fullName = `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.trim();
  return fullName || null;
}

function normalizeCongressionalRow(row, chamber) {
  const symbol = String(row?.symbol || '').trim().toUpperCase();
  const disclosureDate = parseDate(row?.disclosureDate);
  const transactionDate = parseDate(row?.transactionDate);
  const transactionType = String(row?.type || '').trim();
  const memberFirstName = String(row?.firstName || '').trim();
  const memberLastName = String(row?.lastName || '').trim();
  const fullMemberName = buildMemberName(memberFirstName, memberLastName);
  const amountRange = String(row?.amount || '').trim() || null;

  if (!symbol || !disclosureDate || !transactionDate || !transactionType || !fullMemberName) {
    return { status: 'skipped', reason: 'missing_required_fields' };
  }

  const amount = parseAmountRange(amountRange);
  return {
    status: 'upsert',
    row: {
      chamber: normalizeChamber(chamber),
      symbol,
      disclosure_date: disclosureDate,
      transaction_date: transactionDate,
      first_name: memberFirstName || null,
      last_name: memberLastName || null,
      office: row?.office ? String(row.office).trim() : null,
      district: row?.district ? String(row.district).trim() : null,
      owner: row?.owner ? String(row.owner).trim() : 'Self',
      asset_description: row?.assetDescription ? String(row.assetDescription).trim() : null,
      asset_type: row?.assetType ? String(row.assetType).trim() : null,
      transaction_type: transactionType,
      amount_range: amountRange,
      amount_min: amount.min,
      amount_max: amount.max,
      capital_gains_over_200: parseBooleanLike(row?.capitalGainsOver200USD),
      comment: row?.comment ? String(row.comment).trim() : null,
      source_link: row?.link ? String(row.link).trim() : null,
      member_first_name: memberFirstName || null,
      member_last_name: memberLastName || null,
      member_office: row?.office ? String(row.office).trim() : null,
      member_district: row?.district ? String(row.district).trim() : null,
      owner_type: row?.owner ? String(row.owner).trim() : 'Self',
      has_capital_gains_over_200_usd: parseBooleanLike(row?.capitalGainsOver200USD),
      notes: row?.comment ? String(row.comment).trim() : null,
      filing_url: row?.link ? String(row.link).trim() : null,
      amount_min_usd: amount.min,
      amount_max_usd: amount.max,
      full_member_name: fullMemberName,
      raw_payload: row,
    },
    parseWarning: amountRange && amount.min == null && amount.max == null ? 'unparsed_amount_range' : null,
  };
}

function dedupeRows(rows) {
  const keyed = new Map();
  rows.forEach((row) => {
    const key = [
      row.symbol,
      row.full_member_name || '',
      row.transaction_date,
      row.transaction_type,
      row.amount_range || '',
    ].join('::');
    keyed.set(key, row);
  });
  return Array.from(keyed.values());
}

async function fetchLatestRows(chamber, options = {}) {
  const limit = Math.max(1, Number(options.limit) || LATEST_LIMIT);
  const maxPages = Math.max(1, Number(options.maxPages) || MAX_LATEST_PAGES);
  const endpoint = chamber === 'House' ? '/house-latest' : '/senate-latest';
  const normalizedRows = [];
  let fetched = 0;
  let skipped = 0;
  let parseWarnings = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fmpFetch(endpoint, { page, limit });
    const rows = Array.isArray(payload) ? payload : [];
    if (rows.length === 0) break;
    fetched += rows.length;

    rows.forEach((row) => {
      const normalized = normalizeCongressionalRow(row, chamber);
      if (normalized.status === 'upsert') {
        normalizedRows.push(normalized.row);
        if (normalized.parseWarning) parseWarnings += 1;
      } else {
        skipped += 1;
      }
    });

    if (rows.length < limit) break;
  }

  return { rows: normalizedRows, fetched, skipped, parseWarnings };
}

async function fetchSymbolBackfillRows(symbol, chamber) {
  const endpoint = chamber === 'House' ? '/house-trades' : '/senate-trades';
  const payload = await fmpFetch(endpoint, { symbol });
  const rows = Array.isArray(payload) ? payload : [];
  let skipped = 0;
  let parseWarnings = 0;
  const normalizedRows = [];

  rows.forEach((row) => {
    const normalized = normalizeCongressionalRow(row, chamber);
    if (normalized.status === 'upsert') {
      normalizedRows.push(normalized.row);
      if (normalized.parseWarning) parseWarnings += 1;
    } else {
      skipped += 1;
    }
  });

  return { rows: normalizedRows, fetched: rows.length, skipped, parseWarnings };
}

async function loadRecentSymbols(symbols) {
  if (!symbols.length) return new Set();
  const result = await queryWithTimeout(
    `SELECT DISTINCT UPPER(symbol) AS symbol
     FROM congressional_trades
     WHERE UPPER(symbol) = ANY($1::text[])
       AND disclosure_date >= CURRENT_DATE - INTERVAL '${BACKFILL_LOOKBACK_DAYS} days'`,
    [symbols],
    {
      label: 'congressional_trades.recent_symbols',
      timeoutMs: 15000,
      maxRetries: 0,
      poolType: 'read',
    }
  );
  return new Set((result.rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean));
}

async function upsertCongressionalTrades(rows, options = {}) {
  const dedupedRows = dedupeRows(rows);
  const duplicates = rows.length - dedupedRows.length;

  if (options.dryRun || dedupedRows.length === 0) {
    return { upserted: 0, deduped: dedupedRows.length, duplicates };
  }

  await queryWithTimeout(
    `INSERT INTO congressional_trades (
       chamber,
       symbol,
       disclosure_date,
       transaction_date,
       first_name,
       last_name,
       office,
       district,
       owner,
       asset_description,
       asset_type,
       transaction_type,
       amount_range,
       amount_min,
       amount_max,
       capital_gains_over_200,
       comment,
       source_link,
       member_first_name,
       member_last_name,
       member_office,
       member_district,
       owner_type,
       has_capital_gains_over_200_usd,
       notes,
       filing_url,
       amount_min_usd,
       amount_max_usd,
       raw_payload,
       ingested_at
     )
     SELECT
       payload.chamber,
       payload.symbol,
       payload.disclosure_date::date,
       payload.transaction_date::date,
       payload.first_name,
       payload.last_name,
       payload.office,
       payload.district,
       payload.owner,
       payload.asset_description,
       payload.asset_type,
       payload.transaction_type,
       payload.amount_range,
       payload.amount_min,
       payload.amount_max,
       payload.capital_gains_over_200,
       payload.comment,
       payload.source_link,
       payload.member_first_name,
       payload.member_last_name,
       payload.member_office,
       payload.member_district,
       payload.owner_type,
       payload.has_capital_gains_over_200_usd,
       payload.notes,
       payload.filing_url,
       payload.amount_min_usd,
       payload.amount_max_usd,
       payload.raw_payload::jsonb,
       NOW()
     FROM json_to_recordset($1::json) AS payload(
       chamber text,
       symbol text,
       disclosure_date text,
       transaction_date text,
       first_name text,
       last_name text,
       office text,
       district text,
       owner text,
       asset_description text,
       asset_type text,
       transaction_type text,
       amount_range text,
       amount_min numeric,
       amount_max numeric,
       capital_gains_over_200 boolean,
       comment text,
       source_link text,
       member_first_name text,
       member_last_name text,
       member_office text,
       member_district text,
       owner_type text,
       has_capital_gains_over_200_usd boolean,
       notes text,
       filing_url text,
       amount_min_usd numeric,
       amount_max_usd numeric,
       full_member_name text,
       raw_payload jsonb
     )
     ON CONFLICT (symbol, full_member_name, transaction_date, transaction_type, amount_range) DO UPDATE SET
       chamber = EXCLUDED.chamber,
       disclosure_date = EXCLUDED.disclosure_date,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       office = EXCLUDED.office,
       district = EXCLUDED.district,
       owner = EXCLUDED.owner,
       asset_description = EXCLUDED.asset_description,
       asset_type = EXCLUDED.asset_type,
       amount_min = EXCLUDED.amount_min,
       amount_max = EXCLUDED.amount_max,
       capital_gains_over_200 = EXCLUDED.capital_gains_over_200,
       comment = EXCLUDED.comment,
       source_link = EXCLUDED.source_link,
       member_first_name = EXCLUDED.member_first_name,
       member_last_name = EXCLUDED.member_last_name,
       member_office = EXCLUDED.member_office,
       member_district = EXCLUDED.member_district,
       owner_type = EXCLUDED.owner_type,
       has_capital_gains_over_200_usd = EXCLUDED.has_capital_gains_over_200_usd,
       notes = EXCLUDED.notes,
       filing_url = EXCLUDED.filing_url,
       amount_min_usd = EXCLUDED.amount_min_usd,
       amount_max_usd = EXCLUDED.amount_max_usd,
       raw_payload = EXCLUDED.raw_payload,
       ingested_at = NOW(),
       fetched_at = NOW()`,
    [JSON.stringify(dedupedRows)],
    {
      label: 'smart_money.congressional_trades.upsert',
      timeoutMs: 30000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return { upserted: dedupedRows.length, deduped: dedupedRows.length, duplicates };
}

async function runIngest(options = {}) {
  const dryRun = options.DRY_RUN === true || options.dryRun === true || String(process.env.DRY_RUN || '').toLowerCase() === '1' || String(process.env.DRY_RUN || '').toLowerCase() === 'true';
  const includeBackfill = options.includeBackfill === true;
  const skipLatest = options.skipLatest === true;
  const metrics = {
    latest: { fetched: 0, skipped: 0, parseWarnings: 0, apiErrors: 0 },
    backfill: { fetched: 0, skipped: 0, parseWarnings: 0, apiErrors: 0, symbolsSkipped: 0, symbolsProcessed: 0 },
  };
  const allRows = [];

  if (!skipLatest) {
    for (const chamber of ['Senate', 'House']) {
      try {
        const result = await fetchLatestRows(chamber, options);
        metrics.latest.fetched += result.fetched;
        metrics.latest.skipped += result.skipped;
        metrics.latest.parseWarnings += result.parseWarnings;
        allRows.push(...result.rows);
      } catch (error) {
        metrics.latest.apiErrors += 1;
        logger.error('congressional latest fetch failed', { chamber, error: error.message });
      }
    }
  }

  if (includeBackfill) {
    const symbols = Array.isArray(options.symbols) && options.symbols.length
      ? options.symbols.map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean)
      : await resolveSmartMoneyWorkingSet({ maxSymbols: options.maxSymbols || 1000 });
    const recentSymbols = await loadRecentSymbols(symbols);
    const backfillSymbols = symbols.filter((symbol) => !recentSymbols.has(symbol));
    metrics.backfill.symbolsSkipped = symbols.length - backfillSymbols.length;

    for (let index = 0; index < backfillSymbols.length; index += MAX_SYMBOLS_PER_BATCH) {
      const batch = backfillSymbols.slice(index, index + MAX_SYMBOLS_PER_BATCH);
      for (const symbol of batch) {
        metrics.backfill.symbolsProcessed += 1;
        for (const chamber of ['Senate', 'House']) {
          try {
            const result = await fetchSymbolBackfillRows(symbol, chamber);
            metrics.backfill.fetched += result.fetched;
            metrics.backfill.skipped += result.skipped;
            metrics.backfill.parseWarnings += result.parseWarnings;
            allRows.push(...result.rows);
          } catch (error) {
            metrics.backfill.apiErrors += 1;
            logger.error('congressional backfill fetch failed', { symbol, chamber, error: error.message });
          }
        }
      }

      if (index + MAX_SYMBOLS_PER_BATCH < backfillSymbols.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
  }

  const persistence = await upsertCongressionalTrades(allRows, { dryRun });
  const result = {
    jobName: 'fmp_senate_house_ingest',
    dryRun,
    includeBackfill,
    fetched: metrics.latest.fetched + metrics.backfill.fetched,
    deduped: persistence.deduped,
    inserted: persistence.upserted,
    duplicates: persistence.duplicates,
    skipped: metrics.latest.skipped + metrics.backfill.skipped,
    parseWarnings: metrics.latest.parseWarnings + metrics.backfill.parseWarnings,
    apiErrors: metrics.latest.apiErrors + metrics.backfill.apiErrors,
    latest: metrics.latest,
    backfill: metrics.backfill,
  };

  logger.info('congressional senate-house ingest complete', result);
  return result;
}

module.exports = {
  BACKFILL_LOOKBACK_DAYS,
  LATEST_LIMIT,
  MAX_LATEST_PAGES,
  fetchLatestRows,
  fetchSymbolBackfillRows,
  normalizeCongressionalRow,
  parseAmountRange,
  runIngest,
  upsertCongressionalTrades,
};