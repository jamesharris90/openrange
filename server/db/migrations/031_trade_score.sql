-- Migration 031: Trade score + regime alignment columns
-- Written by mcpNarrativeEngine at signal time; used by top-focus endpoint for pre-sorting.

ALTER TABLE opportunity_stream
  ADD COLUMN IF NOT EXISTS trade_score      NUMERIC,
  ADD COLUMN IF NOT EXISTS regime_alignment TEXT;
