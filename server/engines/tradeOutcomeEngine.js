const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureTradeOutcomeTables() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS trade_signals (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL UNIQUE,
      setup_type TEXT,
      entry_price NUMERIC,
      rvol NUMERIC,
      "timestamp" TIMESTAMPTZ,
      strategy TEXT,
      source_engine TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.trade_outcome.ensure_trade_signals', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS setup_type TEXT',
    [],
    { timeoutMs: 5000, label: 'engines.trade_outcome.ensure_setup_type', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS entry_price NUMERIC',
    [],
    { timeoutMs: 5000, label: 'engines.trade_outcome.ensure_entry_price', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS "timestamp" TIMESTAMPTZ',
    [],
    { timeoutMs: 5000, label: 'engines.trade_outcome.ensure_timestamp', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS source_engine TEXT',
    [],
    { timeoutMs: 5000, label: 'engines.trade_outcome.ensure_source_engine', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS score NUMERIC',
    [],
    { timeoutMs: 5000, label: 'engines.trade_outcome.ensure_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS trade_outcomes (
      signal_id BIGINT PRIMARY KEY REFERENCES trade_signals(id) ON DELETE CASCADE,
      max_move NUMERIC,
      max_drawdown NUMERIC,
      success BOOLEAN,
      evaluation_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.trade_outcome.ensure_trade_outcomes', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS strategy_stats (
      setup_type TEXT PRIMARY KEY,
      sample_size INT NOT NULL DEFAULT 0,
      win_rate NUMERIC NOT NULL DEFAULT 0,
      avg_move NUMERIC NOT NULL DEFAULT 0,
      avg_drawdown NUMERIC NOT NULL DEFAULT 0,
      last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.trade_outcome.ensure_strategy_stats', maxRetries: 0 }
  );
}

async function recordSignal(signal = {}) {
  await ensureTradeOutcomeTables();

  const symbol = String(signal.symbol || '').toUpperCase().trim();
  const setupType = String(signal.setup_type || signal.setupType || signal.strategy || 'unknown').trim();
  const entryPrice = toNumber(signal.entry_price ?? signal.entryPrice ?? signal.price, 0);
  const rvol = toNumber(signal.rvol ?? signal.relative_volume ?? signal.relativeVolume, 0);
  const strategy = String(signal.strategy || setupType || 'unknown').trim();
  const sourceEngine = String(signal.source_engine || signal.sourceEngine || 'stocksInPlayEngine').trim();

  if (!symbol || entryPrice <= 0 || rvol <= 0) {
    return { success: false, skipped: true, reason: 'invalid_signal' };
  }

  const { rows } = await queryWithTimeout(
    `INSERT INTO trade_signals (
       symbol,
       setup_type,
       entry_price,
       rvol,
       "timestamp",
       strategy,
       source_engine,
       score,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, NOW(), NOW())
     ON CONFLICT (symbol)
     DO UPDATE SET
       setup_type = EXCLUDED.setup_type,
       entry_price = EXCLUDED.entry_price,
       rvol = EXCLUDED.rvol,
       "timestamp" = EXCLUDED."timestamp",
       strategy = EXCLUDED.strategy,
       source_engine = EXCLUDED.source_engine,
       score = EXCLUDED.score,
       updated_at = NOW()
     RETURNING id`,
    [
      symbol,
      setupType,
      entryPrice,
      rvol,
      strategy,
      sourceEngine,
      toNumber(signal.score ?? signal.tradeScore, 0),
    ],
    { timeoutMs: 7000, label: 'engines.trade_outcome.record_signal', maxRetries: 0 }
  );

  return { success: true, signalId: rows?.[0]?.id || null, symbol };
}

function evaluateSequence(entryPrice, bars = []) {
  let maxMove = -Infinity;
  let maxDrawdown = Infinity;
  let moveHitAt = null;
  let drawdownHitAt = null;

  for (const bar of bars) {
    const high = toNumber(bar.high, toNumber(bar.close, 0));
    const low = toNumber(bar.low, toNumber(bar.close, 0));
    const barTs = bar.ts || null;

    if (high <= 0 || low <= 0) {
      continue;
    }

    const up = ((high - entryPrice) / entryPrice) * 100;
    const down = ((low - entryPrice) / entryPrice) * 100;

    if (up > maxMove) {
      maxMove = up;
    }
    if (down < maxDrawdown) {
      maxDrawdown = down;
    }

    if (moveHitAt === null && up >= 2) {
      moveHitAt = barTs;
    }
    if (drawdownHitAt === null && down <= -2) {
      drawdownHitAt = barTs;
    }
  }

  if (!Number.isFinite(maxMove)) maxMove = 0;
  if (!Number.isFinite(maxDrawdown)) maxDrawdown = 0;

  const success = Boolean(
    moveHitAt &&
    (!drawdownHitAt || new Date(moveHitAt).getTime() <= new Date(drawdownHitAt).getTime())
  );

  return {
    maxMove,
    maxDrawdown,
    success,
  };
}

async function evaluateSignals() {
  await ensureTradeOutcomeTables();

  const { rows: signals } = await queryWithTimeout(
    `SELECT s.id, s.symbol, s.setup_type, s.entry_price, COALESCE(s."timestamp", s.created_at) AS signal_time
     FROM trade_signals s
     LEFT JOIN trade_outcomes o ON o.signal_id = s.id
     WHERE o.signal_id IS NULL
       AND COALESCE(s."timestamp", s.created_at) <= NOW() - INTERVAL '30 minutes'
       AND COALESCE(s.entry_price, 0) > 0
     ORDER BY COALESCE(s."timestamp", s.created_at) ASC
     LIMIT 200`,
    [],
    { timeoutMs: 9000, label: 'engines.trade_outcome.pending_signals', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  let evaluated = 0;

  for (const signal of signals || []) {
    const { rows: bars } = await queryWithTimeout(
      `SELECT
         timestamp AS ts,
         COALESCE(high, close, price) AS high,
         COALESCE(low, close, price) AS low,
         COALESCE(close, price) AS close,
         COALESCE(volume, 0) AS volume
       FROM intraday_1m
       WHERE symbol = $1
         AND timestamp >= $2
         AND timestamp <= $2 + INTERVAL '30 minutes'
         AND COALESCE(close, price, 0) > 0
         AND COALESCE(volume, 0) > 0
       ORDER BY timestamp ASC`,
      [signal.symbol, signal.signal_time],
      { timeoutMs: 7000, label: 'engines.trade_outcome.load_bars', maxRetries: 0 }
    ).catch(() => ({ rows: [] }));

    if (!bars?.length) {
      continue;
    }

    const outcome = evaluateSequence(toNumber(signal.entry_price, 0), bars);

    await queryWithTimeout(
      `INSERT INTO trade_outcomes (signal_id, max_move, max_drawdown, success, evaluation_time)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (signal_id)
       DO UPDATE SET
         max_move = EXCLUDED.max_move,
         max_drawdown = EXCLUDED.max_drawdown,
         success = EXCLUDED.success,
         evaluation_time = EXCLUDED.evaluation_time`,
      [signal.id, outcome.maxMove, outcome.maxDrawdown, outcome.success],
      { timeoutMs: 6000, label: 'engines.trade_outcome.upsert_outcome', maxRetries: 0 }
    );

    evaluated += 1;
  }

  await updateStrategyStats();

  logger.info('[TRADE_OUTCOME] evaluation cycle complete', {
    evaluated,
    pending: signals?.length || 0,
  });

  return { evaluated, pending: signals?.length || 0 };
}

async function updateStrategyStats() {
  await ensureTradeOutcomeTables();

  const { rows } = await queryWithTimeout(
    `SELECT
       COALESCE(NULLIF(TRIM(s.setup_type), ''), 'unknown') AS setup_type,
       COUNT(*)::int AS sample_size,
       ROUND(AVG(CASE WHEN o.success THEN 1 ELSE 0 END)::numeric * 100, 2) AS win_rate,
       ROUND(AVG(o.max_move)::numeric, 4) AS avg_move,
       ROUND(AVG(o.max_drawdown)::numeric, 4) AS avg_drawdown
     FROM trade_outcomes o
     JOIN trade_signals s ON s.id = o.signal_id
     GROUP BY COALESCE(NULLIF(TRIM(s.setup_type), ''), 'unknown')`,
    [],
    { timeoutMs: 9000, label: 'engines.trade_outcome.aggregate_stats', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  for (const row of rows || []) {
    await queryWithTimeout(
      `INSERT INTO strategy_stats (setup_type, sample_size, win_rate, avg_move, avg_drawdown, last_updated)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (setup_type)
       DO UPDATE SET
         sample_size = EXCLUDED.sample_size,
         win_rate = EXCLUDED.win_rate,
         avg_move = EXCLUDED.avg_move,
         avg_drawdown = EXCLUDED.avg_drawdown,
         last_updated = NOW()`,
      [row.setup_type, row.sample_size, row.win_rate, row.avg_move, row.avg_drawdown],
      { timeoutMs: 7000, label: 'engines.trade_outcome.upsert_strategy_stats', maxRetries: 0 }
    );
  }

  return { updated: rows?.length || 0 };
}

async function getStrategyStats(setupType) {
  await ensureTradeOutcomeTables();

  if (!setupType) {
    return null;
  }

  const { rows } = await queryWithTimeout(
    `SELECT setup_type, sample_size, win_rate, avg_move, avg_drawdown, last_updated
     FROM strategy_stats
     WHERE setup_type = $1
     LIMIT 1`,
    [String(setupType)],
    { timeoutMs: 4000, label: 'engines.trade_outcome.get_strategy_stats', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return rows?.[0] || null;
}

module.exports = {
  ensureTradeOutcomeTables,
  recordSignal,
  evaluateSignals,
  updateStrategyStats,
  getStrategyStats,
};
