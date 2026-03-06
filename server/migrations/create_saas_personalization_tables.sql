CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  plan TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id BIGINT PRIMARY KEY,
  min_price NUMERIC,
  max_price NUMERIC,
  min_rvol NUMERIC,
  min_gap NUMERIC,
  preferred_sectors TEXT[] DEFAULT ARRAY[]::TEXT[],
  enabled_strategies TEXT[] DEFAULT ARRAY[]::TEXT[],
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_watchlists (
  user_id BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, symbol)
);

ALTER TABLE user_watchlists
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE IF NOT EXISTS user_signal_feedback (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  signal_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('good', 'bad', 'ignored')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, signal_id)
);

ALTER TABLE user_signal_feedback
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlists_user_id ON user_watchlists(user_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlists_symbol ON user_watchlists(symbol);
CREATE INDEX IF NOT EXISTS idx_user_signal_feedback_user_id ON user_signal_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_user_signal_feedback_signal_id ON user_signal_feedback(signal_id);
