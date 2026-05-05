const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');
const { BATCH_DELAY_MS, MAX_SYMBOLS_PER_BATCH } = require('./_helpers');
const { resolveSmartMoneyWorkingSet } = require('../services/smartMoneyWorkingSet');

const ENDPOINT = '/insider-trading/search';
const DEFAULT_LIMIT = 100;
const MAX_PAGES = 5;

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.slice(0, 10);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeInsiderTradeRow(row, symbol) {
  const filingDate = parseDate(row?.filingDate);
  const transactionDate = parseDate(row?.transactionDate);
  const transactionType = String(row?.transactionType || '').trim();
  const reportingName = String(row?.reportingName || '').trim();

  if (!symbol || !filingDate || !transactionDate || !transactionType || !reportingName) {
    return { status: 'skipped', reason: 'missing_required_fields' };
  }

  const securitiesTransacted = toNumber(row?.securitiesTransacted);
  const price = toNumber(row?.price);

  return {
    status: 'upsert',
    row: {
      symbol,
      filing_date: filingDate,
      transaction_date: transactionDate,
      reporting_cik: row?.reportingCik ? String(row.reportingCik).trim() : null,
      reporting_name: reportingName,
      type_of_owner: row?.typeOfOwner ? String(row.typeOfOwner).trim() : null,
      transaction_type: transactionType,
      acquisition_or_disposition: row?.acquisitionOrDisposition ? String(row.acquisitionOrDisposition).trim().slice(0, 1).toUpperCase() : null,
      form_type: row?.formType ? String(row.formType).trim() : null,
      securities_transacted: securitiesTransacted,
      securities_owned: toNumber(row?.securitiesOwned),
      price,
      total_value: securitiesTransacted != null && price != null ? Number((securitiesTransacted * price).toFixed(4)) : null,
      security_name: row?.securityName ? String(row.securityName).trim() : null,
      sec_filing_url: row?.url ? String(row.url) : null,
      raw_payload: row,
    },
  };
}

async function upsertInsiderTrades(rows, options = {}) {
  const dedupedRows = Array.from(
    rows.reduce((accumulator, row) => {
      const key = [
        row.symbol,
        row.reporting_cik || '',
        row.transaction_date,
        row.transaction_type,
        row.securities_transacted ?? '',
      ].join('::');
      accumulator.set(key, row);
      return accumulator;
    }, new Map()).values()
  );

  if (options.dryRun) {
    return { upserted: 0, deduped: dedupedRows.length };
  }

  if (dedupedRows.length === 0) {
    return { upserted: 0, deduped: 0 };
  }

  await queryWithTimeout(
    `INSERT INTO insider_trades (
       symbol,
       filing_date,
       transaction_date,
       reporting_cik,
       reporting_name,
       type_of_owner,
       transaction_type,
       acquisition_or_disposition,
       form_type,
       securities_transacted,
       securities_owned,
       price,
       total_value,
       security_name,
       sec_filing_url,
       raw_payload
     )
     SELECT
       payload.symbol,
       payload.filing_date::date,
       payload.transaction_date::date,
       payload.reporting_cik,
       payload.reporting_name,
       payload.type_of_owner,
       payload.transaction_type,
       payload.acquisition_or_disposition,
       payload.form_type,
       payload.securities_transacted,
       payload.securities_owned,
       payload.price,
       payload.total_value,
       payload.security_name,
       payload.sec_filing_url,
       payload.raw_payload::jsonb
     FROM json_to_recordset($1::json) AS payload(
       symbol text,
       filing_date text,
       transaction_date text,
       reporting_cik text,
       reporting_name text,
       type_of_owner text,
       transaction_type text,
       acquisition_or_disposition text,
       form_type text,
       securities_transacted numeric,
       securities_owned numeric,
       price numeric,
       total_value numeric,
       security_name text,
       sec_filing_url text,
       raw_payload jsonb
     )
     ON CONFLICT (symbol, reporting_cik, transaction_date, transaction_type, securities_transacted) DO UPDATE SET
       filing_date = EXCLUDED.filing_date,
       reporting_name = EXCLUDED.reporting_name,
       type_of_owner = EXCLUDED.type_of_owner,
       acquisition_or_disposition = EXCLUDED.acquisition_or_disposition,
       form_type = EXCLUDED.form_type,
       securities_owned = EXCLUDED.securities_owned,
       price = EXCLUDED.price,
       total_value = EXCLUDED.total_value,
       security_name = EXCLUDED.security_name,
       sec_filing_url = EXCLUDED.sec_filing_url,
       raw_payload = EXCLUDED.raw_payload,
       ingested_at = NOW()`,
    [JSON.stringify(dedupedRows)],
    {
      label: 'smart_money.insider_trades.upsert',
      timeoutMs: 30000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return { upserted: dedupedRows.length, deduped: dedupedRows.length };
}

async function fetchSymbolRows(symbol, options = {}) {
  const limit = Math.max(1, Number(options.limit) || DEFAULT_LIMIT);
  const maxPages = Math.max(1, Number(options.maxPages) || MAX_PAGES);
  const normalizedRows = [];
  let pagesFetched = 0;
  let skipped = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fmpFetch(ENDPOINT, { symbol, limit, page });
    const rows = Array.isArray(payload) ? payload : [];
    if (rows.length === 0) break;
    pagesFetched += 1;

    rows.forEach((row) => {
      const normalized = normalizeInsiderTradeRow(row, symbol);
      if (normalized.status === 'upsert') {
        normalizedRows.push(normalized.row);
      } else {
        skipped += 1;
      }
    });

    if (rows.length < limit) break;
  }

  return { rows: normalizedRows, pagesFetched, skipped };
}

async function runIngest(options = {}) {
  const dryRun = options.dryRun === true || String(process.env.DRY_RUN || '').toLowerCase() === '1' || String(process.env.DRY_RUN || '').toLowerCase() === 'true';
  const symbols = Array.isArray(options.symbols) && options.symbols.length
    ? options.symbols.map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean)
    : await resolveSmartMoneyWorkingSet({ maxSymbols: options.maxSymbols || 1000 });

  let fetched = 0;
  let skipped = 0;
  let apiErrors = 0;
  const allRows = [];

  for (let index = 0; index < symbols.length; index += MAX_SYMBOLS_PER_BATCH) {
    const batch = symbols.slice(index, index + MAX_SYMBOLS_PER_BATCH);
    for (const symbol of batch) {
      try {
        const result = await fetchSymbolRows(symbol, options);
        fetched += result.rows.length;
        skipped += result.skipped;
        allRows.push(...result.rows);
      } catch (error) {
        apiErrors += 1;
        logger.error('smart money insider symbol fetch failed', { symbol, error: error.message });
      }
    }

    if (index + MAX_SYMBOLS_PER_BATCH < symbols.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  const persistence = await upsertInsiderTrades(allRows, { dryRun });
  logger.info('smart money insider ingest complete', {
    dryRun,
    symbols: symbols.length,
    fetched,
    deduped: persistence.deduped,
    inserted: persistence.upserted,
    skipped,
    apiErrors,
  });

  return {
    jobName: 'fmp_insider_trades_ingest',
    dryRun,
    symbols: symbols.length,
    fetched,
    deduped: persistence.deduped,
    inserted: persistence.upserted,
    skipped,
    apiErrors,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_PAGES,
  ENDPOINT,
  fetchSymbolRows,
  normalizeInsiderTradeRow,
  runIngest,
  upsertInsiderTrades,
};