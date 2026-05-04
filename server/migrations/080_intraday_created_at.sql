ALTER TABLE intraday_1m
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS intraday_1m_created_at_idx
ON intraday_1m (created_at);