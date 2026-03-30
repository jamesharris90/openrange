-- 035_signal_log.sql
-- Signal log: capture entry for every EARLY/ACTIVE premarket signal.
-- Used by signalEvaluationEngine to measure outcomes.

CREATE TABLE IF NOT EXISTS signal_log (
  id               BIGSERIAL   PRIMARY KEY,
  symbol           TEXT        NOT NULL,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score            NUMERIC,
  stage            TEXT,
  entry_price      NUMERIC,
  expected_move    NUMERIC,
  outcome          TEXT,
  max_upside_pct   NUMERIC,
  max_drawdown_pct NUMERIC,
  evaluated        BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_signal_log_symbol    ON signal_log (symbol);
CREATE INDEX IF NOT EXISTS idx_signal_log_ts        ON signal_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_signal_log_unevaluated
  ON signal_log (evaluated, timestamp) WHERE evaluated = FALSE;
