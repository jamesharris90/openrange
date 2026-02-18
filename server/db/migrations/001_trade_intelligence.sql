-- Migration 001: Trade Intelligence System tables

BEGIN;

-- 1. broker_executions: raw fills from broker
CREATE TABLE IF NOT EXISTS broker_executions (
  exec_id       SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  dataset_scope VARCHAR(4) NOT NULL DEFAULT 'user' CHECK (dataset_scope IN ('user', 'demo')),
  broker        VARCHAR(20) NOT NULL,
  symbol        VARCHAR(20) NOT NULL,
  side          VARCHAR(5) NOT NULL CHECK (side IN ('buy', 'sell')),
  qty           NUMERIC(12, 4) NOT NULL,
  price         NUMERIC(14, 4) NOT NULL,
  commission    NUMERIC(10, 4) NOT NULL DEFAULT 0,
  exec_time     TIMESTAMPTZ NOT NULL,
  raw_json      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broker_exec_user_scope ON broker_executions (user_id, dataset_scope);
CREATE INDEX IF NOT EXISTS idx_broker_exec_symbol ON broker_executions (symbol);
CREATE INDEX IF NOT EXISTS idx_broker_exec_time ON broker_executions (exec_time);

-- 2. trades: grouped fills into logical trades
CREATE TABLE IF NOT EXISTS trades (
  trade_id          SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL,
  dataset_scope     VARCHAR(4) NOT NULL DEFAULT 'user' CHECK (dataset_scope IN ('user', 'demo')),
  symbol            VARCHAR(20) NOT NULL,
  side              VARCHAR(5) NOT NULL CHECK (side IN ('long', 'short')),
  entry_price       NUMERIC(14, 4) NOT NULL,
  exit_price        NUMERIC(14, 4),
  qty               NUMERIC(12, 4) NOT NULL,
  pnl_dollar        NUMERIC(14, 2),
  pnl_percent       NUMERIC(8, 4),
  commission_total  NUMERIC(10, 4) NOT NULL DEFAULT 0,
  opened_at         TIMESTAMPTZ NOT NULL,
  closed_at         TIMESTAMPTZ,
  duration_seconds  INTEGER,
  status            VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_user_scope ON trades (user_id, dataset_scope);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades (symbol);
CREATE INDEX IF NOT EXISTS idx_trades_opened ON trades (opened_at);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (user_id, status);

-- 3. trade_metadata: user annotations on trades
CREATE TABLE IF NOT EXISTS trade_metadata (
  metadata_id    SERIAL PRIMARY KEY,
  trade_id       INTEGER NOT NULL UNIQUE REFERENCES trades(trade_id) ON DELETE CASCADE,
  setup_type     VARCHAR(50),
  conviction     SMALLINT CHECK (conviction BETWEEN 1 AND 5),
  notes          TEXT,
  screenshot_url TEXT,
  tags_json      JSONB DEFAULT '[]',
  review_status  VARCHAR(20) DEFAULT 'pending' CHECK (review_status IN ('pending', 'reviewed', 'skipped')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_metadata_trade ON trade_metadata (trade_id);

-- 4. trade_tags: normalised tag definitions per user
CREATE TABLE IF NOT EXISTS trade_tags (
  tag_id      SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  tag_name    VARCHAR(50) NOT NULL,
  colour_hex  VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tag_name)
);

CREATE INDEX IF NOT EXISTS idx_trade_tags_user ON trade_tags (user_id);

-- 5. daily_reviews: end-of-day journals
CREATE TABLE IF NOT EXISTS daily_reviews (
  review_id      SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL,
  dataset_scope  VARCHAR(4) NOT NULL DEFAULT 'user' CHECK (dataset_scope IN ('user', 'demo')),
  review_date    DATE NOT NULL,
  total_pnl      NUMERIC(14, 2),
  total_trades   INTEGER DEFAULT 0,
  win_rate       NUMERIC(5, 2),
  summary_text   TEXT,
  lessons_text   TEXT,
  plan_tomorrow  TEXT,
  mood           SMALLINT CHECK (mood BETWEEN 1 AND 5),
  rating         SMALLINT CHECK (rating BETWEEN 1 AND 5),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, dataset_scope, review_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_reviews_user_scope ON daily_reviews (user_id, dataset_scope);
CREATE INDEX IF NOT EXISTS idx_daily_reviews_date ON daily_reviews (review_date);

-- Migration tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(50) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('001_trade_intelligence')
ON CONFLICT DO NOTHING;

COMMIT;
