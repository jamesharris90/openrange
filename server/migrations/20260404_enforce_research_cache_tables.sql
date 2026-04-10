CREATE TABLE IF NOT EXISTS public.company_profiles (
  symbol TEXT PRIMARY KEY,
  company_name TEXT,
  sector TEXT,
  industry TEXT,
  exchange TEXT,
  country TEXT,
  website TEXT,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fundamentals_snapshot (
  symbol TEXT PRIMARY KEY,
  revenue_growth NUMERIC,
  eps_growth NUMERIC,
  gross_margin NUMERIC,
  net_margin NUMERIC,
  free_cash_flow NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.earnings_snapshot (
  symbol TEXT PRIMARY KEY,
  next_earnings_date DATE,
  eps_estimate NUMERIC,
  expected_move_percent NUMERIC,
  last_surprise_percent NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.earnings_snapshot ADD COLUMN IF NOT EXISTS id BIGSERIAL;
ALTER TABLE public.earnings_snapshot ADD COLUMN IF NOT EXISTS report_date DATE;
ALTER TABLE public.earnings_snapshot ADD COLUMN IF NOT EXISTS eps_actual NUMERIC;
ALTER TABLE public.earnings_snapshot ADD COLUMN IF NOT EXISTS actual_move_percent NUMERIC;
ALTER TABLE public.earnings_snapshot ADD COLUMN IF NOT EXISTS beat BOOLEAN;

CREATE TABLE IF NOT EXISTS public.market_narratives (
  id BIGSERIAL PRIMARY KEY,
  regime TEXT,
  narrative TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_narratives_regime_created_at
  ON public.market_narratives (regime, created_at DESC);