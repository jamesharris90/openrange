-- G2a-baseline: immutable pick-time price and volume baselines for Beacon v0 picks.
-- Existing rows are backfilled from metadata.signal_evidence where possible.

ALTER TABLE beacon_v0_picks
  ADD COLUMN IF NOT EXISTS pick_price numeric,
  ADD COLUMN IF NOT EXISTS pick_volume_baseline numeric,
  ADD COLUMN IF NOT EXISTS baseline_source text;

WITH extracted AS (
  SELECT
    p.id,
    price_values.value::numeric AS extracted_price,
    volume_values.value::numeric AS extracted_volume_baseline
  FROM beacon_v0_picks p
  LEFT JOIN LATERAL (
    SELECT value
    FROM jsonb_array_elements(COALESCE(p.metadata->'signal_evidence', '[]'::jsonb)) AS evidence(item)
    CROSS JOIN LATERAL (
      VALUES
        (evidence.item->'metadata'->>'price'),
        (evidence.item->'metadata'->>'latest_close'),
        (evidence.item->'metadata'->>'close')
    ) AS candidate(value)
    WHERE candidate.value ~ '^-?[0-9]+(\.[0-9]+)?$'
    LIMIT 1
  ) price_values ON true
  LEFT JOIN LATERAL (
    SELECT value
    FROM jsonb_array_elements(COALESCE(p.metadata->'signal_evidence', '[]'::jsonb)) AS evidence(item)
    CROSS JOIN LATERAL (
      VALUES
        (evidence.item->'metadata'->>'avg_volume_20d'),
        (evidence.item->'metadata'->>'average_volume'),
        (evidence.item->'metadata'->>'vol_20d'),
        (evidence.item->'metadata'->>'avg_volume_30d')
    ) AS candidate(value)
    WHERE candidate.value ~ '^-?[0-9]+(\.[0-9]+)?$'
    LIMIT 1
  ) volume_values ON true
)
UPDATE beacon_v0_picks p
SET
  pick_price = COALESCE(p.pick_price, extracted.extracted_price),
  pick_volume_baseline = COALESCE(p.pick_volume_baseline, extracted.extracted_volume_baseline),
  baseline_source = CASE
    WHEN p.baseline_source IS NOT NULL THEN p.baseline_source
    WHEN extracted.extracted_price IS NOT NULL THEN 'metadata_backfill'
    ELSE 'unavailable'
  END
FROM extracted
WHERE p.id = extracted.id
  AND (p.pick_price IS NULL OR p.pick_volume_baseline IS NULL OR p.baseline_source IS NULL);

UPDATE beacon_v0_picks
SET baseline_source = 'unavailable'
WHERE baseline_source IS NULL;

ALTER TABLE beacon_v0_picks
  ALTER COLUMN baseline_source SET DEFAULT 'unavailable',
  ALTER COLUMN baseline_source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'beacon_v0_picks_baseline_source_check'
  ) THEN
    ALTER TABLE beacon_v0_picks
      ADD CONSTRAINT beacon_v0_picks_baseline_source_check
      CHECK (baseline_source IN ('generation', 'metadata_backfill', 'unavailable'));
  END IF;
END $$;
