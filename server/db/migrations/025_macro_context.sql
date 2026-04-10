-- Migration 025: Macro context tables + outlook column on opportunity_stream

-- Upcoming macro events (CPI, FED, NFP, etc.)
CREATE TABLE IF NOT EXISTS macro_events (
  id             BIGSERIAL   PRIMARY KEY,
  event_type     TEXT        NOT NULL,
  event_date     DATE        NOT NULL,
  expected_value NUMERIC,
  previous_value NUMERIC,
  importance     TEXT        NOT NULL DEFAULT 'MED' CHECK (importance IN ('HIGH','MED','LOW')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT macro_events_unique UNIQUE (event_type, event_date)
);

CREATE INDEX IF NOT EXISTS idx_macro_events_date
  ON macro_events (event_date ASC);

CREATE INDEX IF NOT EXISTS idx_macro_events_importance
  ON macro_events (importance, event_date ASC);

-- Historical per-symbol reactions to macro event types
CREATE TABLE IF NOT EXISTS macro_reactions (
  symbol      TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  avg_move_pct NUMERIC,
  sample_size  INT     NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, event_type)
);

CREATE INDEX IF NOT EXISTS idx_macro_reactions_symbol
  ON macro_reactions (symbol);

-- Add outlook to opportunity_stream narrative output
ALTER TABLE opportunity_stream
  ADD COLUMN IF NOT EXISTS outlook TEXT;
