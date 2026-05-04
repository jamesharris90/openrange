ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS float_shares BIGINT,
  ADD COLUMN IF NOT EXISTS free_float_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS float_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_company_profiles_float_updated_at
  ON company_profiles (float_updated_at DESC NULLS LAST);
