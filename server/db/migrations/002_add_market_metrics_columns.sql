ALTER TABLE market_metrics
ADD COLUMN IF NOT EXISTS previous_high numeric;

ALTER TABLE market_metrics
ADD COLUMN IF NOT EXISTS float_shares numeric;

ALTER TABLE market_metrics
ADD COLUMN IF NOT EXISTS atr_percent numeric;
