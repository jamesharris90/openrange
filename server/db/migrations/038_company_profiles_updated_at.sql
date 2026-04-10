ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE company_profiles
SET updated_at = NOW()
WHERE updated_at IS NULL;