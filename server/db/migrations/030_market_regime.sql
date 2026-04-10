-- Migration 030: Market Regime Engine
-- Snapshots SPY/VIX-derived market state every 5 minutes.
-- Regime tags are attached to signal_outcomes for regime-split performance analytics.

CREATE TABLE IF NOT EXISTS market_regime (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trend               TEXT        NOT NULL CHECK (trend IN ('BULL','BEAR','RANGE')),
  volatility          TEXT        NOT NULL CHECK (volatility IN ('HIGH','NORMAL','LOW')),
  liquidity           TEXT        NOT NULL CHECK (liquidity IN ('HIGH','LOW')),
  session_type        TEXT        NOT NULL CHECK (session_type IN ('PREMARKET','OPEN','MIDDAY','CLOSE','AFTERHOURS')),
  spy_price           NUMERIC,
  spy_ma20            NUMERIC,
  spy_ma50            NUMERIC,
  vix_price           NUMERIC,
  market_volume_ratio NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_regime_captured_at ON market_regime (captured_at DESC);

-- Keep only 7 days of snapshots — older rows are never queried
CREATE OR REPLACE FUNCTION prune_market_regime() RETURNS void LANGUAGE sql AS $$
  DELETE FROM market_regime WHERE captured_at < NOW() - INTERVAL '7 days';
$$;

-- Regime tags on signal_outcomes (filled at log time from current cache)
ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS regime_trend      TEXT,
  ADD COLUMN IF NOT EXISTS regime_volatility TEXT,
  ADD COLUMN IF NOT EXISTS regime_session    TEXT;

-- Compact regime label for opportunity_stream UI display ("BULL / HIGH VOL / MIDDAY")
ALTER TABLE opportunity_stream
  ADD COLUMN IF NOT EXISTS regime_context TEXT;
