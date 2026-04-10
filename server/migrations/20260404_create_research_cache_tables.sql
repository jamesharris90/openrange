CREATE TABLE IF NOT EXISTS public.research_snapshots (
  symbol TEXT PRIMARY KEY,
  price NUMERIC,
  change_percent NUMERIC,
  sector TEXT,
  industry TEXT,
  exchange TEXT,
  country TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_snapshots_updated_at
  ON public.research_snapshots (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.fundamentals_snapshot (
  symbol TEXT PRIMARY KEY,
  revenue_growth NUMERIC,
  eps_growth NUMERIC,
  gross_margin NUMERIC,
  net_margin NUMERIC,
  free_cash_flow NUMERIC,
  debt_to_equity NUMERIC,
  dcf_value NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fundamentals_snapshot_updated_at
  ON public.fundamentals_snapshot (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ownership_snapshot (
  symbol TEXT PRIMARY KEY,
  institutional_ownership_percent NUMERIC,
  insider_trend TEXT,
  etf_exposure NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ownership_snapshot_updated_at
  ON public.ownership_snapshot (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.earnings_snapshot (
  symbol TEXT PRIMARY KEY,
  next_earnings_date DATE,
  eps_estimate NUMERIC,
  expected_move_percent NUMERIC,
  last_surprise_percent NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earnings_snapshot_updated_at
  ON public.earnings_snapshot (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.macro_snapshot (
  id TEXT PRIMARY KEY,
  spy_trend TEXT,
  qqq_trend TEXT,
  vix_level NUMERIC,
  sector_strength_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_macro_snapshot_updated_at
  ON public.macro_snapshot (updated_at DESC);
