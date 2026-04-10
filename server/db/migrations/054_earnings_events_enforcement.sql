BEGIN;

ALTER TABLE earnings_events
  ADD COLUMN IF NOT EXISTS revenue_estimate NUMERIC,
  ADD COLUMN IF NOT EXISTS revenue_actual NUMERIC,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'fmp_stable_earnings_calendar',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE earnings_events
SET revenue_estimate = COALESCE(revenue_estimate, rev_estimate),
    revenue_actual = COALESCE(revenue_actual, rev_actual),
    rev_estimate = COALESCE(rev_estimate, revenue_estimate),
    rev_actual = COALESCE(rev_actual, revenue_actual),
    report_time = COALESCE(NULLIF(BTRIM(report_time), ''), 'TBD'),
    source = COALESCE(NULLIF(BTRIM(source), ''), 'fmp_stable_earnings_calendar'),
    updated_at = COALESCE(updated_at, NOW());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'earnings_events_symbol_report_date_key'
      AND conrelid = 'earnings_events'::regclass
  ) THEN
    ALTER TABLE earnings_events
      ADD CONSTRAINT earnings_events_symbol_report_date_key
      UNIQUE (symbol, report_date);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_earnings_events_symbol_date
  ON earnings_events (symbol, report_date ASC);

COMMIT;