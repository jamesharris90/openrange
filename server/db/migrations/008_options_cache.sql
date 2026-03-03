BEGIN;

CREATE TABLE IF NOT EXISTS options_cache (
  symbol TEXT NOT NULL,
  expiration INTEGER NOT NULL,
  atm_iv REAL,
  expected_move_pct REAL,
  expected_move_dollar REAL,
  days_to_expiry REAL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(symbol, expiration)
);

CREATE INDEX IF NOT EXISTS idx_options_cache_symbol_fetched_at
  ON options_cache (symbol, fetched_at DESC);

COMMIT;