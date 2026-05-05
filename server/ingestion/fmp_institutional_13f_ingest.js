const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');
const { BATCH_DELAY_MS, MAX_SYMBOLS_PER_BATCH } = require('./_helpers');
const { resolveSmartMoneyWorkingSet } = require('../services/smartMoneyWorkingSet');

const ENDPOINT = '/institutional-ownership/extract-analytics/holder';
const DEFAULT_LIMIT = 100;
const MAX_PAGES = 10;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.slice(0, 10);
}

function currentQuarterParts(now = new Date()) {
  const month = now.getUTCMonth();
  const quarter = Math.floor(month / 3) + 1;
  return { year: now.getUTCFullYear(), quarter };
}

function shiftQuarter(year, quarter, delta) {
  let nextYear = year;
  let nextQuarter = quarter + delta;
  while (nextQuarter <= 0) {
    nextQuarter += 4;
    nextYear -= 1;
  }
  while (nextQuarter > 4) {
    nextQuarter -= 4;
    nextYear += 1;
  }
  return { year: nextYear, quarter: nextQuarter };
}

function resolveTargetQuarters(now = new Date()) {
  const { year, quarter } = currentQuarterParts(now);
  const primary = shiftQuarter(year, quarter, -1);
  const quarterStart = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const daysIntoQuarter = Math.floor((now.getTime() - quarterStart.getTime()) / (24 * 60 * 60 * 1000));
  if (daysIntoQuarter > 50) {
    return [primary, shiftQuarter(year, quarter, -2)];
  }
  return [primary];
}

function normalizeInstitutionalHolding(row, symbol) {
  const cik = String(row?.cik || '').trim();
  const investorName = String(row?.investorName || '').trim();
  const filingDate = parseDate(row?.filingDate);
  const periodEndDate = parseDate(row?.date);
  if (!symbol || !cik || !investorName || !filingDate || !periodEndDate) {
    return { status: 'skipped', reason: 'missing_required_fields' };
  }

  return {
    status: 'upsert',
    row: {
      symbol,
      cik,
      investor_name: investorName,
      filing_date: filingDate,
      period_end_date: periodEndDate,
      shares_held: toNumber(row?.sharesNumber),
      shares_change: toNumber(row?.changeInSharesNumber),
      shares_change_pct: toNumber(row?.changeInSharesNumberPercentage),
      market_value: toNumber(row?.marketValue),
      change_in_market_value: toNumber(row?.changeInMarketValue),
      change_in_market_value_pct: toNumber(row?.changeInMarketValuePercentage),
      weight_pct: toNumber(row?.weight),
      change_in_weight_pct: toNumber(row?.changeInWeightPercentage),
      ownership_pct: toNumber(row?.ownership),
      change_in_ownership_pct: toNumber(row?.changeInOwnershipPercentage),
      is_new_position: row?.isNew === true,
      is_sold_out: row?.isSoldOut === true,
      holding_period_quarters: row?.holdingPeriod == null ? null : Number.parseInt(row.holdingPeriod, 10),
      first_added: parseDate(row?.firstAdded),
      avg_price_paid: toNumber(row?.avgPricePaid),
      raw_payload: row,
    },
  };
}

async function upsertInstitutionalHoldings(rows, options = {}) {
  const dedupedRows = Array.from(
    rows.reduce((accumulator, row) => {
      accumulator.set(`${row.symbol}::${row.cik}::${row.period_end_date}`, row);
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
    `INSERT INTO institutional_holdings_13f (
       symbol,
       cik,
       investor_name,
       filing_date,
       period_end_date,
       shares_held,
       shares_change,
       shares_change_pct,
       market_value,
       change_in_market_value,
       change_in_market_value_pct,
       weight_pct,
       change_in_weight_pct,
       ownership_pct,
       change_in_ownership_pct,
       is_new_position,
       is_sold_out,
       holding_period_quarters,
       first_added,
       avg_price_paid,
       raw_payload
     )
     SELECT
       payload.symbol,
       payload.cik,
       payload.investor_name,
       payload.filing_date::date,
       payload.period_end_date::date,
       payload.shares_held,
       payload.shares_change,
       payload.shares_change_pct,
       payload.market_value,
       payload.change_in_market_value,
       payload.change_in_market_value_pct,
       payload.weight_pct,
       payload.change_in_weight_pct,
       payload.ownership_pct,
       payload.change_in_ownership_pct,
       payload.is_new_position::boolean,
       payload.is_sold_out::boolean,
       payload.holding_period_quarters,
       payload.first_added::date,
       payload.avg_price_paid,
       payload.raw_payload::jsonb
     FROM json_to_recordset($1::json) AS payload(
       symbol text,
       cik text,
       investor_name text,
       filing_date text,
       period_end_date text,
       shares_held numeric,
       shares_change numeric,
       shares_change_pct numeric,
       market_value numeric,
       change_in_market_value numeric,
       change_in_market_value_pct numeric,
       weight_pct numeric,
       change_in_weight_pct numeric,
       ownership_pct numeric,
       change_in_ownership_pct numeric,
       is_new_position boolean,
       is_sold_out boolean,
       holding_period_quarters integer,
       first_added text,
       avg_price_paid numeric,
       raw_payload jsonb
     )
     ON CONFLICT (symbol, cik, period_end_date) DO UPDATE SET
       investor_name = EXCLUDED.investor_name,
       filing_date = EXCLUDED.filing_date,
       shares_held = EXCLUDED.shares_held,
       shares_change = EXCLUDED.shares_change,
       shares_change_pct = EXCLUDED.shares_change_pct,
       market_value = EXCLUDED.market_value,
       change_in_market_value = EXCLUDED.change_in_market_value,
       change_in_market_value_pct = EXCLUDED.change_in_market_value_pct,
       weight_pct = EXCLUDED.weight_pct,
       change_in_weight_pct = EXCLUDED.change_in_weight_pct,
       ownership_pct = EXCLUDED.ownership_pct,
       change_in_ownership_pct = EXCLUDED.change_in_ownership_pct,
       is_new_position = EXCLUDED.is_new_position,
       is_sold_out = EXCLUDED.is_sold_out,
       holding_period_quarters = EXCLUDED.holding_period_quarters,
       first_added = EXCLUDED.first_added,
       avg_price_paid = EXCLUDED.avg_price_paid,
       raw_payload = EXCLUDED.raw_payload,
       ingested_at = NOW()`,
    [JSON.stringify(dedupedRows)],
    {
      label: 'smart_money.institutional_13f.upsert',
      timeoutMs: 30000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return { upserted: dedupedRows.length, deduped: dedupedRows.length };
}

async function fetchQuarterRows(symbol, year, quarter, options = {}) {
  const limit = Math.max(1, Number(options.limit) || DEFAULT_LIMIT);
  const maxPages = Math.max(1, Number(options.maxPages) || MAX_PAGES);
  const normalizedRows = [];
  let pagesFetched = 0;
  let skipped = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fmpFetch(ENDPOINT, { symbol, year, quarter, page, limit });
    const rows = Array.isArray(payload) ? payload : [];
    if (rows.length === 0) break;
    pagesFetched += 1;

    rows.forEach((row) => {
      const normalized = normalizeInstitutionalHolding(row, symbol);
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
  const quarters = Array.isArray(options.quarters) && options.quarters.length ? options.quarters : resolveTargetQuarters(options.now || new Date());

  let fetched = 0;
  let skipped = 0;
  let apiErrors = 0;
  const allRows = [];

  for (let index = 0; index < symbols.length; index += MAX_SYMBOLS_PER_BATCH) {
    const batch = symbols.slice(index, index + MAX_SYMBOLS_PER_BATCH);
    for (const symbol of batch) {
      for (const target of quarters) {
        try {
          const result = await fetchQuarterRows(symbol, target.year, target.quarter, options);
          fetched += result.rows.length;
          skipped += result.skipped;
          allRows.push(...result.rows);
        } catch (error) {
          apiErrors += 1;
          logger.error('smart money institutional symbol fetch failed', {
            symbol,
            year: target.year,
            quarter: target.quarter,
            error: error.message,
          });
        }
      }
    }

    if (index + MAX_SYMBOLS_PER_BATCH < symbols.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  const persistence = await upsertInstitutionalHoldings(allRows, { dryRun });
  logger.info('smart money institutional 13f ingest complete', {
    dryRun,
    symbols: symbols.length,
    quarters,
    fetched,
    deduped: persistence.deduped,
    inserted: persistence.upserted,
    skipped,
    apiErrors,
  });

  return {
    jobName: 'fmp_institutional_13f_ingest',
    dryRun,
    symbols: symbols.length,
    quarters,
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
  MAX_PAGES,
  fetchQuarterRows,
  normalizeInstitutionalHolding,
  resolveTargetQuarters,
  runIngest,
  upsertInstitutionalHoldings,
};