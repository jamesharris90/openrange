export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" | "1M";

export type PricePoint = {
  time: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
};

export type MarketQuote = {
  symbol: string;
  price: number;
  change_percent: number;
  volume_24h?: number;
  relative_volume?: number;
  gap_percent?: number;
  sector?: string;
  market_cap?: number;
  logo_url?: string;
};

export type Opportunity = {
  symbol: string;
  news_id?: number;
  strategy: string;
  probability: number;
  confidence: number;
  expected_move: number;
  catalyst?: string;
  sector?: string;
};

export type EarningsRow = {
  symbol: string;
  company?: string;
  earnings_date: string;
  expected_move?: number;
  actual_move?: number;
  beat_miss?: string;
  post_earnings_move?: number;
  analyst_revisions?: string;
  sector?: string;
};

export type HeatmapRow = {
  symbol: string;
  sector: string;
  market_cap: number;
  volume_24h: number;
  gap_percent: number;
  relative_volume: number;
  institutional_flow_score: number;
  change_percent: number;
  logo_url?: string;
  sparkline?: number[];
};

export type AlertRow = {
  id: string;
  timestamp: string;
  symbol: string;
  signal: string;
  probability: number;
  confidence: number;
  sparkline?: number[];
};

export type SystemHealth = {
  name: string;
  status: "ok" | "warning" | "error";
  latency_ms?: number;
  updated_at?: string;
  detail?: string;
};

export type EmailAnalytics = {
  open_rate: number;
  click_rate: number;
  subscriber_growth: number;
  top_links: Array<{ url: string; clicks: number }>;
};

export type SectorMomentum = {
  sector: string;
  score: number;
  change_pct: number;
};

export type SignalRow = {
  ticker: string;
  setup: string;
  confidence: number;
  probability: number;
  volume_ratio: number;
  change_pct: number;
};

export type CatalystItem = {
  ticker: string;
  catalyst: string;
  impact: "low" | "medium" | "high";
  timestamp: string;
};

export type RegimeInput = {
  vix: number;
  breadth: number;
  put_call: number;
  regime: string;
};

export type AlertItem = {
  id: string;
  ticker: string;
  condition: string;
  enabled: boolean;
  last_triggered_at: string | null;
};
