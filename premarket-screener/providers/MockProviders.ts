import { EarningsProvider } from './EarningsProvider';
import { MarketDataProvider } from './MarketDataProvider';
import { NewsProvider } from './NewsProvider';
import { CatalystInfo, MarketLevels, TickerInput } from '../models/types';

// ─── Mock catalyst data ────────────────────────────────────────────────────────

const mockCatalysts: Record<string, CatalystInfo> = {
  NVDA: {
    type: 'earnings',
    detail: 'Q4 beat: revenue $39.3B vs $38.1B est; data-centre up 93% YoY; raised FY guidance',
    earningsTiming: 'Reported last night (after close)',
  },
  SMCI: {
    type: 'product',
    detail: 'Announced new liquid-cooled AI server rack; major OEM partnership with NVDA',
    earningsTiming: 'N/A',
  },
  MARA: {
    type: 'sector',
    detail: 'BTC breaks $105k overnight; hashrate expansion announced',
    earningsTiming: 'Earnings next week',
  },
  RIVN: {
    type: 'contract',
    detail: 'Awarded $5B fleet contract with Amazon for next-gen delivery vans',
    earningsTiming: 'Reported 2 weeks ago',
  },
  PLTR: {
    type: 'upgrade',
    detail: 'Morgan Stanley upgrades to overweight; PT raised to $100',
    earningsTiming: 'Earnings in 3 weeks',
  },
  BIOR: {
    type: 'fda',
    detail: 'FDA grants Fast Track designation for lead compound BIO-101',
    earningsTiming: 'N/A',
  },
  LCID: {
    type: 'offering',
    detail: '$1.5B secondary offering priced at $2.40; dilution concerns',
    earningsTiming: 'Reported last week',
  },
  FLNC: {
    type: 'general',
    detail: 'No identifiable catalyst — drifting on low volume',
  },
  RXRX: {
    type: 'merger',
    detail: 'Reports of acquisition talks with major pharma (unconfirmed)',
    earningsTiming: 'N/A',
  },
  PRAX: {
    type: 'fda',
    detail: 'Phase 3 data readout — primary endpoint met with p<0.001; NDA filing expected Q2',
    earningsTiming: 'N/A',
  },
};

// ─── Mock OHLC / level data ────────────────────────────────────────────────────

const mockLevels: Record<string, MarketLevels> = {
  NVDA: {
    prevHigh: 145.20,
    prevLow: 140.10,
    prevClose: 142.50,
    pmHigh: 153.80,
    pmLow: 149.20,
    week52High: 153.80,
    week52Low: 65.80,
    htfResistance: 155.00,
    htfSupport: 138.00,
  },
  SMCI: {
    prevHigh: 39.80,
    prevLow: 36.50,
    prevClose: 38.20,
    pmHigh: 45.20,
    pmLow: 42.00,
    week52High: 122.90,
    week52Low: 18.50,
    htfResistance: 48.00,
    htfSupport: 35.00,
  },
  MARA: {
    prevHigh: 19.80,
    prevLow: 18.10,
    prevClose: 18.90,
    pmHigh: 21.30,
    pmLow: 19.90,
    week52High: 34.00,
    week52Low: 11.20,
    htfResistance: 22.50,
    htfSupport: 17.50,
  },
  RIVN: {
    prevHigh: 14.10,
    prevLow: 12.80,
    prevClose: 13.40,
    pmHigh: 15.20,
    pmLow: 14.40,
    week52High: 28.60,
    week52Low: 8.40,
    htfResistance: 16.00,
    htfSupport: 12.50,
  },
  PLTR: {
    prevHigh: 83.50,
    prevLow: 80.60,
    prevClose: 82.30,
    pmHigh: 85.40,
    pmLow: 83.90,
    week52High: 85.40,
    week52Low: 21.00,
    htfResistance: 88.00,
    htfSupport: 78.00,
  },
  BIOR: {
    prevHigh: 2.30,
    prevLow: 1.95,
    prevClose: 2.10,
    pmHigh: 2.65,
    pmLow: 2.35,
    week52High: 6.80,
    week52Low: 1.40,
    htfResistance: 3.00,
    htfSupport: 1.80,
  },
  LCID: {
    prevHigh: 3.10,
    prevLow: 2.70,
    prevClose: 2.80,
    pmHigh: 2.60,
    pmLow: 2.38,
    week52High: 7.20,
    week52Low: 2.00,
    htfResistance: 3.20,
    htfSupport: 2.30,
  },
  FLNC: {
    prevHigh: 8.70,
    prevLow: 8.20,
    prevClose: 8.40,
    pmHigh: 8.65,
    pmLow: 8.50,
    week52High: 24.30,
    week52Low: 6.10,
    htfResistance: 9.50,
    htfSupport: 7.80,
  },
  RXRX: {
    prevHigh: 6.20,
    prevLow: 5.60,
    prevClose: 5.90,
    pmHigh: 6.90,
    pmLow: 6.30,
    week52High: 12.40,
    week52Low: 3.80,
    htfResistance: 7.50,
    htfSupport: 5.20,
  },
  PRAX: {
    prevHigh: 74.00,
    prevLow: 69.50,
    prevClose: 72.00,
    pmHigh: 92.00,
    pmLow: 85.00,
    week52High: 92.00,
    week52Low: 28.00,
    htfResistance: 95.00,
    htfSupport: 68.00,
  },
};

// ─── Provider implementations ──────────────────────────────────────────────────

export class MockNewsProvider implements NewsProvider {
  async getCatalyst(ticker: TickerInput): Promise<CatalystInfo | null> {
    return mockCatalysts[ticker.ticker] ?? null;
  }
}

export class MockEarningsProvider implements EarningsProvider {
  async getEarningsContext(ticker: TickerInput): Promise<CatalystInfo | null> {
    const base = mockCatalysts[ticker.ticker];
    if (!base || base.type !== 'earnings') return null;
    return { ...base };
  }
}

export class MockMarketDataProvider implements MarketDataProvider {
  async getLevels(ticker: TickerInput): Promise<MarketLevels> {
    return (
      mockLevels[ticker.ticker] ?? {
        prevHigh: undefined,
        prevLow: undefined,
        prevClose: undefined,
        pmHigh: ticker.pmPrice,
        pmLow: ticker.pmPrice,
        week52High: undefined,
        week52Low: undefined,
        htfResistance: undefined,
        htfSupport: undefined,
      }
    );
  }
}
