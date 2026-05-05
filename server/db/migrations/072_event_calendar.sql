CREATE TABLE IF NOT EXISTS event_calendar (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TEXT,
  event_datetime TIMESTAMPTZ,
  symbol TEXT,
  related_symbols TEXT[],
  title TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  importance INT NOT NULL DEFAULT 5,
  confidence TEXT NOT NULL DEFAULT 'confirmed',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (event_type IN (
    'FOMC', 'ECONOMIC_RELEASE', 'EARNINGS', 'IPO', 'IPO_DISCLOSURE', 'IPO_PROSPECTUS',
    'LOCKUP_EXPIRY', 'STOCK_SPLIT', 'PDUFA', 'CLINICAL_TRIAL_READOUT',
    'INDEX_REBALANCE', 'CONFERENCE', 'ELECTION', 'ADVERSE_EVENT_SPIKE',
    'DRUG_RECALL', 'PATENT_EXPIRY', 'OTHER'
  )),
  CHECK (importance BETWEEN 1 AND 10),
  CHECK (confidence IN ('confirmed', 'estimated', 'rumored'))
);

CREATE UNIQUE INDEX IF NOT EXISTS event_calendar_dedup_idx
  ON event_calendar (event_type, event_date, COALESCE(symbol, ''), COALESCE(source_id, title));

CREATE INDEX IF NOT EXISTS event_calendar_date_idx
  ON event_calendar (event_date);

CREATE INDEX IF NOT EXISTS event_calendar_type_date_idx
  ON event_calendar (event_type, event_date);

CREATE INDEX IF NOT EXISTS event_calendar_symbol_date_idx
  ON event_calendar (symbol, event_date)
  WHERE symbol IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_calendar_importance_date_idx
  ON event_calendar (event_date, importance DESC);

CREATE TABLE IF NOT EXISTS system_flags (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  flag_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at TIMESTAMPTZ DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  CHECK (flag_type IN (
    'endpoint_changed', 'endpoint_unreachable', 'data_stale', 'rate_limited',
    'blocked', 'schema_drift', 'last_updated_too_old', 'parse_error', 'dns_failure'
  )),
  CHECK (severity IN ('info', 'warning', 'critical'))
);

CREATE UNIQUE INDEX IF NOT EXISTS system_flags_active_idx
  ON system_flags (source_name, flag_type)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS system_flags_severity_idx
  ON system_flags (severity, last_detected_at DESC);