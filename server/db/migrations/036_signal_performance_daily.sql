-- 036_signal_performance_daily.sql
-- Daily aggregated signal performance for the self-learning loop.
-- One row per calendar day, updated hourly by signalEvaluationEngine.

CREATE TABLE IF NOT EXISTS signal_performance_daily (
  id            BIGSERIAL   PRIMARY KEY,
  date          DATE        NOT NULL UNIQUE,
  total_signals INT         NOT NULL DEFAULT 0,
  wins          INT         NOT NULL DEFAULT 0,
  losses        INT         NOT NULL DEFAULT 0,
  win_rate      NUMERIC,
  avg_return    NUMERIC,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_perf_daily_date
  ON signal_performance_daily (date DESC);
