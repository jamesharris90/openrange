-- Migration 028: Add consequence column to opportunity_stream
-- Populated by mcpNarrativeEngine — holds the trade bias decision line

ALTER TABLE opportunity_stream
  ADD COLUMN IF NOT EXISTS consequence TEXT;
