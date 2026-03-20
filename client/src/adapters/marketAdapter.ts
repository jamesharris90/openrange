export interface MarketQuote {
  symbol: string;
  price: number;
  change_percent: number;
  volume: number;
  market_cap: number;
  sector: string | null;
  updated_at: string;
  source: string;
}

export interface MarketOHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Opportunity {
  symbol: string;
  strategy: string;
  probability: number;
  confidence: number;
  confidence_base?: number;
  confidence_adjusted?: number;
  expected_move: number;
  timestamp: string;
}

export interface MarketQuotesResponse {
  success: boolean;
  count: number;
  source: string;
  data: MarketQuote[];
}

export interface MarketOHLCResponse {
  success: boolean;
  data: MarketOHLC[];
  source: string;
}

export interface OpportunitiesResponse {
  success: boolean;
  count: number;
  data: Opportunity[];
  meta?: {
    source?: string;
  };
}

function toPercentConfidence(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 0 && value <= 1) return value * 100;
  return value;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function adaptQuote(raw: MarketQuote) {
  const price = toFiniteNumber(raw?.price);
  const change = toFiniteNumber(raw?.change_percent);
  const volume = toFiniteNumber(raw?.volume);

  if (!raw?.symbol || price === null || change === null || volume === null) {
    console.warn("[marketAdapter] missing quote field", raw);
  }

  return {
    raw,
    symbol: String(raw?.symbol || ""),
    price,
    change,
    volume,
    marketCap: toFiniteNumber(raw?.market_cap),
    sector: raw?.sector ?? null,
    source: String(raw?.source || ""),
    updatedAt: raw?.updated_at ? new Date(raw.updated_at) : null,
    hasVolume: volume !== null && volume !== 0,
    displayVolume: volume === 0 ? null : volume,
  };
}

export function adaptOHLC(raw: MarketOHLC) {
  const time = toFiniteNumber(raw?.time);
  const open = toFiniteNumber(raw?.open);
  const high = toFiniteNumber(raw?.high);
  const low = toFiniteNumber(raw?.low);
  const close = toFiniteNumber(raw?.close);
  const volume = toFiniteNumber(raw?.volume);

  if (time === null || open === null || high === null || low === null || close === null || volume === null) {
    console.warn("[marketAdapter] missing ohlc field", raw);
  }

  return {
    raw,
    time,
    open,
    high,
    low,
    close,
    volume,
  };
}

export function adaptOpportunity(raw: Opportunity) {
  const probability = toFiniteNumber(raw?.probability);
  const baseConfidence = toPercentConfidence(toFiniteNumber((raw as any)?.confidence_percent ?? raw?.confidence));
  const adjustedConfidence = toPercentConfidence(
    toFiniteNumber((raw as any)?.confidence_context_percent ?? (raw as any)?.confidence_contextual ?? raw?.confidence)
  );
  const expectedMove = toFiniteNumber(raw?.expected_move);

  if (!raw?.symbol || !raw?.strategy || probability === null || adjustedConfidence === null || expectedMove === null) {
    console.warn("[marketAdapter] missing opportunity field", raw);
  }

  return {
    raw,
    symbol: String(raw?.symbol || ""),
    strategy: String(raw?.strategy || ""),
    probability,
    confidence: adjustedConfidence,
    confidenceBase: baseConfidence,
    confidenceAdjusted: adjustedConfidence,
    expectedMove,
    timestamp: raw?.timestamp ? new Date(raw.timestamp) : null,
    hasHighConfidence: adjustedConfidence !== null && adjustedConfidence > 70,
  };
}

export function adaptQuotesResponse(response: MarketQuotesResponse | null | undefined) {
  const rows = Array.isArray(response?.data) ? response.data : [];
  return rows.map(adaptQuote);
}

export function adaptOHLCResponse(response: MarketOHLCResponse | null | undefined) {
  const rows = Array.isArray(response?.data) ? response.data : [];
  return rows.map(adaptOHLC);
}

export function adaptOpportunitiesResponse(response: OpportunitiesResponse | null | undefined) {
  const rows = Array.isArray(response?.data) ? response.data : [];
  return rows.map(adaptOpportunity);
}
