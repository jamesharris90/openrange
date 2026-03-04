CREATE TABLE IF NOT EXISTS trade_setups (
    symbol TEXT PRIMARY KEY,
    setup TEXT,
    grade TEXT,
    score NUMERIC,
    gap_percent NUMERIC,
    relative_volume NUMERIC,
    atr NUMERIC,
    float_rotation NUMERIC,
    detected_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_setup_type
ON trade_setups(setup);

CREATE INDEX IF NOT EXISTS idx_setup_grade
ON trade_setups(grade);
