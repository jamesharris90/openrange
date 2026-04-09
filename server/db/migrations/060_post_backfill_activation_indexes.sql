CREATE INDEX IF NOT EXISTS idx_earnings_history_report_date
  ON earnings_history(report_date DESC);

CREATE INDEX IF NOT EXISTS idx_catalyst_signals_symbol_created
  ON catalyst_signals(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_backtest_signals_strategy_date
  ON strategy_backtest_signals(strategy_id, signal_date DESC);

CREATE INDEX IF NOT EXISTS idx_morning_picks_date_rank
  ON morning_picks(pick_date DESC, rank ASC);