CREATE TABLE IF NOT EXISTS market_metrics (
    symbol TEXT PRIMARY KEY,
    price NUMERIC,
    gap_percent NUMERIC,
    relative_volume NUMERIC,
    atr NUMERIC,
    rsi NUMERIC,
    vwap NUMERIC,
    float_rotation NUMERIC,
    last_updated TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_gap
ON market_metrics(gap_percent);

CREATE INDEX IF NOT EXISTS idx_metrics_rvol
ON market_metrics(relative_volume);

CREATE INDEX IF NOT EXISTS idx_metrics_atr
ON market_metrics(atr);
