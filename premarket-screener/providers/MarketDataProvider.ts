import { TickerInput, MarketLevels } from '../models/types';

export interface MarketDataProvider {
  getLevels(ticker: TickerInput): Promise<MarketLevels>;
}
