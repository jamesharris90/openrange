-- Migration 019: Backtest signal tracking

CREATE TABLE IF NOT EXISTS backtest_signals (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT,
  signal_timestamp TIMESTAMP,
  confidence NUMERIC,
  catalyst_type TEXT,
  entry_price NUMERIC,
  max_upside_pct NUMERIC,
  max_drawdown_pct NUMERIC,
  close_price NUMERIC,
  result TEXT,
  evaluated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_signals_symbol_signal_timestamp
  ON backtest_signals (symbol, signal_timestamp);
