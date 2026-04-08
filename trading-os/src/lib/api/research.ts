import { apiGet } from "@/lib/api/client";

export type ResearchOverview = {
  price: number | null;
  change_percent: number | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  country: string | null;
};

export type ResearchFundamentals = {
  revenue_growth: number | null;
  eps_growth: number | null;
  margins: {
    gross_margin: number | null;
    net_margin: number | null;
  };
  cashflow: {
    free_cash_flow: number | null;
  };
  debt: {
    debt_to_equity: number | null;
  };
  dcf_value: number | null;
};

export type ResearchEarnings = {
  next_date: string | null;
  expected_move: number | null;
  eps_estimate: number | null;
};

export type ResearchOwnership = {
  institutional: number | null;
  insider: string | null;
  etf: number | null;
};

export type ResearchData = {
  symbol: string;
  overview: ResearchOverview;
  fundamentals: ResearchFundamentals;
  earnings: ResearchEarnings;
  ownership: ResearchOwnership;
};

export type ResearchTrend = "bullish" | "neutral" | "bearish" | null;

export type ResearchContext = {
  id?: string;
  spy_trend: ResearchTrend;
  qqq_trend: ResearchTrend;
  vix_level: number | null;
  sector_strength_json?: Record<string, number | string | null> | null;
  updated_at?: string | null;
};

export type ResearchMeta = {
  symbol: string;
  source: string;
  cached: boolean;
  stale: boolean;
  updated_at: string | null;
  cache_age_ms: number | null;
};

export type ResearchResponse = {
  success: boolean;
  data: ResearchData;
  data_confidence?: number;
  data_confidence_label?: DataConfidenceLabel;
  freshness_score?: number;
  source_quality?: number;
  decision?: DecisionPayload;
  context: ResearchContext | null;
  meta: ResearchMeta;
};

export type ResearchFullProfile = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  country: string | null;
  website: string | null;
  description: string | null;
  market_cap?: number | null;
  beta?: number | null;
  pe?: number | null;
  insider_ownership_percent?: number | null;
  updated_at: string | null;
  source: string;
};

export type ResearchFullPrice = {
  symbol: string;
  price: number | null;
  change_percent: number | null;
  atr: number | null;
  updated_at: string | null;
  source: string;
};

export type ResearchFullFundamentals = {
  symbol: string;
  revenue_growth: number | null;
  eps_growth: number | null;
  gross_margin: number | null;
  net_margin: number | null;
  free_cash_flow: number | null;
  pe?: number | null;
  ps?: number | null;
  pb?: number | null;
  debt_to_equity?: number | null;
  roe_percent?: number | null;
  fcf_yield_percent?: number | null;
  dividend_yield_percent?: number | null;
  earnings_yield_percent?: number | null;
  altman_z_score?: number | null;
  piotroski_score?: number | null;
  trends?: Array<{
    date: string;
    revenue: number | null;
    eps: number | null;
    gross_margin: number | null;
    net_margin: number | null;
  }>;
  updated_at: string | null;
  source: string;
};

export type ResearchEarningsHistoryRow = {
  date: string;
  report_time?: string | null;
  epsActual: number | null;
  epsEstimated: number | null;
  surprisePercent: number | null;
  expectedMove: number | null;
  actualMove: number | null;
  eps_actual?: number | null;
  eps_estimate?: number | null;
  expected_move_percent?: number | null;
  actual_move_percent?: number | null;
  pre_move_percent?: number | null;
  post_move_percent?: number | null;
  true_reaction_window?: string | null;
  day1_close?: number | null;
  day3_close?: number | null;
  drift1d?: number | null;
  drift3d?: number | null;
  beat?: boolean | null;
};

export type EarningsPatternEntry = {
  type: 'STRONG_BEAT' | 'FADE' | 'STRONG_MISS' | 'SQUEEZE';
  move: number;
  beat: boolean;
  date: string;
};

export type ResearchEarningsNextRow = {
  date: string;
  report_time?: string | null;
  epsActual: number | null;
  epsEstimated: number | null;
  expectedMove: number | null;
  eps_actual?: number | null;
  eps_estimate?: number | null;
  expected_move_percent?: number | null;
};

export type ResearchFullEarnings = {
  symbol: string;
  next: ResearchEarningsNextRow | null;
  history: ResearchEarningsHistoryRow[];
  pattern?: EarningsPatternEntry[];
  updated_at: string | null;
  source: string;
  edge?: EarningsEdge;
  read?: string;
};

export type EarningsInsight = {
  beatRate: number;
  missRate: number;
  avgSurprise: number;
  expectedMove: number;
  tradeable: boolean;
};

export type EarningsEdge = {
  beat_rate?: number;
  avg_move?: number;
  avg_up_move?: number;
  avg_down_move?: number;
  directional_bias?: string;
  consistency?: number;
  edge_score?: number;
  edge_label?: string;
  read?: string;
  sample_size?: number;
  earnings_pattern?: EarningsPatternEntry[];
  beatRate?: number;
  missRate?: number;
  avgMove?: number;
  beatAvgMove?: number;
  avgUpMove?: number;
  avgDownMove?: number;
  directionalBias?: string;
  consistencyScore?: number;
  edgeScore?: number;
  edgeLabel?: string;
  avgDrift1d?: number | null;
  avgDrift3d?: number | null;
  followThroughPercent?: number;
  reliabilityScore?: number;
  confidenceLabel?: string;
  earningsPattern?: EarningsPatternEntry[];
};

export type TradeProbability = {
  beatFollowThrough: number;
  reliabilityScore: number;
};

export type DecisionNarrative = {
  why_this_matters: string;
  what_to_do: string;
  what_to_avoid: string;
  source?: string;
  locked?: boolean;
};

export type DecisionEarningsEdge = {
  label: string;
  score: number;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  next_date: string | null;
  report_time: string | null;
  expected_move_percent: number | null;
  status: string;
  read: string | null;
};

export type DecisionExecutionPlan = {
  strategy: string;
  entry: string | null;
  stop: string | null;
  target: string | null;
  timeframe?: string | null;
  invalidation?: string | null;
} | null;

export type DecisionPayload = {
  symbol: string | null;
  tradeable: boolean;
  confidence: number;
  setup: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  driver: string;
  earnings_edge: DecisionEarningsEdge;
  risk_flags: string[];
  status: 'TRADEABLE' | 'AVOID';
  action: string;
  why: string;
  how: string;
  risk: string;
  narrative?: DecisionNarrative;
  execution_plan?: DecisionExecutionPlan;
  source?: string;
};

export type ResearchWhyMovingTradePlan = {
  entry: string;
  stop: string;
  target: string;
} | null;

export type ResearchWhyMovingPayload = {
  driver: string;
  summary: string;
  tradeability: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence_score: number;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  what_to_do: string;
  what_to_avoid: string;
  setup: string;
  action?: string | null;
  trade_plan: ResearchWhyMovingTradePlan;
};

export type ResearchFullOwnership = {
  symbol?: string;
  institutional?: number | null;
  insider?: string | null;
  etf?: number | null;
  investors_holding?: number | null;
  total_invested?: number | null;
  new_positions?: number | null;
  increased_positions?: number | null;
  closed_positions?: number | null;
  reduced_positions?: number | null;
  put_call_ratio?: number | null;
  etf_exposure_list?: Array<{ name: string; weight_percent: number | null }>;
  insider_total_bought?: number | null;
  insider_total_sold?: number | null;
  insider_buy_count?: number | null;
  insider_sell_count?: number | null;
  insider_summary?: string | null;
  recent_insider_buy_summary?: string | null;
  recent_upgrade_summary?: string | null;
  updated_at?: string | null;
  source?: string;
};

export type ResearchFullContext = {
  spy_trend?: ResearchTrend;
  qqq_trend?: ResearchTrend;
  vix_level?: number | null;
  spy?: { price?: number | null; change?: number | null };
  qqq?: { price?: number | null; change?: number | null };
  vix?: { level?: number | null };
  regime?: string | null;
  regimeBias?: string | null;
  sectorTailwind?: boolean;
  sector_strength_json?: Record<string, number | string | null> | null;
  sectorLeaders?: Array<{ sector: string; change: number }>;
  sectorLaggers?: Array<{ sector: string; change: number }>;
  narrative?: string | null;
  lastUpdated?: string | null;
  stale?: boolean;
  updated_at?: string | null;
  source?: string;
};

export type ResearchFullMeta = {
  source?: string;
  cached?: boolean;
  stale?: boolean;
  updated_at?: string | null;
  total_ms?: number;
};

export type ResearchCoverage = {
  symbol: string;
  has_news: boolean;
  has_earnings: boolean;
  has_technicals: boolean;
  news_count: number;
  earnings_count: number;
  last_news_at: string | null;
  last_earnings_at: string | null;
  coverage_score: number;
  status: 'COMPLETE' | 'PARTIAL' | 'LOW';
  tradeable: boolean;
  last_checked: string | null;
};

export type ResearchScore = {
  final_score: number;
  tqi: number;
  tqi_label: 'A' | 'B' | 'C' | 'D';
  coverage_score: number;
  data_confidence: number;
  data_confidence_label: DataConfidenceLabel;
  tradeable: boolean;
  updated_at: string | null;
};

export type ResearchScannerMomentumFlow = {
  price: number | null;
  change_percent: number | null;
  gap_percent: number | null;
  relative_volume: number | null;
  volume: number | null;
  premarket_change_percent: number | null;
  premarket_volume: number | null;
  change_from_open_percent: number | null;
};

export type ResearchScannerMarketStructure = {
  market_cap: number | null;
  float_shares: number | null;
  short_float_percent: number | null;
  avg_volume: number | null;
  spread_percent: number | null;
  shares_outstanding: number | null;
  sector: string | null;
  exchange: string | null;
};

export type ResearchScannerTechnical = {
  rsi14: number | null;
  atr_percent: number | null;
  adr_percent: number | null;
  from_52w_high_percent: number | null;
  from_52w_low_percent: number | null;
  above_vwap: boolean | null;
  above_sma20: boolean | null;
  above_sma50: boolean | null;
  above_sma200: boolean | null;
  squeeze_setup: boolean | null;
  new_hod: boolean | null;
  beta: number | null;
};

export type ResearchScannerCatalystEvents = {
  days_to_earnings: number | null;
  earnings_surprise_percent: number | null;
  has_news_today: boolean | null;
  recent_insider_buy: boolean | null;
  recent_upgrade: boolean | null;
  recent_insider_buy_summary?: string | null;
  recent_upgrade_summary?: string | null;
  institutional_ownership_percent: number | null;
  insider_ownership_percent: number | null;
};

export type ResearchScannerFundamentals = {
  pe: number | null;
  ps: number | null;
  eps_growth_percent: number | null;
  revenue_growth_percent: number | null;
  debt_equity: number | null;
  roe_percent: number | null;
  fcf_yield_percent: number | null;
  dividend_yield_percent: number | null;
};

export type ResearchScannerOptionsFlow = {
  iv_rank: number | null;
  put_call_ratio: number | null;
  options_volume: number | null;
  options_volume_vs_30d: number | null;
  net_premium: number | null;
  unusual_options: boolean | null;
};

export type ResearchScanner = {
  momentum_flow: ResearchScannerMomentumFlow;
  market_structure: ResearchScannerMarketStructure;
  technical: ResearchScannerTechnical;
  catalyst_events: ResearchScannerCatalystEvents;
  fundamentals: ResearchScannerFundamentals;
  options_flow: ResearchScannerOptionsFlow;
};

export type DataConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW' | 'POOR';

export type ResearchIndicatorMacd = {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  state: string;
};

export type ResearchIndicatorStructure = {
  above_vwap: boolean | null;
  ema_trend: string;
  macd_state: string;
};

export type ResearchIndicatorPanelRow = {
  time: number;
  close: number | null;
  volume: number | null;
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
};

export type ResearchFullIndicators = {
  price: number | null;
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  macd: ResearchIndicatorMacd;
  structure: ResearchIndicatorStructure;
  panels: {
    "1min": ResearchIndicatorPanelRow[];
    "5min": ResearchIndicatorPanelRow[];
    "1day": ResearchIndicatorPanelRow[];
  };
  updated_at: string | null;
};

export type ResearchFullResponse = {
  success: boolean;
  profile: ResearchFullProfile;
  price: ResearchFullPrice;
  fundamentals: ResearchFullFundamentals;
  earnings: ResearchFullEarnings;
  earningsInsight: EarningsInsight;
  earningsEdge?: EarningsEdge;
  tradeProbability?: TradeProbability;
  indicators?: ResearchFullIndicators;
  coverage?: ResearchCoverage;
  score?: ResearchScore;
  scanner?: ResearchScanner;
  data_confidence?: number;
  data_confidence_label?: DataConfidenceLabel;
  freshness_score?: number;
  source_quality?: number;
  decision?: DecisionPayload;
  why_moving?: ResearchWhyMovingPayload;
  ownership?: ResearchFullOwnership;
  context?: ResearchFullContext;
  meta?: ResearchFullMeta;
  error?: string;
  message?: string;
};

export async function getResearchSnapshot(symbol: string): Promise<ResearchResponse> {
  const normalized = String(symbol || "").trim().toUpperCase();
  return apiGet<ResearchResponse>(`/api/research/${encodeURIComponent(normalized)}`);
}

export async function getResearchFullSnapshot(symbol: string): Promise<ResearchFullResponse> {
  const normalized = String(symbol || "").trim().toUpperCase();
  return apiGet<ResearchFullResponse>(`/api/research/${encodeURIComponent(normalized)}/full`);
}