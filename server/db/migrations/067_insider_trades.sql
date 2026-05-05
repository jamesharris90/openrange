CREATE TABLE IF NOT EXISTS insider_trades (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  filing_date DATE NOT NULL,
  transaction_date DATE NOT NULL,
  reporting_cik TEXT,
  reporting_name TEXT NOT NULL,
  type_of_owner TEXT,
  transaction_type TEXT NOT NULL,
  acquisition_or_disposition CHAR(1),
  form_type TEXT,
  securities_transacted NUMERIC,
  securities_owned NUMERIC,
  price NUMERIC,
  total_value NUMERIC,
  security_name TEXT,
  sec_filing_url TEXT,
  raw_payload JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, reporting_cik, transaction_date, transaction_type, securities_transacted)
);

CREATE INDEX IF NOT EXISTS insider_trades_symbol_transaction_date_idx
  ON insider_trades (symbol, transaction_date DESC);

CREATE INDEX IF NOT EXISTS insider_trades_transaction_date_idx
  ON insider_trades (transaction_date DESC);

CREATE INDEX IF NOT EXISTS insider_trades_reporting_cik_transaction_date_idx
  ON insider_trades (reporting_cik, transaction_date DESC);