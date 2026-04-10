-- Migration 032: Performance indexes for opportunity_stream
-- The top-focus endpoint queries source='mcp_narrative_engine' + updated_at DESC.
-- Without this index the DISTINCT ON + WHERE requires a full table scan.

CREATE INDEX IF NOT EXISTS idx_opportunity_stream_source_updated
  ON opportunity_stream (source, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunity_stream_symbol_updated
  ON opportunity_stream (symbol, updated_at DESC);
