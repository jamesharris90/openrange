-- Phase E: Adaptive Strategy Weighting (additive-only)

CREATE TABLE IF NOT EXISTS strategy_weights (
  strategy TEXT PRIMARY KEY,
  weight NUMERIC NOT NULL DEFAULT 1.0,
  signals_used INTEGER NOT NULL DEFAULT 0,
  win_rate NUMERIC,
  avg_return NUMERIC,
  confidence NUMERIC,
  last_updated TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_weights_updated
ON strategy_weights(last_updated DESC);

CREATE OR REPLACE FUNCTION update_strategy_weights()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO strategy_weights (
    strategy,
    weight,
    signals_used,
    win_rate,
    avg_return,
    confidence,
    last_updated
  )
  SELECT
    so.strategy,
    CASE
      WHEN COUNT(*) < 20 THEN 1.0
      ELSE GREATEST(
        0.5,
        LEAST(
          1.8,
          1 + (
            COALESCE(AVG(so.return_percent), 0) / 10.0
          ) * (
            SUM(CASE WHEN so.return_percent > 0 THEN 1 ELSE 0 END)::NUMERIC
            / NULLIF(COUNT(*), 0)
          )
        )
      )
    END AS weight,
    COUNT(*)::INT AS signals_used,
    (
      SUM(CASE WHEN so.return_percent > 0 THEN 1 ELSE 0 END)::NUMERIC
      / NULLIF(COUNT(*), 0)
    ) AS win_rate,
    AVG(so.return_percent) AS avg_return,
    LEAST(1.0, COUNT(*)::NUMERIC / 100.0) AS confidence,
    NOW() AS last_updated
  FROM signal_outcomes so
  WHERE so.strategy IS NOT NULL
  GROUP BY so.strategy
  ON CONFLICT (strategy) DO UPDATE
  SET
    weight = EXCLUDED.weight,
    signals_used = EXCLUDED.signals_used,
    win_rate = EXCLUDED.win_rate,
    avg_return = EXCLUDED.avg_return,
    confidence = EXCLUDED.confidence,
    last_updated = NOW();
END;
$$;

CREATE OR REPLACE VIEW adaptive_strategy_rank AS
SELECT
  strategy,
  weight,
  signals_used,
  win_rate,
  avg_return,
  confidence,
  last_updated
FROM strategy_weights
ORDER BY weight DESC, confidence DESC, signals_used DESC;
