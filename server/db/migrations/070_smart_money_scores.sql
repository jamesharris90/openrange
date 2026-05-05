CREATE TABLE IF NOT EXISTS smart_money_scores (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  score_date DATE NOT NULL,
  total_score NUMERIC NOT NULL,
  score_tier TEXT NOT NULL,
  insider_component NUMERIC NOT NULL,
  insider_signal_count INT,
  insider_net_value NUMERIC,
  insider_buy_count INT,
  insider_sell_count INT,
  congressional_component NUMERIC NOT NULL,
  congressional_member_count INT,
  congressional_net_value NUMERIC,
  institutional_component NUMERIC NOT NULL,
  institutional_new_positions INT,
  institutional_increased_positions INT,
  institutional_closed_positions INT,
  activist_component NUMERIC NOT NULL,
  activist_filing_count INT,
  contributing_factors JSONB,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, score_date)
);

CREATE INDEX IF NOT EXISTS smart_money_scores_score_date_total_score_idx
  ON smart_money_scores (score_date DESC, total_score DESC);

CREATE INDEX IF NOT EXISTS smart_money_scores_symbol_score_date_idx
  ON smart_money_scores (symbol, score_date DESC);