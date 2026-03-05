CREATE TABLE IF NOT EXISTS market_narratives (
  id SERIAL PRIMARY KEY,
  narrative TEXT,
  regime TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_narrative_time
ON market_narratives(created_at DESC);
