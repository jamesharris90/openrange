-- Migration 027: News enrichment columns + normalized_news view
-- Adds source_type, detected_symbols, priority_score to news_articles.
-- Populated by newsEnrichmentEngine.js (runs every 10 min).

ALTER TABLE news_articles
  ADD COLUMN IF NOT EXISTS source_type       TEXT,
  ADD COLUMN IF NOT EXISTS detected_symbols  TEXT[],
  ADD COLUMN IF NOT EXISTS priority_score    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS catalyst_cluster  TEXT;

-- Fast queries: "high-quality recent news for symbol"
CREATE INDEX IF NOT EXISTS idx_news_priority_published
  ON news_articles (priority_score DESC, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_detected_symbols
  ON news_articles USING GIN (detected_symbols);

-- Unified view — exposes enriched columns with sensible defaults
CREATE OR REPLACE VIEW normalized_news AS
SELECT
  id,
  COALESCE(NULLIF(symbol, ''), detected_symbols[1])  AS symbol,
  COALESCE(detected_symbols, symbols)                AS detected_symbols,
  symbols,
  headline,
  source,
  published_at,
  created_at                                         AS ingested_at,
  COALESCE(priority_score, 0)                        AS priority_score,
  COALESCE(source_type, 'OTHER')                     AS source_type,
  catalyst_cluster,
  provider,
  catalyst_type,
  sentiment,
  summary,
  news_score
FROM news_articles
WHERE published_at IS NOT NULL;
