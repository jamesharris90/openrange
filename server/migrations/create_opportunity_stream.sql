CREATE TABLE IF NOT EXISTS opportunity_stream (
  id SERIAL PRIMARY KEY,
  symbol TEXT,
  event_type TEXT,
  headline TEXT,
  score NUMERIC,
  source TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_time
ON opportunity_stream(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stream_symbol
ON opportunity_stream(symbol);
