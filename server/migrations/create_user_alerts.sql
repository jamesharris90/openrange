CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_alerts (
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    alert_name TEXT,
    query_tree JSONB,
    message_template TEXT,
    frequency INTEGER DEFAULT 60,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    last_triggered TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_alerts_user_id
ON user_alerts(user_id);

CREATE INDEX IF NOT EXISTS idx_user_alerts_enabled
ON user_alerts(enabled);
