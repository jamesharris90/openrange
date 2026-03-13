// ============================================================
// OpenRange Platform — Database Type Definitions
// ============================================================
// This file is the canonical TypeScript reference for all
// database rows and view shapes that flow through the
// calibration pipeline.  It is NOT imported at runtime
// (the server is CommonJS); it exists solely for editor
// intelligence and cross-file type documentation.
// ============================================================

// ── Tables ───────────────────────────────────────────────────

export interface SignalRegistryRow {
  id: number;
  symbol: string;
  /** 'VWAP Reclaim' | 'ORB' | 'Momentum Continuation' */
  strategy: string;
  setup_type: string | null;
  signal_score: number | null;
  entry_price: number | null;
  entry_time: string;   // ISO 8601
  created_at: string;
}

export interface SignalCalibrationLogRow {
  id: number;
  symbol: string;
  /** 'VWAP Reclaim' | 'ORB' | 'Momentum Continuation' */
  strategy: string;
  /** 'A' | 'B' | 'C' */
  setup_grade: string | null;
  signal_score: number | null;
  entry_price: number | null;
  entry_time: string;

  // 1-hour window
  high_1h: number | null;
  low_1h: number | null;
  close_1h: number | null;

  // 4-hour window
  high_4h: number | null;
  low_4h: number | null;
  close_4h: number | null;

  // 1-day window
  high_1d: number | null;
  low_1d: number | null;
  close_1d: number | null;

  /** Highest % move above entry during 1d window */
  max_move_percent: number | null;
  /** Deepest % drawdown below entry during 1d window */
  min_move_percent: number | null;
  /** null = not yet evaluated; true = win; false = loss */
  success: boolean | null;

  created_at: string;
}

export interface SignalOutcomeRow {
  id: number;
  signal_id: number;
  /** 'win' | 'loss' | 'breakeven' */
  outcome: string | null;
  pnl_pct: number | null;
  evaluated_at: string;
}

// ── Views ─────────────────────────────────────────────────────

/** Shape of strategy_performance_summary view rows */
export interface StrategyPerformanceRow {
  strategy: string;
  total_signals: number;
  wins: number;
  losses: number;
  /** Percentage, e.g. 66.67 */
  win_rate_pct: number | null;
  avg_move_pct: number | null;
  avg_drawdown_pct: number | null;
  last_signal_at: string | null;
}

/** Shape of radar_top_trades view rows */
export interface TopSignalRow {
  symbol: string;
  score: number | null;
  trade_plan: string | null;
  entry_zone_low: number | null;
  entry_zone_high: number | null;
  target_1: number | null;
  stop_loss: number | null;
  generated_at: string | null;
}

/** Shape of signal_grade_distribution view rows */
export interface GradeDistributionRow {
  /** 'A' | 'B' | 'C' */
  setup_grade: string;
  total: number;
  wins: number;
  win_rate_pct: number | null;
}

/** Shape of calibration_health view (single row) */
export interface CalibrationHealthRow {
  total_logged: number;
  evaluated: number;
  pending_evaluation: number;
  total_wins: number;
  overall_win_rate_pct: number | null;
  last_signal_at: string | null;
  strategy_count: number;
  symbol_count: number;
}

// ── API response wrappers ─────────────────────────────────────

export interface CalibrationPerformanceResponse {
  ok: boolean;
  items: StrategyPerformanceRow[];
}

export interface CalibrationTopSignalsResponse {
  ok: boolean;
  items: TopSignalRow[];
}

export interface CalibrationHealthResponse {
  ok: boolean;
  health: CalibrationHealthRow | null;
}

export interface CalibrationGradeDistributionResponse {
  ok: boolean;
  items: GradeDistributionRow[];
}
