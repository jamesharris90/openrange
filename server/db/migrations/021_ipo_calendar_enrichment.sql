-- Migration 021: Add enrichment columns to ipo_calendar
-- sector, industry, description from FMP profile
-- listing_price (single price from quote), cik for prospectus link

ALTER TABLE ipo_calendar
  ADD COLUMN IF NOT EXISTS sector      TEXT,
  ADD COLUMN IF NOT EXISTS industry    TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS listing_price NUMERIC;
