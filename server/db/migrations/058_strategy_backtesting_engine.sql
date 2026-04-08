CREATE TABLE IF NOT EXISTS strategy_backtest_signals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  signal_date DATE NOT NULL,
  direction TEXT NOT NULL,
  entry_price NUMERIC NOT NULL,
  stop_price NUMERIC NOT NULL,
  target_price NUMERIC NOT NULL,
  exit_price NUMERIC,
  exit_reason TEXT,
  bars_held INTEGER,
  pnl_percent NUMERIC,
  pnl_r NUMERIC,
  max_move_percent NUMERIC,
  max_drawdown_percent NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(strategy_id, symbol, signal_date)
);

CREATE INDEX IF NOT EXISTS idx_strategy_backtest_signals_strategy
  ON strategy_backtest_signals(strategy_id);

CREATE INDEX IF NOT EXISTS idx_strategy_backtest_signals_date
  ON strategy_backtest_signals(signal_date);

CREATE INDEX IF NOT EXISTS idx_strategy_backtest_signals_symbol
  ON strategy_backtest_signals(symbol);

CREATE TABLE IF NOT EXISTS strategy_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  score_date DATE NOT NULL,
  lookback_days INTEGER NOT NULL,
  total_signals INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  win_rate NUMERIC NOT NULL,
  avg_pnl_r NUMERIC NOT NULL,
  profit_factor NUMERIC,
  max_consecutive_losses INTEGER,
  avg_bars_held NUMERIC,
  expectancy NUMERIC,
  sharpe_estimate NUMERIC,
  grade TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(strategy_id, score_date, lookback_days)
);

CREATE INDEX IF NOT EXISTS idx_strategy_scores_strategy
  ON strategy_scores(strategy_id);

CREATE INDEX IF NOT EXISTS idx_strategy_scores_date
  ON strategy_scores(score_date);

CREATE TABLE IF NOT EXISTS morning_picks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pick_date DATE NOT NULL,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price NUMERIC,
  stop_price NUMERIC,
  target_price NUMERIC,
  confidence_score NUMERIC,
  strategy_win_rate NUMERIC,
  strategy_grade TEXT,
  rank INTEGER,
  outcome TEXT,
  actual_pnl_r NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(pick_date, strategy_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_morning_picks_date
  ON morning_picks(pick_date);