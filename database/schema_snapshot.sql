-- ============================================================
-- OPENRANGE CALIBRATION SCHEMA SNAPSHOT
-- Source: production Supabase (Postgres)
-- Authority: This file is the canonical reference for all
--            calibration-related tables and views.
-- Updated: manually kept in sync with migrations/
-- ============================================================

-- ============================================================
-- TABLES
-- ============================================================

-- signal_registry
-- Every trading signal detected by the Radar Engine is
-- written here before outcome evaluation.
CREATE TABLE IF NOT EXISTS signal_registry (
  id            BIGSERIAL PRIMARY KEY,
  symbol        TEXT        NOT NULL,
  strategy      TEXT        NOT NULL,   -- 'VWAP Reclaim' | 'ORB' | 'Momentum Continuation'
  setup_type    TEXT,
  signal_score  NUMERIC(5,2),
  entry_price   NUMERIC(12,4),
  entry_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- signal_calibration_log
-- Extended record written by signalCalibrationEngine.js.
-- Price fields are backfilled by calibrationPriceUpdater.js
-- every 30 minutes.  Outcome (success) is resolved by
-- signalOutcomeEngine.js via evaluate_signal_outcomes().
CREATE TABLE IF NOT EXISTS signal_calibration_log (
  id             BIGSERIAL PRIMARY KEY,
  symbol         TEXT        NOT NULL,
  strategy       TEXT        NOT NULL,
  setup_grade    TEXT,                   -- A | B | C
  signal_score   NUMERIC(5,2),
  entry_price    NUMERIC(12,4),
  entry_time     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 1-hour window
  high_1h        NUMERIC(12,4),
  low_1h         NUMERIC(12,4),
  close_1h       NUMERIC(12,4),

  -- 4-hour window
  high_4h        NUMERIC(12,4),
  low_4h         NUMERIC(12,4),
  close_4h       NUMERIC(12,4),

  -- 1-day window
  high_1d        NUMERIC(12,4),
  low_1d         NUMERIC(12,4),
  close_1d       NUMERIC(12,4),

  -- Derived metrics (set by calibrationPriceUpdater.js)
  max_move_percent  NUMERIC(8,4),
  min_move_percent  NUMERIC(8,4),
  success           BOOLEAN,            -- NULL = not yet evaluated

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- signal_outcomes
-- One-to-one record created by evaluate_signal_outcomes()
-- after each 15-minute outcome cycle.
CREATE TABLE IF NOT EXISTS signal_outcomes (
  id          BIGSERIAL PRIMARY KEY,
  signal_id   BIGINT REFERENCES signal_registry(id) ON DELETE CASCADE,
  outcome     TEXT,            -- 'win' | 'loss' | 'breakeven'
  pnl_pct     NUMERIC(8,4),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- VIEWS
-- ============================================================

-- strategy_performance_summary
-- Used by: GET /api/calibration/performance
--          GET /api/calibration/strategy-performance
CREATE VIEW strategy_performance_summary AS
  SELECT
    strategy,
    COUNT(*)                                                    AS total_signals,
    COUNT(*) FILTER (WHERE success = TRUE)                      AS wins,
    COUNT(*) FILTER (WHERE success = FALSE)                     AS losses,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE success = TRUE)
      / NULLIF(COUNT(*) FILTER (WHERE success IS NOT NULL), 0),
      2
    )                                                           AS win_rate_pct,
    ROUND(AVG(max_move_percent), 2)                             AS avg_move_pct,
    ROUND(AVG(min_move_percent), 2)                             AS avg_drawdown_pct,
    MAX(entry_time)                                             AS last_signal_at
  FROM signal_calibration_log
  GROUP BY strategy;

-- radar_top_trades
-- Used by: GET /api/calibration/top-signals
CREATE VIEW radar_top_trades AS
  SELECT
    symbol,
    score,
    trade_plan,
    entry_zone_low,
    entry_zone_high,
    target_1,
    stop_loss,
    generated_at
  FROM radar_market_summary
  WHERE score IS NOT NULL
  ORDER BY score DESC
  LIMIT 20;

-- signal_grade_distribution
-- Used by: GET /api/calibration/grade-distribution
CREATE VIEW signal_grade_distribution AS
  SELECT
    setup_grade,
    COUNT(*)                                                     AS total,
    COUNT(*) FILTER (WHERE success = TRUE)                       AS wins,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE success = TRUE)
      / NULLIF(COUNT(*) FILTER (WHERE success IS NOT NULL), 0),
      2
    )                                                            AS win_rate_pct
  FROM signal_calibration_log
  WHERE setup_grade IS NOT NULL
  GROUP BY setup_grade
  ORDER BY setup_grade;

-- calibration_health
-- Used by: GET /api/calibration/health
CREATE VIEW calibration_health AS
  SELECT
    COUNT(*)                                                         AS total_logged,
    COUNT(*) FILTER (WHERE success IS NOT NULL)                      AS evaluated,
    COUNT(*) FILTER (WHERE success IS NULL)                          AS pending_evaluation,
    COUNT(*) FILTER (WHERE success = TRUE)                           AS total_wins,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE success = TRUE)
      / NULLIF(COUNT(*) FILTER (WHERE success IS NOT NULL), 0),
      2
    )                                                                AS overall_win_rate_pct,
    MAX(entry_time)                                                  AS last_signal_at,
    COUNT(DISTINCT strategy)                                         AS strategy_count,
    COUNT(DISTINCT symbol)                                           AS symbol_count
  FROM signal_calibration_log;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_signal_calibration_log_strategy
  ON signal_calibration_log (strategy);

CREATE INDEX IF NOT EXISTS idx_signal_calibration_log_entry_time
  ON signal_calibration_log (entry_time DESC);

CREATE INDEX IF NOT EXISTS idx_signal_calibration_log_success
  ON signal_calibration_log (success)
  WHERE success IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_signal_id
  ON signal_outcomes (signal_id);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- evaluate_signal_outcomes()
-- Called by signalOutcomeEngine.js every 15 minutes.
-- Marks signal_calibration_log.success based on whether
-- close_1d exceeded entry_price by a profitable threshold.
CREATE OR REPLACE FUNCTION evaluate_signal_outcomes()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE signal_calibration_log
  SET    success = (close_1d > entry_price * 1.005)
  WHERE  close_1d IS NOT NULL
    AND  success IS NULL;
END;
$$;
