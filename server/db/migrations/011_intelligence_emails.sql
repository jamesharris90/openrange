-- Intelligence email ingestion store
CREATE TABLE IF NOT EXISTS intelligence_emails (
  id          BIGSERIAL    PRIMARY KEY,
  sender      TEXT,
  subject     TEXT,
  received_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  raw_text    TEXT,
  raw_html    TEXT,
  source_tag  TEXT         NOT NULL DEFAULT 'general',
  processed   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intel_emails_received ON intelligence_emails (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_emails_source   ON intelligence_emails (source_tag);
CREATE INDEX IF NOT EXISTS idx_intel_emails_processed ON intelligence_emails (processed) WHERE processed = FALSE;
