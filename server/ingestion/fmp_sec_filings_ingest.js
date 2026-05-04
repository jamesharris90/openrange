const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

const FILINGS_ENDPOINT = '/sec-filings-financials';
const DEFAULT_LIMIT = 1000;
const DEFAULT_BATCH_SIZE = 250;
const MAX_RANGE_DAYS = 90;
const MAX_PAGES = 100;

function toUpperSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function safeRecordSymbol(record) {
  try {
    return record?.symbol || null;
  } catch (_error) {
    return null;
  }
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value, label) {
  if (!value) {
    throw new Error(`${label} is required`);
  }

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return date;
}

function diffDaysInclusive(fromDate, toDate) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay) + 1;
}

function validateRequestWindow(fromDate, toDate) {
  const from = parseDateInput(fromDate, 'fromDate');
  const to = parseDateInput(toDate, 'toDate');

  if (from > to) {
    throw new Error('fromDate must be before or equal to toDate');
  }

  const rangeDays = diffDaysInclusive(from, to);
  if (rangeDays > MAX_RANGE_DAYS) {
    throw new Error(`Date range exceeds ${MAX_RANGE_DAYS} days: ${rangeDays}`);
  }

  return {
    fromDate: formatDate(from),
    toDate: formatDate(to),
    rangeDays,
  };
}

function splitDateRange(fromDate, toDate, maxDays = MAX_RANGE_DAYS) {
  const from = parseDateInput(fromDate, 'fromDate');
  const to = parseDateInput(toDate, 'toDate');

  if (from > to) {
    throw new Error('fromDate must be before or equal to toDate');
  }

  const windows = [];
  let cursor = new Date(from);

  while (cursor <= to) {
    const windowEnd = new Date(cursor);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + (maxDays - 1));
    if (windowEnd > to) {
      windowEnd.setTime(to.getTime());
    }

    windows.push({
      fromDate: formatDate(cursor),
      toDate: formatDate(windowEnd),
    });

    cursor = new Date(windowEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return windows;
}

function normalizeFormType(value) {
  return String(value || '').trim().toUpperCase();
}

function classifyFormType(formType) {
  const normalized = normalizeFormType(formType);
  if (normalized === '8-K') {
    return { catalyst_category: 'material_event', is_offering: false };
  }

  if (normalized === '10-K' || normalized === '10-Q') {
    return { catalyst_category: 'earnings', is_offering: false };
  }

  if (normalized === 'S-1' || normalized === 'S-1/A' || /^424B[1-5]$/i.test(normalized)) {
    return { catalyst_category: 'offering', is_offering: true };
  }

  if (['13D', '13G', '13D/A', '13G/A', 'FORM 4', '4'].includes(normalized)) {
    return { catalyst_category: 'ownership', is_offering: false };
  }

  if (normalized === 'DEF 14A') {
    return { catalyst_category: 'governance', is_offering: false };
  }

  return { catalyst_category: 'other', is_offering: false };
}

function toIsoTimestamp(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes('T')
    ? raw
    : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function loadUniverseSymbolMap() {
  const result = await queryWithTimeout(
    `SELECT symbol
     FROM ticker_universe
     WHERE COALESCE(is_active, true) = true
       AND symbol IS NOT NULL
       AND BTRIM(symbol) <> ''`,
    [],
    { timeoutMs: 15000, label: 'fmp_sec_filings_ingest.load_universe', maxRetries: 0 }
  );

  return new Map(
    (result.rows || [])
      .map((row) => {
        const symbol = toUpperSymbol(row?.symbol);
        return symbol ? [symbol, String(row.symbol).trim()] : null;
      })
      .filter(Boolean)
  );
}

function normalizeFilingRecord(record, universeMap) {
  const symbol = toUpperSymbol(record?.symbol);
  if (!symbol) {
    return { status: 'skipped', reason: 'missing_symbol' };
  }

  const canonicalSymbol = universeMap.get(symbol);
  if (!canonicalSymbol) {
    return { status: 'skipped', reason: 'symbol_not_tracked', symbol };
  }

  const formType = normalizeFormType(record?.formType);
  const filingDate = toIsoTimestamp(record?.filingDate);
  const acceptedDate = toIsoTimestamp(record?.acceptedDate);
  const cik = String(record?.cik || '').trim();

  if (!cik || !formType || !filingDate || !acceptedDate) {
    return { status: 'skipped', reason: 'missing_required_fields', symbol: canonicalSymbol };
  }

  const classification = classifyFormType(formType);

  return {
    status: 'upsert',
    row: {
      symbol: canonicalSymbol,
      cik,
      form_type: formType,
      filing_date: filingDate,
      accepted_date: acceptedDate,
      has_financials: Boolean(record?.hasFinancials),
      filing_link: record?.link ? String(record.link) : null,
      document_link: record?.finalLink ? String(record.finalLink) : null,
      catalyst_category: classification.catalyst_category,
      is_offering: classification.is_offering,
      raw: record,
    },
  };
}

async function upsertFilingsBatch(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const dedupedRows = Array.from(
    rows.reduce((accumulator, row) => {
      const key = `${row.symbol}::${row.form_type}::${row.accepted_date}`;
      accumulator.set(key, row);
      return accumulator;
    }, new Map()).values()
  );

  await queryWithTimeout(
    `INSERT INTO sec_filings (
       symbol,
       cik,
       form_type,
       filing_date,
       accepted_date,
       has_financials,
       filing_link,
       document_link,
       catalyst_category,
       is_offering,
       raw
     )
     SELECT
       payload.symbol,
       payload.cik,
       payload.form_type,
       payload.filing_date::timestamptz,
       payload.accepted_date::timestamptz,
       payload.has_financials::boolean,
       payload.filing_link,
       payload.document_link,
       payload.catalyst_category,
       payload.is_offering::boolean,
       payload.raw::jsonb
     FROM json_to_recordset($1::json) AS payload(
       symbol text,
       cik text,
       form_type text,
       filing_date text,
       accepted_date text,
       has_financials boolean,
       filing_link text,
       document_link text,
       catalyst_category text,
       is_offering boolean,
       raw jsonb
     )
     ON CONFLICT (symbol, form_type, accepted_date) DO UPDATE SET
       cik = EXCLUDED.cik,
       filing_date = EXCLUDED.filing_date,
       has_financials = EXCLUDED.has_financials,
       filing_link = EXCLUDED.filing_link,
       document_link = EXCLUDED.document_link,
       catalyst_category = EXCLUDED.catalyst_category,
       is_offering = EXCLUDED.is_offering,
       raw = EXCLUDED.raw`,
    [JSON.stringify(dedupedRows)],
    { timeoutMs: 30000, label: 'fmp_sec_filings_ingest.upsert_sec_filings', maxRetries: 0 }
  );

  return dedupedRows.length;
}

async function persistFilings(rows, batchSize = DEFAULT_BATCH_SIZE) {
  let upserted = 0;
  let errored = 0;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    try {
      upserted += await upsertFilingsBatch(batch);
    } catch (error) {
      logger.warn('sec filings batch upsert failed, retrying row-by-row', {
        jobName: 'fmp_sec_filings_ingest',
        batchSize: batch.length,
        error: error.message,
      });

      for (const row of batch) {
        try {
          upserted += await upsertFilingsBatch([row]);
        } catch (rowError) {
          errored += 1;
          logger.error('sec filing upsert failed', {
            jobName: 'fmp_sec_filings_ingest',
            symbol: row?.symbol || null,
            formType: row?.form_type || null,
            error: rowError.message,
          });
        }
      }
    }
  }

  return { upserted, errored };
}

function defaultDateWindow() {
  const today = new Date();
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 1);
  return {
    fromDate: formatDate(from),
    toDate: formatDate(to),
  };
}

async function ingestSingleWindow({ fromDate, toDate, limit, maxPages, universeMap }) {
  const validated = validateRequestWindow(fromDate, toDate);
  let page = 0;
  let totalSeen = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;
  let totalErrored = 0;

  while (page < Math.min(MAX_PAGES, maxPages)) {
    const payload = await fmpFetch(FILINGS_ENDPOINT, {
      from: validated.fromDate,
      to: validated.toDate,
      page,
      limit,
    });

    const records = Array.isArray(payload) ? payload : [];
    if (records.length === 0) {
      break;
    }

    const pageRows = [];

    for (const record of records) {
      totalSeen += 1;
      try {
        const normalized = normalizeFilingRecord(record, universeMap);
        if (normalized.status === 'upsert') {
          pageRows.push(normalized.row);
        } else {
          totalSkipped += 1;
        }
      } catch (error) {
        totalErrored += 1;
        logger.error('sec filing processing failed', {
          jobName: 'fmp_sec_filings_ingest',
          symbol: safeRecordSymbol(record),
          error: error.message,
        });
      }
    }

    if (pageRows.length > 0) {
      const persisted = await persistFilings(pageRows);
      totalUpserted += persisted.upserted;
      totalErrored += persisted.errored;
    }

    page += 1;
  }

  return {
    totalSeen,
    totalUpserted,
    totalSkipped,
    totalErrored,
    pagesFetched: page,
    windowsProcessed: 1,
  };
}

async function ingestFilings(options = {}) {
  const startedAt = Date.now();
  const defaults = defaultDateWindow();
  const fromDate = options.fromDate || defaults.fromDate;
  const toDate = options.toDate || defaults.toDate;
  const limit = Math.max(1, Number(options.limit) || DEFAULT_LIMIT);
  const maxPages = Math.max(1, Math.min(MAX_PAGES, Number(options.maxPages) || MAX_PAGES));
  const universeMap = options.universeMap instanceof Map ? options.universeMap : await loadUniverseSymbolMap();
  const windows = splitDateRange(fromDate, toDate, MAX_RANGE_DAYS);

  logger.info('ingestion start', {
    jobName: 'fmp_sec_filings_ingest',
    fromDate,
    toDate,
    limit,
    maxPages,
    windows: windows.length,
    universeSize: universeMap.size,
  });

  const totals = {
    jobName: 'fmp_sec_filings_ingest',
    fromDate,
    toDate,
    totalSeen: 0,
    totalUpserted: 0,
    totalSkipped: 0,
    totalErrored: 0,
    pagesFetched: 0,
    windowsProcessed: 0,
    durationMs: 0,
  };

  for (const window of windows) {
    const result = await ingestSingleWindow({
      fromDate: window.fromDate,
      toDate: window.toDate,
      limit,
      maxPages,
      universeMap,
    });

    totals.totalSeen += result.totalSeen;
    totals.totalUpserted += result.totalUpserted;
    totals.totalSkipped += result.totalSkipped;
    totals.totalErrored += result.totalErrored;
    totals.pagesFetched += result.pagesFetched;
    totals.windowsProcessed += 1;
  }

  totals.durationMs = Date.now() - startedAt;
  logger.info('ingestion done', totals);
  return totals;
}

module.exports = {
  ingestFilings,
  classifyFormType,
  validateRequestWindow,
  splitDateRange,
  normalizeFilingRecord,
};
