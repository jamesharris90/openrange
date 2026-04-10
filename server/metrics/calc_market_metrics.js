const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../db/pg');
const logger = require('../logger');
const { queueSymbol, ensureQueueTable } = require('./queue_symbol');

const BATCH_SIZE = 500;
const WORKER_COUNT = 3;
const QUEUE_LIMIT = 500;

async function ensureMetricsTable() {
  const sqlPath = path.join(__dirname, '..', 'migrations', 'create_market_metrics.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
  await pool.query(
    `ALTER TABLE market_metrics
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`
  );
}

async function seedQueueFromSources() {
  const intradayRows = await pool.query(
    `SELECT DISTINCT symbol
     FROM intraday_1m
     WHERE timestamp >= NOW() - INTERVAL '2 minutes'
     ORDER BY symbol ASC
     LIMIT 2000`
  );

  for (const row of intradayRows.rows) {
    await queueSymbol(row.symbol, 'intraday_update', { silent: true });
  }

  return {
    intradayQueued: intradayRows.rows.length,
    newUniverseQueued: 0,
  };
}

async function getQueueHealthSnapshot() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS queue_size,
            MIN(created_at) AS oldest_item
     FROM symbol_queue`
  );
  const row = rows[0] || { queue_size: 0, oldest_item: null };
  return {
    queueSize: Number(row.queue_size) || 0,
    oldestItem: row.oldest_item,
  };
}

async function getQueuedSymbols(limit = QUEUE_LIMIT) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || QUEUE_LIMIT, QUEUE_LIMIT));
  const { rows } = await pool.query(
    `SELECT symbol
     FROM symbol_queue
     ORDER BY created_at ASC
     LIMIT $1`,
    [safeLimit]
  );

  return rows.map((row) => row.symbol);
}

async function clearProcessedQueue(symbols) {
  if (!symbols.length) return 0;
  const uniqueSymbols = Array.from(new Set(symbols.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean)));
  if (!uniqueSymbols.length) return 0;

  const result = await pool.query(
    `DELETE FROM symbol_queue
     WHERE symbol = ANY($1::text[])`,
    [uniqueSymbols]
  );

  return result.rowCount || 0;
}

async function getAllSymbols() {
  const { rows } = await pool.query(`
    SELECT DISTINCT symbol
    FROM (
      SELECT symbol FROM daily_ohlc
      UNION
      SELECT symbol FROM intraday_1m
    ) s
    WHERE symbol IS NOT NULL
      AND symbol <> ''
    ORDER BY symbol ASC
  `);

  return rows.map((row) => row.symbol);
}

async function calculateBatchMetrics(symbols) {
  if (!symbols.length) return [];

  const { rows } = await pool.query(
    `WITH target_symbols AS (
       SELECT UNNEST($1::text[]) AS symbol
     ),
     daily AS (
       SELECT d.symbol,
              d.date,
              d.open,
              d.high,
              d.low,
              d.close,
              d.volume,
              ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn,
              LAG(d.close) OVER (PARTITION BY d.symbol ORDER BY d.date ASC) AS prev_close
       FROM daily_ohlc d
       JOIN target_symbols t ON t.symbol = d.symbol
     ),
     latest_daily AS (
       SELECT symbol, open, close, volume, prev_close
       FROM daily
       WHERE rn = 1
     ),
     avg_30_volume AS (
       SELECT symbol,
              AVG(volume)::numeric AS avg_30_day_volume
       FROM daily
       WHERE rn <= 30
       GROUP BY symbol
     ),
     true_range_rows AS (
       SELECT symbol,
              rn,
              GREATEST(
                high - low,
                ABS(high - COALESCE(prev_close, close)),
                ABS(low - COALESCE(prev_close, close))
              )::numeric AS tr
       FROM daily
     ),
     atr_14 AS (
       SELECT symbol,
              AVG(tr)::numeric AS atr
       FROM true_range_rows
       WHERE rn <= 14
       GROUP BY symbol
     ),
     rsi_daily AS (
       SELECT symbol,
              date,
              close,
              LAG(close) OVER (PARTITION BY symbol ORDER BY date ASC) AS prev_close,
              ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
       FROM daily_ohlc
       WHERE symbol = ANY($1::text[])
     ),
     rsi_parts AS (
       SELECT symbol,
              AVG(GREATEST(close - prev_close, 0))::numeric AS avg_gain,
              AVG(GREATEST(prev_close - close, 0))::numeric AS avg_loss
       FROM rsi_daily
       WHERE rn <= 14
         AND prev_close IS NOT NULL
       GROUP BY symbol
     ),
     intraday AS (
       SELECT i.symbol,
              SUM(i.close * i.volume)::numeric AS pv_sum,
              SUM(i.volume)::numeric AS total_intraday_volume
       FROM intraday_1m i
       JOIN target_symbols t ON t.symbol = i.symbol
       WHERE i.timestamp >= NOW() - INTERVAL '1 day'
       GROUP BY i.symbol
     ),
     latest_intraday AS (
       SELECT DISTINCT ON (symbol)
              symbol,
              close::numeric AS intraday_price
       FROM intraday_1m
       WHERE symbol = ANY($1::text[])
         AND timestamp >= NOW() - INTERVAL '1 day'
       ORDER BY symbol, timestamp DESC
     ),
     profiles AS (
       SELECT symbol,
              float::numeric AS float_shares
       FROM company_profiles
       WHERE symbol = ANY($1::text[])
     )
     SELECT t.symbol,
            COALESCE(li.intraday_price, ld.close)::numeric AS price,
            CASE
              WHEN ld.prev_close IS NULL OR ld.prev_close = 0 THEN NULL
              ELSE ((ld.open - ld.prev_close) / ld.prev_close) * 100
            END::numeric AS gap_percent,
            CASE
              WHEN a.avg_30_day_volume IS NULL OR a.avg_30_day_volume = 0 THEN NULL
              ELSE ld.volume / a.avg_30_day_volume
            END::numeric AS relative_volume,
            atr.atr::numeric AS atr,
            CASE
              WHEN r.avg_loss IS NULL THEN NULL
              WHEN r.avg_loss = 0 THEN 100
              ELSE 100 - (100 / (1 + (r.avg_gain / NULLIF(r.avg_loss, 0))))
            END::numeric AS rsi,
            CASE
              WHEN i.total_intraday_volume IS NULL OR i.total_intraday_volume = 0 THEN NULL
              ELSE i.pv_sum / i.total_intraday_volume
            END::numeric AS vwap,
            CASE
              WHEN p.float_shares IS NULL OR p.float_shares = 0 THEN NULL
              ELSE ld.volume / p.float_shares
            END::numeric AS float_rotation
     FROM target_symbols t
     LEFT JOIN latest_daily ld ON ld.symbol = t.symbol
     LEFT JOIN avg_30_volume a ON a.symbol = t.symbol
     LEFT JOIN atr_14 atr ON atr.symbol = t.symbol
     LEFT JOIN rsi_parts r ON r.symbol = t.symbol
     LEFT JOIN intraday i ON i.symbol = t.symbol
    LEFT JOIN latest_intraday li ON li.symbol = t.symbol
     LEFT JOIN profiles p ON p.symbol = t.symbol
     WHERE ld.symbol IS NOT NULL`,
    [symbols]
  );

  return rows;
}

async function upsertMetrics(rows) {
  if (!rows.length) return 0;

  const payload = JSON.stringify(rows);

  await pool.query(
    `INSERT INTO market_metrics (
       symbol,
       price,
       gap_percent,
       relative_volume,
       atr,
       rsi,
       vwap,
       float_rotation,
      last_updated,
      updated_at
     )
     SELECT symbol,
            price,
            gap_percent,
            relative_volume,
            atr,
            rsi,
            vwap,
            float_rotation,
           NOW(),
           NOW()
     FROM jsonb_to_recordset($1::jsonb) AS x(
       symbol text,
       price numeric,
       gap_percent numeric,
       relative_volume numeric,
       atr numeric,
       rsi numeric,
       vwap numeric,
       float_rotation numeric
     )
     ON CONFLICT (symbol) DO UPDATE
     SET price = EXCLUDED.price,
         gap_percent = EXCLUDED.gap_percent,
         relative_volume = EXCLUDED.relative_volume,
         atr = EXCLUDED.atr,
         rsi = EXCLUDED.rsi,
         vwap = EXCLUDED.vwap,
         float_rotation = EXCLUDED.float_rotation,
         last_updated = NOW(),
         updated_at = NOW()`,
    [payload]
  );

  return rows.length;
}

async function processQueue(symbols, workerFn, batchSize = BATCH_SIZE, workerCount = WORKER_COUNT) {
  const queue = [];
  for (let index = 0; index < symbols.length; index += batchSize) {
    queue.push(symbols.slice(index, index + batchSize));
  }

  let queueIndex = 0;
  let processed = 0;
  let failedBatches = 0;
  let written = 0;
  const processedSymbols = new Set();

  async function worker(workerId) {
    while (true) {
      const currentIndex = queueIndex;
      queueIndex += 1;

      const batch = queue[currentIndex];
      if (!batch) return;

      try {
        const metrics = await workerFn(batch);
        const inserted = await upsertMetrics(metrics);
        processed += batch.length;
        written += inserted;
        for (const row of metrics) {
          if (row?.symbol) processedSymbols.add(String(row.symbol).toUpperCase());
        }

        logger.info('metrics batch complete', {
          scope: 'metrics',
          workerId,
          batchNumber: currentIndex + 1,
          symbols: batch.length,
          inserted,
        });
      } catch (err) {
        failedBatches += 1;
        processed += batch.length;

        logger.error('metrics batch failed', {
          scope: 'metrics',
          workerId,
          batchNumber: currentIndex + 1,
          symbols: batch.length,
          error: err.message,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));

  return {
    batches: queue.length,
    processedSymbols: processed,
    writtenRows: written,
    failedBatches,
    updatedSymbols: Array.from(processedSymbols),
  };
}

async function calculateMarketMetrics(options = {}) {
  const startedAt = Date.now();
  await ensureMetricsTable();
  await ensureQueueTable();

  const mode = options.mode === 'full' ? 'full' : 'queue';

  let symbols = [];
  let seedSummary = { intradayQueued: 0, newUniverseQueued: 0 };
  const beforeQueue = await getQueueHealthSnapshot();

  if (mode === 'queue') {
    seedSummary = await seedQueueFromSources();
    symbols = await getQueuedSymbols(QUEUE_LIMIT);
  } else {
    symbols = await getAllSymbols();
  }

  logger.info('metrics engine start', {
    scope: 'metrics',
    mode,
    symbols: symbols.length,
    queueSizeBefore: beforeQueue.queueSize,
    oldestQueueItem: beforeQueue.oldestItem,
    seedSummary,
    batchSize: BATCH_SIZE,
    workers: WORKER_COUNT,
  });

  if (!symbols.length) {
    const durationMs = Date.now() - startedAt;
    const afterQueue = await getQueueHealthSnapshot();
    const emptyResult = {
      mode,
      symbols: 0,
      batches: 0,
      processedSymbols: 0,
      writtenRows: 0,
      failedBatches: 0,
      queueSizeBefore: beforeQueue.queueSize,
      queueSizeAfter: afterQueue.queueSize,
      queueCleared: 0,
      runtimeMs: durationMs,
      errors: 0,
    };

    logger.info('metrics engine complete', {
      scope: 'metrics',
      ...emptyResult,
    });

    return emptyResult;
  }

  const queueResult = await processQueue(symbols, calculateBatchMetrics, BATCH_SIZE, WORKER_COUNT);
  const queueCleared = await clearProcessedQueue(symbols);
  const afterQueue = await getQueueHealthSnapshot();

  const durationMs = Date.now() - startedAt;
  const result = {
    mode,
    symbols: symbols.length,
    ...queueResult,
    queueSizeBefore: beforeQueue.queueSize,
    queueSizeAfter: afterQueue.queueSize,
    queueCleared,
    runtimeMs: durationMs,
    errors: queueResult.failedBatches,
  };

  logger.info('metrics engine complete', {
    scope: 'metrics',
    ...result,
  });

  return result;
}

module.exports = {
  calculateMarketMetrics,
  ensureMetricsTable,
};
