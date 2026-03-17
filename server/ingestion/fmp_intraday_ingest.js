const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

const MAX_SYMBOLS_PER_CYCLE = 100;
let ingestionCursor = 0;

const db = {
  query: async (sql) =>
    queryWithTimeout(sql, [], {
      timeoutMs: 10000,
      label: 'intraday_ingest.load_symbols',
      maxRetries: 0,
      poolType: 'read',
    }),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insertIntradayRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const sql = `
    WITH payload AS (
      SELECT *
      FROM json_to_recordset($1::json) AS x(
        symbol text,
        timestamp timestamptz,
        open double precision,
        high double precision,
        low double precision,
        close double precision,
        volume bigint
      )
    ), inserted AS (
      INSERT INTO intraday_1m (symbol, timestamp, open, high, low, close, volume)
      SELECT symbol, timestamp, open, high, low, close, COALESCE(volume, 0)
      FROM payload
      ON CONFLICT (symbol, timestamp) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*)::int AS inserted FROM inserted
  `;

  const { rows: resultRows } = await queryWithTimeout(sql, [JSON.stringify(rows)], {
    timeoutMs: 15000,
    label: 'intraday_ingest.insert_rows',
    maxRetries: 0,
  });

  return Number(resultRows?.[0]?.inserted || 0);
}

async function loadPrioritySymbols() {
  const activeSignals = await db.query(`
    SELECT DISTINCT symbol
    FROM catalyst_signals
    WHERE created_at > NOW() - INTERVAL '2 hours'
  `);

  const recentSymbols = await db.query(`
    SELECT DISTINCT symbol
    FROM intraday_1m
    WHERE timestamp > NOW() - INTERVAL '30 minutes'
  `);

  const fallbackUniverse = await db.query(`
    SELECT symbol
    FROM ticker_universe
    LIMIT 500
  `);

  console.log('[INTRADAY] active signals:', activeSignals.rowCount);
  console.log('[INTRADAY] recent symbols:', recentSymbols.rowCount);
  console.log('[INTRADAY] fallback symbols:', fallbackUniverse.rowCount);

  const symbols = [
    ...activeSignals.rows.map((r) => String(r.symbol || '').trim().toUpperCase()),
    ...recentSymbols.rows.map((r) => String(r.symbol || '').trim().toUpperCase()),
    ...fallbackUniverse.rows.map((r) => String(r.symbol || '').trim().toUpperCase()),
  ].filter(Boolean);

  const seen = new Set();

  const orderedSymbols = symbols.filter((symbol) => {
    if (seen.has(symbol)) return false;
    seen.add(symbol);
    return true;
  });

  if (orderedSymbols.length > 10000) {
    console.warn('[INTRADAY] universe extremely large');
  }

  const start = ingestionCursor;
  const end = start + MAX_SYMBOLS_PER_CYCLE;

  const ingestSymbols = orderedSymbols.slice(start, end);

  ingestionCursor = end;
  if (ingestionCursor >= orderedSymbols.length) {
    ingestionCursor = 0;
  }

  console.log('[INTRADAY CURSOR]', start, '->', end);
  console.log('[INTRADAY] cycle symbols:', ingestSymbols.length);
  console.log('[INTRADAY] ingesting:', ingestSymbols.length);
  console.log('[INTRADAY] first 10 symbols:', ingestSymbols.slice(0, 10));

  return ingestSymbols;
}

async function ingestSymbol(symbol) {
  const startedAt = Date.now();

  try {
    if (!process.env.FMP_API_KEY) {
      throw new Error('FMP_API_KEY is not configured');
    }

    const url = `https://financialmodelingprep.com/api/v3/historical-chart/1min/${symbol}?apikey=${process.env.FMP_API_KEY}`;

    console.log('[FMP REQUEST]', url);
    console.log('[INTRADAY] writing bars for', symbol);

    const response = await fetch(url);

    console.log('[FMP STATUS]', symbol, response.status);

    if (!response.ok) {
      throw new Error(`FMP ${url} failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log('[FMP BARS]', symbol, Array.isArray(data) ? data.length : 0);

    const normalized = normalizeIntraday(data, symbol);
    const deduped = Array.from(
      new Map(normalized.map((row) => [`${row.symbol}|${row.timestamp}`, row])).values()
    );

    let inserted = 0;
    if (deduped.length > 0) {
      inserted = await insertIntradayRows(deduped);
    }

    console.log('[INGESTION] Inserted intraday bars:', inserted);

    return {
      jobName: 'fmp_intraday_ingest',
      table: 'intraday_1m',
      fetched: normalized.length,
      deduped: deduped.length,
      inserted,
      failures: 0,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    logger.error('intraday symbol ingest failed', { symbol, error: error.message });
    return {
      jobName: 'fmp_intraday_ingest',
      table: 'intraday_1m',
      fetched: 0,
      deduped: 0,
      inserted: 0,
      failures: 1,
      durationMs: Date.now() - startedAt,
    };
  }
}

function normalizeIntraday(payload, symbol) {
  const data = Array.isArray(payload) ? payload : [];

  return data
    .map((row) => {
      const timestamp = row.date || row.datetime || row.timestamp;
      const close = Number(row.close ?? row.price);
      const open = Number(row.open ?? close);
      const high = Number(row.high ?? close);
      const low = Number(row.low ?? close);
      const volume = Number(row.volume) || 0;
      return {
        symbol,
        timestamp,
        open,
        high,
        low,
        close,
        volume,
      };
    })
    .filter((row) => row.timestamp && Number.isFinite(row.close));
}

async function runIntradayIngestion() {
  const ingestSymbols = await loadPrioritySymbols();
  if (!Array.isArray(ingestSymbols) || ingestSymbols.length === 0) {
    logger.warn('intraday ingestion skipped: no symbols selected');
    return {
      jobName: 'fmp_intraday_ingest',
      table: 'intraday_1m',
      fetched: 0,
      deduped: 0,
      inserted: 0,
      failures: 0,
      durationMs: 0,
      skipped: true,
      reason: 'no_symbols_selected',
    };
  }

  const startedAt = Date.now();
  const totals = {
    fetched: 0,
    deduped: 0,
    inserted: 0,
    failures: 0,
  };

  for (const symbol of ingestSymbols) {
    const result = await ingestSymbol(symbol);
    totals.fetched += Number(result.fetched) || 0;
    totals.deduped += Number(result.deduped) || 0;
    totals.inserted += Number(result.inserted) || 0;
    totals.failures += Number(result.failures) || 0;

    await sleep(50);
  }

  return {
    jobName: 'fmp_intraday_ingest',
    table: 'intraday_1m',
    fetched: totals.fetched,
    deduped: totals.deduped,
    inserted: totals.inserted,
    failures: totals.failures,
    durationMs: Date.now() - startedAt,
  };
}

module.exports = {
  runIntradayIngestion,
};
