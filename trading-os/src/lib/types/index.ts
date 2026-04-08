import type { DataSource } from "@/lib/data-source";

export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" | "1M";

export type PricePoint = {
  time: string | number;
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
  source?: DataSource;
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
  expected_move_percent?: number;
  source?: DataSource;
  catalyst?: string;
  sector?: string;
  price?: number;
  iv?: number;
  lastPrice?: number;
  prevClose?: number;
  entry?: number;
  stop_loss?: number;
  take_profit?: number;
  trade_plan?: string;
  updated_at?: string;
};

export type EarningsRow = {
  symbol: string;
  event_date: string;
  tradeability?: string | null;
  expected_move?: number | null;
  last_updated_date?: string | null;
  eps_estimate?: number | null;
  eps_actual?: number | null;
  revenue_estimate?: number | null;
  revenue_actual?: number | null;
  raw_json?: Record<string, unknown>;
  ingested_at?: string;
  source?: DataSource;
  [key: string]: unknown;
};

export type HeatmapRow = {
  symbol: string;
  sector: string;
  source?: DataSource;
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
