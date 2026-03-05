CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_alerts (
  alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id uuid UNIQUE DEFAULT gen_random_uuid(),
  user_id text,
  alert_name text,
  query_tree jsonb,
  message_template text,
  frequency integer DEFAULT 60,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  last_triggered timestamptz
);

CREATE TABLE IF NOT EXISTS alert_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid,
  symbol text,
  message text,
  triggered_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_alerts_user_id ON user_alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_user_alerts_enabled ON user_alerts (enabled);
CREATE INDEX IF NOT EXISTS idx_alert_history_alert_id ON alert_history (alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_triggered_at ON alert_history (triggered_at DESC);
