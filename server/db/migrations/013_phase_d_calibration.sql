-- ============================================================
-- Migration 013: Phase D — Historical Signal Replay + Strategy Edge Ranking
-- ============================================================

-- 1. Add source column to signal_registry so replay signals are
--    distinguishable from live signals.
ALTER TABLE signal_registry
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'live';

-- 2. strategy_edge_rank view
--    Ranks strategies by measured outcome quality.
--    Reads signal_outcomes (joined to signal_registry for strategy label).
DROP VIEW IF EXISTS strategy_edge_rank;

CREATE OR REPLACE VIEW strategy_edge_rank AS
SELECT
  sr.strategy,
  COUNT(so.id)                                                         AS signals,
  ROUND(AVG(so.pnl_pct), 4)                                           AS avg_return,
  ROUND(AVG(CASE WHEN so.pnl_pct > 0 THEN so.pnl_pct  END), 4)       AS avg_upside,
  ROUND(AVG(CASE WHEN so.pnl_pct < 0 THEN ABS(so.pnl_pct) END), 4)   AS avg_drawdown,
  ROUND(
    SUM(CASE WHEN so.pnl_pct > 0 THEN 1 ELSE 0 END)::NUMERIC
    / NULLIF(COUNT(so.id)::NUMERIC, 0),
    4
  )                                                                    AS win_rate,
  ROUND(
    (
      COALESCE(AVG(CASE WHEN so.pnl_pct > 0 THEN so.pnl_pct END), 0)
      + COALESCE(AVG(so.pnl_pct), 0)
    ) / 2,
    4
  )                                                                    AS edge_score
FROM signal_registry sr
JOIN signal_outcomes so ON so.signal_id = sr.id
WHERE so.pnl_pct IS NOT NULL
GROUP BY sr.strategy
ORDER BY edge_score DESC;

-- 3. Index to speed up source-based lookups (e.g. watchdog, platformHealth)
CREATE INDEX IF NOT EXISTS idx_signal_registry_source
  ON signal_registry (source);

CREATE INDEX IF NOT EXISTS idx_signal_registry_entry_time
  ON signal_registry (entry_time DESC);
