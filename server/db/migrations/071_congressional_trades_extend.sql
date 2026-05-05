ALTER TABLE congressional_trades
  DROP CONSTRAINT IF EXISTS congressional_trades_chamber_check;

UPDATE congressional_trades
SET chamber = CASE
  WHEN chamber ILIKE 'senate' THEN 'Senate'
  WHEN chamber ILIKE 'house' THEN 'House'
  ELSE chamber
END
WHERE chamber IS NOT NULL
  AND chamber NOT IN ('Senate', 'House');

ALTER TABLE congressional_trades
  ADD CONSTRAINT congressional_trades_chamber_check CHECK (chamber IN ('Senate', 'House'));

ALTER TABLE congressional_trades
  ADD COLUMN IF NOT EXISTS member_first_name TEXT,
  ADD COLUMN IF NOT EXISTS member_last_name TEXT,
  ADD COLUMN IF NOT EXISTS member_office TEXT,
  ADD COLUMN IF NOT EXISTS member_district TEXT,
  ADD COLUMN IF NOT EXISTS owner_type TEXT,
  ADD COLUMN IF NOT EXISTS has_capital_gains_over_200_usd BOOLEAN,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS filing_url TEXT,
  ADD COLUMN IF NOT EXISTS amount_min_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS amount_max_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB,
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ DEFAULT NOW();

UPDATE congressional_trades
SET member_first_name = COALESCE(member_first_name, first_name),
    member_last_name = COALESCE(member_last_name, last_name),
    member_office = COALESCE(member_office, office),
    member_district = COALESCE(member_district, district),
    owner_type = COALESCE(owner_type, owner, 'Self'),
    has_capital_gains_over_200_usd = COALESCE(has_capital_gains_over_200_usd, capital_gains_over_200),
    notes = COALESCE(notes, comment),
    filing_url = COALESCE(filing_url, source_link),
    amount_min_usd = COALESCE(amount_min_usd, amount_min),
    amount_max_usd = COALESCE(amount_max_usd, amount_max),
    ingested_at = COALESCE(ingested_at, fetched_at, NOW())
WHERE member_first_name IS NULL
   OR member_last_name IS NULL
   OR member_office IS NULL
   OR member_district IS NULL
   OR owner_type IS NULL
   OR has_capital_gains_over_200_usd IS NULL
   OR notes IS NULL
   OR filing_url IS NULL
   OR amount_min_usd IS NULL
   OR amount_max_usd IS NULL
   OR ingested_at IS NULL;

ALTER TABLE congressional_trades
  DROP COLUMN IF EXISTS full_member_name;

ALTER TABLE congressional_trades
  ADD COLUMN full_member_name TEXT GENERATED ALWAYS AS (
    NULLIF(BTRIM(COALESCE(member_first_name, first_name, '') || ' ' || COALESCE(member_last_name, last_name, '')), '')
  ) STORED;

CREATE INDEX IF NOT EXISTS congressional_trades_symbol_transaction_date_desc_idx
  ON congressional_trades (symbol, transaction_date DESC);

CREATE INDEX IF NOT EXISTS congressional_trades_transaction_date_chamber_desc_idx
  ON congressional_trades (transaction_date DESC, chamber);

CREATE INDEX IF NOT EXISTS congressional_trades_full_member_name_transaction_date_desc_idx
  ON congressional_trades (full_member_name, transaction_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS congressional_trades_symbol_member_transaction_type_amount_key
  ON congressional_trades (symbol, full_member_name, transaction_date, transaction_type, amount_range);