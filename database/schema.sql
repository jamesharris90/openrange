-- ============================================================
-- OpenRange Platform — Schema Source of Truth
-- Generated: 2026-03-13
--
-- Sections:
--   1. Extensions
--   2. Users & Auth
--   3. Market Data
--   4. Intraday & Daily Bars
--   5. News & Intelligence
--   6. Signals & Strategies
--   7. Trade Journal
--   8. Screening & Universe
--   9. Opportunity & Radar
--  10. Calibration & Outcomes
--  11. System & Admin
--  12. Views (read-only analytics)
--  13. Indexes
--  14. Functions
-- ============================================================

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 2. USERS & AUTH
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id               BIGSERIAL    PRIMARY KEY,
  email            TEXT         UNIQUE NOT NULL,
  password_hash    TEXT,
  plan             TEXT         NOT NULL DEFAULT 'free',
  role             TEXT         NOT NULL DEFAULT 'user',
  trading_timezone TEXT         NOT NULL DEFAULT 'Europe/London',
  active_preset_id INTEGER,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id            BIGINT       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  min_price          NUMERIC,
  max_price          NUMERIC,
  min_rvol           NUMERIC,
  min_gap            NUMERIC,
  preferred_sectors  TEXT[]       DEFAULT '{}',
  enabled_strategies TEXT[]       DEFAULT '{}',
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_watchlists (
  id       SERIAL      PRIMARY KEY,
  user_id  INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol   TEXT        NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS user_presets (
  id               SERIAL       PRIMARY KEY,
  user_id          INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT         NOT NULL,
  min_price        NUMERIC,
  max_price        NUMERIC,
  min_market_cap   BIGINT,
  max_market_cap   BIGINT,
  exchanges        TEXT[]       NOT NULL DEFAULT ARRAY['NASDAQ','NYSE','AMEX'],
  sectors          TEXT[],
  include_etfs     BOOLEAN      NOT NULL DEFAULT FALSE,
  include_spacs    BOOLEAN      NOT NULL DEFAULT FALSE,
  include_warrants BOOLEAN      NOT NULL DEFAULT FALSE,
  is_default       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- FK added after user_presets exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_active_preset') THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_active_preset
      FOREIGN KEY (active_preset_id) REFERENCES user_presets(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_signal_feedback (
  id        BIGSERIAL   PRIMARY KEY,
  user_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_id TEXT        NOT NULL,
  rating    TEXT        NOT NULL CHECK (rating IN ('good', 'bad', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, signal_id)
);

CREATE TABLE IF NOT EXISTS user_alerts (
  alert_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id               UUID         UNIQUE DEFAULT gen_random_uuid(),
  user_id          TEXT,
  alert_name       TEXT,
  query_tree       JSONB,
  message_template TEXT,
  frequency        INTEGER      NOT NULL DEFAULT 60,
  enabled          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_triggered   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS alert_history (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id     UUID,
  symbol       TEXT,
  message      TEXT,
  triggered_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 3. MARKET DATA
-- ============================================================

-- Canonical quote snapshot per symbol (updated by market ingestion)
CREATE TABLE IF NOT EXISTS market_quotes (
  symbol           TEXT        PRIMARY KEY,
  price            NUMERIC,
  change_percent   NUMERIC,
  volume           BIGINT,
  market_cap       BIGINT,
  sector           TEXT,
  short_float      NUMERIC,
  float            NUMERIC,
  relative_volume  NUMERIC,
  premarket_volume BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-symbol derived trading metrics (updated by calc_market_metrics)
CREATE TABLE IF NOT EXISTS market_metrics (
  symbol          TEXT        PRIMARY KEY,
  price           NUMERIC,
  change_percent  NUMERIC,
  gap_percent     NUMERIC,
  relative_volume NUMERIC,
  volume          BIGINT,
  avg_volume_30d  NUMERIC,
  atr             NUMERIC,
  rsi             NUMERIC,
  vwap            NUMERIC,
  float_rotation  NUMERIC,
  previous_high   NUMERIC,
  float_shares    NUMERIC,
  atr_percent     NUMERIC,
  short_float     NUMERIC,
  liquidity_surge NUMERIC,
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chart_trends (
  symbol      TEXT        PRIMARY KEY,
  trend       TEXT,
  support     JSONB,
  resistance  JSONB,
  channel     JSONB,
  breakouts   JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_narratives (
  id         SERIAL      PRIMARY KEY,
  narrative  TEXT,
  regime     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sector_momentum (
  id             SERIAL      PRIMARY KEY,
  sector         TEXT        NOT NULL,
  avg_change     NUMERIC,
  symbol_count   INTEGER,
  leaders        JSONB,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 4. INTRADAY & DAILY BARS
-- ============================================================

-- 2-year daily OHLCV — primary key is (symbol, date)
CREATE TABLE IF NOT EXISTS daily_ohlc (
  symbol TEXT         NOT NULL,
  date   DATE         NOT NULL,
  open   NUMERIC(12,4),
  high   NUMERIC(12,4),
  low    NUMERIC(12,4),
  close  NUMERIC(12,4),
  volume BIGINT,
  PRIMARY KEY (symbol, date)
);

-- Rolling 30-day 1-minute bars — primary key is (symbol, timestamp)
CREATE TABLE IF NOT EXISTS intraday_1m (
  symbol      TEXT         NOT NULL,
  "timestamp" TIMESTAMPTZ  NOT NULL,
  open        NUMERIC(12,4),
  high        NUMERIC(12,4),
  low         NUMERIC(12,4),
  close       NUMERIC(12,4),
  volume      BIGINT,
  PRIMARY KEY (symbol, "timestamp")
);

-- Ingestion checkpoint used by fullMarketIngestion
CREATE TABLE IF NOT EXISTS ingestion_state (
  id                INTEGER     PRIMARY KEY DEFAULT 1,
  phase             TEXT        NOT NULL DEFAULT 'idle',
  last_symbol_index INTEGER     NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'idle',
  last_updated      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 5. NEWS & INTELLIGENCE
-- ============================================================

-- Rolling 30-day raw news events
CREATE TABLE IF NOT EXISTS news_events (
  id           BIGSERIAL   PRIMARY KEY,
  symbol       TEXT        NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  headline     TEXT        NOT NULL,
  source       TEXT,
  url          TEXT,
  UNIQUE (symbol, published_at, headline)
);

-- Scored/enriched news articles (News Scanner page)
CREATE TABLE IF NOT EXISTS news_articles (
  id              TEXT        PRIMARY KEY,
  headline        TEXT        NOT NULL,
  symbols         TEXT[]      NOT NULL DEFAULT '{}',
  source          TEXT,
  url             TEXT,
  published_at    TIMESTAMPTZ,
  summary         TEXT,
  catalyst_type   TEXT,
  news_score      NUMERIC     NOT NULL DEFAULT 0,
  score_breakdown JSONB       NOT NULL DEFAULT '{}',
  raw_payload     JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Raw email ingest from intelligence feeds
CREATE TABLE IF NOT EXISTS intelligence_emails (
  id          BIGSERIAL   PRIMARY KEY,
  sender      TEXT,
  subject     TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_text    TEXT,
  raw_html    TEXT,
  source_tag  TEXT        NOT NULL DEFAULT 'general',
  processed   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Internal intelligence news items (used by intelNarrativeEngine)
CREATE TABLE IF NOT EXISTS intel_news (
  id         SERIAL      PRIMARY KEY,
  symbol     TEXT        NOT NULL,
  headline   TEXT,
  source     TEXT,
  url        TEXT,
  published_at TIMESTAMPTZ,
  sentiment  TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_catalysts (
  id           SERIAL      PRIMARY KEY,
  symbol       TEXT        NOT NULL,
  catalyst_type TEXT,
  headline     TEXT,
  source       TEXT,
  sentiment    TEXT,
  published_at TIMESTAMPTZ,
  score        NUMERIC,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, headline, published_at, catalyst_type)
);

CREATE TABLE IF NOT EXISTS signal_catalysts (
  id          SERIAL      PRIMARY KEY,
  symbol      TEXT        NOT NULL,
  signal_id   INTEGER,
  catalyst_type TEXT,
  headline    TEXT,
  raw_payload JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signal_narratives (
  id               SERIAL      PRIMARY KEY,
  signal_id        INTEGER,
  symbol           TEXT        NOT NULL,
  narrative_type   TEXT,
  sentiment        TEXT,
  summary          TEXT,
  confidence_score NUMERIC,
  mcp_context      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 6. SIGNALS & STRATEGIES
-- ============================================================

-- Strategy-scored signals from the signal engine
CREATE TABLE IF NOT EXISTS strategy_signals (
  id             SERIAL      PRIMARY KEY,
  symbol         TEXT        NOT NULL,
  strategy       TEXT,
  class          TEXT,
  score          INTEGER,
  probability    NUMERIC,
  change_percent NUMERIC,
  gap_percent    NUMERIC,
  relative_volume NUMERIC,
  volume         BIGINT,
  entry_price    NUMERIC,
  exit_price     NUMERIC,
  result         TEXT,
  catalyst_count INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "timestamp"    TIMESTAMPTZ
);

-- Signal performance snapshots for analytics
CREATE TABLE IF NOT EXISTS signal_performance (
  id           SERIAL      PRIMARY KEY,
  signal_id    INTEGER,
  symbol       TEXT,
  strategy     TEXT,
  class        TEXT,
  score        INTEGER,
  probability  NUMERIC,
  entry_price  NUMERIC,
  max_upside   NUMERIC,
  max_drawdown NUMERIC,
  outcome      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_at TIMESTAMPTZ,
  snapshot_date DATE
);

-- Outcome measurement for closed signals (written by signalOutcomeEngine)
CREATE TABLE IF NOT EXISTS signal_outcomes (
  id              SERIAL      PRIMARY KEY,
  signal_id       INTEGER,
  symbol          TEXT        NOT NULL,
  strategy        TEXT,
  entry_price     NUMERIC,
  exit_price      NUMERIC,
  return_percent  NUMERIC,
  hold_minutes    INTEGER,
  max_upside      NUMERIC,
  max_drawdown    NUMERIC,
  outcome         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Early accumulation pre-breakout signals
CREATE TABLE IF NOT EXISTS early_accumulation_signals (
  id                   SERIAL      PRIMARY KEY,
  symbol               TEXT        NOT NULL,
  price                NUMERIC,
  volume               BIGINT,
  avg_volume_30d       NUMERIC,
  relative_volume      NUMERIC,
  float_rotation       NUMERIC,
  float_shares         NUMERIC,
  liquidity_surge      NUMERIC,
  accumulation_score   NUMERIC,
  pressure_level       TEXT,
  sector               TEXT,
  catalyst_type        TEXT,
  volume_delta         NUMERIC,
  alert_sent           BOOLEAN     NOT NULL DEFAULT FALSE,
  detected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS early_signal_outcomes (
  id             SERIAL      PRIMARY KEY,
  signal_id      INTEGER     REFERENCES early_accumulation_signals(id),
  entry_price    NUMERIC,
  price_1h       NUMERIC,
  price_4h       NUMERIC,
  price_1d       NUMERIC,
  price_5d       NUMERIC,
  price_30d      NUMERIC,
  max_move_percent NUMERIC,
  result_label   TEXT,
  evaluated_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_flow_signals (
  id               SERIAL      PRIMARY KEY,
  symbol           TEXT        NOT NULL,
  relative_volume  NUMERIC,
  volume           BIGINT,
  breakout_score   NUMERIC,
  score            NUMERIC,
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signal_weight_calibration (
  id               SERIAL      PRIMARY KEY,
  component        TEXT        NOT NULL,
  weight           NUMERIC,
  success_rate     NUMERIC,
  avg_move         NUMERIC,
  signals_analyzed INTEGER,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signal_hierarchy (
  id              SERIAL      PRIMARY KEY,
  symbol          TEXT        NOT NULL,
  hierarchy_rank  INTEGER,
  signal_class    TEXT,
  strategy        TEXT,
  score           NUMERIC,
  confidence      NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stocks_in_play (
  symbol          TEXT        PRIMARY KEY,
  score           NUMERIC,
  gap_percent     NUMERIC,
  relative_volume NUMERIC,
  reason          TEXT,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 7. TRADE JOURNAL
-- ============================================================

CREATE TABLE IF NOT EXISTS broker_executions (
  exec_id       SERIAL           PRIMARY KEY,
  user_id       INTEGER          NOT NULL REFERENCES users(id),
  dataset_scope VARCHAR(4)       NOT NULL DEFAULT 'user' CHECK (dataset_scope IN ('user', 'demo')),
  broker        VARCHAR(20)      NOT NULL,
  symbol        VARCHAR(20)      NOT NULL,
  side          VARCHAR(5)       NOT NULL CHECK (side IN ('buy', 'sell')),
  qty           NUMERIC(12,4)    NOT NULL,
  price         NUMERIC(14,4)    NOT NULL,
  commission    NUMERIC(10,4)    NOT NULL DEFAULT 0,
  exec_time     TIMESTAMPTZ      NOT NULL,
  raw_json      JSONB,
  created_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trades (
  trade_id         SERIAL         PRIMARY KEY,
  user_id          INTEGER        NOT NULL REFERENCES users(id),
  dataset_scope    VARCHAR(4)     NOT NULL DEFAULT 'user' CHECK (dataset_scope IN ('user', 'demo')),
  symbol           VARCHAR(20)    NOT NULL,
  side             VARCHAR(5)     NOT NULL CHECK (side IN ('long', 'short')),
  entry_price      NUMERIC(14,4)  NOT NULL,
  exit_price       NUMERIC(14,4),
  qty              NUMERIC(12,4)  NOT NULL,
  pnl_dollar       NUMERIC(14,2),
  pnl_percent      NUMERIC(8,4),
  commission_total NUMERIC(10,4)  NOT NULL DEFAULT 0,
  opened_at        TIMESTAMPTZ    NOT NULL,
  closed_at        TIMESTAMPTZ,
  duration_seconds INTEGER,
  status           VARCHAR(10)    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_metadata (
  metadata_id    SERIAL      PRIMARY KEY,
  trade_id       INTEGER     NOT NULL UNIQUE REFERENCES trades(trade_id) ON DELETE CASCADE,
  setup_type     VARCHAR(50),
  conviction     SMALLINT    CHECK (conviction BETWEEN 1 AND 5),
  notes          TEXT,
  screenshot_url TEXT,
  tags_json      JSONB       NOT NULL DEFAULT '[]',
  review_status  VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'reviewed', 'skipped')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_tags (
  tag_id     SERIAL      PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id),
  tag_name   VARCHAR(50) NOT NULL,
  colour_hex VARCHAR(7)  NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tag_name)
);

CREATE TABLE IF NOT EXISTS trade_setups (
  symbol          TEXT        PRIMARY KEY,
  setup           TEXT,
  grade           TEXT,
  score           NUMERIC,
  gap_percent     NUMERIC,
  relative_volume NUMERIC,
  atr             NUMERIC,
  float_rotation  NUMERIC,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_reviews (
  review_id      SERIAL      PRIMARY KEY,
  user_id        INTEGER     NOT NULL REFERENCES users(id),
  dataset_scope  VARCHAR(4)  NOT NULL DEFAULT 'user' CHECK (dataset_scope IN ('user', 'demo')),
  review_date    DATE        NOT NULL,
  total_pnl      NUMERIC(14,2),
  total_trades   INTEGER     NOT NULL DEFAULT 0,
  win_rate       NUMERIC(5,2),
  summary_text   TEXT,
  lessons_text   TEXT,
  plan_tomorrow  TEXT,
  mood           SMALLINT    CHECK (mood BETWEEN 1 AND 5),
  rating         SMALLINT    CHECK (rating BETWEEN 1 AND 5),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, dataset_scope, review_date)
);


-- ============================================================
-- 8. SCREENING & UNIVERSE
-- ============================================================

CREATE TABLE IF NOT EXISTS ticker_universe (
  symbol       TEXT        PRIMARY KEY,
  company_name TEXT,
  exchange     TEXT,
  sector       TEXT,
  industry     TEXT,
  market_cap   BIGINT,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discovered_symbols (
  symbol      TEXT        PRIMARY KEY,
  source      TEXT,
  score       NUMERIC,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS symbol_queue (
  symbol     TEXT        PRIMARY KEY,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS earnings_events (
  id                SERIAL      PRIMARY KEY,
  symbol            TEXT        NOT NULL,
  report_date       DATE        NOT NULL,
  report_time       TEXT,
  eps_estimate      NUMERIC,
  eps_actual        NUMERIC,
  rev_estimate      NUMERIC,
  rev_actual        NUMERIC,
  eps_surprise_pct  NUMERIC,
  rev_surprise_pct  NUMERIC,
  guidance_direction TEXT,
  market_cap        NUMERIC,
  float             NUMERIC,
  sector            TEXT,
  industry          TEXT,
  earnings_expected_move_pct    NUMERIC,
  earnings_expected_move_dollar NUMERIC,
  earnings_iv       NUMERIC,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, report_date)
);

CREATE TABLE IF NOT EXISTS earnings_market_reaction (
  id                      SERIAL      PRIMARY KEY,
  symbol                  TEXT        NOT NULL,
  report_date             DATE        NOT NULL,
  pre_market_gap_pct      NUMERIC,
  open_gap_pct            NUMERIC,
  high_of_day_pct         NUMERIC,
  low_of_day_pct          NUMERIC,
  close_pct               NUMERIC,
  day2_followthrough_pct  NUMERIC,
  volume_vs_avg           NUMERIC,
  rvol                    NUMERIC,
  atr_pct                 NUMERIC,
  implied_move_pct        NUMERIC,
  actual_move_pct         NUMERIC,
  move_vs_implied_ratio   NUMERIC,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS options_cache (
  symbol               TEXT    NOT NULL,
  expiration           INTEGER NOT NULL,
  atm_iv               REAL,
  expected_move_pct    REAL,
  expected_move_dollar REAL,
  days_to_expiry       REAL,
  null_reason          TEXT,
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, expiration)
);


-- ============================================================
-- 9. OPPORTUNITY & RADAR
-- ============================================================

-- Raw scored opportunity events (written by opportunity engines)
CREATE TABLE IF NOT EXISTS opportunity_stream (
  id         SERIAL      PRIMARY KEY,
  symbol     TEXT,
  event_type TEXT,
  headline   TEXT,
  score      NUMERIC,
  source     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enriched intelligence per symbol per day (written by opportunityIntelligenceEngine)
CREATE TABLE IF NOT EXISTS opportunity_intelligence (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol           TEXT        NOT NULL,
  score            NUMERIC,
  price            NUMERIC,
  gap_percent      NUMERIC,
  relative_volume  NUMERIC,
  catalyst         TEXT,
  movement_reason  TEXT,
  trade_reason     TEXT,
  trade_plan       TEXT,
  confidence       NUMERIC,
  setup_grade      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, (created_at::date))
);


-- ============================================================
-- 10. CALIBRATION & OUTCOMES
-- ============================================================

-- Log of signals promoted from radar for outcome tracking
-- Populated by signalCalibrationEngine every 15 minutes
CREATE TABLE IF NOT EXISTS signal_calibration_log (
  id              SERIAL      PRIMARY KEY,
  symbol          TEXT        NOT NULL,
  strategy        TEXT        NOT NULL,
  setup_grade     TEXT,
  signal_score    NUMERIC,
  entry_price     NUMERIC,
  entry_time      TIMESTAMPTZ,
  -- 1-hour outcome fields (populated by calibrationPriceUpdater)
  high_1h         NUMERIC,
  low_1h          NUMERIC,
  close_1h        NUMERIC,
  -- 4-hour outcome fields
  high_4h         NUMERIC,
  low_4h          NUMERIC,
  close_4h        NUMERIC,
  -- 1-day outcome fields
  high_1d         NUMERIC,
  low_1d          NUMERIC,
  close_1d        NUMERIC,
  -- Derived performance metrics
  max_move_percent NUMERIC,
  min_move_percent NUMERIC,
  success          BOOLEAN,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signal_learning (
  id             SERIAL      PRIMARY KEY,
  strategy       TEXT,
  sector         TEXT,
  catalyst_type  TEXT,
  time_of_day    TEXT,
  signals_count  INTEGER,
  win_count      INTEGER,
  avg_upside     NUMERIC,
  avg_drawdown   NUMERIC,
  win_rate       NUMERIC,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 11. SYSTEM & ADMIN
-- ============================================================

CREATE TABLE IF NOT EXISTS ingestion_state (
  id                INTEGER     PRIMARY KEY DEFAULT 1,
  phase             TEXT        NOT NULL DEFAULT 'idle',
  last_symbol_index INTEGER     NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'idle',
  last_updated      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(50) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 12. VIEWS (read-only analytics — defined in Supabase)
-- ============================================================

-- Top-scoring intelligence rows from the last 24 hours
-- Source: opportunity_intelligence WHERE created_at > NOW() - INTERVAL '24h'
-- Used by: signalCalibrationEngine, /api/radar/top-trades
CREATE VIEW radar_top_trades AS
  SELECT
    symbol,
    score,
    price,
    gap_percent,
    relative_volume,
    movement_reason,
    trade_reason,
    trade_plan,
    setup_grade,
    created_at
  FROM opportunity_intelligence
  WHERE created_at >= NOW() - INTERVAL '24 hours'
  ORDER BY score DESC;

-- Rolling radar aggregation views (source: opportunity_intelligence + market_metrics)
-- These are created and managed in Supabase directly:
--   radar_stocks_in_play   — high rvol / gap symbols
--   radar_momentum         — momentum leaders
--   radar_news             — news-driven setups
--   radar_a_setups         — A+ graded setups
--   radar_market_summary   — market-wide metric snapshot

-- Aggregated strategy performance from signal_calibration_log
-- Used by: /api/calibration/performance, CalibrationDashboard
CREATE VIEW strategy_performance_summary AS
  SELECT
    strategy,
    COUNT(*)                    AS total_signals,
    AVG(max_move_percent)       AS avg_move,
    AVG(min_move_percent)       AS avg_drawdown,
    ROUND(
      100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
      2
    )                           AS win_rate_percent
  FROM signal_calibration_log
  GROUP BY strategy;

-- Platform watchdog health view
-- Monitors stream freshness and signal counts
CREATE VIEW platform_watchdog_status AS
  SELECT
    (SELECT COUNT(*) FROM opportunity_stream WHERE created_at >= NOW() - INTERVAL '1 hour')
      AS streams_1h,
    (SELECT MAX(created_at) FROM opportunity_stream)
      AS last_stream_at,
    (SELECT COUNT(*) FROM opportunity_intelligence WHERE created_at >= NOW() - INTERVAL '24 hours')
      AS intelligence_24h,
    (SELECT COUNT(*) FROM signal_calibration_log)
      AS calibration_signals_total,
    NOW() AS checked_at;


-- ============================================================
-- 13. INDEXES
-- ============================================================

-- users
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- market_metrics
CREATE INDEX IF NOT EXISTS idx_market_metrics_symbol   ON market_metrics (symbol);
CREATE INDEX IF NOT EXISTS idx_market_metrics_rvol     ON market_metrics (relative_volume);
CREATE INDEX IF NOT EXISTS idx_market_metrics_gap      ON market_metrics (gap_percent);
CREATE INDEX IF NOT EXISTS idx_market_metrics_updated  ON market_metrics (updated_at DESC);

-- market_quotes
CREATE INDEX IF NOT EXISTS idx_market_quotes_updated ON market_quotes (updated_at DESC);

-- daily_ohlc
CREATE INDEX IF NOT EXISTS idx_daily_ohlc_symbol_date ON daily_ohlc (symbol, date DESC);

-- intraday_1m
CREATE INDEX IF NOT EXISTS idx_intraday_1m_symbol_ts ON intraday_1m (symbol, "timestamp" DESC);

-- news_events
CREATE INDEX IF NOT EXISTS idx_news_events_symbol_pub ON news_events (symbol, published_at DESC);

-- news_articles
CREATE INDEX IF NOT EXISTS idx_news_articles_published   ON news_articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_score       ON news_articles (news_score DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_symbols     ON news_articles USING GIN (symbols);
CREATE INDEX IF NOT EXISTS idx_news_articles_catalyst    ON news_articles (catalyst_type);

-- intelligence_emails
CREATE INDEX IF NOT EXISTS idx_intel_emails_received  ON intelligence_emails (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_emails_source    ON intelligence_emails (source_tag);
CREATE INDEX IF NOT EXISTS idx_intel_emails_pending   ON intelligence_emails (processed) WHERE processed = FALSE;

-- trade_catalysts
CREATE INDEX IF NOT EXISTS idx_catalyst_symbol ON trade_catalysts (symbol);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalyst_unique ON trade_catalysts (symbol, headline, published_at, catalyst_type);

-- ticker_universe
CREATE INDEX IF NOT EXISTS idx_universe_exchange ON ticker_universe (exchange);
CREATE INDEX IF NOT EXISTS idx_universe_sector   ON ticker_universe (sector);

-- discovered_symbols
CREATE INDEX IF NOT EXISTS idx_discovered_source ON discovered_symbols (source);

-- opportunity_stream
CREATE INDEX IF NOT EXISTS idx_stream_time   ON opportunity_stream (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_symbol ON opportunity_stream (symbol);

-- opportunity_intelligence
CREATE INDEX IF NOT EXISTS idx_intelligence_symbol  ON opportunity_intelligence (symbol);
CREATE INDEX IF NOT EXISTS idx_intelligence_created ON opportunity_intelligence (created_at DESC);

-- signal_calibration_log
CREATE INDEX IF NOT EXISTS idx_calibration_symbol   ON signal_calibration_log (symbol);
CREATE INDEX IF NOT EXISTS idx_calibration_strategy ON signal_calibration_log (strategy);
CREATE INDEX IF NOT EXISTS idx_calibration_entry    ON signal_calibration_log (entry_time DESC);

-- signal_outcomes
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_symbol   ON signal_outcomes (symbol);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_strategy ON signal_outcomes (strategy);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_created  ON signal_outcomes (created_at DESC);

-- strategy_signals
CREATE INDEX IF NOT EXISTS idx_strategy_signals_symbol   ON strategy_signals (symbol);
CREATE INDEX IF NOT EXISTS idx_strategy_signals_strategy ON strategy_signals (strategy);

-- earnings_events
CREATE INDEX IF NOT EXISTS idx_earnings_events_symbol_date ON earnings_events (symbol, report_date DESC);

-- options_cache
CREATE INDEX IF NOT EXISTS idx_options_cache_symbol ON options_cache (symbol, fetched_at DESC);

-- alert_history
CREATE INDEX IF NOT EXISTS idx_alert_history_alert_id    ON alert_history (alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_triggered   ON alert_history (triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_symbol      ON alert_history (symbol);

-- user_alerts
CREATE INDEX IF NOT EXISTS idx_user_alerts_user_id ON user_alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_user_alerts_enabled ON user_alerts (enabled);

-- user_watchlists
CREATE INDEX IF NOT EXISTS idx_user_watchlists_user_id ON user_watchlists (user_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlists_symbol  ON user_watchlists (symbol);

-- market_narratives
CREATE INDEX IF NOT EXISTS idx_narrative_time ON market_narratives (created_at DESC);

-- trades
CREATE INDEX IF NOT EXISTS idx_trades_user_scope ON trades (user_id, dataset_scope);
CREATE INDEX IF NOT EXISTS idx_trades_symbol     ON trades (symbol);
CREATE INDEX IF NOT EXISTS idx_trades_opened     ON trades (opened_at);
CREATE INDEX IF NOT EXISTS idx_trades_status     ON trades (user_id, status);

-- broker_executions
CREATE INDEX IF NOT EXISTS idx_broker_exec_user_scope ON broker_executions (user_id, dataset_scope);
CREATE INDEX IF NOT EXISTS idx_broker_exec_symbol     ON broker_executions (symbol);
CREATE INDEX IF NOT EXISTS idx_broker_exec_time       ON broker_executions (exec_time);

-- daily_reviews
CREATE INDEX IF NOT EXISTS idx_daily_reviews_user_scope ON daily_reviews (user_id, dataset_scope);
CREATE INDEX IF NOT EXISTS idx_daily_reviews_date       ON daily_reviews (review_date);


-- ============================================================
-- 14. FUNCTIONS
-- ============================================================

-- evaluate_signal_outcomes()
-- Called every 15 minutes by signalOutcomeEngine.
-- Closes out open signals in signal_calibration_log whose entry_time
-- is more than 1 day old, deriving final outcome and writing to signal_outcomes.
-- Implementation managed in Supabase (stored procedure / PL/pgSQL).
-- Stub shown here for documentation only; do not re-create in migrations.
--
-- CREATE OR REPLACE FUNCTION evaluate_signal_outcomes()
-- RETURNS INTEGER LANGUAGE plpgsql AS $$
-- DECLARE evaluated INTEGER := 0;
-- BEGIN
--   INSERT INTO signal_outcomes (signal_id, symbol, strategy, entry_price, ...)
--   SELECT id, symbol, strategy, entry_price, ...
--   FROM signal_calibration_log
--   WHERE entry_time < NOW() - INTERVAL '1 day'
--     AND NOT EXISTS (SELECT 1 FROM signal_outcomes o WHERE o.signal_id = signal_calibration_log.id);
--   GET DIAGNOSTICS evaluated = ROW_COUNT;
--   RETURN evaluated;
-- END $$;
