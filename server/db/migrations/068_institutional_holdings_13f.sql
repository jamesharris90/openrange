CREATE TABLE IF NOT EXISTS institutional_holdings_13f (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  cik TEXT NOT NULL,
  investor_name TEXT NOT NULL,
  filing_date DATE NOT NULL,
  period_end_date DATE NOT NULL,
  shares_held NUMERIC,
  shares_change NUMERIC,
  shares_change_pct NUMERIC,
  market_value NUMERIC,
  change_in_market_value NUMERIC,
  change_in_market_value_pct NUMERIC,
  weight_pct NUMERIC,
  change_in_weight_pct NUMERIC,
  ownership_pct NUMERIC,
  change_in_ownership_pct NUMERIC,
  is_new_position BOOLEAN DEFAULT FALSE,
  is_sold_out BOOLEAN DEFAULT FALSE,
  holding_period_quarters INT,
  first_added DATE,
  avg_price_paid NUMERIC,
  raw_payload JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, cik, period_end_date)
);

CREATE INDEX IF NOT EXISTS institutional_holdings_13f_symbol_period_end_date_idx
  ON institutional_holdings_13f (symbol, period_end_date DESC);

CREATE INDEX IF NOT EXISTS institutional_holdings_13f_cik_period_end_date_idx
  ON institutional_holdings_13f (cik, period_end_date DESC);

CREATE INDEX IF NOT EXISTS institutional_holdings_13f_period_new_position_idx
  ON institutional_holdings_13f (period_end_date DESC, is_new_position);