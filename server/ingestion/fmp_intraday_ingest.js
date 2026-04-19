const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');
const { fmpFetch } = require('../services/fmpClient');
const { getMarketSession } = require('../utils/marketSession');
const { normalizeSymbol, mapFromProviderSymbol, mapToProviderSymbol } = require('../utils/symbolMap');

const MAX_SYMBOLS_PER_CYCLE = Math.max(10, Number(process.env.INTRADAY_MAX_SYMBOLS_PER_CYCLE) || 25);
const PINNED_INTRADAY_SYMBOLS = ['AAPL', 'SPY', 'QQQ', 'IWM', 'NVDA', 'MSFT'];
let ingestionCursor = 0;

function dbRead(sql, label) {
  return queryWithTimeout(sql, [], {
    timeoutMs: 30000,
    label,
    maxRetries: 0,
  });
}

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
        session text,
        open double precision,
        high double precision,
        low double precision,
        close double precision,
        volume bigint
      )
    ), inserted AS (
      INSERT INTO intraday_1m (symbol, timestamp, session, open, high, low, close, volume)
      SELECT symbol, timestamp, session, open, high, low, close, COALESCE(volume, 0)
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
  const activeSignals = await dbRead(`
    SELECT DISTINCT symbol
    FROM catalyst_signals
    WHERE created_at > NOW() - INTERVAL '2 hours'
  `, 'intraday_ingest.active_signals');

  const fallbackUniverse = await dbRead(`
    SELECT symbol
    FROM ticker_universe
    WHERE COALESCE(is_active, true) = true
      AND symbol IS NOT NULL
      AND symbol <> ''
    ORDER BY market_cap DESC NULLS LAST, symbol ASC
    LIMIT 1000
  `, 'intraday_ingest.fallback_universe');

  console.log('[INTRADAY] active signals:', activeSignals.rowCount);
  console.log('[INTRADAY] fallback symbols:', fallbackUniverse.rowCount);

  const symbols = [
    ...PINNED_INTRADAY_SYMBOLS,
    ...activeSignals.rows.map((r) => String(r.symbol || '').trim().toUpperCase()),
    ...fallbackUniverse.rows.map((r) => String(r.symbol || '').trim().toUpperCase()),
  ]
    .map((symbol) => mapFromProviderSymbol(normalizeSymbol(symbol)))
    .filter(Boolean);

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
  const canonicalSymbol = mapFromProviderSymbol(normalizeSymbol(symbol));
  const providerSymbol = mapToProviderSymbol(canonicalSymbol);

  try {
    console.log('[FMP REQUEST]', `/historical-chart/1min?symbol=${providerSymbol}`);
    console.log('[INTRADAY] writing bars for', canonicalSymbol);

    const data = await fmpFetch('/historical-chart/1min', { symbol: providerSymbol, extended: true });
    console.log('[FMP BARS]', canonicalSymbol, Array.isArray(data) ? data.length : 0);

    const normalized = normalizeIntraday(data, canonicalSymbol);
    const deduped = Array.from(
      new Map(normalized.map((row) => [`${row.symbol}|${row.timestamp}`, row])).values()
    );

    let inserted = 0;
    if (deduped.length > 0) {
      inserted = await insertIntradayRows(deduped);
    }

    const latestTimestamp = deduped[0]?.timestamp ?? null;
    console.log(`[INTRADAY] symbol=${canonicalSymbol} rows_fetched=${normalized.length} rows_inserted=${inserted} latest_timestamp=${latestTimestamp}`);

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
    logger.error('intraday symbol ingest failed', { symbol: canonicalSymbol, error: error.message });
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

function getProviderSession(timestamp) {
  const text = String(timestamp || '').trim();
  const match = text.match(/(?:T|\s)(\d{2}):(\d{2})/);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const totalMinutes = (hours * 60) + minutes;

    if (totalMinutes >= 4 * 60 && totalMinutes < (9 * 60) + 30) {
      return 'PREMARKET';
    }
    if (totalMinutes >= (9 * 60) + 30 && totalMinutes < 16 * 60) {
      return 'OPEN';
    }
    if (totalMinutes >= 16 * 60 && totalMinutes < 20 * 60) {
      return 'POSTMARKET';
    }
    return 'CLOSED';
  }

  return getMarketSession(new Date(timestamp));
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
      const volumeRaw = Number(row.volume);
      const volume = Number.isFinite(volumeRaw) ? Math.max(0, Math.trunc(volumeRaw)) : 0;
      const session = timestamp ? getProviderSession(timestamp) : 'CLOSED';
      return {
        symbol,
        timestamp,
        session,
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
  const session = getMarketSession();
  console.log('[INTRADAY WORKER] Starting run...', { session });
  if (session === 'CLOSED') {
    logger.info('intraday ingestion skipped while market is closed', {
      jobName: 'fmp_intraday_ingest',
      session,
    });
    return {
      jobName: 'fmp_intraday_ingest',
      table: 'intraday_1m',
      fetched: 0,
      deduped: 0,
      inserted: 0,
      failures: 0,
      durationMs: 0,
      skipped: true,
      reason: 'market_closed',
      session,
    };
  }

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

  for (let i = 0; i < ingestSymbols.length; i += 10) {
    const batch = ingestSymbols.slice(i, i + 10);

    for (const symbol of batch) {
      const result = await ingestSymbol(symbol);
      totals.fetched += Number(result.fetched) || 0;
      totals.deduped += Number(result.deduped) || 0;
      totals.inserted += Number(result.inserted) || 0;
      totals.failures += Number(result.failures) || 0;
    }

    if (i + 10 < ingestSymbols.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (totals.inserted === 0 && totals.fetched > 0) {
    console.error('[INTRADAY DEAD] No new data — all fetched rows already exist or were rejected');
  } else if (totals.fetched === 0) {
    console.error('[INTRADAY DEAD] No data returned from FMP for any symbol');
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
