CREATE TABLE IF NOT EXISTS symbol_queue (
    symbol TEXT PRIMARY KEY,
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queue_created
ON symbol_queue(created_at);
