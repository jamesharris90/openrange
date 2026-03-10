const db = require('../db');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getNyDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

async function ensureSignalPerformanceTables() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS signal_performance (
      id BIGSERIAL PRIMARY KEY,
      snapshot_date DATE NOT NULL,
      symbol TEXT NOT NULL,
      entry_price NUMERIC,
      current_price NUMERIC,
      return_percent NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (snapshot_date, symbol)
    )`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS snapshot_date DATE DEFAULT CURRENT_DATE`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_snapshot_date', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS symbol TEXT`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_symbol', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS signal_id BIGINT`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_signal_id', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS strategy TEXT`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_strategy', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS class TEXT`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_class', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS score NUMERIC`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS probability NUMERIC`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_probability', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS entry_price NUMERIC`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_entry_price', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS current_price NUMERIC`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_current_price', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS return_percent NUMERIC`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_return_percent', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS max_upside NUMERIC`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_max_upside', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS max_drawdown NUMERIC`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_max_drawdown', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS outcome TEXT`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_outcome', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_evaluated_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_updated_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE signal_performance
       ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_created_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS daily_signal_snapshot (
      id BIGSERIAL PRIMARY KEY
    )`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.ensure_snapshot_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS snapshot_date DATE DEFAULT CURRENT_DATE`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_snapshot_table_date', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS symbol TEXT`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_snapshot_table_symbol', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS entry_price NUMERIC`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.alter_snapshot_table_entry_price', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_signal_performance_symbol
       ON signal_performance (symbol)`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.index_symbol', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_signal_performance_snapshot_date
       ON signal_performance (snapshot_date DESC)`,
    [],
    { timeoutMs: 7000, label: 'signal_performance.index_snapshot_date', maxRetries: 0 }
  );
}

async function runSignalPerformanceEngine() {
  try {
    await ensureSignalPerformanceTables();

    const snapshotDate = getNyDateKey();
    const { rows } = await queryWithTimeout(
    `SELECT
       s.symbol,
       s.entry_price,
       COALESCE(q.price, s.entry_price, 0) AS current_price
     FROM daily_signal_snapshot s
     LEFT JOIN market_quotes q ON q.symbol = s.symbol
     WHERE s.snapshot_date = $1::date`,
    [snapshotDate],
    { timeoutMs: 7000, label: 'signal_performance.select_snapshot', maxRetries: 0 }
  );

    if (!rows.length) return { processed: 0, updated: 0 };

    const symbols = [];
    const entryPrices = [];
    const currentPrices = [];
    const returnPercents = [];

    for (const row of rows) {
    const symbol = String(row.symbol || '').toUpperCase().trim();
    if (!symbol) {
      continue;
    }

    const entryPrice = toNumber(row.entry_price);
    const currentPrice = toNumber(row.current_price, entryPrice);
    const returnPercent = entryPrice > 0
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : 0;

    symbols.push(symbol);
    entryPrices.push(Number(entryPrice.toFixed(6)));
    currentPrices.push(Number(currentPrice.toFixed(6)));
    returnPercents.push(Number(returnPercent.toFixed(6)));
  }

    if (!symbols.length) {
      return { processed: rows.length, updated: 0 };
    }

    await queryWithTimeout(
    `DELETE FROM signal_performance
     WHERE snapshot_date = $1::date
       AND symbol = ANY($2::text[])`,
    [snapshotDate, symbols],
    { timeoutMs: 7000, label: 'signal_performance.delete_existing_rows', maxRetries: 0 }
  );

    const result = await queryWithTimeout(
    `INSERT INTO signal_performance (
       snapshot_date,
       symbol,
       entry_price,
       current_price,
       return_percent,
       updated_at,
       created_at
     )
     SELECT
       $1::date,
       incoming.symbol,
       incoming.entry_price,
       incoming.current_price,
       incoming.return_percent,
       NOW(),
       NOW()
     FROM (
       SELECT
         unnest($2::text[]) AS symbol,
         unnest($3::numeric[]) AS entry_price,
         unnest($4::numeric[]) AS current_price,
         unnest($5::numeric[]) AS return_percent
     ) incoming`,
    [snapshotDate, symbols, entryPrices, currentPrices, returnPercents],
    { timeoutMs: 9000, label: 'signal_performance.upsert', maxRetries: 0 }
  );

    return { processed: rows.length, updated: result.rowCount || 0 };
  } catch (error) {
    return { processed: 0, updated: 0, error: error.message };
  }
}

async function evaluateSignals() {
  await ensureSignalPerformanceTables();

  console.log('[SIGNAL PERFORMANCE] evaluation started');
  console.log('[PERFORMANCE ENGINE] evaluating signals');

  const signals = await db.query(`
    SELECT *
    FROM strategy_signals
    WHERE updated_at >= NOW() - interval '1 day'
  `);

  for (const signal of signals.rows) {
    const symbol = signal.symbol;

    const priceData = await db.query(
      `SELECT COALESCE(price, 0) AS price
       FROM market_metrics
       WHERE symbol = $1
       LIMIT 1`,
      [symbol]
    );

    if (!priceData.rows.length) continue;

    const currentPrice = toNumber(priceData.rows[0].price);
    const entryPrice = toNumber(signal.entry_price, currentPrice);

    if (entryPrice <= 0) {
      continue;
    }

    const upside = ((currentPrice - entryPrice) / entryPrice) * 100;
    const drawdown = ((entryPrice - currentPrice) / entryPrice) * 100;

    let outcome = null;

    if (upside >= 2) outcome = 'WIN';
    if (drawdown >= 2) outcome = 'LOSS';

    await db.query(
      `INSERT INTO signal_performance
       (signal_id, symbol, strategy, class, score, probability,
        entry_price, current_price, return_percent, max_upside,
        max_drawdown, outcome, evaluated_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())`,
      [
        toNumber(signal.id, null),
        String(signal.symbol || '').toUpperCase(),
        signal.strategy || null,
        signal.class || null,
        toNumber(signal.score),
        toNumber(signal.probability),
        Number(entryPrice.toFixed(6)),
        Number(currentPrice.toFixed(6)),
        Number(upside.toFixed(6)),
        Number(upside.toFixed(6)),
        Number(drawdown.toFixed(6)),
        outcome,
      ]
    );

    console.log('[SIGNAL PERFORMANCE] signal processed');
  }

  console.log('[PERFORMANCE ENGINE] run complete');
  console.log('[SIGNAL PERFORMANCE] run completed');
}

module.exports = {
  evaluateSignals,
  runSignalPerformanceEngine,
};
