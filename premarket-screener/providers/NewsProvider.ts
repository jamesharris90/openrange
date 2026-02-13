import { CatalystInfo, TickerInput } from '../models/types';

export interface NewsProvider {
  getCatalyst(ticker: TickerInput): Promise<CatalystInfo | null>;
}
