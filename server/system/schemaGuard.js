const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function runQuery(sql, label) {
  await queryWithTimeout(sql, [], {
    timeoutMs: 8000,
    label,
    maxRetries: 0,
  });
}

async function runSchemaGuard() {
  const statements = [
    {
      label: 'schema_guard.trade_signals.ensure_table',
      sql: `CREATE TABLE IF NOT EXISTS trade_signals (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT,
        strategy TEXT,
        score NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    },
    {
      label: 'schema_guard.signal_performance.ensure_table',
      sql: `CREATE TABLE IF NOT EXISTS signal_performance (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT,
        strategy TEXT,
        entry_price NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    },
    {
      label: 'schema_guard.trade_signals.ensure_columns.confidence',
      sql: 'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS confidence TEXT',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_table',
      sql: `CREATE TABLE IF NOT EXISTS daily_signal_snapshot (
        id BIGSERIAL PRIMARY KEY,
        snapshot_date DATE DEFAULT CURRENT_DATE,
        symbol TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    },
    {
      label: 'schema_guard.trade_signals.ensure_columns.score_breakdown',
      sql: "ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb",
    },
    {
      label: 'schema_guard.trade_signals.ensure_columns.narrative',
      sql: 'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS narrative TEXT',
    },
    {
      label: 'schema_guard.trade_signals.ensure_columns.signal_class',
      sql: 'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS signal_class TEXT',
    },
    {
      label: 'schema_guard.trade_signals.ensure_columns.hierarchy_rank',
      sql: 'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS hierarchy_rank NUMERIC',
    },
    {
      label: 'schema_guard.trade_signals.ensure_columns.updated_at',
      sql: 'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
    {
      label: 'schema_guard.trade_signals.ensure_index.symbol',
      sql: 'CREATE INDEX IF NOT EXISTS idx_trade_signals_symbol ON trade_signals (symbol)',
    },
    {
      label: 'schema_guard.trade_signals.ensure_index.score',
      sql: 'CREATE INDEX IF NOT EXISTS idx_trade_signals_score ON trade_signals (score DESC)',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.snapshot_date',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS snapshot_date DATE DEFAULT CURRENT_DATE',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.signal_id',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS signal_id BIGINT',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.strategy',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS strategy TEXT',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.class',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS class TEXT',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.score',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS score NUMERIC',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.probability',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS probability NUMERIC',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.current_price',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS current_price NUMERIC',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.return_percent',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS return_percent NUMERIC',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.max_upside',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS max_upside NUMERIC',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.max_drawdown',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS max_drawdown NUMERIC',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.outcome',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS outcome TEXT',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.evaluated_at',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
    {
      label: 'schema_guard.signal_performance.ensure_columns.updated_at',
      sql: 'ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
    {
      label: 'schema_guard.signal_performance.ensure_index.symbol',
      sql: 'CREATE INDEX IF NOT EXISTS idx_signal_performance_symbol ON signal_performance (symbol)',
    },
    {
      label: 'schema_guard.signal_performance.ensure_index.snapshot_date',
      sql: 'CREATE INDEX IF NOT EXISTS idx_signal_performance_snapshot_date ON signal_performance (snapshot_date DESC)',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_columns.snapshot_date',
      sql: 'ALTER TABLE daily_signal_snapshot ADD COLUMN IF NOT EXISTS snapshot_date DATE DEFAULT CURRENT_DATE',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_columns.symbol',
      sql: 'ALTER TABLE daily_signal_snapshot ADD COLUMN IF NOT EXISTS symbol TEXT',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_columns.score',
      sql: 'ALTER TABLE daily_signal_snapshot ADD COLUMN IF NOT EXISTS score NUMERIC',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_columns.confidence',
      sql: 'ALTER TABLE daily_signal_snapshot ADD COLUMN IF NOT EXISTS confidence TEXT',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_columns.strategy',
      sql: 'ALTER TABLE daily_signal_snapshot ADD COLUMN IF NOT EXISTS strategy TEXT',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_columns.catalyst',
      sql: 'ALTER TABLE daily_signal_snapshot ADD COLUMN IF NOT EXISTS catalyst TEXT',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_columns.sector',
      sql: 'ALTER TABLE daily_signal_snapshot ADD COLUMN IF NOT EXISTS sector TEXT',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_columns.entry_price',
      sql: 'ALTER TABLE daily_signal_snapshot ADD COLUMN IF NOT EXISTS entry_price NUMERIC',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_columns.created_at',
      sql: 'ALTER TABLE daily_signal_snapshot ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
    {
      label: 'schema_guard.daily_snapshot.ensure_index.symbol_date',
      sql: 'CREATE INDEX IF NOT EXISTS idx_daily_signal_snapshot_symbol_date ON daily_signal_snapshot (snapshot_date DESC, symbol)',
    },
    {
      label: 'schema_guard.dynamic_watchlist.ensure_table',
      sql: `CREATE TABLE IF NOT EXISTS dynamic_watchlist (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL UNIQUE,
        strategy TEXT,
        score NUMERIC,
        confidence TEXT,
        hierarchy_rank NUMERIC,
        score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    },
    {
      label: 'schema_guard.dynamic_watchlist.ensure_hierarchy_rank',
      sql: 'ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS hierarchy_rank NUMERIC',
    },
    {
      label: 'schema_guard.signal_hierarchy.ensure_table',
      sql: `CREATE TABLE IF NOT EXISTS signal_hierarchy (
        symbol TEXT PRIMARY KEY,
        hierarchy_rank NUMERIC NOT NULL DEFAULT 0,
        signal_class TEXT,
        strategy TEXT,
        score NUMERIC,
        confidence TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    },
    {
      label: 'schema_guard.signal_component_outcomes.ensure_table',
      sql: `CREATE TABLE IF NOT EXISTS signal_component_outcomes (
        id BIGSERIAL PRIMARY KEY,
        snapshot_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        snapshot_day DATE NOT NULL DEFAULT CURRENT_DATE,
        symbol TEXT,
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
    },
    {
      label: 'schema_guard.signal_weight_calibration.ensure_table',
      sql: `CREATE TABLE IF NOT EXISTS signal_weight_calibration (
        component TEXT PRIMARY KEY,
        weight NUMERIC NOT NULL,
        success_rate NUMERIC NOT NULL DEFAULT 0,
        avg_move NUMERIC NOT NULL DEFAULT 0,
        signals_analyzed INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    },
    {
      label: 'schema_guard.market_metrics.ensure_table',
      sql: `CREATE TABLE IF NOT EXISTS market_metrics (
        symbol TEXT PRIMARY KEY,
        price NUMERIC,
        close NUMERIC,
        change NUMERIC,
        change_percent NUMERIC,
        gap_percent NUMERIC,
        relative_volume NUMERIC,
        atr_percent NUMERIC,
        avg_volume_30d NUMERIC,
        volume NUMERIC,
        float_shares NUMERIC,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    },
    {
      label: 'schema_guard.market_metrics.ensure_atr_percent',
      sql: 'ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS atr_percent NUMERIC',
    },
    {
      label: 'schema_guard.market_metrics.ensure_float_shares',
      sql: 'ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS float_shares NUMERIC',
    },
  ];

  const results = {
    attempted: 0,
    applied: 0,
    failed: 0,
  };

  for (const stmt of statements) {
    results.attempted += 1;
    try {
      await runQuery(stmt.sql, stmt.label);
      results.applied += 1;
    } catch (error) {
      results.failed += 1;
      logger.warn('[SCHEMA_GUARD] statement failed', {
        label: stmt.label,
        error: error.message,
      });
    }
  }

  logger.info('[SCHEMA_GUARD] complete', results);
  return results;
}

module.exports = {
  runSchemaGuard,
};
