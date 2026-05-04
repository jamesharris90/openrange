CREATE TABLE IF NOT EXISTS sec_filings (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  cik TEXT NOT NULL,
  form_type TEXT NOT NULL,
  filing_date TIMESTAMPTZ NOT NULL,
  accepted_date TIMESTAMPTZ NOT NULL,
  has_financials BOOLEAN DEFAULT false,
  filing_link TEXT,
  document_link TEXT,
  catalyst_category TEXT,
  is_offering BOOLEAN DEFAULT false,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw JSONB,
  CONSTRAINT sec_filings_unique UNIQUE (symbol, form_type, accepted_date)
);

CREATE INDEX IF NOT EXISTS sec_filings_symbol_date_idx
  ON sec_filings (symbol, filing_date DESC);

CREATE INDEX IF NOT EXISTS sec_filings_form_type_idx
  ON sec_filings (form_type, filing_date DESC);

CREATE INDEX IF NOT EXISTS sec_filings_offering_idx
  ON sec_filings (filing_date DESC) WHERE is_offering = true;

CREATE INDEX IF NOT EXISTS sec_filings_recent_idx
  ON sec_filings (filing_date DESC);
