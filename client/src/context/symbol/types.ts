export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicators {
  vwap?: number[];
  ema9?: number[];
  ema10?: number[];
  ema20?: number[];
  ema50?: number[];
  ema200?: number[];
  rsi14?: number[];
  macd?: number[];
  atr14?: number[];
  volumeMA20?: number[];
}

export interface Levels {
  pdh?: number;
  pdl?: number;
  pmh?: number;
  pml?: number;
  orHigh?: number;
  orLow?: number;
  orStartTime?: number;
  orEndTime?: number;
}

export interface CandleStore {
  history: Candle[];
  lastUpdateTime?: number;
}

export interface SymbolDataMeta {
  lastFetched: number;
  source: 'cache' | 'network';
}

export interface SymbolDataState {
  symbol: string;
  timeframe: string;
  candles: CandleStore;
  indicators: Indicators;
  levels: Levels;
  events: any[] | { earnings?: any[]; news?: any[] };
  meta: SymbolDataMeta;
  loading: boolean;
  error?: string;
}

export interface SymbolCacheEntry {
  data: SymbolDataState;
  lastFetched: number;
}
