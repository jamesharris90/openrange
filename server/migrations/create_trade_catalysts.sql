CREATE TABLE IF NOT EXISTS trade_catalysts (
    symbol TEXT,
    catalyst_type TEXT,
    headline TEXT,
    source TEXT,
    sentiment TEXT,
    published_at TIMESTAMP,
    score NUMERIC,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalyst_symbol
ON trade_catalysts(symbol);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalyst_unique
ON trade_catalysts(symbol, headline, published_at, catalyst_type);
