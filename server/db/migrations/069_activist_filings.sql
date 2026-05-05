CREATE TABLE IF NOT EXISTS activist_filings (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  cik TEXT NOT NULL,
  filing_date DATE NOT NULL,
  accepted_date TIMESTAMPTZ,
  reporting_person TEXT NOT NULL,
  citizenship_or_organization TEXT,
  type_of_reporting_person TEXT,
  form_type TEXT NOT NULL,
  is_active BOOLEAN GENERATED ALWAYS AS (form_type LIKE 'SC 13D%') STORED,
  amount_beneficially_owned NUMERIC,
  percent_of_class NUMERIC,
  sole_voting_power NUMERIC,
  shared_voting_power NUMERIC,
  sole_dispositive_power NUMERIC,
  shared_dispositive_power NUMERIC,
  sec_filing_url TEXT,
  cusip TEXT,
  raw_payload JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, cik, filing_date, form_type)
);

CREATE INDEX IF NOT EXISTS activist_filings_symbol_filing_date_idx
  ON activist_filings (symbol, filing_date DESC);

CREATE INDEX IF NOT EXISTS activist_filings_filing_date_is_active_idx
  ON activist_filings (filing_date DESC, is_active);

CREATE INDEX IF NOT EXISTS activist_filings_cik_filing_date_idx
  ON activist_filings (cik, filing_date DESC);