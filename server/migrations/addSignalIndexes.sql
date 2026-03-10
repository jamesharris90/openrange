CREATE INDEX IF NOT EXISTS idx_market_metrics_symbol
ON market_metrics(symbol);

CREATE INDEX IF NOT EXISTS idx_market_metrics_rvol
ON market_metrics(relative_volume);

CREATE INDEX IF NOT EXISTS idx_market_metrics_gap
ON market_metrics(gap_percent);

CREATE INDEX IF NOT EXISTS idx_trade_signals_score
ON trade_signals(score DESC);

CREATE INDEX IF NOT EXISTS idx_dynamic_watchlist_symbol
ON dynamic_watchlist(symbol);
