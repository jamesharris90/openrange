export type SupportedExchange = 'NASDAQ' | 'NYSE' | 'AMEX';

export interface TechnicalFilters {
  priceMin?: number;
  priceMax?: number;
  marketCapMin?: number;
  marketCapMax?: number;
  rvolMin?: number;
  rvolMax?: number;
  volumeMin?: number;
  gapMin?: number;
  gapMax?: number;
  exchange?: SupportedExchange[];
}

export interface NewsFilters {
  hoursBack?: number;
  exchanges?: SupportedExchange[];
  minMarketCap?: number;
  minRvol?: number;
}

export interface ScreenerResult {
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  rvol: number;
  marketCap: number;
  gapPercent: number;
}

export interface NewsScreenerResult {
  symbol: string;
  headline: string;
  publishedDate: string;
  source: string;
  price: number;
  changePercent: number;
  rvol: number;
}

export interface UniverseStock {
  symbol: string;
  name: string;
  exchange: SupportedExchange;
  price: number | null;
  marketCap: number | null;
  volume: number | null;
  avgVolume: number | null;
  type: string;
  isActivelyTrading: boolean;
}

export interface BatchQuote {
  symbol: string;
  name?: string;
  price?: number;
  changePercentage?: number;
  change?: number;
  volume?: number;
  marketCap?: number;
  open?: number;
  previousClose?: number;
  timestamp?: number;
}
