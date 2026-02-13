import { CatalystInfo, TickerInput } from '../models/types';

export interface EarningsProvider {
  getEarningsContext(ticker: TickerInput): Promise<CatalystInfo | null>;
}
