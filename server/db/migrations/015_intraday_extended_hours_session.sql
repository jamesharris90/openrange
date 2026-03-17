ALTER TABLE intraday_1m
ADD COLUMN IF NOT EXISTS session TEXT DEFAULT 'regular';

CREATE INDEX IF NOT EXISTS idx_intraday_session_symbol_time
ON intraday_1m(symbol, session, "timestamp");
