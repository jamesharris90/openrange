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

export type V0Pick = {
  pick_id: string;
  symbol: string;
  pattern: string;
  confidence: string;
  reasoning: string;
  signals_aligned: string[];
  forward_count?: number;
  backward_count?: number;
  latest_close?: number | null;
  prior_close?: number | null;
  change_pct?: number | null;
  sparkline?: number[];
  display_price?: number | null;
  market_cap?: number | null;
  rvol?: number | null;
  gap_percent?: number | null;
  direction?: string | null;
  sector?: string | null;
  company_name?: string | null;
  alignment_count?: number | null;
  is_top_catalyst?: boolean;
  catalyst_type?: string | null;
  catalyst_labels?: string[];
  metadata: Record<string, unknown>;
  narrative_thesis?: string | null;
  narrative_watch_for?: string | null;
  narrative_generated_at?: string | null;
  top_catalyst_tier?: number | null;
  top_catalyst_rank?: number | null;
  top_catalyst_reasons?: string[] | null;
  top_catalyst_computed_at?: string | null;
  created_at: string;
  run_id?: string | null;
};

export type V0FilterParams = {
  date?: string;
  tier?: string;
  minPrice?: string;
  maxPrice?: string;
  minMarketCap?: string;
  maxMarketCap?: string;
  minRvol?: string;
  minGap?: string;
  direction?: string;
  catalyst?: string;
  topScope?: string;
  limit?: string;
};

export type V0Response = {
  picks: V0Pick[];
  count: number;
  version: string;
  generated_at: string | null;
  run_id?: string | null;
  as_of_date?: string | null;
  filters?: Record<string, unknown>;
};

type MarketIndex = {
  price: number | null;
  change_percent: number | null;
  relative_volume: number | null;
  updated_at: string | null;
};

type SectorLeadership = {
  sector: string;
  avg_change: number | null;
  avg_rvol: number | null;
  members: number;
};

export type BeaconMarketContext = {
  opening_bias: string;
  market_regime: string;
  volatility_level: string;
  breadth_percent: number | null;
  strongest_sector: string | null;
  weakest_sector: string | null;
  earnings_today_count: number;
  macro_today_count: number;
  indices: Record<string, MarketIndex>;
  earnings: {
    today: Array<Record<string, unknown>>;
    week: Array<Record<string, unknown>>;
  };
  macro: {
    today: Array<Record<string, unknown>>;
    week: Array<Record<string, unknown>>;
  };
  sector_leadership: {
    strongest: SectorLeadership | null;
    weakest: SectorLeadership | null;
  };
  narrative: string;
  risk_flag: string | null;
  generated_by: string;
  generated_at: string;
  source_snapshot_at: string | null;
  narrative_error: string | null;
};

export type BeaconMarketContextResponse = {
  data: BeaconMarketContext;
  meta: {
    cache_hit: boolean;
    cached_at: string | null;
    expires_at: string | null;
  };
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

export async function fetchV0Picks(filters: V0FilterParams = {}): Promise<V0Response> {
  const search = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value != null && String(value).trim() !== "") {
      search.set(key, String(value));
    }
  });

  const query = search.toString();
  return apiGet<V0Response>(`/api/beacon-v0/picks${query ? `?${query}` : ""}`);
}

export async function fetchBeaconMarketContext(): Promise<BeaconMarketContextResponse> {
  return apiGet<BeaconMarketContextResponse>("/api/vantage/context");
}