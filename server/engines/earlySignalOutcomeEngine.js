const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { ensureEarlyAccumulationTable } = require('./earlyAccumulationEngine');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureEarlySignalOutcomesTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS early_signal_outcomes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      signal_id UUID NOT NULL,
      symbol TEXT NOT NULL,
      entry_price NUMERIC,
      price_1h NUMERIC,
      price_4h NUMERIC,
      price_1d NUMERIC,
      price_5d NUMERIC,
      price_30d NUMERIC,
      max_move_percent NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(signal_id)
    )`,
    [],
    { timeoutMs: 8000, label: 'engines.early_outcomes.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE early_signal_outcomes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    [],
    { timeoutMs: 8000, label: 'engines.early_outcomes.ensure_created_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE early_signal_outcomes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    [],
    { timeoutMs: 8000, label: 'engines.early_outcomes.ensure_updated_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE UNIQUE INDEX IF NOT EXISTS early_signal_outcomes_signal_id_idx
     ON early_signal_outcomes (signal_id)`,
    [],
    { timeoutMs: 8000, label: 'engines.early_outcomes.ensure_signal_id_idx', maxRetries: 0 }
  );
}

async function runEarlySignalOutcomeEngine() {
  await ensureEarlyAccumulationTable();
  await ensureEarlySignalOutcomesTable();

  const { rows } = await queryWithTimeout(
    `SELECT
       s.id AS signal_id,
       s.symbol,
       s.price AS entry_price,
       s.detected_at,
       q.price AS current_price
     FROM early_accumulation_signals s
     LEFT JOIN market_quotes q ON q.symbol = s.symbol
     WHERE s.detected_at >= NOW() - interval '30 days'
     ORDER BY s.detected_at DESC`,
    [],
    { timeoutMs: 12000, label: 'engines.early_outcomes.select_signals', maxRetries: 0 }
  );

  let tracked = 0;

  for (const row of rows) {
    const entry = toNumber(row.entry_price);
    if (entry <= 0) continue;

    const current = toNumber(row.current_price, entry);
    const ageMs = Date.now() - new Date(row.detected_at).getTime();

    const h1Ready = ageMs >= (1 * 60 * 60 * 1000);
    const h4Ready = ageMs >= (4 * 60 * 60 * 1000);
    const d1Ready = ageMs >= (24 * 60 * 60 * 1000);
    const d5Ready = ageMs >= (5 * 24 * 60 * 60 * 1000);
    const d30Ready = ageMs >= (30 * 24 * 60 * 60 * 1000);

    const price1h = h1Ready ? current : null;
    const price4h = h4Ready ? current : null;
    const price1d = d1Ready ? current : null;
    const price5d = d5Ready ? current : null;
    const price30d = d30Ready ? current : null;

    const checkpoints = [price1h, price4h, price1d, price5d, price30d].filter((v) => Number.isFinite(v));
    const maxPrice = checkpoints.length ? Math.max(...checkpoints) : current;
    const maxMovePercent = entry > 0 ? ((maxPrice - entry) / entry) * 100 : 0;

    await queryWithTimeout(
      `INSERT INTO early_signal_outcomes (
         signal_id,
         symbol,
         entry_price,
         price_1h,
         price_4h,
         price_1d,
         price_5d,
         price_30d,
         max_move_percent,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (signal_id)
       DO UPDATE SET
         symbol = EXCLUDED.symbol,
         entry_price = EXCLUDED.entry_price,
         price_1h = COALESCE(EXCLUDED.price_1h, early_signal_outcomes.price_1h),
         price_4h = COALESCE(EXCLUDED.price_4h, early_signal_outcomes.price_4h),
         price_1d = COALESCE(EXCLUDED.price_1d, early_signal_outcomes.price_1d),
         price_5d = COALESCE(EXCLUDED.price_5d, early_signal_outcomes.price_5d),
         price_30d = COALESCE(EXCLUDED.price_30d, early_signal_outcomes.price_30d),
         max_move_percent = GREATEST(COALESCE(early_signal_outcomes.max_move_percent, -1000000), EXCLUDED.max_move_percent),
         updated_at = NOW()`,
      [
        row.signal_id,
        row.symbol,
        entry,
        price1h,
        price4h,
        price1d,
        price5d,
        price30d,
        maxMovePercent,
      ],
      { timeoutMs: 8000, label: 'engines.early_outcomes.upsert_outcome', maxRetries: 0 }
    );

    tracked += 1;
  }

  const result = { tracked };
  logger.info('[EARLY_SIGNAL_OUTCOME] run complete', result);
  return result;
}

module.exports = {
  runEarlySignalOutcomeEngine,
  ensureEarlySignalOutcomesTable,
};
