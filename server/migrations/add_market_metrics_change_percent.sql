ALTER TABLE market_metrics
ADD COLUMN IF NOT EXISTS change_percent NUMERIC;

UPDATE market_metrics
SET change_percent = gap_percent
WHERE change_percent IS NULL
  AND gap_percent IS NOT NULL;
