-- 002_universe_presets: User profile extensions, preset universes, and watchlists

-- Extend users table with profile fields
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trading_timezone TEXT DEFAULT 'Europe/London',
  ADD COLUMN IF NOT EXISTS active_preset_id INTEGER;

-- Universe preset configurations per user
CREATE TABLE IF NOT EXISTS user_presets (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  min_price        NUMERIC,
  max_price        NUMERIC,
  min_market_cap   BIGINT,
  max_market_cap   BIGINT,
  exchanges        TEXT[]  DEFAULT ARRAY['NASDAQ','NYSE','AMEX'],
  sectors          TEXT[],
  include_etfs     BOOLEAN DEFAULT FALSE,
  include_spacs    BOOLEAN DEFAULT FALSE,
  include_warrants BOOLEAN DEFAULT FALSE,
  is_default       BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Per-user watchlist (one row per symbol)
CREATE TABLE IF NOT EXISTS user_watchlists (
  id       SERIAL PRIMARY KEY,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol   TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, symbol)
);

-- FK from users.active_preset_id → user_presets.id (added after table exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_active_preset'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_active_preset
      FOREIGN KEY (active_preset_id) REFERENCES user_presets(id) ON DELETE SET NULL;
  END IF;
END$$;
