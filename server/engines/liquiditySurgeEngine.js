const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureSignalEngineMetricsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS signal_engine_metrics (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      engine TEXT NOT NULL,
      metric_value NUMERIC NOT NULL DEFAULT 0,
      score_contribution NUMERIC NOT NULL DEFAULT 0,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(symbol, engine)
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.liquidity_surge.ensure_metrics_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    "ALTER TABLE signal_engine_metrics ADD COLUMN IF NOT EXISTS engine TEXT",
    [],
    { timeoutMs: 7000, label: 'engines.liquidity_surge.ensure_engine_column', maxRetries: 0 }
  );

  await queryWithTimeout(
    "ALTER TABLE signal_engine_metrics ADD COLUMN IF NOT EXISTS metric_value NUMERIC NOT NULL DEFAULT 0",
    [],
    { timeoutMs: 7000, label: 'engines.liquidity_surge.ensure_metric_value_column', maxRetries: 0 }
  );

  await queryWithTimeout(
    "ALTER TABLE signal_engine_metrics ADD COLUMN IF NOT EXISTS score_contribution NUMERIC NOT NULL DEFAULT 0",
    [],
    { timeoutMs: 7000, label: 'engines.liquidity_surge.ensure_score_contribution_column', maxRetries: 0 }
  );

  await queryWithTimeout(
    "ALTER TABLE signal_engine_metrics ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb",
    [],
    { timeoutMs: 7000, label: 'engines.liquidity_surge.ensure_payload_column', maxRetries: 0 }
  );

  await queryWithTimeout(
    "ALTER TABLE signal_engine_metrics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    [],
    { timeoutMs: 7000, label: 'engines.liquidity_surge.ensure_updated_at_column', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE UNIQUE INDEX IF NOT EXISTS signal_engine_metrics_symbol_engine_idx
     ON signal_engine_metrics (symbol, engine)`,
    [],
    { timeoutMs: 7000, label: 'engines.liquidity_surge.ensure_symbol_engine_index', maxRetries: 0 }
  );
}

function computeLiquiditySurge(row = {}) {
  const volume = toNumber(row.volume);
  const avgVolume30d = toNumber(row.avg_volume_30d);
  const liquiditySurge = avgVolume30d > 0 ? (volume / avgVolume30d) : 0;
  const scoreContribution = liquiditySurge > 4 ? Math.min(10, liquiditySurge * 2) : 0;

  return {
    liquidity_surge: liquiditySurge,
    score_contribution: scoreContribution,
  };
}

async function runLiquiditySurgeEngine(row = {}) {
  await ensureSignalEngineMetricsTable();

  const symbol = String(row.symbol || '').toUpperCase();
  if (!symbol) {
    return { liquidity_surge: 0, score_contribution: 0 };
  }

  const metric = computeLiquiditySurge(row);

  await queryWithTimeout(
    `INSERT INTO signal_engine_metrics (
       symbol,
       engine,
       metric_value,
       score_contribution,
       payload,
       updated_at
     ) VALUES ($1, 'liquidity_surge', $2, $3, $4::jsonb, NOW())
     ON CONFLICT (symbol, engine)
     DO UPDATE SET
       metric_value = EXCLUDED.metric_value,
       score_contribution = EXCLUDED.score_contribution,
       payload = EXCLUDED.payload,
       updated_at = NOW()`,
    [
      symbol,
      metric.liquidity_surge,
      metric.score_contribution,
      JSON.stringify({ threshold: 4, strong: metric.liquidity_surge > 4 }),
    ],
    { timeoutMs: 7000, label: 'engines.liquidity_surge.upsert_metric', maxRetries: 0 }
  );

  return metric;
}

module.exports = {
  runLiquiditySurgeEngine,
  computeLiquiditySurge,
};
