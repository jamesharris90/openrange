CREATE TABLE IF NOT EXISTS alert_history (
    alert_id UUID,
    symbol TEXT,
    triggered_at TIMESTAMP DEFAULT NOW(),
    message TEXT
);

CREATE INDEX IF NOT EXISTS idx_alert_history_alert_id
ON alert_history(alert_id);

CREATE INDEX IF NOT EXISTS idx_alert_history_symbol
ON alert_history(symbol);

CREATE INDEX IF NOT EXISTS idx_alert_history_triggered_at
ON alert_history(triggered_at DESC);
