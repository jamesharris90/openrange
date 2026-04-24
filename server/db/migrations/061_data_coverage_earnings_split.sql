ALTER TABLE public.data_coverage
  ADD COLUMN IF NOT EXISTS has_earnings_history BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.data_coverage
  ADD COLUMN IF NOT EXISTS has_upcoming_earnings BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.data_coverage
SET has_earnings_history = COALESCE(has_earnings_history, false),
    has_upcoming_earnings = COALESCE(has_upcoming_earnings, false),
    has_earnings = COALESCE(has_earnings_history, false) OR COALESCE(has_upcoming_earnings, false) OR COALESCE(has_earnings, false)
WHERE COALESCE(has_earnings_history, false) = false
   OR COALESCE(has_upcoming_earnings, false) = false
   OR has_earnings <> (COALESCE(has_earnings_history, false) OR COALESCE(has_upcoming_earnings, false) OR COALESCE(has_earnings, false));