const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

const DEFAULT_LIMIT = 5000;
const DEFAULT_BATCH_SIZE = 500;
const MAX_RUNTIME_MS = 5 * 60 * 1000;
const FLOAT_ENDPOINT = '/shares-float-all';

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

function toBigIntValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.trunc(numeric);
}

function toNumericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function normalizeFloatRecord(record, universeMap, nowIso = new Date().toISOString()) {
  const symbol = toUpperSymbol(record?.symbol);
  if (!symbol) {
    return { status: 'error', error: 'missing_symbol' };
  }

  const canonicalSymbol = universeMap.get(symbol);
  if (!canonicalSymbol) {
    return { status: 'skipped', symbol };
  }

  return {
    status: 'upsert',
    row: {
      symbol: canonicalSymbol,
      float_shares: toBigIntValue(record?.floatShares),
      free_float_pct: toNumericValue(record?.freeFloat),
      shares_outstanding: toBigIntValue(record?.outstandingShares),
      float_updated_at: nowIso,
    },
  };
}

async function loadUniverseSymbolMap() {
  const result = await queryWithTimeout(
    `SELECT symbol
     FROM ticker_universe
     WHERE COALESCE(is_active, true) = true
       AND symbol IS NOT NULL
       AND BTRIM(symbol) <> ''`,
    [],
    { timeoutMs: 15000, label: 'fmp_float_ingest.load_universe', maxRetries: 0 }
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

async function upsertFloatBatch(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  await queryWithTimeout(
    `INSERT INTO company_profiles (
       symbol,
       float_shares,
       free_float_pct,
       shares_outstanding,
       float_updated_at
     )
     SELECT
       payload.symbol,
       payload.float_shares::bigint,
       payload.free_float_pct::numeric,
       payload.shares_outstanding::bigint,
       payload.float_updated_at::timestamptz
     FROM json_to_recordset($1::json) AS payload(
       symbol text,
       float_shares text,
       free_float_pct text,
       shares_outstanding text,
       float_updated_at text
     )
     ON CONFLICT (symbol) DO UPDATE SET
       float_shares = EXCLUDED.float_shares,
       free_float_pct = EXCLUDED.free_float_pct,
       shares_outstanding = EXCLUDED.shares_outstanding,
       float_updated_at = EXCLUDED.float_updated_at`,
    [JSON.stringify(rows)],
    { timeoutMs: 30000, label: 'fmp_float_ingest.upsert_company_profiles', maxRetries: 0 }
  );

  return rows.length;
}

async function persistRows(rows, batchSize = DEFAULT_BATCH_SIZE) {
  let upserted = 0;
  let errored = 0;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    try {
      upserted += await upsertFloatBatch(batch);
    } catch (error) {
      logger.warn('float batch upsert failed, retrying row-by-row', {
        jobName: 'fmp_float_ingest',
        batchSize: batch.length,
        error: error.message,
      });

      for (const row of batch) {
        try {
          upserted += await upsertFloatBatch([row]);
        } catch (rowError) {
          errored += 1;
          logger.error('float upsert failed', {
            jobName: 'fmp_float_ingest',
            symbol: row?.symbol || null,
            error: rowError.message,
          });
        }
      }
    }
  }

  return { upserted, errored };
}

function assertRuntime(startedAt) {
  const runtimeMs = Date.now() - startedAt;
  if (runtimeMs > MAX_RUNTIME_MS) {
    const error = new Error(`Float ingestion exceeded runtime limit of ${MAX_RUNTIME_MS}ms`);
    error.code = 'FLOAT_INGEST_RUNTIME_LIMIT';
    throw error;
  }
}

/**
 * Float ingestion job.
 *
 * How to run:
 * - Small probe: `node -e "require('./server/node_modules/dotenv').config({path:'./server/.env'}); const { ingestFloat } = require('./server/ingestion/fmp_float_ingest'); ingestFloat({ limit: 100, maxPages: 1 }).then(console.log)"`
 * - Full run: `node -e "require('./server/node_modules/dotenv').config({path:'./server/.env'}); const { ingestFloat } = require('./server/ingestion/fmp_float_ingest'); ingestFloat().then(console.log)"`
 */
async function ingestFloat(options = {}) {
  const startedAt = Date.now();
  const limit = Math.max(1, Number(options.limit) || DEFAULT_LIMIT);
  const maxPages = Number.isFinite(Number(options.maxPages)) ? Number(options.maxPages) : Infinity;
  const batchSize = Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE);
  const startPage = Math.max(0, Number(options.startPage) || 0);
  const universeMap = options.universeMap instanceof Map ? options.universeMap : await loadUniverseSymbolMap();

  logger.info('ingestion start', {
    jobName: 'fmp_float_ingest',
    limit,
    startPage,
    maxPages: Number.isFinite(maxPages) ? maxPages : null,
    universeSize: universeMap.size,
  });

  let page = startPage;
  let pagesFetched = 0;
  let totalSeen = 0;
  let totalSkipped = 0;
  let totalErrored = 0;
  const rowsToUpsert = [];

  while (pagesFetched < maxPages) {
    assertRuntime(startedAt);

    const payload = await fmpFetch(FLOAT_ENDPOINT, { limit, page });
    const records = Array.isArray(payload) ? payload : [];
    if (records.length === 0) {
      break;
    }

    const nowIso = new Date().toISOString();

    for (const record of records) {
      assertRuntime(startedAt);
      totalSeen += 1;

      try {
        const normalized = normalizeFloatRecord(record, universeMap, nowIso);
        if (normalized.status === 'upsert') {
          rowsToUpsert.push(normalized.row);
        } else if (normalized.status === 'skipped') {
          totalSkipped += 1;
        } else {
          totalErrored += 1;
          logger.error('float record normalization failed', {
            jobName: 'fmp_float_ingest',
            symbol: safeRecordSymbol(record),
            error: normalized.error,
          });
        }
      } catch (error) {
        totalErrored += 1;
        logger.error('float record processing failed', {
          jobName: 'fmp_float_ingest',
          symbol: safeRecordSymbol(record),
          error: error.message,
        });
      }

      if (totalSeen % 1000 === 0) {
        logger.info('float ingestion progress', {
          jobName: 'fmp_float_ingest',
          totalSeen,
          queued: rowsToUpsert.length,
          skipped: totalSkipped,
          errored: totalErrored,
          page,
        });
      }
    }

    pagesFetched += 1;
    page += 1;
  }

  const persisted = await persistRows(rowsToUpsert, batchSize);
  totalErrored += persisted.errored;

  const durationMs = Date.now() - startedAt;
  const summary = {
    jobName: 'fmp_float_ingest',
    totalSeen,
    totalUpserted: persisted.upserted,
    totalSkipped,
    totalErrored,
    pagesFetched,
    durationMs,
  };

  logger.info('ingestion done', summary);
  return summary;
}

module.exports = {
  ingestFloat,
  normalizeFloatRecord,
  loadUniverseSymbolMap,
  upsertFloatBatch,
  persistRows,
};
