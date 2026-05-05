const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');
const { BATCH_DELAY_MS, MAX_SYMBOLS_PER_BATCH } = require('./_helpers');
const { resolveSmartMoneyWorkingSet } = require('../services/smartMoneyWorkingSet');

const ENDPOINT = '/acquisition-of-beneficial-ownership';
const DEFAULT_LIMIT = 20;

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.slice(0, 10);
}

function parseTimestamp(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}T00:00:00Z`.replace('T00:00:00ZT00:00:00Z', 'T00:00:00Z');
  const parsed = new Date(normalized.includes('T') && normalized.endsWith('Z') ? normalized : `${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function inferFormType(row) {
  const explicit = String(row?.formType || '').trim().toUpperCase();
  if (explicit.startsWith('SC 13D') || explicit.startsWith('SC 13G')) {
    return explicit;
  }

  const url = String(row?.url || '').toLowerCase();
  if (url.includes('13da')) return 'SC 13D/A';
  if (url.includes('13ga')) return 'SC 13G/A';
  if (url.includes('13d')) return 'SC 13D';
  if (url.includes('13g')) return 'SC 13G';
  return null;
}

function normalizeActivistFiling(row, symbol) {
  const cik = String(row?.cik || '').trim();
  const reportingPerson = String(row?.nameOfReportingPerson || '').trim();
  const filingDate = parseDate(row?.filingDate);
  const formType = inferFormType(row);

  if (!symbol || !cik || !reportingPerson || !filingDate || !formType) {
    return { status: 'skipped', reason: 'missing_required_fields' };
  }

  return {
    status: 'upsert',
    row: {
      symbol,
      cik,
      filing_date: filingDate,
      accepted_date: parseTimestamp(row?.acceptedDate),
      reporting_person: reportingPerson,
      citizenship_or_organization: row?.citizenshipOrPlaceOfOrganization ? String(row.citizenshipOrPlaceOfOrganization).trim() : null,
      type_of_reporting_person: row?.typeOfReportingPerson ? String(row.typeOfReportingPerson).trim() : null,
      form_type: formType,
      amount_beneficially_owned: toNumber(row?.amountBeneficiallyOwned),
      percent_of_class: toNumber(row?.percentOfClass),
      sole_voting_power: toNumber(row?.soleVotingPower),
      shared_voting_power: toNumber(row?.sharedVotingPower),
      sole_dispositive_power: toNumber(row?.soleDispositivePower),
      shared_dispositive_power: toNumber(row?.sharedDispositivePower),
      sec_filing_url: row?.url ? String(row.url) : null,
      cusip: row?.cusip ? String(row.cusip).trim() : null,
      raw_payload: row,
    },
  };
}

async function upsertActivistFilings(rows, options = {}) {
  const dedupedRows = Array.from(
    rows.reduce((accumulator, row) => {
      accumulator.set(`${row.symbol}::${row.cik}::${row.filing_date}::${row.form_type}`, row);
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
    `INSERT INTO activist_filings (
       symbol,
       cik,
       filing_date,
       accepted_date,
       reporting_person,
       citizenship_or_organization,
       type_of_reporting_person,
       form_type,
       amount_beneficially_owned,
       percent_of_class,
       sole_voting_power,
       shared_voting_power,
       sole_dispositive_power,
       shared_dispositive_power,
       sec_filing_url,
       cusip,
       raw_payload
     )
     SELECT
       payload.symbol,
       payload.cik,
       payload.filing_date::date,
       payload.accepted_date::timestamptz,
       payload.reporting_person,
       payload.citizenship_or_organization,
       payload.type_of_reporting_person,
       payload.form_type,
       payload.amount_beneficially_owned,
       payload.percent_of_class,
       payload.sole_voting_power,
       payload.shared_voting_power,
       payload.sole_dispositive_power,
       payload.shared_dispositive_power,
       payload.sec_filing_url,
       payload.cusip,
       payload.raw_payload::jsonb
     FROM json_to_recordset($1::json) AS payload(
       symbol text,
       cik text,
       filing_date text,
       accepted_date text,
       reporting_person text,
       citizenship_or_organization text,
       type_of_reporting_person text,
       form_type text,
       amount_beneficially_owned numeric,
       percent_of_class numeric,
       sole_voting_power numeric,
       shared_voting_power numeric,
       sole_dispositive_power numeric,
       shared_dispositive_power numeric,
       sec_filing_url text,
       cusip text,
       raw_payload jsonb
     )
     ON CONFLICT (symbol, cik, filing_date, form_type) DO UPDATE SET
       accepted_date = EXCLUDED.accepted_date,
       reporting_person = EXCLUDED.reporting_person,
       citizenship_or_organization = EXCLUDED.citizenship_or_organization,
       type_of_reporting_person = EXCLUDED.type_of_reporting_person,
       amount_beneficially_owned = EXCLUDED.amount_beneficially_owned,
       percent_of_class = EXCLUDED.percent_of_class,
       sole_voting_power = EXCLUDED.sole_voting_power,
       shared_voting_power = EXCLUDED.shared_voting_power,
       sole_dispositive_power = EXCLUDED.sole_dispositive_power,
       shared_dispositive_power = EXCLUDED.shared_dispositive_power,
       sec_filing_url = EXCLUDED.sec_filing_url,
       cusip = EXCLUDED.cusip,
       raw_payload = EXCLUDED.raw_payload,
       ingested_at = NOW()`,
    [JSON.stringify(dedupedRows)],
    {
      label: 'smart_money.activist_filings.upsert',
      timeoutMs: 30000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return { upserted: dedupedRows.length, deduped: dedupedRows.length };
}

async function fetchSymbolRows(symbol, options = {}) {
  const limit = Math.max(1, Number(options.limit) || DEFAULT_LIMIT);
  const payload = await fmpFetch(ENDPOINT, { symbol, limit });
  const rows = Array.isArray(payload) ? payload : [];
  const normalizedRows = [];
  let skipped = 0;

  rows.forEach((row) => {
    const normalized = normalizeActivistFiling(row, symbol);
    if (normalized.status === 'upsert') {
      normalizedRows.push(normalized.row);
    } else {
      skipped += 1;
    }
  });

  return { rows: normalizedRows, skipped };
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
        logger.error('smart money activist symbol fetch failed', { symbol, error: error.message });
      }
    }

    if (index + MAX_SYMBOLS_PER_BATCH < symbols.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  const persistence = await upsertActivistFilings(allRows, { dryRun });
  logger.info('smart money activist ingest complete', {
    dryRun,
    symbols: symbols.length,
    fetched,
    deduped: persistence.deduped,
    inserted: persistence.upserted,
    skipped,
    apiErrors,
  });

  return {
    jobName: 'fmp_activist_filings_ingest',
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
  ENDPOINT,
  fetchSymbolRows,
  inferFormType,
  normalizeActivistFiling,
  runIngest,
  upsertActivistFilings,
};