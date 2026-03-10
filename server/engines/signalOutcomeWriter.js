const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

let ensureSchemaPromise = null;

async function ensureSignalComponentOutcomesTable() {
  if (ensureSchemaPromise) {
    return ensureSchemaPromise;
  }

  ensureSchemaPromise = (async () => {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS signal_component_outcomes (
      id BIGSERIAL PRIMARY KEY,
      snapshot_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      snapshot_day DATE NOT NULL DEFAULT CURRENT_DATE,
      symbol TEXT NOT NULL,
      score NUMERIC,
      gap_percent NUMERIC,
      rvol NUMERIC,
      float_rotation NUMERIC,
      liquidity_surge NUMERIC,
      catalyst_score NUMERIC,
      sector_score NUMERIC,
      confirmation_score NUMERIC,
      move_percent NUMERIC,
      success BOOLEAN,
      outcome_updated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 8000, label: 'outcome_writer.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_component_outcomes ADD COLUMN IF NOT EXISTS snapshot_day DATE NOT NULL DEFAULT CURRENT_DATE',
    [],
    { timeoutMs: 8000, label: 'outcome_writer.ensure_snapshot_day', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_component_outcomes ADD COLUMN IF NOT EXISTS move_percent NUMERIC',
    [],
    { timeoutMs: 8000, label: 'outcome_writer.ensure_move_percent', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_component_outcomes ADD COLUMN IF NOT EXISTS success BOOLEAN',
    [],
    { timeoutMs: 8000, label: 'outcome_writer.ensure_success', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_component_outcomes ADD COLUMN IF NOT EXISTS outcome_updated_at TIMESTAMPTZ',
    [],
    { timeoutMs: 8000, label: 'outcome_writer.ensure_outcome_updated_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_component_outcomes_symbol_day
     ON signal_component_outcomes (symbol, snapshot_day)`,
    [],
    { timeoutMs: 8000, label: 'outcome_writer.ensure_symbol_day_unique_idx', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_signal_component_outcomes_pending
     ON signal_component_outcomes (move_percent, snapshot_date DESC)`,
    [],
    { timeoutMs: 8000, label: 'outcome_writer.ensure_pending_idx', maxRetries: 0 }
  );
  })();

  try {
    await ensureSchemaPromise;
  } finally {
    ensureSchemaPromise = null;
  }
}

async function writeSignalOutcome(signal = {}) {
  const symbol = String(signal.symbol || '').toUpperCase().trim();
  if (!symbol) return false;

  await ensureSignalComponentOutcomesTable();

  const { rows } = await queryWithTimeout(
    `SELECT
       score,
       gap_percent,
       rvol,
       float_rotation,
       liquidity_surge,
       catalyst_score,
       sector_score,
       confirmation_score
     FROM trade_signals
     WHERE symbol = $1
     LIMIT 1`,
    [symbol],
    { timeoutMs: 7000, label: 'outcome_writer.select_trade_signal', maxRetries: 0 }
  );

  const fromTradeSignal = rows[0] || {};
  const pickNumeric = (primaryValue, fallbackValue) => {
    const primary = Number(primaryValue);
    if (Number.isFinite(primary)) return primary;
    const fallback = Number(fallbackValue);
    return Number.isFinite(fallback) ? fallback : null;
  };

  const result = await queryWithTimeout(
    `INSERT INTO signal_component_outcomes (
       snapshot_date,
       snapshot_day,
       symbol,
       score,
       gap_percent,
       rvol,
       float_rotation,
       liquidity_surge,
       catalyst_score,
       sector_score,
       confirmation_score,
       created_at
     ) VALUES (
       NOW(),
       CURRENT_DATE,
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9,
       NOW()
     )
     ON CONFLICT (symbol, snapshot_day) DO NOTHING`,
    [
      symbol,
      pickNumeric(signal.score, fromTradeSignal.score),
      pickNumeric(signal.gap_percent, fromTradeSignal.gap_percent),
      pickNumeric(signal.rvol, fromTradeSignal.rvol),
      pickNumeric(signal.float_rotation, fromTradeSignal.float_rotation),
      pickNumeric(signal.liquidity_surge, fromTradeSignal.liquidity_surge),
      pickNumeric(signal.catalyst_score, fromTradeSignal.catalyst_score),
      pickNumeric(signal.sector_score, fromTradeSignal.sector_score),
      pickNumeric(signal.confirmation_score, fromTradeSignal.confirmation_score),
    ],
    { timeoutMs: 8000, label: 'outcome_writer.insert_snapshot', maxRetries: 0 }
  );

  return (result.rowCount || 0) > 0;
}

async function updateSignalOutcomeResults() {
  try {
    await ensureSignalComponentOutcomesTable();

    const { rows } = await queryWithTimeout(
    `SELECT id, symbol
     FROM signal_component_outcomes
     WHERE move_percent IS NULL
     ORDER BY snapshot_date DESC
     LIMIT 500`,
    [],
    { timeoutMs: 10000, label: 'outcome_updater.select_pending', maxRetries: 0 }
  );

    if (!rows.length) {
      logger.info('[OUTCOME_UPDATER] outcomes calculated', { processed: 0, updated: 0 });
      return { processed: 0, updated: 0 };
    }

    let updated = 0;

    for (const row of rows) {
    const symbol = String(row.symbol || '').toUpperCase();

    const quoteRes = await queryWithTimeout(
      `SELECT
         COALESCE(d.open, m.price, 0) AS open_price,
         COALESCE(d.high, m.price, 0) AS high_price
       FROM market_metrics m
       LEFT JOIN LATERAL (
         SELECT open, high
         FROM daily_ohlc d
         WHERE d.symbol = m.symbol
         ORDER BY d.date DESC
         LIMIT 1
       ) d ON TRUE
       WHERE m.symbol = $1
       LIMIT 1`,
      [symbol],
      { timeoutMs: 7000, label: 'outcome_updater.select_prices', maxRetries: 0 }
    );

    const openPrice = toNumber(quoteRes.rows[0]?.open_price);
    const highPrice = toNumber(quoteRes.rows[0]?.high_price, openPrice);

    if (openPrice <= 0) {
      continue;
    }

    const movePercent = ((highPrice - openPrice) / openPrice) * 100;
    const success = movePercent >= 4;

    const updateRes = await queryWithTimeout(
      `UPDATE signal_component_outcomes
       SET move_percent = $1,
           success = $2,
           outcome_updated_at = NOW()
       WHERE id = $3`,
      [
        Number(movePercent.toFixed(6)),
        success,
        row.id,
      ],
      { timeoutMs: 7000, label: 'outcome_updater.update_outcome', maxRetries: 0 }
    );

    if ((updateRes.rowCount || 0) > 0) {
      updated += 1;
    }
  }

    logger.info('[OUTCOME_UPDATER] outcomes calculated', {
      processed: rows.length,
      updated,
    });

    return {
      processed: rows.length,
      updated,
    };
  } catch (error) {
    logger.error('[OUTCOME_UPDATER] run failed', { error: error.message });
    return { processed: 0, updated: 0, error: error.message };
  }
}

module.exports = {
  ensureSignalComponentOutcomesTable,
  writeSignalOutcome,
  updateSignalOutcomeResults,
};
