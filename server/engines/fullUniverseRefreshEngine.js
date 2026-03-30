const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { queryWithTimeout } = require('../db/pg');
const { fmpFetch } = require('../services/fmpClient');

const BATCH_SIZE = Math.max(50, Math.min(Number(process.env.FULL_UNIVERSE_BATCH_SIZE || 80), 100));
const RETRY_DELAY_MS = 1200;
const COVERAGE_THRESHOLD = 0.7;
const REFRESH_LOG_PATH = path.resolve(__dirname, '..', 'logs', 'data_refresh_log.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function chunk(items, size) {
  const output = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

async function ensureRefreshColumns() {
  await queryWithTimeout(
    `ALTER TABLE market_quotes
       ADD COLUMN IF NOT EXISTS previous_close NUMERIC,
       ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ`,
    [],
    {
      label: 'engine.full_universe_refresh.ensure_market_quotes_columns',
      timeoutMs: 10000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `ALTER TABLE market_metrics
       ADD COLUMN IF NOT EXISTS avg_volume_30d NUMERIC,
       ADD COLUMN IF NOT EXISTS change_percent NUMERIC`,
    [],
    {
      label: 'engine.full_universe_refresh.ensure_market_metrics_columns',
      timeoutMs: 10000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `ALTER TABLE market_quotes
       ALTER COLUMN last_updated TYPE TIMESTAMPTZ USING last_updated::timestamptz`,
    [],
    {
      label: 'engine.full_universe_refresh.ensure_last_updated_timestamptz',
      timeoutMs: 10000,
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

async function readAllUniverseSymbols() {
  const { rows } = await queryWithTimeout(
    `SELECT UPPER(symbol) AS symbol,
            MAX(market_cap::numeric) AS market_cap
     FROM ticker_universe
     WHERE symbol IS NOT NULL
       AND symbol <> ''
     GROUP BY UPPER(symbol)
     ORDER BY UPPER(symbol) ASC`,
    [],
    {
      label: 'engine.full_universe_refresh.read_symbols',
      timeoutMs: 30000,
      maxRetries: 1,
      retryDelayMs: 300,
      poolType: 'read',
    }
  );

  const symbols = [];
  const marketCapBySymbol = new Map();
  for (const row of rows || []) {
    const symbol = String(row.symbol || '').toUpperCase();
    if (!symbol) continue;
    symbols.push(symbol);
    marketCapBySymbol.set(symbol, toNumber(row.market_cap));
  }

  return {
    symbols,
    marketCapBySymbol,
  };
}

async function fetchBatchWithRetry(endpoint, params, batchLabel) {
  try {
    return await fmpFetch(endpoint, params);
  } catch (firstError) {
    console.error('❌ API FAILURE', firstError.message);
    console.warn('[FULL_UNIVERSE_REFRESH] batch request failed; retrying once', {
      batch: batchLabel,
      endpoint,
      error: firstError.message,
    });
    await sleep(RETRY_DELAY_MS);

    try {
      return await fmpFetch(endpoint, params);
    } catch (secondError) {
      console.error('❌ API FAILURE', secondError.message);
      console.error('[FULL_UNIVERSE_REFRESH] batch request failed after retry', {
        batch: batchLabel,
        endpoint,
        error: secondError.message,
      });
      throw secondError;
    }
  }
}

async function upsertQuotesBatch(rows) {
  if (!rows.length) {
    return;
  }

  const values = [];
  const placeholders = [];

  rows.forEach((row, rowIndex) => {
    const base = rowIndex * 7;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, NOW(), NOW(), $${base + 6}, $${base + 7})`);
    values.push(
      row.symbol,
      row.price,
      row.previous_close,
      row.volume,
      row.market_cap,
      row.change_percent,
      row.sector
    );
  });

  await queryWithTimeout(
    `INSERT INTO market_quotes (
       symbol,
       price,
       previous_close,
       volume,
       market_cap,
       updated_at,
       last_updated,
       change_percent,
       sector
     ) VALUES ${placeholders.join(', ')}
     ON CONFLICT (symbol)
     DO UPDATE SET
       price = EXCLUDED.price,
       previous_close = EXCLUDED.previous_close,
       volume = EXCLUDED.volume,
       market_cap = EXCLUDED.market_cap,
       updated_at = EXCLUDED.updated_at,
       last_updated = EXCLUDED.last_updated,
       change_percent = EXCLUDED.change_percent,
       sector = COALESCE(EXCLUDED.sector, market_quotes.sector)`,
    values,
    {
      label: 'engine.full_universe_refresh.upsert_market_quotes',
      timeoutMs: 20000,
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

async function upsertMetricsBatch(rows) {
  if (!rows.length) {
    return;
  }

  const values = [];
  const placeholders = [];

  rows.forEach((row, rowIndex) => {
    const base = rowIndex * 4;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, NOW(), $${base + 4})`);
    values.push(
      row.symbol,
      row.avg_volume_30d,
      row.change_percent,
      row.volume
    );
  });

  await queryWithTimeout(
    `INSERT INTO market_metrics (
       symbol,
       avg_volume_30d,
       change_percent,
       updated_at,
       volume
     ) VALUES ${placeholders.join(', ')}
     ON CONFLICT (symbol)
     DO UPDATE SET
       avg_volume_30d = COALESCE(EXCLUDED.avg_volume_30d, market_metrics.avg_volume_30d),
       change_percent = COALESCE(EXCLUDED.change_percent, market_metrics.change_percent),
       volume = COALESCE(EXCLUDED.volume, market_metrics.volume),
       updated_at = EXCLUDED.updated_at,
       last_updated = EXCLUDED.updated_at`,
    values,
    {
      label: 'engine.full_universe_refresh.upsert_market_metrics',
      timeoutMs: 20000,
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

async function backfillMetricsFromDailyOhlc(symbols) {
  if (!symbols.length) {
    return;
  }

  await queryWithTimeout(
    `WITH target AS (
       SELECT UNNEST($1::text[]) AS symbol
     ),
     ranked_daily AS (
       SELECT
         UPPER(d.symbol) AS symbol,
         d.volume::numeric AS volume,
         ROW_NUMBER() OVER (PARTITION BY UPPER(d.symbol) ORDER BY d.date DESC) AS rn
       FROM daily_ohlc d
       JOIN target t ON t.symbol = UPPER(d.symbol)
       WHERE d.symbol IS NOT NULL
         AND d.symbol <> ''
         AND d.volume IS NOT NULL
     ),
     avg_30 AS (
       SELECT symbol, AVG(volume)::numeric AS avg_volume_30d
       FROM ranked_daily
       WHERE rn <= 30
       GROUP BY symbol
     ),
     latest_quote AS (
       SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         price::numeric AS price,
         previous_close::numeric AS previous_close
       FROM market_quotes
       WHERE UPPER(symbol) = ANY($1::text[])
       ORDER BY UPPER(symbol), last_updated DESC NULLS LAST
     )
     UPDATE market_metrics mm
     SET
       avg_volume_30d = COALESCE(avg_30.avg_volume_30d, mm.avg_volume_30d),
       change_percent = COALESCE(
         CASE
           WHEN latest_quote.previous_close IS NOT NULL AND latest_quote.previous_close <> 0 AND latest_quote.price IS NOT NULL
             THEN ((latest_quote.price - latest_quote.previous_close) / latest_quote.previous_close) * 100
           ELSE NULL
         END,
         mm.change_percent
       ),
       updated_at = NOW(),
       last_updated = NOW()
     FROM avg_30
     LEFT JOIN latest_quote ON latest_quote.symbol = avg_30.symbol
     WHERE UPPER(mm.symbol) = avg_30.symbol`,
    [symbols],
    {
      label: 'engine.full_universe_refresh.backfill_metrics_daily_ohlc',
      timeoutMs: 30000,
      maxRetries: 1,
      retryDelayMs: 300,
      poolType: 'write',
    }
  );
}

async function getCoverageStats() {
  const { rows } = await queryWithTimeout(
    `SELECT
       (SELECT COUNT(DISTINCT UPPER(symbol))::int
        FROM ticker_universe
        WHERE symbol IS NOT NULL AND symbol <> '') AS total_universe_count,
       (SELECT COUNT(*)::int
        FROM market_quotes
          WHERE COALESCE(last_updated, updated_at) >= NOW() - INTERVAL '60 seconds'
          AND price IS NOT NULL
          AND price > 0) AS fresh_quote_count`,
    [],
    {
      label: 'engine.full_universe_refresh.coverage',
      timeoutMs: 7000,
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const totalUniverseCount = Number(rows?.[0]?.total_universe_count || 0);
  const freshQuoteCount = Number(rows?.[0]?.fresh_quote_count || 0);
  const coverage = totalUniverseCount > 0 ? freshQuoteCount / totalUniverseCount : 0;

  return {
    total_universe_count: totalUniverseCount,
    fresh_quote_count: freshQuoteCount,
    coverage,
  };
}

function appendRefreshLog(entry) {
  let current = [];
  try {
    if (fs.existsSync(REFRESH_LOG_PATH)) {
      const raw = fs.readFileSync(REFRESH_LOG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        current = parsed;
      }
    }
  } catch (_error) {
    current = [];
  }

  current.push(entry);
  const trimmed = current.slice(-200);

  fs.mkdirSync(path.dirname(REFRESH_LOG_PATH), { recursive: true });
  fs.writeFileSync(REFRESH_LOG_PATH, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
}

async function runFullUniverseRefresh() {
  console.log('🚀 FULL REFRESH START', new Date().toISOString());
  const startedAt = Date.now();
  let apiFailures = 0;
  await ensureRefreshColumns();

  const { symbols, marketCapBySymbol } = await readAllUniverseSymbols();
  console.log('📊 SYMBOL COUNT:', symbols.length);
  const batches = chunk(symbols, BATCH_SIZE);
  let quotesUpdated = 0;

  for (let i = 0; i < batches.length; i += 1) {
    const batchSymbols = batches[i];
    const batchLabel = `${i + 1}/${batches.length}`;

    let quotePayload;
    try {
      quotePayload = await fetchBatchWithRetry(
        '/batch-quote',
        { symbols: batchSymbols.join(',') },
        `quote:${batchLabel}`
      );
    } catch (error) {
      apiFailures += 1;
      console.error('❌ API FAILURE', error.message);
      throw error;
    }

    if (!Array.isArray(quotePayload) || quotePayload.length === 0) {
      console.log(`📦 Batch ${i + 1} processed: 0`);
      continue;
    }

    let keyMetricsPayload;
    try {
      keyMetricsPayload = await fetchBatchWithRetry(
        '/key-metrics',
        { symbol: batchSymbols.join(','), limit: 1 },
        `key-metrics:${batchLabel}`
      );
    } catch (error) {
      apiFailures += 1;
      console.error('❌ API FAILURE', error.message);
      throw error;
    }

    const keyMetricsMap = new Map();
    if (Array.isArray(keyMetricsPayload)) {
      for (const item of keyMetricsPayload) {
        const symbol = String(item?.symbol || '').toUpperCase();
        if (!symbol) continue;
        keyMetricsMap.set(symbol, item);
      }
    }

    const quoteRows = [];
    const metricsRows = [];

    for (const quote of quotePayload) {
      const symbol = String(quote?.symbol || '').toUpperCase();
      if (!symbol) continue;

      const price = toNumber(quote?.price);
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }

      const changeAbsolute = toNumber(quote?.change);
      const previousClose = Number.isFinite(changeAbsolute)
        ? price - changeAbsolute
        : null;
      const changePercentRaw = toNumber(quote?.changePercentage) ?? toNumber(quote?.changesPercentage) ?? toNumber(quote?.changesPercentageAbsolute);
      const recalculatedChangePercent = Number.isFinite(previousClose) && previousClose !== 0
        ? ((price - previousClose) / previousClose) * 100
        : null;
      const changePercent = Number.isFinite(changePercentRaw) ? changePercentRaw : recalculatedChangePercent;

      const volume = toInteger(quote?.volume);
      const marketCap = toInteger(marketCapBySymbol.get(symbol));
      const sector = quote?.sector ? String(quote.sector) : null;
      const metrics = keyMetricsMap.get(symbol) || {};
      const avgVolume30d = toNumber(quote?.avgVolume)
        ?? toNumber(quote?.avgVolume3m)
        ?? toNumber(metrics?.avgVolume)
        ?? toNumber(metrics?.volAvg)
        ?? toNumber(metrics?.volumeAvg);

      quoteRows.push({
        symbol,
        price,
        previous_close: previousClose,
        volume,
        market_cap: marketCap,
        change_percent: changePercent,
        sector,
      });

      metricsRows.push({
        symbol,
        avg_volume_30d: avgVolume30d,
        change_percent: changePercent,
        volume,
      });
    }

    if (quoteRows.length) {
      await upsertQuotesBatch(quoteRows);
      await upsertMetricsBatch(metricsRows);
      quotesUpdated += quoteRows.length;

      const { rows: freshCountRows } = await queryWithTimeout(
        `SELECT COUNT(*)::int AS count
         FROM market_quotes
         WHERE last_updated > NOW() - INTERVAL '60 seconds'`,
        [],
        {
          label: 'engine.full_universe_refresh.fresh_quotes_count',
          timeoutMs: 10000,
          maxRetries: 0,
          poolType: 'read',
        }
      );
      console.log('🧪 FRESH QUOTES COUNT:', Number(freshCountRows?.[0]?.count || 0));
    }

    console.log(`📦 Batch ${i + 1} processed: ${batchSymbols.length}`);
  }

  await backfillMetricsFromDailyOhlc(symbols);

  const coverageStats = await getCoverageStats();
  const logEntry = {
    timestamp: new Date().toISOString(),
    total_symbols: symbols.length,
    quotes_updated: quotesUpdated,
    coverage_percent: Number((coverageStats.coverage * 100).toFixed(2)),
    duration_ms: Date.now() - startedAt,
  };

  appendRefreshLog(logEntry);
  console.log('✅ FULL REFRESH COMPLETE');

  return {
    ...logEntry,
    coverage: coverageStats.coverage,
    required: COVERAGE_THRESHOLD,
    api_failures: apiFailures,
  };
}

module.exports = {
  runFullUniverseRefresh,
  getCoverageStats,
};
