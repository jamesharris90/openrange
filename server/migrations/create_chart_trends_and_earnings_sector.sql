CREATE TABLE IF NOT EXISTS chart_trends (
  symbol TEXT PRIMARY KEY,
  trend TEXT,
  support JSONB,
  resistance JSONB,
  channel JSONB,
  breakouts JSONB,
  computed_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE earnings_events
  ADD COLUMN IF NOT EXISTS sector TEXT;
