import { apiGet } from "@/lib/api/client";

export type BeaconSummary = {
  active_strategies: number;
  signals_tracked: number;
  todays_picks: number;
  thirty_day_win_rate: number | null;
  latest_score_date: string | null;
  next_update_utc: string | null;
};

export type BeaconPick = {
  rank: number | null;
  symbol: string;
  strategy_id: string;
  strategy_name: string;
  direction: string | null;
  entry_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  confidence_score: number | null;
  strategy_grade: string | null;
  strategy_win_rate: number | null;
  strategy_profit_factor: number | null;
  current_price: number | null;
  change_percent: number | null;
  sector: string | null;
};

export type BeaconPicksResponse = {
  pick_date: string;
  generated_at: string | null;
  picks: BeaconPick[];
};

export type BeaconStrategy = {
  strategy_id: string;
  strategy_name: string;
  category: string;
  grade: string;
  win_rate: number;
  profit_factor: number | null;
  total_signals: number;
  avg_r_multiple: number;
  lookback_days: number;
  thirty_day_pnl_r: number;
  trend: "improving" | "declining" | "stable" | "new";
};

export type BeaconStrategiesResponse = {
  scored_at: string | null;
  strategies: BeaconStrategy[];
};

export type BeaconTrackRecordPick = {
  pick_date: string | null;
  symbol: string;
  strategy_id: string;
  direction: string | null;
  entry_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  outcome: string;
  exit_price: number | null;
  r_multiple: number | null;
  exit_date: string | null;
};

export type BeaconTrackRecordResponse = {
  window_days: number;
  strategy_filter: string | null;
  total_picks: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_winner_r: number;
  avg_loser_r: number;
  profit_factor: number | null;
  equity_curve: Array<{ date: string | null; cumulative_r: number }>;
  recent_picks: BeaconTrackRecordPick[];
};

export const BEACON_QUERY_OPTIONS = {
  staleTime: 60_000,
  refetchInterval: 60_000,
};

export async function fetchBeaconSummary(): Promise<BeaconSummary> {
  return apiGet<BeaconSummary>("/api/v2/beacon/summary");
}

export async function fetchBeaconPicks(date?: string): Promise<BeaconPicksResponse> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return apiGet<BeaconPicksResponse>(`/api/v2/beacon/picks${query}`);
}

export async function fetchBeaconStrategies(): Promise<BeaconStrategiesResponse> {
  return apiGet<BeaconStrategiesResponse>("/api/v2/beacon/strategies");
}

export async function fetchBeaconTrackRecord(strategyId: string, days: number): Promise<BeaconTrackRecordResponse> {
  const search = new URLSearchParams({ days: String(days) });
  if (strategyId) {
    search.set("strategy_id", strategyId);
  }
  return apiGet<BeaconTrackRecordResponse>(`/api/v2/beacon/track-record?${search.toString()}`);
}