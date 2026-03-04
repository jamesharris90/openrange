CREATE TABLE IF NOT EXISTS discovered_symbols (
    symbol TEXT PRIMARY KEY,
    source TEXT,
    score NUMERIC,
    detected_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovered_source
ON discovered_symbols(source);
