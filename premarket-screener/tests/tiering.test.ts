import { rankTiers } from '../scoring/tiering';
import { EnrichedTicker } from '../models/types';

function makeTicker(
  ticker: string,
  classification: 'A' | 'B' | 'C',
  overrides: Partial<EnrichedTicker> = {},
): EnrichedTicker {
  return {
    ticker,
    catalyst: { type: 'product', detail: 'Test' },
    relVolume: 2,
    pmChangePct: 6,
    pmPrice: 10,
    avgVolume: 1000000,
    pmVolume: 200000,
    levels: { pmHigh: 10.5, pmLow: 9.8 },
    classification,
    conviction: classification === 'A' ? 'HIGH' : classification === 'B' ? 'MEDIUM' : 'LOW',
    permittedStrategies: classification === 'A'
      ? ['Strategy 1 (ORB)', 'Strategy 4 (Momentum Extension)']
      : classification === 'B'
        ? ['Strategy 1 (ORB)', 'Strategy 2 (Support Bounce)', 'Strategy 3 (VWAP Reclaim)']
        : ['Strategy 3 (VWAP Reclaim)', 'Strategy 5 (Post-Flush Reclaim)'],
    primaryStrategy: classification === 'C' ? 'Strategy 3 (VWAP Reclaim)' : 'Strategy 1 (ORB)',
    ...overrides,
  };
}

describe('rankTiers', () => {
  test('limits Tier 1 to max 4 entries', () => {
    const tickers = Array.from({ length: 6 }, (_, i) =>
      makeTicker(`T${i}`, i < 5 ? 'A' : 'B'),
    );
    const { tier1, tier2 } = rankTiers(tickers);
    expect(tier1.length).toBeLessThanOrEqual(4);
    expect(tier2.length).toBeGreaterThan(0);
  });

  test('Class C tickers go to Tier 3, never Tier 1', () => {
    const tickers = [
      makeTicker('A1', 'A'),
      makeTicker('C1', 'C'),
      makeTicker('B1', 'B'),
    ];
    const { tier1, tier3 } = rankTiers(tickers);
    expect(tier1.map((t) => t.ticker)).not.toContain('C1');
    expect(tier3.map((t) => t.ticker)).toContain('C1');
  });

  test('Tier 3 entries include reason for exclusion', () => {
    const tickers = [makeTicker('C1', 'C')];
    const { tier3 } = rankTiers(tickers);
    expect(tier3[0].reason).toBeDefined();
    expect(tier3[0].reason).toContain('Class C');
  });

  test('higher-scored tickers rank first in Tier 1', () => {
    const tickers = [
      makeTicker('WEAK', 'B', { relVolume: 0.5, pmChangePct: 3 }),
      makeTicker('STRONG', 'A', { relVolume: 4.0, pmChangePct: 20, catalyst: { type: 'fda', detail: 'Approval' } }),
    ];
    const { tier1 } = rankTiers(tickers);
    expect(tier1[0].ticker).toBe('STRONG');
  });

  test('Tier 2 entries include whySecondary', () => {
    const tickers = Array.from({ length: 6 }, (_, i) =>
      makeTicker(`T${i}`, 'A'),
    );
    const { tier2 } = rankTiers(tickers);
    expect(tier2.length).toBeGreaterThan(0);
    for (const entry of tier2) {
      expect(entry.whySecondary).toBeDefined();
    }
  });

  test('empty input returns empty tiers', () => {
    const { tier1, tier2, tier3 } = rankTiers([]);
    expect(tier1).toHaveLength(0);
    expect(tier2).toHaveLength(0);
    expect(tier3).toHaveLength(0);
  });

  test('single A ticker goes to Tier 1', () => {
    const { tier1 } = rankTiers([makeTicker('SOLO', 'A')]);
    expect(tier1).toHaveLength(1);
    expect(tier1[0].ticker).toBe('SOLO');
  });

  test('key level is populated from pmHigh', () => {
    const { tier1 } = rankTiers([
      makeTicker('T1', 'A', { levels: { pmHigh: 15.50, pmLow: 14.00 } }),
    ]);
    expect(tier1[0].keyLevel).toBe(15.50);
  });
});
