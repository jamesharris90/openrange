CREATE TABLE IF NOT EXISTS ticker_universe (
    symbol TEXT PRIMARY KEY,
    company_name TEXT,
    exchange TEXT,
    sector TEXT,
    industry TEXT,
    market_cap BIGINT,
    is_active BOOLEAN DEFAULT TRUE,
    last_updated TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_universe_exchange
ON ticker_universe(exchange);

CREATE INDEX IF NOT EXISTS idx_universe_sector
ON ticker_universe(sector);
