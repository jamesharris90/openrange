const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { queryWithTimeout, getPoolStats } = require('../db/pg');
const { symbolsFromEnv } = require('./_helpers');
const { fmpFetch } = require('../services/fmpClient');
const { supabaseAdmin } = require('../services/supabaseClient');
const { batchInsert } = require('../utils/batchInsert');
const logger = require('../utils/logger');
const { normalizeSymbol, mapToProviderSymbol } = require('../utils/symbolMap');
const {
  ensureCoverageStatusTable,
  upsertCoverageStatuses,
  getCoverageStatusCounts,
} = require('../services/dataCoverageStatusService');

const DEFAULT_PRICE_LOOKBACK_DAYS = Math.max(1, Number(process.env.DAILY_PRICE_LOOKBACK_DAYS) || 7);
const DEFAULT_FULL_HISTORY_START = String(process.env.DAILY_PRICE_FULL_HISTORY_FROM || '2021-01-01');
const PRICE_INGEST_CONCURRENCY = Math.max(1, Number(process.env.DAILY_PRICE_INGEST_CONCURRENCY) || 2);
const TARGET_TABLES = ['daily_ohlc', 'daily_ohlcv'];
const INGEST_DELAY_MS = Math.max(0, Number(process.env.DAILY_PRICE_INGEST_DELAY_MS) || 50);
const INGEST_COMPLETION_MIN_RATIO = Math.min(1, Math.max(0.1, Number(process.env.DAILY_PRICE_COMPLETION_MIN_RATIO) || 0.9));

let hasLoggedRawDailySample = false;
const loggedInsertDates = new Set();

async function readDailyFreshness() {
  const result = await queryWithTimeout(
    `SELECT MAX(date) AS latest_date FROM daily_ohlcv`,
    [],
    { timeoutMs: 5000, label: 'fmp_prices_ingest.latest_daily', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return result.rows?.[0]?.latest_date ? new Date(result.rows[0].latest_date) : null;
}

async function loadUniverseSymbols() {
  const sql = `SELECT symbol
     FROM ticker_universe
     WHERE is_active = true
       AND symbol IS NOT NULL
       AND symbol <> ''
     ORDER BY market_cap DESC NULLS LAST, symbol ASC`;
  const result = await queryWithTimeout(
    sql,
    [],
    { timeoutMs: 10000, label: 'fmp_prices_ingest.load_universe_symbols', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const symbols = (result.rows || [])
    .map((row) => String(row.symbol || '').trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length > 0) {
    return symbols;
  }

  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('ticker_universe')
      .select('symbol')
      .eq('is_active', true)
      .not('symbol', 'is', null)
      .order('market_cap', { ascending: false, nullsFirst: false })
      .order('symbol', { ascending: true });

    if (!error) {
      const supabaseSymbols = (data || [])
        .map((row) => String(row.symbol || '').trim().toUpperCase())
        .filter(Boolean);
      if (supabaseSymbols.length > 0) {
        return supabaseSymbols;
      }
    }
  }

  return symbolsFromEnv();
}

async function loadIncrementalStartDate() {
  const result = await queryWithTimeout(
    `SELECT GREATEST(
        COALESCE((SELECT MAX(date) FROM daily_ohlc), DATE '1900-01-01'),
        COALESCE((SELECT MAX(date) FROM daily_ohlcv), DATE '1900-01-01')
      ) AS latest_date`,
    [],
    { timeoutMs: 5000, label: 'fmp_prices_ingest.load_latest_date', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const latestDate = result.rows?.[0]?.latest_date ? new Date(result.rows[0].latest_date) : null;
  if (latestDate && Number.isFinite(latestDate.getTime())) {
    latestDate.setUTCDate(latestDate.getUTCDate() - DEFAULT_PRICE_LOOKBACK_DAYS);
    return latestDate.toISOString().slice(0, 10);
  }

  const fallbackDate = new Date();
  fallbackDate.setUTCDate(fallbackDate.getUTCDate() - Math.max(DEFAULT_PRICE_LOOKBACK_DAYS, 30));
  return fallbackDate.toISOString().slice(0, 10);
}

async function loadFullHistoryStartDate() {
  const result = await queryWithTimeout(
    `SELECT LEAST(
        COALESCE((SELECT MIN(date) FROM daily_ohlc), DATE '9999-12-31'),
        COALESCE((SELECT MIN(date) FROM daily_ohlcv), DATE '9999-12-31')
      ) AS earliest_date`,
    [],
    { timeoutMs: 5000, label: 'fmp_prices_ingest.load_earliest_date', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const earliestDate = result.rows?.[0]?.earliest_date ? new Date(result.rows[0].earliest_date) : null;
  if (earliestDate && Number.isFinite(earliestDate.getTime())) {
    return earliestDate.toISOString().slice(0, 10);
  }

  return DEFAULT_FULL_HISTORY_START;
}

async function verifyLatestDailyCompletion(expectedUniverseSize) {
  const result = await queryWithTimeout(
    `WITH latest_daily AS (
       SELECT MAX(date) AS latest_date
       FROM daily_ohlc
     )
     SELECT
       latest_daily.latest_date,
       COUNT(*)::int AS row_count,
       COUNT(DISTINCT daily_ohlc.symbol)::int AS symbol_count
     FROM latest_daily
     LEFT JOIN daily_ohlc ON daily_ohlc.date = latest_daily.latest_date
     GROUP BY latest_daily.latest_date`,
    [],
    {
      timeoutMs: 10000,
      label: 'fmp_prices_ingest.verify_latest_completion',
      maxRetries: 0,
    }
  ).catch(() => ({ rows: [] }));

  const latestDate = result.rows?.[0]?.latest_date || null;
  const rowCount = Number(result.rows?.[0]?.row_count || 0);
  const symbolCount = Number(result.rows?.[0]?.symbol_count || 0);
  const minimumExpected = Math.max(1, Math.floor(Number(expectedUniverseSize || 0) * INGEST_COMPLETION_MIN_RATIO));
  const complete = symbolCount >= minimumExpected;

  if (!complete) {
    console.error('[INGESTION INCOMPLETE]', {
      latest_date: latestDate,
      symbol_count: symbolCount,
      row_count: rowCount,
      expected_universe: expectedUniverseSize,
      minimum_expected: minimumExpected,
    });
  }

  return {
    latest_date: latestDate,
    row_count: rowCount,
    symbol_count: symbolCount,
    expected_universe: Number(expectedUniverseSize || 0),
    minimum_expected: minimumExpected,
    complete,
  };
}

async function loadStaleDailyTargets() {
  const result = await queryWithTimeout(
    `WITH latest_quote AS (
       SELECT symbol,
              CASE EXTRACT(ISODOW FROM timezone('America/New_York', MAX(updated_at)))
                WHEN 6 THEN (timezone('America/New_York', MAX(updated_at))::date - 1)
                WHEN 7 THEN (timezone('America/New_York', MAX(updated_at))::date - 2)
                ELSE timezone('America/New_York', MAX(updated_at))::date
              END AS quote_date
       FROM market_quotes
       GROUP BY symbol
     ), latest_candle AS (
       SELECT symbol, MAX(date) AS candle_date
       FROM daily_ohlc
       GROUP BY symbol
     )
     SELECT lq.symbol,
            lq.quote_date::text AS quote_date,
            lc.candle_date::text AS candle_date,
            (lq.quote_date - lc.candle_date) AS gap_days
     FROM latest_quote lq
     JOIN latest_candle lc USING (symbol)
     WHERE lq.quote_date > lc.candle_date
     ORDER BY gap_days DESC, lq.symbol ASC`,
    [],
    {
      timeoutMs: 20000,
      label: 'fmp_prices_ingest.load_stale_daily_targets',
      maxRetries: 0,
      poolType: 'read',
    }
  ).catch(() => ({ rows: [] }));

  return (result.rows || []).map((row) => ({
    symbol: String(row.symbol || '').trim().toUpperCase(),
    quote_date: String(row.quote_date || '').slice(0, 10),
    candle_date: String(row.candle_date || '').slice(0, 10),
    gap_days: Number(row.gap_days || 0),
  })).filter((row) => row.symbol && row.quote_date);
}

async function buildQuoteFallbackRows(targets = []) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return [];
  }

  const result = await queryWithTimeout(
    `WITH target_dates AS (
       SELECT *
       FROM json_to_recordset($1::json) AS x(
         symbol text,
         quote_date date
       )
     )
     SELECT q.symbol,
            t.quote_date::text AS date,
            q.price::numeric AS open,
            q.price::numeric AS high,
            q.price::numeric AS low,
            q.price::numeric AS close,
            COALESCE(q.volume, 0)::bigint AS volume
     FROM market_quotes q
     JOIN target_dates t
       ON t.symbol = q.symbol
     WHERE q.price IS NOT NULL
       AND q.price > 0`,
    [JSON.stringify(targets)],
    {
      timeoutMs: 30000,
      label: 'fmp_prices_ingest.build_quote_fallbacks',
      maxRetries: 0,
      poolType: 'read',
    }
  ).catch(() => ({ rows: [] }));

  return (result.rows || []).map((row) => ({
    symbol: String(row.symbol || '').trim().toUpperCase(),
    date: String(row.date || '').slice(0, 10),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Math.max(0, Math.trunc(Number(row.volume) || 0)),
  })).filter((row) => row.symbol && row.date && [row.open, row.high, row.low, row.close].every(Number.isFinite));
}

async function buildIntradayRepairRows(targets = []) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return [];
  }

  const result = await queryWithTimeout(
    `WITH target_dates AS (
       SELECT *
       FROM json_to_recordset($1::json) AS x(
         symbol text,
         quote_date date
       )
     ), aggregated AS (
       SELECT i.symbol,
              DATE(i.timestamp)::text AS date,
              (ARRAY_AGG(i.open ORDER BY i.timestamp ASC))[1]::numeric AS open,
              MAX(i.high)::numeric AS high,
              MIN(i.low)::numeric AS low,
              (ARRAY_AGG(i.close ORDER BY i.timestamp DESC))[1]::numeric AS close,
              SUM(COALESCE(i.volume, 0))::bigint AS volume,
              COUNT(*)::int AS bar_count
       FROM intraday_1m i
       JOIN target_dates t
         ON t.symbol = i.symbol
        AND DATE(i.timestamp) = t.quote_date
       WHERE COALESCE(NULLIF(UPPER(i.session), ''), 'OPEN') IN ('OPEN', 'REGULAR')
       GROUP BY i.symbol, DATE(i.timestamp)
     )
     SELECT symbol, date, open, high, low, close, volume, bar_count
     FROM aggregated
     WHERE bar_count > 0`,
    [JSON.stringify(targets)],
    {
      timeoutMs: 30000,
      label: 'fmp_prices_ingest.build_intraday_repairs',
      maxRetries: 0,
      poolType: 'read',
    }
  ).catch(() => ({ rows: [] }));

  return (result.rows || []).map((row) => ({
    symbol: String(row.symbol || '').trim().toUpperCase(),
    date: String(row.date || '').slice(0, 10),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Math.max(0, Math.trunc(Number(row.volume) || 0)),
  })).filter((row) => row.symbol && row.date && [row.open, row.high, row.low, row.close].every(Number.isFinite));
}

async function repairStaleDailyRows() {
  const staleTargetsBefore = await loadStaleDailyTargets();
  if (staleTargetsBefore.length === 0) {
    return {
      staleBefore: 0,
      repairedRows: 0,
      repairedByTable: {},
      staleAfter: 0,
      unresolved: [],
    };
  }

  const repairedRows = await buildIntradayRepairRows(staleTargetsBefore);
  const repairedByTable = {};
  let quoteFallbackRows = [];

  if (repairedRows.length > 0) {
    for (const table of TARGET_TABLES) {
      const result = await batchInsert({
        supabase: supabaseAdmin,
        table,
        rows: repairedRows,
        conflictTarget: 'symbol,date',
        batchSize: 500,
      });
      repairedByTable[table] = result.inserted;
    }
  }

  let staleTargetsAfter = await loadStaleDailyTargets();
  if (staleTargetsAfter.length > 0) {
    quoteFallbackRows = buildDedupedQuoteFallbackRows(await buildQuoteFallbackRows(staleTargetsAfter), repairedRows);
    if (quoteFallbackRows.length > 0) {
      for (const table of TARGET_TABLES) {
        const result = await batchInsert({
          supabase: supabaseAdmin,
          table,
          rows: quoteFallbackRows,
          conflictTarget: 'symbol,date',
          batchSize: 500,
        });
        repairedByTable[table] = (repairedByTable[table] || 0) + result.inserted;
      }
    }
    staleTargetsAfter = await loadStaleDailyTargets();
  }

  return {
    staleBefore: staleTargetsBefore.length,
    repairedRows: repairedRows.length,
    quoteFallbackRows: quoteFallbackRows.length,
    repairedByTable,
    staleAfter: staleTargetsAfter.length,
    unresolved: staleTargetsAfter.slice(0, 25),
  };
}

function buildDedupedQuoteFallbackRows(rows, existingRows = []) {
  const existingKeys = new Set((existingRows || []).map((row) => `${row.symbol}::${row.date}`));
  return (rows || []).filter((row) => !existingKeys.has(`${row.symbol}::${row.date}`));
}

function normalizeDailyRows(payload, symbol, fromDate) {
  const rawRows = Array.isArray(payload) ? payload : [];
  if (rawRows.length > 0 && !hasLoggedRawDailySample) {
    console.log('[FMP DAILY RAW]', JSON.stringify(rawRows.slice(0, 3)));
    hasLoggedRawDailySample = true;
  }

  return rawRows
    .map((row) => {
      const rawDate = String(row.date || '').trim();
      const date = rawDate ? new Date(rawDate).toISOString().split('T')[0] : '';
      const open = Number(row.open);
      const high = Number(row.high);
      const low = Number(row.low);
      const close = Number(row.close);
      const volume = Math.max(0, Math.trunc(Number(row.volume) || 0));

      if (!date || (fromDate && date < fromDate)) {
        return null;
      }

      if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
        return null;
      }

      if (!loggedInsertDates.has(date)) {
        console.log('[INSERT DATE]', date);
        loggedInsertDates.add(date);
      }

      return {
        symbol,
        date,
        open,
        high,
        low,
        close,
        volume,
      };
    })
    .filter(Boolean);
}

function normalizePricesFromFourHour(payload, symbol, fromDate) {
  const rawRows = Array.isArray(payload) ? payload : [];
  const byDate = new Map();

  for (const row of rawRows) {
    const timestamp = String(row.date || row.datetime || '').trim();
    const date = timestamp.slice(0, 10);
    if (!date || (fromDate && date < fromDate)) {
      continue;
    }

    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = Math.max(0, Math.trunc(Number(row.volume) || 0));

    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      continue;
    }

    const existing = byDate.get(date);
    if (!existing) {
      byDate.set(date, {
        symbol,
        date,
        open,
        high,
        low,
        close,
        volume,
        firstTimestamp: timestamp,
        lastTimestamp: timestamp,
      });
      continue;
    }

    if (timestamp < existing.firstTimestamp) {
      existing.firstTimestamp = timestamp;
      existing.open = open;
    }

    if (timestamp >= existing.lastTimestamp) {
      existing.lastTimestamp = timestamp;
      existing.close = close;
    }

    existing.high = Math.max(existing.high, high);
    existing.low = Math.min(existing.low, low);
    existing.volume += volume;
  }

  return Array.from(byDate.values()).map(({ firstTimestamp, lastTimestamp, ...row }) => row);
}

function shiftIsoDate(value, days) {
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

async function fetchPriceRows(symbol, fromDate) {
  const providerSymbol = mapToProviderSymbol(normalizeSymbol(symbol));
  const toDate = new Date().toISOString().slice(0, 10);
  const endpoints = [
    {
      endpoint: `/historical-price-eod/full?symbol=${encodeURIComponent(providerSymbol)}&from=${fromDate}&to=${toDate}`,
      normalize: normalizeDailyRows,
    },
    {
      endpoint: `/historical-price-eod/light?symbol=${encodeURIComponent(providerSymbol)}&from=${fromDate}&to=${toDate}`,
      normalize: normalizeDailyRows,
    },
    {
      endpoint: `/historical-chart/4hour?symbol=${encodeURIComponent(providerSymbol)}&from=${fromDate}`,
      normalize: normalizePricesFromFourHour,
    },
  ];

  let lastError = null;
  for (const { endpoint, normalize } of endpoints) {
    try {
      const payload = await fmpFetch(endpoint);
      const rows = normalize(payload, symbol, fromDate);
      if (rows.length > 0) {
        return { rows, sourceEndpoint: endpoint };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return { rows: [], sourceEndpoint: null };
}

function dedupeRows(rows) {
  return Array.from(
    new Map(rows.map((row) => [`${row.symbol}::${row.date}`, row])).values()
  );
}

async function runWithConcurrency(items, worker, concurrency = PRICE_INGEST_CONCURRENCY) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      output[index] = await worker(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return output;
}

async function runPricesIngestion(symbols, options = {}) {
  console.log('[DAILY WORKER START]');
  let processed = 0;
  let failed = 0;
  let totalSymbols = Array.isArray(symbols) ? symbols.length : 0;
  const insertFailureSymbols = new Set();
  try {
    const latestDaily = await readDailyFreshness();
    if (latestDaily && (Date.now() - latestDaily.getTime()) > (24 * 60 * 60 * 1000)) {
      console.error('[CRITICAL] DAILY OHLCV STALE');
    }

    const targetSymbols = Array.isArray(symbols) && symbols.length > 0
      ? symbols
      : await loadUniverseSymbols();
    totalSymbols = targetSymbols.length;
    console.log('[SYMBOL COUNT]', targetSymbols.length);
    console.log('[UNIVERSE SIZE]', targetSymbols.length);
    console.log('[DB POOL STATS]', getPoolStats());
    const fullHistory = Boolean(options.fullHistory);
    const fromDate = options.fromDate || (fullHistory
      ? await loadFullHistoryStartDate()
      : await loadIncrementalStartDate());
    const startedAt = Date.now();
    const staleTargets = await loadStaleDailyTargets();
    const staleFromDateBySymbol = new Map(
      staleTargets
        .filter((target) => target.symbol && target.candle_date)
        .map((target) => [target.symbol, shiftIsoDate(target.candle_date, -1) || target.candle_date])
    );

    logger.info('ingestion start', {
      jobName: 'fmp_prices_ingest',
      tables: TARGET_TABLES,
      symbols: targetSymbols.length,
      fromDate,
      staleSymbols: staleTargets.length,
      fullHistory,
    });

    const results = await runWithConcurrency(targetSymbols, async (symbol) => {
      const canonicalSymbol = normalizeSymbol(symbol);
      try {
        if (INGEST_DELAY_MS > 0) {
          await new Promise((resolve) => setTimeout(resolve, INGEST_DELAY_MS));
        }
        const effectiveFromDate = options.symbolFromDateMap?.[canonicalSymbol]
          || staleFromDateBySymbol.get(canonicalSymbol)
          || fromDate;
        const { rows, sourceEndpoint } = await fetchPriceRows(canonicalSymbol, effectiveFromDate);
        return { symbol: canonicalSymbol, rows, sourceEndpoint, error: null };
      } catch (error) {
        failed += 1;
        console.error('[SYMBOL FAILED]', canonicalSymbol, error.message);
        logger.error('ingestion symbol failed', {
          jobName: 'fmp_prices_ingest',
          symbol: canonicalSymbol,
          error: error.message,
        });
        return { symbol: canonicalSymbol, rows: [], sourceEndpoint: null, error: error.message };
      } finally {
        processed += 1;
        if (processed % 100 === 0 || processed === totalSymbols) {
          console.log(`[PROGRESS] ${processed}/${totalSymbols}`);
        }
      }
    });

    const allRows = [];
    const failures = [];
    const noDataSymbols = [];
    const endpointUsage = {};
    const hasDataSymbols = new Set();

    for (const result of results) {
      if (result.error) {
        failures.push({ symbol: result.symbol, error: result.error });
        continue;
      }

      if (!Array.isArray(result.rows) || result.rows.length === 0) {
        noDataSymbols.push(result.symbol);
        continue;
      }

      hasDataSymbols.add(result.symbol);
      endpointUsage[result.sourceEndpoint] = (endpointUsage[result.sourceEndpoint] || 0) + 1;
      allRows.push(...result.rows);
    }

    const deduped = dedupeRows(allRows);
    console.log('[DAILY WORKER ROWS]', deduped.length);
    const insertedByTable = {};

    await ensureCoverageStatusTable();

    if (deduped.length > 0) {
      try {
        for (const table of TARGET_TABLES) {
          const result = await batchInsert({
            supabase: supabaseAdmin,
            table,
            rows: deduped,
            conflictTarget: 'symbol,date',
            batchSize: 500,
          });
          insertedByTable[table] = result.inserted;
        }
      } catch (error) {
        for (const symbol of hasDataSymbols) {
          insertFailureSymbols.add(symbol);
        }
        await upsertCoverageStatuses(Array.from(hasDataSymbols).map((symbol) => ({
          symbol,
          status: 'MISSING',
        })));
        throw error;
      }
    }

    await upsertCoverageStatuses([
      ...Array.from(hasDataSymbols).map((symbol) => ({ symbol, status: 'HAS_DATA' })),
      ...noDataSymbols.map((symbol) => ({ symbol, status: 'UNSUPPORTED' })),
      ...Array.from(insertFailureSymbols).map((symbol) => ({ symbol, status: 'MISSING' })),
    ]);

    const coverageCounts = await getCoverageStatusCounts();
    console.log('[COVERAGE]', {
      total: totalSymbols,
      hasData: coverageCounts.HAS_DATA,
      missing: coverageCounts.MISSING,
      unsupported: coverageCounts.UNSUPPORTED,
    });

    const staleRepair = await repairStaleDailyRows();
    if (staleRepair.staleBefore > 0) {
      console.log('[DAILY STALE REPAIR]', staleRepair);
    }

    const completionCheck = await verifyLatestDailyCompletion(totalSymbols);
    const durationMs = Date.now() - startedAt;
    logger.info('ingestion done', {
      jobName: 'fmp_prices_ingest',
      tables: TARGET_TABLES,
      fetched: allRows.length,
      deduped: deduped.length,
      insertedByTable,
      failures: failures.length,
      noDataSymbols: noDataSymbols.length,
      endpointUsage,
      staleRepair,
      completionCheck,
      durationMs,
    });

    return {
      jobName: 'fmp_prices_ingest',
      tables: TARGET_TABLES,
      fetched: allRows.length,
      deduped: deduped.length,
      inserted: insertedByTable.daily_ohlcv || 0,
      insertedByTable,
      failures,
      noDataSymbols,
      endpointUsage,
      staleRepair,
      completionCheck,
      fromDate,
      durationMs,
    };
  } catch (error) {
    console.error('[WORKER CRASH]', error);
    console.error('[DAILY WORKER ERROR]', error.message);
    throw error;
  } finally {
    console.log('[FAILURES]', failed);
    console.log('[WORKER COMPLETE]', {
      processed,
      total: totalSymbols,
    });
    console.log('[DAILY WORKER COMPLETE]');
  }
}

module.exports = {
  runPricesIngestion,
  fetchPriceRows,
  loadUniverseSymbols,
};

if (require.main === module) {
  runPricesIngestion()
    .then((result) => {
      console.log('[DAILY WORKER RESULT]', JSON.stringify(result));
      process.exit(0);
    })
    .catch((error) => {
      console.error('[DAILY WORKER FATAL]', error.message);
      process.exit(1);
    });
}
