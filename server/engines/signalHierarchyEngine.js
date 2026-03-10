const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function computeHierarchyRank(row = {}) {
  return (
    (toNumber(row.score) * 0.5)
    + (toNumber(row.float_rotation) * 20)
    + (toNumber(row.liquidity_surge) * 10)
    + (toNumber(row.catalyst_score) * 5)
  );
}

function classifySignal(row = {}) {
  const score = toNumber(row.score);
  const rvol = toNumber(row.rvol);
  const gap = toNumber(row.gap_percent);
  const catalystScore = toNumber(row.catalyst_score);

  if (score >= 90 && rvol >= 3 && gap >= 5 && catalystScore >= 10) {
    return 'Tier 1 (A+)';
  }

  if (score >= 80 && rvol >= 2) {
    return 'Tier 2 (A)';
  }

  if (score >= 70) {
    return 'Tier 3 (B)';
  }

  return 'Tier 4 (Monitor)';
}

async function ensureSignalHierarchyTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS signal_hierarchy (
      symbol TEXT PRIMARY KEY,
      hierarchy_rank NUMERIC NOT NULL,
      signal_class TEXT NOT NULL,
      strategy TEXT,
      score NUMERIC,
      confidence TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_signal_hierarchy_rank
     ON signal_hierarchy (hierarchy_rank DESC)`,
    [],
    { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_idx_rank', maxRetries: 0 }
  );

  await queryWithTimeout('ALTER TABLE signal_hierarchy ADD COLUMN IF NOT EXISTS hierarchy_rank NUMERIC NOT NULL DEFAULT 0', [], { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_col_hierarchy_rank', maxRetries: 0 });
  await queryWithTimeout('ALTER TABLE signal_hierarchy ADD COLUMN IF NOT EXISTS symbol TEXT', [], { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_col_symbol', maxRetries: 0 });
  await queryWithTimeout('ALTER TABLE signal_hierarchy ADD COLUMN IF NOT EXISTS signal_class TEXT', [], { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_col_signal_class', maxRetries: 0 });
  await queryWithTimeout('ALTER TABLE signal_hierarchy ADD COLUMN IF NOT EXISTS strategy TEXT', [], { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_col_strategy', maxRetries: 0 });
  await queryWithTimeout('ALTER TABLE signal_hierarchy ADD COLUMN IF NOT EXISTS score NUMERIC', [], { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_col_score', maxRetries: 0 });
  await queryWithTimeout('ALTER TABLE signal_hierarchy ADD COLUMN IF NOT EXISTS confidence TEXT', [], { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_col_confidence', maxRetries: 0 });
  await queryWithTimeout('ALTER TABLE signal_hierarchy ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()', [], { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_col_updated_at', maxRetries: 0 });
  await queryWithTimeout('ALTER TABLE signal_hierarchy ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()', [], { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_col_created_at', maxRetries: 0 });
  await queryWithTimeout('CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_hierarchy_symbol_unique ON signal_hierarchy(symbol)', [], { timeoutMs: 7000, label: 'engines.signal_hierarchy.ensure_idx_symbol_unique', maxRetries: 0 });
}

async function runSignalHierarchyEngine() {
  const startedAt = Date.now();
  try {
    await ensureSignalHierarchyTable();

    const { rows } = await queryWithTimeout(
    `SELECT
       symbol,
       strategy,
       score,
       confidence,
       rvol,
       gap_percent,
       float_rotation,
       liquidity_surge,
       catalyst_score
     FROM trade_signals
     WHERE symbol IS NOT NULL
       AND symbol <> ''
       AND score IS NOT NULL
     ORDER BY score DESC NULLS LAST
     LIMIT 300`,
    [],
    { timeoutMs: 10000, label: 'engines.signal_hierarchy.select_signals', maxRetries: 0 }
  );

    if (!rows.length) {
      const runtimeMs = Date.now() - startedAt;
      logger.info('[SIGNAL_HIERARCHY] run complete', { processed: 0, upserted: 0, runtimeMs });
      return { processed: 0, upserted: 0, runtimeMs };
    }

    const symbols = [];
    const ranks = [];
    const classes = [];
    const strategies = [];
    const scores = [];
    const confidences = [];

    for (const row of rows) {
    symbols.push(String(row.symbol || '').toUpperCase());
    ranks.push(computeHierarchyRank(row));
    classes.push(classifySignal(row));
    strategies.push(row.strategy || null);
    scores.push(toNumber(row.score));
    confidences.push(row.confidence || null);
  }

    const upsertResult = await queryWithTimeout(
    `INSERT INTO signal_hierarchy (
       symbol,
       hierarchy_rank,
       signal_class,
       strategy,
       score,
       confidence,
       updated_at
     )
     SELECT *
     FROM (
       SELECT
         unnest($1::text[]) AS symbol,
         unnest($2::numeric[]) AS hierarchy_rank,
         unnest($3::text[]) AS signal_class,
         unnest($4::text[]) AS strategy,
         unnest($5::numeric[]) AS score,
         unnest($6::text[]) AS confidence,
         NOW() AS updated_at
     ) incoming
     ON CONFLICT (symbol)
     DO UPDATE SET
       hierarchy_rank = EXCLUDED.hierarchy_rank,
       signal_class = EXCLUDED.signal_class,
       strategy = EXCLUDED.strategy,
       score = EXCLUDED.score,
       confidence = EXCLUDED.confidence,
       updated_at = NOW()`,
    [symbols, ranks, classes, strategies, scores, confidences],
    { timeoutMs: 12000, label: 'engines.signal_hierarchy.upsert', maxRetries: 0 }
  );

    const runtimeMs = Date.now() - startedAt;
    logger.info('[SIGNAL_HIERARCHY] run complete', {
      processed: rows.length,
      upserted: upsertResult.rowCount || 0,
      runtimeMs,
    });

    return {
      processed: rows.length,
      upserted: upsertResult.rowCount || 0,
      runtimeMs,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('[SIGNAL_HIERARCHY] run failed', { error: error.message, runtimeMs });
    return { processed: 0, upserted: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  runSignalHierarchyEngine,
  ensureSignalHierarchyTable,
  computeHierarchyRank,
  classifySignal,
};
