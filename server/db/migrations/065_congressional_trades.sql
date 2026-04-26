-- Phase C1: Congressional trades ingestion
-- Stores US Senate and House member financial disclosures from FMP

CREATE TABLE IF NOT EXISTS congressional_trades (
  id BIGSERIAL PRIMARY KEY,
  chamber TEXT NOT NULL CHECK (chamber IN ('senate', 'house')),
  symbol TEXT NOT NULL,
  disclosure_date DATE NOT NULL,
  transaction_date DATE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  office TEXT,
  district TEXT,
  owner TEXT,
  asset_description TEXT,
  asset_type TEXT,
  transaction_type TEXT,
  amount_range TEXT,
  amount_min NUMERIC,
  amount_max NUMERIC,
  capital_gains_over_200 BOOLEAN,
  comment TEXT,
  source_link TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT congressional_trades_natural_key UNIQUE (
    chamber, last_name, first_name, symbol, transaction_date,
    transaction_type, amount_range
  )
);

CREATE INDEX IF NOT EXISTS congressional_trades_symbol_idx
  ON congressional_trades (symbol);
CREATE INDEX IF NOT EXISTS congressional_trades_disclosure_date_idx
  ON congressional_trades (disclosure_date DESC);
CREATE INDEX IF NOT EXISTS congressional_trades_transaction_date_idx
  ON congressional_trades (transaction_date DESC);
CREATE INDEX IF NOT EXISTS congressional_trades_member_idx
  ON congressional_trades (last_name, first_name);