CREATE TABLE IF NOT EXISTS early_signals (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  signal_strength NUMERIC,
  first_seen TIMESTAMP NOT NULL DEFAULT DATE_TRUNC('minute', NOW() AT TIME ZONE 'UTC'),
  price_at_signal NUMERIC,
  volume_at_signal NUMERIC
);

ALTER TABLE early_signals
  ALTER COLUMN first_seen TYPE TIMESTAMP
  USING DATE_TRUNC('minute', first_seen AT TIME ZONE 'UTC');

ALTER TABLE early_signals
  ALTER COLUMN first_seen SET DEFAULT DATE_TRUNC('minute', NOW() AT TIME ZONE 'UTC');

CREATE UNIQUE INDEX IF NOT EXISTS early_signal_unique
ON early_signals (symbol, signal_type, first_seen);

CREATE INDEX IF NOT EXISTS idx_early_signals_symbol_first_seen
ON early_signals (symbol, first_seen DESC);
