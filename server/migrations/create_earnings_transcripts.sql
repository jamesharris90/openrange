CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS earnings_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  fiscal_year INT NOT NULL,
  fiscal_quarter INT NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
  report_date DATE,
  source TEXT NOT NULL DEFAULT 'fmp',
  transcript_status TEXT NOT NULL DEFAULT 'available',
  transcript_text TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, fiscal_year, fiscal_quarter)
);

CREATE INDEX IF NOT EXISTS idx_earnings_transcripts_symbol_date
  ON earnings_transcripts (symbol, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_earnings_transcripts_status
  ON earnings_transcripts (transcript_status, updated_at DESC);
